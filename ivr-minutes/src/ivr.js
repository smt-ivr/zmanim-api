// The two Yemot HaMashiach "type=api" extensions. Everything is by the caller's phone number (ApiPhone).
//
//   /add    a caller adds minutes to their own total (limited per update and per time window;
//           inside a blocked window they can change their last update instead)
//   /total  a caller only hears how much they have accumulated
//
// Settings come as request parameters, which Yemot sends from the extension's settings
// (api_add_0=key=…, api_add_1=max=60 …), together with ApiPhone, ApiCallId and the values read so far.
//
// Stateless: Yemot sends back every value read earlier in the call (by its name), so the step is
// known from which names are present. Each question gets a fresh name (a1, a2 …, c1, e<id>_1 …),
// because Yemot must not be asked the same name twice. A call ends with `id_list_message=…&`,
// which hands the caller back to the extension Yemot was in before.
//
// Every sentence is a list of parts: text, numbers and P(key) — fixed phrases that play the
// administration's recording when there is one (voice.js).
import { addEntry, deleteEntry, first, getKey, init, isBlocked, listName, listTotal, normalizePhone, phoneTotal, recentPhoneEntries, updateEntry } from './data.js';
import { parsePer, speakPer, windowStart } from './period.js';
import { loadVoice, P, plainVoice } from './voice.js';

const ATTEMPTS = 3;

// ------------------------------------------------------------------ Yemot responses
const say = (v, lines) => lines.filter((l) => l && (!Array.isArray(l) || l.length)).flatMap((l) => v.render(l)).join('.');
const end = (v, lines) => { const s = say(v, lines); return s ? `id_list_message=${s}&` : '&'; };

/**
 * Keypad read. Options in Yemot's order: val_name, re_enter_if_exists, max_digits, min_digits, sec_wait,
 * typing_playback_mode, block_asterisk, block_zero, replace_char, digits_allowed, amount_attempts,
 * allow_empty, empty_val, block_change_keyboard, confirm.
 * Amounts are read back ("Number") with Yemot's own "press 1 to confirm"; a menu key is not.
 */
function read(v, lines, val, { maxDigits = '', minDigits = 1, amount = false } = {}) {
  const ops = [val, 'no', maxDigits, minDigits, 10, amount ? 'Number' : 'No', 'no', 'no', '', '', 1, 'Ok', 'None', '', amount ? '' : 'no'];
  return `read=${say(v, lines)}=${ops.join(',')}`;
}

/** 1 -> "דקה אחת", 45 -> "45 דקות" (always minutes). As sentence parts. */
export function minutesParts(n) {
  const neg = n < 0;
  n = Math.abs(n);
  const parts = n === 1 ? [P('one_minute')] : [String(n), P('minutes')];
  return neg ? [P('minus'), ...parts] : parts;
}

/** The same, as text: "45 דקות". */
export const speakMinutes = (n) => minutesParts(n).map((p) => (typeof p === 'object' ? p.text : p)).join(' ');

// ------------------------------------------------------------------ parameters (from the extension's settings)
const int = (v, lo, hi, dflt) => (v != null && /^\d{1,5}$/.test(String(v).trim()) && +v >= lo && +v <= hi ? +v : dflt);

export function settings(p) {
  return {
    list: listName(p.list),
    max: int(p.max, 1, 99999, 60),
    times: int(p.times, 1, 999, 1),
    per: parsePer(p.per),
    edit: p.edit !== 'no',
    // total line: all = only the total of everyone (default), both = everyone's and then hers, mine = only hers
    say: ['all', 'both', 'mine'].includes(p.say) ? p.say : p.all === '1' ? 'both' : 'all',
  };
}

// ------------------------------------------------------------------ entry
export async function readParams(request) {
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
  let v = plainVoice;
  try {
    const p = await readParams(request);
    if (p.hangup === 'yes') return textReply('');
    await init(env);
    v = await loadVoice(env);
    if (!p.key || p.key !== (await getKey(env))) return textReply(end(v, [[P('blocked')]]));
    const s = settings(p);
    const phone = normalizePhone(p.ApiPhone);
    const c = { env, p, phone, v, s, nowMs };
    if (mode === 'total' && s.say === 'all') return textReply(await total(c)); // no need to know who is calling
    if (!phone) return textReply(end(v, [[P('no_phone')]]));
    if (mode === 'add' && (await isBlocked(env, phone))) return textReply(end(v, [[P('phone_blocked')]]));
    return textReply(mode === 'total' ? await total(c) : await add(c));
  } catch (err) {
    console.error('[ivr-minutes]', err?.stack || err);
    return textReply(end(v, [[P('error')]]));
  }
}

// ------------------------------------------------------------------ /total
async function total(c) {
  const { env, s, phone, v } = c;
  const everyone = s.say !== 'mine' && [P('all_only'), ...minutesParts(await listTotal(env, s.list))];
  if (s.say === 'all') return end(v, [everyone]);
  const mine = await phoneTotal(env, s.list, phone);
  if (s.say === 'mine') return end(v, [mine ? [P('so_far'), ...minutesParts(mine)] : [P('none_yet')]]);
  return end(v, [everyone, mine ? [P('mine_after'), ...minutesParts(mine)] : [P('mine_none_after')]]);
}

