// JSON API for the admin page (passwords and roles: auth.js).
//
// Two roles. 'admin' can do everything. 'manager' (the line's manager) works on the main list only
// (any other list in a request is replaced by 'main'), and cannot: change passwords, see or set the
// Yemot token and recordings settings, change the access key, delete a list, or delete history.
// Every change is logged with who made it (by: admin | manager | phone).
import { changePassword, checkToken, HttpError, login, removeManagerPassword, ROLES, setManagerPassword, setting } from './auth.js';
import { all, db, deleteEntry, first, getKey, listName, normalizePhone, rotateKey, run, TZ, updateEntry } from './data.js';
import { importLog } from './import.js';
import { getConfig, saveConfig } from './config.js';
import * as rec from './recordings.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// ------------------------------------------------------------------ helpers
function israelDayStart(nowMs = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = local - Math.floor(nowMs / 1000) * 1000;
  return Math.floor((Date.UTC(+p.year, +p.month - 1, +p.day) - off) / 1000);
}

function phoneParam(raw) {
  const p = normalizePhone(raw);
  if (!p) throw new HttpError(400, 'מספר טלפון לא תקין');
  return p;
}

function minutesParam(v, { allowZero = false } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || Math.abs(n) > 999999 || (!allowZero && n === 0)) throw new HttpError(400, 'מספר דקות לא תקין');
  return n;
}

async function entryOr404(env, id, ctx) {
  const e = await first(env, `SELECT * FROM minutes_entries WHERE id = ?`, Number(id));
  if (!e || (ctx.role !== 'admin' && e.list !== 'main')) throw new HttpError(404, 'הרישום לא נמצא');
  return e;
}

/**
 * The period a request looks at (?period=): 'current' (default: since the last reset), 'all', or the id of a
 * reset (the period that reset closed). Returns { from, to } in epoch seconds (from inclusive, to exclusive).
 */
async function range(env, list, period) {
  if (period === 'all') return { from: 0, to: 4e9 };
  const resets = await all(env, `SELECT id, at FROM minutes_resets WHERE list = ? ORDER BY at, id`, list);
  if (!period || period === 'current') return { from: resets.length ? resets[resets.length - 1].at : 0, to: 4e9 };
  const i = resets.findIndex((r) => String(r.id) === String(period));
  if (i < 0) throw new HttpError(404, 'התקופה לא נמצאה');
  return { from: i ? resets[i - 1].at : 0, to: resets[i].at };
}
const rangeOf = (env, url) => range(env, listName(url.searchParams.get('list')), url.searchParams.get('period'));

const csvCell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const body = (req) => req.json().catch(() => ({}));
const LOG_BY = ['admin', 'manager', 'phone'];

