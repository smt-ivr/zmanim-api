// Minyan rules shared by the manager workspace and the public endpoints.
import { all, first } from './db.js';
import { invalid } from './http.js';

export const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];
export const ALL_DAYS = 127;
const WEEKDAYS = 0b0011111; // Sunday-Thursday

export const daysList = (mask) => DAY_NAMES.map((_, i) => i).filter((i) => mask & (1 << i));

export function daysLabel(mask) {
  if (mask === ALL_DAYS) return 'כל יום';
  if (mask === WEEKDAYS) return 'א׳-ה׳';
  if (mask === (WEEKDAYS | 0b0100000)) return 'א׳-ו׳';
  if (mask === 0b1000000) return 'שבת';
  return daysList(mask).map((i) => DAY_NAMES[i]).join(', ');
}

export function timeLabel(m) {
  if (m.time_kind === 'fixed') return m.time;
  const n = Math.abs(m.offset_minutes);
  if (n === 0) return m.anchor_name;
  return `${n} דק׳ ${m.offset_minutes < 0 ? 'לפני' : 'אחרי'} ${m.anchor_name}`;
}

export const MINYAN_SELECT = `
  SELECT m.*, p.name AS prayer_name, p.sort AS prayer_sort, l.name AS location_name,
         se.name AS season_name, a.name AS anchor_name
  FROM minyanim m
  JOIN prayers p ON p.id = m.prayer_id
  LEFT JOIN locations l ON l.id = m.location_id
  LEFT JOIN seasons se ON se.id = m.season_id
  LEFT JOIN anchors a ON a.id = m.anchor_id`;

// Prayer order, then fixed times chronologically, then relative ones.
export const MINYAN_ORDER = `ORDER BY p.sort, p.id, m.time_kind, m.time, m.anchor_id, m.offset_minutes, m.id`;

export function serializeMinyan(r) {
  return {
    id: r.id,
    synagogue_id: r.synagogue_id,
    prayer_id: r.prayer_id,
    prayer_name: r.prayer_name,
    location_id: r.location_id,
    location_name: r.location_name ?? null,
    season_id: r.season_id,
    season_name: r.season_name ?? null,
    days: r.days,
    days_list: daysList(r.days),
    days_label: daysLabel(r.days),
    time_kind: r.time_kind,
    time: r.time,
    anchor_id: r.anchor_id,
    anchor_name: r.anchor_name ?? null,
    offset_minutes: r.offset_minutes,
    time_label: timeLabel(r),
    notes: r.notes,
    is_active: r.is_active === 1,
    updated_at: r.updated_at,
  };
}

export async function getMinyan(env, id) {
  const row = await first(env, `${MINYAN_SELECT} WHERE m.id = ?`, id);
  return row ? serializeMinyan(row) : null;
}

export async function listMinyanim(env, synagogueId, { activeOnly = false } = {}) {
  const rows = await all(
    env,
    `${MINYAN_SELECT} WHERE m.synagogue_id = ? ${activeOnly ? 'AND m.is_active = 1' : ''} ${MINYAN_ORDER}`,
    synagogueId
  );
  return rows.map(serializeMinyan);
}

/**
 * Checks a complete minyan against the catalog and the synagogue's settings.
 * Returns the row to store (normalized: unused time fields nulled).
 */
export async function validateMinyan(env, synagogue, m) {
  const errors = {};
  const [prayer, location, season, anchor, allowed] = await Promise.all([
    first(env, `SELECT * FROM prayers WHERE id = ?`, m.prayer_id),
    m.location_id ? first(env, `SELECT * FROM locations WHERE id = ?`, m.location_id) : null,
    m.season_id ? first(env, `SELECT id FROM seasons WHERE id = ?`, m.season_id) : null,
    m.time_kind === 'relative' && m.anchor_id ? first(env, `SELECT id FROM anchors WHERE id = ?`, m.anchor_id) : null,
    synagogue.restrict_prayers
      ? first(env, `SELECT 1 AS ok FROM synagogue_prayers WHERE synagogue_id = ? AND prayer_id = ?`, synagogue.id, m.prayer_id)
      : { ok: 1 },
  ]);

  if (!prayer) errors.prayer_id = 'סוג התפילה לא קיים';
  else if (!allowed) errors.prayer_id = 'תפילה זו לא מאושרת לבית הכנסת';
  if (m.location_id && (!location || location.synagogue_id !== synagogue.id)) errors.location_id = 'המיקום לא שייך לבית הכנסת';
  if (m.season_id && !season) errors.season_id = 'העונה לא קיימת';
  if (!m.days || m.days < 1 || m.days > ALL_DAYS) errors.days = 'יש לבחור לפחות יום אחד';

  const row = { ...m };
  if (m.time_kind === 'fixed') {
    if (!m.time) errors.time = 'יש להזין שעה';
    else if (prayer?.earliest && m.time < prayer.earliest) errors.time = `${prayer.name} לא לפני ${prayer.earliest}`;
    else if (prayer?.latest && m.time > prayer.latest) errors.time = `${prayer.name} לא אחרי ${prayer.latest}`;
    row.anchor_id = null;
    row.offset_minutes = null;
  } else {
    if (!m.anchor_id) errors.anchor_id = 'יש לבחור זמן ייחוס';
    else if (!anchor) errors.anchor_id = 'זמן הייחוס לא קיים';
    if (m.offset_minutes === null || m.offset_minutes === undefined) errors.offset_minutes = 'יש להזין מספר דקות';
    row.time = null;
  }

  if (Object.keys(errors).length) throw invalid(errors);
  return row;
}
