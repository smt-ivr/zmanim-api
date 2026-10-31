// Recorded voice for the phone lines. Every phrase the listening line says has a key; when the
// administration uploaded a recording for that key (to Yemot, from the admin site) it plays as a file
// (f-<path>), otherwise it is read by text-to-speech as before. Prayer, area and synagogue names
// and the words of a time ("8", "וחצי") can be recorded too.
import { all } from '../db.js';
import { text } from './yemot.js';
import { MANAGE_PHRASES } from './managePhrases.js';

// ------------------------------------------------------------------ what can be recorded
/** Fixed sentences of the listening line. `where`: shown in the admin next to the sentence. */
export const PHRASES = [
  ['line_off', () => 'קו השמיעה אינו פעיל כרגע', 'פתיחה', 'כשהקו כבוי בהגדרות'],
  ['choose_area', () => 'בחירת אזור', 'תפריטים', 'לפני רשימת האזורים'],
  ['all_areas', () => 'לכל האזורים', 'תפריטים', 'בתפריט האזורים, ואחריו "הקישו 0"'],
  ['choose_prayer', () => 'בחירת תפילה', 'תפריטים', 'לפני רשימת התפילות'],
  ['all_soon', () => 'לכל המניינים הקרובים', 'תפריטים', 'בתפריט התפילות, ואחריו "הקישו 0"'],
  ['back', () => 'לחזרה הקישו כוכבית', 'תפריטים', 'בסוף תפריט'],
  ['number_hash', () => 'הקישו את המספר ואחריו סולמית', 'תפריטים', 'כשיש יותר מ־9 אפשרויות'],
  ['time_choose', () => 'נא בחרו את השעה הרצויה', 'בחירת שעה', 'אחרי בחירת תפילה'],
  ['time_hash', () => 'וסולמית לסיום', 'בחירת שעה', 'מיד אחרי "נא בחרו את השעה הרצויה"'],
  ['time_2', () => 'אפשר להקיש גם דקות, אבל לא חובה', 'בחירת שעה', 'אחרי בחירת תפילה'],
  ['special_netz', () => 'למניינים בנץ', 'בחירת שעה', 'כשהמניינים המיוחדים של התפילה הם בנץ, ואחריו "הקישו 0"'],
  ['special_other', () => 'למניינים שלא בזמנים קבועים', 'בחירת שעה', 'מניינים לפי זמני היום (למשל לפני שקיעה), ואחריו "הקישו 0"'],
  ['time_soon', () => 'למניינים הקרובים הקישו 0 0 וסולמית', 'בחירת שעה', 'אחרי בחירת תפילה'],
  ['time_all', () => 'לכל המניינים של היום הקישו 0 0 0 וסולמית', 'בחירת שעה', 'בסוף תפריט השעה'],
  ['none_special', () => 'אין היום מניינים בזמנים מיוחדים', 'הודעות', 'כשהוקש 0 ואין מניינים כאלה'],
  ['rosh_chodesh', () => 'היום ראש חודש', 'הודעות', 'בראש חודש, לפני הזמנים'],
  ['none_today', () => 'אין מניינים היום', 'הודעות', 'כשאין מניינים כלל'],
  ['none_more', () => 'אין מניינים נוספים היום', 'הודעות', 'כשאין עוד מניינים היום'],
  ['none_from', () => 'אין מניינים מהשעה', 'הודעות', 'ואחריו השעה שהוקשה'],
  ['no_list_today', () => 'אין מניינים להשמעה היום', 'הודעות', 'בשבת, כשזמני שבת כבויים'],
  ['invalid', () => 'הקשה לא חוקית', 'הודעות', 'הקשה שאינה ברשימה'],
  ['no_input', () => 'לא התקבלה הקשה', 'הודעות', 'אחרי 3 פעמים בלי הקשה'],
  ['error', () => 'אירעה תקלה, נסו שוב מאוחר יותר', 'הודעות', 'בתקלה'],
  ['at', () => 'בשעה', 'מילים בתוך משפט', 'שחרית "בשעה" שמונה'],
  ['min_before', () => 'דקות לפני', 'זמני היום', '15 "דקות לפני" שקיעה'],
  ['min_after', () => 'דקות אחרי', 'זמני היום', '45 "דקות אחרי" נץ'],
  ['in', () => 'ב', 'מילים בתוך משפט', 'לפני שם בית הכנסת: "ב"מאור חיים'],
  ['and_in', () => 'וב', 'מילים בתוך משפט', 'לפני בית כנסת נוסף באותה שעה: "וב"פאר הנצח'],
  ...Array.from({ length: 10 }, (_, d) => [`press_${d}`, () => `הקישו ${d}`, 'תפריטים', `אחרי כל אפשרות בתפריט ("לשחרית" הקישו ${d})`]),
];

// Times: whole hours, "ורבע" and "וחצי" in words; any other time stays as numbers ("9 45").
const PAST = { 15: 'ורבע', 30: 'וחצי' };

