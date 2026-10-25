// Read-only, no login, cacheable. Only active synagogues and active minyanim are exposed.
import { all, first } from '../db.js';
import { HttpError, json, notFound } from '../http.js';
import { MINYAN_ORDER, MINYAN_SELECT, serializeMinyan } from '../minyan.js';
import { getSettings, visibleDays } from '../settings.js';
import { id, queryInt } from '../validate.js';
import { synagogueInfo } from './workspace.js';

const CACHE = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' };

export async function health({ env }) {
  await first(env, `SELECT 1`);
  return json({ ok: true });
}

/** Throws 503 while the super admin has closed the public site. */
async function openSettings(env) {
  const settings = await getSettings(env);
  if (!settings.public_site_enabled) throw new HttpError(503, 'CLOSED', 'האתר סגור זמנית');
  return settings;
}

/** Minyanim as the public sees them: Shabbat removed while disabled; minyanim left without days dropped. */
function publicMinyanim(rows, settings, extra = () => ({})) {
  return rows
    .map((r) => ({ ...r, days: visibleDays(r.days, settings) }))
    .filter((r) => r.days !== 0)
    .map((r) => ({ ...serializeMinyan(r), ...extra(r) }));
}

export async function catalog({ env }) {
  const settings = await getSettings(env);
  const site = {
    enabled: settings.public_site_enabled,
    notice: settings.site_notice,
    phone: settings.listen_phone,
    phone_enabled: settings.listen_enabled,
    shabbat_enabled: settings.shabbat_enabled,
  };
  const [areas, prayers, seasons, anchors] = await Promise.all([
    all(env, `SELECT id, name FROM areas ORDER BY sort, name`),
    all(env, `SELECT id, name FROM prayers ORDER BY sort, id`),
    all(env, `SELECT id, name, is_default FROM seasons ORDER BY sort, id`),
    all(env, `SELECT id, name FROM anchors ORDER BY sort, id`),
  ]);
  return json({ site, areas, prayers, seasons: seasons.map((s) => ({ ...s, is_default: s.is_default === 1 })), anchors }, 200, CACHE);
}

export async function synagogues({ env, url }) {
  await openSettings(env);
  const areaId = queryInt(url, 'area_id', { min: 1 });
  const rows = await all(
    env,
    `SELECT s.*, a.name AS area_name FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id
     WHERE s.is_active = 1 ${areaId ? 'AND s.area_id = ?' : ''} ORDER BY s.name`,
    ...(areaId ? [areaId] : [])
  );
  return json(rows.map(synagogueInfo), 200, CACHE);
}

export async function synagogue({ env, params }) {
  const settings = await openSettings(env);
  const sid = id(params.id);
  const s = await first(env, `SELECT s.*, a.name AS area_name FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id WHERE s.id = ? AND s.is_active = 1`, sid);
  if (!s) throw notFound('בית הכנסת לא נמצא');
  const rows = await all(env, `${MINYAN_SELECT} WHERE m.synagogue_id = ? AND m.is_active = 1 ${MINYAN_ORDER}`, sid);
  return json({ ...synagogueInfo(s), minyanim: publicMinyanim(rows, settings) }, 200, CACHE);
}

/** GET /public/minyanim?area_id&synagogue_id&prayer_id&season_id&day=0..6 */
export async function minyanim({ env, url }) {
  const settings = await openSettings(env);
  const where = ['m.is_active = 1', 's.is_active = 1'];
  const params = [];
  const filters = {
    area_id: 's.area_id = ?',
    synagogue_id: 'm.synagogue_id = ?',
    prayer_id: 'm.prayer_id = ?',
    season_id: '(m.season_id = ? OR m.season_id IS NULL)',
  };
  for (const [name, sql] of Object.entries(filters)) {
    const v = queryInt(url, name, { min: 1 });
    if (v !== null) (where.push(sql), params.push(v));
  }
  const day = queryInt(url, 'day', { min: 0, max: 6 });
  if (day !== null) (where.push('(m.days & ?) != 0'), params.push(1 << day));

  const rows = await all(
    env,
    `${MINYAN_SELECT.replace('FROM minyanim m', 'FROM minyanim m JOIN synagogues s ON s.id = m.synagogue_id').replace(
      'SELECT m.*,',
      'SELECT m.*, s.name AS synagogue_name, s.address AS synagogue_address,'
    )} WHERE ${where.join(' AND ')} ${MINYAN_ORDER} LIMIT 2000`,
    ...params
  );
  return json(publicMinyanim(rows, settings, (r) => ({ synagogue_name: r.synagogue_name, synagogue_address: r.synagogue_address })), 200, CACHE);
}
