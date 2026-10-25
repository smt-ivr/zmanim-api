import { hashPassword, login, logout, revokeSessions, verifyPassword } from '../auth.js';
import { all, first, nowIso, run } from '../db.js';
import { conflict, forbidden, invalid, json, noContent, readJson } from '../http.js';
import { fields } from '../validate.js';

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
