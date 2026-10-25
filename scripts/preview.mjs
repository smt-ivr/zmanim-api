// Local preview without wrangler: serves ./web (public site + /admin/) and runs the API on an in-memory database.
//   node scripts/preview.mjs [port]      then open http://localhost:8787/zmanim/
// Demo admin: 0500000000 (or admin@example.com) / password: preview
// Data is lost when the process stops. For a real local D1 use `npm run dev`.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../api/src/auth.js';
import worker from '../api/src/index.js';
import { D1Shim } from '../api/test/d1-shim.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const port = Number(process.argv[2] || 8787);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const ASSETS = {
  async fetch(request) {
    const path = normalize(decodeURIComponent(new URL(request.url).pathname)).replace(/^(\.\.[/\\])+/, '');
    for (const file of [join(root, path), join(root, 'index.html')]) {
      try {
        const body = await readFile(file.endsWith('/') || file === root ? join(file, 'index.html') : file);
        return new Response(body, { headers: { 'Content-Type': TYPES[extname(file)] || 'text/html; charset=utf-8' } });
      } catch { /* try next */ }
    }
    return new Response('Not found', { status: 404 });
  },
};

const env = { DB: new D1Shim(), ASSETS, BASE_PATH: '/zmanim' };
await env.DB.prepare(`INSERT INTO users (name, email, phone, password_hash, role, is_super) VALUES ('מנהל הדגמה', 'admin@example.com', '0500000000', ?, 'admin', 1)`)
  .bind(await hashPassword('preview')).run();
// Demo content so the public site has something to show
await env.DB.batch([
  `INSERT INTO areas (name, sort) VALUES ('רמות', 10), ('גבעת שאול', 20), ('הר נוף', 30)`,
  `INSERT INTO synagogues (name, area_id, address) VALUES ('אהל משה', 1, 'רחוב הרב פרנק 12'), ('בית יעקב', 1, 'שדרות גולדה מאיר 40'), ('זכרון משה', 2, 'רחוב קוטלר 5'), ('היכל שלמה', 3, 'רחוב הקבלן 30')`,
  `INSERT INTO locations (synagogue_id, name, sort) VALUES (1, 'היכל ראשי', 10), (1, 'בית מדרש', 20)`,
  `INSERT INTO minyanim (synagogue_id, prayer_id, location_id, days, time_kind, time, notes) VALUES
     (1, 1, 1, 127, 'fixed', '06:15', 'ותיקין'), (1, 1, 2, 63, 'fixed', '07:30', ''), (1, 3, 1, 31, 'fixed', '21:45', ''),
     (2, 1, NULL, 127, 'fixed', '06:45', ''), (2, 1, NULL, 31, 'fixed', '08:00', ''), (3, 1, NULL, 127, 'fixed', '07:00', ''),
     (3, 3, NULL, 127, 'fixed', '20:30', ''), (4, 1, NULL, 64, 'fixed', '08:30', 'שבת'), (4, 3, NULL, 31, 'fixed', '22:15', '')`,
  `INSERT INTO minyanim (synagogue_id, prayer_id, days, time_kind, anchor_id, offset_minutes) VALUES
     (1, 2, 31, 'relative', 2, -15), (2, 2, 127, 'relative', 2, -20), (3, 2, 31, 'relative', 2, -10), (4, 3, 127, 'relative', 3, 0)`,
].map((sql) => env.DB.prepare(sql)));

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`preview on http://localhost:${port}/zmanim/  (login 0500000000 / preview)`));
