// The synagogue workspace: everything a manager does inside "their" synagogue.
// Admins can open any synagogue the same way.
import { requireSynagogue } from '../auth.js';
import { all, batch, first, nowIso, q, run, setClause } from '../db.js';
import { HttpError, conflict, forbidden, invalid, json, noContent, notFound, readJson } from '../http.js';
import { ALL_DAYS, getMinyan, listMinyanim, validateMinyan } from '../minyan.js';
import { currentSeason, getSettings } from '../settings.js';
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
    editable_fields: parseFields(s.editable_fields),
    max_locations: s.max_locations,
    max_minyanim: s.max_minyanim,
    restrict_prayers: s.restrict_prayers === 1,
    allowed_prayer_ids: allowed,
    allow_other_seasons: s.allow_other_seasons === 1,
    allow_interval: s.allow_interval === 1,
  };
}

/** Synagogue details a manager may be allowed to edit (the admin picks per synagogue; default none). */
export const INFO_FIELDS = ['name', 'area_id', 'address', 'phone', 'notes'];
export function parseFields(json) {
  try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v.filter((f) => INFO_FIELDS.includes(f)) : []; } catch { return []; }
}

/** Anchors with the prayers they may be used for (empty list = all prayers). */
export async function anchorsWithPrayers(env) {
  const [anchors, links] = await Promise.all([
    all(env, `SELECT id, name, calc FROM anchors ORDER BY sort, id`),
    all(env, `SELECT anchor_id, prayer_id FROM anchor_prayers`),
  ]);
  return anchors.map((a) => ({ ...a, prayer_ids: links.filter((l) => l.anchor_id === a.id).map((l) => l.prayer_id) }));
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
  const [area, settings, locations, minyanim, prayers, seasons, anchors, areas, managers, current, system] = await Promise.all([
    s.area_id ? first(env, `SELECT name FROM areas WHERE id = ?`, s.area_id) : null,
    synagogueSettings(env, s),
    listLocations(env, s.id),
    listMinyanim(env, s.id),
    all(env, `SELECT id, name, earliest, latest, has_rosh_chodesh FROM prayers ORDER BY sort, id`),
    all(env, `SELECT id, name, is_default, starts_md FROM seasons ORDER BY sort, id`),
    anchorsWithPrayers(env),
    all(env, `SELECT id, name FROM areas ORDER BY sort, name`),
    all(env, `SELECT u.id, u.name FROM synagogue_managers sm JOIN users u ON u.id = sm.user_id WHERE sm.synagogue_id = ? ORDER BY u.name`, s.id),
    currentSeason(env),
    getSettings(env),
  ]);
  const allowed = settings.allowed_prayer_ids;
  // Which seasons this user may edit: the current one (and all-year), unless the synagogue allows more.
  settings.editable_season_ids = actor.role === 'admin' || settings.allow_other_seasons ? null : current ? [current.id] : [];
  settings.notes_enabled = system.minyan_notes_enabled;
  return json({
    synagogue: synagogueInfo({ ...s, area_name: area?.name }),
    settings,
    usage: { locations: locations.length, minyanim: minyanim.length },
    locations,
    minyanim,
    managers,
    catalog: {
      prayers: (allowed ? prayers.filter((p) => allowed.includes(p.id)) : prayers).map((p) => ({ ...p, has_rosh_chodesh: p.has_rosh_chodesh === 1 })),
      seasons: seasons.map((x) => ({ ...x, is_default: x.is_default === 1 })),
      current_season: current ? { id: current.id, name: current.name } : null,
      anchors,
      areas,
    },
  });
}

/** PATCH /synagogues/:sid — public details. Managers may change only the fields the admin opened. */
export async function patch({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const d = fields(await readJson(request), { partial: true })
    .str('name', { required: true, max: 120 })
    .int('area_id', { required: true, min: 1 })
    .str('address', { max: 200 })
    .str('phone', { max: 30 })
    .str('notes', { max: 1000 })
    .done();
  if (actor.role !== 'admin') {
    const open = parseFields(s.editable_fields);
    // Unchanged values are fine (the form sends everything); only real changes need permission.
    const changed = Object.keys(d).filter((k) => d[k] !== s[k]);
    if (changed.some((k) => !open.includes(k))) throw forbidden('כדי לשנות פרטים אלה, פנו למנהל המערכת');
  }
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
    .int('season_id', { required: true, min: 1 })
    .int('days', { min: 1, max: ALL_DAYS, default: ALL_DAYS })
    .oneOf('time_kind', ['fixed', 'relative', 'interval'], { required: true })
    .time('time', { nullable: true })
    .time('end_time', { nullable: true })
    .int('every_minutes', { nullable: true, min: 5, max: 240 })
    .time('rosh_chodesh_time', { nullable: true })
    .int('anchor_id', { nullable: true, min: 1 })
    .int('offset_minutes', { nullable: true, min: -720, max: 720 })
    .str('notes', { max: 300 })
    .bool('is_active', { default: true })
    .done();
}

export const MINYAN_COLUMNS = ['prayer_id', 'location_id', 'season_id', 'days', 'time_kind', 'time', 'end_time', 'every_minutes', 'anchor_id', 'offset_minutes', 'rosh_chodesh_time', 'notes', 'is_active'];

/**
 * Managers edit only the current season, unless the synagogue allows other
 * seasons. Admins edit everything. `seasonIds` are the seasons touched by the change.
 */
export async function requireSeasonAccess(env, actor, s, ...seasonIds) {
  if (actor.role === 'admin' || s.allow_other_seasons) return;
  const current = await currentSeason(env);
  if (seasonIds.some((sid) => sid !== undefined && sid !== current?.id)) {
    throw forbidden(`ניתן לעדכן רק את ${current ? `זמני ${current.name}` : 'העונה הנוכחית'}. לעונות אחרות פנו למנהל המערכת`);
  }
}

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
  await requireSeasonAccess(env, actor, s, d.season_id);
  return json(await insertMinyan(env, s, { notes: '', ...d }), 201);
}

