// E-mail through Resend (https://resend.com). The API key and sender live in the control settings.
import { first, nowSec, run } from './db.js';
import { HttpError } from './http.js';
import { getSettings } from './settings.js';

const enc = new TextEncoder();
const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function mailReady(env) {
  const s = await getSettings(env);
  return Boolean(s.mail_enabled && s.resend_api_key && s.mail_from);
}

/** Sends one e-mail. Throws 409 when mail is not configured, 502 when Resend refuses. */
export async function sendMail(env, { to, subject, title, paragraphs = [], button }) {
  const s = await getSettings(env);
  if (!s.mail_enabled || !s.resend_api_key || !s.mail_from) throw new HttpError(409, 'MAIL_OFF', 'שליחת מיילים אינה מוגדרת. הגדירו אותה בהגדרות השליטה');
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#1b2333">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e3e7ef">
    <h2 style="margin:0 0 16px;font-size:20px">${esc(title || subject)}</h2>
    ${paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.6;white-space:pre-wrap">${esc(p)}</p>`).join('')}
    ${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#2f5bd3;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p>
    <p style="font-size:12px;color:#687389">אם הכפתור לא עובד, העתיקו את הקישור: <br><span dir="ltr">${esc(button.url)}</span></p>` : ''}
    <p style="font-size:12px;color:#687389;margin-top:24px">זמני מניינים</p>
  </div></body></html>`;
  const text = [title || subject, ...paragraphs, button ? `${button.label}: ${button.url}` : ''].filter(Boolean).join('\n\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.resend_api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: s.mail_from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error('[mail] resend', res.status, detail);
    throw new HttpError(502, 'MAIL_FAILED', `שליחת המייל נכשלה (${res.status}). בדקו את המפתח ואת כתובת השולח`);
  }
}

// ------------------------------------------------------------------ one-time links
const TTL = { login: 30 * 60, reset: 60 * 60, welcome: 7 * 24 * 3600 };

/** Creates a one-time token. purpose: 'login' | 'reset'. 'welcome' is a long-lived login link. */
export async function createEmailToken(env, userId, purpose) {
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await run(env, `INSERT INTO email_tokens (user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?)`,
    userId, await sha256(token), purpose === 'welcome' ? 'login' : purpose, nowSec() + TTL[purpose]);
  return token;
}

/** Marks the token used and returns its user, or throws 400. */
export async function consumeEmailToken(env, token, purpose) {
  const row = await first(env, `SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ?`, await sha256(String(token)), purpose);
  if (!row || row.used_at || row.expires_at < nowSec()) throw new HttpError(400, 'LINK_EXPIRED', 'הקישור אינו תקף או שכבר נוצל. בקשו קישור חדש');
  const res = await run(env, `UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`, nowSec(), row.id);
  if (!res.meta.changes) throw new HttpError(400, 'LINK_EXPIRED', 'הקישור כבר נוצל');
  const user = await first(env, `SELECT * FROM users WHERE id = ? AND is_active = 1`, row.user_id);
  if (!user) throw new HttpError(400, 'LINK_EXPIRED', 'המשתמש אינו פעיל');
  return user;
}

/** Admin UI address for links in e-mails, e.g. https://smti.uk/zmanim/admin/#/link?t=... */
export const adminUrl = (env, url, hash) => `${url.origin}${(env.BASE_PATH || '').replace(/\/$/, '')}/admin/#${hash}`;
