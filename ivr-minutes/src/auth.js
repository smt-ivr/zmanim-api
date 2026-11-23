// Passwords of the admin page, kept hashed (PBKDF2) in minutes_settings. Two roles:
//   admin    'admin_password'    everything
//   manager  'manager_password'  the line's manager: the main list only, no lists of her own, no Yemot
//                                token, no password changes, no deleting history (see admin.js)
// A login gives a token "<role>.<exp>.<sig>" for 30 days, signed with the role's own random secret
// ('token_secret' / 'manager_token_secret'). Changing a role's password replaces its secret, which
// logs out everyone who used it.
import { first, nowSec, run } from './data.js';

const TOKEN_DAYS = 30;
const LOGIN_LIMIT = { fails: 8, window: 15 * 60 };
const PBKDF2_ITERATIONS = 100000;
export const ROLES = {
  admin: { password: 'admin_password', secret: 'token_secret' },
  manager: { password: 'manager_password', secret: 'manager_token_secret' },
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

function sameText(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256));
}

/** "pbkdf2$<iterations>$<salt>$<hash>" */
export async function hashPassword(password) {
  const salt = randomHex(16);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2(String(password), salt, PBKDF2_ITERATIONS)}`;
}

async function verifyPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  return sameText(await pbkdf2(String(password), salt, +iter), hash);
}

export const setting = async (env, key) => (await first(env, `SELECT value FROM minutes_settings WHERE key = ?`, key))?.value ?? null;
const putSetting = (env, key, value) => run(env, `INSERT INTO minutes_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);

/** Sets a role's password and logs out everyone who used it. */
export async function setPassword(env, password, role = 'admin') {
  await putSetting(env, ROLES[role].password, await hashPassword(password));
  await putSetting(env, ROLES[role].secret, randomHex(32));
}

async function tokenSecret(env, role) {
  const key = ROLES[role].secret;
  let s = await setting(env, key);
  if (!s) {
    await run(env, `INSERT OR IGNORE INTO minutes_settings (key, value) VALUES (?, ?)`, key, randomHex(32));
    s = await setting(env, key);
  }
  return s;
}

async function sign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function makeToken(env, role = 'admin') {
  const head = `${role}.${nowSec() + TOKEN_DAYS * 86400}`;
  return `${head}.${await sign(await tokenSecret(env, role), head)}`;
}

/** Returns the role of a valid token, or throws 401. */
export async function checkToken(env, request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const [role, exp, sig] = token.split('.');
  if (!ROLES[role] || !exp || !sig || +exp < nowSec() || !sameText(sig, await sign(await tokenSecret(env, role), `${role}.${exp}`))) {
    throw new HttpError(401, 'יש להתחבר מחדש');
  }
  return role;
}

/** Counts wrong passwords per IP (login and password change); too many -> blocked for a quarter of an hour. */
async function guard(env, request, check) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const t = nowSec();
  const row = await first(env, `SELECT * FROM minutes_logins WHERE ip = ?`, ip);
  if (row && row.first_at > t - LOGIN_LIMIT.window && row.fails >= LOGIN_LIMIT.fails) throw new HttpError(429, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה');
  const result = await check();
  if (!result) {
    await run(env, `INSERT INTO minutes_logins (ip, fails, first_at) VALUES (?, 1, ?)
      ON CONFLICT(ip) DO UPDATE SET fails = CASE WHEN first_at > ? THEN fails + 1 ELSE 1 END, first_at = CASE WHEN first_at > ? THEN first_at ELSE excluded.first_at END`,
    ip, t, t - LOGIN_LIMIT.window, t - LOGIN_LIMIT.window);
    throw new HttpError(401, 'סיסמה שגויה');
  }
  await run(env, `DELETE FROM minutes_logins WHERE ip = ? OR first_at < ?`, ip, t - 86400);
  return result;
}

/** Login with either password. Returns { token, role }. */
export async function login(env, request) {
  const [admin, manager] = await Promise.all([setting(env, ROLES.admin.password), setting(env, ROLES.manager.password)]);
  if (!admin) throw new HttpError(503, 'לא הוגדרה סיסמת ניהול');
  const body = await request.json().catch(() => ({}));
  const password = String(body.password ?? '');
  const role = await guard(env, request, async () => {
    if (await verifyPassword(password, admin)) return 'admin';
    if (manager && (await verifyPassword(password, manager))) return 'manager';
    return null;
  });
  return { token: await makeToken(env, role), role };
}

/** The admin changes their own password. */
export async function changePassword(env, request) {
  const body = await request.json().catch(() => ({}));
  const next = String(body.next ?? '');
  if (next.length < 4 || next.length > 200) throw new HttpError(400, 'הסיסמה החדשה צריכה להיות לפחות 4 תווים');
  const stored = await setting(env, ROLES.admin.password);
  await guard(env, request, () => verifyPassword(body.current ?? '', stored));
  if (await verifyPassword(next, await setting(env, ROLES.manager.password))) throw new HttpError(400, 'זו הסיסמה של המנהלת. בחרו סיסמה אחרת');
  await setPassword(env, next, 'admin');
  return makeToken(env, 'admin'); // this browser stays logged in
}

/** The admin sets the manager's password (logs the manager out everywhere). */
export async function setManagerPassword(env, request) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code ?? '').trim();
  if (code.length < 4 || code.length > 200) throw new HttpError(400, 'הסיסמה צריכה להיות לפחות 4 תווים');
  if (await verifyPassword(code, await setting(env, ROLES.admin.password))) throw new HttpError(400, 'זו הסיסמה הראשית. בחרו סיסמה אחרת למנהלת');
  await setPassword(env, code, 'manager');
  return { ok: true };
}

export async function removeManagerPassword(env) {
  await run(env, `DELETE FROM minutes_settings WHERE key IN (?, ?)`, ROLES.manager.password, ROLES.manager.secret);
  return { ok: true };
}
