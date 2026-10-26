// Entry point. Every API path lives under /api; anything else is the admin UI (static assets).
import { authenticate, cleanup, requireAdmin, requireSuper } from './auth.js';
import { HttpError, errorResponse, json } from './http.js';
import { Router } from './router.js';
import * as admin from './routes/admin.js';
import * as auth from './routes/auth.js';
import * as pub from './routes/public.js';
import * as ws from './routes/workspace.js';
import { handleIvr } from './ivr/flow.js';
import { handleListen } from './ivr/listen.js';
import * as control from './routes/control.js';

const PUBLIC = { auth: 'none' };
const ADMIN = { auth: 'admin' };
const SUPER = { auth: 'super' };

export const router = new Router()
  // public
  .get('/health', pub.health, PUBLIC)
  .get('/public/catalog', pub.catalog, PUBLIC)
  .get('/public/synagogues', pub.synagogues, PUBLIC)
  .get('/public/synagogues/:id', pub.synagogue, PUBLIC)
  .get('/public/minyanim', pub.minyanim, PUBLIC)
  // Yemot HaMashiach phone extension (own key check; always answers in Yemot format)
  .get('/ivr', handleIvr, PUBLIC)
  .post('/ivr', handleIvr, PUBLIC)
  // public listening line (anonymous)
  .get('/ivr/listen', handleListen, PUBLIC)
  .post('/ivr/listen', handleListen, PUBLIC)
  // session
  .post('/auth/login', auth.postLogin, PUBLIC)
  .get('/auth/options', auth.getOptions, PUBLIC)
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
  .get('/me/feedback', control.myFeedback)
  .post('/me/feedback', control.sendFeedback)
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
  // admin
  .get('/admin/stats', admin.stats, ADMIN)
  .get('/admin/ivr', admin.getIvr, ADMIN)
  .post('/admin/ivr/rotate', admin.rotateIvrKey, ADMIN)
  .get('/admin/synagogues', admin.listSynagogues, ADMIN)
  .post('/admin/synagogues', admin.createSynagogue, ADMIN)
  .get('/admin/synagogues/:id', admin.getSynagogue, ADMIN)
  .patch('/admin/synagogues/:id', admin.patchSynagogue, ADMIN)
  .delete('/admin/synagogues/:id', admin.deleteSynagogue, ADMIN)
  .get('/admin/users', admin.listUsers, ADMIN)
  .post('/admin/users', admin.createUser, ADMIN)
  .patch('/admin/users/:id', admin.patchUser, ADMIN)
  .delete('/admin/users/:id', admin.deleteUser, ADMIN)
  .get('/admin/catalog/:kind', admin.listCatalog, ADMIN)
  .post('/admin/catalog/:kind', admin.createCatalog, ADMIN)
  .patch('/admin/catalog/:kind/:id', admin.patchCatalog, ADMIN)
  .delete('/admin/catalog/:kind/:id', admin.deleteCatalog, ADMIN)
  // super admin
  .get('/admin/control', control.getControl, SUPER)
  .patch('/admin/control', control.patchControl, SUPER)
  .post('/admin/control/test-mail', control.testMail, SUPER)
  .post('/admin/users/:id/welcome', admin.sendWelcome, ADMIN)
  .get('/admin/feedback', control.listFeedback, SUPER)
  .patch('/admin/feedback/:id', control.patchFeedback, SUPER)
  .delete('/admin/feedback/:id', control.deleteFeedback, SUPER);

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
};
