// Read-only, no login, cacheable. Only active synagogues and active minyanim are exposed.
import { all, first } from '../db.js';
import { HttpError, json, notFound } from '../http.js';
import { MINYAN_ORDER, MINYAN_SELECT, serializeMinyan } from '../minyan.js';
import { currentSeason, getSettings, visibleDays } from '../settings.js';
import { id, queryInt } from '../validate.js';
import { synagogueInfo } from './workspace.js';
import { anchorTimes, israelDate, placeOf } from '../zmanim.js';

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

/**
 * Minyanim as the public sees them: Shabbat removed while disabled (minyanim left without days dropped),
 * notes hidden while notes are off, and only the given season.
 */
function publicMinyanim(rows, settings, seasonId, extra = () => ({})) {
  return rows
    .filter((r) => r.season_id === seasonId)
    .map((r) => ({ ...r, days: visibleDays(r.days, settings), notes: settings.minyan_notes_enabled ? r.notes : '' }))
    .filter((r) => r.days !== 0)
    .map((r) => ({ ...serializeMinyan(r), ...extra(r) }));
}

/** The season to show: the current one, or the requested one when the public may choose. */
async function shownSeason(env, settings, url) {
  const requested = url ? queryInt(url, 'season_id', { min: 1 }) : null;
  if (requested && settings.public_season_choice) return requested;
  return (await currentSeason(env))?.id ?? null;
}

export async function catalog({ env }) {
  const settings = await getSettings(env);
  const site = {
    name: settings.system_name,
    enabled: settings.public_site_enabled,
    notice: settings.site_notice,
    phone: settings.listen_phone,
    phone_enabled: settings.listen_enabled,
    contact_email: settings.contact_email_shown ? settings.contact_email || settings.inbound_email || '' : '',
    shabbat_enabled: settings.shabbat_enabled,
    season_choice: settings.public_season_choice,
    registration: settings.registration_enabled && Boolean(settings.mail_enabled && settings.resend_api_key && settings.mail_from),
  };
  const current = await currentSeason(env);
  const [areas, prayers, seasons, anchors] = await Promise.all([
    all(env, `SELECT id, name FROM areas ORDER BY sort, name`),
    all(env, `SELECT id, name FROM prayers ORDER BY sort, id`),
    all(env, `SELECT id, name, is_default FROM seasons ORDER BY sort, id`),
    all(env, `SELECT id, name, calc FROM anchors ORDER BY sort, id`),
  ]);
  // Clock times of the computed anchors for today and the next 6 days, so relative minyanim show a time.
  const place = placeOf(settings);
  const zmanim = Array.from({ length: 7 }, (_, i) => {
    const date = israelDate(new Date(Date.now() + i * 86400000));
    return { date, times: anchorTimes(anchors, date, place) };
  });
  return json({
    site,
    current_season: current ? { id: current.id, name: current.name } : null,
    areas, prayers, seasons: seasons.map((s) => ({ ...s, is_default: s.is_default === 1 })), anchors, zmanim,
  }, 200, CACHE);
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

export async function synagogue({ env, params, url }) {
  const settings = await openSettings(env);
  const sid = id(params.id);
  const s = await first(env, `SELECT s.*, a.name AS area_name FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id WHERE s.id = ? AND s.is_active = 1`, sid);
  if (!s) throw notFound('בית הכנסת לא נמצא');
  const rows = await all(env, `${MINYAN_SELECT} WHERE m.synagogue_id = ? AND m.is_active = 1 ${MINYAN_ORDER}`, sid);
  return json({ ...synagogueInfo(s), minyanim: publicMinyanim(rows, settings, await shownSeason(env, settings, url)) }, 200, CACHE);
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
  return json(publicMinyanim(rows, settings, await shownSeason(env, settings, url), (r) => ({ synagogue_name: r.synagogue_name, synagogue_address: r.synagogue_address })), 200, CACHE);
}
