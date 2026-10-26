import { checkLock, createSession, findUserByLogin, hashPassword, login, logout, publicUser, recordFailure, revokeSessions, verifyPassword } from '../auth.js';
import { adminUrl, consumeEmailToken, createEmailToken, mailReady, sendMail, siteUrl } from '../mail.js';
import { all, first, nowIso, run } from '../db.js';
import { forbidden, invalid, json, noContent, readJson, tooMany, unauthorized } from '../http.js';
import { getSettings } from '../settings.js';
import { fields, normalizeEmail } from '../validate.js';

export async function postLogin({ env, request }) {
  // "login" = e-mail or phone ("email" accepted too, for older clients)
  const body = await readJson(request);
  const d = fields({ login: body.login ?? body.email, password: body.password })
    .str('login', { required: true, max: 200 }).str('password', { required: true, max: 200 }).done();
  return json(await login(env, request, d.login, d.password));
}

export async function postLogout({ env, actor }) {
  await logout(env, actor);
  return noContent();
}

/** Who am I + which synagogues I manage. The admin UI boots from this single call. */
export async function getMe({ env, actor }) {
  const synagogues =
    actor.role === 'admin'
      ? await all(env, `SELECT s.id, s.name, a.name AS area_name FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id ORDER BY s.name`)
      : await all(
          env,
          `SELECT s.id, s.name, a.name AS area_name FROM synagogue_managers sm
           JOIN synagogues s ON s.id = sm.synagogue_id LEFT JOIN areas a ON a.id = s.area_id
           WHERE sm.user_id = ? ORDER BY s.name`,
          actor.id
        );
  const settings = await getSettings(env);
  const user = publicUser(await first(env, `SELECT * FROM users WHERE id = ?`, actor.id));
  return json({
    user,
    synagogues,
    // What the UI needs to know about the system
    system: { shabbat_enabled: settings.shabbat_enabled, feedback_enabled: settings.feedback_enabled, mail_ready: await mailReady(env) },
  });
}

/**
 * Users cannot change their own name or phone (the admin does). They may change their e-mail
 * (unless the admin blocked it). The super admin may also hide himself from other admins.
 */
export async function patchMe({ env, actor, request }) {
  const d = fields(await readJson(request), { partial: true }).email('email', { required: true }).bool('is_hidden').done();
  if (d.email !== undefined) {
    if (!actor.can_edit_email) throw forbidden('שינוי המייל חסום. לשינוי פנו למנהל המערכת');
    if (await first(env, `SELECT id FROM users WHERE email = ? AND id != ?`, d.email, actor.id)) throw invalid({ email: 'המייל כבר רשום במערכת' });
    await run(env, `UPDATE users SET email = ?, updated_at = ? WHERE id = ?`, d.email, nowIso(), actor.id);
  }
  if (d.is_hidden !== undefined) {
    if (!actor.is_super) throw forbidden('רק מנהל העל יכול להסתיר את עצמו');
    await run(env, `UPDATE users SET is_hidden = ? WHERE id = ?`, d.is_hidden ? 1 : 0, actor.id);
  }
  return getMe({ env, actor });
}

export async function getLogins({ env, actor }) {
  return json(await all(env, `SELECT channel, detail, created_at FROM login_log WHERE user_id = ? ORDER BY id DESC LIMIT 50`, actor.id));
}

/** Turn on/off "ask my password on phone calls". Turning on needs the current password, digits only. */
export async function putPhonePassword({ env, actor, request }) {
  const d = fields(await readJson(request)).bool('enabled', { required: true }).str('password', { max: 200 }).done();
  if (d.enabled) {
    const row = await first(env, `SELECT password_hash FROM users WHERE id = ?`, actor.id);
    if (!d.password || !(await verifyPassword(d.password, row.password_hash))) throw invalid({ password: 'הסיסמה שגויה' });
    if (!/^\d{4,}$/.test(d.password)) throw invalid({ password: 'כדי להקיש בטלפון, הסיסמה צריכה להכיל ספרות בלבד. החליפו קודם סיסמה' });
  }
  await run(env, `UPDATE users SET phone_requires_password = ? WHERE id = ?`, d.enabled ? 1 : 0, actor.id);
  return getMe({ env, actor });
}

/** Changing the password signs out every other device. */
export async function putPassword({ env, actor, request }) {
  if (!actor.can_edit_password) throw forbidden('שינוי הסיסמה חסום. לשינוי פנו למנהל המערכת');
  const d = fields(await readJson(request)).str('current_password', { required: true, max: 200 }).password('new_password', { required: true }).done();
  const row = await first(env, `SELECT password_hash, phone_requires_password FROM users WHERE id = ?`, actor.id);
  if (row.phone_requires_password && !/^\d{4,}$/.test(d.new_password)) {
    throw invalid({ new_password: 'הסיסמה נדרשת גם בטלפון, ולכן חייבת להכיל ספרות בלבד (או בטלו קודם את הדרישה בטלפון)' });
  }
  if (!row.password_hash || !(await verifyPassword(d.current_password, row.password_hash))) throw invalid({ current_password: 'הסיסמה הנוכחית שגויה' });
  await run(env, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, await hashPassword(d.new_password), nowIso(), actor.id);
  await revokeSessions(env, actor.id, actor.session_id);
  return noContent();
}

// ------------------------------------------------------------------ e-mail links (login without password, reset)
const MAIL_LIMIT = { max: 3, window: 3600, lock: 3600 };

