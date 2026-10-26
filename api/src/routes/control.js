// Super-admin control panel and messages to the developers.
import { all, first, nowIso, run } from '../db.js';
import { forbidden, invalid, json, noContent, notFound, readJson } from '../http.js';
import { sendMail, siteUrl } from '../mail.js';
import { SETTINGS, getSettings, publicView, saveSettings } from '../settings.js';
import { fields, id } from '../validate.js';

// ------------------------------------------------------------------ control settings
export async function getControl({ env }) {
  return json(publicView(await getSettings(env)));
}

export async function patchControl({ env, request }) {
  const body = await readJson(request);
  const v = fields(body, { partial: true });
  for (const [key, def] of Object.entries(SETTINGS)) {
    if (def.type === 'bool') v.bool(key);
    else v.str(key, { max: def.max });
  }
  const d = v.done();
  // The masked key shown in the panel ("••••abcd") means "unchanged".
  if (typeof d.resend_api_key === 'string' && d.resend_api_key.includes('••••')) delete d.resend_api_key;
  if (d.mail_from && !/^[^<>]*<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(d.mail_from)) throw invalid({ mail_from: 'כתובת שולח לא תקינה. לדוגמה: זמני מניינים <noreply@example.com>' });
  for (const [k, lim] of [['zmanim_lat', 90], ['zmanim_lng', 180]]) {
    if (d[k] !== undefined && !(Math.abs(Number(d[k])) <= lim && d[k] !== '')) throw invalid({ [k]: 'מספר לא תקין' });
  }
  if (d.listen_phone && !/^[\d-]{7,15}$/.test(d.listen_phone)) throw invalid({ listen_phone: 'מספר טלפון לא תקין' });
  await saveSettings(env, d);
  return json(publicView(await getSettings(env)));
}

/** Sends a test e-mail to the super admin. */
export async function testMail({ env, actor, url }) {
  const me = await first(env, `SELECT email, name FROM users WHERE id = ?`, actor.id);
  if (!me.email) throw invalid({ email: 'למשתמש שלך אין מייל' });
  await sendMail(env, {
    to: me.email, subject: 'בדיקת מייל - זמני מניינים', title: `שלום ${me.name}`, site: siteUrl(env, url),
    paragraphs: ['זהו מייל בדיקה. אם הוא הגיע אליך, שליחת המיילים מוגדרת ועובדת.'],
    details: [['נשלח אל', me.email]],
  });
  return json({ sent_to: me.email });
}

// ------------------------------------------------------------------ messages to the developers
async function canWrite(env, actor) {
  const settings = await getSettings(env);
  if (!settings.feedback_enabled) return 'השירות לפניות סגור כרגע';
  if (!actor.can_message) return 'שליחת פניות חסומה עבורך';
  return null;
}

export async function myFeedback({ env, actor }) {
  const items = await all(env, `SELECT id, body, created_at, reply, replied_at FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 50`, actor.id);
  return json({ blocked: await canWrite(env, actor), items });
}

export async function sendFeedback({ env, actor, request }) {
  const blocked = await canWrite(env, actor);
  if (blocked) throw forbidden(blocked);
  const d = fields(await readJson(request)).str('body', { required: true, max: 2000 }).done();
  const recent = await first(env, `SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hour')`, actor.id);
  if (recent.n >= 10) throw forbidden('נשלחו יותר מדי פניות בשעה האחרונה');
  const res = await run(env, `INSERT INTO feedback (user_id, body) VALUES (?, ?)`, actor.id, d.body);
  return json(await first(env, `SELECT id, body, created_at FROM feedback WHERE id = ?`, res.meta.last_row_id), 201);
}

export async function listFeedback({ env }) {
  const rows = await all(
    env,
    `SELECT f.id, f.body, f.is_read, f.created_at, f.reply, f.replied_at, u.id AS user_id, u.name AS user_name, u.phone AS user_phone, u.email AS user_email, u.can_message
     FROM feedback f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 300`
  );
  return json(rows.map((r) => ({ ...r, is_read: r.is_read === 1, can_message: r.can_message === 1 })));
}

/** Mark read/unread, and/or answer. The answer shows in the user's messages page; send_email also mails it. */
export async function patchFeedback({ env, params, request, url }) {
  const fid = id(params.id);
  const f = await first(env, `SELECT f.*, u.email, u.name FROM feedback f JOIN users u ON u.id = f.user_id WHERE f.id = ?`, fid);
  if (!f) throw notFound();
  const d = fields(await readJson(request), { partial: true }).bool('is_read').str('reply', { max: 4000 }).bool('send_email').done();
  if (d.is_read !== undefined) await run(env, `UPDATE feedback SET is_read = ? WHERE id = ?`, d.is_read ? 1 : 0, fid);
  let emailed = false;
  if (d.reply !== undefined) {
    await run(env, `UPDATE feedback SET reply = ?, replied_at = ?, is_read = 1 WHERE id = ?`, d.reply || null, d.reply ? nowIso() : null, fid);
    if (d.reply && d.send_email) {
      if (!f.email) throw invalid({ send_email: 'למשתמש אין מייל' });
      await sendMail(env, {
        to: f.email, subject: 'תשובה לפנייה שלך - זמני מניינים', title: `שלום ${f.name}`, site: siteUrl(env, url),
        paragraphs: ['צוות הפיתוח השיב לפנייה ששלחת.'],
        quotes: [{ label: 'הפנייה שלך', text: f.body }, { label: 'התשובה', text: d.reply, accent: true }],
        note: 'אפשר לראות את כל הפניות והתשובות במערכת, בעמוד "פנייה לצוות".',
      });
      emailed = true;
    }
  }
  return json({ ...(await first(env, `SELECT id, is_read, reply, replied_at FROM feedback WHERE id = ?`, fid)), emailed });
}

export async function deleteFeedback({ env, params }) {
  const res = await run(env, `DELETE FROM feedback WHERE id = ?`, id(params.id));
  if (!res.meta.changes) throw notFound();
  return noContent();
}
