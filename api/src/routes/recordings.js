// Recordings in the administration's voice: which sentences and names the phone line can play from a
// recording, uploading them to Yemot (UploadFile, converted to wav there), listening and deleting.
// Sentences go to one Yemot folder, synagogue names to another. Only the super admin manages them;
// a gabbai sees whether their synagogue's name is recorded and can listen to it.
import { all, first, nowIso, run } from '../db.js';
import { HttpError, forbidden, invalid, json, notFound } from '../http.js';
import { catalog, fileName } from '../ivr/voice.js';
import { getSettings, publicView, saveSettings } from '../settings.js';
import { id } from '../validate.js';
import { ivrKey } from './admin.js';
import { readParams } from '../ivr/engine.js';

const API = 'https://www.call2all.co.il/ym/api/';
const MAX_AUDIO = 10 * 1024 * 1024;
const PAGE = 50;

// Letters and digits only: Yemot does not allow "_" in folder names, and "-" splits the f-<path> message.
const folderOk = (f) => /^[A-Za-z0-9]+(\/[A-Za-z0-9]+)*$/.test(f);
const cleanFolder = (f) => String(f || '').trim().replace(/^ivr2:/, '').replace(/^\/+|\/+$/g, '');
const folderOf = (s, key) => (key.startsWith('syn:') ? s.recordings_syn_folder : s.recordings_folder);
const yemotPath = (s, key) => `ivr2:/${folderOf(s, key)}/${fileName(key)}.wav`;

function token(s) {
  if (!s.yemot_token) throw new HttpError(409, 'NO_TOKEN', 'יש להגדיר קודם טוקן של ימות המשיח');
  return s.yemot_token;
}

/** Calls the Yemot API; throws a clear error when it refuses. */
async function yemot(s, action, params = {}, body) {
  const url = `${API}${action}?${new URLSearchParams({ token: token(s), ...params })}`;
  let res;
  try { res = await fetch(url, body ? { method: 'POST', body } : {}); } catch { throw new HttpError(502, 'YEMOT_DOWN', 'אין חיבור לימות המשיח כרגע. נסו שוב'); }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) return res; // a file
  const data = await res.json().catch(() => ({}));
  if (data.responseStatus !== 'OK') {
    const msg = String(data.message || data.responseStatus || res.status);
    throw new HttpError(502, 'YEMOT_ERROR', /token|session|login/i.test(msg) ? `הטוקן של ימות המשיח לא התקבל (${msg})` : `ימות המשיח החזירו שגיאה: ${msg}`);
  }
  return data;
}

/** A key that can be recorded: from the catalog, or a synagogue that exists. Returns { key, text }. */
async function itemOf(env, s, key) {
  if (/^syn:\d+$/.test(key)) {
    const syn = await first(env, `SELECT id, name FROM synagogues WHERE id = ?`, Number(key.slice(4)));
    if (!syn) throw notFound('בית הכנסת לא נמצא');
    return { key, text: syn.name };
  }
  const item = (await catalog(env, s)).find((x) => x.key === key);
  if (!item) throw notFound('אין הקלטה כזו ברשימה');
  return item;
}

const settingsView = (s) => ({
  enabled: s.recordings_enabled, folder: s.recordings_folder, syn_folder: s.recordings_syn_folder, token: publicView(s).yemot_token,
});

/** Playable by Yemot: letters, digits and "/" only ("-" splits the f-<path> message, "_" is not allowed). */
const playable = (path) => /^(\/[A-Za-z0-9]+)+$/.test(path);