/** PATCH: send only what changes; the merged result is validated as a whole. */
export async function patchMinyan({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const current = await loadMinyanRow(env, s, params.id);
  const d = parseMinyan(await readJson(request), true);
  await requireSeasonAccess(env, actor, s, current.season_id, d.season_id);
  const merged = { ...Object.fromEntries(MINYAN_COLUMNS.map((c) => [c, current[c]])), ...d, id: current.id };
  merged.is_active = merged.is_active === true || merged.is_active === 1;
  const row = await validateMinyan(env, s, merged);
  const set = setClause(row, MINYAN_COLUMNS);
  await run(env, `UPDATE minyanim SET ${set.sql}, updated_at = ? WHERE id = ?`, ...set.params, nowIso(), current.id);
  return json(await getMinyan(env, current.id));
}

export async function duplicateMinyan({ env, actor, params }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const current = await loadMinyanRow(env, s, params.id);
  await requireSeasonAccess(env, actor, s, current.season_id);
  const copy = Object.fromEntries(MINYAN_COLUMNS.map((c) => [c, current[c]]));
  // The copy starts hidden: it has the same time and place until it is edited.
  return json(await insertMinyan(env, s, { ...copy, is_active: false }), 201);
}

export async function deleteMinyan({ env, actor, params }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const current = await loadMinyanRow(env, s, params.id);
  await requireSeasonAccess(env, actor, s, current.season_id);
  await run(env, `DELETE FROM minyanim WHERE id = ?`, current.id);
  return noContent();
}

// ------------------------------------------------------------------ copy between seasons
/**
 * Copies the minyanim of one season into another season of the same synagogue.
 * replace = delete what the target season has first; otherwise existing minyanim stay and copies that
 * would clash with them (same time and place) are skipped. Managers may write only into seasons they may edit.
 */
export async function copySeason(env, actor, s, { from, to, ids = null, prayerIds = null, replace = false }) {
  if (from === to) throw invalid({ to_season_id: 'יש לבחור עונת יעד אחרת' });
  const found = await all(env, `SELECT id FROM seasons WHERE id IN (?, ?)`, from, to);
  if (found.length !== 2) throw invalid({ to_season_id: 'העונה לא קיימת' });
  await requireSeasonAccess(env, actor, s, to);

  let rows = await all(env, `SELECT * FROM minyanim WHERE synagogue_id = ? AND season_id = ? ORDER BY id`, s.id, from);
  if (ids) rows = rows.filter((r) => ids.includes(r.id));
  if (prayerIds) rows = rows.filter((r) => prayerIds.includes(r.prayer_id));
  // replace: clears the target season (only the chosen prayers, when prayers were chosen)
  if (replace && prayerIds) {
    if (prayerIds.length) await run(env, `DELETE FROM minyanim WHERE synagogue_id = ? AND season_id = ? AND prayer_id IN (${prayerIds.map(() => '?').join(',')})`, s.id, to, ...prayerIds);
  } else if (replace) await run(env, `DELETE FROM minyanim WHERE synagogue_id = ? AND season_id = ?`, s.id, to);

  let copied = 0;
  const skipped = [];
  for (const r of rows) {
    const copy = Object.fromEntries(MINYAN_COLUMNS.map((c) => [c, r[c]]));
    try {
      await insertMinyan(env, s, { ...copy, season_id: to, is_active: r.is_active === 1 });
      copied++;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      skipped.push({ id: r.id, reason: err.fields ? Object.values(err.fields).join(', ') : err.message });
    }
  }
  return { copied, skipped };
}

/** POST /synagogues/:sid/seasons/copy { from_season_id, to_season_id, minyan_ids?, prayer_ids?, replace? } */
export async function copySeasonRoute({ env, actor, params, request }) {
  const s = await loadSynagogue(env, actor, params.sid);
  const d = fields(await readJson(request))
    .int('from_season_id', { required: true, min: 1 })
    .int('to_season_id', { required: true, min: 1 })
    .ids('minyan_ids', { nullable: true })
    .ids('prayer_ids', { nullable: true })
    .bool('replace', { default: false })
    .done();
  return json(await copySeason(env, actor, s, { from: d.from_season_id, to: d.to_season_id, ids: d.minyan_ids ?? null, prayerIds: d.prayer_ids ?? null, replace: d.replace }));
}
