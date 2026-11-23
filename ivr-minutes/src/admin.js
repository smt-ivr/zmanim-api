// JSON API for the admin page (login and password: auth.js).
import { changePassword, checkToken, HttpError, login, setting } from './auth.js';
import { addEntry, all, db, deleteEntry, first, getKey, listName, normalizePhone, rotateKey, run, TZ, updateEntry } from './data.js';

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

async function entryOr404(env, id) {
  const e = await first(env, `SELECT * FROM minutes_entries WHERE id = ?`, Number(id));
  if (!e) throw new HttpError(404, 'הרישום לא נמצא');
  return e;
}

const csvCell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

// ------------------------------------------------------------------ routes
const ROUTES = [
  ['GET', /^status$/, async (env) => json({ configured: !!(await setting(env, 'admin_password')) }), { open: true }],
  ['POST', /^login$/, async (env, req) => json({ token: await login(env, req) }), { open: true }],
  ['POST', /^password$/, async (env, req) => json({ token: await changePassword(env, req) })],

  ['GET', /^lists$/, async (env) => {
    const rows = await all(env, `SELECT list, COUNT(DISTINCT phone) AS phones, COUNT(*) AS entries, COALESCE(SUM(minutes), 0) AS minutes FROM minutes_entries GROUP BY list ORDER BY list`);
    if (!rows.some((r) => r.list === 'main')) rows.unshift({ list: 'main', phones: 0, entries: 0, minutes: 0 });
    return json(rows);
  }],

  ['GET', /^summary$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const day = israelDayStart();
    const r = await first(env, `SELECT COALESCE(SUM(minutes), 0) AS minutes, COUNT(DISTINCT phone) AS phones, COUNT(*) AS entries,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN minutes END), 0) AS today_minutes,
      COUNT(DISTINCT CASE WHEN created_at >= ? THEN phone END) AS today_phones
      FROM minutes_entries WHERE list = ?`, day, day, list);
    return json(r);
  }],

  ['GET', /^people$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const rows = await all(env, `SELECT e.phone, COALESCE(p.name, '') AS name, SUM(e.minutes) AS minutes, COUNT(*) AS entries, MAX(e.created_at) AS last_at
      FROM minutes_entries e LEFT JOIN minutes_people p ON p.list = e.list AND p.phone = e.phone
      WHERE e.list = ? GROUP BY e.phone ORDER BY minutes DESC, e.phone`, list);
    // people with a name but no entries (yet)
    const named = await all(env, `SELECT phone, name FROM minutes_people WHERE list = ? AND phone NOT IN (SELECT phone FROM minutes_entries WHERE list = ?)`, list, list);
    return json([...rows, ...named.map((n) => ({ ...n, minutes: 0, entries: 0, last_at: null }))]);
  }],

  ['GET', /^people\/(\d+)$/, async (env, req, url, [raw]) => {
    const list = listName(url.searchParams.get('list'));
    const phone = phoneParam(raw);
    const [person, entries] = await Promise.all([
      first(env, `SELECT name FROM minutes_people WHERE list = ? AND phone = ?`, list, phone),
      all(env, `SELECT * FROM minutes_entries WHERE list = ? AND phone = ? ORDER BY created_at DESC, id DESC`, list, phone),
    ]);
    return json({ phone, name: person?.name || '', minutes: entries.reduce((s, e) => s + e.minutes, 0), entries });
  }],

  ['PUT', /^people\/(\d+)$/, async (env, req, url, [raw]) => {
    const body = await req.json().catch(() => ({}));
    const list = listName(body.list);
    const phone = phoneParam(raw);
    const name = String(body.name ?? '').trim().slice(0, 80);
    if (name) await run(env, `INSERT INTO minutes_people (list, phone, name) VALUES (?, ?, ?) ON CONFLICT(list, phone) DO UPDATE SET name = excluded.name`, list, phone, name);
    else await run(env, `DELETE FROM minutes_people WHERE list = ? AND phone = ?`, list, phone);
    return json({ ok: true });
  }],

  ['DELETE', /^people\/(\d+)$/, async (env, req, url, [raw]) => {
    const list = listName(url.searchParams.get('list'));
    const phone = phoneParam(raw);
    const entries = await all(env, `SELECT * FROM minutes_entries WHERE list = ? AND phone = ?`, list, phone);
    for (const e of entries) await deleteEntry(env, e, 'admin');
    await run(env, `DELETE FROM minutes_people WHERE list = ? AND phone = ?`, list, phone);
    return json({ deleted: entries.length });
  }],

  ['POST', /^entries$/, async (env, req) => {
    const body = await req.json().catch(() => ({}));
    const id = await addEntry(env, {
      list: listName(body.list), phone: phoneParam(body.phone), minutes: minutesParam(body.minutes), source: 'admin', note: String(body.note ?? '').slice(0, 200),
    });
    return json({ id }, 201);
  }],

  ['PATCH', /^entries\/(\d+)$/, async (env, req, url, [id]) => {
    const body = await req.json().catch(() => ({}));
    const e = await entryOr404(env, id);
    await updateEntry(env, e, { minutes: body.minutes == null ? undefined : minutesParam(body.minutes), note: body.note == null ? undefined : String(body.note).slice(0, 200) }, 'admin');
    return json({ ok: true });
  }],

  ['DELETE', /^entries\/(\d+)$/, async (env, req, url, [id]) => {
    await deleteEntry(env, await entryOr404(env, id), 'admin');
    return json({ ok: true });
  }],

  ['GET', /^log$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 1000);
    return json(await all(env, `SELECT l.*, COALESCE(p.name, '') AS name FROM minutes_log l LEFT JOIN minutes_people p ON p.list = l.list AND p.phone = l.phone
      WHERE l.list = ? ORDER BY l.at DESC, l.id DESC LIMIT ?`, list, limit));
  }],

  ['DELETE', /^lists\/([^/]+)$/, async (env, req, url, [raw]) => {
    const list = listName(decodeURIComponent(raw));
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== list) throw new HttpError(400, 'יש להקליד את שם הרשימה לאישור');
    await db(env).batch(['minutes_entries', 'minutes_people', 'minutes_log'].map((t) => db(env).prepare(`DELETE FROM ${t} WHERE list = ?`).bind(list)));
    return json({ ok: true });
  }],

  ['GET', /^export$/, async (env, req, url) => {
    const list = listName(url.searchParams.get('list'));
    const rows = await all(env, `SELECT e.phone, COALESCE(p.name, '') AS name, SUM(e.minutes) AS minutes, COUNT(*) AS entries, MAX(e.created_at) AS last_at
      FROM minutes_entries e LEFT JOIN minutes_people p ON p.list = e.list AND p.phone = e.phone WHERE e.list = ? GROUP BY e.phone ORDER BY minutes DESC`, list);
    const fmt = (s) => (s ? new Date(s * 1000).toLocaleString('he-IL', { timeZone: TZ }) : '');
    const lines = [['טלפון', 'שם', 'דקות', 'עדכונים', 'עדכון אחרון'], ...rows.map((r) => [r.phone, r.name, r.minutes, r.entries, fmt(r.last_at)])];
    return new Response('﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="minutes-${encodeURIComponent(list)}.csv"`, 'Cache-Control': 'no-store' },
    });
  }],

  ['GET', /^settings$/, async (env) => json({ key: await getKey(env) })],
  ['POST', /^settings\/rotate-key$/, async (env) => json({ key: await rotateKey(env) })],
];

export async function handleAdmin(request, env, sub) {
  try {
    const url = new URL(request.url);
    for (const [method, re, fn, opts = {}] of ROUTES) {
      const m = re.exec(sub);
      if (!m || method !== request.method) continue;
      if (!opts.open) await checkToken(env, request);
      return await fn(env, request, url, m.slice(1));
    }
    throw new HttpError(404, 'נתיב לא קיים');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`[ivr-minutes ${ref}]`, err?.stack || err);
    return json({ error: `שגיאת שרת (קוד ${ref})` }, 500);
  }
}
