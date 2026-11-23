import assert from 'node:assert/strict';
import test from 'node:test';
import { handle } from '../src/index.js';
import { handleIvr, speakMinutes } from '../src/ivr.js';
import { parsePer, windowStart } from '../src/period.js';
import { D1Shim } from './d1-shim.mjs';
import { setPassword } from '../src/auth.js';
import { DEFAULTS, saveConfig } from '../src/config.js';
import { listName } from '../src/data.js';

const fresh = () => ({ DB: new D1Shim() });
const PHONE = '0501234567';

async function keyOf(env) {
  await handle(new Request('http://x/ivr-minutes/api/status'), env, '/api/status');
  await setPassword(env, 'secret');
  return env.DB.db.prepare(`SELECT value FROM minutes_settings WHERE key = 'ivr_key'`).get()?.value
    ?? (await (await import('../src/data.js')).getKey(env));
}

/**
 * One call: each step sends all values so far, like Yemot does. The settings `q` (max, times, per, edit,
 * show_max, say) are saved to the database first, as the admin page does; the request carries only the key.
 */
function caller(env, key, mode, q, { phone = PHONE, callId = 'call-' + Math.random(), now } = {}) {
  const vals = {};
  const { list, ...cfg } = q;
  const config = {
    ...DEFAULTS,
    ...(cfg.max ? { max: Number(cfg.max) } : {}), ...(cfg.times ? { times: Number(cfg.times) } : {}), ...(cfg.per ? { per: cfg.per } : {}),
    ...(cfg.edit === 'no' ? { edit: false } : {}), ...(cfg.show_max === 'no' ? { showMax: false } : {}), ...(cfg.say ? { say: cfg.say } : {}),
  };
  return async (name, value) => {
    if (name) vals[name] = value;
    await saveConfig(env, listName(list), config);
    const p = new URLSearchParams({ key, ApiPhone: phone, ApiCallId: callId, ...(list ? { list } : {}), ...vals });
    return (await handleIvr(new Request('http://x/add?' + p), env, mode, now)).text();
  };
}

test('speaking minutes', () => {
  assert.equal(speakMinutes(1), 'דקה אחת');
  assert.equal(speakMinutes(45), '45 דקות');
  assert.equal(speakMinutes(135), '135 דקות');
  assert.equal(speakMinutes(55228), '55228 דקות');
});

test('windows', () => {
  const now = Date.parse('2026-11-25T10:00:00Z'); // Wednesday, 12:00 in Israel
  assert.equal(windowStart(parsePer('day'), now), Date.parse('2026-11-24T22:00:00Z') / 1000);
  assert.equal(windowStart(parsePer('week'), now), Date.parse('2026-11-21T22:00:00Z') / 1000);
  assert.equal(windowStart(parsePer('month'), now), Date.parse('2026-10-31T22:00:00Z') / 1000);
  assert.equal(windowStart(parsePer('12h'), now), now / 1000 - 12 * 3600);
  assert.equal(windowStart(parsePer('ever'), now), 0);
  assert.deepEqual(parsePer('nonsense'), { kind: 'week' });
  // summer time: midnight is 21:00 UTC
  assert.equal(windowStart(parsePer('day'), Date.parse('2026-07-01T10:00:00Z')), Date.parse('2026-06-30T21:00:00Z') / 1000);
});

test('blocked without the key, and for hidden numbers', async () => {
  const env = fresh();
  const key = await keyOf(env);
  assert.match(await caller(env, 'wrong', 'add', {})(), /הגישה לשלוחה זו חסומה/);
  assert.match(await caller(env, key, 'add', {}, { phone: '' })(), /לא זוהה מספר הטלפון/);
  assert.equal(await (await handleIvr(new Request('http://x/add?hangup=yes'), env, 'add')).text(), '');
});

