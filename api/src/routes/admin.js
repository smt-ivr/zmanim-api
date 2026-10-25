// Admin-only: synagogues (with their manager settings), users, catalog and stats.
import { hashPassword, publicUser, revokeSessions } from '../auth.js';
import { all, batch, first, marks, nowIso, q, run, setClause } from '../db.js';
import { conflict, forbidden, invalid, json, noContent, notFound, readJson } from '../http.js';
import { fields, id } from '../validate.js';
import { synagogueInfo, synagogueSettings } from './workspace.js';

// ------------------------------------------------------------------ helpers
async function assertIdsExist(env, table, ids, field) {
  if (!ids?.length) return;
  const rows = await all(env, `SELECT id FROM ${table} WHERE id IN (${marks(ids.length)})`, ...ids);
  if (rows.length !== ids.length) throw invalid({ [field]: 'חלק מהערכים לא קיימים' });
}

const replaceLinks = (env, table, ownerCol, ownerId, otherCol, ids) => [
  q(env, `DELETE FROM ${table} WHERE ${ownerCol} = ?`, ownerId),
  ...ids.map((x) => q(env, `INSERT INTO ${table} (${ownerCol}, ${otherCol}) VALUES (?, ?)`, ownerId, x)),
];

// ------------------------------------------------------------------ stats
export async function stats({ env }) {
  const row = await first(
    env,
    `SELECT (SELECT COUNT(*) FROM synagogues) AS synagogues,
            (SELECT COUNT(*) FROM synagogues WHERE is_active = 1) AS active_synagogues,
            (SELECT COUNT(*) FROM minyanim) AS minyanim,
            (SELECT COUNT(*) FROM users WHERE role = 'manager') AS managers,
            (SELECT COUNT(*) FROM synagogues s WHERE NOT EXISTS (SELECT 1 FROM synagogue_managers sm WHERE sm.synagogue_id = s.id)) AS unmanaged`
  );
  const recent = await all(
    env,
    `SELECT s.id, s.name, MAX(m.updated_at) AS updated_at FROM minyanim m JOIN synagogues s ON s.id = m.synagogue_id
     GROUP BY s.id ORDER BY updated_at DESC LIMIT 8`
  );
  return json({ ...row, recent });
}

// ------------------------------------------------------------------ synagogues
function parseSynagogue(body, partial) {
  return fields(body, { partial })
    .str('name', { required: true, max: 120 })
    .int('area_id', { nullable: true, min: 1 })
    .str('address', { max: 200 })
    .str('phone', { max: 30 })
    .str('notes', { max: 1000 })
    .bool('is_active', { default: true })
    .bool('can_edit_info', { default: true })
    .int('max_locations', { min: 0, max: 100, default: 5 })
    .int('max_minyanim', { min: 0, max: 1000, default: 50 })
    .bool('restrict_prayers', { default: false })
    .ids('allowed_prayer_ids', { default: [] })
    .ids('manager_ids', { default: [] })
    .done();
}

const SYN_COLUMNS = ['name', 'area_id', 'address', 'phone', 'notes', 'is_active', 'can_edit_info', 'max_locations', 'max_minyanim', 'restrict_prayers'];

async function validateLinks(env, d) {
  await assertIdsExist(env, 'areas', d.area_id ? [d.area_id] : [], 'area_id');
  await assertIdsExist(env, 'prayers', d.allowed_prayer_ids, 'allowed_prayer_ids');
  if (d.manager_ids?.length) {
    const rows = await all(env, `SELECT id FROM users WHERE role = 'manager' AND id IN (${marks(d.manager_ids.length)})`, ...d.manager_ids);
    if (rows.length !== d.manager_ids.length) throw invalid({ manager_ids: 'ניתן לשייך רק משתמשים מסוג מנהל בית כנסת' });
  }
}

async function adminSynagogue(env, sid) {
  const s = await first(env, `SELECT s.*, a.name AS area_name FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id WHERE s.id = ?`, sid);
  if (!s) throw notFound('בית הכנסת לא נמצא');
  const managers = await all(env, `SELECT u.id, u.name, u.email FROM synagogue_managers sm JOIN users u ON u.id = sm.user_id WHERE sm.synagogue_id = ? ORDER BY u.name`, sid);
  const { n } = await first(env, `SELECT COUNT(*) AS n FROM minyanim WHERE synagogue_id = ?`, sid);
  return { ...synagogueInfo(s), settings: await synagogueSettings(env, s), managers, minyanim_count: n, created_at: s.created_at, updated_at: s.updated_at };
}

