// Public listening line: anyone can call and hear today's minyan times.
// Area (or 0 = all) -> prayer (or 0 = everything soon) -> from what time (0 = from now, 00 = the whole day).
// Minyanim set relative to sunrise / sunset are spoken as set, but placed (and filtered) by today's computed time.
// Each minyan is one short sentence: "מנחה בשעה 13 30 באהל משה בעזרת נשים".
// No identification; uses the same engine as the management line.
import { all } from '../db.js';
import { MINYAN_ORDER, MINYAN_SELECT } from '../minyan.js';
import { currentSeason, getSettings, isRoshChodesh, visibleDays } from '../settings.js';
import { callStore, chosenIndex, go, goodbye, invalid, listChoice, menu, number, readParams, reply, runCall } from './engine.js';
import { speakClock, text } from './yemot.js';
import { CALCS, israelDate, placeOf, zmanTime } from '../zmanim.js';

const PAGE = 8;

export async function handleListen({ env, request, url }) {
  try {
    const params = await readParams(request, url);
    const settings = await getSettings(env);
    if (params.hangup !== 'yes' && !settings.listen_enabled) return reply(goodbye([text('קו השמיעה אינו פעיל כרגע')]));
    const store = callStore(env, 'ivr_listen_calls');
    const flow = { ...store, screens: SCREENS, start, recover: (c) => go(c, 'main') };
    return reply(await runCall(env, params, flow, { settings, store }));
  } catch (err) {
    console.error('[ivr-listen]', err?.stack || err);
    return reply(goodbye([text('אירעה תקלה, נסו שוב מאוחר יותר')]));
  }
}

/** Day of week (0 = Sunday), minutes since midnight and Rosh Chodesh, in Israel. `env.FIXED_NOW` pins the clock in tests. */
function israelNow(env) {
  const date = env.FIXED_NOW ? new Date(env.FIXED_NOW) : new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    roshChodesh: isRoshChodesh(date),
    date: israelDate(date),
  };
}
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

async function start(c) {
  await c.store.prune();
  c.say.push(text(`שלום וברוכים הבאים ל${c.settings.system_name}`));
  const areas = await all(c.env, `SELECT id FROM areas`);
  return areas.length > 1 ? go(c, 'area') : go(c, 'main', { area: null });
}

/** Today's active public minyanim (current season), optionally one area / prayer. */
async function todaysMinyanim(c, now, prayerId) {
  const where = ['m.is_active = 1', 's.is_active = 1', '(m.days & ?) != 0', 'm.season_id = ?'];
  const params = [1 << now.day, (await currentSeason(c.env))?.id ?? 0];
  if (c.state.data.area) (where.push('s.area_id = ?'), params.push(c.state.data.area));
  if (prayerId) (where.push('m.prayer_id = ?'), params.push(prayerId));
  const rows = await all(
    c.env,
    `${MINYAN_SELECT.replace('FROM minyanim m', 'FROM minyanim m JOIN synagogues s ON s.id = m.synagogue_id')
      .replace('SELECT m.*,', 'SELECT m.*, s.name AS synagogue_name,')} WHERE ${where.join(' AND ')} ${MINYAN_ORDER}`,
    ...params
  );
  return rows.filter((r) => visibleDays(r.days, c.settings) & (1 << now.day));
}

/**
 * One sentence per minyan starting at `from` or later, in time order. The Rosh Chodesh time is used only
 * on Rosh Chodesh; an interval minyan gives one sentence per start; a minyan relative to a computed time
 * of day (sunset, ...) is placed by today's time but spoken as set. Relative to an anchor that is not computed: last.
 */
function sentences(rows, now, from, place) {
  const zman = (kind) => (CALCS[kind] ? zmanTime(now.date, kind, place) : null);
  const where = (r) => `ב${r.synagogue_name}${r.location_name ? ` ב${r.location_name}` : ''}`;
  // Relative minyanim are spoken as set ("15 דקות לפני שקיעה"); today's computed time only places them in order.
  const relativeWords = (r) => {
    const n = Math.abs(r.offset_minutes);
    return n ? `${n} דקות ${r.offset_minutes < 0 ? 'לפני' : 'אחרי'} ${r.anchor_name}` : `ב${r.anchor_name}`;
  };
  const timed = [];
  const relative = [];
  for (const r of rows) {
    if (r.time_kind === 'fixed') {
      const t = toMinutes(now.roshChodesh && r.rosh_chodesh_time ? r.rosh_chodesh_time : r.time);
      if (t >= from) timed.push({ t, r });
    } else if (r.time_kind === 'interval') {
      for (let t = toMinutes(r.time); t <= toMinutes(r.end_time); t += r.every_minutes) if (t >= from) timed.push({ t, r });
    } else if (zman(r.anchor_calc)) {
      const base = zman(r.anchor_calc);
      const t = toMinutes(base) + (r.offset_minutes || 0);
      if (t >= from) timed.push({ t, r, words: relativeWords(r) });
    } else {
      relative.push(`${r.prayer_name} ${relativeWords(r)} ${where(r)}`);
    }
  }
  timed.sort((a, b) => a.t - b.t);
  return [...timed.map(({ t, r, words }) => `${r.prayer_name} ${words ?? `בשעה ${speakClock(hhmm(t))}`} ${where(r)}`), ...relative];
}

