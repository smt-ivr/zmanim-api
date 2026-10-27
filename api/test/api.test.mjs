import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';
import { D1Shim } from './d1-shim.mjs';

let env;
let phoneSeq = 0;
const nextPhone = () => `05${String(20000000 + ++phoneSeq)}`;

// Every minyan belongs to a season. Tests that do not care use season 1 (the default, current season).
function call(method, path, { token, body, ip = '1.1.1.1' } = {}) {
  if (method === 'POST' && /\/minyanim$/.test(path) && body && !('season_id' in body)) body = { ...body, season_id: 1 };
  const headers = { 'CF-Connecting-IP': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(`https://x.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return worker.fetch(req, env).then(async (res) => ({ status: res.status, body: res.status === 204 ? null : await res.json(), headers: res.headers }));
}

async function setupAdmin() {
  await env.DB.prepare(`INSERT INTO users (name, email, phone, password_hash, role) VALUES ('מנהל', 'admin@x.com', '0583206823', ?, 'admin')`)
    .bind(await hashPassword('admin-pass-1')).run();
  const r = await call('POST', '/auth/login', { body: { login: 'Admin@x.com', password: 'admin-pass-1' } });
  assert.equal(r.status, 200);
  return r.body.token;
}

async function createManager(admin, email, synagogue_ids) {
  const r = await call('POST', '/admin/users', { token: admin, body: { name: 'גבאי', email, phone: nextPhone(), password: 'manager-pass', role: 'manager', synagogue_ids } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const login = await call('POST', '/auth/login', { body: { email, password: 'manager-pass' } });
  assert.equal(login.status, 200);
  return { id: r.body.id, token: login.body.token };
}

const newSynagogue = async (admin, body = {}) => (await call('POST', '/admin/synagogues', { token: admin, body: { name: 'בית כנסת', area_id: 1, ...body } })).body;
const setSetting = (key, value) => env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();

beforeEach(async () => {
  env = { DB: new D1Shim() };
  await env.DB.prepare(`INSERT INTO areas (name) VALUES ('מרכז')`).run();
});

describe('setup & auth', () => {
  test('login with e-mail or phone (any format)', async () => {
    await setupAdmin();
    for (const login of ['admin@x.com', '0583206823', '058-320-6823', '+972583206823']) {
      const r = await call('POST', '/auth/login', { body: { login, password: 'admin-pass-1' } });
      assert.equal(r.status, 200, login);
      assert.equal(r.body.user.name, 'מנהל');
    }
    const me = await call('GET', '/me', { token: (await call('POST', '/auth/login', { body: { login: '0583206823', password: 'admin-pass-1' } })).body.token });
    assert.equal(me.body.user.role, 'admin');
    assert.equal((await call('GET', '/setup')).status, 404);
  });

  test('users need e-mail, phone and password', async () => {
    const admin = await setupAdmin();
    const r = await call('POST', '/admin/users', { token: admin, body: { name: 'x', role: 'manager' } });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.email && r.body.error.fields.phone && r.body.error.fields.password);
    const dupPhone = await call('POST', '/admin/users', { token: admin, body: { name: 'x', email: 'n@x.com', phone: '0583206823', password: '1234', role: 'manager' } });
    assert.equal(dupPhone.body.error.fields.phone, 'הטלפון כבר רשום במערכת');
  });

  test('wrong password -> 401, lock after 5 failures, no token -> 401', async () => {
    await setupAdmin();
    for (let i = 0; i < 5; i++) {
      assert.equal((await call('POST', '/auth/login', { body: { login: 'admin@x.com', password: 'wrong-pass' } })).status, 401);
    }
    const locked = await call('POST', '/auth/login', { body: { login: 'admin@x.com', password: 'admin-pass-1' } });
    assert.equal(locked.status, 429);
    assert.equal((await call('GET', '/me')).status, 401);
  });

  test('logout kills the token; password change kills other sessions', async () => {
    const t1 = await setupAdmin();
    const t2 = (await call('POST', '/auth/login', { body: { login: '0583206823', password: 'admin-pass-1' } })).body.token;
    const r = await call('PUT', '/me/password', { token: t1, body: { current_password: 'admin-pass-1', new_password: 'new-pass-123' } });
    assert.equal(r.status, 204);
    assert.equal((await call('GET', '/me', { token: t2 })).status, 401);
    assert.equal((await call('GET', '/me', { token: t1 })).status, 200);
    await call('POST', '/auth/logout', { token: t1 });
    assert.equal((await call('GET', '/me', { token: t1 })).status, 401);
  });

  test('validation errors list every bad field', async () => {
    const r = await call('POST', '/auth/login', { body: {} });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.login);
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
    assert.deepEqual((await call('GET', '/synagogues', { token: m.token })).body.items.map((s) => s.id), [mine.id]);
    // admins search (there can be thousands)
    const found = (await call('GET', `/synagogues?q=${encodeURIComponent(mine.name.slice(0, 3))}&limit=5`, { token: admin })).body;
    assert.ok(found.items.some((s) => s.id === mine.id));
    assert.ok(found.total >= 1);
    assert.deepEqual((await call('GET', '/me', { token: admin })).body.synagogues, [], 'admins do not load every synagogue');

    const ws = await call('GET', `/synagogues/${mine.id}`, { token: m.token });
    assert.equal(ws.status, 200);
    assert.equal(ws.body.synagogue.name, 'שלי');
    assert.equal(ws.body.settings.max_minyanim, 0, 'unlimited by default');
    assert.ok(ws.body.catalog.prayers.length >= 3);

    assert.equal((await call('GET', `/synagogues/${other.id}`, { token: m.token })).status, 404);
    assert.equal((await call('POST', `/synagogues/${other.id}/locations`, { token: m.token, body: { name: 'x' } })).status, 404);
    assert.equal((await call('GET', '/admin/users', { token: m.token })).status, 403);
  });

  test('details are locked by default; the admin opens chosen fields', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    assert.deepEqual(s.settings.editable_fields, []);
    const m = await createManager(admin, 'g@x.com', [s.id]);
    const locked = await call('PATCH', `/synagogues/${s.id}`, { token: m.token, body: { address: 'רחוב' } });
    assert.equal(locked.status, 403);
    assert.match(locked.body.error.message, /פנו להנהלה/);
    assert.equal((await call('PATCH', `/synagogues/${s.id}`, { token: admin, body: { address: 'רחוב' } })).body.synagogue.address, 'רחוב');

    await call('PATCH', `/admin/synagogues/${s.id}`, { token: admin, body: { editable_fields: ['address', 'phone'] } });
    const ok = await call('PATCH', `/synagogues/${s.id}`, { token: m.token, body: { name: s.name, address: 'רחוב 2', phone: '02' } });
    assert.equal(ok.status, 200, 'unchanged name + open fields');
    assert.equal((await call('PATCH', `/synagogues/${s.id}`, { token: m.token, body: { name: 'שם אחר' } })).status, 403);
    assert.equal((await call('PATCH', `/synagogues/${s.id}`, { token: admin, body: { area_id: null } })).status, 422);
  });

  test('every synagogue needs an area', async () => {
    const admin = await setupAdmin();
    const r = await call('POST', '/admin/synagogues', { token: admin, body: { name: 'בלי אזור' } });
    assert.equal(r.status, 422);
    assert.ok(r.body.error.fields.area_id);
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
    assert.equal(dup.body.is_active, false); // hidden until moved to another time
    const clash = await call('PATCH', `/synagogues/${s.id}/minyanim/${dup.body.id}`, { token: admin, body: { is_active: true } });
    assert.match(clash.body.error.fields.time, /באותה שעה ובאותו מיקום/);
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
    const dup = await call('POST', '/admin/users', { token: admin, body: { name: 'x', email: 'G@x.com', phone: nextPhone(), password: '12345678', role: 'manager' } });
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
    const area = await call('POST', '/admin/catalog/areas', { token: admin, body: { name: 'צפון' } });
    assert.equal(area.status, 201);
    assert.equal((await call('POST', '/admin/catalog/areas', { token: admin, body: { name: 'צפון' } })).status, 422);
    await call('POST', '/admin/catalog/seasons', { token: admin, body: { name: 'בין הזמנים', is_default: true } });
    const seasons = (await call('GET', '/admin/catalog/seasons', { token: admin })).body;
    assert.deepEqual(seasons.filter((x) => x.is_default).map((x) => x.name), ['בין הזמנים']);
    const s = await newSynagogue(admin, { area_id: area.body.id });
    assert.equal(s.area_name, 'צפון');
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
    // Shabbat is off by default: a Shabbat-only minyan is refused
    assert.equal((await p(s.id, { days: 0b1000000 })).status, 422);
    await setSetting('shabbat_enabled', '1');
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

    // Turning Shabbat off hides Shabbat days from the public
    await setSetting('shabbat_enabled', '0');
    assert.deepEqual((await call('GET', '/public/minyanim')).body.map((m) => m.days_label), ['א׳-ה׳']);
    assert.equal((await call('GET', '/public/catalog')).body.site.shabbat_enabled, false);
    // Closing the site
    await setSetting('public_site_enabled', '0');
    assert.equal((await call('GET', '/public/minyanim')).status, 503);
    assert.equal((await call('GET', '/public/catalog')).body.site.enabled, false);
  });

  test('unknown path 404, wrong method 405, CORS preflight', async () => {
    assert.equal((await call('GET', '/nope')).status, 404);
    assert.equal((await call('DELETE', '/health')).status, 405);
    const res = await worker.fetch(new Request('https://x.test/api/me', { method: 'OPTIONS', headers: { Origin: 'https://a.com' } }), env);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  });
});

describe('super admin, profile, messages, control', () => {
  async function superAndAdmin() {
    const superToken = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1 WHERE email = 'admin@x.com'`).run();
    await call('POST', '/admin/users', { token: superToken, body: { name: 'מנהל שני', email: 'b@x.com', phone: nextPhone(), password: 'second-pass', role: 'admin' } });
    const other = (await call('POST', '/auth/login', { body: { login: 'b@x.com', password: 'second-pass' } })).body.token;
    const superId = (await call('GET', '/me', { token: superToken })).body.user.id;
    return { superToken, other, superId };
  }

  test('other admins cannot edit or delete the super admin; hidden super is invisible to them', async () => {
    const { superToken, other, superId } = await superAndAdmin();
    assert.equal((await call('PATCH', `/admin/users/${superId}`, { token: other, body: { name: 'x' } })).status, 404);
    assert.equal((await call('DELETE', `/admin/users/${superId}`, { token: other })).status, 404);
    assert.ok((await call('GET', '/admin/users', { token: other })).body.some((u) => u.id === superId));
    await call('PATCH', '/me', { token: superToken, body: { is_hidden: true } });
    assert.ok(!(await call('GET', '/admin/users', { token: other })).body.some((u) => u.id === superId));
    assert.ok((await call('GET', '/admin/users', { token: superToken })).body.some((u) => u.id === superId));
    assert.equal((await call('PATCH', '/me', { token: other, body: { is_hidden: true } })).status, 403);
    assert.equal((await call('GET', '/admin/control', { token: other })).status, 403);
  });

  test('users change only e-mail and password, unless blocked; login history', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    const m = await createManager(admin, 'g@x.com', [s.id]);
    let r = await call('PATCH', '/me', { token: m.token, body: { email: 'new@x.com', name: 'שם חדש' } });
    assert.equal(r.body.user.email, 'new@x.com');
    assert.equal(r.body.user.name, 'גבאי'); // name is ignored
    await call('PATCH', `/admin/users/${m.id}`, { token: admin, body: { can_edit_email: false, can_edit_password: false } });
    assert.equal((await call('PATCH', '/me', { token: m.token, body: { email: 'z@x.com' } })).status, 403);
    assert.equal((await call('PUT', '/me/password', { token: m.token, body: { current_password: 'manager-pass', new_password: '12345' } })).status, 403);
    const logins = await call('GET', '/me/logins', { token: m.token });
    assert.equal(logins.body[0].channel, 'web');
  });

  test('phone password needs the real, numeric password', async () => {
    const admin = await setupAdmin();
    assert.equal((await call('PUT', '/me/phone-password', { token: admin, body: { enabled: true, password: 'admin-pass-1' } })).body.error.fields.password.includes('ספרות'), true);
    await call('PUT', '/me/password', { token: admin, body: { current_password: 'admin-pass-1', new_password: '1631' } });
    const r = await call('PUT', '/me/phone-password', { token: admin, body: { enabled: true, password: '1631' } });
    assert.equal(r.body.user.phone_requires_password, true);
    const bad = await call('PUT', '/me/password', { token: admin, body: { current_password: '1631', new_password: 'letters-pw' } });
    assert.equal(bad.status, 422);
  });

  test('messages are a chat: only the staff reads them; can be blocked per user or globally', async () => {
    const { superToken, other } = await superAndAdmin();
    assert.equal((await call('POST', '/me/messages', { token: other, body: { body: 'בקשה לשיפור' } })).status, 201);
    await call('POST', '/me/messages', { token: other, body: { body: 'ועוד משהו' } });
    const inbox = (await call('GET', '/admin/conversations', { token: superToken })).body;
    assert.equal(inbox.length, 1, 'one conversation per user');
    assert.deepEqual([inbox[0].staff_unread, inbox[0].last_body], [2, 'ועוד משהו']);
    assert.equal((await call('GET', '/admin/conversations', { token: other })).status, 403);
    assert.equal((await call('GET', '/me', { token: superToken })).body.system.unread_messages, 2);

    const conv = (await call('GET', `/admin/conversations/${inbox[0].id}`, { token: superToken })).body;
    assert.deepEqual(conv.messages.map((m) => m.sender), ['user', 'user']);
    assert.equal((await call('GET', '/admin/conversations', { token: superToken })).body[0].staff_unread, 0, 'opened = read');
    await call('POST', `/admin/conversations/${inbox[0].id}/messages`, { token: superToken, body: { body: 'תודה, נבדוק' } });
    assert.equal((await call('GET', '/me', { token: other })).body.system.unread_messages, 1);
    const mine = (await call('GET', '/me/messages', { token: other })).body;
    assert.deepEqual(mine.messages.map((m) => [m.sender, m.body]), [['user', 'בקשה לשיפור'], ['user', 'ועוד משהו'], ['staff', 'תודה, נבדוק']]);
    assert.equal((await call('GET', '/me', { token: other })).body.system.unread_messages, 0);

    const otherId = inbox[0].user_id;
    await call('PATCH', `/admin/users/${otherId}`, { token: superToken, body: { can_message: false } });
    assert.equal((await call('POST', '/me/messages', { token: other, body: { body: 'שוב' } })).status, 403);
    await call('PATCH', `/admin/users/${otherId}`, { token: superToken, body: { can_message: true } });
    await call('PATCH', '/admin/control', { token: superToken, body: { feedback_enabled: false } });
    assert.equal((await call('GET', '/me/messages', { token: other })).body.blocked, 'שליחת הודעות סגורה כרגע');
  });

  test('control settings round-trip; anchors limited to prayers', async () => {
    const { superToken } = await superAndAdmin();
    const r = await call('PATCH', '/admin/control', { token: superToken, body: { shabbat_enabled: true, site_notice: 'שבת שלום', listen_phone: '043132030' } });
    assert.equal(r.body.shabbat_enabled, true);
    assert.equal(r.body.site_notice, 'שבת שלום');
    assert.equal((await call('GET', '/me', { token: superToken })).body.system.shabbat_enabled, true);

    // anchor "sunset" (2) only for mincha (2)
    const a = await call('PATCH', '/admin/catalog/anchors/2', { token: superToken, body: { prayer_ids: [2] } });
    assert.deepEqual(a.body.prayer_ids, [2]);
    const s = await newSynagogue(superToken);
    const bad = await call('POST', `/synagogues/${s.id}/minyanim`, { token: superToken, body: { prayer_id: 1, time_kind: 'relative', anchor_id: 2, offset_minutes: 0 } });
    assert.match(bad.body.error.fields.anchor_id, /אינו מותר/);
    const ws = await call('GET', `/synagogues/${s.id}`, { token: superToken });
    assert.deepEqual(ws.body.catalog.anchors.find((x) => x.id === 2).prayer_ids, [2]);
  });
});

