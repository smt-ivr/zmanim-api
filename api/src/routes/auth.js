import { hashPassword, login, logout, revokeSessions, verifyPassword } from '../auth.js';
import { all, first, nowIso, run } from '../db.js';
import { conflict, forbidden, invalid, json, noContent, readJson } from '../http.js';
import { fields } from '../validate.js';

export async function postLogin({ env, request }) {
  const d = fields(await readJson(request)).email('email', { required: true }).str('password', { required: true, max: 200 }).done();
  return json(await login(env, request, d.email, d.password));
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
  const { session_id, synagogue_ids, ...user } = actor;
  return json({ user, synagogues });
}

export async function patchMe({ env, actor, request }) {
  const d = fields(await readJson(request), { partial: true }).str('name', { required: true, max: 80 }).done();
  if (d.name !== undefined) await run(env, `UPDATE users SET name = ?, updated_at = ? WHERE id = ?`, d.name, nowIso(), actor.id);
  return getMe({ env, actor: { ...actor, ...d } });
}

/** Changing the password signs out every other device. */
export async function putPassword({ env, actor, request }) {
  const d = fields(await readJson(request)).str('current_password', { required: true, max: 200 }).password('new_password', { required: true }).done();
  const row = await first(env, `SELECT password_hash FROM users WHERE id = ?`, actor.id);
  if (!row.password_hash || !(await verifyPassword(d.current_password, row.password_hash))) throw invalid({ current_password: 'הסיסמה הנוכחית שגויה' });
  await run(env, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, await hashPassword(d.new_password), nowIso(), actor.id);
  await revokeSessions(env, actor.id, actor.session_id);
  return noContent();
}

// ------------------------------------------------------------------ first-run setup
// Creates the first admin. Works only while there are no users AND the SETUP_KEY secret is set and matches.

export async function getSetup({ env }) {
  // "Needed" until someone can log in to the web UI (phone-only admins do not count).
  const row = await first(env, `SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL`);
  return json({ needed: row.n === 0, enabled: Boolean(env.SETUP_KEY) });
}

export async function postSetup({ env, request }) {
  if (!env.SETUP_KEY) throw forbidden('ההתקנה הראשונית כבויה. יש להגדיר את הסוד SETUP_KEY ב-Worker');
  const d = fields(await readJson(request))
    .str('setup_key', { required: true, max: 200 })
    .str('name', { required: true, max: 80 })
    .email('email', { required: true })
    .password('password', { required: true })
    .done();
  if (d.setup_key !== env.SETUP_KEY) throw forbidden('מפתח ההתקנה שגוי');
  const hash = await hashPassword(d.password);
  // Atomic "only if empty": a concurrent second request inserts nothing.
  const res = await run(
    env,
    `INSERT INTO users (name, email, password_hash, role) SELECT ?, ?, ?, 'admin'
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE password_hash IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
    d.name, d.email, hash, d.email
  );
  if (!res.meta.changes) throw conflict('המערכת כבר הותקנה');
  return json(await login(env, request, d.email, d.password), 201);
}
