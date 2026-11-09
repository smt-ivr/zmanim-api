// Yemot HaMashiach "type=api" extension: Friday-evening times of the synagogue in Safed,
// relative to candle lighting by the Itim LeBina calendar. Self-contained: no database,
// no imports from outside this folder, so it can move to its own Worker as is.
import { CANDLE_MINUTES, CANDLE_OVERRIDES, CORRECTION_SECONDS, ITEMS, PLACE } from './config.js';
import { sunset } from './sun.js';

/** Today's civil date and weekday in Israel. */
function israelToday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: PLACE.tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** The coming Friday (today, if today is Friday). On Shabbat: next week's. */
export function comingFriday(now = new Date()) {
  const t = israelToday(now);
  const add = (5 - t.dow + 7) % 7;
  const dt = new Date(Date.UTC(t.y, t.m - 1, t.d + add));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const pad = (n) => String(n).padStart(2, '0');

/** Candle lighting on a date as minutes after midnight (Israel time), rounded down like the calendar. */
export function candleLighting({ y, m, d }, candleMinutes = CANDLE_MINUTES) {
  const key = `${y}-${pad(m)}-${pad(d)}`;
  if (CANDLE_OVERRIDES[key]) { const [h, mi] = CANDLE_OVERRIDES[key].split(':').map(Number); return h * 60 + mi; }
  const ms = sunset(y, m, d, PLACE) + CORRECTION_SECONDS * 1000 - candleMinutes * 60000;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: PLACE.tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return +p.hour * 60 + +p.minute;
}

/** "16 12", "16 ו 5 דקות", "17" — how the phone says a time. */
function speak(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (m === 0) return String(h);
  if (m < 10) return `${h} ו ${m} דקות`;
  return `${h} ${m}`;
}

/** Yemot treats these as syntax inside a message. */
const clean = (s) => String(s).replace(/[.\-"'&|=׳״,]/g, ' ').replace(/\s+/g, ' ').trim();

const int = (v) => (v != null && /^-?\d{1,3}$/.test(v.trim()) ? Number(v) : null);

/**
 * What to say, from the defaults in config.js and the link's parameters:
 *   kollel=30 / minha=0  minutes before candle lighting (negative = after; "off" = don't say)
 *   items=שם:דקות;שם:דקות  replaces the whole list (same minutes rule)
 *   candle=30            candle lighting, minutes before sunset from elevation
 *   say_candles=1        also say the candle-lighting time first
 */
export function settings(params = new URLSearchParams()) {
  let items;
  if (params.get('items')) {
    items = params.get('items').split(/[;\n]/).map((part) => {
      const i = part.lastIndexOf(':');
      return i > 0 ? { name: part.slice(0, i).trim(), before: int(part.slice(i + 1)) } : null;
    }).filter((it) => it?.name && it.before != null);
  } else {
    items = ITEMS.map((it) => {
      const v = params.get(it.key);
      return { name: it.name, before: v === 'off' ? null : (int(v) ?? it.before) };
    }).filter((it) => it.before != null);
  }
  return { items, candle: int(params.get('candle')) ?? CANDLE_MINUTES, sayCandles: params.get('say_candles') === '1' };
}

export function message(now = new Date(), params) {
  const { items, candle, sayCandles } = settings(params);
  const candles = candleLighting(comingFriday(now), candle);
  const lines = items.map((it) => `${it.name} בשעה ${speak(candles - it.before)}`);
  if (sayCandles) lines.unshift(`הדלקת נרות בשעה ${speak(candles)}`);
  if (!lines.length) lines.push('אין זמנים להשמעה');
  return 'id_list_message=' + lines.map((l) => `t-${clean(l)}`).join('.') + '&';
}

/** Handles every request: Yemot calls GET (or POST) and expects plain text. */
export function handle(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('hangup') === 'yes') return new Response('', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(message(new Date(), url.searchParams), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Standalone Worker entry, for when this folder becomes its own project. */
export default { fetch: handle };