describe('seasons, intervals, Rosh Chodesh, notes', () => {
  test('current season by start date; managers edit only it unless allowed; public sees only it', async () => {
    const admin = await setupAdmin();
    // summer from 04-01, winter from 10-01 (today decides which is current)
    await call('PATCH', '/admin/catalog/seasons/1', { token: admin, body: { starts_md: '04-01' } });
    await call('PATCH', '/admin/catalog/seasons/2', { token: admin, body: { starts_md: '10-01' } });
    const md = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', month: '2-digit', day: '2-digit' }).format(new Date()).split('/').reverse().join('-');
    const current = md >= '10-01' || md < '04-01' ? 2 : 1;
    const other = current === 1 ? 2 : 1;

    const s = await newSynagogue(admin);
    const m = await createManager(admin, 'g@x.com', [s.id]);
    const ws = await call('GET', `/synagogues/${s.id}`, { token: m.token });
    assert.equal(ws.body.catalog.current_season.id, current);
    assert.deepEqual(ws.body.settings.editable_season_ids, [current]);

    const post = (token, season_id, time) => call('POST', `/synagogues/${s.id}/minyanim`, { token, body: { prayer_id: 1, time_kind: 'fixed', time, season_id } });
    assert.equal((await post(m.token, current, '07:00')).status, 201);
    assert.ok((await post(m.token, null, '07:30')).body.error.fields.season_id); // no "all year"
    const blocked = await post(m.token, other, '08:00');
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error.message, /ניתן לעדכן רק את זמני/);
    assert.equal((await post(admin, other, '08:00')).status, 201); // admin may
    await call('PATCH', `/admin/synagogues/${s.id}`, { token: admin, body: { allow_other_seasons: true } });
    assert.equal((await post(m.token, other, '08:15')).status, 201);

    const pub = await call('GET', '/public/minyanim');
    assert.deepEqual(pub.body.map((x) => x.time), ['07:00']);
    assert.equal((await call('GET', '/public/catalog')).body.current_season.id, current);
    assert.deepEqual((await call('GET', `/public/minyanim?season_id=${other}`)).body.map((x) => x.time), ['07:00'], 'choice is closed by default');
    await setSetting('public_season_choice', '1');
    assert.deepEqual((await call('GET', `/public/minyanim?season_id=${other}`)).body.map((x) => x.time).sort(), ['08:00', '08:15']);
    assert.equal((await post(admin, other, '07:00')).status, 201, 'same time in another season is no clash');
  });

  test('copy minyanim from season to season', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    const m = await createManager(admin, 'c@x.com', [s.id]);
    const current = (await call('GET', `/synagogues/${s.id}`, { token: m.token })).body.catalog.current_season.id;
    const other = current === 1 ? 2 : 1;
    const post = (season_id, time) => call('POST', `/synagogues/${s.id}/minyanim`, { token: admin, body: { prayer_id: 1, time_kind: 'fixed', time, season_id } });
    const a = (await post(other, '06:00')).body;
    await post(other, '07:00');
    await post(current, '07:00'); // already in the target season
    const copy = (token, body) => call('POST', `/synagogues/${s.id}/seasons/copy`, { token, body });
    const seasonTimes = async (id) => (await call('GET', `/synagogues/${s.id}`, { token: admin })).body.minyanim.filter((x) => x.season_id === id).map((x) => x.time).sort();

    const r = await copy(m.token, { from_season_id: other, to_season_id: current });
    assert.equal(r.status, 200);
    assert.equal(r.body.copied, 1);
    assert.equal(r.body.skipped.length, 1, 'the clash is skipped, not doubled');
    assert.match(r.body.skipped[0].reason, /באותה שעה/);
    assert.deepEqual(await seasonTimes(current), ['06:00', '07:00']);

    assert.equal((await copy(m.token, { from_season_id: current, to_season_id: other })).status, 403, 'managers write only the current season');
    assert.equal((await copy(m.token, { from_season_id: current, to_season_id: current })).status, 422);

    const r2 = await copy(admin, { from_season_id: other, to_season_id: current, minyan_ids: [a.id], replace: true });
    assert.deepEqual([r2.body.copied, r2.body.skipped.length], [1, 0]);
    assert.deepEqual(await seasonTimes(current), ['06:00'], 'replace clears the target first');

    const all = await call('POST', '/admin/seasons/copy', { token: admin, body: { from_season_id: other, to_season_id: current, replace: true } });
    assert.equal(all.status, 200);
    assert.equal(all.body.copied, 2);
    assert.deepEqual(await seasonTimes(current), ['06:00', '07:00']);
    assert.equal((await call('POST', '/admin/seasons/copy', { token: m.token, body: { from_season_id: other, to_season_id: current } })).status, 403);

    // only some prayers: mincha in the source is copied, shacharit is not; replace clears only mincha in the target
    await call('POST', `/synagogues/${s.id}/minyanim`, { token: admin, body: { prayer_id: 2, time_kind: 'fixed', time: '13:30', season_id: other } });
    const some = await call('POST', '/admin/seasons/copy', { token: admin, body: { from_season_id: other, to_season_id: current, prayer_ids: [2], replace: true } });
    assert.equal(some.body.copied, 1);
    assert.deepEqual(await seasonTimes(current), ['06:00', '07:00', '13:30']);
  });

  test('anchors are computed; the public catalog has the week\'s times; place is a setting', async () => {
    const admin = await setupAdmin();
    const anchors = (await call('GET', '/admin/catalog/anchors', { token: admin })).body;
    assert.deepEqual(anchors.map((x) => x.calc), ['sunrise', 'sunset', 'tzeit']);
    assert.equal((await call('PATCH', '/admin/catalog/anchors/1', { token: admin, body: { calc: 'nope' } })).status, 422);
    assert.equal((await call('PATCH', '/admin/catalog/anchors/1', { token: admin, body: { calc: 'alot' } })).body.calc, 'alot');
    const cat = (await call('GET', '/public/catalog')).body;
    assert.equal(cat.zmanim.length, 7);
    assert.match(cat.zmanim[0].times[2], /^1[5-9]:\d\d$/, 'sunset in the afternoon');
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    assert.equal((await call('PATCH', '/admin/control', { token: admin, body: { zmanim_lat: '200' } })).status, 422);
    assert.equal((await call('PATCH', '/admin/control', { token: admin, body: { zmanim_lat: '32.084', zmanim_lng: '34.834' } })).body.zmanim_lat, '32.084');
  });

    test('no two shown minyanim at the same time and place; intervals need approval', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    const post = (body) => call('POST', `/synagogues/${s.id}/minyanim`, { token: admin, body: { prayer_id: 1, ...body } });
    assert.equal((await post({ time_kind: 'fixed', time: '07:00' })).status, 201);
    assert.match((await post({ time_kind: 'fixed', time: '07:00' })).body.error.fields.time, /באותה שעה ובאותו מיקום/);
    const loc = (await call('POST', `/synagogues/${s.id}/locations`, { token: admin, body: { name: 'עזרה' } })).body;
    assert.equal((await post({ time_kind: 'fixed', time: '07:00', location_id: loc.id })).status, 201, 'other location is fine');
    assert.equal((await post({ time_kind: 'fixed', time: '07:00', is_active: false })).status, 201, 'hidden is fine');

    const interval = { time_kind: 'interval', time: '07:15', end_time: '08:00', every_minutes: 15 };
    assert.ok((await post(interval)).body.error.fields.time_kind, 'needs approval');
    await call('PATCH', `/admin/synagogues/${s.id}`, { token: admin, body: { allow_interval: true } });
    const ok = await post(interval);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.time_label, '\u206607:15–08:00\u2069, כל 15 דק׳');
    assert.match((await post({ time_kind: 'fixed', time: '07:45' })).body.error.fields.time, /באותה שעה/, 'falls on an interval slot');
    assert.equal((await post({ time_kind: 'fixed', time: '07:50' })).status, 201);
    assert.match((await post({ ...interval, end_time: '07:00' })).body.error.fields.end_time, /אחרי ההתחלה/);
  });

  test('Rosh Chodesh time only for prayers that have it; notes off by default', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    const post = (body) => call('POST', `/synagogues/${s.id}/minyanim`, { token: admin, body: { time_kind: 'fixed', notes: 'ותיקין', ...body } });
    const shacharit = await post({ prayer_id: 1, time: '07:00', rosh_chodesh_time: '06:45' });
    assert.equal(shacharit.body.rosh_chodesh_time, '06:45');
    assert.equal(shacharit.body.notes, '', 'notes are switched off');
    assert.equal((await post({ prayer_id: 3, time: '21:00', rosh_chodesh_time: '20:45' })).body.rosh_chodesh_time, null);
    await setSetting('minyan_notes_enabled', '1');
    assert.equal((await post({ prayer_id: 1, time: '08:00' })).body.notes, 'ותיקין');
  });
});

