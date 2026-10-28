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
import { nameRow } from '../names.js';
import { checkFiles, filesOf, mailAttachments, removeConversationFiles, saveFiles } from '../files.js';

const ONLINE = 15 * 60; // signed in and active within this time = online (no e-mail needed)
const NOTIFY_EVERY = 20 * 60; // at most one "new message" e-mail per conversation in this time
const MAX_BODY = 4000;
const MAX_FILES_IN_MAIL = 5;

const conversationOfUser = (env, userId) => first(env, `SELECT * FROM conversations WHERE user_id = ?`, userId);

/**
 * Someone who wrote by e-mail and later got an account (or this e-mail): their e-mail conversation
 * becomes the user's, merged into the user's own conversation when there is one.
 */
export async function linkEmailConversation(env, user) {
  if (!user?.id || !user.email) return;
  const outside = await first(env, `SELECT * FROM conversations WHERE user_id IS NULL AND email = ?`, user.email);
  if (!outside) return;
  const own = await conversationOfUser(env, user.id);
  if (!own) {
    await run(env, `UPDATE conversations SET user_id = ?, name = ? WHERE id = ?`, user.id, user.name, outside.id);
    return;
  }
  await run(env, `UPDATE messages SET conversation_id = ? WHERE conversation_id = ?`, own.id, outside.id);
  await run(env, `UPDATE message_files SET conversation_id = ? WHERE conversation_id = ?`, own.id, outside.id);
  await run(env, `UPDATE conversations SET staff_unread = staff_unread + ?, last_message_at = MAX(last_message_at, ?), status = 'open',
    subject = CASE WHEN ? > last_message_at THEN ? ELSE subject END WHERE id = ?`,
    outside.staff_unread, outside.last_message_at, outside.last_message_at, outside.subject, own.id);
  await saveRefs(env, own.id, [...refsOf(own), ...refsOf(outside)]);
  await run(env, `DELETE FROM conversations WHERE id = ?`, outside.id);
}

async function ensureConversation(env, user) {
  await linkEmailConversation(env, user);
  const existing = await conversationOfUser(env, user.id);
  if (existing) return existing;
  const res = await run(env, `INSERT INTO conversations (user_id, email, name) VALUES (?, ?, ?)`, user.id, user.email, user.name);
  return first(env, `SELECT * FROM conversations WHERE id = ?`, res.meta.last_row_id);
}

