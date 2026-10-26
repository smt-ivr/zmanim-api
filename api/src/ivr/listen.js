// Public listening line: anyone can call and hear minyan times by area, prayer and day.
// No identification; uses the same engine as the management line.
import { all } from '../db.js';
import { MINYAN_ORDER, MINYAN_SELECT, serializeMinyan } from '../minyan.js';
import { currentSeason, getSettings, visibleDays } from '../settings.js';
import { callStore, chosenIndex, go, goodbye, invalid, listChoice, menu, number, readParams, reply, runCall } from './engine.js';
import { speakMinyanTime, text } from './yemot.js';

const DAY_WORDS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MAX_SPOKEN = 30;

export async function handleListen({ env, request, url }) {
  try {
    const params = await readParams(request, url);
    const settings = await getSettings(env);
    if (params.hangup !== 'yes' && !settings.listen_enabled) return reply(goodbye([text('קו זמני המניינים אינו פעיל כרגע')]));
    const store = callStore(env, 'ivr_listen_calls');
    const flow = { ...store, screens: SCREENS, start, recover: (c) => go(c, 'main') };
    return reply(await runCall(env, params, flow, { settings, store }));
  } catch (err) {
    console.error('[ivr-listen]', err?.stack || err);
    return reply(goodbye([text('אירעה תקלה, נסו שוב מאוחר יותר')]));
  }
}

/** Day of week (0 = Sunday) and minutes since midnight, in Israel. */
function israelNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

async function start(c) {
  await c.store.prune();
  c.say.push(text('שלום וברוכים הבאים לקו זמני המניינים'));
  const areas = await all(c.env, `SELECT id FROM areas`);
  return areas.length > 1 ? go(c, 'area') : go(c, 'main', { area: null });
}

/** Active minyanim visible to the public for a day, optionally one area / prayer, in the default season. */
async function minyanimFor(c, { day, prayerId }) {
  const where = ['m.is_active = 1', 's.is_active = 1', '(m.days & ?) != 0'];
  const params = [1 << day];
  if (c.state.data.area) (where.push('s.area_id = ?'), params.push(c.state.data.area));
  if (prayerId) (where.push('m.prayer_id = ?'), params.push(prayerId));
  const season = await currentSeason(c.env);
  where.push('m.season_id = ?');
  params.push(season?.id ?? 0);
  const rows = await all(
    c.env,
    `${MINYAN_SELECT.replace('FROM minyanim m', 'FROM minyanim m JOIN synagogues s ON s.id = m.synagogue_id')
      .replace('SELECT m.*,', 'SELECT m.*, s.name AS synagogue_name,')} WHERE ${where.join(' AND ')} ${MINYAN_ORDER}`,
    ...params
  );
  return rows
    .filter((r) => visibleDays(r.days, c.settings) & (1 << day))
    .map((r) => ({ ...r, notes: '' }))
    .map((r) => ({ ...serializeMinyan(r), synagogue_name: r.synagogue_name }));
}

function speakList(c, list, { withPrayer = false } = {}) {
  const fixed = list.filter((m) => m.time_kind === 'fixed').sort((a, b) => a.time.localeCompare(b.time));
  const relative = list.filter((m) => m.time_kind === 'relative');
  for (const m of [...fixed, ...relative].slice(0, MAX_SPOKEN)) {
    c.say.push(text([speakMinyanTime(m), withPrayer && m.prayer_name, m.synagogue_name, m.location_name && `ב${m.location_name}`].filter(Boolean).join(', ')));
  }
  if (list.length > MAX_SPOKEN) c.say.push(text('ויש מניינים נוספים. לרשימה המלאה בחרו אזור'));
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
      c.state.data.prayerNames = prayers.map((p) => p.name);
      return listChoice(c, 'תפריט ראשי', prayers, (p) => `זמני ${p.name}`, { zero: 'המניינים הקרובים' });
    },
    async handle(c, input) {
      const i = chosenIndex(input, c.state.data.prayers, { zero: true });
      if (i === null) return invalid(c);
      if (i === -1) {
        const now = israelNow();
        // Next start of each fixed or interval minyan from now
        const list = (await minyanimFor(c, { day: now.day }))
          .map((m) => ({ ...m, next: nextStart(m, now.minutes) }))
          .filter((m) => m.next !== null)
          .sort((a, b) => a.next - b.next)
          .slice(0, 8)
          .map((m) => (m.time_kind === 'interval' ? { ...m, time_kind: 'fixed', time: hhmm(m.next) } : m));
        if (!list.length) c.say.push(text('אין מניינים נוספים היום'));
        else { c.say.push(text('המניינים הקרובים:')); speakList(c, list, { withPrayer: true }); }
        return go(c, 'main');
      }
      return go(c, 'day', { prayerId: c.state.data.prayers[i], prayerName: c.state.data.prayerNames[i] });
    },
  },

  day: {
    back: 'main',
    prompt: (c) => menu(c, `זמני ${c.state.data.prayerName}`, [['1', 'היום'], ['2', 'מחר'], ['3', 'בחירת יום בשבוע']]),
    async handle(c, input) {
      const today = israelNow().day;
      if (input === '3') return go(c, 'weekday');
      if (input !== '1' && input !== '2') return invalid(c);
      return speakDay(c, input === '1' ? today : (today + 1) % 7);
    },
  },

  weekday: {
    back: 'day',
    prompt: (c) => menu(c, 'בחירת יום', DAY_WORDS.map((d, i) => [String(i + 1), `יום ${d}`]).filter((_, i) => i < 6 || c.settings.shabbat_enabled)),
    handle(c, input) {
      const d = Number(input) - 1;
      if (!Number.isInteger(d) || d < 0 || d > (c.settings.shabbat_enabled ? 6 : 5)) return invalid(c);
      return speakDay(c, d);
    },
  },
};

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
function nextStart(m, nowMin) {
  if (m.time_kind === 'fixed') return toMinutes(m.time) >= nowMin ? toMinutes(m.time) : null;
  if (m.time_kind === 'interval') {
    for (let t = toMinutes(m.time); t <= toMinutes(m.end_time); t += m.every_minutes) if (t >= nowMin) return t;
  }
  return null;
}

async function speakDay(c, day) {
  if (day === 6 && !c.settings.shabbat_enabled) {
    c.say.push(text('אין מניינים להצגה'));
    return go(c, 'main');
  }
  const list = await minyanimFor(c, { day, prayerId: c.state.data.prayerId });
  if (!list.length) c.say.push(text(`אין מניינים ל${c.state.data.prayerName} ביום ${DAY_WORDS[day]}`));
  else { c.say.push(text(`זמני ${c.state.data.prayerName} ליום ${DAY_WORDS[day]}:`)); speakList(c, list); }
  return go(c, 'main');
}
