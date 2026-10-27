// Minyan rules shared by the manager workspace and the public endpoints.
import { all, first } from './db.js';
import { invalid } from './http.js';
import { SHABBAT_BIT, getSettings } from './settings.js';

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
  if (m.time_kind === 'interval') return `\u2066${m.time}–${m.end_time}\u2069, כל ${m.every_minutes} דק׳`; // LRI/PDI: keep the range left-to-right in RTL text
  const n = Math.abs(m.offset_minutes);
  if (n === 0) return m.anchor_name;
  return `${n} דק׳ ${m.offset_minutes < 0 ? 'לפני' : 'אחרי'} ${m.anchor_name}`;
}

export const MINYAN_SELECT = `
  SELECT m.*, p.name AS prayer_name, p.sort AS prayer_sort, l.name AS location_name,
         se.name AS season_name, a.name AS anchor_name, a.calc AS anchor_calc, p.has_rosh_chodesh, ub.name AS updated_by_name
  FROM minyanim m
  LEFT JOIN users ub ON ub.id = m.updated_by
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
    end_time: r.end_time ?? null,
    every_minutes: r.every_minutes ?? null,
    rosh_chodesh_time: r.rosh_chodesh_time ?? null,
    time_label: timeLabel(r),
    notes: r.notes,
    is_active: r.is_active === 1,
    updated_at: r.updated_at,
    updated_by_name: r.updated_by_name ?? null,
    updated_via: r.updated_via ?? null,
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
  const [prayer, location, season, anchor, allowed, settings, anchorPrayers, siblings] = await Promise.all([
    first(env, `SELECT * FROM prayers WHERE id = ?`, m.prayer_id),
    m.location_id ? first(env, `SELECT * FROM locations WHERE id = ?`, m.location_id) : null,
    m.season_id ? first(env, `SELECT id FROM seasons WHERE id = ?`, m.season_id) : null,
    m.time_kind === 'relative' && m.anchor_id ? first(env, `SELECT id FROM anchors WHERE id = ?`, m.anchor_id) : null,
    synagogue.restrict_prayers
      ? first(env, `SELECT 1 AS ok FROM synagogue_prayers WHERE synagogue_id = ? AND prayer_id = ?`, synagogue.id, m.prayer_id)
      : { ok: 1 },
    getSettings(env),
    m.time_kind === 'relative' && m.anchor_id ? all(env, `SELECT prayer_id FROM anchor_prayers WHERE anchor_id = ?`, m.anchor_id) : [],
    // Other active minyanim in the same place, to prevent two minyanim at the same time and location
    all(env, `SELECT * FROM minyanim WHERE synagogue_id = ? AND location_id IS ? AND id != ? AND is_active = 1`, synagogue.id, m.location_id ?? null, m.id ?? 0),
  ]);

  if (!prayer) errors.prayer_id = 'סוג התפילה לא קיים';
  else if (!allowed) errors.prayer_id = 'תפילה זו לא מאושרת לבית הכנסת';
  if (m.location_id && (!location || location.synagogue_id !== synagogue.id)) errors.location_id = 'המיקום לא שייך לבית הכנסת';
  if (!m.season_id) errors.season_id = 'יש לבחור עונה';
  else if (!season) errors.season_id = 'העונה לא קיימת';
  if (!m.days || m.days < 1 || m.days > ALL_DAYS) errors.days = 'יש לבחור לפחות יום אחד';
  else if (!settings.shabbat_enabled && (m.days & ~SHABBAT_BIT) === 0) errors.days = 'יש לבחור לפחות יום אחד';

  const row = { ...m };
  const inBounds = (t, field) => {
    if (prayer?.earliest && t < prayer.earliest) errors[field] = `${prayer.name} לא לפני ${prayer.earliest}`;
    else if (prayer?.latest && t > prayer.latest) errors[field] = `${prayer.name} לא אחרי ${prayer.latest}`;
  };
  if (!settings.minyan_notes_enabled) row.notes = ''; // notes are switched off for now
  if (m.time_kind !== 'fixed' || !prayer?.has_rosh_chodesh || !m.rosh_chodesh_time) row.rosh_chodesh_time = null;
  else inBounds(m.rosh_chodesh_time, 'rosh_chodesh_time');
  if (m.time_kind !== 'interval') (row.end_time = null), (row.every_minutes = null);

  if (m.time_kind === 'fixed') {
    if (!m.time) errors.time = 'יש להזין שעה';
    else inBounds(m.time, 'time');
    row.anchor_id = null;
    row.offset_minutes = null;
  } else if (m.time_kind === 'interval') {
    if (!synagogue.allow_interval) errors.time_kind = 'מניינים בסבב (שטיבלאך) לא מאושרים לבית כנסת זה';
    if (!m.time) errors.time = 'יש להזין שעת התחלה';
    else inBounds(m.time, 'time');
    if (!m.end_time) errors.end_time = 'יש להזין שעת סיום';
    else if (m.time && m.end_time <= m.time) errors.end_time = 'שעת הסיום חייבת להיות אחרי ההתחלה';
    else inBounds(m.end_time, 'end_time');
    if (!m.every_minutes || m.every_minutes < 5 || m.every_minutes > 240) errors.every_minutes = 'כל כמה דקות: בין 5 ל-240';
    row.anchor_id = null;
    row.offset_minutes = null;
  } else {
    if (!m.anchor_id) errors.anchor_id = 'יש לבחור זמן ייחוס';
    else if (!anchor) errors.anchor_id = 'זמן הייחוס לא קיים';
    else if (anchorPrayers.length && !anchorPrayers.some((r) => r.prayer_id === m.prayer_id)) {
      errors.anchor_id = 'זמן ייחוס זה אינו מותר לתפילה שנבחרה';
    }
    if (m.offset_minutes === null || m.offset_minutes === undefined) errors.offset_minutes = 'יש להזין מספר דקות';
    row.time = null;
  }

  if (!Object.keys(errors).length && row.is_active !== false && row.is_active !== 0) {
    const clash = siblings.find((o) => (o.days & m.days) && o.season_id === m.season_id && sameTime(o, row));
    if (clash) errors.time = 'כבר קיים מניין באותה שעה ובאותו מיקום';
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return row;
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
/** Minutes a minyan starts at (fixed: one, interval: every slot). Relative: compared by anchor + offset. */
function slots(m) {
  if (m.time_kind === 'fixed') return [toMin(m.time)];
  if (m.time_kind === 'interval') {
    const out = [];
    for (let t = toMin(m.time); t <= toMin(m.end_time); t += m.every_minutes) out.push(t);
    return out;
  }
  return [];
}
function sameTime(a, b) {
  if (a.time_kind === 'relative' || b.time_kind === 'relative') {
    return a.time_kind === b.time_kind && a.anchor_id === b.anchor_id && a.offset_minutes === b.offset_minutes;
  }
  const bs = new Set(slots(b));
  return slots(a).some((t) => bs.has(t));
}
