// Messages between users and the staff, as a chat: one conversation per user (or per outside e-mail
// address). The staff (super admin) is e-mailed about a new message when not signed in; answers can
// go out by e-mail, and e-mail replies (and new e-mails to the inbound address) land back in the chat.
import { checkLock, recordFailure } from '../auth.js';
import { all, first, nowIso, nowSec, run } from '../db.js';
import { forbidden, invalid, json, noContent, notFound, readJson } from '../http.js';
import { adminUrl, mailReady, sendMail, siteUrl } from '../mail.js';
import { getSettings } from '../settings.js';
import { clean, fields, id, normalizeEmail } from '../validate.js';
import PostalMime from '../vendor/postal-mime/postal-mime.js';

const ONLINE = 15 * 60; // signed in and active within this time = online (no e-mail needed)
const NOTIFY_EVERY = 20 * 60; // at most one "new message" e-mail per conversation in this time
const MAX_BODY = 4000;

const conversationOfUser = (env, userId) => first(env, `SELECT * FROM conversations WHERE user_id = ?`, userId);

async function ensureConversation(env, user) {
  const existing = await conversationOfUser(env, user.id);
  if (existing) return existing;
  const res = await run(env, `INSERT INTO conversations (user_id, email, name) VALUES (?, ?, ?)`, user.id, user.email, user.name);
  return first(env, `SELECT * FROM conversations WHERE id = ?`, res.meta.last_row_id);
}

/** Adds a message and updates the conversation's counters. */
async function addMessage(env, conv, { sender, body, via = 'web', staffUserId = null, emailed = false }) {
  const res = await run(env, `INSERT INTO messages (conversation_id, sender, staff_user_id, body, via, emailed) VALUES (?, ?, ?, ?, ?, ?)`,
    conv.id, sender, staffUserId, body.slice(0, MAX_BODY), via, emailed ? 1 : 0);
  await run(env,
    sender === 'user'
      ? `UPDATE conversations SET last_message_at = ?, staff_unread = staff_unread + 1, status = 'open' WHERE id = ?`
      : `UPDATE conversations SET last_message_at = ?, user_unread = user_unread + 1, status = 'open' WHERE id = ?`,
    nowIso(), conv.id);
  return first(env, `SELECT * FROM messages WHERE id = ?`, res.meta.last_row_id);
}

/** Staff members who handle messages (the super admin). */
const staff = (env) => all(env, `SELECT * FROM users WHERE is_super = 1 AND is_active = 1`);

/** E-mails the staff about a new message, unless they are signed in right now (or were told a moment ago). */
async function notifyStaff(env, url, conv, body) {
  if (!(await mailReady(env)) || conv.notified_at > nowSec() - NOTIFY_EVERY) return;
  const s = await getSettings(env);
  for (const u of await staff(env)) {
    const online = await first(env, `SELECT 1 AS ok FROM sessions WHERE user_id = ? AND last_seen_at > ?`, u.id, nowSec() - ONLINE);
    if (online || !u.email) continue;
    await sendMail(env, {
      to: u.email,
      subject: `הודעה חדשה מ${conv.name || conv.email} [#${conv.id}]`,
      title: `הודעה חדשה מ${conv.name || conv.email}`,
      site: siteUrl(env, url),
      quotes: [{ label: conv.user_id ? 'ההודעה' : `ההודעה (במייל מ-${conv.email})`, text: body }],
      button: { label: 'לשיחה במערכת', url: adminUrl(env, url, `/admin/inbox?c=${conv.id}`) },
      note: s.inbound_email ? 'אפשר גם להשיב ישירות למייל הזה, והתשובה תישלח לפונה ותופיע בשיחה.' : '',
      replyTo: s.inbound_email || undefined,
    }).catch((e) => console.error('[messages] notify', e));
  }
  await run(env, `UPDATE conversations SET notified_at = ? WHERE id = ?`, nowSec(), conv.id);
}

