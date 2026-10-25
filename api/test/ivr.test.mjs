import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
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
  await q(`INSERT INTO users (name, phone, role) VALUES ('מנהל על', '0583206823', 'admin')`).run();
});

describe('ivr access', () => {
  test('wrong key and unknown phone are rejected with valid Yemot text', async () => {
    let body = await yemotCall('0583206823', { key: 'bad' }).start();
    assert.match(body, /^id_list_message=t-.+&go_to_folder=hangup$/);
    body = await yemotCall('0500000000').start();
    assert.match(body, /אינו מורשה/);
    assert.match(body, /go_to_folder=hangup$/);
  });

  test('admin gets the main menu; read syntax is well formed; hangup clears state', async () => {
    const call = yemotCall('+972583206823');
    const body = await call.start();
    assert.match(body, /^id_list_message=t-שלום מנהל על&read=t-תפריט ראשי\.t-לכניסה/);
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
    assert.match(body, /go_to_folder=hangup$/);
  });

  test('text never contains Yemot reserved characters', async () => {
    await q(`INSERT INTO synagogues (name) VALUES ('בית "אהל" משה - רמות.')`).run();
    const call = yemotCall('0583206823');
    await call.start();
    const body = await call.press('2'); // list synagogues
    const messages = body.split('&').map((part) => part.replace(/^(id_list_message|read)=/, '').split('=')[0]);
    for (const msg of messages) for (const piece of msg.split('.')) assert.doesNotMatch(piece.slice(2), /["'&|=\-]/);
  });
});

describe('ivr management', () => {
  test('admin: create synagogue by voice, add manager by phone, manager adds minyanim', async () => {
    const admin = yemotCall('0583206823');
    await admin.start();
    let body = await admin.press('3'); // new synagogue
    assert.match(body, /,voice,he-IL/);
    body = await admin.press('אהל משה');
    assert.match(body, /שם בית הכנסת: אהל משה/);
    body = await admin.press('1');
    assert.match(body, /בית הכנסת נוצר, מספרו 1/);
    body = await admin.press('6'); // managers
    assert.match(body, /אין מנהלים/);
    body = await admin.press('1');
    body = await admin.press('0521112233');
    assert.match(body, /המנהל נוסף/);
    const mgr = await q(`SELECT * FROM users WHERE phone = '0521112233'`).first();
    assert.equal(mgr.role, 'manager');

    // the manager calls: goes straight into the synagogue
    const m = yemotCall('052-111-2233');
    body = await m.start();
    assert.match(body, /read=t-אהל משה\./);
    assert.doesNotMatch(body, /הגדרות בית הכנסת/); // admin-only option hidden

    // add: shacharit 06:30, every day, (no locations), all year
    await m.press('2');
    body = await m.press('1'); // prayer 1 = shacharit
    assert.match(body, /סוג הזמן/);
    await m.press('1'); // fixed
    body = await m.press('0630');
    assert.match(body, /באילו ימים/);
    body = await m.press('1'); // every day -> seasons
    assert.match(body, /בחירת עונה/);
    body = await m.press('0');
    assert.match(body, /המניין: שחרית, בשעה 6 30, כל יום/);
    body = await m.press('1');
    assert.match(body, /המניין נשמר/);

    // add: mincha 15 minutes before sunset, Sun-Thu
    await m.press('2');
    await m.press('2'); // mincha
    await m.press('2'); // relative
    await m.press('2'); // anchor 2 = sunset
    await m.press('15');
    await m.press('1'); // before
    await m.press('2'); // Sun-Thu
    body = await m.press('0'); // all year
    assert.match(body, /15 דקות לפני שקיעה, ראשון עד חמישי/);
    await m.press('1');

    const rows = await q(`SELECT * FROM minyanim ORDER BY id`).all();
    assert.equal(rows.results.length, 2);
    assert.deepEqual(
      rows.results.map((r) => [r.time_kind, r.time, r.anchor_id, r.offset_minutes, r.days]),
      [['fixed', '06:30', null, null, 127], ['relative', null, 2, -15, 31]]
    );

    // listen
    body = await m.press('1');
    assert.match(body, /מניין 1, שחרית, בשעה 6 30, כל יום/);
    assert.match(body, /מניין 2, מנחה, 15 דקות לפני שקיעה/);
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
    await q(`INSERT INTO minyanim (synagogue_id, prayer_id, time_kind, time) VALUES (1, 1, 'fixed', '07:00')`).run();
    const call = yemotCall('0583206823');
    await call.start();
    await call.press('1');
    await call.press('1');
    await call.press('3'); // edit
    let body = await call.press('1'); // minyan #1
    assert.match(body, /שחרית, בשעה 7 בדיוק/);
    body = await call.press('4'); // hide
    assert.match(body, /הוסתר/);
    assert.equal((await q(`SELECT is_active FROM minyanim`).first()).is_active, 0);
    await call.press('1'); // change time
    await call.press('1'); // fixed
    body = await call.press('0745');
    assert.match(body, /בשעה 7 45/);
    await call.press('1');
    assert.equal((await q(`SELECT time FROM minyanim`).first()).time, '07:45');
    await call.press('3');
    await call.press('1');
    body = await call.press('5'); // duplicate -> over quota
    assert.match(body, /הגעתם למכסה של 1 מניינים/);
    await call.press('3');
    await call.press('1');
    await call.press('6');
    body = await call.press('1');
    assert.match(body, /המניין נמחק/);
    assert.equal((await q(`SELECT COUNT(*) AS n FROM minyanim`).first()).n, 0);
  });

  test('PIN: set, then required on next call', async () => {
    const call = yemotCall('0583206823');
    await call.start();
    await call.press('5');
    await call.press('4321');
    let body = await call.press('4321');
    assert.match(body, /הקוד נשמר/);
    const next = yemotCall('0583206823');
    body = await next.start();
    assert.match(body, /^read=t-הקישו את הקוד האישי/);
    body = await next.press('1111');
    assert.match(body, /קוד שגוי/);
    body = await next.press('4321');
    assert.match(body, /שלום מנהל על/);
  });

  test('admins: add by phone, cannot remove self', async () => {
    const call = yemotCall('0583206823');
    await call.start();
    await call.press('4');
    await call.press('1');
    let body = await call.press('0547778899');
    assert.match(body, /מנהל המערכת נוסף/);
    assert.equal((await q(`SELECT role FROM users WHERE phone = '0547778899'`).first()).role, 'admin');
    await call.press('2');
    body = await call.press('1'); // #1 is self
    assert.match(body, /לא ניתן להסיר את עצמך/);
  });
});
