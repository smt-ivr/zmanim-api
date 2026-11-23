// "תוספת שבת": listeners enter how many minutes of tosefet Shabbat they take on (by phone, Yemot type=api), and it adds up;
// another extension only says how much they have accumulated, and an admin page shows it all.
// Self-contained: no imports from outside this folder, its own minutes_* tables, so it can move
// to its own Worker as is.
//
//   <prefix>/            admin page
//   <prefix>/api/...     admin JSON API
//   <prefix>/add         phone: add / change minutes
//   <prefix>/total       phone: hear the total
//   <prefix>/file-error/<key>  Yemot: a recording failed to play (api_send_webhook_error_link)
import { handleAdmin } from './admin.js';
import { init } from './data.js';
import { handleIvr } from './ivr.js';
import { fileError } from './recordings.js';
import { PAGE } from './ui.js';

/** `sub` is the path after this project's prefix ('' , '/', '/add', '/api/login' …). */
export async function handle(request, env, sub) {
  const url = new URL(request.url);
  if (sub === '') return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  if (sub === '/add' || sub === '/total') return handleIvr(request, env, sub.slice(1));
  if (sub.startsWith('/file-error/')) {
    await init(env);
    return fileError(request, env, sub.slice('/file-error/'.length));
  }
  if (sub.startsWith('/api/')) {
    await init(env);
    return handleAdmin(request, env, sub.slice(5));
  }
  if (sub === '/' || sub === '/index.html') {
    return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });
  }
  return new Response('Not found', { status: 404 });
}

/** Standalone Worker entry, for when this folder becomes its own project (served at the root). */
export default {
  fetch: (request, env) => {
    const path = new URL(request.url).pathname;
    return handle(request, env, path === '/' ? '/' : path.replace(/\/$/, '') || '/');
  },
};