/** GET /admin/recordings — the settings and every sentence / name that can be recorded, with its status. */
export async function list({ env, url }) {
  const s = await getSettings(env);
  const [items, rows, syn] = await Promise.all([
    catalog(env, s),
    all(env, `SELECT key, text, size, paused, error, error_at, updated_at FROM recordings WHERE key NOT LIKE 'syn:%'`),
    first(env, `SELECT (SELECT COUNT(*) FROM synagogues) AS total, (SELECT COUNT(*) FROM recordings WHERE key LIKE 'syn:%') AS recorded`),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return json({
    settings: settingsView(s),
    items: items.map((i) => {
      const r = byKey.get(i.key);
      return { ...i, recorded: Boolean(r), paused: r?.paused === 1, error: r?.error ?? null, error_at: r?.error_at ?? null, updated_at: r?.updated_at ?? null, changed: Boolean(r && r.text && r.text !== i.text) };
    }),
    synagogues: syn,
    errors: (await first(env, `SELECT COUNT(*) AS n FROM recordings WHERE error IS NOT NULL`)).n,
    // the line to put in the listening extension's settings, so Yemot reports a file that fails to play
    webhook: `api_send_webhook_error_link=${url.origin}${(env.BASE_PATH || '').replace(/\/$/, '')}/api/ivr/file-error?key=${await ivrKey(env)}`,
  });
}

/** GET /admin/recordings/synagogues?q=&filter=missing|recorded&page= */
export async function synagogues({ env, url }) {
  const p = url.searchParams;
  const where = [];
  const args = [];
  if (p.get('q')) (where.push(`s.name LIKE ?`), args.push(`%${p.get('q').trim()}%`));
  if (p.get('filter') === 'missing') where.push('r.id IS NULL');
  if (p.get('filter') === 'recorded') where.push('r.id IS NOT NULL');
  const from = `FROM synagogues s LEFT JOIN areas a ON a.id = s.area_id LEFT JOIN recordings r ON r.key = 'syn:' || s.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const page = Math.max(Number(p.get('page')) || 0, 0);
  const [total, items] = await Promise.all([
    first(env, `SELECT COUNT(*) AS n ${from}`, ...args),
    all(env, `SELECT s.id, s.name, a.name AS area_name, r.id IS NOT NULL AS recorded, r.paused, r.error, r.updated_at, r.text AS recorded_text
      ${from} ORDER BY r.id IS NOT NULL, s.name LIMIT ? OFFSET ?`, ...args, PAGE, page * PAGE),
  ]);
  return json({ total: total.n, page, page_size: PAGE, items: items.map((i) => ({ ...i, recorded: i.recorded === 1, paused: i.paused === 1, changed: Boolean(i.recorded && i.recorded_text && i.recorded_text !== i.name) })) });
}

/** PATCH /admin/recordings/settings { token?, enabled?, folder?, syn_folder? } */
export async function patchSettings({ env, request }) {
  const d = await request.json().catch(() => ({}));
  const out = {};
  if (typeof d.enabled === 'boolean') out.recordings_enabled = d.enabled;
  if (typeof d.token === 'string' && !d.token.includes('••••')) out.yemot_token = d.token.trim().slice(0, 300);
  for (const [k, col] of [['folder', 'recordings_folder'], ['syn_folder', 'recordings_syn_folder']]) {
    if (d[k] === undefined) continue;
    const f = cleanFolder(d[k]);
    if (!folderOk(f)) throw invalid({ [k]: 'שם תיקייה: אותיות באנגלית וספרות בלבד (בלי - ובלי _), ו־/ בין תיקיות. לדוגמה zmanimrec/system' });
    out[col] = f;
  }
  await saveSettings(env, out);
  return json(settingsView(await getSettings(env)));
}

/** POST /admin/recordings/test — checks the token (and that the folders can be read). */
export async function test({ env }) {
  const s = await getSettings(env);
  await yemot(s, 'GetIVR2Dir', { path: 'ivr2:/' });
  return json({ ok: true });
}

/** POST /admin/recordings/:key (form: file) — uploads to Yemot (converted to wav there) and starts playing it. */
export async function upload({ env, actor, params, request }) {
  const s = await getSettings(env);
  const key = decodeURIComponent(params.key);
  const item = await itemOf(env, s, key);
  let form;
  try { form = await request.formData(); } catch { throw invalid({ file: 'ההעלאה נכשלה, נסו שוב' }); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) throw invalid({ file: 'לא התקבל קובץ שמע' });
  if (file.size > MAX_AUDIO) throw invalid({ file: 'הקובץ גדול מדי (עד 10MB)' });
  if (!/^(audio|video)\//.test(file.type || '') && !/\.(wav|mp3|webm|ogg|m4a|mp4|aac|amr|opus)$/i.test(file.name || '')) throw invalid({ file: 'יש להעלות קובץ שמע' });
  const body = new FormData();
  body.append('token', token(s));
  body.append('path', yemotPath(s, key));
  body.append('convertAudio', '1');
  body.append('file', file, file.name || 'recording.webm');
  const res = await fetch(`${API}UploadFile`, { method: 'POST', body }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (data.responseStatus !== 'OK') throw new HttpError(502, 'YEMOT_ERROR', `ההעלאה לימות המשיח נכשלה${data.message ? `: ${data.message}` : ''}`);
  // where Yemot actually saved it ("ivr/zmanimrec/system/welcome.wav"), for playing: "/zmanimrec/system/welcome"
  const saved = String(data.path || '').replace(/^ivr2?:?\/?/, '/').replace(/\.\w+$/, '') || `/${folderOf(s, key)}/${fileName(key)}`;
  const path = saved.startsWith('/') ? saved : `/${saved}`;
  await run(env, `INSERT INTO recordings (key, path, text, size, uploaded_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET path = excluded.path, text = excluded.text, size = excluded.size, uploaded_by = excluded.uploaded_by, paused = 0, error = NULL, error_at = NULL, updated_at = ?`,
    key, path, item.text, file.size, actor.id, nowIso());
  return json({ key, recorded: true, path, updated_at: nowIso() }, 201);
}

/** PATCH /admin/recordings/:key { paused } — keep the file, but read the sentence by text-to-speech (or play it again). */
export async function setPaused({ env, params, request }) {
  const key = decodeURIComponent(params.key);
  const d = await request.json().catch(() => ({}));
  if (typeof d.paused !== 'boolean') throw invalid({ paused: 'חסר ערך' });
  const row = await first(env, `SELECT path FROM recordings WHERE key = ?`, key);
  if (!row) throw notFound('אין הקלטה');
  if (!d.paused && !playable(row.path)) throw invalid({ paused: 'הקובץ נמצא בתיקייה שימות המשיח לא משמיעים ממנה. יש להעלות אותו מחדש ("החלפה")' });
  // playing again: the last failure report no longer applies (Yemot will report again if it still fails)
  await run(env, `UPDATE recordings SET paused = ?, error = CASE WHEN ? THEN error ELSE NULL END, error_at = CASE WHEN ? THEN error_at ELSE NULL END WHERE key = ?`,
    d.paused ? 1 : 0, d.paused ? 1 : 0, d.paused ? 1 : 0, key);
  return json({ key, paused: d.paused });
}

/** DELETE /admin/recordings/:key — removes the file from Yemot; the sentence goes back to text-to-speech. */
export async function remove({ env, params }) {
  const s = await getSettings(env);
  const key = decodeURIComponent(params.key);
  const row = await first(env, `SELECT * FROM recordings WHERE key = ?`, key);
  if (!row) throw notFound('אין הקלטה');
  await run(env, `DELETE FROM recordings WHERE key = ?`, key); // first: the line stops playing it at once
  await yemot(s, 'FileAction', { action: 'delete', what: `ivr2:${row.path}.wav` }).catch((e) => console.error('[recordings] delete', e.message));
  return json({ key, recorded: false });
}

/** The recording itself, from Yemot (for listening in the browser). */
async function stream(env, key) {
  const s = await getSettings(env);
  const row = await first(env, `SELECT path FROM recordings WHERE key = ?`, key);
  if (!row) throw notFound('אין הקלטה');
  const res = await yemot(s, 'DownloadFile', { path: `ivr2:${row.path}.wav` });
  if (!(res instanceof Response) || !res.ok) throw new HttpError(502, 'YEMOT_ERROR', 'לא ניתן להשמיע את ההקלטה מימות המשיח');
  return new Response(res.body, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=60' } });
}

/**
 * GET|POST /ivr/file-error?key= — Yemot's webhook when a file of an answer failed to play
 * (api_send_webhook_error_link): { FilePath: "/zmanimrec/system/at", Status: "Error", Message: "file audio not found" }.
 * The recording is paused (the line reads it as text again) and the reason is shown in the admin.
 */
export async function fileError({ env, request, url }) {
  const p = await readParams(request, url);
  if (!p.key || p.key !== (await first(env, `SELECT value FROM settings WHERE key = 'ivr_key'`))?.value) return new Response('forbidden', { status: 403 });
  const path = String(p.FilePath || '').trim().replace(/\.\w+$/, '');
  if (!path) return new Response('ok');
  const msg = String(p.Message || p.Status || 'ההשמעה נכשלה').slice(0, 200);
  const res = await run(env, `UPDATE recordings SET paused = 1, error = ?, error_at = ? WHERE path = ? OR path = ?`,
    `ימות המשיח: ${msg} (${path})`, nowIso(), path, path.startsWith('/') ? path : `/${path}`);
  if (!res.meta.changes) console.error('[recordings] file error for an unknown path', path, msg);
  return new Response('ok');
}

/** GET /admin/recordings/:key/audio */
export const audio = ({ env, params }) => stream(env, decodeURIComponent(params.key));

/** GET /synagogues/:sid/recording — a gabbai: is the synagogue's name recorded (and listen to it with ?audio=1). */
export async function synagogueRecording({ env, actor, params, url }) {
  const sid = id(params.sid);
  if (actor.role !== 'admin' && !actor.synagogue_ids.includes(sid)) throw forbidden('אין לך גישה לבית כנסת זה');
  if (url.searchParams.get('audio')) return stream(env, `syn:${sid}`);
  const row = await first(env, `SELECT updated_at, paused FROM recordings WHERE key = ?`, `syn:${sid}`);
  return json({ recorded: Boolean(row) && !row.paused, updated_at: row?.updated_at ?? null });
}

/**
 * POST /admin/recordings/sync — reads both Yemot folders: files that are there (e.g. recorded by phone
 * straight into the folder, named as the list shows) start playing; recordings whose file is gone stop.
 */
export async function sync({ env }) {
  const s = await getSettings(env);
  const items = await catalog(env, s);
  const synIds = (await all(env, `SELECT id, name FROM synagogues`));
  const expected = new Map([
    ...items.map((i) => [`${s.recordings_folder}/${fileName(i.key)}`, i]),
    ...synIds.map((x) => [`${s.recordings_syn_folder}/${fileName(`syn:${x.id}`)}`, { key: `syn:${x.id}`, text: x.name }]),
  ]);
  const present = new Set();
  for (const folder of [s.recordings_folder, s.recordings_syn_folder]) {
    const data = await yemot(s, 'GetIVR2Dir', { path: `ivr2:/${folder}` }).catch((e) => (/not ?exist|לא קיים/i.test(e.message) ? { files: [] } : Promise.reject(e)));
    for (const f of data.files || []) {
      if (f.fileType && f.fileType !== 'AUDIO') continue;
      present.add(`${folder}/${String(f.name).replace(/\.\w+$/, '')}`);
    }
  }
  const rows = await all(env, `SELECT key, path FROM recordings`);
  const known = new Set(rows.map((r) => r.key));
  let added = 0;
  let removed = 0;
  for (const [path, item] of expected) {
    if (present.has(path) && !known.has(item.key)) {
      await run(env, `INSERT INTO recordings (key, path, text) VALUES (?, ?, ?)`, item.key, `/${path}`, item.text);
      added += 1;
    }
  }
  for (const r of rows) {
    if (!present.has(r.path.replace(/^\//, ''))) { await run(env, `DELETE FROM recordings WHERE key = ?`, r.key); removed += 1; }
  }
  return json({ added, removed, files: present.size });
}
