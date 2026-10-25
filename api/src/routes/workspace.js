// The synagogue workspace: everything a manager does inside "their" synagogue.
// Admins can open any synagogue the same way.
import { requireSynagogue } from '../auth.js';
import { all, batch, first, nowIso, q, run, setClause } from '../db.js';
import { conflict, forbidden, json, noContent, notFound, readJson } from '../http.js';
import { ALL_DAYS, getMinyan, listMinyanim, validateMinyan } from '../minyan.js';
import { fields, id } from '../validate.js';

async function loadSynagogue(env, actor, rawId) {
  const sid = id(rawId);
  requireSynagogue(actor, sid);
  const s = await first(env, `SELECT * FROM synagogues WHERE id = ?`, sid);
  if (!s) throw notFound('בית הכנסת לא נמצא');
  return s;
}

export function synagogueInfo(s) {
  return {
    id: s.id,
    name: s.name,
    area_id: s.area_id,
    area_name: s.area_name ?? null,
    address: s.address,
    phone: s.phone,
    notes: s.notes,
    is_active: s.is_active === 1,
  };
}

export async function synagogueSettings(env, s) {
  const allowed = s.restrict_prayers
    ? (await all(env, `SELECT prayer_id FROM synagogue_prayers WHERE synagogue_id = ?`, s.id)).map((r) => r.prayer_id)
    : null;
  return {
    can_edit_info: s.can_edit_info === 1,
    max_locations: s.max_locations,
    max_minyanim: s.max_minyanim,
    restrict_prayers: s.restrict_prayers === 1,
    allowed_prayer_ids: allowed,
  };
}

const listLocations = (env, sid) =>
  all(
    env,
    `SELECT l.id, l.name, l.sort, (SELECT COUNT(*) FROM minyanim m WHERE m.location_id = l.id) AS minyanim_count
     FROM locations l WHERE l.synagogue_id = ? ORDER BY l.sort, l.id`,
    sid
  );

/** GET /synagogues — the synagogues I can open. */
export async function list({ env, actor }) {
  const scope = actor.role === 'admin' ? '' : `WHERE s.id IN (SELECT synagogue_id FROM synagogue_managers WHERE user_id = ?)`;
  const rows = await all(
    env,
    `SELECT s.*, a.name AS area_name,
            (SELECT COUNT(*) FROM minyanim m WHERE m.synagogue_id = s.id) AS minyanim_count
     FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id ${scope} ORDER BY s.name`,
    ...(scope ? [actor.id] : [])
  );
  return json(rows.map((s) => ({ ...synagogueInfo(s), minyanim_count: s.minyanim_count })));
}

/** GET /synagogues/:sid — loads the whole workspace in one call. */
export async function get({ env, actor, params }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const [area, settings, locations, minyanim, prayers, seasons, anchors, areas, managers] = await Promise.all([
    s.area_id ? first(env, `SELECT name FROM areas WHERE id = ?`, s.area_id) : null,
    synagogueSettings(env, s),
    listLocations(env, s.id),
    listMinyanim(env, s.id),
    all(env, `SELECT id, name, earliest, latest FROM prayers ORDER BY sort, id`),
    all(env, `SELECT id, name, is_default FROM seasons ORDER BY sort, id`),
    all(env, `SELECT id, name FROM anchors ORDER BY sort, id`),
    all(env, `SELECT id, name FROM areas ORDER BY sort, name`),
    all(env, `SELECT u.id, u.name FROM synagogue_managers sm JOIN users u ON u.id = sm.user_id WHERE sm.synagogue_id = ? ORDER BY u.name`, s.id),
  ]);
  const allowed = settings.allowed_prayer_ids;
  return json({
    synagogue: synagogueInfo({ ...s, area_name: area?.name }),
    settings,
    usage: { locations: locations.length, minyanim: minyanim.length },
    locations,
    minyanim,
    managers,
    catalog: {
      prayers: allowed ? prayers.filter((p) => allowed.includes(p.id)) : prayers,
      seasons: seasons.map((x) => ({ ...x, is_default: x.is_default === 1 })),
      anchors,
      areas,
    },
  });
}

