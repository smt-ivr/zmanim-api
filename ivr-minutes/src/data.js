// Database access and the rules shared by the phone lines and the admin UI.
import { SCHEMA } from './schema.js';

export const TZ = 'Asia/Jerusalem';
export const nowSec = () => Math.floor(Date.now() / 1000);

/** The database: its own binding when this folder runs as its own Worker, otherwise the host's DB. */
export function db(env) {
  const d = env.MINUTES_DB || env.DB;
  if (!d) throw new Error('ivr-minutes: no database binding (MINUTES_DB or DB)');
  return d;
}

const ready = new WeakMap();
/** Creates the tables once per database per isolate. */
export function init(env) {
  const d = db(env);
  if (!ready.has(d)) ready.set(d, d.batch(SCHEMA.map((sql) => d.prepare(sql))).catch((e) => { ready.delete(d); throw e; }));
  return ready.get(d);
}

export const all = async (env, sql, ...p) => (await db(env).prepare(sql).bind(...p).all()).results;
export const first = (env, sql, ...p) => db(env).prepare(sql).bind(...p).first();
export const run = (env, sql, ...p) => db(env).prepare(sql).bind(...p).run();

/** "0501234567" / "972501234567" / "+972-50-123-4567" -> "0501234567"; anything else -> null. */
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^0\d{8,9}$/.test(d) ? d : null;
}

/** List name from a link or the UI: letters (Hebrew too), digits, _ and -, up to 40. Default "main". */
export function listName(raw) {
  const s = String(raw ?? '').trim();
  return /^[\p{L}\p{N}_-]{1,40}$/u.test(s) ? s : 'main';
}

// ------------------------------------------------------------------ settings (key for the phone links)
export async function getKey(env) {
  const row = await first(env, `SELECT value FROM minutes_settings WHERE key = 'ivr_key'`);
  if (row) return row.value;
  return rotateKey(env, true);
}

export async function rotateKey(env, onlyIfMissing = false) {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const key = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (onlyIfMissing) {
    await run(env, `INSERT OR IGNORE INTO minutes_settings (key, value) VALUES ('ivr_key', ?)`, key);
    return (await first(env, `SELECT value FROM minutes_settings WHERE key = 'ivr_key'`)).value;
  }
  await run(env, `INSERT INTO minutes_settings (key, value) VALUES ('ivr_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key);
  return key;
}

// ------------------------------------------------------------------ totals
export async function phoneTotal(env, list, phone) {
  const r = await first(env, `SELECT COALESCE(SUM(minutes), 0) AS t FROM minutes_entries WHERE list = ? AND phone = ?`, list, phone);
  return r.t;
}

export async function listTotal(env, list) {
  const r = await first(env, `SELECT COALESCE(SUM(minutes), 0) AS t FROM minutes_entries WHERE list = ?`, list);
  return r.t;
}

/** Updates made by phone since `since` (epoch seconds), newest first. */
export const recentPhoneEntries = (env, list, phone, since) =>
  all(env, `SELECT * FROM minutes_entries WHERE list = ? AND phone = ? AND source = 'phone' AND created_at >= ? ORDER BY created_at DESC, id DESC`, list, phone, since);

// ------------------------------------------------------------------ changes (each one also goes to the log)
const logStmt = (env, { list, phone, action, by, minutes = null, before = null, entryId = null }) =>
  db(env).prepare(`INSERT INTO minutes_log (at, list, phone, action, by, minutes, before, entry_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(nowSec(), list, phone, action, by, minutes, before, entryId);

/** Adds an entry. Returns its id, or null when this call already added one (Yemot repeated the request). */
export async function addEntry(env, { list, phone, minutes, source, callId = null, note = '' }) {
  const t = nowSec();
  const res = await db(env).prepare(
    `INSERT INTO minutes_entries (list, phone, minutes, source, call_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).bind(list, phone, minutes, source, callId, note, t, t).run();
  if (!res.meta.changes) return null;
  const id = res.meta.last_row_id;
  await logStmt(env, { list, phone, action: 'add', by: source, minutes, entryId: id }).run();
  return id;
}

export async function updateEntry(env, entry, { minutes, note }, by) {
  const m = minutes ?? entry.minutes;
  await db(env).batch([
    db(env).prepare(`UPDATE minutes_entries SET minutes = ?, note = ?, updated_at = ? WHERE id = ?`).bind(m, note ?? entry.note, nowSec(), entry.id),
    logStmt(env, { list: entry.list, phone: entry.phone, action: 'edit', by, minutes: m, before: entry.minutes, entryId: entry.id }),
  ]);
}

export async function deleteEntry(env, entry, by) {
  await db(env).batch([
    db(env).prepare(`DELETE FROM minutes_entries WHERE id = ?`).bind(entry.id),
    logStmt(env, { list: entry.list, phone: entry.phone, action: 'delete', by, before: entry.minutes, entryId: entry.id }),
  ]);
}