test('add, limit per day, change the last update, total line', async () => {
  const env = fresh();
  const key = await keyOf(env);
  const q = { max: '120', times: '1', per: 'day' };

  let call = caller(env, key, 'add', q);
  let r = await call();
  assert.match(r, /^read=t-הקישי את מספר הדקות של תוספת שבת שאת מקבלת על עצמך עד 120 ובסיום הקישי סולמית=a1,no,3,1,10,Number,/);
  r = await call('a1', '500'); // over the max -> asked again under a new name
  assert.match(r, /ניתן להקיש בין 1 ל 120 דקות.*=a2,/);
  r = await call('a2', '30');
  assert.equal(r, 'id_list_message=t-נרשמה תוספת של 30 דקות.t-סך הכל קיבלת על עצמך תוספת שבת של 30 דקות&');
  assert.equal(await call('a2', '30'), r, 'a repeated request does not add twice');

  // without saying the maximum
  assert.match(await caller(env, key, 'add', { ...q, show_max: 'no' }, { phone: '0538888888' })(), /^read=t-הקישי את מספר הדקות של תוספת שבת שאת מקבלת על עצמך ובסיום הקישי סולמית=a1,/);
  // second call the same day: blocked, offered to change
  call = caller(env, key, 'add', q);
  r = await call();
  assert.match(r, /כבר עדכנת היום תוספת של 30 דקות.*לשינוי העדכון הקישי 1.*=c1,no,1,1,10,No,/);
  r = await call('c1', '1');
  const val = /=(e\d+_1),/.exec(r)[1];
  r = await call(val, '45');
  assert.equal(r, 'id_list_message=t-העדכון שונה לתוספת של 45 דקות.t-סך הכל קיבלת על עצמך תוספת שבת של 45 דקות&');

  // total line
  const other = caller(env, key, 'add', q, { phone: '0529999999' });
  await other(); await other('a1', '15');
  // default: only everyone's total (even from a hidden number)
  assert.equal(await caller(env, key, 'total', {})(), 'id_list_message=t-עד כה קיבלו על עצמן כל המשתתפות תוספת שבת של 60 דקות&');
  assert.equal(await caller(env, key, 'total', {}, { phone: '' })(), 'id_list_message=t-עד כה קיבלו על עצמן כל המשתתפות תוספת שבת של 60 דקות&');
  assert.equal(await caller(env, key, 'total', { say: 'mine' })(), 'id_list_message=t-עד כה קיבלת על עצמך תוספת שבת של 45 דקות&');
  assert.equal(await caller(env, key, 'total', { say: 'both' })(), 'id_list_message=t-עד כה קיבלו על עצמן כל המשתתפות תוספת שבת של 60 דקות.t-ואת קיבלת על עצמך תוספת שבת של 45 דקות&');
  assert.equal(await caller(env, key, 'total', { say: 'both' }, { phone: '0531111111' })(), 'id_list_message=t-עד כה קיבלו על עצמן כל המשתתפות תוספת שבת של 60 דקות.t-ואת עדיין לא קיבלת על עצמך תוספת שבת&');
  assert.equal(await caller(env, key, 'total', { say: 'mine' }, { phone: '0531111111' })(), 'id_list_message=t-עדיין לא קיבלת על עצמך תוספת שבת&');
  assert.match(await caller(env, key, 'total', { say: 'mine' }, { phone: '' })(), /לא זוהה מספר הטלפון/);

  // cancel with 0
  call = caller(env, key, 'add', q);
  await call(); r = await call('c1', '1');
  r = await call(/=(e\d+_1),/.exec(r)[1], '0');
  assert.equal(r, 'id_list_message=t-העדכון בוטל.t-עדיין לא קיבלת על עצמך תוספת שבת&');

  // and now adding is open again
  assert.match(await caller(env, key, 'add', q)(), /=a1,/);
});

test('edit=no, several times per window, separate lists, next day opens again', async () => {
  const env = fresh();
  const key = await keyOf(env);
  const day1 = Date.parse('2026-11-25T08:00:00Z');
  const q = { max: '60', times: '2', per: 'day', edit: 'no' };
  for (const m of ['10', '20']) {
    const c = caller(env, key, 'add', q, { now: day1 });
    await c(); await c('a1', m);
  }
  // entries are stamped with the real clock; move them back to day1
  env.DB.db.exec(`UPDATE minutes_entries SET created_at = ${day1 / 1000}`);
  assert.equal(await caller(env, key, 'add', q, { now: day1 })(), 'id_list_message=t-כבר עדכנת היום 2 פעמים בעדכון האחרון 20 דקות.t-סך הכל קיבלת על עצמך תוספת שבת של 30 דקות&');
  assert.match(await caller(env, key, 'add', q, { now: day1 + 86400000 })(), /=a1,/);
  assert.match(await caller(env, key, 'add', { ...q, list: 'other' }, { now: day1 })(), /^read=t-הקישי/);
});

