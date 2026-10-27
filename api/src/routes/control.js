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
    to: me.email, subject: `בדיקת מייל - ${(await getSettings(env)).system_name}`, title: `שלום ${me.name}`, site: siteUrl(env, url),
    paragraphs: ['זהו מייל בדיקה. אם הוא הגיע אליך, שליחת המיילים מוגדרת ועובדת.'],
    details: [['נשלח אל', me.email]],
  });
  return json({ sent_to: me.email });
}
