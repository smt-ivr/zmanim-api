import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import worker from '../src/index.js';
import { D1Shim } from './d1-shim.mjs';

const SETUP_KEY = 'test-setup-key';
let env;

function call(method, path, { token, body, ip = '1.1.1.1' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(`https://x.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return worker.fetch(req, env).then(async (res) => ({ status: res.status, body: res.status === 204 ? null : await res.json(), headers: res.headers }));
}

async function setupAdmin() {
  const r = await call('POST', '/setup', { body: { setup_key: SETUP_KEY, name: 'מנהל', email: 'Admin@x.com', password: 'admin-pass-1' } });
  assert.equal(r.status, 201);
  return r.body.token;
}

async function createManager(admin, email, synagogue_ids) {
  const r = await call('POST', '/admin/users', { token: admin, body: { name: 'גבאי', email, password: 'manager-pass', role: 'manager', synagogue_ids } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const login = await call('POST', '/auth/login', { body: { email, password: 'manager-pass' } });
  assert.equal(login.status, 200);
  return { id: r.body.id, token: login.body.token };
}

const newSynagogue = async (admin, body = {}) => (await call('POST', '/admin/synagogues', { token: admin, body: { name: 'בית כנסת', ...body } })).body;

beforeEach(() => {
  env = { DB: new D1Shim(), SETUP_KEY };
});

describe('setup & auth', () => {
  test('setup works once, needs the key, then logs in', async () => {
    assert.deepEqual((await call('GET', '/setup')).body, { needed: true, enabled: true });
    const bad = await call('POST', '/setup', { body: { setup_key: 'nope', name: 'a', email: 'a@a.com', password: '12345678' } });
    assert.equal(bad.status, 403);
    const token = await setupAdmin();
    const me = await call('GET', '/me', { token });
    assert.equal(me.body.user.role, 'admin');
    assert.equal(me.body.user.email, 'admin@x.com');
    const again = await call('POST', '/setup', { body: { setup_key: SETUP_KEY, name: 'b', email: 'b@b.com', password: '12345678' } });
    assert.equal(again.status, 409);
  });

  test('setup disabled without SETUP_KEY', async () => {
    delete env.SETUP_KEY;
    const r = await call('POST', '/setup', { body: { setup_key: 'x', name: 'a', email: 'a@a.com', password: '12345678' } });
    assert.equal(r.status, 403);
  });

  test('wrong password -> 401, lock after 5 failures, no token -> 401', async () => {
    await setupAdmin();
    for (let i = 0; i < 5; i++) {
      assert.equal((await call('POST', '/auth/login', { body: { email: 'admin@x.com', password: 'wrong-pass' } })).status, 401);
    }
    const locked = await call('POST', '/auth/login', { body: { email: 'admin@x.com', password: 'admin-pass-1' } });
    assert.equal(locked.status, 429);
    assert.equal((await call('GET', '/me')).status, 401);
  });

  test('logout kills the token; password change kills other sessions', async () => {
    const t1 = await setupAdmin();
    const t2 = (await call('POST', '/auth/login', { body: { email: 'admin@x.com', password: 'admin-pass-1' } })).body.token;
    const r = await call('PUT', '/me/password', { token: t1, body: { current_password: 'admin-pass-1', new_password: 'new-pass-123' } });
    assert.equal(r.status, 204);
    assert.equal((await call('GET', '/me', { token: t2 })).status, 401);
    assert.equal((await call('GET', '/me', { token: t1 })).status, 200);
    await call('POST', '/auth/logout', { token: t1 });
    assert.equal((await call('GET', '/me', { token: t1 })).status, 401);
  });

  test('validation errors list every bad field', async () => {
    const r = await call('POST', '/auth/login', { body: { email: 'nope' } });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.email);
    assert.ok(r.body.error.fields.password);
  });
});

describe('manager scope', () => {
  test('manager sees and edits only their synagogue', async () => {
    const admin = await setupAdmin();
    const mine = await newSynagogue(admin, { name: 'שלי' });
    const other = await newSynagogue(admin, { name: 'אחר' });
    const m = await createManager(admin, 'g@x.com', [mine.id]);

    const me = await call('GET', '/me', { token: m.token });
    assert.deepEqual(me.body.synagogues.map((s) => s.name), ['שלי']);
    assert.deepEqual((await call('GET', '/synagogues', { token: m.token })).body.map((s) => s.id), [mine.id]);

    const ws = await call('GET', `/synagogues/${mine.id}`, { token: m.token });
    assert.equal(ws.status, 200);
    assert.equal(ws.body.synagogue.name, 'שלי');
    assert.equal(ws.body.settings.max_minyanim, 50);
    assert.ok(ws.body.catalog.prayers.length >= 3);

    assert.equal((await call('GET', `/synagogues/${other.id}`, { token: m.token })).status, 404);
    assert.equal((await call('POST', `/synagogues/${other.id}/locations`, { token: m.token, body: { name: 'x' } })).status, 404);
    assert.equal((await call('GET', '/admin/users', { token: m.token })).status, 403);
  });

  test('can_edit_info=false blocks manager edits of details', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin, { can_edit_info: false });
    const m = await createManager(admin, 'g@x.com', [s.id]);
    assert.equal((await call('PATCH', `/synagogues/${s.id}`, { token: m.token, body: { address: 'רחוב' } })).status, 403);
    assert.equal((await call('PATCH', `/synagogues/${s.id}`, { token: admin, body: { address: 'רחוב' } })).body.synagogue.address, 'רחוב');
  });

  test('limits on locations and minyanim', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin, { max_locations: 1, max_minyanim: 1 });
    const m = await createManager(admin, 'g@x.com', [s.id]);
    assert.equal((await call('POST', `/synagogues/${s.id}/locations`, { token: m.token, body: { name: 'היכל' } })).status, 201);
    const second = await call('POST', `/synagogues/${s.id}/locations`, { token: m.token, body: { name: 'עזרה' } });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'LIMIT_REACHED');

    const body = { prayer_id: 1, time_kind: 'fixed', time: '07:00' };
    assert.equal((await call('POST', `/synagogues/${s.id}/minyanim`, { token: m.token, body })).status, 201);
    assert.equal((await call('POST', `/synagogues/${s.id}/minyanim`, { token: m.token, body })).status, 409);
  });

  test('restricted prayers', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin, { restrict_prayers: true, allowed_prayer_ids: [1] });
    const m = await createManager(admin, 'g@x.com', [s.id]);
    const ws = await call('GET', `/synagogues/${s.id}`, { token: m.token });
    assert.deepEqual(ws.body.catalog.prayers.map((p) => p.id), [1]);
    const r = await call('POST', `/synagogues/${s.id}/minyanim`, { token: m.token, body: { prayer_id: 2, time_kind: 'fixed', time: '13:30' } });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.prayer_id);
  });
});

describe('minyanim', () => {
  let admin, s;
  beforeEach(async () => {
    admin = await setupAdmin();
    s = await newSynagogue(admin);
  });
  const post = (body) => call('POST', `/synagogues/${s.id}/minyanim`, { token: admin, body });

  test('fixed and relative minyanim, labels, order', async () => {
    const a = await post({ prayer_id: 2, time_kind: 'relative', anchor_id: 2, offset_minutes: -15, days: 31 });
    assert.equal(a.status, 201);
    assert.equal(a.body.time_label, '15 דק׳ לפני שקיעה');
    assert.equal(a.body.days_label, 'א׳-ה׳');
    const b = await post({ prayer_id: 1, time_kind: 'fixed', time: '06:30', notes: 'ותיקין' });
    assert.equal(b.body.time_label, '06:30');
    assert.equal(b.body.days_label, 'כל יום');
    const ws = await call('GET', `/synagogues/${s.id}`, { token: admin });
    assert.deepEqual(ws.body.minyanim.map((x) => x.prayer_name), ['שחרית', 'מנחה']);
  });

  test('time bounds, missing fields, foreign location', async () => {
    let r = await post({ prayer_id: 1, time_kind: 'fixed', time: '03:00' });
    assert.equal(r.status, 422);
    assert.match(r.body.error.fields.time, /לא לפני/);
    r = await post({ prayer_id: 1, time_kind: 'relative' });
    assert.ok(r.body.error.fields.anchor_id && r.body.error.fields.offset_minutes);
    r = await post({ prayer_id: 1, time_kind: 'fixed', time: '25:00' });
    assert.ok(r.body.error.fields.time);

    const other = await newSynagogue(admin, { name: 'אחר' });
    const loc = (await call('POST', `/synagogues/${other.id}/locations`, { token: admin, body: { name: 'x' } })).body;
    r = await post({ prayer_id: 1, time_kind: 'fixed', time: '07:00', location_id: loc.id });
    assert.ok(r.body.error.fields.location_id);
  });

  test('patch merges and revalidates; switching to relative clears time', async () => {
    const m = (await post({ prayer_id: 1, time_kind: 'fixed', time: '07:00' })).body;
    let r = await call('PATCH', `/synagogues/${s.id}/minyanim/${m.id}`, { token: admin, body: { time: '07:15' } });
    assert.equal(r.body.time, '07:15');
    r = await call('PATCH', `/synagogues/${s.id}/minyanim/${m.id}`, { token: admin, body: { time_kind: 'relative', anchor_id: 1, offset_minutes: 0 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.time, null);
    assert.equal(r.body.time_label, 'הנץ החמה');
    r = await call('PATCH', `/synagogues/${s.id}/minyanim/${m.id}`, { token: admin, body: { is_active: false } });
    assert.equal(r.body.is_active, false);
  });

  test('duplicate, delete, deleting a location keeps the minyan', async () => {
    const loc = (await call('POST', `/synagogues/${s.id}/locations`, { token: admin, body: { name: 'היכל' } })).body;
    const m = (await post({ prayer_id: 1, time_kind: 'fixed', time: '07:00', location_id: loc.id })).body;
    const dup = await call('POST', `/synagogues/${s.id}/minyanim/${m.id}/duplicate`, { token: admin });
    assert.equal(dup.status, 201);
    assert.equal(dup.body.location_name, 'היכל');
    assert.equal((await call('DELETE', `/synagogues/${s.id}/locations/${loc.id}`, { token: admin })).status, 204);
    const ws = await call('GET', `/synagogues/${s.id}`, { token: admin });
    assert.equal(ws.body.minyanim.length, 2);
    assert.ok(ws.body.minyanim.every((x) => x.location_id === null));
    assert.equal((await call('DELETE', `/synagogues/${s.id}/minyanim/${m.id}`, { token: admin })).status, 204);
  });

  test('location ordering', async () => {
    const a = (await call('POST', `/synagogues/${s.id}/locations`, { token: admin, body: { name: 'א' } })).body;
    const b = (await call('POST', `/synagogues/${s.id}/locations`, { token: admin, body: { name: 'ב' } })).body;
    const r = await call('PUT', `/synagogues/${s.id}/locations/order`, { token: admin, body: { ids: [b.id, a.id] } });
    assert.deepEqual(r.body.map((l) => l.name), ['ב', 'א']);
    assert.equal((await call('PUT', `/synagogues/${s.id}/locations/order`, { token: admin, body: { ids: [a.id] } })).status, 409);
  });
});

describe('admin', () => {
  test('users: duplicate email, cannot demote or delete self, deactivate signs out', async () => {
    const admin = await setupAdmin();
    const me = (await call('GET', '/me', { token: admin })).body.user;
    const s = await newSynagogue(admin);
    const m = await createManager(admin, 'g@x.com', [s.id]);
    const dup = await call('POST', '/admin/users', { token: admin, body: { name: 'x', email: 'G@x.com', password: '12345678', role: 'manager' } });
    assert.equal(dup.status, 422);
    assert.equal((await call('PATCH', `/admin/users/${me.id}`, { token: admin, body: { role: 'manager' } })).status, 403);
    assert.equal((await call('DELETE', `/admin/users/${me.id}`, { token: admin })).status, 403);
    const off = await call('PATCH', `/admin/users/${m.id}`, { token: admin, body: { is_active: false } });
    assert.equal(off.body.is_active, false);
    assert.equal((await call('GET', '/me', { token: m.token })).status, 401);
  });

  test('synagogue managers assigned from either side', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    const m = await createManager(admin, 'g@x.com', []);
    let r = await call('PATCH', `/admin/synagogues/${s.id}`, { token: admin, body: { manager_ids: [m.id] } });
    assert.deepEqual(r.body.managers.map((x) => x.id), [m.id]);
    assert.equal((await call('GET', `/synagogues/${s.id}`, { token: m.token })).status, 200);
    r = await call('PATCH', `/admin/users/${m.id}`, { token: admin, body: { synagogue_ids: [] } });
    assert.deepEqual(r.body.synagogues, []);
    assert.equal((await call('GET', `/synagogues/${s.id}`, { token: m.token })).status, 404);
    const list = await call('GET', '/admin/synagogues', { token: admin });
    assert.equal(list.body[0].managers.length, 0);
  });

  test('catalog CRUD, single default season, in-use protection', async () => {
    const admin = await setupAdmin();
    const area = await call('POST', '/admin/catalog/areas', { token: admin, body: { name: 'מרכז' } });
    assert.equal(area.status, 201);
    assert.equal((await call('POST', '/admin/catalog/areas', { token: admin, body: { name: 'מרכז' } })).status, 422);
    await call('POST', '/admin/catalog/seasons', { token: admin, body: { name: 'בין הזמנים', is_default: true } });
    const seasons = (await call('GET', '/admin/catalog/seasons', { token: admin })).body;
    assert.deepEqual(seasons.filter((x) => x.is_default).map((x) => x.name), ['בין הזמנים']);
    const s = await newSynagogue(admin, { area_id: area.body.id });
    assert.equal(s.area_name, 'מרכז');
    const del = await call('DELETE', `/admin/catalog/areas/${area.body.id}`, { token: admin });
    assert.equal(del.status, 409);
    assert.equal((await call('GET', '/admin/catalog/nope', { token: admin })).status, 404);
  });

  test('deleting a synagogue removes its content', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    await call('POST', `/synagogues/${s.id}/minyanim`, { token: admin, body: { prayer_id: 1, time_kind: 'fixed', time: '07:00' } });
    assert.equal((await call('DELETE', `/admin/synagogues/${s.id}`, { token: admin })).status, 204);
    assert.equal((await call('GET', '/admin/stats', { token: admin })).body.minyanim, 0);
  });
});

describe('public', () => {
  test('only active content, day filter, cache header', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin, { name: 'פעיל' });
    const hidden = await newSynagogue(admin, { name: 'מוסתר', is_active: false });
    const p = (sid, body) => call('POST', `/synagogues/${sid}/minyanim`, { token: admin, body: { prayer_id: 1, time_kind: 'fixed', time: '07:00', ...body } });
    await p(s.id, { days: 0b1000000 }); // shabbat only
    await p(s.id, { days: 0b0011111, time: '06:30' });
    await p(s.id, { is_active: false });
    await p(hidden.id, {});

    const all = await call('GET', '/public/minyanim');
    assert.equal(all.body.length, 2);
    assert.match(all.headers.get('Cache-Control'), /max-age/);
    const shabbat = await call('GET', '/public/minyanim?day=6');
    assert.deepEqual(shabbat.body.map((m) => m.days_label), ['שבת']);
    assert.deepEqual((await call('GET', '/public/synagogues')).body.map((x) => x.name), ['פעיל']);
    assert.equal((await call('GET', `/public/synagogues/${hidden.id}`)).status, 404);
    assert.equal((await call('GET', '/public/minyanim?day=9')).status, 400);
  });

  test('unknown path 404, wrong method 405, CORS preflight', async () => {
    assert.equal((await call('GET', '/nope')).status, 404);
    assert.equal((await call('DELETE', '/health')).status, 405);
    const res = await worker.fetch(new Request('https://x.test/api/me', { method: 'OPTIONS', headers: { Origin: 'https://a.com' } }), env);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  });
});
