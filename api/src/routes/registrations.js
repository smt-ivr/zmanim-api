// Self-service synagogue registration: a public form, e-mail verification, then approval by the
// super admin (or an admin allowed to approve). Spam protection: a hidden honeypot field, a signed
// form token that must be a few seconds old, per-IP and per-e-mail limits, a blocklist, no links in
// the fields, and nothing reaches the approvers before the e-mail is verified.
import { checkLock, hashPassword, recordFailure } from '../auth.js';
import { all, first, nowIso, nowSec, run } from '../db.js';
import { HttpError, conflict, forbidden, invalid, json, notFound, readJson, tooMany } from '../http.js';
import { adminUrl, mailReady, sendMail, siteUrl } from '../mail.js';
import { getSettings, saveSettings } from '../settings.js';
import { clean, fields, id, normalizeEmail, normalizePhone } from '../validate.js';
import { welcomeMail } from './admin.js';
import { nameRow } from '../names.js';
import { linkEmailConversation } from './messages.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (t) => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

const VERIFY_TTL = 24 * 3600;
const MIN_FILL_SECONDS = 4; // faster than this is a bot
const MAX_PENDING = 100; // total open requests (protects the database from floods)
const LIMITS = { ip: { max: 3, window: 3600, lock: 3600 }, email: { max: 3, window: 86400, lock: 86400 } };
const LINKS = /https?:|www\.|<|>|\[url/i;

// ------------------------------------------------------------------ form token (signed timestamp)
async function secret(env) {
  const row = await first(env, `SELECT value FROM settings WHERE key = 'form_secret'`);
  if (row) return row.value;
  const value = randomHex(32);
  await run(env, `INSERT OR IGNORE INTO settings (key, value) VALUES ('form_secret', ?)`, value);
  return (await first(env, `SELECT value FROM settings WHERE key = 'form_secret'`)).value;
}
async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(await secret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text))).slice(0, 32);
}
async function formTokenAge(env, token) {
  const [ts, sig] = String(token || '').split('.');
  if (!/^\d+$/.test(ts) || sig !== (await sign(env, ts))) return null;
  return nowSec() - Number(ts);
}

async function isOpen(env) {
  const s = await getSettings(env);
  return s.registration_enabled && (await mailReady(env));
}

/** Blocklist lines: an e-mail, "@domain", a phone or an IP. */
function blocked(list, { email, phone, ip }) {
  const domain = email.split('@')[1];
  return list.split(/\r?\n/).map((l) => clean(l).toLowerCase()).filter(Boolean).some((l) =>
    l === email || (l.startsWith('@') && l.slice(1) === domain) || (normalizePhone(l) && normalizePhone(l) === phone) || l === ip);
}

// ------------------------------------------------------------------ public
/** GET /public/registrations/form: whether the form is open, and a fresh form token. */
export async function form({ env }) {
  if (!(await isOpen(env))) return json({ enabled: false });
  const ts = String(nowSec());
  return json({ enabled: true, form_token: `${ts}.${await sign(env, ts)}` });
}

/**
 * POST /public/registrations. Answers the same "check your e-mail" for spam that is silently dropped,
 * so bots learn nothing.
 */