/** PATCH /synagogues/:sid — public details. Managers need can_edit_info. */
export async function patch({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  if (actor.role !== 'admin' && !s.can_edit_info) throw forbidden('מנהל המערכת לא אפשר עריכת פרטי בית הכנסת');
  const d = fields(await readJson(request), { partial: true })
    .str('name', { required: true, max: 120 })
    .int('area_id', { nullable: true, min: 1 })
    .str('address', { max: 200 })
    .str('phone', { max: 30 })
    .str('notes', { max: 1000 })
    .done();
  if (d.area_id && !(await first(env, `SELECT id FROM areas WHERE id = ?`, d.area_id))) throw notFound('האזור לא קיים');
  const set = setClause(d, ['name', 'area_id', 'address', 'phone', 'notes']);
  if (set.keys.length) await run(env, `UPDATE synagogues SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, nowIso(), s.id);
  return get({ env, actor, params });
}

// ------------------------------------------------------------------ locations
export async function createLocation({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const d = fields(await readJson(request)).str('name', { required: true, max: 80 }).done();
  const { n, top } = await first(env, `SELECT COUNT(*) AS n, COALESCE(MAX(sort), 0) AS top FROM locations WHERE synagogue_id = ?`, s.id);
  if (n >= s.max_locations) throw conflict(`הגעתם למכסה של ${s.max_locations} מיקומים`, 'LIMIT_REACHED');
  const res = await run(env, `INSERT INTO locations (synagogue_id, name, sort) VALUES (?, ?, ?)`, s.id, d.name, top + 10);
  return json(await first(env, `SELECT id, name, sort, 0 AS minyanim_count FROM locations WHERE id = ?`, res.meta.last_row_id), 201);
}

async function loadLocation(env, s, rawId) {
  const row = await first(env, `SELECT * FROM locations WHERE id = ? AND synagogue_id = ?`, id(rawId), s.id);
  if (!row) throw notFound('המיקום לא נמצא');
  return row;
}

export async function patchLocation({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const loc = await loadLocation(env, s, params.id);
  const d = fields(await readJson(request)).str('name', { required: true, max: 80 }).done();
  await run(env, `UPDATE locations SET name = ? WHERE id = ?`, d.name, loc.id);
  return json({ ...loc, name: d.name });
}

/** Minyanim in the location stay, they just lose the location. */
export async function deleteLocation({ env, actor, params }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const loc = await loadLocation(env, s, params.id);
  await run(env, `DELETE FROM locations WHERE id = ?`, loc.id);
  return noContent();
}

/** PUT /synagogues/:sid/locations/order { ids: [...] } — full new order. */
export async function orderLocations({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const d = fields(await readJson(request)).ids('ids', { required: true }).done();
  const existing = (await all(env, `SELECT id FROM locations WHERE synagogue_id = ?`, s.id)).map((r) => r.id);
  if (d.ids.length !== existing.length || !d.ids.every((x) => existing.includes(x))) {
    throw conflict('רשימת המיקומים השתנתה, רעננו את הדף');
  }
  await batch(env, d.ids.map((lid, i) => q(env, `UPDATE locations SET sort = ? WHERE id = ?`, (i + 1) * 10, lid)));
  return json(await listLocations(env, s.id));
}

// ------------------------------------------------------------------ minyanim
function parseMinyan(body, partial) {
  return fields(body, { partial })
    .int('prayer_id', { required: true, min: 1 })
    .int('location_id', { nullable: true, min: 1 })
    .int('season_id', { nullable: true, min: 1 })
    .int('days', { min: 1, max: ALL_DAYS, default: ALL_DAYS })
    .oneOf('time_kind', ['fixed', 'relative'], { required: true })
    .time('time', { nullable: true })
    .int('anchor_id', { nullable: true, min: 1 })
    .int('offset_minutes', { nullable: true, min: -720, max: 720 })
    .str('notes', { max: 300 })
    .bool('is_active', { default: true })
    .done();
}

export const MINYAN_COLUMNS = ['prayer_id', 'location_id', 'season_id', 'days', 'time_kind', 'time', 'anchor_id', 'offset_minutes', 'notes', 'is_active'];

async function loadMinyanRow(env, s, rawId) {
  const row = await first(env, `SELECT * FROM minyanim WHERE id = ? AND synagogue_id = ?`, id(rawId), s.id);
  if (!row) throw notFound('המניין לא נמצא');
  return row;
}

export async function insertMinyan(env, s, m) {
  const { n } = await first(env, `SELECT COUNT(*) AS n FROM minyanim WHERE synagogue_id = ?`, s.id);
  if (n >= s.max_minyanim) throw conflict(`הגעתם למכסה של ${s.max_minyanim} מניינים`, 'LIMIT_REACHED');
  const row = await validateMinyan(env, s, m);
  const res = await run(
    env,
    `INSERT INTO minyanim (synagogue_id, ${MINYAN_COLUMNS.join(', ')}) VALUES (?, ${MINYAN_COLUMNS.map(() => '?').join(', ')})`,
    s.id, ...MINYAN_COLUMNS.map((c) => (typeof row[c] === 'boolean' ? (row[c] ? 1 : 0) : row[c] ?? null))
  );
  return getMinyan(env, res.meta.last_row_id);
}

export async function createMinyan({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const d = parseMinyan(await readJson(request), false);
  return json(await insertMinyan(env, s, { notes: '', ...d }), 201);
}

/** PATCH: send only what changes; the merged result is validated as a whole. */
export async function patchMinyan({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const current = await loadMinyanRow(env, s, params.id);
  const d = parseMinyan(await readJson(request), true);
  const merged = { ...Object.fromEntries(MINYAN_COLUMNS.map((c) => [c, current[c]])), ...d };
  merged.is_active = merged.is_active === true || merged.is_active === 1;
  const row = await validateMinyan(env, s, merged);
  const set = setClause(row, MINYAN_COLUMNS);
  await run(env, `UPDATE minyanim SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, nowIso(), current.id);
  return json(await getMinyan(env, current.id));
}

export async function duplicateMinyan({ env, actor, params }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const current = await loadMinyanRow(env, s, params.id);
  const copy = Object.fromEntries(MINYAN_COLUMNS.map((c) => [c, current[c]]));
  return json(await insertMinyan(env, s, { ...copy, is_active: current.is_active === 1 }), 201);
}

export async function deleteMinyan({ env, actor, params }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const current = await loadMinyanRow(env, s, params.id);
  await run(env, `DELETE FROM minyanim WHERE id = ?`, current.id);
  return noContent();
}