test('admin API: login, people, edit, log, export', async () => {
  const env = fresh();
  const key = await keyOf(env);
  const c = caller(env, key, 'add', {}); await c(); await c('a1', '25');

  const call = async (method, path, body, token) => {
    const res = await handle(new Request('http://x/ivr-minutes' + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, path.split('?')[0]);
    return { status: res.status, data: res.headers.get('Content-Type').includes('json') ? await res.json() : await res.text() };
  };
  assert.equal((await call('GET', '/api/people')).status, 401);
  const status = await call('GET', '/api/status');
  assert.equal(status.data.configured, true);
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  let { data: { token } } = await call('POST', '/api/login', { password: 'secret' });
  assert.ok(token);

  let r = await call('GET', '/api/people?list=main', null, token);
  assert.deepEqual(r.data.map((p) => [p.phone, p.minutes]), [[PHONE, 25]]);
  await call('POST', '/api/entries', { list: 'main', phone: '050-123-4567', minutes: -5, note: 'תיקון' }, token);
  await call('PUT', '/api/people/' + PHONE, { list: 'main', name: 'משה' }, token);
  r = await call('GET', '/api/people/' + PHONE + '?list=main', null, token);
  assert.equal(r.data.minutes, 20);
  assert.equal(r.data.name, 'משה');
  const id = r.data.entries.find((e) => e.source === 'phone').id;
  await call('PATCH', '/api/entries/' + id, { minutes: 40 }, token);
  r = await call('GET', '/api/summary?list=main', null, token);
  assert.equal(r.data.minutes, 35);
  r = await call('GET', '/api/log?list=main', null, token);
  assert.deepEqual(r.data.map((l) => l.action), ['edit', 'add', 'add']);
  r = await call('GET', '/api/export?list=main', null, token);
  assert.match(r.data, /0501234567,משה,35,2,/);
  // password change: wrong current refused; afterwards the old token and password stop working
  assert.equal((await call('POST', '/api/password', { current: 'bad', next: '9999' }, token)).status, 401);
  const { data: { token: t2 } } = await call('POST', '/api/password', { current: 'secret', next: '9999' }, token);
  assert.equal((await call('GET', '/api/lists', null, token)).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'secret' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: '9999' })).status, 200);
  token = t2;
  r = await call('GET', '/api/settings', null, token);
  assert.equal(r.data.key, key);
  r = await call('POST', '/api/settings/rotate-key', null, token);
  assert.notEqual(r.data.key, key);

  const page = await handle(new Request('http://x/ivr-minutes/'), env, '/');
  assert.match(await page.text(), /<title>תוספת שבת<\/title>/);
  assert.equal((await handle(new Request('http://x/zmanim/ivr-minutes'), env, '')).headers.get('Location'), 'http://x/zmanim/ivr-minutes/');
});