/** Reads one page and keeps the rest for "continue". */
function speakPage(c) {
  const rest = c.state.data.rest;
  rest.splice(0, PAGE).forEach((s) => c.say.push(text(s)));
  return rest.length ? go(c, 'more') : go(c, 'main');
}

async function list(c, prayerId, from) {
  const now = israelNow(c.env);
  if (now.day === 6 && !c.settings.shabbat_enabled) {
    c.say.push(text('אין מניינים להשמעה היום'));
    return go(c, 'main');
  }
  const start = from ?? now.minutes;
  const rest = sentences(await todaysMinyanim(c, now, prayerId), now, start, placeOf(c.settings));
  if (!rest.length) {
    c.say.push(text(from === null ? 'אין מניינים נוספים היום' : from === 0 ? 'אין מניינים היום' : `אין מניינים מהשעה ${speakClock(hhmm(start))}`));
    return go(c, 'main');
  }
  if (now.roshChodesh) c.say.push(text('היום ראש חודש'));
  c.state.data.rest = rest;
  return speakPage(c);
}

/** "730" / "0730" -> 450 minutes; "7" / "07" -> a whole hour. Null when not a time. */
function parseClock(input) {
  if (!/^\d{1,4}$/.test(input)) return null;
  const [h, m] = input.length <= 2 ? [Number(input), 0] : [Number(input.slice(0, -2)), Number(input.slice(-2))];
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

const SCREENS = {
  area: {
    back: null,
    async prompt(c) {
      const areas = await all(c.env, `SELECT id, name FROM areas ORDER BY sort, name`);
      c.state.data.areas = areas.map((a) => a.id);
      return listChoice(c, 'בחירת אזור', areas, (a) => a.name, { zero: 'כל האזורים', star: false });
    },
    handle(c, input) {
      const i = chosenIndex(input, c.state.data.areas, { zero: true });
      if (i === null) return invalid(c);
      return go(c, 'main', { area: i === -1 ? null : c.state.data.areas[i] });
    },
  },

  main: {
    back: (c) => (c.state.data.areas?.length > 1 ? go(c, 'area') : { end: true }),
    async prompt(c) {
      const prayers = await all(c.env, `SELECT id, name FROM prayers ORDER BY sort, id`);
      c.state.data.prayers = prayers.map((p) => p.id);
      return listChoice(c, 'בחירת תפילה', prayers, (p) => p.name, { zero: 'כל המניינים הקרובים', star: c.state.data.areas?.length > 1 });
    },
    handle(c, input) {
      const i = chosenIndex(input, c.state.data.prayers, { zero: true });
      if (i === null) return invalid(c);
      if (i === -1) return list(c, null, null);
      return go(c, 'time', { prayerId: c.state.data.prayers[i] });
    },
  },

  time: {
    back: 'main',
    prompt: () => number(['הקישו שעה וסולמית', 'אפשר להקיש גם דקות, אבל לא חובה', 'למניינים הקרובים הקישו 0 וסולמית', 'לכל המניינים של היום מההתחלה הקישו 0 0 וסולמית'], { max: 4 }),
    handle(c, input) {
      if (input === '0') return list(c, c.state.data.prayerId, null);
      if (input === '00') return list(c, c.state.data.prayerId, 0);
      const from = parseClock(input);
      return from === null ? invalid(c) : list(c, c.state.data.prayerId, from);
    },
  },

  more: {
    back: 'main',
    prompt: (c) => menu(c, '', [['1', 'המשך'], ['2', 'בחירת תפילה']], { star: false }),
    handle(c, input) {
      if (input === '1') return speakPage(c);
      if (input === '2') return go(c, 'main');
      return invalid(c);
    },
  },
};
