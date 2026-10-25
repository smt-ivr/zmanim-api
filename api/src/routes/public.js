// Read-only, no login, cacheable. Only active synagogues and active minyanim are exposed.
import { all, first } from '../db.js';
import { json, notFound } from '../http.js';
import { MINYAN_ORDER, MINYAN_SELECT, serializeMinyan } from '../minyan.js';
import { id, queryInt } from '../validate.js';
import { synagogueInfo } from './workspace.js';

const CACHE = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' };

export async function health({ env }) {
  await first(env, `SELECT 1`);
  return json({ ok: true });
}

export async function catalog({ env }) {
  const [areas, prayers, seasons, anchors] = await Promise.all([
    all(env, `SELECT id, name FROM areas ORDER BY sort, name`),
    all(env, `SELECT id, name FROM prayers ORDER BY sort, id`),
    all(env, `SELECT id, name, is_default FROM seasons ORDER BY sort, id`),
    all(env, `SELECT id, name FROM anchors ORDER BY sort, id`),
  ]);
  return json({ areas, prayers, seasons: seasons.map((s) => ({ ...s, is_default: s.is_default === 1 })), anchors }, 200, CACHE);
}

export async function synagogues({ env, url }) {
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
  const sid = id(params.id);
  const s = await first(env, `SELECT s.*, a.name AS area_name FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id WHERE s.id = ? AND s.is_active = 1`, sid);
  if (!s) throw notFound('בית הכנסת לא נמצא');
  const rows = await all(env, `${MINYAN_SELECT} WHERE m.synagogue_id = ? AND m.is_active = 1 ${MINYAN_ORDER}`, sid);
  return json({ ...synagogueInfo(s), minyanim: rows.map(serializeMinyan) }, 200, CACHE);
}

/** GET /public/minyanim?area_id&synagogue_id&prayer_id&season_id&day=0..6 */
export async function minyanim({ env, url }) {
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
  return json(
    rows.map((r) => ({ ...serializeMinyan(r), synagogue_name: r.synagogue_name, synagogue_address: r.synagogue_address })),
    200,
    CACHE
  );
}