// ------------------------------------------------------------------ the Hebrew date ("יום ראשון, כ״ט בתשרי")
export const WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
export const HEB_MONTHS = ['תשרי', 'חשוון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר א׳', 'אדר ב׳', 'ניסן', 'אייר', 'סיוון', 'תמוז', 'אב', 'אלול'];
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
/** 29 -> "כ״ט", 15 -> "ט״ו", 1 -> "א׳" */
export function hebrewDay(n) {
  const tens = ['', 'י', 'כ', 'ל'][Math.floor(n / 10)];
  let letters = tens + ONES[n % 10];
  if (n === 15) letters = 'טו';
  if (n === 16) letters = 'טז';
  return letters.length > 1 ? `${letters.slice(0, -1)}״${letters.slice(-1)}` : `${letters}׳`;
}

/** Today in Israel: { weekday: 0-6, day: 1-30, month: index in HEB_MONTHS } */
export function hebrewToday(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long', weekday: 'short' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(date);
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), day: Number(p.day), month: HEB_MONTHS.indexOf(p.month) };
}

/** "יום ראשון, כ״ט בתשרי": { tts, parts }, each part recordable. */
export function hebrewDateWords(date) {
  const { weekday, day, month } = hebrewToday(date);
  const wd = WEEKDAYS[weekday];
  const dd = hebrewDay(day);
  const mm = `ב${HEB_MONTHS[month] ?? ''}`;
  return { tts: `${wd} ${dd} ${mm}`, parts: [{ key: `wday:${weekday}`, text: wd }, { key: `hday:${day}`, text: dd }, { key: `hmonth:${month}`, text: mm }] };
}

/** Everything that can be recorded (except synagogues): [{ key, text, group, where }]. */
export async function catalog(env, settings) {
  const [prayers, areas, locations, anchors] = await Promise.all([
    all(env, `SELECT id, name FROM prayers ORDER BY sort, id`),
    all(env, `SELECT id, name FROM areas ORDER BY sort, name`),
    all(env, `SELECT TRIM(name) AS name, COUNT(DISTINCT synagogue_id) AS n FROM locations GROUP BY TRIM(name) ORDER BY n DESC, name`),
    all(env, `SELECT id, name FROM anchors ORDER BY sort, id`),
  ]);
  return [
    ...PHRASES.map(([key, t, group, where]) => ({ key: `sys:${key}`, text: t(settings), group, where })),
    ...prayers.map((p) => ({ key: `prayer:${p.id}`, text: p.name, group: 'שמות תפילות', where: 'בתפריט ובכל מניין' })),
    ...areas.map((a) => ({ key: `area:${a.id}`, text: a.name, group: 'שמות אזורים', where: 'בתפריט האזורים' })),
    ...anchors.flatMap((a) => [
      { key: `at:${a.id}`, text: `ב${a.name}`, group: 'זמני היום', where: `מניין בדיוק ב${a.name}: "שחרית ב${a.name}"` },
      { key: `anchor:${a.id}`, text: a.name, group: 'זמני היום', where: `"15 דקות לפני ${a.name}"` },
    ]),
    ...locations.filter((l) => l.name).map((l) => ({ key: locationKey(l.name), text: l.name, group: 'שמות מיקומים', where: `אחרי שם בית הכנסת (${l.n === 1 ? 'בבית כנסת אחד' : `ב־${l.n} בתי כנסת`})` })),
    ...MANAGE_PHRASES.map((t) => ({ key: manageKey(t), text: t, group: 'קו הניהול', where: t.startsWith('ל') && !t.includes(' ') ? 'אפשרות בתפריט, ואחריה "הקישו"' : 'קו הניהול', line: 'manage' })),
    ...WEEKDAYS.map((w, i) => ({ key: `wday:${i}`, text: w, group: 'תאריך', where: 'בתחילת השיחה: "יום ראשון", כ״ט בתשרי' })),
    ...Array.from({ length: 30 }, (_, i) => ({ key: `hday:${i + 1}`, text: hebrewDay(i + 1), group: 'תאריך', where: `יום ראשון, "${hebrewDay(i + 1)}" בתשרי` })),
    ...HEB_MONTHS.map((m, i) => ({ key: `hmonth:${i}`, text: `ב${m}`, group: 'תאריך', where: `יום ראשון, כ״ט "ב${m}"` })),
    ...Array.from({ length: 23 }, (_, i) => ({ key: `hour:${i + 1}`, text: String(i + 1), group: 'שעות', where: `"בשעה ${i + 1}"` })),
    ...Object.entries(PAST).map(([m, w]) => ({ key: `min:${m}`, text: w, group: 'שעות', where: `"בשעה 8 ${w}"` })),
  ];
}

const hash = (s) => {
  let h = 0x811c9dc5;
  for (const ch of String(s).trim()) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
};
/** A location is recorded once by its name ("ספרדי" in every synagogue): key "loc:<hash of the name>". */
export const locationKey = (name) => `loc:${hash(name)}`;
/** A sentence of the management line, by its text as spoken (after the Yemot clean-up): "m:<hash>". */
export const manageKey = (sentence) => `m:${hash(text(sentence).slice(2))}`;

/**
 * The management line speaks plain text; with recordings on there, each message that is exactly a
 * recorded sentence plays the file, and a menu item "ל<label> הקישו <d>" plays "ל<label>" + "הקישו <d>".
 * Returns a function over the Yemot message parts, or null when there is nothing to play.
 */