/** Adds a message and updates the conversation's counters. */
async function addMessage(env, conv, { sender, body, via = 'web', staffUserId = null, emailed = false, emailToken = null, files = [] }) {
  const res = await run(env, `INSERT INTO messages (conversation_id, sender, staff_user_id, body, via, emailed, email_token) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    conv.id, sender, staffUserId, body.slice(0, MAX_BODY), via, emailed ? 1 : 0, emailToken);
  if (files.length) await saveFiles(env, conv.id, res.meta.last_row_id, files);
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
async function notifyStaff(env, url, conv, body, files = []) {
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
      quotes: [{ label: conv.user_id ? 'ההודעה' : `ההודעה (במייל מ-${conv.email})`, text: [body, files.length ? `📎 ${files.map((f) => f.name).join(', ')}` : ''].filter(Boolean).join('\n\n') }],
      button: { label: 'לשיחה במערכת', url: adminUrl(env, url, `/admin/inbox?c=${conv.id}`) },
      note: s.inbound_email ? 'אפשר גם להשיב ישירות למייל הזה, והתשובה תישלח לפונה ותופיע בשיחה.' : '',
      replyTo: s.inbound_email || undefined,
    }).catch((e) => console.error('[messages] notify', e));
  }
  await run(env, `UPDATE conversations SET notified_at = ? WHERE id = ?`, nowSec(), conv.id);
}

/** E-mails a staff answer to the person; replies come back to the inbound address with [#id]. */
// ------------------------------------------------------------------ e-mail threads
// A conversation remembers the Message-IDs of its e-mail thread. An answer from the chat is sent as a
// reply in that thread (same subject, In-Reply-To / References), so the person sees one e-mail
// conversation, as if talking by e-mail; their reply is matched back by those IDs.
const ids = (text) => String(text || '').match(/<[^<>\s]+>/g) || [];
const refsOf = (conv) => ids(conv.email_refs);
const saveRefs = (env, convId, refs) => run(env, `UPDATE conversations SET email_refs = ? WHERE id = ?`, [...new Set(refs)].slice(-20).join(' '), convId);

/** The conversation an incoming e-mail answers (by In-Reply-To / References), if any. */
async function conversationByThread(env, parsed) {
  for (const mid of [...ids(parsed.inReplyTo), ...ids(parsed.references).reverse()]) {
    const c = await first(env, `SELECT * FROM conversations WHERE instr(email_refs, ?) > 0`, mid);
    if (c) return c;
  }
  return null;
}

/** E-mails a staff answer to the person as the next mail in their thread. Returns the open-tracking token. */
async function emailAnswer(env, url, conv, body, attachments = []) {
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const s = await getSettings(env);
  const fresh = await first(env, `SELECT * FROM conversations WHERE id = ?`, conv.id);
  const refs = refsOf(fresh);
  const subject = fresh.subject || `הודעה מ${s.system_name}`;
  if (!fresh.subject) await run(env, `UPDATE conversations SET subject = ? WHERE id = ?`, subject, conv.id);
  const domain = (/@([^>\s]+)/.exec(s.mail_from) || [])[1] || 'localhost';
  const messageId = `<zm-${conv.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@${domain}>`;
  await sendMail(env, {
    to: fresh.email,
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    plain: true,
    paragraphs: body ? body.split(/\n{2,}/) : [],
    attachments,
    signature: { name: s.system_name, url: siteUrl(env, url) },
    pixel: `${siteUrl(env, url)}api/o/${token}`,
    replyTo: s.inbound_email || undefined,
    headers: { 'Message-ID': messageId, ...(refs.length ? { 'In-Reply-To': refs.at(-1), References: refs.join(' ') } : {}) },
  });
  await saveRefs(env, conv.id, [...refs, messageId]);
  return token;
}

const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
/** GET /o/:token — the e-mail was opened (its image loaded): first time and count. Always the same tiny image. */
export async function opened({ env, params }) {
  const token = String(params.token || '').replace(/\W/g, '').slice(0, 64);
  if (token) {
    await run(env, `UPDATE messages SET opened_at = COALESCE(opened_at, ?), open_count = open_count + 1 WHERE email_token = ?`, nowIso(), token)
      .catch((e) => console.error('[messages] open', e));
  }
  return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
}

/** A message as sent from the site: JSON { body, send_email }, or a form with the same fields and files. */
async function readMessage(request) {
  if (!(request.headers.get('Content-Type') || '').includes('multipart/form-data')) {
    const d = fields(await readJson(request)).str('body', { required: true, max: MAX_BODY }).bool('send_email', { default: false }).done();
    return { ...d, files: [] };
  }
  let form;
  try { form = await request.formData(); } catch { throw invalid({ files: 'ההעלאה נכשלה, נסו שוב' }); }
  const files = form.getAll('files').filter((f) => f && typeof f !== 'string').map((f) => ({ name: f.name, type: f.type, size: f.size, data: f }));
  const d = fields({ body: String(form.get('body') || ''), send_email: form.get('send_email') === 'true' })
    .str('body', { required: !files.length, max: MAX_BODY }).bool('send_email', { default: false }).done();
  return { ...d, body: d.body || '', files };
}

const withFiles = async (env, convId, messages) => {
  const files = await filesOf(env, convId);
  return messages.map((m) => ({ ...m, files: files[m.id] || [] }));
};

// ------------------------------------------------------------------ the user's side
async function blockedReason(env, actor) {
  const s = await getSettings(env);
  if (!s.feedback_enabled) return 'שליחת הודעות סגורה כרגע';
  if (!actor.can_message) return 'שליחת הודעות חסומה עבורך';
  return null;
}

/** GET /me/messages: the user's chat (marks the answers as read). */
export async function myMessages({ env, actor }) {
  await linkEmailConversation(env, await first(env, `SELECT * FROM users WHERE id = ?`, actor.id));
  const conv = await conversationOfUser(env, actor.id);
  const messages = conv ? await withFiles(env, conv.id, await all(env, `SELECT id, sender, body, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, id`, conv.id)) : [];
  if (conv?.user_unread) await run(env, `UPDATE conversations SET user_unread = 0 WHERE id = ?`, conv.id);
  return json({ blocked: await blockedReason(env, actor), messages });
}

/** POST /me/messages { body } (or a form with files) */
export async function sendMyMessage({ env, actor, request, url }) {
  const blocked = await blockedReason(env, actor);
  if (blocked) throw forbidden(blocked);
  const d = await readMessage(request);
  checkFiles(env, d.files);
  const conv = await ensureConversation(env, await first(env, `SELECT * FROM users WHERE id = ?`, actor.id));
  const { n } = await first(env, `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender = 'user' AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hour')`, conv.id);
  if (n >= 30) throw forbidden('נשלחו יותר מדי הודעות בשעה האחרונה');
  const msg = await addMessage(env, conv, { sender: 'user', body: d.body, files: d.files });
  await notifyStaff(env, url, conv, d.body, d.files);
  const [shown] = await withFiles(env, conv.id, [{ id: msg.id, sender: 'user', body: msg.body, created_at: msg.created_at }]);
  return json(shown, 201);
}

// ------------------------------------------------------------------ the staff's side
/** GET /admin/conversations */
export async function listConversations({ env }) {
  const rows = await all(env, `
    SELECT c.*, u.phone AS user_phone, u.can_message, u.role AS user_role,
      (SELECT CASE WHEN m.body = '' THEN '📎 ' || (SELECT f.name FROM message_files f WHERE f.message_id = m.id LIMIT 1) ELSE m.body END
         FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
      (SELECT sender FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender
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
export async function getConversation({ env, actor, params }) {
  const c = await loadConversation(env, params.id);
  const messages = await all(env, `SELECT m.id, m.sender, m.body, m.via, m.emailed, m.opened_at, m.open_count, m.created_at, u.name AS staff_name, u.id AS st_id, u.role AS st_role, u.is_super AS st_super
    FROM messages m LEFT JOIN users u ON u.id = m.staff_user_id WHERE m.conversation_id = ? ORDER BY m.created_at, m.id`, c.id);
  if (c.staff_unread) await run(env, `UPDATE conversations SET staff_unread = 0 WHERE id = ?`, c.id);
  const { notified_at, ...conversation } = c;
  return json({ conversation: { ...conversation, staff_unread: 0, can_message: c.user_id ? c.can_message === 1 : null }, messages: await withFiles(env, c.id, messages.map((m) => nameRow(actor, m, 'st', 'staff_name'))) });
}

/** POST /admin/conversations/:id/messages { body, send_email } or a form with files (an outside sender is always answered by e-mail) */
export async function answer({ env, actor, params, request, url }) {
  const c = await loadConversation(env, params.id);
  const d = await readMessage(request);
  checkFiles(env, d.files);
  const byMail = d.send_email || !c.user_id;
  if (byMail && !c.email) throw invalid({ send_email: 'אין כתובת מייל לשיחה הזו' });
  // saved first, so the e-mail can carry the very files that were stored
  const msg = await addMessage(env, c, { sender: 'staff', body: d.body, staffUserId: actor.id, files: d.files });
  if (byMail) {
    try {
      const emailToken = await emailAnswer(env, url, c, d.body, await mailAttachments(env, msg.id));
      await run(env, `UPDATE messages SET emailed = 1, email_token = ? WHERE id = ?`, emailToken, msg.id);
    } catch (err) {
      await removeMessage(env, msg.id); // not sent: as if never written, so it can be sent again
      throw err;
    }
  }
  if (!c.user_id) await run(env, `UPDATE conversations SET user_unread = 0 WHERE id = ?`, c.id); // nobody reads it on the site
  const [shown] = await withFiles(env, c.id, [await first(env, `SELECT id, sender, body, via, emailed, opened_at, open_count, created_at FROM messages WHERE id = ?`, msg.id)]);
  return json({ ...shown, staff_name: actor.name, emailed: shown.emailed === 1 }, 201);
}

async function removeMessage(env, messageId) {
  const keys = await all(env, `SELECT key FROM message_files WHERE message_id = ?`, messageId);
  if (keys.length) await env.FILES.delete(keys.map((k) => k.key)).catch((e) => console.error('[files] delete', e));
  await run(env, `DELETE FROM messages WHERE id = ?`, messageId);
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
  await removeConversationFiles(env, [c.id]);
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
  if (message.rawSize > 30_000_000) return { status: 'ignored', detail: 'גדול מדי' };
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

  // attachments (not pictures embedded in the mail body, like a signature logo)
  const attached = (parsed.attachments || []).filter((a) => a.filename && !(a.related || (a.disposition === 'inline' && a.contentId)));
  const files = [], skipped = [];
  for (const a of attached) {
    const size = a.content?.byteLength || 0;
    const f = { name: a.filename, type: a.mimeType, size, data: new Uint8Array(a.content) };
    try { checkFiles(env, [f]); files.push(f); } catch { skipped.push(a.filename); }
  }
  files.splice(MAX_FILES_IN_MAIL).forEach((f) => skipped.push(f.name));
  const body = [stripQuoted(parsed.text || ''), skipped.length ? `[צורפו קבצים שלא נשמרו: ${skipped.join(', ')}]` : ''].filter(Boolean).join('\n\n').slice(0, MAX_BODY);
  if (!body && !files.length) return ignored('מייל ריק');
  const subject = clean(parsed.subject || '').replace(/\s*\[#\d+\]\s*/, ' ').replace(/^(re|fw|fwd|השב|העבר):\s*/i, '').trim().slice(0, 150);
  const tagged = /\[#(\d+)\]/.exec(parsed.subject || '');
  const url = new URL(`https://${(s.inbound_email.split('@')[1] || 'localhost')}${(env.BASE_PATH || '').replace(/\/$/, '')}/`);

  const sender = await first(env, `SELECT * FROM users WHERE email = ? AND is_active = 1`, from);
  // The staff answering from their mailbox: goes into the tagged conversation and on to the person.
  if (sender?.is_super && tagged) {
    const conv = await first(env, `SELECT * FROM conversations WHERE id = ?`, Number(tagged[1]));
    if (!conv || conv.user_id === sender.id) return ignored('שיחה לא נמצאה');
    const msg = await addMessage(env, conv, { sender: 'staff', body, via: 'email', staffUserId: sender.id, files });
    const emailToken = conv.email ? await emailAnswer(env, url, conv, body, await mailAttachments(env, msg.id)).catch((e) => console.error('[messages] relay', e)) : null;
    if (emailToken) await run(env, `UPDATE messages SET emailed = 1, email_token = ? WHERE id = ?`, emailToken, msg.id);
    return { status: 'accepted', detail: `תשובה שלך נשלחה לשיחה #${conv.id}`, subject: subjectRaw };
  }

  let conv = tagged ? await first(env, `SELECT * FROM conversations WHERE id = ? AND email = ?`, Number(tagged[1]), from) : null;
  if (!conv) conv = await conversationByThread(env, parsed);
  if (conv && !conv.user_id && sender) { await linkEmailConversation(env, sender); conv = await conversationOfUser(env, sender.id); }
  if (!conv && sender) conv = await ensureConversation(env, sender);
  if (!conv) conv = await first(env, `SELECT * FROM conversations WHERE user_id IS NULL AND email = ?`, from);
  if (!conv) {
    const res = await run(env, `INSERT INTO conversations (email, name, subject) VALUES (?, ?, ?)`, from, clean(parsed.from?.name || '').slice(0, 80), subject);
    conv = await first(env, `SELECT * FROM conversations WHERE id = ?`, res.meta.last_row_id);
  } else if (subject && subject !== conv.subject) {
    await run(env, `UPDATE conversations SET subject = ? WHERE id = ?`, subject, conv.id); // answers continue the latest thread
  }
  // Their thread: a reply carries the whole chain in References; a new e-mail starts a new chain.
  const own = ids(parsed.messageId);
  const chain = [...ids(parsed.references), ...ids(parsed.inReplyTo), ...own];
  const continues = chain.some((m) => refsOf(conv).includes(m));
  await saveRefs(env, conv.id, continues ? [...refsOf(conv), ...chain] : chain);
  await addMessage(env, conv, { sender: 'user', body, via: 'email', files });
  await notifyStaff(env, url, conv, body, files);
  return { status: 'accepted', detail: `נוסף לשיחה #${conv.id}`, subject: subjectRaw };
}
