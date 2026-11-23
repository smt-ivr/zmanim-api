// Recordings in the administration's voice: uploading them to Yemot (UploadFile, converted to wav
// there) with the Yemot token kept in minutes_settings, listening, pausing and deleting. Also the
// webhook Yemot calls when a file fails to play (api_send_webhook_error_link): the recording is paused.
import { HttpError } from './auth.js';
import { all, first, getKey, nowSec, run } from './data.js';
import { readParams } from './ivr.js';
import { fileName, PHRASES } from './voice.js';

const API = 'https://www.call2all.co.il/ym/api/';
const MAX_AUDIO = 10 * 1024 * 1024;
const DEFAULT_FOLDER = 'minutesrec';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// ------------------------------------------------------------------ settings
async function getSettings(env) {
  const rows = await all(env, `SELECT key, value FROM minutes_settings WHERE key IN ('yemot_token', 'recordings_folder', 'recordings_enabled', 'yemot_numbers')`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { token: m.yemot_token || '', folder: m.recordings_folder || DEFAULT_FOLDER, enabled: m.recordings_enabled !== '0', yemotNumbers: m.yemot_numbers === '1' };
}

const put = (env, key, value) => run(env, `INSERT INTO minutes_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);

/** The token is never sent back whole. */
const masked = (t) => (t ? `${t.slice(0, 4)}••••${t.slice(-3)}` : '');
const view = (s) => ({ token: masked(s.token), has_token: Boolean(s.token), folder: s.folder, enabled: s.enabled, yemot_numbers: s.yemotNumbers });

// Letters and digits only: Yemot does not allow "_" in folder names, and "-" splits the f-<path> message.
const folderOk = (f) => /^[A-Za-z0-9]+(\/[A-Za-z0-9]+)*$/.test(f);
const cleanFolder = (f) => String(f || '').trim().replace(/^ivr2:/, '').replace(/^\/+|\/+$/g, '');

function token(s) {
  if (!s.token) throw new HttpError(409, 'יש להזין קודם טוקן של ימות המשיח');
  return s.token;
}

/** Calls the Yemot API; throws a clear error when it refuses. Returns the JSON, or the Response for a file. */
async function yemot(s, action, params = {}) {
  let res;
  try { res = await fetch(`${API}${action}?${new URLSearchParams({ token: token(s), ...params })}`); } catch { throw new HttpError(502, 'אין חיבור לימות המשיח כרגע. נסו שוב'); }
  if (!(res.headers.get('content-type') || '').includes('json')) return res;
  const data = await res.json().catch(() => ({}));
  if (data.responseStatus !== 'OK') {
    const msg = String(data.message || data.responseStatus || res.status);
    throw new HttpError(502, /token|session|login/i.test(msg) ? `הטוקן של ימות המשיח לא התקבל (${msg})` : `ימות המשיח החזירו שגיאה: ${msg}`);
  }
  return data;
}

const phraseOf = (key) => {
  const p = PHRASES.find((x) => x[0] === key);
  if (!p) throw new HttpError(404, 'אין משפט כזה ברשימה');
  return { key, text: p[1] };
};

// ------------------------------------------------------------------ routes (all behind the admin login)
/** GET recordings — settings and every phrase with its status. */
export async function list(env, request, url, base) {
  const s = await getSettings(env);
  const rows = await all(env, `SELECT key, text, paused, error, error_at, updated_at FROM minutes_recordings`);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return json({
    settings: view(s),
    items: PHRASES.map(([key, text, group, where]) => {
      const r = byKey.get(key);
      return { key, text, group, where, file: fileName(key), recorded: Boolean(r), paused: r?.paused === 1, error: r?.error ?? null, updated_at: r?.updated_at ?? null, changed: Boolean(r && r.text !== text) };
    }),
    webhook: `${url.origin}${base}/file-error/${await getKey(env)}`,
  });
}

/** PATCH recordings/settings { token?, folder?, enabled?, yemot_numbers? } */
export async function patchSettings(env, request) {
  const d = await request.json().catch(() => ({}));
  if (typeof d.token === 'string' && !d.token.includes('••••')) await put(env, 'yemot_token', d.token.trim().slice(0, 300));
  if (d.folder !== undefined) {
    const f = cleanFolder(d.folder);
    if (!folderOk(f)) throw new HttpError(400, 'שם תיקייה: אותיות באנגלית וספרות בלבד (בלי - ובלי _), ו־/ בין תיקיות. לדוגמה minutesrec');
    await put(env, 'recordings_folder', f);
  }
  if (typeof d.enabled === 'boolean') await put(env, 'recordings_enabled', d.enabled ? '1' : '0');
  if (typeof d.yemot_numbers === 'boolean') await put(env, 'yemot_numbers', d.yemot_numbers ? '1' : '0');
  return json(view(await getSettings(env)));
}

/** POST recordings/test — checks the token. */
export async function test(env) {
  await yemot(await getSettings(env), 'GetIVR2Dir', { path: 'ivr2:/' });
  return json({ ok: true });
}

/** POST recordings/:key (form: file) — uploads to Yemot and starts playing it. */
export async function upload(env, request, key) {
  const s = await getSettings(env);
  const item = phraseOf(key);
  let form;
  try { form = await request.formData(); } catch { throw new HttpError(400, 'ההעלאה נכשלה, נסו שוב'); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) throw new HttpError(400, 'לא התקבל קובץ שמע');
  if (file.size > MAX_AUDIO) throw new HttpError(400, 'הקובץ גדול מדי (עד 10MB)');
  if (!/^(audio|video)\//.test(file.type || '') && !/\.(wav|mp3|webm|ogg|m4a|mp4|aac|amr|opus)$/i.test(file.name || '')) throw new HttpError(400, 'יש להעלות קובץ שמע');
  const body = new FormData();
  body.append('token', token(s));
  body.append('path', `ivr2:/${s.folder}/${fileName(key)}.wav`);
  body.append('convertAudio', '1');
  body.append('file', file, file.name || 'recording.webm');
  const res = await fetch(`${API}UploadFile`, { method: 'POST', body }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (data.responseStatus !== 'OK') throw new HttpError(502, `ההעלאה לימות המשיח נכשלה${data.message ? `: ${data.message}` : ''}`);
  // where Yemot actually saved it ("ivr2:/minutesrec/addprompt.wav"), for playing: "/minutesrec/addprompt"
  const saved = String(data.path || '').replace(/^ivr2?:?\/?/, '/').replace(/\.\w+$/, '') || `/${s.folder}/${fileName(key)}`;
  const path = saved.startsWith('/') ? saved : `/${saved}`;
  await run(env, `INSERT INTO minutes_recordings (key, path, text, size, paused, error, error_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, NULL, ?)
    ON CONFLICT(key) DO UPDATE SET path = excluded.path, text = excluded.text, size = excluded.size, paused = 0, error = NULL, error_at = NULL, updated_at = excluded.updated_at`,
  key, path, item.text, file.size, nowSec());
  return json({ key, recorded: true, path }, 201);
}

/** PATCH recordings/:key { paused } */
export async function setPaused(env, request, key) {
  const d = await request.json().catch(() => ({}));
  if (typeof d.paused !== 'boolean') throw new HttpError(400, 'חסר ערך');
  const res = await run(env, `UPDATE minutes_recordings SET paused = ?, error = CASE WHEN ? THEN error ELSE NULL END, error_at = CASE WHEN ? THEN error_at ELSE NULL END WHERE key = ?`,
    d.paused ? 1 : 0, d.paused ? 1 : 0, d.paused ? 1 : 0, key);
  if (!res.meta.changes) throw new HttpError(404, 'אין הקלטה');
  return json({ key, paused: d.paused });
}

/** DELETE recordings/:key — removes the file from Yemot; the phrase goes back to text-to-speech. */
export async function remove(env, key) {
  const row = await first(env, `SELECT path FROM minutes_recordings WHERE key = ?`, key);
  if (!row) throw new HttpError(404, 'אין הקלטה');
  await run(env, `DELETE FROM minutes_recordings WHERE key = ?`, key); // first: the line stops playing it at once
  await yemot(await getSettings(env), 'FileAction', { action: 'delete', what: `ivr2:${row.path}.wav` }).catch((e) => console.error('[ivr-minutes] delete', e.message));
  return json({ key, recorded: false });
}

/** GET recordings/:key/audio — the recording itself from Yemot, for listening in the browser. */
export async function audio(env, key) {
  const row = await first(env, `SELECT path FROM minutes_recordings WHERE key = ?`, key);
  if (!row) throw new HttpError(404, 'אין הקלטה');
  const res = await yemot(await getSettings(env), 'DownloadFile', { path: `ivr2:${row.path}.wav` });
  if (!(res instanceof Response) || !res.ok) throw new HttpError(502, 'לא ניתן להשמיע את ההקלטה מימות המשיח');
  return new Response(res.body, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=60' } });
}

/**
 * GET|POST <prefix>/file-error/<ivr key> — Yemot's webhook when a file failed to play:
 * { FilePath: "/minutesrec/addprompt", Status: "Error", Message: "file audio not found" }.
 * The recording is paused (read as text again) and the reason is shown in the admin page.
 */
export async function fileError(request, env, key) {
  const p = await readParams(request);
  if (!key || key !== (await getKey(env))) return new Response('forbidden', { status: 403 });
  const path = String(p.FilePath || '').trim().replace(/\.\w+$/, '');
  if (!path) return new Response('ok');
  const msg = String(p.Message || p.Status || 'ההשמעה נכשלה').slice(0, 200);
  await run(env, `UPDATE minutes_recordings SET paused = 1, error = ?, error_at = ? WHERE path = ? OR path = ?`,
    `ימות המשיח: ${msg}`, nowSec(), path, path.startsWith('/') ? path : `/${path}`);
  return new Response('ok');
}