test('recordings: upload to Yemot, played instead of text, paused by the error webhook', async () => {
  const env = fresh();
  const key = await keyOf(env);
  const { data: { token } } = await (async () => {
    const r = await handle(new Request('http://x/zmanim/ivr-minutes/api/login', { method: 'POST', body: JSON.stringify({ password: 'secret' }) }), env, '/api/login');
    return { data: await r.json() };
  })();
  const req = (method, path, body, isForm) => handle(new Request('http://x/zmanim/ivr-minutes' + path, {
    method, headers: { Authorization: 'Bearer ' + token, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: isForm ? body : body ? JSON.stringify(body) : undefined,
  }), env, path);

  // no token yet: upload refused
  const form = () => { const f = new FormData(); f.append('file', new Blob([new Uint8Array(100)], { type: 'audio/webm' }), 'a.webm'); return f; };
  assert.equal((await req('POST', '/api/recordings/so_far', form(), true)).status, 409);

  await req('PATCH', '/api/recordings/settings', { token: '0771234567:1234' });
  let list = await (await req('GET', '/api/recordings')).json();
  assert.equal(list.settings.has_token, true);
  assert.ok(!JSON.stringify(list).includes('0771234567:1234'), 'the token is never sent back');
  assert.equal(list.webhook, 'http://x/zmanim/ivr-minutes/file-error/' + key);
  assert.equal((await req('PATCH', '/api/recordings/settings', { folder: 'bad_folder' })).status, 400);

  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body });
    return new Response(JSON.stringify({ responseStatus: 'OK', path: 'ivr2:/minutesrec/sofar.wav' }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await req('POST', '/api/recordings/so_far', form(), true);
    assert.equal(r.status, 201);
    assert.equal(calls[0].url, 'https://www.call2all.co.il/ym/api/UploadFile');
    assert.equal(calls[0].body.get('path'), 'ivr2:/minutesrec/sofar.wav');
    assert.equal(calls[0].body.get('token'), '0771234567:1234');
  } finally { globalThis.fetch = realFetch; }

  // the line plays the recording, the rest stays text
  const c = caller(env, key, 'add', {}); await c(); await c('a1', '30');
  assert.equal(await caller(env, key, 'total', { say: 'mine' })(), 'id_list_message=f-/minutesrec/sofar.t-30 דקות&');
  // Yemot numbers
  await req('PATCH', '/api/recordings/settings', { yemot_numbers: true });
  assert.equal(await caller(env, key, 'total', { say: 'mine' })(), 'id_list_message=f-/minutesrec/sofar.n-30.t-דקות&');
  await req('PATCH', '/api/recordings/settings', { yemot_numbers: false });

  // Yemot reports the file failed: paused, back to text
  const hook = await handle(new Request('http://x/zmanim/ivr-minutes/file-error/' + key + '?FilePath=/minutesrec/sofar&Status=Error&Message=file%20audio%20not%20found'), env, '/file-error/' + key);
  assert.equal(hook.status, 200);
  assert.equal(await caller(env, key, 'total', { say: 'mine' })(), 'id_list_message=t-עד כה קיבלת על עצמך תוספת שבת של 30 דקות&');
  list = await (await req('GET', '/api/recordings')).json();
  const item = list.items.find((i) => i.key === 'so_far');
  assert.equal(item.paused, true);
  assert.match(item.error, /file audio not found/);
  assert.equal((await handle(new Request('http://x/file-error/wrong'), env, '/file-error/wrong')).status, 403);
  // resumed by hand
  await req('PATCH', '/api/recordings/so_far', { paused: false });
  assert.match(await caller(env, key, 'total', { say: 'mine' })(), /^id_list_message=f-/);
  // recordings switched off
  await req('PATCH', '/api/recordings/settings', { enabled: false });
  assert.equal(await caller(env, key, 'total', { say: 'mine' })(), 'id_list_message=t-עד כה קיבלת על עצמך תוספת שבת של 30 דקות&');
});