/** What the login screen may offer. */
export async function getOptions({ env }) {
  const s = await getSettings(env);
  const ready = await mailReady(env);
  return json({
    magic_link: ready && s.magic_link_enabled,
    password_reset: ready && s.password_reset_enabled,
    google_client_id: s.google_login_enabled && s.google_client_id ? s.google_client_id : null,
  });
}

/**
 * POST /auth/google { credential }: the ID token from Google's sign-in button. Google checks the signature
 * (tokeninfo); we check it was issued to our app, the e-mail is verified, and a user has that e-mail.
 */
export async function postGoogle({ env, request }) {
  const s = await getSettings(env);
  if (!s.google_login_enabled || !s.google_client_id) throw forbidden('הכניסה עם Google סגורה כרגע');
  const d = fields(await readJson(request)).str('credential', { required: true, max: 4096 }).done();
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(d.credential)}`);
  const g = res.ok ? await res.json() : null;
  if (!g?.email || g.aud !== s.google_client_id || String(g.email_verified) !== 'true' || Number(g.exp) * 1000 < Date.now()) {
    throw unauthorized('האימות מול Google נכשל. נסו שוב');
  }
  const email = normalizeEmail(g.email);
  const key = `google:${email}`;
  await checkLock(env, key);
  const user = email && (await first(env, `SELECT * FROM users WHERE email = ? AND is_active = 1`, email));
  if (!user) {
    await recordFailure(env, key, { max: 5, window: 900, lock: 900 });
    throw unauthorized(`אין במערכת משתמש פעיל עם המייל ${g.email}. פנו למנהל המערכת`);
  }
  return json(await createSession(env, request, user, 'Google'));
}

/**
 * Sends a one-time link. Always answers the same way whether or not the user exists,
 * so the form cannot be used to discover who is registered.
 */
async function sendLink(ctx, purpose) {
  const { env, request, url } = ctx;
  const s = await getSettings(env);
  const enabled = purpose === 'login' ? s.magic_link_enabled : s.password_reset_enabled;
  if (!enabled || !(await mailReady(env))) throw forbidden('האפשרות סגורה כרגע. פנו למנהל המערכת');
  const d = fields(await readJson(request)).str('login', { required: true, max: 200 }).done();
  const user = await findUserByLogin(env, d.login);
  if (!user?.email) return noContent();
  if (purpose === 'reset' && !user.can_edit_password) return noContent();
  const key = `mail:${user.id}`;
  try { await checkLock(env, key); } catch { throw tooMany('נשלחו יותר מדי קישורים. נסו שוב בעוד שעה', 3600); }
  await recordFailure(env, key, MAIL_LIMIT);
  const token = await createEmailToken(env, user.id, purpose);
  const link = adminUrl(env, url, `/${purpose === 'login' ? 'link' : 'reset'}?t=${token}`);
  await sendMail(env, purpose === 'login'
    ? { to: user.email, subject: 'קישור כניסה לזמני מניינים', title: `שלום ${user.name}`, site: siteUrl(env, url),
        paragraphs: ['ביקשת להיכנס למערכת בלי סיסמה. לחיצה על הכפתור מכניסה אותך ישר.'],
        details: [['תוקף הקישור', '30 דקות'], ['שימוש', 'פעם אחת']],
        button: { label: 'כניסה למערכת', url: link },
        note: 'אם לא ביקשת להיכנס, אפשר להתעלם מהמייל. בלי הקישור אי אפשר להיכנס לחשבון שלך.' }
    : { to: user.email, subject: 'איפוס סיסמה - זמני מניינים', title: `שלום ${user.name}`, site: siteUrl(env, url),
        paragraphs: ['ביקשת לאפס את הסיסמה. בכפתור בוחרים סיסמה חדשה ונכנסים למערכת.'],
        details: [['תוקף הקישור', 'שעה'], ['שימוש', 'פעם אחת']],
        button: { label: 'בחירת סיסמה חדשה', url: link },
        note: 'אם לא ביקשת, אפשר להתעלם מהמייל. הסיסמה הנוכחית נשארת בתוקף.' });
  return noContent();
}

export const postEmailLink = (ctx) => sendLink(ctx, 'login');
export const postResetRequest = (ctx) => sendLink(ctx, 'reset');

export async function postEmailLinkVerify({ env, request }) {
  const s = await getSettings(env);
  if (!s.magic_link_enabled) throw forbidden('הכניסה בקישור סגורה כרגע');
  const d = fields(await readJson(request)).str('token', { required: true, max: 200 }).done();
  const user = await consumeEmailToken(env, d.token, 'login');
  return json(await createSession(env, request, user, 'קישור במייל'));
}

export async function postReset({ env, request }) {
  const s = await getSettings(env);
  if (!s.password_reset_enabled) throw forbidden('איפוס הסיסמה סגור כרגע');
  const d = fields(await readJson(request)).str('token', { required: true, max: 200 }).password('new_password', { required: true }).done();
  const user = await consumeEmailToken(env, d.token, 'reset');
  if (!user.can_edit_password) throw forbidden('שינוי הסיסמה חסום. פנו למנהל המערכת');
  if (user.phone_requires_password && !/^\d{4,}$/.test(d.new_password)) {
    throw invalid({ new_password: 'הסיסמה נדרשת גם בטלפון, ולכן חייבת להכיל ספרות בלבד' });
  }
  await run(env, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, await hashPassword(d.new_password), nowIso(), user.id);
  await revokeSessions(env, user.id);
  return json(await createSession(env, request, user, 'איפוס סיסמה'));
}