export async function listSynagogues({ env }) {
  const rows = await all(
    env,
    `SELECT s.*, a.name AS area_name,
            (SELECT COUNT(*) FROM minyanim m WHERE m.synagogue_id = s.id) AS minyanim_count,
            (SELECT COUNT(*) FROM locations l WHERE l.synagogue_id = s.id) AS locations_count,
            (SELECT json_group_array(json_object('id', u.id, 'name', u.name))
               FROM synagogue_managers sm JOIN users u ON u.id = sm.user_id WHERE sm.synagogue_id = s.id) AS managers_json
     FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id ORDER BY s.name`
  );
  const prayerLinks = await all(env, `SELECT synagogue_id, prayer_id FROM synagogue_prayers`);
  return json(
    rows.map((s) => ({
      ...synagogueInfo(s),
      settings: {
        can_edit_info: s.can_edit_info === 1,
        max_locations: s.max_locations,
        max_minyanim: s.max_minyanim,
        restrict_prayers: s.restrict_prayers === 1,
        allowed_prayer_ids: s.restrict_prayers ? prayerLinks.filter((l) => l.synagogue_id === s.id).map((l) => l.prayer_id) : null,
      },
      managers: JSON.parse(s.managers_json || '[]'),
      minyanim_count: s.minyanim_count,
      locations_count: s.locations_count,
    }))
  );
}

export async function getSynagogue({ env, params }) {
  return json(await adminSynagogue(env, id(params.id)));
}

export async function createSynagogue({ env, request }) {
  const d = parseSynagogue(await readJson(request), false);
  await validateLinks(env, d);
  const set = setClause(d, SYN_COLUMNS);
  const res = await run(env, `INSERT INTO synagogues (${set.keys.join(', ')}) VALUES (${marks(set.keys.length)})`, ...set.params);
  const sid = res.meta.last_row_id;
  await batch(env, [
    ...replaceLinks(env, 'synagogue_prayers', 'synagogue_id', sid, 'prayer_id', d.allowed_prayer_ids),
    ...replaceLinks(env, 'synagogue_managers', 'synagogue_id', sid, 'user_id', d.manager_ids),
  ]);
  return json(await adminSynagogue(env, sid), 201);
}