test('blocked numbers cannot add, can still hear; import from the Yemot log', async () => {
  const env = fresh();
  const key = await keyOf(env);
  const r = await handle(new Request('http://x/zmanim/ivr-minutes/api/login', { method: 'POST', body: JSON.stringify({ password: 'secret' }) }), env, '/api/login');
  const { token } = await r.json();
  const req = async (method, path, body) => {
    const res = await handle(new Request('http://x/zmanim/ivr-minutes' + path.split('?')[0] + (path.includes('?') ? '?' + path.split('?')[1] : ''), {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    }), env, path.split('?')[0]);
    return { status: res.status, data: await res.json() };
  };
  const row = (phone, date, time, amount) => ({ 'שלוחה': '9', 'טלפון': phone, 'תאריך': date, 'שעה': time, 'תרומה נוכחית': amount, 'סוג התשלום': 'מזומן' });
  const log = [
    row('0521110001', '11/12/2024', '11:18:04', '10'),
    row('0521110001', '20/04/2025', '15:34:33', '200'),          // over the max
    row('041110002', '22/11/2026', '13:17:19', '20'),            // a Sunday: counts as this week's update
    row('0501110003', '16/10/2026', '10:26:13', '99999999999999999999'),
    row('0501110003', '24/07/2025', '22:03:00', '5'),
    row('', '24/07/2025', '22:03:00', '5'),                      // invalid
    row('0521110001', '20/12/2024', '11:09:17', '30.'),          // "30." = 30
  ];
  // block the one who made a mess, then import
  let b = await req('POST', '/api/blocked', { phone: '0501110003', note: 'סכומים מטורפים' });
  assert.equal(b.status, 200);
  let res = await req('POST', '/api/import', { list: 'main', max: 120, rows: log });
  assert.deepEqual([res.data.added, res.data.over_max, res.data.blocked, res.data.invalid, res.data.minutes], [3, 1, 2, 1, 60]);
  assert.equal(res.data.over_max_rows[0].minutes, '200');
  // the time is kept: 11/12/2024 11:18:04 Israel = 09:18:04 UTC
  const e = env.DB.db.prepare(`SELECT * FROM minutes_entries WHERE phone = '0521110001'`).get();
  assert.equal(e.created_at, Date.parse('2024-12-11T09:18:04Z') / 1000);
  assert.equal(e.source, 'import');
  // only from a date
  const fromDate = await req('POST', '/api/import', { list: 'other', max: 120, since: '2025-01-01', rows: log });
  assert.equal(fromDate.data.before, 2); // the two rows of 20/12/2024 and 11/12/2024
  // importing again adds nothing
  res = await req('POST', '/api/import', { list: 'main', max: 120, rows: log });
  assert.deepEqual([res.data.added, res.data.already], [0, 3]);

  // the blocked number: cannot add, hears the total
  assert.equal(await caller(env, key, 'add', {}, { phone: '0501110003' })(), 'id_list_message=t-לא ניתן לעדכן ממספר טלפון זה&');
  assert.equal(await caller(env, key, 'total', {}, { phone: '0501110003' })(), 'id_list_message=t-עד כה קיבלו על עצמן כל המשתתפות תוספת שבת של 60 דקות&');
  // an imported update this week counts toward the weekly limit
  const sunday = Date.parse('2026-11-23T10:00:00Z');
  assert.match(await caller(env, key, 'add', {}, { phone: '041110002', now: sunday })(), /כבר עדכנת השבוע תוספת של 20 דקות/);

  // people list shows the block; unblock
  let people = await req('GET', '/api/people?list=main');
  assert.equal(people.data.find((p) => p.phone === '041110002').blocked, 0);
  b = await req('GET', '/api/blocked');
  assert.deepEqual(b.data.map((x) => x.phone), ['0501110003']);
  await req('DELETE', '/api/blocked/0501110003');
  assert.match(await caller(env, key, 'add', {}, { phone: '0501110003' })(), /^read=/);

  // block with deleting the minutes
  await req('POST', '/api/blocked', { phone: '0521110001', delete_entries: true });
  people = await req('GET', '/api/people?list=main');
  assert.ok(!people.data.some((p) => p.phone === '0521110001'));
});

