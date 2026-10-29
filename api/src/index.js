// Entry point. Every API path lives under /api; anything else is the admin UI (static assets).
import { authenticate, cleanup, requireAdmin, requirePerm, requireSuper } from './auth.js';
import { HttpError, errorResponse, json } from './http.js';
import { Router } from './router.js';
import * as admin from './routes/admin.js';
import * as auth from './routes/auth.js';
import * as pub from './routes/public.js';
import * as ws from './routes/workspace.js';
import { handleIvr } from './ivr/flow.js';
import { handleListen } from './ivr/listen.js';
import * as control from './routes/control.js';
import * as reg from './routes/registrations.js';
import * as security from './routes/security.js';
import * as messages from './routes/messages.js';
import { handleEmail } from './routes/messages.js';
import { serveFile } from './files.js';
import * as phoneActivity from './routes/phoneActivity.js';
import * as recordings from './routes/recordings.js';

const PUBLIC = { auth: 'none' };
const ADMIN = { auth: 'admin' };
const SUPER = { auth: 'super' };
const perm = (p) => ({ auth: 'admin', perm: p });
const ALLOWED_BEFORE_NEW_PASSWORD = new Set(['GET /me', 'PUT /me/password', 'POST /auth/logout']);

export const router = new Router()
  // public
  .get('/health', pub.health, PUBLIC)
  .get('/public/catalog', pub.catalog, PUBLIC)
  .get('/public/synagogues', pub.synagogues, PUBLIC)
  .get('/public/synagogues/:id', pub.synagogue, PUBLIC)
  .get('/public/minyanim', pub.minyanim, PUBLIC)
  .get('/o/:token', messages.opened, PUBLIC) // e-mail opened (tracking image)
  .get('/f/:token', serveFile, PUBLIC) // a file attached to a message (by its unguessable link)
  // self-service synagogue registration
  .get('/public/registrations/form', reg.form, PUBLIC)
  .post('/public/registrations', reg.submit, PUBLIC)
  .post('/public/registrations/verify', reg.verify, PUBLIC)
  // Yemot HaMashiach phone extension (own key check; always answers in Yemot format)
  .get('/ivr', handleIvr, PUBLIC)
  .post('/ivr', handleIvr, PUBLIC)
  // public listening line (anonymous)
  .get('/ivr/listen', handleListen, PUBLIC)
  .post('/ivr/listen', handleListen, PUBLIC)
  .get('/ivr/file-error', recordings.fileError, PUBLIC) // Yemot: a file failed to play (own key check)
  .post('/ivr/file-error', recordings.fileError, PUBLIC)
  // session
  .post('/auth/login', auth.postLogin, PUBLIC)
  .get('/auth/options', auth.getOptions, PUBLIC)
  .post('/auth/google', auth.postGoogle, PUBLIC)
  .post('/auth/email-link', auth.postEmailLink, PUBLIC)
  .post('/auth/email-link/verify', auth.postEmailLinkVerify, PUBLIC)
  .post('/auth/reset-request', auth.postResetRequest, PUBLIC)
  .post('/auth/reset', auth.postReset, PUBLIC)
  .post('/auth/logout', auth.postLogout)
  .get('/me', auth.getMe)
  .patch('/me', auth.patchMe)
  .put('/me/password', auth.putPassword)
  .put('/me/phone-password', auth.putPhonePassword)
  .get('/me/logins', auth.getLogins)
  .get('/me/messages', messages.myMessages)
  .post('/me/messages', messages.sendMyMessage)
  // synagogue workspace (manager of the synagogue, or admin)
  .get('/synagogues', ws.list)
  .get('/synagogues/:sid', ws.get)
  .patch('/synagogues/:sid', ws.patch)
  .post('/synagogues/:sid/locations', ws.createLocation)
  .put('/synagogues/:sid/locations/order', ws.orderLocations)
  .patch('/synagogues/:sid/locations/:id', ws.patchLocation)
  .delete('/synagogues/:sid/locations/:id', ws.deleteLocation)
  .post('/synagogues/:sid/minyanim', ws.createMinyan)
  .patch('/synagogues/:sid/minyanim/:id', ws.patchMinyan)
  .delete('/synagogues/:sid/minyanim/:id', ws.deleteMinyan)
  .post('/synagogues/:sid/minyanim/:id/duplicate', ws.duplicateMinyan)
  .post('/synagogues/:sid/seasons/copy', ws.copySeasonRoute)
  .get('/synagogues/:sid/log', ws.log)
  .get('/synagogues/:sid/recording', recordings.synagogueRecording)
  // admin
  .get('/admin/stats', admin.stats, ADMIN)
  .get('/admin/ivr', admin.getIvr, perm('phone'))
  .post('/admin/ivr/rotate', admin.rotateIvrKey, perm('phone'))
  .get('/admin/phone-activity', phoneActivity.activity, perm('phone'))
  .get('/admin/phone-activity/:id', phoneActivity.call, perm('phone'))
  .delete('/admin/phone-activity/:id', phoneActivity.remove, SUPER)
  .get('/admin/synagogues', admin.listSynagogues, ADMIN)
  .post('/admin/synagogues', admin.createSynagogue, perm('synagogues'))
  .get('/admin/synagogues/:id', admin.getSynagogue, ADMIN)
  .patch('/admin/synagogues/:id', admin.patchSynagogue, perm('synagogues'))
  .delete('/admin/synagogues/:id', admin.deleteSynagogue, perm('synagogues_delete'))
  .post('/admin/synagogues/:id/managers', admin.addManager, perm('managers'))
  .delete('/admin/synagogues/:id/managers/:uid', admin.removeManager, perm('managers'))
  .get('/admin/users', admin.listUsers, ADMIN)
  .post('/admin/users', admin.createUser, ADMIN)
  .patch('/admin/users/:id', admin.patchUser, ADMIN)
  .delete('/admin/users/:id', admin.deleteUser, ADMIN)
  .get('/admin/users/:id/history', admin.userHistory, ADMIN)
  .delete('/admin/users/:id/history', admin.clearUserHistory, SUPER)
  .delete('/admin/log/:id', admin.deleteLogEntry, SUPER)
  .delete('/admin/logins/:id', admin.deleteLoginEntry, SUPER)
  .post('/admin/seasons/copy', admin.copySeasonAll, perm('catalog'))
  .get('/admin/registrations', reg.list, perm('registrations'))
  .post('/admin/registrations/:id/approve', reg.approve, perm('registrations'))
  .post('/admin/registrations/:id/reject', reg.reject, perm('registrations'))
  .delete('/admin/registrations/:id', reg.remove, perm('registrations'))
  .post('/admin/registrations/:id/resend', reg.resend, perm('registrations'))
  .post('/admin/registrations/:id/verify', reg.verifyByHand, perm('registrations'))
  .post('/admin/registrations/:id/block', reg.block, perm('registrations'))
  .get('/admin/catalog/:kind', admin.listCatalog, ADMIN)
  .post('/admin/catalog/:kind', admin.createCatalog, perm('catalog'))
  .patch('/admin/catalog/:kind/:id', admin.patchCatalog, perm('catalog'))
  .delete('/admin/catalog/:kind/:id', admin.deleteCatalog, perm('catalog'))
  // super admin
  .get('/admin/control', control.getControl, SUPER)
  .patch('/admin/control', control.patchControl, SUPER)
  .post('/admin/control/test-mail', control.testMail, SUPER)
  .post('/admin/users/:id/welcome', admin.sendWelcome, ADMIN)
  .get('/admin/locks', security.list, SUPER)
  .post('/admin/locks', security.lock, SUPER)
  .delete('/admin/locks', security.unlock, SUPER)
  .post('/admin/users/:id/unlock', security.unlockUser, perm('managers'))
  .get('/admin/recordings', recordings.list, SUPER)
  .get('/admin/recordings/synagogues', recordings.synagogues, SUPER)
  .patch('/admin/recordings/settings', recordings.patchSettings, SUPER)
  .post('/admin/recordings/test', recordings.test, SUPER)
  .post('/admin/recordings/sync', recordings.sync, SUPER)
  .post('/admin/recordings/:key', recordings.upload, SUPER)
  .patch('/admin/recordings/:key', recordings.setPaused, SUPER)
  .delete('/admin/recordings/:key', recordings.remove, SUPER)
  .get('/admin/recordings/:key/audio', recordings.audio, SUPER)
  .get('/admin/email-log', messages.emailLog, SUPER)
  .get('/admin/conversations', messages.listConversations, SUPER)
  .get('/admin/broadcasts', messages.listBroadcasts, SUPER)
  .get('/admin/broadcasts/recipients', messages.broadcastRecipients, SUPER)
  .post('/admin/broadcasts', messages.sendBroadcast, SUPER)
  .post('/admin/conversations', messages.startConversation, SUPER)
  .get('/admin/conversations/:id', messages.getConversation, SUPER)
  .post('/admin/conversations/:id/messages', messages.answer, SUPER)
  .patch('/admin/conversations/:id', messages.patchConversation, SUPER)
  .delete('/admin/conversations/:id', messages.deleteConversation, SUPER);

