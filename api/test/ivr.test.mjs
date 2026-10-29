import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { hashPassword } from '../src/auth.js';
import { isRoshChodesh } from '../src/settings.js';
import { relativeClock, zmanTime } from '../src/zmanim.js';
import worker from '../src/index.js';
import { D1Shim } from './d1-shim.mjs';

const KEY = 'test-ivr-key';
let env;
let callSeq = 0;

/** Simulates Yemot: every request carries the call params plus all values read so far. */
function yemotCall(phone, { key = KEY, path = '/api/ivr', method = 'GET' } = {}) {
  const params = { ApiCallId: `call-${++callSeq}`, ApiPhone: phone, ApiDID: '0771234567', ApiExtension: '1', key };
  let lastVal = null;
  const send = async (extra = {}) => {
    Object.assign(params, extra);
    const qs = new URLSearchParams(params).toString();
    const req = method === 'GET'
      ? new Request(`https://x.test${path}?${qs}`)
      : new Request(`https://x.test${path}?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type'), /text\/html/);
    const body = await res.text();
    const m = body.match(/read=.*=(s\d+),/);
    lastVal = m ? m[1] : null;
    return body;
  };
  return {
    start: () => send(),
    press: (value) => {
      assert.ok(lastVal, 'no pending read');
      return send({ [lastVal]: value });
    },
    hangup: () => send({ hangup: 'yes' }),
    get lastVal() { return lastVal; },
  };
}

const q = (sql, ...p) => env.DB.prepare(sql).bind(...p);

beforeEach(async () => {
  env = { DB: new D1Shim(), BASE_PATH: '/zmanim' };
  await q(`INSERT INTO settings (key, value) VALUES ('ivr_key', ?)`, KEY).run();
  await q(`INSERT INTO users (name, email, phone, role, is_super, password_hash) VALUES ('מנהל על', 'super@x.com', '0583206823', 'admin', 1, ?)`).bind(await hashPassword('4321')).run();
  await q(`INSERT INTO areas (name) VALUES ('רמות')`).run();
});

describe('ivr access', () => {
  test('wrong key and unknown phone are rejected with valid Yemot text', async () => {
    let body = await yemotCall('0583206823', { key: 'bad' }).start();
    assert.match(body, /^id_list_message=t-.+&$/);
    assert.doesNotMatch(body, /go_to_folder|hangup/);
    body = await yemotCall('0500000000').start();
    assert.match(body, /אינו מורשה/);
    assert.match(body, /&$/);
  });

  test('admin gets the main menu; read syntax is well formed; hangup clears state', async () => {
    const call = yemotCall('+972583206823');
    const body = await call.start();
    assert.match(body, /^id_list_message=t-שלום מנהל על&read=t-תפריט ראשי\.t-לבחירת בית כנסת/);
    assert.match(body, /=s1,no,1,1,10,No,no,no,,,2,Ok,None,$/);
    assert.equal(await call.hangup(), '');
    assert.equal((await q(`SELECT COUNT(*) AS n FROM ivr_calls`).first()).n, 0);
  });

  test('works under the /zmanim prefix and via POST', async () => {
    const body = await yemotCall('0583206823', { path: '/zmanim/api/ivr', method: 'POST' }).start();
    assert.match(body, /תפריט ראשי/);
  });

  test('repeated request without an answer repeats the question; invalid key press', async () => {
    const call = yemotCall('0583206823');
    const first = await call.start();
    // Same request again (no answer for s1): the same question comes back
    const repeat = await worker.fetch(new Request(`https://x.test/api/ivr?${new URLSearchParams({ ApiCallId: `call-${callSeq}`, ApiPhone: '0583206823', key: KEY })}`), env);
    assert.equal(await repeat.text(), first.split('&').at(-1));
    const body = await call.press('7');
    assert.match(body, /הקשה לא חוקית/);
    assert.match(body, /=s2,/);
  });

  test('timeouts three times -> goodbye', async () => {
    const call = yemotCall('0583206823');
    await call.start();
    await call.press('None');
    await call.press('None');
    const body = await call.press('None');
    assert.equal(body, 'id_list_message=t-לא התקבלה הקשה&');
  });

  test('text never contains Yemot reserved characters', async () => {
    await q(`INSERT INTO synagogues (name) VALUES ('בית "אהל" משה - רמות.')`).run();
    const call = yemotCall('0583206823');
    await call.start();
    const body = await call.press('1'); // choose a synagogue: the list is read
    const messages = body.split('&').map((part) => part.replace(/^(id_list_message|read)=/, '').split('=')[0]);
    for (const msg of messages) for (const piece of msg.split('.')) assert.doesNotMatch(piece.slice(2), /["'&|=\-]/);
  });
});

describe('ivr management', () => {
  test('admin: create synagogue by voice, add manager by phone, manager adds minyanim', async () => {
    const admin = yemotCall('0583206823');
    await admin.start();
    let body = await admin.press('2'); // new synagogue
    assert.match(body, /,voice,he-IL/);
    body = await admin.press('אהל משה');
    assert.match(body, /שם בית הכנסת: אהל משה/);
    body = await admin.press('1');
    assert.match(body, /בחירת אזור לבית הכנסת\.t-לרמות הקישו 1/);
    body = await admin.press('1');
    assert.match(body, /בית הכנסת נוצר, מספרו 1/);
    assert.equal((await q(`SELECT area_id FROM synagogues`).first()).area_id, 1);
    body = await admin.press('5'); // managers
    assert.match(body, /אין גבאים/);
    body = await admin.press('1');
    body = await admin.press('0521112233');
    assert.match(body, /הגבאי נוסף/);
    const mgr = await q(`SELECT * FROM users WHERE phone = '0521112233'`).first();
    assert.equal(mgr.role, 'manager');

    // the manager calls: goes straight into the synagogue
    const m = yemotCall('052-111-2233');
    body = await m.start();
    assert.match(body, /read=t-אהל משה, זמני קיץ\./); // the season being worked on is announced
    assert.doesNotMatch(body, /הגדרות בית הכנסת/); // admin-only option hidden

    // add: shacharit 06:30, every day, (no locations), into the season being worked on
    await m.press('2');
    body = await m.press('1'); // prayer 1 = shacharit
    assert.match(body, /סוג הזמן/);
    await m.press('1'); // fixed
    body = await m.press('0630');
    assert.match(body, /באילו ימים/);
    body = await m.press('1'); // every day -> confirm (no season question)
    assert.doesNotMatch(body, /עונה/);
    assert.match(body, /המניין: שחרית, בשעה 6 30, ראשון עד שישי/); // Shabbat is off: 'every day' = weekdays
    body = await m.press('1');
    assert.match(body, /המניין נשמר/);

    // add: mincha 15 minutes before sunset, Sun-Thu
    await m.press('2');
    await m.press('2'); // mincha
    await m.press('2'); // relative
    await m.press('2'); // anchor 2 = sunset
    await m.press('15');
    await m.press('1'); // before
    body = await m.press('2'); // Sun-Thu
    assert.match(body, /15 דקות לפני שקיעה, ראשון עד חמישי/);
    await m.press('1');

    const rows = await q(`SELECT * FROM minyanim ORDER BY id`).all();
    assert.equal(rows.results.length, 2);
    const log = await q(`SELECT via, action, user_id FROM minyan_log ORDER BY id`).all();
    assert.deepEqual(log.results.map((l) => [l.via, l.action, l.user_id]), [['phone', 'create', mgr.id], ['phone', 'create', mgr.id]], 'phone changes are logged');
    assert.deepEqual(
      rows.results.map((r) => [r.time_kind, r.time, r.anchor_id, r.offset_minutes, r.days]),
      [['fixed', '06:30', null, null, 63], ['relative', null, 2, -15, 31]]
    );

    // manage: choose a prayer (or 0 for all), the list is read, choose one
    body = await m.press('1');
    assert.match(body, /בחירת תפילה\.t-לכל המניינים הקישו 0\.t-למנייני שחרית הקישו 1\.t-למנייני מנחה הקישו 2/);
    body = await m.press('0');
    assert.match(body, /יש 2 מניינים\.t-לבחירת מניין הקישו את המספר שלו\.t-שחרית, בשעה 6 30, ראשון עד שישי: הקישו 1\.t-מנחה, 15 דקות לפני שקיעה, ראשון עד חמישי: הקישו 2/);
    body = await m.press('*');
    body = await m.press('2'); // only mincha: its name is not repeated
    assert.match(body, /יש מניין אחד\.t-לבחירת מניין הקישו את המספר שלו\.t-15 דקות לפני שקיעה, ראשון עד חמישי: הקישו 1/);
    body = await m.press('1');
    assert.match(body, /read=t-מנחה, 15 דקות לפני שקיעה, ראשון עד חמישי\.t-לשינוי שעה הקישו 1/);
  });

  test('validation errors are spoken, not crashed', async () => {
    await q(`INSERT INTO synagogues (name) VALUES ('בית כנסת')`).run();
    const call = yemotCall('0583206823');
    await call.start();
    await call.press('1');
    let body = await call.press('1'); // synagogue #1
    await call.press('2'); // add
    await call.press('1'); // shacharit (04:00-12:00)
    await call.press('1');
    await call.press('1500'); // 15:00 -> out of range
    await call.press('1');
    await call.press('0');
    body = await call.press('1'); // save
    assert.match(body, /שחרית לא אחרי 12:00/);
    assert.match(body, /read=t-בית כנסת/); // back in the synagogue menu
  });

  test('edit: hide, change time, delete; quotas respected', async () => {
    await q(`INSERT INTO synagogues (name, max_minyanim) VALUES ('ב', 1)`).run();
    await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, time, season_id) VALUES (1, 1, 'fixed', '07:00', 1)`).run();
    const call = yemotCall('0583206823');
    await call.start();
    await call.press('1'); // choose a synagogue
    await call.press('1');
    await call.press('1'); // manage minyanim (one prayer: straight to the list)
    let body = await call.press('1'); // the first minyan
    assert.match(body, /שחרית, בשעה 7/);
    body = await call.press('4'); // hide
    assert.match(body, /הוסתר/);
    assert.equal((await q(`SELECT is_active FROM minyanim`).first()).is_active, 0);
    await call.press('1'); // change time
    await call.press('1'); // fixed
    body = await call.press('0745');
    assert.match(body, /בשעה 7 45/);
    await call.press('1');
    assert.equal((await q(`SELECT time FROM minyanim`).first()).time, '07:45');
    await call.press('1'); // back in the list after saving: the minyan again
    body = await call.press('5'); // duplicate -> over quota
    assert.match(body, /הגעתם למכסה של 1 מניינים/);
    await call.press('6');
    body = await call.press('1');
    assert.match(body, /המניין נמחק/);
    assert.equal((await q(`SELECT COUNT(*) AS n FROM minyanim`).first()).n, 0);
  });

  test('phone password: enable with the real password, then asked on every call; login is logged', async () => {
    const call = yemotCall('0583206823');
    await call.start();
    let body = await call.press('4');
    assert.match(body, /כרגע אין דרישת סיסמה/);
    body = await call.press('9999');
    assert.match(body, /הסיסמה שגויה/);
    await call.press('4');
    body = await call.press('4321');
    assert.match(body, /תתבקשו להקיש את הסיסמה/);
    const next = yemotCall('0583206823');
    body = await next.start();
    assert.match(body, /^read=t-הקישו את הסיסמה שלכם/);
    body = await next.press('1111');
    assert.match(body, /סיסמה שגויה/);
    body = await next.press('4321');
    assert.match(body, /שלום מנהל על/);
    const log = await q(`SELECT channel, detail FROM login_log ORDER BY id`).all();
    assert.deepEqual(log.results.map((r) => r.channel), ['phone', 'phone']);
  });

  test('super admin is protected and can be hidden', async () => {
    await q(`INSERT INTO users (name, email, phone, role, password_hash) VALUES ('מנהל שני', 'b@x.com', '0547778899', 'admin', 'x')`).run();
    const other = yemotCall('0547778899');
    await other.start();
    let body = await other.press('3');
    assert.match(body, /1, מנהל על/);
    await other.press('2');
    body = await other.press('1');
    assert.match(body, /לא ניתן להסיר משתמש זה/);
    await q(`UPDATE users SET is_hidden = 1 WHERE is_super = 1`).run();
    const again = yemotCall('0547778899');
    await again.start();
    body = await again.press('3');
    assert.doesNotMatch(body, /מנהל על/);
  });

  test('choosing a synagogue: by area, then the whole list numbered on (10, 11 …)', async () => {
    await q(`INSERT INTO areas (name) VALUES ('גבעת שאול')`).run();
    const names = Array.from({ length: 10 }, (_, i) => `בית כנסת ${String.fromCharCode(1488 + i)}`);
    for (const n of names) await q(`INSERT INTO synagogues (name, area_id) VALUES (?, 2)`).bind(n).run();
    await q(`INSERT INTO synagogues (name, area_id) VALUES ('אחר', 1)`).run();
    const call = yemotCall('0583206823');
    await call.start();
    let body = await call.press('1');
    assert.match(body, /בחירת אזור\.t-לכל האזורים הקישו 0/);
    body = await call.press('1'); // גבעת שאול (areas are read alphabetically)
    assert.match(body, /בחירת בית כנסת\.t-הקישו את המספר ואחריו סולמית\.t-לבית כנסת א הקישו 1/);
    assert.match(body, /לבית כנסת י הקישו 10\.t-לחזרה הקישו כוכבית=s\d+,no,2,1,/); // up to 2 digits
    assert.doesNotMatch(body, /לאחר הקישו|נוספים/);
    body = await call.press('10');
    assert.match(body, /read=t-בית כנסת י, זמני/);
  });

  test('closed management line answers politely', async () => {
    await q(`INSERT INTO settings (key, value) VALUES ('manage_phone_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = '0'`).run();
    assert.equal(await yemotCall('0583206823').start(), 'id_list_message=t-שלוחת הניהול סגורה כרגע&');
  });

  test('admins: add by phone, cannot remove self', async () => {
    const call = yemotCall('0583206823');
    await call.start();
    await call.press('3');
    await call.press('1');
    let body = await call.press('0547778899');
    assert.match(body, /מנהל המערכת נוסף/);
    assert.equal((await q(`SELECT role FROM users WHERE phone = '0547778899'`).first()).role, 'admin');
    await call.press('2');
    body = await call.press('1'); // #1 is self
    assert.match(body, /לא ניתן להסיר את עצמך/);
  });
});

describe('ivr listening line', () => {
  const listen = (phone = '0501111111') => yemotCall(phone, { path: '/api/ivr/listen', key: '' });

  beforeEach(async () => {
    await q(`INSERT INTO areas (name) VALUES ('גבעת שאול')`).run();
    await q(`INSERT INTO synagogues (name, area_id) VALUES ('אהל משה', 1), ('זכרון משה', 2)`).run();
    await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, time, days, season_id) VALUES (1, 1, 'fixed', '06:30', 127, 1), (2, 1, 'fixed', '07:00', 127, 1), (1, 1, 'fixed', '08:00', 64, 1)`).run();
    await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, anchor_id, offset_minutes, days, season_id) VALUES (1, 2, 'relative', 2, -15, 127, 1)`).run();
  });

  // A weekday at 07:10 in Israel, and a weekday that is Rosh Chodesh.
  const at = (date, clock) => new Date(`${date}T${clock}:00+02:00`).toISOString();
  const findDay = (rc) => {
    for (let d = new Date('2026-11-01T12:00:00+02:00'); ; d = new Date(d.getTime() + 86400000)) {
      const day = d.toISOString().slice(0, 10);
      if (new Date(`${day}T12:00:00+02:00`).getUTCDay() !== 6 && isRoshChodesh(new Date(`${day}T12:00:00+02:00`)) === rc) return day;
    }
  };
  afterEach(() => { delete env.FIXED_NOW; });

  test('every call is recorded: steps, what was heard, searches; blocked numbers on the management line too', async () => {
    env.FIXED_NOW = at(findDay(false), '05:00');
    const call = listen('0521234567');
    await call.start();
    await call.press('2'); // רמות
    await call.press('1'); // שחרית
    await call.press('0630');
    await call.hangup();
    await yemotCall('0509999999').start(); // not allowed on the management line
    const login = await worker.fetch(new Request('https://x.test/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'super@x.com', password: '4321' }) }), env).then((r) => r.json());
    const get = (path) => worker.fetch(new Request(`https://x.test/api${path}`, { headers: { Authorization: `Bearer ${login.token}` } }), env).then((r) => r.json());
    const a = await get('/admin/phone-activity?days=30');
    assert.equal(a.stats.calls, 2);
    assert.equal(a.stats.blocked, 1);
    assert.equal(a.stats.searches, 1);
    assert.equal(a.stats.heard, 1);
    assert.deepEqual(a.prayers.map((p) => [p.name, p.n]), [['שחרית', 1]]);
    assert.deepEqual(a.areas.map((p) => [p.name, p.n]), [['רמות', 1]]);
    const listenCall = a.calls.find((c) => c.line === 'listen');
    assert.equal(listenCall.phone, '0521234567');
    assert.ok(listenCall.ended_at, 'hang-up recorded');
    const one = await get(`/admin/phone-activity/${listenCall.id}`);
    assert.deepEqual(one.events.map((e) => e.in), [null, '2', '1', '0630']);
    assert.match(one.events[0].say, /^שלום וברוכים הבאים/);
    assert.match(one.events[3].say, /שחרית בשעה 6 וחצי בבית כנסת אהל משה/);
    assert.equal(one.events[3].screen, 'time');
    const blocked = a.calls.find((c) => c.line === 'manage');
    assert.equal(blocked.outcome, 'blocked');
    assert.equal((await get('/admin/phone-activity?line=listen&days=30')).calls.length, 1);
  });

  test('the same time in several synagogues is one sentence; recordings play instead of text where uploaded', async () => {
    env.FIXED_NOW = at(findDay(false), '05:00');
    await q(`INSERT INTO synagogues (name, area_id) VALUES ('ישיבת מיר', 1)`).run();
    await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, time, days, season_id) VALUES (2, 1, 'fixed', '06:30', 127, 1), (3, 1, 'fixed', '06:30', 127, 1)`).run();
    let call = listen();
    await call.start();
    await call.press('0'); // all areas
    let body = await call.press('1'); // שחרית
    body = await call.press('00');
    assert.match(body, /t-שחרית בשעה 6 וחצי בבית כנסת אהל משה ובבית כנסת זכרון משה ובישיבת מיר\.t-שחרית בשעה 7 בבית כנסת זכרון משה/);

    // recorded: the welcome, the prayer name, "בשעה", the hour and "וחצי", one synagogue — the rest stays text
    const rec = (key, path) => q(`INSERT INTO recordings (key, path) VALUES (?, ?)`, key, path).run();
    await rec('sys:welcome', '/zmanim_rec/system/welcome');
    await rec('prayer:1', '/zmanim_rec/system/prayer1');
    await rec('sys:at', '/zmanim_rec/system/at');
    await rec('hour:6', '/zmanim_rec/system/hour6');
    await rec('min:30', '/zmanim_rec/system/min30');
    await rec('syn:1', '/zmanim_rec/synagogues/1');
    call = listen();
    body = await call.start();
    assert.match(body, /^id_list_message=f-\/zmanim_rec\/system\/welcome&read=/);
    await call.press('0');
    body = await call.press('1');
    body = await call.press('00');
    assert.match(body, /f-\/zmanim_rec\/system\/prayer1\.f-\/zmanim_rec\/system\/at\.f-\/zmanim_rec\/system\/hour6\.f-\/zmanim_rec\/system\/min30\.t-בבית כנסת\.f-\/zmanim_rec\/synagogues\/1\.t-ובבית כנסת זכרון משה ובישיבת מיר\.f-\/zmanim_rec\/system\/prayer1\.f-\/zmanim_rec\/system\/at\.t-7 בבית כנסת זכרון משה&/);
    assert.match(body, /read=t-בחירת תפילה\.t-לכל המניינים הקרובים הקישו 0\.f-\/zmanim_rec\/system\/prayer1\.t-הקישו 1\.t-למנחה הקישו 2/, 'menu: recorded name, then "press 1"');
    // one recording paused: that word is read as text again, the others still play
    await q(`UPDATE recordings SET paused = 1 WHERE key = 'hour:6'`).run();
    call = listen();
    await call.start();
    await call.press('0');
    await call.press('1');
    body = await call.press('00');
    assert.match(body, /f-\/zmanim_rec\/system\/at\.t-6\.f-\/zmanim_rec\/system\/min30/);
    // switched off in the settings: text only again
    await q(`INSERT INTO settings (key, value) VALUES ('recordings_enabled', '0')`).run();
    assert.match(await listen().start(), /^id_list_message=t-שלום וברוכים הבאים/);
  });

  test('area, prayer, from a time: short sentences, today only', async () => {
    env.FIXED_NOW = at(findDay(false), '05:00');
    await q(`INSERT INTO locations (synagogue_id, name) VALUES (1, 'עזרת נשים')`).run();
    await q(`UPDATE minyanim SET location_id = 1 WHERE id = 1`).run();
    const call = listen();
    let body = await call.start();
    assert.match(body, /^id_list_message=t-שלום וברוכים הבאים למערכת זמני התפילות&read=t-בחירת אזור\.t-לכל האזורים הקישו 0\.t-לגבעת שאול הקישו 1\.t-לרמות הקישו 2/);
    body = await call.press('2'); // רמות
    assert.match(body, /לשחרית הקישו 1/);
    assert.match(body, /לכל המניינים הקרובים הקישו 0/);
    body = await call.press('1'); // שחרית
    assert.match(body, /t-הקישו שעה וסולמית\.t-אפשר להקיש גם דקות, אבל לא חובה/);
    assert.doesNotMatch(body, /בחירת יום|ליום/); // no day question
    assert.match(body, /לכל המניינים של היום מההתחלה הקישו 0 0 וסולמית/);
    body = await call.press('0630');
    assert.match(body, /t-שחרית בשעה 6 וחצי בבית כנסת אהל משה בעזרת נשים&/);
    assert.doesNotMatch(body, /זכרון משה/); // other area
    assert.doesNotMatch(body, /בשעה 8 /); // Shabbat-only minyan
    assert.match(body, /read=t-בחירת תפילה/); // back to the menu, no hang-up
    body = await call.press('1');
    body = await call.press('7'); // hour only
    assert.match(body, /t-שחרית בשעה 7 בבית כנסת זכרון משה|אין מניינים מהשעה 7/);
    body = await call.press('1');
    body = await call.press('0631');
    assert.match(body, /אין מניינים מהשעה 6 31/);
  });

  test('0 = everything soon; Rosh Chodesh time only on Rosh Chodesh; relative minyanim said as set, placed by today\'s sunset', async () => {
    await q(`UPDATE minyanim SET rosh_chodesh_time = '06:15' WHERE id = 1`).run();
    const plain = findDay(false);
    env.FIXED_NOW = at(plain, '06:20');
    const mincha = relativeClock({ anchor_id: 2, offset_minutes: -15 }, { 2: zmanTime(plain, 'sunset', { lat: 31.778, lng: 35.235 }) });
    let call = listen();
    await call.start();
    await call.press('0'); // all areas
    let body = await call.press('0'); // all prayers, from now
    assert.ok(mincha > '07:00');
    assert.ok(body.includes('t-שחרית בשעה 6 וחצי בבית כנסת אהל משה.t-שחרית בשעה 7 בבית כנסת זכרון משה.t-מנחה 15 דקות לפני שקיעה בבית כנסת אהל משה'), body); // said as set, placed by today's sunset
    assert.doesNotMatch(body, /ראש חודש|6 ורבע/);

    env.FIXED_NOW = at(findDay(true), '06:10');
    call = listen();
    await call.start();
    await call.press('0');
    body = await call.press('0');
    assert.match(body, /t-היום ראש חודש\.t-שחרית בשעה 6 ורבע בבית כנסת אהל משה\.t-שחרית בשעה 7/);
    assert.doesNotMatch(body, /6 וחצי/);
  });

  test('00 = the whole day; a time filters computed minyanim too; uncomputed anchors come last', async () => {
    const day = findDay(false);
    env.FIXED_NOW = at(day, '12:00');
    await q(`INSERT INTO anchors (name) VALUES ('סוף זמן קריאת שמע')`).run();
    await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, anchor_id, offset_minutes, days, season_id) VALUES (1, 1, 'relative', 4, -30, 127, 1)`).run();
    let call = listen();
    await call.start();
    await call.press('0');
    await call.press('1'); // שחרית
    let body = await call.press('00');
    assert.match(body, /t-שחרית בשעה 6 וחצי בבית כנסת אהל משה\.t-שחרית בשעה 7 בבית כנסת זכרון משה\.t-שחרית 30 דקות לפני סוף זמן קריאת שמע בבית כנסת אהל משה/);
    await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, time, days, season_id) VALUES (2, 2, 'fixed', '13:30', 127, 1), (2, 2, 'fixed', '19:30', 127, 1)`).run();
    await call.press('2'); // מנחה
    body = await call.press('00');
    assert.match(body, /t-מנחה בשעה 13 וחצי בבית כנסת זכרון משה\.t-מנחה 15 דקות לפני שקיעה בבית כנסת אהל משה\.t-מנחה בשעה 19 וחצי בבית כנסת זכרון משה/, 'ordered by today\'s sunset');
    await call.press('2');
    body = await call.press('19');
    assert.match(body, /t-מנחה בשעה 19 וחצי בבית כנסת זכרון משה/);
    assert.doesNotMatch(body, /לפני שקיעה/, 'mincha before sunset is earlier than 19:00');
  });

  test('long lists are read in pages', async () => {
    env.FIXED_NOW = at(findDay(false), '05:00');
    for (let i = 0; i < 10; i++) await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, time, days, season_id) VALUES (2, 1, 'fixed', ?, 127, 1)`).bind(`09:${String(i * 5).padStart(2, '0')}`).run();
    const call = listen();
    await call.start();
    await call.press('0');
    let body = await call.press('0');
    assert.match(body, /להמשך הקישו 1/);
    body = await call.press('1');
    assert.match(body, /בשעה 9 45/);
  });

  test('* on the first menu says nothing and reads the menu again (no "goodbye", no empty answer)', async () => {
    const call = listen();
    await call.start();
    const body = await call.press('*');
    assert.match(body, /^read=t-בחירת אזור/);
    assert.doesNotMatch(body, /להתראות/);
  });

  test('the line can be closed', async () => {
    await q(`INSERT INTO settings (key, value) VALUES ('listen_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = '0'`).run();
    assert.equal(await listen('0502222222').start(), 'id_list_message=t-קו השמיעה אינו פעיל כרגע&');
  });
});