/** E-mails a staff answer to the person; replies come back to the inbound address with [#id]. */
async function emailAnswer(env, url, conv, body) {
  const s = await getSettings(env);
  await sendMail(env, {
    to: conv.email,
    subject: `${conv.subject ? `Re: ${conv.subject}` : `הודעה מ${s.system_name}`} [#${conv.id}]`,
    title: `שלום ${conv.name || ''}`.trim(),
    site: siteUrl(env, url),
    paragraphs: body.split(/\n{2,}/),
    button: conv.user_id ? { label: 'לכל השיחה במערכת', url: adminUrl(env, url, '/feedback') } : undefined,
    note: s.inbound_email ? 'אפשר להשיב ישירות למייל הזה.' : '',
    replyTo: s.inbound_email || undefined,
  });
}

// ------------------------------------------------------------------ the user's side
async function blockedReason(env, actor) {
  const s = await getSettings(env);
  if (!s.feedback_enabled) return 'שליחת הודעות סגורה כרגע';
  if (!actor.can_message) return 'שליחת הודעות חסומה עבורך';
  return null;
}

/** GET /me/messages: the user's chat (marks the answers as read). */
export async function myMessages({ env, actor }) {
  const conv = await conversationOfUser(env, actor.id);
  const messages = conv ? await all(env, `SELECT id, sender, body, created_at FROM messages WHERE conversation_id = ? ORDER BY id`, conv.id) : [];
  if (conv?.user_unread) await run(env, `UPDATE conversations SET user_unread = 0 WHERE id = ?`, conv.id);
  return json({ blocked: await blockedReason(env, actor), messages });
}

/** POST /me/messages { body } */
export async function sendMyMessage({ env, actor, request, url }) {
  const blocked = await blockedReason(env, actor);
  if (blocked) throw forbidden(blocked);
  const d = fields(await readJson(request)).str('body', { required: true, max: MAX_BODY }).done();
  const conv = await ensureConversation(env, await first(env, `SELECT * FROM users WHERE id = ?`, actor.id));
  const { n } = await first(env, `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender = 'user' AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hour')`, conv.id);
  if (n >= 30) throw forbidden('נשלחו יותר מדי הודעות בשעה האחרונה');
  const msg = await addMessage(env, conv, { sender: 'user', body: d.body });
  await notifyStaff(env, url, conv, d.body);
  return json({ id: msg.id, sender: 'user', body: msg.body, created_at: msg.created_at }, 201);
}

// ------------------------------------------------------------------ the staff's side
/** GET /admin/conversations */
export async function listConversations({ env }) {
  const rows = await all(env, `
    SELECT c.*, u.phone AS user_phone, u.can_message, u.role AS user_role,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT sender FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender
    FROM conversations c LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.last_message_at DESC LIMIT 500`);
  return json(rows.map(({ notified_at, ...r }) => ({ ...r, can_message: r.user_id ? r.can_message === 1 : null, last_body: (r.last_body || '').slice(0, 140) })));
}

async function loadConversation(env, rawId) {
  const c = await first(env, `SELECT c.*, u.phone AS user_phone, u.can_message FROM conversations c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`, id(rawId));
  if (!c) throw notFound('השיחה לא נמצאה');
  return c;
}

/** GET /admin/conversations/:id (marks it read) */
export async function getConversation({ env, params }) {
  const c = await loadConversation(env, params.id);
  const messages = await all(env, `SELECT m.id, m.sender, m.body, m.via, m.emailed, m.created_at, u.name AS staff_name
    FROM messages m LEFT JOIN users u ON u.id = m.staff_user_id WHERE m.conversation_id = ? ORDER BY m.id`, c.id);
  if (c.staff_unread) await run(env, `UPDATE conversations SET staff_unread = 0 WHERE id = ?`, c.id);
  const { notified_at, ...conversation } = c;
  return json({ conversation: { ...conversation, staff_unread: 0, can_message: c.user_id ? c.can_message === 1 : null }, messages });
}