test('manager: main list only, no token / passwords / key / deleting history; admin deletes history', async () => {
  const env = fresh();
  await keyOf(env);
  await setPassword(env, '7777777', 'manager');
  const call = async (method, path, b, token) => {
    const res = await handle(new Request('http://x/zmanim/ivr-minutes' + path, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
    }), env, path.split('?')[0]);
    return { status: res.status, data: res.headers.get('Content-Type').includes('json') ? await res.json() : await res.text() };
  };
  const admin = (await call('POST', '/api/login', { password: 'secret' })).data;
  const mgr = (await call('POST', '/api/login', { password: '7777777' })).data;
  assert.equal(admin.role, 'admin');
  assert.equal(mgr.role, 'manager');
  assert.equal((await call('GET', '/api/me', null, mgr.token)).data.role, 'manager');

  // the admin adds to another list; the manager cannot see it, and her additions go to main
  await call('POST', '/api/entries', { list: 'other', phone: '0521110001', minutes: 50 }, admin.token);
  await call('POST', '/api/entries', { list: 'main', phone: '0521110002', minutes: 20 }, admin.token);
  await call('POST', '/api/entries', { list: 'other', phone: '0521110003', minutes: 7 }, mgr.token);
  assert.deepEqual((await call('GET', '/api/lists', null, mgr.token)).data.map((l) => l.list), ['main']);
  assert.deepEqual((await call('GET', '/api/lists', null, admin.token)).data.map((l) => l.list), ['main', 'other']);
  assert.equal((await call('GET', '/api/summary?list=other', null, mgr.token)).data.minutes, 27); // forced to main
  const otherEntry = env.DB.db.prepare(`SELECT id FROM minutes_entries WHERE list = 'other'`).get();
  assert.equal((await call('DELETE', '/api/entries/' + otherEntry.id, null, mgr.token)).status, 404);

  // forbidden for the manager
  for (const [m, p, b] of [['POST', '/api/password', { current: '7777777', next: '12345' }], ['PATCH', '/api/recordings/settings', { token: 'x' }],
    ['POST', '/api/recordings/test'], ['POST', '/api/settings/rotate-key'], ['DELETE', '/api/log?scope=all'], ['POST', '/api/manager-password', { code: '1234' }],
    ['DELETE', '/api/lists/main', { confirm: 'main' }]]) {
    assert.equal((await call(m, p, b, mgr.token)).status, 403, `${m} ${p}`);
  }
  await call('PATCH', '/api/recordings/settings', { token: '0771234567:1234' }, admin.token);
  const recs = (await call('GET', '/api/recordings', null, mgr.token)).data;
  assert.deepEqual(recs.settings, { has_token: true, enabled: true });

  // history says who did what; the admin deletes their own or everything
  let log = (await call('GET', '/api/log?list=main', null, mgr.token)).data;
  assert.deepEqual(log.map((l) => l.by), ['manager', 'admin']);
  assert.deepEqual((await call('GET', '/api/log?list=main&by=manager', null, mgr.token)).data.length, 1);
  assert.equal((await call('DELETE', '/api/log?list=main&scope=mine', null, admin.token)).data.deleted, 1);
  log = (await call('GET', '/api/log?list=main', null, admin.token)).data;
  assert.deepEqual(log.map((l) => l.by), ['manager']);
  assert.equal((await call('DELETE', '/api/log?list=main&scope=all', null, admin.token)).data.deleted, 1);
  assert.equal((await call('GET', '/api/log?list=other', null, admin.token)).data.length, 1, 'other lists are untouched');

  // a new manager password logs her out; the admin password cannot be reused for her
  assert.equal((await call('POST', '/api/manager-password', { code: 'secret' }, admin.token)).status, 400);
  await call('POST', '/api/manager-password', { code: '8888888' }, admin.token);
  assert.equal((await call('GET', '/api/me', null, mgr.token)).status, 401);
  assert.equal((await call('POST', '/api/login', { password: '8888888' })).data.role, 'manager');
});