function cors(env, request) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': allowed.length ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function handleApi(request, env, path) {
  const url = new URL(request.url);
  const found = router.match(request.method, path);
  if (!found) throw new HttpError(404, 'NOT_FOUND', 'נתיב לא קיים');
  if (found.allowed) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'שיטה לא נתמכת בנתיב זה');

  const { route, params } = found;
  const ctx = { env, request, url, params, actor: null };
  if (route.options.auth !== 'none') {
    ctx.actor = await authenticate(env, request);
    if (route.options.auth === 'admin') requireAdmin(ctx.actor);
    if (route.options.auth === 'super') requireSuper(ctx.actor);
    if (route.options.perm) requirePerm(ctx.actor, route.options.perm);
    // Admins edit a synagogue's minyanim, locations and details only with the 'minyanim' permission
    // (its own managers always can).
    if (ctx.actor.role === 'admin' && request.method !== 'GET' && /^\/synagogues\/\d+\//.test(path + '/')) requirePerm(ctx.actor, 'minyanim');
    // A user who must choose a new password can do only that (and see who they are, or log out).
    if (ctx.actor.must_change_password && !ALLOWED_BEFORE_NEW_PASSWORD.has(`${request.method} ${path}`)) {
      throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'יש לבחור סיסמה חדשה לפני שממשיכים');
    }
  }
  return route.handler(ctx);
}