/** POST /admin/conversations/:id/messages { body, send_email } (an outside sender is always answered by e-mail) */
export async function answer({ env, actor, params, request, url }) {
  const c = await loadConversation(env, params.id);
  const d = fields(await readJson(request)).str('body', { required: true, max: MAX_BODY }).bool('send_email', { default: false }).done();
  const byMail = d.send_email || !c.user_id;
  if (byMail && !c.email) throw invalid({ send_email: 'אין כתובת מייל לשיחה הזו' });
  if (byMail) await emailAnswer(env, url, c, d.body);
  const msg = await addMessage(env, c, { sender: 'staff', body: d.body, staffUserId: actor.id, emailed: byMail });
  if (!c.user_id) await run(env, `UPDATE conversations SET user_unread = 0 WHERE id = ?`, c.id); // nobody reads it on the site
  return json({ ...msg, staff_name: actor.name, emailed: msg.emailed === 1 }, 201);
}

/** POST /admin/conversations { user_id } or { email, name }: start (or open) a conversation. */
export async function startConversation({ env, request }) {
  const d = fields(await readJson(request)).int('user_id', { nullable: true, min: 1 }).email('email', { nullable: true }).str('name', { max: 80 }).done();
  if (d.user_id) {
    const u = await first(env, `SELECT * FROM users WHERE id = ?`, d.user_id);
    if (!u) throw notFound('המשתמש לא נמצא');
    return json(await ensureConversation(env, u));
  }
  if (!d.email) throw invalid({ email: 'יש לבחור משתמש או מייל' });
  const existing = await first(env, `SELECT * FROM conversations WHERE user_id IS NULL AND email = ?`, d.email);
  if (existing) return json(existing);
  const res = await run(env, `INSERT INTO conversations (email, name) VALUES (?, ?)`, d.email, d.name || '');
  return json(await first(env, `SELECT * FROM conversations WHERE id = ?`, res.meta.last_row_id), 201);
}

/** PATCH /admin/conversations/:id { status } */
export async function patchConversation({ env, params, request }) {
  const c = await loadConversation(env, params.id);
  const d = fields(await readJson(request), { partial: true }).oneOf('status', ['open', 'closed']).done();
  if (d.status) await run(env, `UPDATE conversations SET status = ? WHERE id = ?`, d.status, c.id);
  return noContent();
}

export async function deleteConversation({ env, params }) {
  const c = await loadConversation(env, params.id);
  await run(env, `DELETE FROM conversations WHERE id = ?`, c.id);
  return noContent();
}

