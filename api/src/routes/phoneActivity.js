// Activity on the phone lines: who called, when, what they pressed and heard, and what people search for.
import { all, first, run } from '../db.js';
import { json, noContent, notFound } from '../http.js';
import { nameRow } from '../names.js';
import { id } from '../validate.js';

const PAGE = 50;
const hideSuper = (actor) => (actor.is_super ? '' : 'AND (u.is_super IS NULL OR u.is_super = 0)');

/** GET /admin/phone-activity?line=&days=&q=&page= — numbers for the period and the calls (newest first). */
export async function activity({ env, actor, url }) {
  const p = url.searchParams;
  const line = ['listen', 'manage'].includes(p.get('line')) ? p.get('line') : null;
  const days = Math.min(Math.max(Number(p.get('days')) || 7, 1), 180);
  const page = Math.max(Number(p.get('page')) || 0, 0);
  const qPhone = String(p.get('q') || '').replace(/\D/g, '');
  const since = `strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${days} days')`;
  const where = [`c.started_at >= ${since}`, ...(line ? ['c.line = ?'] : []), ...(qPhone ? ['c.phone LIKE ?'] : [])];
  const args = [...(line ? [line] : []), ...(qPhone ? [`%${qPhone}%`] : [])];
  const from = `FROM phone_calls c LEFT JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')} ${hideSuper(actor)}`;

  const [totals, byHour, byDay, prayers, areas, rows, today] = await Promise.all([
    first(env, `SELECT COUNT(*) AS calls, COUNT(DISTINCT c.phone) AS callers, SUM(c.searches) AS searches, SUM(c.heard) AS heard,
      SUM(CASE WHEN c.outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked,
      AVG((julianday(COALESCE(c.ended_at, c.last_at)) - julianday(c.started_at)) * 86400) AS avg_seconds ${from}`, ...args),
    // Israel time for the hour of day (+2/+3; the offset is taken from the current date, close enough for a chart)
    all(env, `SELECT CAST(strftime('%H', c.started_at, ? ) AS INTEGER) AS h, COUNT(*) AS n ${from} GROUP BY h`, israelOffset(), ...args),
    all(env, `SELECT date(c.started_at, ?) AS d, COUNT(*) AS n ${from} GROUP BY d ORDER BY d`, israelOffset(), ...args),
    all(env, `SELECT COALESCE(p.name, 'כל המניינים הקרובים') AS name, COUNT(*) AS n, SUM(CASE WHEN s.found = 0 THEN 1 ELSE 0 END) AS empty
      FROM phone_searches s JOIN phone_calls c ON c.id = s.call_id LEFT JOIN prayers p ON p.id = s.prayer_id LEFT JOIN users u ON u.id = c.user_id
      WHERE ${where.join(' AND ')} GROUP BY s.prayer_id ORDER BY n DESC LIMIT 10`, ...args),
    all(env, `SELECT COALESCE(a.name, 'כל האזורים') AS name, COUNT(*) AS n
      FROM phone_searches s JOIN phone_calls c ON c.id = s.call_id LEFT JOIN areas a ON a.id = s.area_id LEFT JOIN users u ON u.id = c.user_id
      WHERE ${where.join(' AND ')} GROUP BY s.area_id ORDER BY n DESC LIMIT 10`, ...args),
    all(env, `SELECT c.id, c.line, c.phone, c.outcome, c.steps, c.searches, c.heard, c.started_at, c.last_at, c.ended_at,
      u.name AS user_name, u.id AS by_id, u.role AS by_role, u.is_super AS by_super ${from} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ...args, PAGE, page * PAGE),
    first(env, `SELECT COUNT(*) AS n FROM phone_calls WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day')`),
  ]);
  return json({
    days, line, page, page_size: PAGE, total: totals.calls,
    stats: { ...totals, avg_seconds: Math.round(totals.avg_seconds || 0), today: today.n },
    by_hour: Array.from({ length: 24 }, (_, h) => byHour.find((r) => r.h === h)?.n || 0),
    by_day: byDay, prayers, areas,
    calls: rows.map((r) => nameRow(actor, r, 'by', 'user_name')),
    can_delete: actor.is_super,
  });
}

/** GET /admin/phone-activity/:id — one call with every step. */
export async function call({ env, actor, params }) {
  const row = await first(env, `SELECT c.*, u.name AS user_name, u.id AS by_id, u.role AS by_role, u.is_super AS by_super
    FROM phone_calls c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ? ${hideSuper(actor)}`, id(params.id));
  if (!row) throw notFound('השיחה לא נמצאה');
  const { events, ...rest } = nameRow(actor, row, 'by', 'user_name');
  return json({ ...rest, events: JSON.parse(events || '[]') });
}

/** DELETE /admin/phone-activity/:id (super admin) */
export async function remove({ env, params }) {
  await run(env, `DELETE FROM phone_calls WHERE id = ?`, id(params.id));
  return noContent();
}

/** SQLite modifier for Israel time now ('+2 hours' / '+3 hours'). */
function israelOffset() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const diff = (h - new Date().getUTCHours() + 24) % 24;
  return `+${diff} hours`;
}
