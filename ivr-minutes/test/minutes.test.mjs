import assert from 'node:assert/strict';
import test from 'node:test';
import { handle } from '../src/index.js';
import { handleIvr, speakMinutes } from '../src/ivr.js';
import { parsePer, windowStart } from '../src/period.js';
import { D1Shim } from './d1-shim.mjs';

const fresh = () => ({ DB: new D1Shim(), MINUTES_PASSWORD: 'secret' });
const PHONE = '0501234567';

async function keyOf(env) {
  await handle(new Request('http://x/ivr-minutes/api/status'), env, '/api/status');
  return env.DB.db.prepare(`SELECT value FROM minutes_settings WHERE key = 'ivr_key'`).get()?.value
    ?? (await (await import('../src/data.js')).getKey(env));
}

/** One call: each step sends all values so far, like Yemot does. */
function caller(env, key, mode, q, { phone = PHONE, callId = 'call-' + Math.random(), now } = {}) {
  const vals = {};
  return async (name, value) => {
    if (name) vals[name] = value;
    const p = new URLSearchParams({ key, ApiPhone: phone, ApiCallId: callId, ...q, ...vals });
    return (await handleIvr(new Request('http://x/add?' + p), env, mode, now)).text();
  };
}

test('speaking minutes', () => {
  assert.equal(speakMinutes(1), 'דקה אחת');
  assert.equal(speakMinutes(45), '45 דקות');
  assert.equal(speakMinutes(135), '135 דקות');
  assert.equal(speakMinutes(135, true), 'שעתיים ו 15 דקות');
  assert.equal(speakMinutes(61, true), 'שעה אחת ו דקה אחת');
  assert.equal(speakMinutes(120, true), 'שעתיים');
});

test('windows', () => {
  const now = Date.parse('2026-11-25T10:00:00Z'); // Wednesday, 12:00 in Israel
  assert.equal(windowStart(parsePer('day'), now), Date.parse('2026-11-24T22:00:00Z') / 1000);
  assert.equal(windowStart(parsePer('week'), now), Date.parse('2026-11-21T22:00:00Z') / 1000);
  assert.equal(windowStart(parsePer('month'), now), Date.parse('2026-10-31T22:00:00Z') / 1000);
  assert.equal(windowStart(parsePer('12h'), now), now / 1000 - 12 * 3600);
  assert.equal(windowStart(parsePer('ever'), now), 0);
  assert.deepEqual(parsePer('nonsense'), { kind: 'day' });
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
  assert.match(r, /^read=t-הקישו את מספר הדקות להוספה עד 120 ובסיום סולמית=a1,no,3,1,10,Number,/);
  r = await call('a1', '500'); // over the max -> asked again under a new name
  assert.match(r, /ניתן להוסיף בין 1 ל 120 דקות.*=a2,/);
  r = await call('a2', '30');
  assert.equal(r, 'id_list_message=t-הוספת 30 דקות.t-סך הכל צברת 30 דקות&');
  assert.equal(await call('a2', '30'), r, 'a repeated request does not add twice');

  // second call the same day: blocked, offered to change
  call = caller(env, key, 'add', q);
  r = await call();
  assert.match(r, /כבר עדכנת היום 30 דקות.*לשינוי העדכון הקישו 1.*=c1,no,1,1,10,No,/);
  r = await call('c1', '1');
  const val = /=(e\d+_1),/.exec(r)[1];
  r = await call(val, '45');
  assert.equal(r, 'id_list_message=t-העדכון שונה ל 45 דקות.t-סך הכל צברת 45 דקות&');

  // total line
  const other = caller(env, key, 'add', q, { phone: '0529999999' });
  await other(); await other('a1', '15');
  assert.equal(await caller(env, key, 'total', {})(), 'id_list_message=t-עד כה צברת 45 דקות&');
  assert.equal(await caller(env, key, 'total', { all: '1', hours: '1' })(), 'id_list_message=t-עד כה צברת 45 דקות.t-ובסך הכל כל המשתתפים צברו שעה אחת&');
  assert.equal(await caller(env, key, 'total', {}, { phone: '0531111111' })(), 'id_list_message=t-עדיין לא צברת דקות&');

  // cancel with 0
  call = caller(env, key, 'add', q);
  await call(); r = await call('c1', '1');
  r = await call(/=(e\d+_1),/.exec(r)[1], '0');
  assert.equal(r, 'id_list_message=t-העדכון בוטל.t-עדיין לא צברת דקות&');

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
  assert.equal(await caller(env, key, 'add', q, { now: day1 })(), 'id_list_message=t-כבר עדכנת היום 2 פעמים בעדכון האחרון 20 דקות.t-סך הכל צברת 30 דקות&');
  assert.match(await caller(env, key, 'add', q, { now: day1 + 86400000 })(), /=a1,/);
  assert.match(await caller(env, key, 'add', { ...q, list: 'other' }, { now: day1 })(), /^read=t-הקישו/);
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
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  const { data: { token } } = await call('POST', '/api/login', { password: 'secret' });
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
  r = await call('GET', '/api/settings', null, token);
  assert.equal(r.data.key, key);
  r = await call('POST', '/api/settings/rotate-key', null, token);
  assert.notEqual(r.data.key, key);

  const page = await handle(new Request('http://x/ivr-minutes/'), env, '/');
  assert.match(await page.text(), /<title>תוספת דקות<\/title>/);
  assert.equal((await handle(new Request('http://x/zmanim/ivr-minutes'), env, '')).headers.get('Location'), 'http://x/zmanim/ivr-minutes/');
});
