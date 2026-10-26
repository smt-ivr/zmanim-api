// Locks and blocks (super admin): every rate-limit lock in login_attempts, explained (whose account,
// which IP, which channel), with unlock and manual lock; plus unlocking one user from the users page.
import { requirePerm } from '../auth.js';
import { all, first, nowSec, run } from '../db.js';
import { invalid, json, noContent, notFound, readJson } from '../http.js';
import { fields, id, normalizeEmail, normalizePhone } from '../validate.js';

/** What each key prefix means (see auth.js, routes/auth.js, routes/registrations.js, ivr/flow.js). */
const KINDS = {
  login: 'כניסה עם סיסמה',
  ip: 'כתובת IP (כניסות)',
  phone: 'סיסמה בשלוחת הטלפון',
  google: 'כניסה עם Google',
  mail: 'שליחת קישורים למייל',
  'reg:ip': 'הצטרפות: כתובת IP',
  'reg:email': 'הצטרפות: מייל',
};
const kindOf = (key) => (key.startsWith('reg:ip:') ? 'reg:ip' : key.startsWith('reg:email:') ? 'reg:email' : key.split(':')[0]);
const valueOf = (key, kind) => key.slice(kind.length + 1);

/** Lock keys that belong to a user (unlocking the user clears them all). */
const userKeys = (u) => [
  u.email && `login:${u.email}`, u.phone && `login:${u.phone}`, `phone:${u.id}`, u.email && `google:${u.email}`, `mail:${u.id}`,
].filter(Boolean);

/** GET /admin/locks: active locks first, then recent failed attempts (last 24 hours). */
export async function list({ env }) {
  const now = nowSec();
  const rows = await all(env, `SELECT * FROM login_attempts WHERE locked_until > ? OR window_start > ? ORDER BY locked_until DESC, window_start DESC LIMIT 500`, now, now - 86400);
  const users = await all(env, `SELECT id, name, email, phone, role FROM users`);
  const byId = new Map(users.map((u) => [String(u.id), u]));
  const byLogin = new Map(users.flatMap((u) => [[u.email?.toLowerCase(), u], [u.phone, u]]).filter(([k]) => k));
  return json(rows.map((r) => {
    const kind = kindOf(r.key);
    const value = valueOf(r.key, kind);
    const user = kind === 'phone' || kind === 'mail' ? byId.get(value) : kind === 'login' || kind === 'google' ? byLogin.get(value) : null;
    return {
      key: r.key, kind, kind_label: KINDS[kind] || kind, value: kind === 'phone' || kind === 'mail' ? (user?.name ?? value) : value,
      user: user ? { id: user.id, name: user.name } : null,
      failures: r.failures, locked: r.locked_until > now, locked_until: r.locked_until > now ? r.locked_until : null,
      since: r.window_start,
    };
  }));
}

/** DELETE /admin/locks?key=... (one) or without a key: every active lock. */
export async function unlock({ env, url }) {
  const key = url.searchParams.get('key');
  if (key) {
    const res = await run(env, `DELETE FROM login_attempts WHERE key = ?`, key);
    if (!res.meta.changes) throw notFound('החסימה כבר הוסרה');
  } else {
    await run(env, `DELETE FROM login_attempts WHERE locked_until > ?`, nowSec());
  }
  return noContent();
}

/** POST /admin/locks { type: ip|login|reg_email|reg_ip, value, hours }: lock by hand (e.g. an abusive IP). */
export async function lock({ env, request }) {
  const d = fields(await readJson(request))
    .oneOf('type', ['ip', 'login', 'reg_email', 'reg_ip'], { required: true })
    .str('value', { required: true, max: 200 })
    .int('hours', { required: true, min: 1, max: 24 * 365 })
    .done();
  let value = d.value;
  if (d.type === 'login' || d.type === 'reg_email') {
    value = normalizePhone(d.value) || normalizeEmail(d.value);
    if (!value) throw invalid({ value: d.type === 'login' ? 'מייל או טלפון לא תקינים' : 'מייל לא תקין' });
  }
  const key = { ip: `ip:${value}`, login: `login:${value}`, reg_email: `reg:email:${value}`, reg_ip: `reg:ip:${value}` }[d.type];
  const now = nowSec();
  await run(env,
    `INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?1, 0, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET locked_until = ?3`, key, now, now + d.hours * 3600);
  return json({ key }, 201);
}

/** Lock state of a user (for the users page). */
export async function userLock(env, u) {
  const keys = userKeys(u);
  const row = await first(env, `SELECT MAX(locked_until) AS until FROM login_attempts WHERE key IN (${keys.map(() => '?').join(',')})`, ...keys);
  return row?.until > nowSec() ? row.until : null;
}

/** POST /admin/users/:id/unlock: clears every lock and failed-attempt counter of the user. */
export async function unlockUser({ env, actor, params }) {
  const u = await first(env, `SELECT * FROM users WHERE id = ?`, id(params.id));
  if (!u || (u.is_super && !actor.is_super)) throw notFound('המשתמש לא נמצא');
  requirePerm(actor, u.role === 'admin' ? 'admins' : 'managers');
  const keys = userKeys(u);
  await run(env, `DELETE FROM login_attempts WHERE key IN (${keys.map(() => '?').join(',')})`, ...keys);
  return noContent();
}