export async function submit({ env, request, url }) {
  if (!(await isOpen(env))) throw forbidden('הרישום של בתי כנסת חדשים סגור כרגע');
  const body = await readJson(request);
  const d = fields(body)
    .str('synagogue_name', { required: true, max: 80 })
    .int('area_id', { nullable: true, default: null, min: 1 })
    .str('address', { max: 150 })
    .str('contact_name', { required: true, max: 80 })
    .email('email', { required: true })
    .phone('phone', { required: true, nullable: false })
    .str('message', { max: 500 })
    .str('form_token', { required: true, max: 100 })
    .done();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const accepted = json({ sent: true }, 202);

  // Bots: the hidden field is filled, the form came back too fast (or without our token), or links in the fields.
  const age = await formTokenAge(env, d.form_token);
  if (clean(body.website ?? '') || age === null || age < MIN_FILL_SECONDS || age > 2 * 3600) return accepted;
  if ([d.synagogue_name, d.address, d.contact_name, d.message].some((t) => LINKS.test(t || ''))) return accepted;

  const s = await getSettings(env);
  if (blocked(s.registration_blocklist, { email: d.email, phone: d.phone, ip })) return accepted;

  for (const [key, limit] of [[`reg:ip:${ip}`, LIMITS.ip], [`reg:email:${d.email}`, LIMITS.email]]) {
    try { await checkLock(env, key); } catch { throw tooMany('נשלחו יותר מדי בקשות. נסו שוב מאוחר יותר', limit.lock); }
    await recordFailure(env, key, limit);
  }
  if (d.area_id && !(await first(env, `SELECT id FROM areas WHERE id = ?`, d.area_id))) throw invalid({ area_id: 'האזור לא קיים' });
  const open = await first(env, `SELECT * FROM registrations WHERE email = ? AND status IN ('unverified', 'pending') ORDER BY id DESC LIMIT 1`, d.email);
  if (open?.status === 'pending') throw conflict('כבר יש בקשה ממתינה מהמייל הזה. נעדכן אותך במייל כשהיא תטופל');
  const { n } = await first(env, `SELECT COUNT(*) AS n FROM registrations WHERE status IN ('unverified', 'pending')`);
  if (!open && n >= MAX_PENDING) throw new HttpError(503, 'BUSY', 'יש כרגע יותר מדי בקשות פתוחות. נסו שוב מחר');

  const token = randomHex(24);
  const values = [d.synagogue_name, d.area_id, d.address || '', d.contact_name, d.email, d.phone, d.message || '', ip, await sha256(token), nowSec() + VERIFY_TTL];
  if (open) {
    await run(env, `UPDATE registrations SET synagogue_name = ?, area_id = ?, address = ?, contact_name = ?, email = ?, phone = ?, message = ?, ip = ?, token_hash = ?, token_expires = ? WHERE id = ?`, ...values, open.id);
  } else {
    await run(env, `INSERT INTO registrations (synagogue_name, area_id, address, contact_name, email, phone, message, ip, token_hash, token_expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values);
  }
  await verificationMail(env, url, d, token);
  return accepted;
}

async function verificationMail(env, url, r, token) {
  const s = await getSettings(env);
  await sendMail(env, {
    to: r.email,
    subject: `אימות המייל - ${s.system_name}`,
    title: `שלום ${r.contact_name}`,
    site: siteUrl(env, url),
    paragraphs: [`קיבלנו בקשה להוסיף את ${r.synagogue_name} ל${s.system_name}.`, 'כדי שהבקשה תעבור לאישור, אמתו את כתובת המייל בלחיצה על הכפתור.'],
    button: { label: 'אימות המייל', url: adminUrl(env, url, `/verify?t=${token}`), hint: 'הכפתור תקף ל-24 שעות.' },
    note: 'אחרי האימות הבקשה תועבר לאישור, ונעדכן אותך במייל כשתאושר. אם לא ביקשת, אפשר להתעלם מהמייל.',
  });
}

/** POST /public/registrations/verify { token } */
export async function verify({ env, request, url }) {
  const d = fields(await readJson(request)).str('token', { required: true, max: 100 }).done();
  const r = await first(env, `SELECT * FROM registrations WHERE token_hash = ?`, await sha256(d.token));
  if (!r) throw new HttpError(400, 'LINK_EXPIRED', 'הקישור אינו תקף');
  if (r.status !== 'unverified') return json({ synagogue_name: r.synagogue_name, status: r.status }); // clicked twice
  if (r.token_expires < nowSec()) throw new HttpError(400, 'LINK_EXPIRED', 'תוקף הקישור פג. שלחו את הבקשה שוב');
  await run(env, `UPDATE registrations SET status = 'pending', verified_at = ?, token_hash = NULL WHERE id = ?`, nowIso(), r.id);
  await notifyApprovers(env, url, r).catch((e) => console.error('[registrations] notify', e));
  return json({ synagogue_name: r.synagogue_name, status: 'pending' });
}

/** E-mails everyone who may approve: the super admin and admins with the permission. */
async function notifyApprovers(env, url, r) {
  const s = await getSettings(env);
  if (!s.registration_notify || !(await mailReady(env))) return;
  const admins = await all(env, `SELECT * FROM users WHERE role = 'admin' AND is_active = 1`);
  const area = r.area_id ? await first(env, `SELECT name FROM areas WHERE id = ?`, r.area_id) : null;
  for (const a of admins) {
    const perms = a.is_super ? ['registrations'] : JSON.parse(a.admin_perms || '[]');
    if (!perms.includes('registrations') || !a.email) continue;
    await sendMail(env, {
      to: a.email,
      subject: `בקשה חדשה לפתיחת בית כנסת - ${r.synagogue_name}`,
      title: 'בקשה חדשה ממתינה לאישור',
      site: siteUrl(env, url),
      paragraphs: ['המייל של המבקש אומת. אפשר לאשר או לדחות במערכת.'],
      details: [['בית הכנסת', r.synagogue_name], ['אזור', area?.name || 'לא נבחר'], ['כתובת', r.address || '—'], ['איש קשר', r.contact_name], ['מייל', r.email], ['טלפון', r.phone]],
      quotes: r.message ? [{ label: 'הודעה מהמבקש', text: r.message }] : [],
      button: { label: 'לבקשות הממתינות', url: adminUrl(env, url, '/admin/registrations') },
    });
  }
}

// ------------------------------------------------------------------ approvers
const LIST_SQL = `SELECT r.*, a.name AS area_name, u.name AS decided_by_name, u.id AS dec_id, u.role AS dec_role, u.is_super AS dec_super, s.name AS synagogue_current_name,
  (SELECT id FROM users WHERE email = r.email) AS existing_user_id
  FROM registrations r LEFT JOIN areas a ON a.id = r.area_id LEFT JOIN users u ON u.id = r.decided_by
  LEFT JOIN synagogues s ON s.id = r.synagogue_id`;
const serialize = (viewer, { token_hash, token_expires, ...r }) => ({ ...nameRow(viewer, r, 'dec', 'decided_by_name'), existing_user: Boolean(r.existing_user_id) });

/** GET /admin/registrations: every request, including those still waiting for e-mail verification. */
export async function list({ env, actor }) {
  const rows = await all(env, `${LIST_SQL} ORDER BY r.status = 'pending' DESC, r.status = 'unverified' DESC, r.id DESC LIMIT 500`);
  const s = await getSettings(env);
  return json({
    items: rows.map((r) => ({ ...serialize(actor, r), expired: r.status === 'unverified' && r.token_expires < nowSec(), blocked: blocked(s.registration_blocklist, { email: r.email, phone: r.phone, ip: r.ip }) })),
    unverified: rows.filter((r) => r.status === 'unverified').length,
  });
}

async function unverified(env, rid) {
  const r = await first(env, `SELECT * FROM registrations WHERE id = ?`, rid);
  if (!r) throw notFound('הבקשה לא נמצאה');
  if (r.status !== 'unverified') throw conflict('המייל של הבקשה כבר אומת');
  return r;
}

/** POST /admin/registrations/:id/resend: a fresh verification link (24 hours). */
export async function resend({ env, params, url }) {
  const r = await unverified(env, id(params.id));
  const token = randomHex(24);
  await run(env, `UPDATE registrations SET token_hash = ?, token_expires = ? WHERE id = ?`, await sha256(token), nowSec() + VERIFY_TTL, r.id);
  await verificationMail(env, url, r, token);
  return json({ sent_to: r.email });
}

/** POST /admin/registrations/:id/verify: the approver vouches for the e-mail; the request waits for approval. */
export async function verifyByHand({ env, params }) {
  const r = await unverified(env, id(params.id));
  await run(env, `UPDATE registrations SET status = 'pending', verified_at = ?, token_hash = NULL WHERE id = ?`, nowIso(), r.id);
  return json({ status: 'pending' });
}

/**
 * POST /admin/registrations/:id/block { what: ['email','phone','ip','domain'] }: adds the request's details
 * to the blocklist and rejects it (open requests) without e-mailing.
 */
export async function block({ env, actor, params, request }) {
  const r = await first(env, `SELECT * FROM registrations WHERE id = ?`, id(params.id));
  if (!r) throw notFound('הבקשה לא נמצאה');
  const d = fields(await readJson(request)).subset('what', ['email', 'domain', 'phone', 'ip'], { default: ['email'] }).done();
  const entries = d.what.map((w) => ({ email: r.email, domain: `@${r.email.split('@')[1]}`, phone: r.phone, ip: r.ip }[w])).filter(Boolean);
  await addToBlocklist(env, entries);
  if (r.status === 'unverified' || r.status === 'pending') {
    await run(env, `UPDATE registrations SET status = 'rejected', decided_at = ?, decided_by = ?, reason = COALESCE(reason, 'ספאם'), token_hash = NULL WHERE id = ?`, nowIso(), actor.id, r.id);
  }
  return json({ blocked: entries });
}

/** Adds lines to the registration blocklist (no duplicates). */
export async function addToBlocklist(env, entries) {
  const s = await getSettings(env);
  const lines = s.registration_blocklist.split(/\r?\n/).map((l) => clean(l)).filter(Boolean);
  const have = new Set(lines.map((l) => l.toLowerCase()));
  const add = entries.map((e) => clean(e)).filter((e) => e && !have.has(e.toLowerCase()));
  if (add.length) await saveSettings(env, { registration_blocklist: [...lines, ...add].join('\n') });
}

async function pending(env, rid) {
  const r = await first(env, `SELECT * FROM registrations WHERE id = ?`, rid);
  if (!r) throw notFound('הבקשה לא נמצאה');
  if (r.status !== 'pending') throw conflict('הבקשה כבר טופלה');
  return r;
}

/**
 * POST /admin/registrations/:id/approve { synagogue_name?, area_id, address? }: creates the synagogue,
 * the manager (or links an existing user with that e-mail) and sends the login details.
 */
export async function approve(ctx) {
  const { env, actor, params, request } = ctx;
  const r = await pending(env, id(params.id));
  const d = fields(await readJson(request))
    .str('synagogue_name', { max: 80 })
    .int('area_id', { nullable: true, min: 1 })
    .str('address', { max: 150 })
    .done();
  const name = d.synagogue_name || r.synagogue_name;
  const areaId = d.area_id ?? r.area_id;
  if (!areaId) throw invalid({ area_id: 'יש לבחור אזור לבית הכנסת' });
  if (!(await first(env, `SELECT id FROM areas WHERE id = ?`, areaId))) throw invalid({ area_id: 'האזור לא קיים' });

  let user = await first(env, `SELECT * FROM users WHERE email = ?`, r.email);
  if (!user) {
    const phoneOwner = await first(env, `SELECT name FROM users WHERE phone = ?`, r.phone);
    if (phoneOwner) throw conflict(`הטלפון ${r.phone} כבר רשום אצל ${phoneOwner.name}. אפשר לשנות אותו או לפתוח ידנית`);
  }
  const syn = await run(env, `INSERT INTO synagogues (name, area_id, address, max_minyanim, max_locations) VALUES (?, ?, ?, 0, 0)`, name, areaId, d.address ?? r.address);
  const sid = syn.meta.last_row_id;
  let created = false;
  if (!user) {
    const res = await run(env,
      `INSERT INTO users (name, email, phone, role, password_hash, must_change_password) VALUES (?, ?, ?, 'manager', ?, 1)`,
      r.contact_name, r.email, r.phone, await hashPassword(randomHex(16)));
    user = await first(env, `SELECT * FROM users WHERE id = ?`, res.meta.last_row_id);
    created = true;
    await linkEmailConversation(env, user); // what they wrote by e-mail before joins their chat
  }
  if (user.role === 'manager') await run(env, `INSERT OR IGNORE INTO synagogue_managers (synagogue_id, user_id) VALUES (?, ?)`, sid, user.id);
  await run(env, `UPDATE registrations SET status = 'approved', decided_at = ?, decided_by = ?, synagogue_id = ?, user_id = ? WHERE id = ?`, nowIso(), actor.id, sid, user.id, r.id);

  let mail = null;
  try { await welcomeMail(ctx, user.id); mail = 'sent'; } catch (e) { mail = e.message; }
  return json({ synagogue_id: sid, user_id: user.id, user_created: created, mail });
}

/** POST /admin/registrations/:id/reject { reason?, notify?, block? } */
export async function reject({ env, actor, params, request, url }) {
  const r = await pending(env, id(params.id));
  const d = fields(await readJson(request)).str('reason', { max: 500 }).bool('notify', { default: true }).bool('block', { default: false }).done();
  await run(env, `UPDATE registrations SET status = 'rejected', decided_at = ?, decided_by = ?, reason = ? WHERE id = ?`, nowIso(), actor.id, d.reason || null, r.id);
  if (d.block) await addToBlocklist(env, [r.email]);
  let mail = null;
  if (d.notify && !d.block) {
    const s = await getSettings(env);
    try {
      await sendMail(env, {
        to: r.email, subject: `הבקשה לפתיחת ${r.synagogue_name} - ${s.system_name}`, title: `שלום ${r.contact_name}`, site: siteUrl(env, url),
        paragraphs: [`הבקשה להוסיף את ${r.synagogue_name} לא אושרה.`],
        quotes: d.reason ? [{ label: 'הסיבה', text: d.reason }] : [],
        note: 'לשאלות אפשר להשיב למייל הזה.',
      });
      mail = 'sent';
    } catch (e) { mail = e.message; }
  }
  return json({ status: 'rejected', mail });
}

/** DELETE /admin/registrations/:id */
export async function remove({ env, params }) {
  const res = await run(env, `DELETE FROM registrations WHERE id = ?`, id(params.id));
  if (!res.meta.changes) throw notFound('הבקשה לא נמצאה');
  return new Response(null, { status: 204 });
}