describe('e-mail (Resend mocked)', () => {
  let sent;
  const realFetch = globalThis.fetch;
  beforeEach(async () => {
    sent = [];
    globalThis.fetch = async (u, init) => {
      if (String(u).startsWith('https://api.resend.com/')) {
        sent.push({ headers: init.headers, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
      }
      if (String(u).startsWith('https://oauth2.googleapis.com/tokeninfo')) {
        // fake Google: the "token" is the JSON Google would return for it
        const info = decodeURIComponent(String(u).split('id_token=')[1]);
        return info === 'bad' ? new Response('{}', { status: 400 }) : new Response(info, { status: 200 });
      }
      return realFetch(u, init);
    };
  });
  const enableMail = async () => {
    await setSetting('mail_enabled', '1');
    await setSetting('mail_from', 'זמני מניינים <noreply@example.com>');
    await setSetting('resend_api_key', 're_secret_1234');
  };
  const linkToken = () => /[#/](?:link|reset)\?t=([0-9a-f]+)/.exec(sent.at(-1).body.text)[1];

  test('control hides the key; test mail; options follow the switches', async () => {
    const admin = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    assert.deepEqual((await call('GET', '/auth/options')).body, { magic_link: false, password_reset: false, google_client_id: '89500817024-tbvsuu4dci6bqh173l65ua9lc65pe24p.apps.googleusercontent.com', system_name: 'מערכת זמני התפילות', registration: false });
    await enableMail();
    const ctl = await call('GET', '/admin/control', { token: admin });
    assert.equal(ctl.body.resend_api_key, '••••1234');
    assert.equal(ctl.body.mail_ready, true);
    await call('PATCH', '/admin/control', { token: admin, body: { resend_api_key: '••••1234' } }); // unchanged
    assert.equal((await call('POST', '/admin/control/test-mail', { token: admin })).status, 200);
    assert.equal(sent[0].headers.Authorization, 'Bearer re_secret_1234');
    assert.deepEqual(sent[0].body.to, ['admin@x.com']);
    assert.deepEqual((await call('GET', '/auth/options')).body, { magic_link: true, password_reset: true, google_client_id: '89500817024-tbvsuu4dci6bqh173l65ua9lc65pe24p.apps.googleusercontent.com', system_name: 'מערכת זמני התפילות', registration: false });
    await setSetting('magic_link_enabled', '0');
    assert.equal((await call('POST', '/auth/email-link', { body: { login: 'admin@x.com' } })).status, 403);
  });

  test('login link: one use; unknown user gets the same answer; rate limited', async () => {
    await setupAdmin();
    await enableMail();
    assert.equal((await call('POST', '/auth/email-link', { body: { login: 'nobody@x.com' } })).status, 204);
    assert.equal(sent.length, 0);
    assert.equal((await call('POST', '/auth/email-link', { body: { login: '058-320-6823' } })).status, 204);
    const t = linkToken();
    const r = await call('POST', '/auth/email-link/verify', { body: { token: t } });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal((await call('POST', '/auth/email-link/verify', { body: { token: t } })).status, 400);
    await call('POST', '/auth/email-link', { body: { login: 'admin@x.com' } });
    await call('POST', '/auth/email-link', { body: { login: 'admin@x.com' } });
    assert.equal((await call('POST', '/auth/email-link', { body: { login: 'admin@x.com' } })).status, 429);
  });

  test('password reset sets the password and signs in', async () => {
    await setupAdmin();
    await enableMail();
    await call('POST', '/auth/reset-request', { body: { login: 'admin@x.com' } });
    const r = await call('POST', '/auth/reset', { body: { token: linkToken(), new_password: '5678' } });
    assert.equal(r.status, 200);
    assert.equal((await call('POST', '/auth/login', { body: { login: 'admin@x.com', password: '5678' } })).status, 200);
  });

  test('welcome mail on user creation; reply to a message by e-mail', async () => {
    const admin = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    await enableMail();
    const s = await newSynagogue(admin, { name: 'אהל משה' });
    const u = await call('POST', '/admin/users', { token: admin, body: { name: 'גבאי', email: 'g@x.com', phone: nextPhone(), password: '1234', role: 'manager', synagogue_ids: [s.id], send_welcome: true } });
    assert.equal(u.body.welcome_sent, true);
    assert.match(sent.at(-1).body.text, /אהל משה/);
    const login = await call('POST', '/auth/email-link/verify', { body: { token: linkToken() } });
    assert.equal(login.body.user.email, 'g@x.com');

    // the staff is not signed in: a new message is e-mailed to them; the answer goes out by e-mail
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE is_super = 1)`).run();
    await setSetting('inbound_email', 'zmanim@smti.uk');
    const before = sent.length;
    await call('POST', '/me/messages', { token: login.body.token, body: { body: 'אפשר להוסיף ערבית?' } });
    assert.equal(sent.length, before + 1);
    assert.match(sent.at(-1).body.subject, /הודעה חדשה מגבאי \[#\d+\]/);
    assert.equal(sent.at(-1).body.reply_to, 'zmanim@smti.uk');
    await call('POST', '/me/messages', { token: login.body.token, body: { body: 'ועוד שאלה' } });
    assert.equal(sent.length, before + 1, 'not again within 20 minutes');

    const admin2 = (await call('POST', '/auth/login', { body: { login: 'admin@x.com', password: 'admin-pass-1' } })).body.token;
    const [c] = (await call('GET', '/admin/conversations', { token: admin2 })).body;
    const r = await call('POST', `/admin/conversations/${c.id}/messages`, { token: admin2, body: { body: 'בטח, נוסיף', send_email: true } });
    assert.equal(r.body.emailed, true);
    assert.match(sent.at(-1).body.text, /בטח, נוסיף/);
    assert.match(sent.at(-1).body.subject, new RegExp(`\\[#${c.id}\\]`));
    assert.equal(sent.at(-1).body.reply_to, 'zmanim@smti.uk');
    assert.equal((await call('GET', '/me/messages', { token: login.body.token })).body.messages.at(-1).body, 'בטח, נוסיף');
  });

  test('invisible characters are removed; a bad recipient gets a clear error', async () => {
    const admin = await setupAdmin();
    await enableMail();
    const pasted = '\u200F\u202Ana0527143567@Gmail.com\u202C\u200F';
    const u = await call('POST', '/admin/users', { token: admin, body: { name: '\u200Fנחמן ', email: pasted, phone: '\u200F052-714-3567', password: 'pass1234', role: 'manager' } });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    assert.equal(u.body.email, 'na0527143567@gmail.com');
    assert.equal(u.body.name, 'נחמן');
    assert.equal(u.body.phone, '0527143567');
    assert.equal((await call('POST', '/auth/login', { body: { login: pasted, password: 'pass1234' } })).status, 200, 'login with the pasted address too');
    await env.DB.prepare(`UPDATE users SET email = ? WHERE id = ?`).bind('not an email', u.body.id).run(); // old bad data
    const r = await call('POST', `/admin/users/${u.body.id}/welcome`, { token: admin });
    assert.equal(r.status, 422);
    assert.match(r.body.error.message, /כתובת המייל של הנמען אינה תקינה/);
  });

  test('e-mails look like the site: header, details, button, footer', async () => {
    const admin = await setupAdmin();
    await enableMail();
    const u = await call('POST', '/admin/users', { token: admin, body: { name: 'דוד', email: 'd@x.com', phone: '0521234567', password: 'pass1234', role: 'manager', send_welcome: true } });
    assert.equal(u.status, 201);
    const html = sent.at(-1).body.html;
    assert.match(html, /dir="rtl"/);
    assert.match(html, /מערכת זמני התפילות/);
    assert.match(html, /שלום דוד/);
    assert.match(html, /כניסה ישירה למערכת/);
    assert.doesNotMatch(html, /אם הכפתור לא עובד/);
    assert.match(html, /לא נשלחה במייל/, 'no password unless asked');
    assert.match(html, /שם משתמש/);
    assert.match(html, /כניסה עם חשבון Google/);
    assert.match(html, /href="[^"]*\/admin\/#\/link\?t=[0-9a-f]+"/);
    assert.match(html, /שמיעת הזמנים בטלפון/);
    assert.match(sent.at(-1).body.text, /שם משתמש: 0521234567 או d@x\.com/);
  });

  test('sign in with Google: our app, verified e-mail, existing active user', async () => {
    const admin = await setupAdmin();
    const google = (claims) => call('POST', '/auth/google', { body: { credential: JSON.stringify({ aud: '89500817024-tbvsuu4dci6bqh173l65ua9lc65pe24p.apps.googleusercontent.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600), ...claims }) } });
    const ok = await google({ email: 'Admin@x.com' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.token);
    assert.equal(ok.body.user.email, 'admin@x.com');
    const logins = (await call('GET', '/me/logins', { token: ok.body.token })).body;
    assert.match(logins[0].detail, /Google/);

    assert.equal((await google({ email: 'admin@x.com', aud: 'someone-else' })).status, 401, 'token for another app');
    assert.equal((await google({ email: 'admin@x.com', email_verified: 'false' })).status, 401);
    assert.equal((await google({ email: 'admin@x.com', exp: '1' })).status, 401, 'expired');
    assert.equal((await call('POST', '/auth/google', { body: { credential: 'bad' } })).status, 401);
    const nobody = await google({ email: 'nobody@x.com' });
    assert.equal(nobody.status, 401);
    assert.match(nobody.body.error.message, /אין במערכת משתמש פעיל עם המייל nobody@x\.com/);

    await call('PATCH', '/admin/control', { token: admin, body: { google_login_enabled: false } }); // not super: refused
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    await call('PATCH', '/admin/control', { token: admin, body: { google_login_enabled: false } });
    assert.equal((await google({ email: 'admin@x.com' })).status, 403);
    assert.equal((await call('GET', '/auth/options')).body.google_client_id, null);
  });

  test('password by e-mail only when chosen; forced change before anything else', async () => {
    const admin = await setupAdmin();
    await enableMail();
    const u = await call('POST', '/admin/users', { token: admin, body: { name: 'רבקה', email: 'r@x.com', phone: '0529998877', password: 'temp1234', role: 'manager', send_welcome: true, send_password: true, must_change_password: true } });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    assert.equal(u.body.must_change_password, true);
    assert.match(sent.at(-1).body.html, /temp1234/);
    assert.match(sent.at(-1).body.html, /תתבקשו לבחור סיסמה חדשה/);

    const login = await call('POST', '/auth/login', { body: { login: 'r@x.com', password: 'temp1234' } });
    const t = login.body.token;
    assert.equal(login.body.user.must_change_password, true);
    const blocked = await call('GET', '/synagogues', { token: t });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await call('GET', '/me', { token: t })).status, 200);
    assert.ok((await call('PUT', '/me/password', { token: t, body: { new_password: 'temp1234' } })).body.error.fields.new_password, 'must differ');
    assert.equal((await call('PUT', '/me/password', { token: t, body: { new_password: 'mine-5678' } })).status, 204, 'no current password needed');
    assert.equal((await call('GET', '/synagogues', { token: t })).status, 200);
    assert.equal((await call('GET', '/me', { token: t })).body.user.must_change_password, false);

    // admin sets a new password later and sends it, without the password: details only
    await call('PATCH', `/admin/users/${u.body.id}`, { token: admin, body: { send_welcome: true } });
    assert.match(sent.at(-1).body.html, /לא נשלחה במייל/);
    await call('PATCH', `/admin/users/${u.body.id}`, { token: admin, body: { password: 'again999', send_welcome: true, send_password: true } });
    assert.match(sent.at(-1).body.html, /again999/);
  });

  test('the system name is a setting used everywhere', async () => {
    const admin = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    await enableMail();
    await call('PATCH', '/admin/control', { token: admin, body: { system_name: 'זמני תפילה בעיר' } });
    assert.equal((await call('GET', '/public/catalog')).body.site.name, 'זמני תפילה בעיר');
    assert.equal((await call('GET', '/auth/options')).body.system_name, 'זמני תפילה בעיר');
    assert.equal((await call('GET', '/me', { token: admin })).body.system.name, 'זמני תפילה בעיר');
    await call('POST', '/admin/control/test-mail', { token: admin });
    assert.match(sent.at(-1).body.subject, /זמני תפילה בעיר/);
    assert.match(sent.at(-1).body.html, /זמני תפילה בעיר/);
  });

  describe('self-service registration', () => {
    const open = async () => { await enableMail(); await setSetting('registration_enabled', '1'); };
    const formToken = async () => {
      const f = await call('GET', '/public/registrations/form');
      assert.equal(f.body.enabled, true);
      // pretend the form was opened a minute ago (the server rejects forms sent back within seconds)
      const ts = String(Math.floor(Date.now() / 1000) - 60);
      const { createHmac } = await import('node:crypto');
      const secret = (await env.DB.prepare(`SELECT value FROM settings WHERE key = 'form_secret'`).first()).value;
      return `${ts}.${createHmac('sha256', secret).update(ts).digest('hex').slice(0, 32)}`;
    };
    const request = async (extra = {}) => call('POST', '/public/registrations', { body: {
      synagogue_name: 'פאר הנצח', area_id: 1, address: 'רחוב הנביאים 5', contact_name: 'נחמן', email: 'nachman@x.com', phone: '0527143567',
      message: 'נשמח להצטרף', form_token: await formToken(), ...extra } });
    const verifyToken = () => /#\/verify\?t=([0-9a-f]+)/.exec(sent.at(-1).body.text)[1];

    test('closed by default; open needs mail', async () => {
      assert.equal((await call('GET', '/public/registrations/form')).body.enabled, false);
      await setSetting('registration_enabled', '1');
      assert.equal((await call('GET', '/public/registrations/form')).body.enabled, false, 'no mail, no verification, closed');
      await enableMail();
      assert.equal((await call('GET', '/public/registrations/form')).body.enabled, true);
    });

    test('verify e-mail, super admin approves: synagogue + manager who must choose a password', async () => {
      const admin = await setupAdmin();
      await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
      await call('POST', '/admin/catalog/areas', { token: admin, body: { name: 'רמות' } });
      await open();
      const r = await request();
      assert.equal(r.status, 202);
      assert.match(sent.at(-1).body.subject, /אימות המייל/);
      const waiting = (await call('GET', '/admin/registrations', { token: admin })).body;
      assert.deepEqual([waiting.unverified, waiting.items[0].status], [1, 'unverified'], 'unverified is shown to the approver');
      const before = sent.length;
      const v = await call('POST', '/public/registrations/verify', { body: { token: verifyToken() } });
      assert.equal(v.body.status, 'pending');
      assert.equal(sent.length, before + 1, 'approver notified');
      assert.match(sent.at(-1).body.subject, /בקשה חדשה/);

      const list = (await call('GET', '/admin/registrations', { token: admin })).body.items;
      assert.equal(list[0].status, 'pending');
      assert.equal((await request()).status, 409, 'one open request per e-mail');
      const ok = await call('POST', `/admin/registrations/${list[0].id}/approve`, { token: admin, body: {} });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.user_created, true);
      assert.equal(ok.body.mail, 'sent');
      assert.match(sent.at(-1).body.html, /כניסה ישירה למערכת/);
      const u = await env.DB.prepare(`SELECT * FROM users WHERE email = 'nachman@x.com'`).first();
      assert.equal(u.must_change_password, 1);
      const syn = await env.DB.prepare(`SELECT * FROM synagogue_managers WHERE user_id = ?`).bind(u.id).first();
      assert.equal(syn.synagogue_id, ok.body.synagogue_id);
      assert.equal((await call('POST', `/admin/registrations/${list[0].id}/approve`, { token: admin, body: {} })).status, 409, 'already handled');
    });

    test('spam is dropped silently; limits; blocklist; reject and block', async () => {
      const admin = await setupAdmin();
      await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
      await open();
      const count = async () => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM registrations`).first()).n;
      assert.equal((await request({ website: 'http://spam' })).status, 202, 'honeypot');
      const fresh = (await call('GET', '/public/registrations/form')).body.form_token;
      assert.equal((await request({ form_token: fresh })).status, 202, 'too fast');
      assert.equal((await request({ form_token: '1.forged' })).status, 202, 'forged token');
      assert.equal((await request({ synagogue_name: 'buy now www.spam.com' })).status, 202, 'links');
      assert.equal(await count(), 0);

      await setSetting('registration_blocklist', '@bad.com\n0501231234');
      await request({ email: 'x@bad.com' });
      await request({ email: 'y@ok.com', phone: '050-123-1234' });
      assert.equal(await count(), 0, 'blocked by domain and phone');

      await request({ email: 'a@x.com' });
      await call('POST', '/public/registrations/verify', { body: { token: verifyToken() } });
      const [item] = (await call('GET', '/admin/registrations', { token: admin })).body.items.filter((r) => r.status === 'pending');
      const rej = await call('POST', `/admin/registrations/${item.id}/reject`, { token: admin, body: { reason: 'לא מוכר', block: true } });
      assert.equal(rej.body.status, 'rejected');
      assert.match((await call('GET', '/admin/control', { token: admin })).body.registration_blocklist, /a@x\.com/);

      // per-IP limit: 3 an hour (the earlier tries in this test counted too)
      let last;
      for (let i = 0; i < 4; i++) last = await request({ email: `n${i}@ok.com`, phone: `05271435${60 + i}` });
      assert.equal(last.status, 429);
    });
  });

  test('admin permissions: only the super admin sets them; each action checks its permission', async () => {
    const superT = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    const mk = await call('POST', '/admin/users', { token: superT, body: { name: 'עוזר', email: 'help@x.com', phone: '0531112233', password: 'help1234', role: 'admin', admin_perms: ['managers'] } });
    assert.equal(mk.status, 201, JSON.stringify(mk.body));
    assert.deepEqual(mk.body.perms, ['managers']);
    const t = (await call('POST', '/auth/login', { body: { login: 'help@x.com', password: 'help1234' } })).body.token;
    assert.deepEqual((await call('GET', '/me', { token: t })).body.user.perms, ['managers']);

    assert.equal((await call('POST', '/admin/catalog/areas', { token: t, body: { name: 'חדש' } })).status, 403);
    assert.equal((await call('POST', '/admin/synagogues', { token: t, body: { name: 'x', area_id: 1 } })).status, 403);
    assert.equal((await call('GET', '/admin/ivr', { token: t })).status, 403);
    assert.equal((await call('GET', '/admin/registrations', { token: t })).status, 403);
    assert.equal((await call('POST', '/admin/users', { token: t, body: { name: 'מ', email: 'm@x.com', phone: '0531112244', password: 'pass1234', role: 'manager' } })).status, 201, 'managers: allowed');
    assert.equal((await call('POST', '/admin/users', { token: t, body: { name: 'א', email: 'a2@x.com', phone: '0531112255', password: 'pass1234', role: 'admin' } })).status, 403, 'admins: not allowed');
    assert.equal((await call('PATCH', `/admin/users/${mk.body.id}`, { token: t, body: { admin_perms: ['catalog'] } })).status, 403, 'cannot grant itself');

    const s = await call('POST', '/admin/synagogues', { token: superT, body: { name: 'בדיקה', area_id: 1 } });
    assert.equal((await call('POST', `/synagogues/${s.body.id}/minyanim`, { token: t, body: { prayer_id: 1, time_kind: 'fixed', time: '07:00', season_id: 1 } })).status, 403, 'no minyanim permission');
    assert.equal((await call('GET', `/synagogues/${s.body.id}`, { token: t })).status, 200, 'can still look');

    // standard set for admins without a stored list: everything but approving registrations
    const std = await call('POST', '/admin/users', { token: superT, body: { name: 'רגיל', email: 'std@x.com', phone: '0531112266', password: 'pass1234', role: 'admin' } });
    assert.ok(std.body.perms.includes('catalog') && !std.body.perms.includes('registrations'));
  });

  test('approver controls unverified requests: resend, verify by hand, block', async () => {
    const admin = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    await enableMail();
    await setSetting('registration_enabled', '1');
    const ts = String(Math.floor(Date.now() / 1000) - 60);
    await call('GET', '/public/registrations/form');
    const { createHmac } = await import('node:crypto');
    const secret = (await env.DB.prepare(`SELECT value FROM settings WHERE key = 'form_secret'`).first()).value;
    const token = `${ts}.${createHmac('sha256', secret).update(ts).digest('hex').slice(0, 32)}`;
    const send = (email, phone) => call('POST', '/public/registrations', { body: { synagogue_name: 'בית אל', contact_name: 'יוסף', email, phone, form_token: token } });
    await send('one@x.com', '0521000001');
    await send('two@spam.com', '0521000002');
    const items = (await call('GET', '/admin/registrations', { token: admin })).body.items;
    const one = items.find((r) => r.email === 'one@x.com');
    const two = items.find((r) => r.email === 'two@spam.com');

    const before = sent.length;
    assert.equal((await call('POST', `/admin/registrations/${one.id}/resend`, { token: admin })).body.sent_to, 'one@x.com');
    assert.equal(sent.length, before + 1);
    assert.equal((await call('POST', `/admin/registrations/${one.id}/verify`, { token: admin })).body.status, 'pending');
    assert.equal((await call('POST', `/admin/registrations/${one.id}/resend`, { token: admin })).status, 409, 'already verified');

    const b = await call('POST', `/admin/registrations/${two.id}/block`, { token: admin, body: { what: ['domain', 'phone'] } });
    assert.deepEqual(b.body.blocked, ['@spam.com', '0521000002']);
    const after = (await call('GET', '/admin/registrations', { token: admin })).body.items.find((r) => r.id === two.id);
    assert.equal(after.status, 'rejected');
    assert.equal(after.blocked, true);
    assert.match((await call('GET', '/admin/control', { token: admin })).body.registration_blocklist, /@spam\.com\n0521000002/);
  });

  test('locks: see who is locked, unlock one user or everything, lock by hand', async () => {
    const admin = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    const m = await call('POST', '/admin/users', { token: admin, body: { name: 'יעקב', email: 'yaakov@x.com', phone: '0541234567', password: 'right123', role: 'manager' } });
    for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { body: { login: '‏Yaakov@x.com', password: 'wrong' } });
    assert.equal((await call('POST', '/auth/login', { body: { login: 'yaakov@x.com', password: 'right123' } })).status, 429, 'locked');

    const locks = (await call('GET', '/admin/locks', { token: admin })).body;
    const mine = locks.find((l) => l.kind === 'login');
    assert.equal(mine.user.name, 'יעקב');
    assert.equal(mine.locked, true);
    assert.ok(locks.some((l) => l.kind === 'ip'));
    const users = (await call('GET', '/admin/users', { token: admin })).body;
    assert.ok(users.find((u) => u.id === m.body.id).locked_until, 'users page shows the lock');

    assert.equal((await call('POST', `/admin/users/${m.body.id}/unlock`, { token: admin })).status, 204);
    assert.equal((await call('POST', '/auth/login', { body: { login: 'yaakov@x.com', password: 'right123' } })).status, 200);

    const l = await call('POST', '/admin/locks', { token: admin, body: { type: 'ip', value: '10.0.0.9', hours: 2 } });
    assert.equal(l.body.key, 'ip:10.0.0.9');
    assert.ok((await call('GET', '/admin/locks', { token: admin })).body.find((x) => x.key === 'ip:10.0.0.9').locked);
    assert.equal((await call('DELETE', '/admin/locks?key=ip%3A10.0.0.9', { token: admin })).status, 204);
    await call('POST', '/admin/locks', { token: admin, body: { type: 'login', value: '054-123-4567', hours: 1 } });
    assert.equal((await call('POST', '/auth/login', { body: { login: '0541234567', password: 'right123' } })).status, 429, 'locked by hand');
    assert.equal((await call('DELETE', '/admin/locks', { token: admin })).status, 204, 'unlock everything');
    assert.equal((await call('POST', '/auth/login', { body: { login: '0541234567', password: 'right123' } })).status, 200);
    assert.equal((await call('GET', '/admin/locks', { token: m.body.token })).status, 401);
  });

  test('every minyan change is logged: who, how, what', async () => {
    const admin = await setupAdmin();
    const s = await newSynagogue(admin);
    const m = await createManager(admin, 'log@x.com', [s.id]);
    const base = `/synagogues/${s.id}/minyanim`;
    const created = (await call('POST', base, { token: m.token, body: { prayer_id: 1, time_kind: 'fixed', time: '07:00', season_id: 1 } })).body;
    assert.equal(created.updated_by_name, 'גבאי');
    assert.equal(created.updated_via, 'web');
    await call('PATCH', `${base}/${created.id}`, { token: admin, body: { time: '07:15' } });
    await call('PATCH', `${base}/${created.id}`, { token: admin, body: { is_active: false } });
    await call('POST', `${base}/${created.id}/duplicate`, { token: m.token });
    await call('DELETE', `${base}/${created.id}`, { token: m.token });
    const log = (await call('GET', `/synagogues/${s.id}/log`, { token: m.token })).body;
    assert.deepEqual(log.map((l) => l.action), ['delete', 'duplicate', 'hide', 'update', 'create']);
    assert.match(log.find((l) => l.action === 'update').summary, /שעה: 07:00 ← 07:15/);
    assert.equal(log.find((l) => l.action === 'update').user_name, 'מנהל');
    assert.match(log[0].summary, /^נמחק: שחרית 07:15/);
    const one = (await call('GET', `/synagogues/${s.id}/log?minyan_id=${created.id}`, { token: m.token })).body;
    assert.equal(one.length, 4);
  });

  test('incoming e-mail: replies, outside senders, the staff answering from the mailbox', async () => {
    const admin = await setupAdmin();
    await env.DB.prepare(`UPDATE users SET is_super = 1`).run();
    await enableMail();
    await setSetting('inbound_email', 'zmanim@smti.uk');
    const { default: worker } = await import('../src/index.js');
    const mail = (from, subject, text, headers = {}) => {
      const raw = [`From: ${from}`, 'To: zmanim@smti.uk', `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
        Buffer.from(text).toString('base64')].join('\r\n');
      const bytes = new TextEncoder().encode(raw);
      return worker.email({ from: from.replace(/.*</, '').replace('>', ''), to: 'zmanim@smti.uk', rawSize: bytes.length,
        headers: new Headers(headers), raw: new Response(bytes).body }, env);
    };

    // someone outside the system writes
    await mail('דוד לוי <david@out.com>', 'שאלה על מניין', 'מתי מנחה בבית הכנסת?\n\nOn Mon, someone wrote:\n> old');
    let list = (await call('GET', '/admin/conversations', { token: admin })).body;
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].email, list[0].name, list[0].subject, list[0].user_id], ['david@out.com', 'דוד לוי', 'שאלה על מניין', null]);
    const conv = (await call('GET', `/admin/conversations/${list[0].id}`, { token: admin })).body;
    assert.equal(conv.messages[0].body, 'מתי מנחה בבית הכנסת?', 'quoted part removed');
    assert.equal(conv.messages[0].via, 'email');

    // the staff answers in the system: always by e-mail for outside senders, tagged for the reply
    const before = sent.length;
    await call('POST', `/admin/conversations/${list[0].id}/messages`, { token: admin, body: { body: 'בשעה 13:30' } });
    assert.equal(sent.length, before + 1);
    assert.equal(sent.at(-1).body.to[0], 'david@out.com');
    assert.match(sent.at(-1).body.subject, /Re: שאלה על מניין \[#\d+\]/);

    // his reply lands in the same conversation
    await mail('david@out.com', `Re: שאלה על מניין [#${list[0].id}]`, 'תודה רבה!');
    assert.equal((await call('GET', `/admin/conversations/${list[0].id}`, { token: admin })).body.messages.at(-1).body, 'תודה רבה!');

    // the staff answers from the mailbox: goes into the conversation and on to the person
    const n = sent.length;
    await mail('admin@x.com', `Re: הודעה חדשה מדוד לוי [#${list[0].id}]`, 'בשמחה');
    const last = (await call('GET', `/admin/conversations/${list[0].id}`, { token: admin })).body.messages.at(-1);
    assert.deepEqual([last.sender, last.body, last.via], ['staff', 'בשמחה', 'email']);
    assert.equal(sent.length, n + 1);
    assert.equal(sent.at(-1).body.to[0], 'david@out.com');

    // auto-replies and blocked senders are ignored
    await mail('bot@out.com', 'Out of office', 'away', { 'Auto-Submitted': 'auto-replied' });
    await setSetting('registration_blocklist', '@spam.com');
    await mail('x@spam.com', 'buy', 'buy now');
    assert.equal((await call('GET', '/admin/conversations', { token: admin })).body.length, 1);
    const elog = (await call('GET', '/admin/email-log', { token: admin })).body;
    assert.deepEqual(elog.map((l) => l.status), ['ignored', 'ignored', 'accepted', 'accepted', 'accepted']);
    assert.equal(elog[0].detail, 'שולח חסום');
    assert.equal(elog[1].detail, 'מענה אוטומטי');
  });

  test('managers of a synagogue: add an existing manager, remove; dashboard shows activity', async () => {
    const admin = await setupAdmin();
    const s1 = await newSynagogue(admin);
    const s2 = await newSynagogue(admin);
    const m = await createManager(admin, 'two@x.com', [s1.id]);
    assert.equal((await call('POST', `/admin/synagogues/${s2.id}/managers`, { token: admin, body: { user_id: m.id } })).status, 204);
    assert.deepEqual((await call('GET', '/synagogues', { token: m.token })).body.items.map((s) => s.id).sort(), [s1.id, s2.id].sort());
    const ws = (await call('GET', `/synagogues/${s2.id}`, { token: admin })).body;
    assert.equal(ws.managers[0].email, 'two@x.com');
    assert.equal((await call('DELETE', `/admin/synagogues/${s2.id}/managers/${m.id}`, { token: admin })).status, 204);
    assert.deepEqual((await call('GET', '/synagogues', { token: m.token })).body.items.map((s) => s.id), [s1.id]);
    await call('POST', `/synagogues/${s1.id}/minyanim`, { token: m.token, body: { prayer_id: 1, time_kind: 'fixed', time: '06:45', season_id: 1 } });
    const stats = (await call('GET', '/admin/stats', { token: admin })).body;
    assert.match(stats.activity[0].summary, /נוסף: שחרית 06:45/);
    assert.equal(stats.activity[0].synagogue_name, s1.name);
  });
});
