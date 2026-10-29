// Public listening line: anyone can call and hear today's minyan times.
// Area (or 0 = all) -> prayer (or 0 = everything soon) -> from what time (0 = from now, 00 = the whole day).
// Minyanim set relative to sunrise / sunset are spoken as set, but placed (and filtered) by today's computed time.
// One short sentence per time: "שחרית בשעה 8 וחצי בבית כנסת אהל משה ובבית כנסת זכרון משה".
// Every fixed sentence and name can be a recording in the administration's voice (voice.js).
// No identification; uses the same engine as the management line.
import { all } from '../db.js';
import { MINYAN_ORDER, MINYAN_SELECT } from '../minyan.js';
import { currentSeason, getSettings, isRoshChodesh, visibleDays } from '../settings.js';
import { callStore, chosenIndex, go, goodbye, invalid, number, readParams, reply, runCall } from './engine.js';
import { text } from './yemot.js';
import { CALCS, israelDate, placeOf, zmanTime } from '../zmanim.js';
import { callLog } from './callLog.js';
import { clockWords, loadVoice, placeWords } from './voice.js';
import { normalizePhone } from '../validate.js';

const PAGE = 8;

export async function handleListen({ env, request, url }) {
  let voice = null;
  try {
    const params = await readParams(request, url);
    const settings = await getSettings(env);
    voice = await loadVoice(env, settings);
    if (params.hangup !== 'yes' && !settings.listen_enabled) return reply(goodbye(voice.phrase('line_off')));
    const store = callStore(env, 'ivr_listen_calls');
    const flow = { ...store, screens: SCREENS, start, recover: (c) => go(c, 'main'), log: callLog(env, { line: 'listen', phone: normalizePhone(params.ApiPhone) || String(params.ApiPhone || '') }) };
    return reply(await runCall(env, params, flow, { settings, store, voice }));
  } catch (err) {
    console.error('[ivr-listen]', err?.stack || err);
    return reply(goodbye(voice ? voice.phrase('error') : [text('אירעה תקלה, נסו שוב מאוחר יותר')]));
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

async function start(c) {
  await c.store.prune();
  await c.log.prune();
  c.say.push(...c.voice.phrase('welcome'));
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
 * The minyanim from `from` on, in time order, as sentences ({ tts, parts }); minyanim of the same prayer
 * at exactly the same time make one sentence with all their places. The Rosh Chodesh time is used only
 * on Rosh Chodesh; an interval minyan gives one entry per start; a minyan relative to a computed time of
 * day (sunset, ...) is placed by today's time but spoken as set. Relative to an anchor that is not computed: last.
 * Returns { sentences, count } (count = minyanim).
 */
function sentences(rows, now, from, place) {
  const zman = (kind) => (CALCS[kind] ? zmanTime(now.date, kind, place) : null);
  const relativeWords = (r) => {
    const n = Math.abs(r.offset_minutes);
    return n ? `${n} דקות ${r.offset_minutes < 0 ? 'לפני' : 'אחרי'} ${r.anchor_name}` : `ב${r.anchor_name}`;
  };
  const entries = [];
  for (const r of rows) {
    if (r.time_kind === 'fixed') {
      const t = toMinutes(now.roshChodesh && r.rosh_chodesh_time ? r.rosh_chodesh_time : r.time);
      if (t >= from) entries.push({ t, r });
    } else if (r.time_kind === 'interval') {
      for (let t = toMinutes(r.time); t <= toMinutes(r.end_time); t += r.every_minutes) if (t >= from) entries.push({ t, r });
    } else if (zman(r.anchor_calc)) {
      const t = toMinutes(zman(r.anchor_calc)) + (r.offset_minutes || 0);
      if (t >= from) entries.push({ t, r, words: relativeWords(r) });
    } else {
      entries.push({ t: Infinity, r, words: relativeWords(r) });
    }
  }
  entries.sort((a, b) => a.t - b.t);
  // same prayer, same moment, said the same way -> one sentence
  const groups = [];
  for (const e of entries) {
    const key = `${e.r.prayer_id}|${e.t}|${e.words || ''}`;
    const g = groups.find((x) => x.key === key && x === groups.at(-1)) || groups.find((x) => x.key === key && x.t === e.t);
    if (g) g.items.push(e); else groups.push({ key, t: e.t, words: e.words, items: [e] });
  }
  return {
    count: entries.length,
    sentences: groups.map((g) => {
      const r = g.items[0].r;
      const prayer = { key: `prayer:${r.prayer_id}`, text: r.prayer_name };
      const when = g.words ? { tts: g.words, parts: [g.words] } : (() => { const w = clockWords(g.t); return { tts: `בשעה ${w.tts}`, parts: [{ key: 'sys:at', text: 'בשעה' }, ...w.parts] }; })();
      const places = g.items.map((e, i) => placeWords({ synagogueId: e.r.synagogue_id, synagogueName: e.r.synagogue_name, location: e.r.location_name }, i > 0));
      return { tts: [r.prayer_name, when.tts, ...places.map((p) => p.tts)].join(' '), parts: [prayer, ...when.parts, ...places.flatMap((p) => p.parts)] };
    }),
  };
}

/** Reads one page and keeps the rest for "continue". */
function speakPage(c) {
  const rest = c.state.data.rest;
  rest.splice(0, PAGE).forEach((s) => c.say.push(...c.voice.sentence(s)));
  return rest.length ? go(c, 'more') : go(c, 'main');
}

async function list(c, prayerId, from) {
  const now = israelNow(c.env);
  if (now.day === 6 && !c.settings.shabbat_enabled) {
    c.say.push(...c.voice.phrase('no_list_today'));
    return go(c, 'main');
  }
  const start = from ?? now.minutes;
  const { sentences: rest, count } = sentences(await todaysMinyanim(c, now, prayerId), now, start, placeOf(c.settings));
  await c.log?.search(c.callId, { area: c.state.data.area, prayer: prayerId, from, found: count }).catch((e) => console.error('[ivr] log', e));
  if (!rest.length) {
    if (from === null) c.say.push(...c.voice.phrase('none_more'));
    else if (from === 0) c.say.push(...c.voice.phrase('none_today'));
    else {
      const w = clockWords(start);
      c.say.push(...c.voice.sentence({ tts: `אין מניינים מהשעה ${w.tts}`, parts: [{ key: 'sys:none_from', text: 'אין מניינים מהשעה' }, ...w.parts] }));
    }
    return go(c, 'main');
  }
  if (now.roshChodesh) c.say.push(...c.voice.phrase('rosh_chodesh'));
  c.state.data.rest = rest;
  return speakPage(c);
}

/** "730" / "0730" -> 450 minutes; "7" / "07" -> a whole hour. Null when not a time. */
function parseClock(input) {
  if (!/^\d{1,4}$/.test(input)) return null;
  const [h, m] = input.length <= 2 ? [Number(input), 0] : [Number(input.slice(0, -2)), Number(input.slice(-2))];
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

/** A choice of names (areas / prayers): 0 first, then 1..n; past 9 the caller ends the number with #. */
function nameMenu(c, introKey, zeroKey, rows, kind, { star }) {
  const v = c.voice;
  const many = rows.length > 9;
  const messages = [...v.phrase(introKey), ...v.phrase(zeroKey), ...(many ? v.phrase('number_hash') : []),
    ...rows.flatMap((r, i) => v.item(`${kind}:${r.id}`, r.name, i + 1)), ...(star ? v.phrase('back') : [])];
  return { messages, opts: { max: String(rows.length).length, min: 1 } };
}

const SCREENS = {
  area: {
    back: null,
    async prompt(c) {
      const areas = await all(c.env, `SELECT id, name FROM areas ORDER BY sort, name`);
      c.state.data.areas = areas.map((a) => a.id);
      return nameMenu(c, 'choose_area', 'all_areas', areas, 'area', { star: false });
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
      return nameMenu(c, 'choose_prayer', 'all_soon', prayers, 'prayer', { star: c.state.data.areas?.length > 1 });
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
    prompt: (c) => ({ ...number([]), messages: ['time_1', 'time_2', 'time_3', 'time_4'].flatMap((k) => c.voice.phrase(k)), opts: { min: 1, max: 4 } }),
    handle(c, input) {
      if (input === '0') return list(c, c.state.data.prayerId, null);
      if (input === '00') return list(c, c.state.data.prayerId, 0);
      const from = parseClock(input);
      return from === null ? invalid(c) : list(c, c.state.data.prayerId, from);
    },
  },

  more: {
    back: 'main',
    prompt: (c) => ({ messages: [...c.voice.phrase('more'), ...c.voice.phrase('more_prayer')], opts: { max: 1, min: 1 } }),
    handle(c, input) {
      if (input === '1') return speakPage(c);
      if (input === '2') return go(c, 'main');
      return invalid(c);
    },
  },
};
