// Admin password: kept hashed (PBKDF2) in minutes_settings ('admin_password'). A login gives a token
// signed with a random secret ('token_secret') for 30 days. Changing the password replaces the
// secret, which logs everyone else out.
import { first, nowSec, run } from './data.js';

const TOKEN_DAYS = 30;
const LOGIN_LIMIT = { fails: 8, window: 15 * 60 };
const PBKDF2_ITERATIONS = 100000;

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

/** Sets the admin password and logs everyone out. */
export async function setPassword(env, password) {
  await putSetting(env, 'admin_password', await hashPassword(password));
  await putSetting(env, 'token_secret', randomHex(32));
}

async function tokenSecret(env) {
  let s = await setting(env, 'token_secret');
  if (!s) {
    await run(env, `INSERT OR IGNORE INTO minutes_settings (key, value) VALUES ('token_secret', ?)`, randomHex(32));
    s = await setting(env, 'token_secret');
  }
  return s;
}

async function sign(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function makeToken(env) {
  const exp = String(nowSec() + TOKEN_DAYS * 86400);
  return `${exp}.${await sign(await tokenSecret(env), exp)}`;
}

export async function checkToken(env, request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = token.split('.');
  if (!exp || !sig || +exp < nowSec() || !sameText(sig, await sign(await tokenSecret(env), exp))) throw new HttpError(401, 'יש להתחבר מחדש');
}

/** Counts wrong passwords per IP (login and password change); too many -> blocked for a quarter of an hour. */
async function guard(env, request, check) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const t = nowSec();
  const row = await first(env, `SELECT * FROM minutes_logins WHERE ip = ?`, ip);
  if (row && row.first_at > t - LOGIN_LIMIT.window && row.fails >= LOGIN_LIMIT.fails) throw new HttpError(429, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה');
  if (!(await check())) {
    await run(env, `INSERT INTO minutes_logins (ip, fails, first_at) VALUES (?, 1, ?)
      ON CONFLICT(ip) DO UPDATE SET fails = CASE WHEN first_at > ? THEN fails + 1 ELSE 1 END, first_at = CASE WHEN first_at > ? THEN first_at ELSE excluded.first_at END`,
    ip, t, t - LOGIN_LIMIT.window, t - LOGIN_LIMIT.window);
    throw new HttpError(401, 'סיסמה שגויה');
  }
  await run(env, `DELETE FROM minutes_logins WHERE ip = ? OR first_at < ?`, ip, t - 86400);
}

export async function login(env, request) {
  const stored = await setting(env, 'admin_password');
  if (!stored) throw new HttpError(503, 'לא הוגדרה סיסמת ניהול');
  const body = await request.json().catch(() => ({}));
  await guard(env, request, () => verifyPassword(body.password ?? '', stored));
  return makeToken(env);
}

export async function changePassword(env, request) {
  const body = await request.json().catch(() => ({}));
  const next = String(body.next ?? '');
  if (next.length < 4 || next.length > 200) throw new HttpError(400, 'הסיסמה החדשה צריכה להיות לפחות 4 תווים');
  const stored = await setting(env, 'admin_password');
  await guard(env, request, () => verifyPassword(body.current ?? '', stored));
  await setPassword(env, next);
  return makeToken(env); // this browser stays logged in
}
