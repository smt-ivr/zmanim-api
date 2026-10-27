// History of minyan changes: who (user), how (web / phone), what (a short Hebrew summary).
import { all, run } from './db.js';
import { nameRow } from './names.js';

/** One line describing a minyan, e.g. "שחרית 07:00, א׳-ה׳, היכל ראשי (זמני קיץ)". */
export const describe = (m) =>
  `${m.prayer_name} ${m.time_label}, ${m.days_label}${m.location_name ? `, ${m.location_name}` : ''}${m.season_name ? ` (זמני ${m.season_name})` : ''}`;

const FIELDS = [
  ['prayer_name', 'תפילה'], ['time_label', 'שעה'], ['rosh_chodesh_time', 'ראש חודש'], ['days_label', 'ימים'],
  ['location_name', 'מיקום'], ['season_name', 'עונה'], ['notes', 'הערה'],
];

/** "שעה: 07:00 ← 07:15; מיקום: היכל ראשי ← בית מדרש" */
export function diff(before, after) {
  const parts = FIELDS.filter(([k]) => (before[k] ?? '') !== (after[k] ?? '')).map(([k, label]) => `${label}: ${before[k] || '—'} ← ${after[k] || '—'}`);
  if (before.is_active !== after.is_active) parts.push(after.is_active ? 'הוצג לציבור' : 'הוסתר מהציבור');
  return parts.join('; ');
}

/**
 * who: { userId, via } (via: 'web' | 'phone'). Also stamps the minyan with who changed it last.
 */
export async function logMinyan(env, who, { synagogueId, minyanId = null, action, summary }) {
  if (!summary) return;
  await run(env, `INSERT INTO minyan_log (synagogue_id, minyan_id, user_id, via, action, summary) VALUES (?, ?, ?, ?, ?, ?)`,
    synagogueId, minyanId, who?.userId ?? null, who?.via ?? 'web', action, summary.slice(0, 500));
  if (minyanId && action !== 'delete') {
    await run(env, `UPDATE minyanim SET updated_by = ?, updated_via = ? WHERE id = ?`, who?.userId ?? null, who?.via ?? 'web', minyanId);
  }
}

/** GET /synagogues/:sid/log[?minyan_id=] (newest first), with names as the viewer may see them. */
export const listLog = async (env, synagogueId, minyanId = null, viewer = null) =>
  (await all(env, `SELECT l.*, u.name AS user_name, u.id AS by_id, u.role AS by_role, u.is_super AS by_super
    FROM minyan_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.synagogue_id = ? ${minyanId ? 'AND l.minyan_id = ?' : ''} ORDER BY l.id DESC LIMIT 200`,
    ...(minyanId ? [synagogueId, minyanId] : [synagogueId]))).map((r) => nameRow(viewer, r, 'by', 'user_name'));
