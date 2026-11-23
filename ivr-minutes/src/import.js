// Import from the old Yemot extension (a "donation" extension used for the minutes): its log exported
// as JSON — { data: [{ "טלפון", "תאריך": "11/12/2024", "שעה": "11:18:04", "תרומה נוכחית": "10", ... }] }.
// Each row becomes an entry (source 'import') at its original time. Importing the same log again adds
// only rows not imported before (call_id "import:<phone>:<time>"). Amounts above `max` are skipped,
// and so are blocked numbers (when asked).
import { HttpError } from './auth.js';
import { all, db, listName, normalizePhone, nowSec } from './data.js';
import { israelToEpoch } from './period.js';

const CHUNK = 50;

/** One row of the log -> { phone, at, minutes } or { skip: reason }. */
export function parseRow(r) {
  const phone = normalizePhone(r['טלפון'] ?? r['מספר זיהוי'] ?? r.phone);
  if (!phone) return { skip: 'phone' };
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(r['תאריך'] ?? '').trim());
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(r['שעה'] ?? '').trim());
  if (!dm || !tm) return { skip: 'date' };
  const raw = String(r['תרומה נוכחית'] ?? r.amount ?? '').trim();
  if (!/^\d+(\.\d*)?$/.test(raw)) return { skip: 'amount' }; // "30." = 30 (the caller pressed * after the number)
  const minutes = Number(raw);
  return { phone, at: israelToEpoch(+dm[3], +dm[2], +dm[1], +tm[1], +tm[2], +(tm[3] || 0)), minutes };
}

/** POST import { list, max, skip_blocked, rows } */
export async function importLog(env, request) {
  const body = await request.json().catch(() => null);
  const rows = Array.isArray(body?.rows) ? body.rows : Array.isArray(body?.data) ? body.data : null;
  if (!rows) throw new HttpError(400, 'לא נמצאו שורות בקובץ. יש להעלות את קובץ ה-JSON של הלוג מימות המשיח');
  if (rows.length > 50000) throw new HttpError(400, 'הקובץ גדול מדי (עד 50,000 שורות)');
  const list = listName(body.list);
  const max = Number(body.max) > 0 ? Number(body.max) : Infinity;
  const sm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.since || ''));
  const since = sm ? israelToEpoch(+sm[1], +sm[2], +sm[3]) : 0; // rows before this date are not imported
  const blocked = body.skip_blocked === false ? new Set() : new Set((await all(env, `SELECT phone FROM minutes_blocked`)).map((r) => r.phone));

  const out = { rows: rows.length, added: 0, already: 0, before: 0, over_max: 0, blocked: 0, invalid: 0, minutes: 0, over_max_rows: [] };
  const take = [];
  for (const r of rows) {
    const x = parseRow(r || {});
    if (x.skip) { out.invalid += 1; continue; }
    if (x.at < since) { out.before += 1; continue; }
    if (blocked.has(x.phone)) { out.blocked += 1; continue; }
    if (x.minutes > max || !Number.isInteger(x.minutes) || x.minutes > 999999) {
      out.over_max += 1;
      if (out.over_max_rows.length < 50) out.over_max_rows.push({ phone: x.phone, at: x.at, minutes: String(r['תרומה נוכחית']) });
      continue;
    }
    if (x.minutes <= 0) { out.invalid += 1; continue; }
    take.push(x);
  }
  const d = db(env);
  const t = nowSec();
  for (let i = 0; i < take.length; i += CHUNK) {
    const part = take.slice(i, i + CHUNK);
    const res = await d.batch(part.map((x) => d.prepare(
      `INSERT INTO minutes_entries (list, phone, minutes, source, call_id, note, created_at, updated_at) VALUES (?, ?, ?, 'import', ?, '', ?, ?) ON CONFLICT DO NOTHING`
    ).bind(list, x.phone, x.minutes, `import:${list}:${x.phone}:${x.at}`, x.at, x.at)));
    res.forEach((r, j) => { if (r.meta.changes) { out.added += 1; out.minutes += part[j].minutes; } else out.already += 1; });
  }
  if (out.added) {
    await d.prepare(`INSERT INTO minutes_log (at, list, phone, action, by, minutes, before, entry_id) VALUES (?, ?, '', 'import', 'admin', ?, ?, NULL)`)
      .bind(t, list, out.minutes, out.added).run();
  }
  return out;
}