// ------------------------------------------------------------------ routes: [method, path, handler(env, req, url, captures, ctx), { open, admin }]
const ROUTES = [
  ['GET', /^status$/, async (env) => json({ configured: !!(await setting(env, ROLES.admin.password)) }), { open: true }],
  ['POST', /^login$/, async (env, req) => json(await login(env, req)), { open: true }],
  ['GET', /^me$/, async (env, req, url, m, ctx) => json({ role: ctx.role, manager_set: !!(await setting(env, ROLES.manager.password)) })],
  ['POST', /^password$/, async (env, req) => json({ token: await changePassword(env, req) }), { admin: true }],
  ['POST', /^manager-password$/, async (env, req) => json(await setManagerPassword(env, req)), { admin: true }],
  ['DELETE', /^manager-password$/, async (env) => json(await removeManagerPassword(env)), { admin: true }],

  ['GET', /^lists$/, async (env, req, url, m, ctx) => {
    let rows = await all(env, `SELECT list, COUNT(DISTINCT phone) AS phones, COUNT(*) AS entries, COALESCE(SUM(minutes), 0) AS minutes FROM minutes_entries GROUP BY list ORDER BY list`);
    if (ctx.role !== 'admin') rows = rows.filter((r) => r.list === 'main');
    if (!rows.some((r) => r.list === 'main')) rows.unshift({ list: 'main', phones: 0, entries: 0, minutes: 0 });
    return json(rows);
  }],

  ['GET', /^summary$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const { from, to } = await rangeOf(env, url);
    const day = israelDayStart();
    const week = day - new Date(Date.now() + 3 * 3600e3).getUTCDay() * 86400; // from Sunday (approximately, Israel time)
    const r = await first(env, `SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(DISTINCT phone) AS phones, COUNT(*) AS entries,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN minutes END), 0) AS today_minutes,
      COUNT(DISTINCT CASE WHEN created_at >= ? THEN phone END) AS today_phones,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN minutes END), 0) AS week_minutes,
      COUNT(DISTINCT CASE WHEN created_at >= ? THEN phone END) AS week_phones
      FROM minutes_entries WHERE list = ? AND created_at >= ? AND created_at < ?`, day, day, week, week, list, from, to);
    r.period_from = from;
    r.blocked = (await first(env, `SELECT COUNT(*) AS n FROM minutes_blocked`)).n;
    return json(r);
  }],

  ['GET', /^people$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const { from, to } = await rangeOf(env, url);
    const rows = await all(env, `SELECT e.phone, COALESCE(p.name, '') AS name, SUM(e.minutes) AS minutes, COUNT(*) AS entries, MAX(e.created_at) AS last_at, EXISTS(SELECT 1 FROM minutes_blocked b WHERE b.phone = e.phone) AS blocked
      FROM minutes_entries e LEFT JOIN minutes_people p ON p.list = e.list AND p.phone = e.phone
      WHERE e.list = ? AND e.created_at >= ? AND e.created_at < ? GROUP BY e.phone ORDER BY minutes DESC, e.phone`, list, from, to);
    // people with a name but no entries (yet)
    const named = await all(env, `SELECT phone, name FROM minutes_people WHERE list = ? AND phone NOT IN (SELECT phone FROM minutes_entries WHERE list = ? AND created_at >= ? AND created_at < ?)`, list, list, from, to);
    return json([...rows, ...named.map((n) => ({ ...n, minutes: 0, entries: 0, last_at: null, blocked: 0 }))]);
  }],

  ['GET', /^people\/(\d+)$/, async (env, req, url, [raw]) => {
    const list = listName(url.searchParams.get('list'));
    const phone = phoneParam(raw);
    const { from, to } = await rangeOf(env, url);
    const [person, entries, blocked, ever] = await Promise.all([
      first(env, `SELECT name FROM minutes_people WHERE list = ? AND phone = ?`, list, phone),
      all(env, `SELECT * FROM minutes_entries WHERE list = ? AND phone = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC, id DESC`, list, phone, from, to),
      first(env, `SELECT note FROM minutes_blocked WHERE phone = ?`, phone),
      first(env, `SELECT COALESCE(SUM(minutes), 0) AS t FROM minutes_entries WHERE list = ? AND phone = ?`, list, phone),
    ]);
    return json({ phone, name: person?.name || '', minutes: entries.reduce((s, e) => s + e.minutes, 0), ever: ever.t, entries, blocked: Boolean(blocked), blocked_note: blocked?.note ?? '' });
  }],

  ['PUT', /^people\/(\d+)$/, async (env, req, url, [raw]) => {
    const b = await body(req);
    const list = listName(b.list);
    const phone = phoneParam(raw);
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (name) await run(env, `INSERT INTO minutes_people (list, phone, name) VALUES (?, ?, ?) ON CONFLICT(list, phone) DO UPDATE SET name = excluded.name`, list, phone, name);
    else await run(env, `DELETE FROM minutes_people WHERE list = ? AND phone = ?`, list, phone);
    return json({ ok: true });
  }],

  ['DELETE', /^people\/(\d+)$/, async (env, req, url, [raw], ctx) => {
    const list = listName(url.searchParams.get('list'));
    const phone = phoneParam(raw);
    const entries = await all(env, `SELECT * FROM minutes_entries WHERE list = ? AND phone = ?`, list, phone);
    for (const e of entries) await deleteEntry(env, e, ctx.role);
    await run(env, `DELETE FROM minutes_people WHERE list = ? AND phone = ?`, list, phone);
    return json({ deleted: entries.length });
  }],

  ['POST', /^entries$/, async (env, req, url, m, ctx) => {
    const b = await body(req);
    const list = listName(b.list);
    const phone = phoneParam(b.phone);
    const minutes = minutesParam(b.minutes);
    const t = Math.floor(Date.now() / 1000);
    const res = await db(env).prepare(`INSERT INTO minutes_entries (list, phone, minutes, source, call_id, note, created_at, updated_at) VALUES (?, ?, ?, 'admin', NULL, ?, ?, ?)`)
      .bind(list, phone, minutes, String(b.note ?? '').slice(0, 200), t, t).run();
    const id = res.meta.last_row_id;
    await run(env, `INSERT INTO minutes_log (at, list, phone, action, by, minutes, before, entry_id) VALUES (?, ?, ?, 'add', ?, ?, NULL, ?)`, t, list, phone, ctx.role, minutes, id);
    return json({ id }, 201);
  }],

  ['PATCH', /^entries\/(\d+)$/, async (env, req, url, [id], ctx) => {
    const b = await body(req);
    const e = await entryOr404(env, id, ctx);
    await updateEntry(env, e, { minutes: b.minutes == null ? undefined : minutesParam(b.minutes), note: b.note == null ? undefined : String(b.note).slice(0, 200) }, ctx.role);
    return json({ ok: true });
  }],

  ['DELETE', /^entries\/(\d+)$/, async (env, req, url, [id], ctx) => {
    await deleteEntry(env, await entryOr404(env, id, ctx), ctx.role);
    return json({ ok: true });
  }],

  // periods: a reset starts the count over without deleting anything (both roles; the manager on the main list)
  ['GET', /^periods$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const resets = await all(env, `SELECT * FROM minutes_resets WHERE list = ? ORDER BY at, id`, list);
    const current = await first(env, `SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(DISTINCT phone) AS phones FROM minutes_entries WHERE list = ? AND created_at >= ?`,
      list, resets.length ? resets[resets.length - 1].at : 0);
    return json({
      current: { from: resets.length ? resets[resets.length - 1].at : 0, minutes: current.minutes, phones: current.phones },
      past: resets.map((r, i) => ({ id: r.id, from: i ? resets[i - 1].at : 0, to: r.at, by: r.by, note: r.note, minutes: r.minutes, phones: r.phones })).reverse(),
    });
  }],
  ['POST', /^reset$/, async (env, req, url, m, ctx) => {
    const b = await body(req);
    const list = listName(b.list);
    const t = Math.floor(Date.now() / 1000);
    const { from } = await range(env, list, 'current');
    const cur = await first(env, `SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(DISTINCT phone) AS phones FROM minutes_entries WHERE list = ? AND created_at >= ?`, list, from);
    await db(env).batch([
      db(env).prepare(`INSERT INTO minutes_resets (list, at, by, note, minutes, phones) VALUES (?, ?, ?, ?, ?, ?)`).bind(list, t, ctx.role, String(b.note ?? '').trim().slice(0, 200), cur.minutes, cur.phones),
      db(env).prepare(`INSERT INTO minutes_log (at, list, phone, action, by, minutes, before, entry_id) VALUES (?, ?, '', 'reset', ?, ?, ?, NULL)`).bind(t, list, ctx.role, cur.minutes, cur.phones),
    ]);
    return json({ ok: true, closed: cur });
  }],
  ['DELETE', /^reset$/, async (env, req, url, m, ctx) => {
    const list = listName(url.searchParams.get('list'));
    const last = await first(env, `SELECT * FROM minutes_resets WHERE list = ? ORDER BY at DESC, id DESC LIMIT 1`, list);
    if (!last) throw new HttpError(404, 'אין איפוס לביטול');
    await db(env).batch([
      db(env).prepare(`DELETE FROM minutes_resets WHERE id = ?`).bind(last.id),
      db(env).prepare(`INSERT INTO minutes_log (at, list, phone, action, by, minutes, before, entry_id) VALUES (?, ?, '', 'unreset', ?, ?, ?, NULL)`).bind(Math.floor(Date.now() / 1000), list, ctx.role, last.minutes, last.phones),
    ]);
    return json({ ok: true });
  }],

  // history: everyone sees it (by=admin|manager|phone filters), only the admin deletes it
  ['GET', /^log$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const by = url.searchParams.get('by');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 300, 1), 2000);
    const filter = LOG_BY.includes(by) ? ' AND l.by = ?' : '';
    return json(await all(env, `SELECT l.*, COALESCE(p.name, '') AS name FROM minutes_log l LEFT JOIN minutes_people p ON p.list = l.list AND p.phone = l.phone
      WHERE l.list = ?${filter} ORDER BY l.at DESC, l.id DESC LIMIT ?`, list, ...(filter ? [by] : []), limit));
  }],
  ['DELETE', /^log$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const scope = url.searchParams.get('scope');
    if (!['mine', 'all'].includes(scope)) throw new HttpError(400, 'מה למחוק: scope=mine או scope=all');
    const res = scope === 'mine'
      ? await run(env, `DELETE FROM minutes_log WHERE list = ? AND by = 'admin'`, list)
      : await run(env, `DELETE FROM minutes_log WHERE list = ?`, list);
    return json({ deleted: res.meta.changes });
  }, { admin: true }],
  ['DELETE', /^log\/(\d+)$/, async (env, req, url, [id]) => {
    await run(env, `DELETE FROM minutes_log WHERE id = ?`, Number(id));
    return json({ ok: true });
  }, { admin: true }],

  ['DELETE', /^lists\/([^/]+)$/, async (env, req, url, [raw]) => {
    const list = listName(decodeURIComponent(raw));
    const b = await body(req);
    if (b.confirm !== list) throw new HttpError(400, 'יש להקליד את שם הרשימה לאישור');
    await db(env).batch(['minutes_entries', 'minutes_people', 'minutes_log'].map((t) => db(env).prepare(`DELETE FROM ${t} WHERE list = ?`).bind(list)));
    return json({ ok: true });
  }, { admin: true }],

  ['GET', /^export$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const { from, to } = await rangeOf(env, url);
    const rows = await all(env, `SELECT e.phone, COALESCE(p.name, '') AS name, SUM(e.minutes) AS minutes, COUNT(*) AS entries, MAX(e.created_at) AS last_at
      FROM minutes_entries e LEFT JOIN minutes_people p ON p.list = e.list AND p.phone = e.phone WHERE e.list = ? AND e.created_at >= ? AND e.created_at < ? GROUP BY e.phone ORDER BY minutes DESC`, list, from, to);
    const fmt = (s) => (s ? new Date(s * 1000).toLocaleString('he-IL', { timeZone: TZ }) : '');
    const lines = [['טלפון', 'שם', 'דקות', 'עדכונים', 'עדכון אחרון'], ...rows.map((r) => [r.phone, r.name, r.minutes, r.entries, fmt(r.last_at)])];
    return new Response('﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="minutes-${encodeURIComponent(list)}.csv"`, 'Cache-Control': 'no-store' },
    });
  }],

  // blocked numbers: cannot add by phone (can still hear the totals)
  ['GET', /^blocked$/, async (env) => json(await all(env, `SELECT b.*, (SELECT COALESCE(SUM(minutes), 0) FROM minutes_entries e WHERE e.phone = b.phone) AS minutes
    FROM minutes_blocked b ORDER BY b.created_at DESC`))],
  ['POST', /^blocked$/, async (env, req, url, m, ctx) => {
    const b = await body(req);
    const phone = phoneParam(b.phone);
    await run(env, `INSERT INTO minutes_blocked (phone, note, created_at) VALUES (?, ?, ?) ON CONFLICT(phone) DO UPDATE SET note = excluded.note`,
      phone, String(b.note ?? '').trim().slice(0, 200), Math.floor(Date.now() / 1000));
    let deleted = 0;
    if (b.delete_entries) {
      const entries = ctx.role === 'admin'
        ? await all(env, `SELECT * FROM minutes_entries WHERE phone = ?`, phone)
        : await all(env, `SELECT * FROM minutes_entries WHERE phone = ? AND list = 'main'`, phone);
      for (const e of entries) await deleteEntry(env, e, ctx.role);
      deleted = entries.length;
    }
    return json({ phone, blocked: true, deleted });
  }],
  ['DELETE', /^blocked\/(\d+)$/, async (env, req, url, [raw]) => {
    await run(env, `DELETE FROM minutes_blocked WHERE phone = ?`, phoneParam(raw));
    return json({ blocked: false });
  }],

  // import from the old Yemot extension's log (import.js)
  ['POST', /^import$/, async (env, req) => json(await importLog(env, req))],

  // recordings (recordings.js): the manager can record, but never sees or sets the token
  ['GET', /^recordings$/, (env, req, url, m, ctx) => rec.list(env, req, url, url.pathname.slice(0, url.pathname.lastIndexOf('/api/')), ctx.role)],
  ['PATCH', /^recordings\/settings$/, (env, req) => rec.patchSettings(env, req), { admin: true }],
  ['POST', /^recordings\/test$/, (env) => rec.test(env), { admin: true }],
  ['POST', /^recordings\/([a-z0-9_]+)$/, (env, req, url, [key]) => rec.upload(env, req, key)],
  ['PATCH', /^recordings\/([a-z0-9_]+)$/, (env, req, url, [key]) => rec.setPaused(env, req, key)],
  ['DELETE', /^recordings\/([a-z0-9_]+)$/, (env, req, url, [key]) => rec.remove(env, key)],
  ['GET', /^recordings\/([a-z0-9_]+)\/audio$/, (env, req, url, [key]) => rec.audio(env, key)],

  // the extensions' settings (config.js): both roles; the manager on the main list
  ['GET', /^config$/, async (env, req, url) => json(await getConfig(env, listName(url.searchParams.get('list'))))],
  ['PUT', /^config$/, async (env, req) => {
    const b = await body(req);
    return json(await saveConfig(env, listName(b.list), b));
  }],

  ['GET', /^settings$/, async (env) => json({ key: await getKey(env) })],
  ['POST', /^settings\/rotate-key$/, async (env) => json({ key: await rotateKey(env) }), { admin: true }],
];