// ------------------------------------------------------------------ incoming e-mail
/** Drops what the person quoted from earlier mails ("On ... wrote:", "> ..."). */
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^\s*(On .+wrote:|ב.+כתב\(ה\):|ב.+נכתב:|-----\s*Original Message|From: .+@|מאת: )/i.test(l) || /^>/.test(l));
  return (cut === -1 ? lines : lines.slice(0, cut)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Cloudflare Email Routing hands mail for the inbound address to this Worker. A mail from the person
 * goes into their conversation; a reply from the staff to a "[#id]" mail is sent on to the person.
 */
export async function handleEmail(message, env) {
  const log = (status, detail, subject = '') => run(env, `INSERT INTO email_log (sender, recipient, subject, status, detail) VALUES (?, ?, ?, ?, ?)`,
    String(message.from || '').slice(0, 200), String(message.to || '').slice(0, 200), String(subject).slice(0, 200), status, String(detail).slice(0, 300))
    .catch((e) => console.error('[email] log', e));
  try {
    const result = await receive(message, env);
    await log(result.status, result.detail, result.subject);
  } catch (err) {
    console.error('[email]', err?.stack || err);
    await log('error', err?.message || String(err));
  }
}

/** GET /admin/email-log: the last e-mails that reached the inbound address. */
export const emailLog = async ({ env }) => json(await all(env, `SELECT * FROM email_log ORDER BY id DESC LIMIT 100`));

async function receive(message, env) {
  const s = await getSettings(env);
  const auto = (message.headers.get('auto-submitted') || 'no').toLowerCase() !== 'no' || /bulk|junk|auto_reply|list/i.test(message.headers.get('precedence') || '');
  if (auto) return { status: 'ignored', detail: 'מענה אוטומטי' };
  if (message.rawSize > 2_000_000) return { status: 'ignored', detail: 'גדול מדי' };
  const parsed = await PostalMime.parse(message.raw);
  const subjectRaw = parsed.subject || '';
  const ignored = (detail) => ({ status: 'ignored', detail, subject: subjectRaw });
  const from = normalizeEmail(parsed.from?.address || message.from);
  if (!from || /^(mailer-daemon|postmaster|no-?reply)@/i.test(from) || from === normalizeEmail(s.inbound_email)) return ignored('שולח מערכת');

  // the same blocklist as registrations, and a flood limit per sender
  const blocked = s.registration_blocklist.split(/\r?\n/).map((l) => clean(l).toLowerCase()).filter(Boolean)
    .some((l) => l === from || (l.startsWith('@') && from.endsWith(l)));
  if (blocked) return ignored('שולח חסום');
  const key = `inmail:${from}`;
  try { await checkLock(env, key); } catch { return ignored('יותר מדי מיילים מהשולח בשעה האחרונה'); }
  await recordFailure(env, key, { max: 20, window: 3600, lock: 3600 });

  const files = (parsed.attachments || []).map((a) => a.filename).filter(Boolean);
  const body = [stripQuoted(parsed.text || ''), files.length ? `[צורפו קבצים שלא נשמרו: ${files.join(', ')}]` : ''].filter(Boolean).join('\n\n').slice(0, MAX_BODY);
  if (!body) return ignored('מייל ריק');
  const subject = clean(parsed.subject || '').replace(/\s*\[#\d+\]\s*/, ' ').replace(/^(re|fw|fwd|השב|העבר):\s*/i, '').trim().slice(0, 150);
  const tagged = /\[#(\d+)\]/.exec(parsed.subject || '');
  const url = new URL(`https://${(s.inbound_email.split('@')[1] || 'localhost')}${(env.BASE_PATH || '').replace(/\/$/, '')}/`);

  const sender = await first(env, `SELECT * FROM users WHERE email = ? AND is_active = 1`, from);
  // The staff answering from their mailbox: goes into the tagged conversation and on to the person.
  if (sender?.is_super && tagged) {
    const conv = await first(env, `SELECT * FROM conversations WHERE id = ?`, Number(tagged[1]));
    if (!conv || conv.user_id === sender.id) return ignored('שיחה לא נמצאה');
    if (conv.email) await emailAnswer(env, url, conv, body).catch((e) => console.error('[messages] relay', e));
    await addMessage(env, conv, { sender: 'staff', body, via: 'email', staffUserId: sender.id, emailed: Boolean(conv.email) });
    return { status: 'accepted', detail: `תשובה שלך נשלחה לשיחה #${conv.id}`, subject: subjectRaw };
  }

  let conv = tagged ? await first(env, `SELECT * FROM conversations WHERE id = ? AND email = ?`, Number(tagged[1]), from) : null;
  if (!conv && sender) conv = await ensureConversation(env, sender);
  if (!conv) conv = await first(env, `SELECT * FROM conversations WHERE user_id IS NULL AND email = ?`, from);
  if (!conv) {
    const res = await run(env, `INSERT INTO conversations (email, name, subject) VALUES (?, ?, ?)`, from, clean(parsed.from?.name || '').slice(0, 80), subject);
    conv = await first(env, `SELECT * FROM conversations WHERE id = ?`, res.meta.last_row_id);
  } else if (!conv.subject && subject) {
    await run(env, `UPDATE conversations SET subject = ? WHERE id = ?`, subject, conv.id);
  }
  await addMessage(env, conv, { sender: 'user', body, via: 'email' });
  await notifyStaff(env, url, conv, body);
  return { status: 'accepted', detail: `נוסף לשיחה #${conv.id}`, subject: subjectRaw };
}