export async function patchSynagogue({ env, params, request }) {
  const sid = id(params.id);
  const current = await first(env, `SELECT id FROM synagogues WHERE id = ?`, sid);
  if (!current) throw notFound('בית הכנסת לא נמצא');
  const d = parseSynagogue(await readJson(request), true);
  await validateLinks(env, d);
  const set = setClause(d, SYN_COLUMNS);
  const statements = [];
  if (set.keys.length) statements.push(q(env, `UPDATE synagogues SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, nowIso(), sid));
  if (d.allowed_prayer_ids) statements.push(...replaceLinks(env, 'synagogue_prayers', 'synagogue_id', sid, 'prayer_id', d.allowed_prayer_ids));
  if (d.manager_ids) statements.push(...replaceLinks(env, 'synagogue_managers', 'synagogue_id', sid, 'user_id', d.manager_ids));
  if (statements.length) await batch(env, statements);
  return json(await adminSynagogue(env, sid));
}

/** Deletes the synagogue with its locations and minyanim. The UI asks for confirmation by name. */
export async function deleteSynagogue({ env, params }) {
  const sid = id(params.id);
  const res = await run(env, `DELETE FROM synagogues WHERE id = ?`, sid);
  if (!res.meta.changes) throw notFound('בית הכנסת לא נמצא');
  return noContent();
}

// ------------------------------------------------------------------ users
async function adminUser(env, uid) {
  const u = await first(env, `SELECT * FROM users WHERE id = ?`, uid);
  if (!u) throw notFound('המשתמש לא נמצא');
  const synagogues = await all(env, `SELECT s.id, s.name FROM synagogue_managers sm JOIN synagogues s ON s.id = sm.synagogue_id WHERE sm.user_id = ? ORDER BY s.name`, uid);
  return { ...publicUser(u), synagogues };
}

export async function listUsers({ env }) {
  const rows = await all(
    env,
    `SELECT u.*, (SELECT json_group_array(json_object('id', s.id, 'name', s.name))
                    FROM synagogue_managers sm JOIN synagogues s ON s.id = sm.synagogue_id WHERE sm.user_id = u.id) AS synagogues_json
     FROM users u ORDER BY u.role, u.name`
  );
  return json(rows.map((u) => ({ ...publicUser(u), synagogues: JSON.parse(u.synagogues_json || '[]') })));
}

function parseUser(body, partial) {
  return fields(body, { partial })
    .str('name', { required: true, max: 80 })
    .email('email', { required: true })
    .str('phone', { max: 30 })
    .oneOf('role', ['admin', 'manager'], { required: true })
    .bool('is_active', { default: true })
    .password('password', { required: !partial })
    .ids('synagogue_ids', { default: [] })
    .done();
}

async function emailTaken(env, email, exceptId = 0) {
  return Boolean(await first(env, `SELECT id FROM users WHERE email = ? AND id != ?`, email, exceptId));
}

export async function createUser({ env, request }) {
  const d = parseUser(await readJson(request), false);
  if (await emailTaken(env, d.email)) throw invalid({ email: 'המייל כבר רשום במערכת' });
  await assertIdsExist(env, 'synagogues', d.synagogue_ids, 'synagogue_ids');
  const res = await run(
    env,
    `INSERT INTO users (name, email, phone, role, is_active, password_hash) VALUES (?, ?, ?, ?, ?, ?)`,
    d.name, d.email, d.phone ?? '', d.role, d.is_active ? 1 : 0, await hashPassword(d.password)
  );
  const uid = res.meta.last_row_id;
  if (d.role === 'manager' && d.synagogue_ids.length) {
    await batch(env, replaceLinks(env, 'synagogue_managers', 'user_id', uid, 'synagogue_id', d.synagogue_ids));
  }
  return json(await adminUser(env, uid), 201);
}

export async function patchUser({ env, actor, params, request }) {
  const uid = id(params.id);
  const current = await first(env, `SELECT * FROM users WHERE id = ?`, uid);
  if (!current) throw notFound('המשתמש לא נמצא');
  const d = parseUser(await readJson(request), true);

  if (uid === actor.id && ((d.role && d.role !== 'admin') || d.is_active === false)) {
    throw forbidden('לא ניתן להוריד הרשאות או להשבית את עצמך');
  }
  if (d.email && (await emailTaken(env, d.email, uid))) throw invalid({ email: 'המייל כבר רשום במערכת' });
  if (d.synagogue_ids) await assertIdsExist(env, 'synagogues', d.synagogue_ids, 'synagogue_ids');

  const role = d.role ?? current.role;
  const data = { ...d, updated_at: nowIso() };
  if (d.password) data.password_hash = await hashPassword(d.password);
  const set = setClause(data, ['name', 'email', 'phone', 'role', 'is_active', 'password_hash', 'updated_at']);
  const statements = [q(env, `UPDATE users SET ${set.sql} WHERE id = ?`, ...set.params, uid)];
  if (role === 'admin') statements.push(q(env, `DELETE FROM synagogue_managers WHERE user_id = ?`, uid));
  else if (d.synagogue_ids) statements.push(...replaceLinks(env, 'synagogue_managers', 'user_id', uid, 'synagogue_id', d.synagogue_ids));
  await batch(env, statements);

  // New password or deactivation signs the user out everywhere.
  if (d.password || d.is_active === false) await revokeSessions(env, uid, uid === actor.id ? actor.session_id : 0);
  return json(await adminUser(env, uid));
}

export async function deleteUser({ env, actor, params }) {
  const uid = id(params.id);
  if (uid === actor.id) throw forbidden('לא ניתן למחוק את עצמך');
  const res = await run(env, `DELETE FROM users WHERE id = ?`, uid);
  if (!res.meta.changes) throw notFound('המשתמש לא נמצא');
  return noContent();
}

// ------------------------------------------------------------------ catalog
// One generic CRUD for the four reference lists. Table and columns come from this map only.
const CATALOG = {
  areas: {
    table: 'areas',
    usedBy: `SELECT COUNT(*) AS n FROM synagogues WHERE area_id = ?`,
    parse: (b, partial) => fields(b, { partial }).str('name', { required: true, max: 60 }).int('sort', { default: 0 }).done(),
    columns: ['name', 'sort'],
  },
  prayers: {
    table: 'prayers',
    usedBy: `SELECT COUNT(*) AS n FROM minyanim WHERE prayer_id = ?`,
    parse: (b, partial) =>
      fields(b, { partial })
        .str('name', { required: true, max: 60 })
        .int('sort', { default: 0 })
        .time('earliest', { nullable: true, default: null })
        .time('latest', { nullable: true, default: null })
        .done(),
    columns: ['name', 'sort', 'earliest', 'latest'],
  },
  seasons: {
    table: 'seasons',
    usedBy: `SELECT COUNT(*) AS n FROM minyanim WHERE season_id = ?`,
    parse: (b, partial) =>
      fields(b, { partial }).str('name', { required: true, max: 60 }).int('sort', { default: 0 }).bool('is_default', { default: false }).done(),
    columns: ['name', 'sort', 'is_default'],
  },
  anchors: {
    table: 'anchors',
    usedBy: `SELECT COUNT(*) AS n FROM minyanim WHERE anchor_id = ?`,
    parse: (b, partial) => fields(b, { partial }).str('name', { required: true, max: 60 }).int('sort', { default: 0 }).done(),
    columns: ['name', 'sort'],
  },
};

function catalogDef(kind) {
  const def = CATALOG[kind];
  if (!def) throw notFound('רשימה לא קיימת');
  return def;
}

export const serializeCatalogRow = (row) => ('is_default' in row ? { ...row, is_default: row.is_default === 1 } : row);

export async function listCatalog({ env, params }) {
  const def = catalogDef(params.kind);
  const rows = await all(env, `SELECT t.*, (${def.usedBy.replace('= ?', '= t.id')}) AS used FROM ${def.table} t ORDER BY t.sort, t.id`);
  return json(rows.map(serializeCatalogRow));
}

async function saveCatalog(env, def, d, rowId) {
  const set = setClause(d, def.columns);
  const statements = [];
  if (d.is_default === true) statements.push(q(env, `UPDATE ${def.table} SET is_default = 0`));
  try {
    if (rowId) {
      if (set.keys.length) statements.push(q(env, `UPDATE ${def.table} SET ${set.sql} WHERE id = ?`, ...set.params, rowId));
      if (statements.length) await batch(env, statements);
      return rowId;
    }
    statements.push(q(env, `INSERT INTO ${def.table} (${set.keys.join(', ')}) VALUES (${marks(set.keys.length)})`, ...set.params));
    const results = await batch(env, statements);
    return results.at(-1).meta.last_row_id;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw invalid({ name: 'השם כבר קיים ברשימה' });
    throw e;
  }
}

export async function createCatalog({ env, params, request }) {
  const def = catalogDef(params.kind);
  const newId = await saveCatalog(env, def, def.parse(await readJson(request), false), 0);
  return json(serializeCatalogRow(await first(env, `SELECT * FROM ${def.table} WHERE id = ?`, newId)), 201);
}

export async function patchCatalog({ env, params, request }) {
  const def = catalogDef(params.kind);
  const rowId = id(params.id);
  if (!(await first(env, `SELECT id FROM ${def.table} WHERE id = ?`, rowId))) throw notFound();
  await saveCatalog(env, def, def.parse(await readJson(request), true), rowId);
  return json(serializeCatalogRow(await first(env, `SELECT * FROM ${def.table} WHERE id = ?`, rowId)));
}

export async function deleteCatalog({ env, params }) {
  const def = catalogDef(params.kind);
  const rowId = id(params.id);
  const { n } = await first(env, def.usedBy, rowId);
  if (n > 0) throw conflict(`לא ניתן למחוק: בשימוש ב-${n} רשומות`, 'IN_USE');
  const res = await run(env, `DELETE FROM ${def.table} WHERE id = ?`, rowId);
  if (!res.meta.changes) throw notFound();
  return noContent();
}