export async function manageVoice(env, settings) {
  if (!settings.recordings_enabled || !settings.recordings_manage_enabled) return null;
  const rows = await all(env, `SELECT key, path FROM recordings WHERE paused = 0 AND (key LIKE 'm:%' OR key LIKE 'sys:press_%')`);
  if (!rows.length) return null;
  const files = new Map(rows.map((r) => [r.key, r.path]));
  const file = (key) => files.get(key);
  return (parts) => parts.flatMap((p) => {
    if (!p.startsWith('t-')) return [p];
    const t = p.slice(2);
    const whole = file(`m:${hash(t)}`);
    if (whole) return [`f-${whole}`];
    const item = /^(ל.+) הקישו (\d)$/.exec(t);
    const label = item && file(`m:${hash(item[1])}`);
    if (!label) return [p];
    const press = file(`sys:press_${item[2]}`);
    return [`f-${label}`, press ? `f-${press}` : `t-הקישו ${item[2]}`];
  });
}

/** File name in the Yemot folder for a key: letters and digits only ("sys:welcome" -> "welcome", "prayer:3" -> "prayer3"). */
export const fileName = (key) => {
  const [kind, id] = key.split(':');
  if (kind === 'syn') return String(Number(id));
  return (kind === 'sys' ? id : `${kind}${id}`).replace(/[^a-z0-9]/gi, '');
};

// ------------------------------------------------------------------ speaking
/**
 * A part of a sentence: a string (always text-to-speech) or { key, text } (the recording when there is one).
 * A sentence: { tts, parts } — when none of its parts is recorded, the natural text `tts` is read as one piece.
 */
export async function loadVoice(env, settings) {
  const rows = settings.recordings_enabled ? await all(env, `SELECT key, path FROM recordings WHERE paused = 0`) : [];
  const files = new Map(rows.map((r) => [r.key, r.path]));
  const has = (p) => typeof p === 'object' && p !== null && files.has(p.key);
  const render = (parts) => {
    const out = [];
    let buf = '';
    let glue = false; // the previous text joins the next word ("ב" + "ישיבת מיר")
    const flush = () => { if (buf) out.push(text(buf)); buf = ''; };
    for (const p of parts) {
      if (has(p)) { flush(); out.push(`f-${files.get(p.key)}`); glue = false; continue; }
      const t = typeof p === 'string' ? p : p.text;
      buf = buf ? `${buf}${glue ? '' : ' '}${t}` : t;
      glue = Boolean(p.glue);
    }
    flush();
    return out;
  };
  const v = {
    recorded: files.size,
    /** A fixed sentence by key. */
    phrase: (key) => (files.has(`sys:${key}`) ? [`f-${files.get(`sys:${key}`)}`] : [text(PHRASES.find((p) => p[0] === key)[1](settings))]),
    /** A sentence made of parts. */
    sentence: ({ tts, parts }) => (parts.some(has) ? render(parts) : [text(tts)]),
    /** Menu item "ל<name> הקישו <d>" — with a recorded name: "<name> הקישו <d>". */
    /** A fixed option with its key: "<phrase> הקישו <d>", the two parts recorded separately. */
    option: (key, d) => {
      const t = PHRASES.find((p) => p[0] === key)[1](settings);
      return v.sentence({ tts: `${t} הקישו ${d}`, parts: [{ key: `sys:${key}`, text: t }, { key: `sys:press_${d}`, text: `הקישו ${d}` }] });
    },
    item: (key, name, d) => v.sentence({ tts: `ל${name} הקישו ${d}`, parts: [{ key, text: `ל${name}` }, { key: `sys:press_${d}`, text: `הקישו ${d}` }] }),
  };
  return v;
}

// ------------------------------------------------------------------ natural times
/** 8:00 -> "8", 8:15 -> "8 ורבע", 8:30 -> "8 וחצי", 9:45 -> "9 45", 8:05 -> "8 ו 5 דקות". { tts, parts } */
export function clockWords(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = { key: `hour:${h}`, text: String(h) };
  if (m === 0) return { tts: hour.text, parts: [hour] };
  const rest = PAST[m] ? { key: `min:${m}`, text: PAST[m] } : m < 10 ? `ו ${m} דקות` : String(m);
  return { tts: `${hour.text} ${rest.text ?? rest}`, parts: [hour, rest] };
}

/** "במאור חיים ספרדי" / "ובפאר הנצח אשכנזי" (and=true for the second and on): "ב" + the name, then the location as is. { tts, parts } */
export function placeWords({ synagogueId, synagogueName, location }, and = false) {
  const lead = and ? 'וב' : 'ב';
  const loc = location?.trim();
  return {
    tts: `${lead}${synagogueName}${loc ? ` ${loc}` : ''}`,
    parts: [{ key: and ? 'sys:and_in' : 'sys:in', text: lead, glue: true }, { key: `syn:${synagogueId}`, text: synagogueName },
      ...(loc ? [{ key: locationKey(loc), text: loc }] : [])],
  };
}
