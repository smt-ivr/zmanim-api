// The two Yemot HaMashiach "type=api" extensions. Everything is by the caller's phone number (ApiPhone).
//
//   /add    a caller adds minutes to their own total (limited per update and per time window;
//           inside a blocked window they can change their last update instead)
//   /total  a caller only hears how much they have accumulated
//
// Stateless: Yemot sends back every value read earlier in the call (by its name), so the step is
// known from which names are present. Each question gets a fresh name (a1, a2 …, c1, e<id>_1 …),
// because Yemot must not be asked the same name twice. A call ends with `id_list_message=…&`,
// which hands the caller back to the extension Yemot was in before.
import { addEntry, deleteEntry, first, init, listName, listTotal, normalizePhone, phoneTotal, recentPhoneEntries, updateEntry, getKey } from './data.js';
import { parsePer, speakPer, windowStart } from './period.js';

const ATTEMPTS = 3;

// ------------------------------------------------------------------ Yemot text
/** Characters Yemot treats as syntax inside a message. */
const clean = (s) => String(s).replace(/[.\-"'&|=׳״,]/g, ' ').replace(/\s+/g, ' ').trim();
const say = (lines) => lines.filter(Boolean).map((l) => `t-${clean(l)}`).join('.');
const end = (lines) => (lines.filter(Boolean).length ? `id_list_message=${say(lines)}&` : '&');

/**
 * Keypad read. Options in Yemot's order: val_name, re_enter_if_exists, max_digits, min_digits, sec_wait,
 * typing_playback_mode, block_asterisk, block_zero, replace_char, digits_allowed, amount_attempts,
 * allow_empty, empty_val, block_change_keyboard, confirm.
 * Amounts are read back ("Number") with Yemot's own "press 1 to confirm"; a menu key is not.
 */
function read(lines, val, { maxDigits = '', minDigits = 1, amount = false } = {}) {
  const ops = [val, 'no', maxDigits, minDigits, 10, amount ? 'Number' : 'No', 'no', 'no', '', '', 1, 'Ok', 'None', '', amount ? '' : 'no'];
  return `read=${say(lines)}=${ops.join(',')}`;
}

/** 1 -> "דקה אחת", 45 -> "45 דקות"; with hours: 135 -> "2 שעות ו 15 דקות". */
export function speakMinutes(n, hours = false) {
  const mins = (k) => (k === 1 ? 'דקה אחת' : `${k} דקות`);
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (!hours || n < 60) s = mins(n);
  else {
    const h = Math.floor(n / 60), m = n % 60;
    s = (h === 1 ? 'שעה אחת' : h === 2 ? 'שעתיים' : `${h} שעות`) + (m ? ` ו ${mins(m)}` : '');
  }
  return neg ? `מינוס ${s}` : s;
}

// ------------------------------------------------------------------ link parameters
const int = (v, lo, hi, dflt) => (v != null && /^\d{1,5}$/.test(String(v).trim()) && +v >= lo && +v <= hi ? +v : dflt);

export function settings(p) {
  return {
    list: listName(p.list),
    max: int(p.max, 1, 99999, 60),
    times: int(p.times, 1, 999, 1),
    per: parsePer(p.per),
    edit: p.edit !== 'no',
    hours: p.hours === '1',
    all: p.all === '1',
  };
}

// ------------------------------------------------------------------ entry
async function readParams(request) {
  const url = new URL(request.url);
  const merged = new URLSearchParams(url.search);
  if (request.method === 'POST') {
    const type = request.headers.get('Content-Type') || '';
    const body = type.includes('json')
      ? new URLSearchParams(Object.entries(await request.json().catch(() => ({}))))
      : new URLSearchParams(await request.text());
    for (const [k, v] of body) merged.append(k, v);
  }
  const out = {};
  for (const [k, v] of merged) out[k] = v; // Yemot may repeat a key; the last one wins
  return out;
}

const textReply = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

/** mode: 'add' | 'total'. Always answers 200 with valid Yemot text (anything else plays "system error"). */
export async function handleIvr(request, env, mode, nowMs = Date.now()) {
  try {
    const p = await readParams(request);
    if (p.hangup === 'yes') return textReply('');
    await init(env);
    if (!p.key || p.key !== (await getKey(env))) return textReply(end(['הגישה לשלוחה זו חסומה']));
    const phone = normalizePhone(p.ApiPhone);
    if (!phone) return textReply(end(['לא זוהה מספר הטלפון שלכם. יש להתקשר ממספר מזוהה']));
    const c = { env, p, phone, s: settings(p), nowMs };
    return textReply(mode === 'total' ? await total(c) : await add(c));
  } catch (err) {
    console.error('[ivr-minutes]', err?.stack || err);
    return textReply(end(['אירעה תקלה, נסו שוב מאוחר יותר']));
  }
}

// ------------------------------------------------------------------ /total
async function total(c) {
  const { env, s, phone } = c;
  const mine = await phoneTotal(env, s.list, phone);
  const lines = [mine ? `עד כה צברת ${speakMinutes(mine, s.hours)}` : 'עדיין לא צברת דקות'];
  if (s.all) lines.push(`ובסך הכל כל המשתתפים צברו ${speakMinutes(await listTotal(env, s.list), s.hours)}`);
  return end(lines);
}

// ------------------------------------------------------------------ /add
/** The highest-numbered answer present for a prefix: a1, a2 … -> { n, value }. */
function lastAnswer(p, prefix) {
  let best = null;
  for (const [k, v] of Object.entries(p)) {
    const m = k.startsWith(prefix) && /^(\d+)$/.exec(k.slice(prefix.length));
    if (m && (!best || +m[1] > best.n)) best = { n: +m[1], value: String(v).trim() };
  }
  return best;
}

/** Edit answers are named e<entryId>_<attempt>, so a repeated request changes the same entry. */
function lastEdit(p) {
  let best = null;
  for (const [k, v] of Object.entries(p)) {
    const m = /^e(\d+)_(\d+)$/.exec(k);
    if (m && (!best || +m[2] > best.n)) best = { id: +m[1], n: +m[2], value: String(v).trim() };
  }
  return best;
}

async function add(c) {
  const edit = lastEdit(c.p);
  if (edit) return onEdit(c, edit);
  const choice = lastAnswer(c.p, 'c');
  if (choice) return onChoice(c, choice);
  const amount = lastAnswer(c.p, 'a');
  if (amount) return onAmount(c, amount);
  return start(c);
}

async function status(c) {
  const { env, s, phone, nowMs } = c;
  const recent = await recentPhoneEntries(env, s.list, phone, windowStart(s.per, nowMs));
  return { recent, blocked: recent.length >= s.times, total: await phoneTotal(env, s.list, phone) };
}

const totalLine = (c, t) => (t ? `סך הכל צברת ${speakMinutes(t, c.s.hours)}` : 'עדיין לא צברת דקות');
const amountPrompt = (c) => `הקישו את מספר הדקות להוספה, עד ${c.s.max}, ובסיום סולמית`;
const editPrompt = (c) => `הקישו את מספר הדקות המעודכן, עד ${c.s.max}. לביטול העדכון הקישו 0. ובסיום סולמית`;

function blockedLine(c, recent) {
  const when = speakPer(c.s.per);
  const last = speakMinutes(recent[0].minutes, c.s.hours);
  if (c.s.times === 1) return `כבר עדכנת ${when} ${last}`;
  return `כבר עדכנת ${when} ${recent.length} פעמים. בעדכון האחרון ${last}`;
}

async function start(c) {
  const st = await status(c);
  if (!st.blocked) return read([st.total && `עד כה צברת ${speakMinutes(st.total, c.s.hours)}`, amountPrompt(c)], 'a1', { maxDigits: String(c.s.max).length, amount: true });
  if (c.s.edit) return read([blockedLine(c, st.recent), 'לשינוי העדכון הקישו 1. ליציאה הקישו 2'], 'c1', { maxDigits: 1 });
  return end([blockedLine(c, st.recent), totalLine(c, st.total)]);
}

const noInput = (v) => v === '' || v === 'None' || v.includes('*');

async function onAmount(c, { n, value }) {
  const { env, s, phone, p } = c;
  if (value.includes('*')) return end([]);
  const minutes = /^\d+$/.test(value) ? +value : NaN;
  if (!(minutes >= 1 && minutes <= s.max)) {
    if (n >= ATTEMPTS) return end([value === 'None' || value === '' ? 'לא התקבלה הקשה' : 'לא עודכן']);
    const why = value === 'None' || value === '' ? 'לא התקבלה הקשה' : `ניתן להוסיף בין 1 ל ${s.max} דקות`;
    return read([why, amountPrompt(c)], `a${n + 1}`, { maxDigits: String(s.max).length, amount: true });
  }
  const callId = p.ApiCallId ? String(p.ApiCallId) : null;
  if (callId) {
    // Yemot repeated the request after we already saved: answer the same way
    const done = await first(env, `SELECT minutes FROM minutes_entries WHERE call_id = ?`, callId);
    if (done) return end([`הוספת ${speakMinutes(done.minutes, s.hours)}`, totalLine(c, await phoneTotal(env, s.list, phone))]);
  }
  const st = await status(c); // checked again: another call from the same phone may have updated meanwhile
  if (st.blocked) return end([blockedLine(c, st.recent), totalLine(c, st.total)]);
  await addEntry(env, { list: s.list, phone, minutes, source: 'phone', callId });
  return end([`הוספת ${speakMinutes(minutes, s.hours)}`, totalLine(c, await phoneTotal(env, s.list, phone))]);
}

async function onChoice(c, { n, value }) {
  if (value !== '1') {
    if (value === '2' || noInput(value) || n >= ATTEMPTS) return end([]);
    return read(['הקשה לא חוקית', 'לשינוי העדכון הקישו 1. ליציאה הקישו 2'], `c${n + 1}`, { maxDigits: 1 });
  }
  if (!c.s.edit) return end([]);
  const st = await status(c);
  if (!st.recent.length) return start(c); // nothing left to change (the window moved on): add instead
  return read([editPrompt(c)], `e${st.recent[0].id}_1`, { maxDigits: String(c.s.max).length, amount: true });
}

async function onEdit(c, { id, n, value }) {
  const { env, s, phone } = c;
  if (!s.edit || value.includes('*')) return end([]);
  const entry = await first(env, `SELECT * FROM minutes_entries WHERE id = ? AND list = ? AND phone = ?`, id, s.list, phone);
  const minutes = /^\d+$/.test(value) ? +value : NaN;
  if (!(minutes >= 0 && minutes <= s.max)) {
    if (n >= ATTEMPTS) return end(['לא עודכן']);
    const why = value === 'None' || value === '' ? 'לא התקבלה הקשה' : `ניתן לעדכן בין 0 ל ${s.max} דקות`;
    return read([why, editPrompt(c)], `e${id}_${n + 1}`, { maxDigits: String(s.max).length, amount: true });
  }
  if (minutes === 0) {
    if (entry) await deleteEntry(env, entry, 'phone');
    return end(['העדכון בוטל', totalLine(c, await phoneTotal(env, s.list, phone))]);
  }
  if (!entry) return end(['העדכון לא נמצא', totalLine(c, await phoneTotal(env, s.list, phone))]);
  if (entry.minutes !== minutes) await updateEntry(env, entry, { minutes }, 'phone');
  return end([`העדכון שונה ל ${speakMinutes(minutes, s.hours)}`, totalLine(c, await phoneTotal(env, s.list, phone))]);
}
