// E-mail through Resend (https://resend.com). The API key and sender live in the control settings.
import { first, nowSec, run } from './db.js';
import { HttpError } from './http.js';
import { getSettings } from './settings.js';
import { clean, normalizeEmail } from './validate.js';

const enc = new TextEncoder();
const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function mailReady(env) {
  const s = await getSettings(env);
  return Boolean(s.mail_enabled && s.resend_api_key && s.mail_from);
}

// Colors from the public site (web/site.css).
const C = { bg: '#f5f3ee', card: '#ffffff', border: '#e6e2d8', text: '#1d2433', muted: '#6b7180', primary: '#234a9c', primary2: '#2f5fc4', soft: '#e9eef9', accent: '#b8862b', accentSoft: '#f7efdd' };
const FONT = `system-ui,-apple-system,'Segoe UI',Rubik,Assistant,Arial,sans-serif`;

/**
 * The HTML of an e-mail in the site's look: header band, card, optional detail rows, quoted blocks and a button.
 * Built with tables and inline styles so it renders the same in Gmail, Outlook and phone apps.
 */
export function renderMail({ brand = 'מערכת זמני התפילות', title, preheader = '', paragraphs = [], details = [], quotes = [], button, note, footer }) {
  const p = (t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:${C.text}">${esc(t)}</p>`;
  const detailRows = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;background:${C.soft};border-radius:12px">
        ${details.map(([k, v]) => `<tr><td style="padding:10px 16px;font-size:14px;color:${C.muted};white-space:nowrap">${esc(k)}</td>
          <td style="padding:10px 16px;font-size:15px;font-weight:600;color:${C.text}">${esc(v)}</td></tr>`).join('')}
      </table>` : '';
  const quoteBlocks = quotes.map((q) => `<div style="margin:0 0 16px">
      <div style="font-size:13px;color:${C.muted};margin-bottom:6px">${esc(q.label)}</div>
      <div style="border-right:4px solid ${q.accent ? C.accent : C.primary2};background:${q.accent ? C.accentSoft : '#f9f8f5'};border-radius:8px;padding:12px 16px;font-size:15px;line-height:1.7;color:${C.text};white-space:pre-wrap">${esc(q.text)}</div>
    </div>`).join('');
  const cta = button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr>
      <td style="border-radius:10px;background:${C.primary}" bgcolor="${C.primary}">
        <a href="${esc(button.url)}" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;font-family:${FONT}">${esc(button.label)}</a>
      </td></tr></table>${button.hint ? `<p style="margin:0;font-size:13px;color:${C.muted}">${esc(button.hint)}</p>` : ''}` : '';
  const noteBox = note ? `<div style="margin-top:18px;padding:12px 16px;border-radius:10px;background:#f9f8f5;border:1px solid ${C.border};font-size:13px;color:${C.muted};line-height:1.6">${esc(note)}</div>` : '';
  const foot = [
    footer?.phone && `שמיעת הזמנים בטלפון: <b dir="ltr" style="color:${C.text}">${esc(footer.phone)}</b>`,
    footer?.site && `<a href="${esc(footer.site)}" style="color:${C.primary2};text-decoration:none">לאתר ${esc(brand)}</a>`,
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT}" dir="rtl">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="background:${C.primary};background-image:linear-gradient(135deg,${C.primary},${C.primary2});border-radius:16px 16px 0 0;padding:22px 28px" bgcolor="${C.primary}">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.18);text-align:center;vertical-align:middle;font-size:20px;color:#fff">&#128339;</td>
        <td style="padding-right:12px;font-size:19px;font-weight:700;color:#ffffff;font-family:${FONT}">${esc(brand)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:0;border-radius:0 0 16px 16px;padding:28px" dir="rtl">
      <h1 style="margin:0 0 18px;font-size:22px;line-height:1.4;color:${C.text};font-family:${FONT}">${esc(title)}</h1>
      ${paragraphs.filter(Boolean).map(p).join('')}
      ${detailRows}${quoteBlocks}${cta}${noteBox}
    </td></tr>
    <tr><td style="padding:18px 8px;text-align:center;font-size:12px;color:${C.muted};line-height:1.8">
      ${foot ? `${foot}<br>` : ''}מייל זה נשלח אוטומטית מ${esc(brand)}<br>
      <span style="font-size:11px;opacity:.75">פותח ע״י <b style="letter-spacing:1px">SMT</b></span>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/**
 * A reply in a thread: a light card with the text (no header band, no title), and below it a quiet
 * signature that links to the site; plus an invisible image that tells us when it was opened.
 */
export function renderPlain({ paragraphs = [], signature, pixel }) {
  const p = (t) => `<p style="margin:0 0 14px;line-height:1.8;font-size:15.5px;color:${C.text};white-space:pre-wrap">${esc(t)}</p>`;
  const sig = signature ? `<tr><td style="padding:14px 6px 0" dir="rtl">
      <a href="${esc(signature.url)}" style="text-decoration:none;color:${C.muted};font-size:13px;font-family:${FONT}">
        <span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:5px;background:${C.primary};color:#fff;text-align:center;font-size:11px;vertical-align:middle;margin-left:7px">&#128339;</span><span style="vertical-align:middle">${esc(signature.name)}</span></a>
    </td></tr>` : '';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body dir="rtl" style="margin:0;padding:0;background:${C.bg};font-family:${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
    <tr><td dir="rtl" style="background:${C.card};border:1px solid ${C.border};border-top:3px solid ${C.primary};border-radius:12px;padding:24px 26px 12px">
      ${paragraphs.filter(Boolean).map(p).join('')}
    </td></tr>
    ${sig}
  </table>
</td></tr></table>
${pixel ? `<img src="${esc(pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0">` : ''}
</body></html>`;
}

/**
 * Sends one e-mail. Throws 409 when mail is not configured, 502 when Resend refuses (with its reason).
 * mail: { to, subject, title, preheader?, paragraphs?, details?: [[label, value]], quotes?: [{ label, text, accent? }],
 *         button?: { label, url, hint? }, note?, site? (public site address for the footer), replyTo?, headers? }
 */
export async function sendMail(env, mail) {
  const s = await getSettings(env);
  if (!s.mail_enabled || !s.resend_api_key || !s.mail_from) throw new HttpError(409, 'MAIL_OFF', 'שליחת מיילים אינה מוגדרת. הגדירו אותה בהגדרות השליטה');
  const to = normalizeEmail(mail.to);
  if (!to) throw new HttpError(422, 'BAD_EMAIL', `כתובת המייל של הנמען אינה תקינה: ${clean(mail.to)}`);
  const title = mail.title || mail.subject;
  const html = mail.plain ? renderPlain(mail) : renderMail({ ...mail, brand: s.system_name, title, preheader: mail.preheader || mail.paragraphs?.[0] || '', footer: { phone: s.listen_enabled ? s.listen_phone : '', site: mail.site } });
  const text = mail.plain ? [...(mail.paragraphs || []).filter(Boolean), '', `--\n${mail.signature?.name || ''}\n${mail.signature?.url || ''}`].join('\n\n') : [
    title, ...(mail.paragraphs || []).filter(Boolean),
    ...(mail.details || []).map(([k, v]) => `${k}: ${v}`),
    ...(mail.quotes || []).map((q) => `${q.label}\n${q.text}`),
    mail.button ? `${mail.button.label}: ${mail.button.url}` : '', mail.note || '',
  ].filter(Boolean).join('\n\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.resend_api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: s.mail_from, to: [to], subject: mail.subject, html, text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
    }),
  });
  if (!res.ok) {
    const raw = (await res.text()).slice(0, 300);
    console.error('[mail] resend', res.status, raw);
    let reason = '';
    try { reason = JSON.parse(raw).message || ''; } catch { /* not JSON */ }
    const hint = res.status === 401 || res.status === 403 ? 'בדקו את מפתח ה-API ואת כתובת השולח' : res.status === 422 ? 'בדקו את כתובת הנמען ואת כתובת השולח' : 'נסו שוב מאוחר יותר';
    throw new HttpError(502, 'MAIL_FAILED', `שליחת המייל נכשלה (${res.status}). ${hint}${reason ? `. פירוט: ${reason}` : ''}`);
  }
}

/** Public site address (for links in e-mails), e.g. https://smti.uk/zmanim/ */
export const siteUrl = (env, url) => `${url.origin}${(env.BASE_PATH || '').replace(/\/$/, '')}/`;

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