/** The manager works on the main list only: any list in the query or a JSON body becomes 'main'. */
async function mainListOnly(request, url) {
  url.searchParams.set('list', 'main');
  if (!['POST', 'PUT', 'PATCH'].includes(request.method) || !(request.headers.get('Content-Type') || '').includes('json')) return request;
  const data = await request.json().catch(() => ({}));
  if (data && typeof data === 'object' && !Array.isArray(data)) data.list = 'main';
  return new Request(url, { method: request.method, headers: request.headers, body: JSON.stringify(data) });
}

export async function handleAdmin(request, env, sub) {
  try {
    const url = new URL(request.url);
    for (const [method, re, fn, opts = {}] of ROUTES) {
      const m = re.exec(sub);
      if (!m || method !== request.method) continue;
      const ctx = { role: null };
      let req = request;
      if (!opts.open) {
        ctx.role = await checkToken(env, request);
        if (opts.admin && ctx.role !== 'admin') throw new HttpError(403, 'אין לך הרשאה לפעולה הזו');
        if (ctx.role !== 'admin') req = await mainListOnly(request, url);
      }
      return await fn(env, req, url, m.slice(1), ctx);
    }
    throw new HttpError(404, 'נתיב לא קיים');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`[ivr-minutes ${ref}]`, err?.stack || err);
    return json({ error: `שגיאת שרת (קוד ${ref})` }, 500);
  }
}
