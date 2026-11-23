// The time window in which a caller may update a limited number of times (link parameter `per`).
//   day | week | month   calendar day / week (from Sunday) / month, Israel time   (default: week — once per Shabbat)
//   ever                 the whole time (times=1&per=ever: once, ever)
//   90m | 12h | 3d       a rolling window: the last 90 minutes / 12 hours / 3 days
import { TZ } from './data.js';

export function parsePer(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (['day', 'week', 'month', 'ever'].includes(v)) return { kind: v };
  const m = /^(\d{1,4})([mhd])$/.exec(v);
  if (m && +m[1] > 0) return { kind: 'rolling', n: +m[1], unit: m[2] };
  return { kind: 'week' };
}

function parts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** Israel-time offset from UTC at an instant, in ms. */
function offset(ms) {
  const p = parts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Midnight (Israel time) of a local calendar date, as epoch ms. */
function localMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  return guess - offset(guess - offset(guess));
}

/** Start of the current window, epoch seconds. */
export function windowStart(per, nowMs = Date.now()) {
  if (per.kind === 'ever') return 0;
  if (per.kind === 'rolling') return Math.floor(nowMs / 1000) - per.n * { m: 60, h: 3600, d: 86400 }[per.unit];
  const p = parts(nowMs);
  if (per.kind === 'week') return localMidnight(p.y, p.m, p.d - p.dow) / 1000;
  if (per.kind === 'month') return localMidnight(p.y, p.m, 1) / 1000;
  return localMidnight(p.y, p.m, p.d) / 1000;
}

/** How the phone says the window: "היום", "השבוע", "ב 12 השעות האחרונות" ... ('' for ever). */
export function speakPer(per) {
  if (per.kind === 'day') return 'היום';
  if (per.kind === 'week') return 'השבוע';
  if (per.kind === 'month') return 'החודש';
  if (per.kind === 'ever') return '';
  const { n, unit } = per;
  if (unit === 'm') return n === 1 ? 'בדקה האחרונה' : `ב ${n} הדקות האחרונות`;
  if (unit === 'h') return n === 1 ? 'בשעה האחרונה' : `ב ${n} השעות האחרונות`;
  return n === 1 ? 'ביממה האחרונה' : `ב ${n} הימים האחרונים`;
}
