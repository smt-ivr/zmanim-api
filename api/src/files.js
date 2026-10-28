// Files attached to chat messages, kept in R2 (binding FILES, bucket shared with other SMT projects,
// under zmanim/chat/). Each file opens by an unguessable link (/api/f/<token>), so it works in an
// <img>, in a new tab and from an e-mail; only the two sides of the conversation get the link.
import { all, run } from './db.js';
import { HttpError } from './http.js';

export const MAX_FILE = 10 * 1024 * 1024; // per file (e-mail providers refuse bigger attachments)
export const MAX_FILES = 5; // per message
const PREFIX = 'zmanim/chat/';

// Shown in the browser; anything else downloads, so an HTML/SVG file never runs under the site's address.
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/;
const BLOCKED = /\.(exe|msi|bat|cmd|com|scr|pif|vbs|vbe|js|jse|wsf|wsh|ps1|psm1|jar|reg|lnk|hta|cpl|dll|apk|app|dmg|sh)$/i;
const EXT = {
  pdf: 'application/pdf', txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const filesReady = (env) => Boolean(env.FILES?.put);

export const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

function cleanName(name) {
  const n = String(name || 'file').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || 'file';
  if (n.length <= 120) return n;
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : '';
  return n.slice(0, 120 - ext.length) + ext;
}

function typeOf(type, name) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (/^[\w.+-]+\/[\w.+-]+$/.test(t) && t !== 'application/octet-stream') return t;
  return EXT[String(name).toLowerCase().split('.').pop()] || 'application/octet-stream';
}

/** Checks files before anything is saved (size, count, kind). files: [{ name, type, size }] */
export function checkFiles(env, files) {
  if (!files.length) return;
  if (!filesReady(env)) throw new HttpError(503, 'NO_STORAGE', 'שמירת קבצים אינה זמינה כרגע');
  if (files.length > MAX_FILES) throw new HttpError(422, 'TOO_MANY_FILES', `אפשר לצרף עד ${MAX_FILES} קבצים להודעה`);
  for (const f of files) {
    if (!f.size) throw new HttpError(422, 'EMPTY_FILE', `הקובץ ${cleanName(f.name)} ריק`);
    if (f.size > MAX_FILE) throw new HttpError(413, 'FILE_TOO_BIG', `הקובץ ${cleanName(f.name)} גדול מדי (עד ${MAX_FILE / 1024 / 1024}MB)`);
    if (BLOCKED.test(f.name || '')) throw new HttpError(422, 'FILE_KIND', `לא ניתן לצרף קבצי הרצה (${cleanName(f.name)})`);
  }
}

/** Saves files of a message. files: [{ name, type, size, data }] (data: File, Blob, ArrayBuffer or Uint8Array). */
export async function saveFiles(env, conversationId, messageId, files) {
  for (const f of files) {
    const name = cleanName(f.name);
    const type = typeOf(f.type, name);
    const key = `${PREFIX}${conversationId}/${Date.now()}-${crypto.randomUUID()}`;
    await env.FILES.put(key, f.data?.stream ? f.data.stream() : f.data, { httpMetadata: { contentType: type } });
    await run(env, `INSERT INTO message_files (message_id, conversation_id, key, name, type, size, token) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      messageId, conversationId, key, name, type, f.size, newToken());
  }
}

/** Stores files once for many messages (a broadcast). Returns [{ key, name, type, size }] to link to each message. */
export async function storeShared(env, files) {
  const out = [];
  for (const f of files) {
    const name = cleanName(f.name);
    const type = typeOf(f.type, name);
    const key = `${PREFIX}broadcast/${Date.now()}-${crypto.randomUUID()}`;
    await env.FILES.put(key, f.data?.stream ? f.data.stream() : f.data, { httpMetadata: { contentType: type } });
    out.push({ key, name, type, size: f.size });
  }
  return out;
}

/** { messageId: [{ id, name, type, size, url }] } for the messages of a conversation. */
export async function filesOf(env, conversationId) {
  const rows = await all(env, `SELECT id, message_id, name, type, size, token FROM message_files WHERE conversation_id = ? ORDER BY id`, conversationId);
  const out = {};
  for (const r of rows) (out[r.message_id] ||= []).push(shown(r));
  return out;
}

export const shown = (r) => ({ id: r.id, name: r.name, type: r.type, size: r.size, url: `api/f/${r.token}` });

/** Removes the stored files of conversations (before the rows go). */
export async function removeConversationFiles(env, conversationIds) {
  if (!filesReady(env) || !conversationIds.length) return;
  const marks = conversationIds.map(() => '?').join(',');
  // a file sent to many (a broadcast) is stored once: keep it while other conversations still have it
  const rows = await all(env, `SELECT DISTINCT key FROM message_files f WHERE conversation_id IN (${marks})
    AND NOT EXISTS (SELECT 1 FROM message_files g WHERE g.key = f.key AND g.conversation_id NOT IN (${marks}))`, ...conversationIds, ...conversationIds);
  for (let i = 0; i < rows.length; i += 900) await env.FILES.delete(rows.slice(i, i + 900).map((r) => r.key)).catch((e) => console.error('[files] delete', e));
}

/** The files of a message as e-mail attachments (base64), as Resend takes them. */
export async function mailAttachments(env, messageId) {
  if (!filesReady(env)) return [];
  const out = [];
  for (const r of await all(env, `SELECT key, name FROM message_files WHERE message_id = ? ORDER BY id`, messageId)) {
    const obj = await env.FILES.get(r.key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push({ filename: r.name, content: btoa(bin) });
  }
  return out;
}

/** GET /f/:token — the file itself. */
export async function serveFile({ env, params }) {
  const t = String(params.token || '').replace(/\W/g, '').slice(0, 64);
  const row = t && filesReady(env) ? await all(env, `SELECT key, name, type FROM message_files WHERE token = ?`, t).then((r) => r[0]) : null;
  const obj = row && (await env.FILES.get(row.key));
  if (!obj) throw new HttpError(404, 'NOT_FOUND', 'הקובץ לא נמצא');
  const inline = INLINE.test(row.type);
  return new Response(obj.body, {
    headers: {
      'Content-Type': inline ? row.type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