// ------------------------------------------------------------------ /add
/** The highest-numbered answer present for a prefix: a1, a2 … -> { n, value }. */
function lastAnswer(p, prefix) {
  let best = null;
  for (const [k, val] of Object.entries(p)) {
    const m = k.startsWith(prefix) && /^(\d+)$/.exec(k.slice(prefix.length));
    if (m && (!best || +m[1] > best.n)) best = { n: +m[1], value: String(val).trim() };
  }
  return best;
}

/** Edit answers are named e<entryId>_<attempt>, so a repeated request changes the same entry. */
function lastEdit(p) {
  let best = null;
  for (const [k, val] of Object.entries(p)) {
    const m = /^e(\d+)_(\d+)$/.exec(k);
    if (m && (!best || +m[2] > best.n)) best = { id: +m[1], n: +m[2], value: String(val).trim() };
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

const mp = (c, n) => minutesParts(n);
const totalLine = (c, t) => (t ? [P('total_is'), ...mp(c, t)] : [P('none_yet')]);
const amountPrompt = (c) => [P('add_prompt'), String(c.s.max), P('end_hash')];
const editPrompt = (c) => [P('edit_prompt'), String(c.s.max), P('edit_cancel'), P('end_hash')];
const amountRead = (c, lines, val) => read(c.v, lines, val, { maxDigits: String(c.s.max).length, amount: true });

function alreadyParts(per) {
  if (per.kind === 'day') return [P('already_day')];
  if (per.kind === 'week') return [P('already_week')];
  if (per.kind === 'month') return [P('already_month')];
  if (per.kind === 'ever') return [P('already')];
  return [P('already'), speakPer(per)];
}

function blockedLine(c, recent) {
  const last = mp(c, recent[0].minutes);
  if (c.s.times === 1) return [...alreadyParts(c.s.per), P('tosefet_of'), ...last];
  return [...alreadyParts(c.s.per), String(recent.length), P('times'), P('last_update'), ...last];
}

async function start(c) {
  const st = await status(c);
  if (!st.blocked) return amountRead(c, [st.total && [P('so_far'), ...mp(c, st.total)], amountPrompt(c)], 'a1');
  if (c.s.edit) return read(c.v, [blockedLine(c, st.recent), [P('edit_menu')]], 'c1', { maxDigits: 1 });
  return end(c.v, [blockedLine(c, st.recent), totalLine(c, st.total)]);
}

const empty = (value) => value === 'None' || value === '';

async function onAmount(c, { n, value }) {
  const { env, s, phone, p, v } = c;
  if (value.includes('*')) return end(v, []);
  const minutes = /^\d+$/.test(value) ? +value : NaN;
  if (!(minutes >= 1 && minutes <= s.max)) {
    if (n >= ATTEMPTS) return end(v, [[P(empty(value) ? 'no_input' : 'not_updated')]]);
    const why = empty(value) ? [P('no_input')] : [P('range_add'), String(s.max), P('minutes')];
    return amountRead(c, [why, amountPrompt(c)], `a${n + 1}`);
  }
  const callId = p.ApiCallId ? String(p.ApiCallId) : null;
  if (callId) {
    // Yemot repeated the request after we already saved: answer the same way
    const done = await first(env, `SELECT minutes FROM minutes_entries WHERE call_id = ?`, callId);
    if (done) return end(v, [[P('added'), ...mp(c, done.minutes)], totalLine(c, await phoneTotal(env, s.list, phone))]);
  }
  const st = await status(c); // checked again: another call from the same phone may have updated meanwhile
  if (st.blocked) return end(v, [blockedLine(c, st.recent), totalLine(c, st.total)]);
  await addEntry(env, { list: s.list, phone, minutes, source: 'phone', callId });
  return end(v, [[P('added'), ...mp(c, minutes)], totalLine(c, await phoneTotal(env, s.list, phone))]);
}

async function onChoice(c, { n, value }) {
  if (value !== '1') {
    if (value === '2' || empty(value) || value.includes('*') || n >= ATTEMPTS) return end(c.v, []);
    return read(c.v, [[P('invalid')], [P('edit_menu')]], `c${n + 1}`, { maxDigits: 1 });
  }
  if (!c.s.edit) return end(c.v, []);
  const st = await status(c);
  if (!st.recent.length) return start(c); // nothing left to change (the window moved on): add instead
  return amountRead(c, [editPrompt(c)], `e${st.recent[0].id}_1`);
}

async function onEdit(c, { id, n, value }) {
  const { env, s, phone, v } = c;
  if (!s.edit || value.includes('*')) return end(v, []);
  const entry = await first(env, `SELECT * FROM minutes_entries WHERE id = ? AND list = ? AND phone = ?`, id, s.list, phone);
  const minutes = /^\d+$/.test(value) ? +value : NaN;
  if (!(minutes >= 0 && minutes <= s.max)) {
    if (n >= ATTEMPTS) return end(v, [[P('not_updated')]]);
    const why = empty(value) ? [P('no_input')] : [P('range_edit'), String(s.max), P('minutes')];
    return amountRead(c, [why, editPrompt(c)], `e${id}_${n + 1}`);
  }
  if (minutes === 0) {
    if (entry) await deleteEntry(env, entry, 'phone');
    return end(v, [[P('canceled')], totalLine(c, await phoneTotal(env, s.list, phone))]);
  }
  if (!entry) return end(v, [[P('not_found')], totalLine(c, await phoneTotal(env, s.list, phone))]);
  if (entry.minutes !== minutes) await updateEntry(env, entry, { minutes }, 'phone');
  return end(v, [[P('changed_to'), ...mp(c, minutes)], totalLine(c, await phoneTotal(env, s.list, phone))]);
}