test('reset: the count starts over without deleting; past periods stay; undo', async () => {
  const env = fresh();
  const key = await keyOf(env);
  await setPassword(env, '7777777', 'manager');
  const call = async (method, path, b, token) => {
    const res = await handle(new Request('http://x/zmanim/ivr-minutes' + path, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
    }), env, path.split('?')[0]);
    return { status: res.status, data: await res.json() };
  };
  const mgr = (await call('POST', '/api/login', { password: '7777777' })).data.token;
  const c1 = caller(env, key, 'add', {}); await c1(); await c1('a1', '30');
  // entries are stamped with the real clock; move them back a minute so the reset comes after them
  env.DB.db.exec(`UPDATE minutes_entries SET created_at = created_at - 60`);
  assert.match(await caller(env, key, 'add', {})(), /כבר עדכנת השבוע/);

  const r = await call('POST', '/api/reset', { note: 'שבת חדשה' }, mgr);
  assert.deepEqual(r.data.closed, { minutes: 30, phones: 1 });
  // the phone: zero again, and the weekly limit is open
  assert.equal(await caller(env, key, 'total', {})(), 'id_list_message=t-עד כה קיבלו על עצמן כל המשתתפות תוספת שבת של 0 דקות&');
  assert.equal(await caller(env, key, 'total', { say: 'mine' })(), 'id_list_message=t-עדיין לא קיבלת על עצמך תוספת שבת&');
  assert.match(await caller(env, key, 'add', {})(), /=a1,/);
  // the page: current period empty, the closed one and "all" still have it
  const periods = (await call('GET', '/api/periods?list=main', null, mgr)).data;
  assert.equal(periods.past.length, 1);
  assert.equal(periods.past[0].minutes, 30);
  assert.equal(periods.past[0].note, 'שבת חדשה');
  assert.equal((await call('GET', '/api/summary?list=main', null, mgr)).data.minutes, 0);
  assert.equal((await call('GET', '/api/summary?list=main&period=all', null, mgr)).data.minutes, 30);
  assert.equal((await call('GET', '/api/summary?list=main&period=' + periods.past[0].id, null, mgr)).data.minutes, 30);
  assert.equal((await call('GET', '/api/people?list=main&period=' + periods.past[0].id, null, mgr)).data[0].minutes, 30);
  assert.equal(env.DB.db.prepare(`SELECT COUNT(*) AS n FROM minutes_entries`).get().n, 1, 'nothing deleted');
  // undo: back as it was
  await call('DELETE', '/api/reset?list=main', null, mgr);
  assert.equal((await call('GET', '/api/summary?list=main', null, mgr)).data.minutes, 30);
  assert.equal((await call('DELETE', '/api/reset?list=main', null, mgr)).status, 404);
  const log = (await call('GET', '/api/log?list=main', null, mgr)).data.map((l) => l.action);
  assert.deepEqual(log.slice(0, 2), ['unreset', 'reset']);
});

test('settings live in the database: parameters in the extension are ignored; both roles edit them', async () => {
  const env = fresh();
  const key = await keyOf(env);
  await setPassword(env, '7777777', 'manager');
  const call = async (method, path, b, token) => {
    const res = await handle(new Request('http://x/zmanim/ivr-minutes' + path, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
    }), env, path.split('?')[0]);
    return { status: res.status, data: await res.json() };
  };
  const raw = async (mode, extra) => (await handleIvr(new Request('http://x/?' + new URLSearchParams({ key, ApiPhone: PHONE, ApiCallId: 'c' + Math.random(), ...extra })), env, mode)).text();
  const mgr = (await call('POST', '/api/login', { password: '7777777' })).data.token;

  assert.deepEqual((await call('GET', '/api/config?list=main', null, mgr)).data, DEFAULTS);
  const saved = (await call('PUT', '/api/config', { list: 'other', max: 30, times: 2, per: 'day', edit: false, showMax: false, say: 'both' }, mgr)).data;
  assert.deepEqual(saved, { max: 30, times: 2, per: 'day', edit: false, showMax: false, say: 'both' }); // the manager's list is always main
  assert.deepEqual((await call('GET', '/api/config?list=main', null, mgr)).data, saved);
  // invalid values change nothing
  assert.equal((await call('PUT', '/api/config', { per: 'nonsense', max: -5 }, mgr)).data.per, 'day');
  assert.equal((await call('PUT', '/api/config', { per: '12h' }, mgr)).data.per, '12h');
  await call('PUT', '/api/config', { per: 'day' }, mgr);

  // parameters sent by the extension change nothing
  assert.match(await raw('add', { max: '500', show_max: 'yes' }), /^read=t-הקישי את מספר הדקות של תוספת שבת שאת מקבלת על עצמך ובסיום הקישי סולמית=a1,no,2,/);
  assert.match(await raw('total', { say: 'all' }), /ואת עדיין לא קיבלת/);
  await call('PUT', '/api/config', { showMax: true }, mgr);
  assert.match(await raw('add', {}), /עד 30 ובסיום/);
});