/**
 * The app can live under a path prefix (BASE_PATH, e.g. "/zmanim" for smti.uk/zmanim) and at the
 * root (workers.dev) at the same time. Returns the path without the prefix, or a redirect.
 */
function stripBase(env, url) {
  const base = (env.BASE_PATH || '').replace(/\/$/, '');
  if (!base) return { path: url.pathname };
  if (url.pathname === base) return { redirect: `${url.origin}${base}/${url.search}` };
  if (url.pathname.startsWith(base + '/')) return { path: url.pathname.slice(base.length) };
  return { path: url.pathname };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { path, redirect } = stripBase(env, url);
    if (redirect) return Response.redirect(redirect, 301);

    if (path === '/admin') return Response.redirect(`${url.origin}${(env.BASE_PATH || '').replace(/\/$/, '')}/admin/${url.search}`, 301);
    if (!path.startsWith('/api/') && path !== '/api') {
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      const assetUrl = new URL(url);
      assetUrl.pathname = path;
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    const headers = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    let response;
    try {
      response = await handleApi(request, env, path.slice(4) || '/');
    } catch (err) {
      if (err instanceof HttpError) response = errorResponse(err);
      else {
        const ref = crypto.randomUUID().slice(0, 8);
        console.error(`[${ref}] ${request.method} ${url.pathname}`, err?.stack || err);
        response = json({ error: { code: 'INTERNAL', message: `שגיאת שרת (קוד ${ref})` } }, 500);
      }
    }
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    if (!out.headers.has('Cache-Control')) out.headers.set('Cache-Control', 'no-store');
    return out;
  },

  async scheduled(_event, env) {
    await cleanup(env);
  },

  // Cloudflare Email Routing: mail to the inbound address (e.g. zmanim@smti.uk) becomes a chat message.
  async email(message, env) {
    try { await handleEmail(message, env); } catch (err) { console.error('[email]', err?.stack || err); }
  },
};
