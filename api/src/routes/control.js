// Super-admin control panel and messages to the developers.
import { all, first, run } from '../db.js';
import { forbidden, invalid, json, noContent, notFound, readJson } from '../http.js';
import { SETTINGS, getSettings, saveSettings } from '../settings.js';
import { fields, id } from '../validate.js';

// ------------------------------------------------------------------ control settings
export async function getControl({ env }) {
  return json(await getSettings(env));
}

export async function patchControl({ env, request }) {
  const body = await readJson(request);
  const v = fields(body, { partial: true });
  for (const [key, def] of Object.entries(SETTINGS)) {
    if (def.type === 'bool') v.bool(key);
    else v.str(key, { max: def.max });
  }
  const d = v.done();
  if (d.listen_phone && !/^[\d-]{7,15}$/.test(d.listen_phone)) throw invalid({ listen_phone: 'מספר טלפון לא תקין' });
  await saveSettings(env, d);
  return json(await getSettings(env));
}

// ------------------------------------------------------------------ messages to the developers
async function canWrite(env, actor) {
  const settings = await getSettings(env);
  if (!settings.feedback_enabled) return 'השירות לפניות סגור כרגע';
  if (!actor.can_message) return 'שליחת פניות חסומה עבורך';
  return null;
}

export async function myFeedback({ env, actor }) {
  const items = await all(env, `SELECT id, body, created_at FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 50`, actor.id);
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
    `SELECT f.id, f.body, f.is_read, f.created_at, u.id AS user_id, u.name AS user_name, u.phone AS user_phone, u.email AS user_email, u.can_message
     FROM feedback f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 300`
  );
  return json(rows.map((r) => ({ ...r, is_read: r.is_read === 1, can_message: r.can_message === 1 })));
}

export async function patchFeedback({ env, params, request }) {
  const fid = id(params.id);
  const d = fields(await readJson(request), { partial: true }).bool('is_read').done();
  const res = await run(env, `UPDATE feedback SET is_read = ? WHERE id = ?`, d.is_read ? 1 : 0, fid);
  if (!res.meta.changes) throw notFound();
  return noContent();
}

export async function deleteFeedback({ env, params }) {
  const res = await run(env, `DELETE FROM feedback WHERE id = ?`, id(params.id));
  if (!res.meta.changes) throw notFound();
  return noContent();
}
