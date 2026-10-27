// Shared engine for the Yemot HaMashiach phone lines (management and public listening).
//
// Stateless HTTP, stateful call: where the caller is in the menu tree is kept per ApiCallId.
// Every prompt reads into a fresh value name s1, s2, s3 ... so Yemot never re-uses an old answer;
// on each request we take the answer to the prompt we asked last (s<step>).
//
// Rules:
// - Always answer HTTP 200 with valid Yemot text, otherwise Yemot plays "system error".
// - Never hang up and never send go_to_folder: a call ends with `id_list_message=...&`, and Yemot
//   returns the caller to the previous menu.
import { nowSec, run } from '../db.js';
import { HttpError } from '../http.js';
import { idListMessage, readDigits, readVoice, text } from './yemot.js';

export const reply = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/** Final message; the trailing '&' hands the call back to Yemot without go_to_folder. */
export const goodbye = (messages) => `${idListMessage(messages.length ? messages : [text('להתראות')])}&`;

export async function readParams(request, url) {
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

/**
 * Runs one request of a call.
 *   flow = { screens, start(c), recover(c), load(callId), save(callId, state), clear(callId) }
 *   c    = { env, params, say: [], state, screens, ...context }
 */
export async function runCall(env, params, flow, context) {
  const callId = params.ApiCallId || `phone-${params.ApiPhone}`;
  if (params.hangup === 'yes') {
    await flow.clear(callId);
    return '';
  }
  let state = await flow.load(callId);
  const c = { env, params, say: [], state, screens: flow.screens, recover: flow.recover, ...context };

  let ask;
  if (!state) {
    c.state = state = { step: 0, screen: null, data: {}, empties: 0 };
    ask = await flow.start(c);
  } else {
    const input = state.step ? params[`s${state.step}`] : undefined;
    if (input === undefined) return state.prompt; // repeated request: ask the same question again
    ask = await answer(c, String(input).trim());
  }

  if (ask.end) {
    await flow.clear(callId);
    return goodbye(c.say);
  }
  state.step += 1;
  const val = `s${state.step}`;
  const read = ask.voice ? readVoice(ask.messages, val) : readDigits(ask.messages, val, ask.opts);
  state.prompt = read; // a repeat does not replay one-time announcements
  await flow.save(callId, state);
  return [c.say.length && idListMessage(c.say), read].filter(Boolean).join('&');
}

async function answer(c, input) {
  const screen = c.screens[c.state.screen];
  if (input === 'None' || input === '') {
    if (++c.state.empties >= 3) {
      c.say.push(text('לא התקבלה הקשה'));
      return { end: true };
    }
    return screen.prompt(c);
  }
  c.state.empties = 0;
  if (input.includes('*') && screen.back !== undefined) {
    return typeof screen.back === 'function' ? screen.back(c) : screen.back === null ? end(c) : go(c, screen.back);
  }
  try {
    return await screen.handle(c, input);
  } catch (err) {
    if (err instanceof HttpError) {
      c.say.push(text(err.fields ? Object.values(err.fields).join(', ') : err.message));
      return c.recover(c);
    }
    throw err;
  }
}

/** Table-backed call state. */
export function callStore(env, table, extra = {}) {
  const cols = Object.keys(extra);
  return {
    async load(callId) {
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE call_id = ?`).bind(callId).first();
      if (!row || cols.some((k) => row[k] !== extra[k])) return null;
      return JSON.parse(row.state);
    },
    async save(callId, state) {
      await run(
        env,
        `INSERT INTO ${table} (call_id, ${cols.map((k) => `${k}, `).join('')}state, updated_at) VALUES (?, ${cols.map(() => '?, ').join('')}?, ?)
         ON CONFLICT(call_id) DO UPDATE SET ${cols.map((k) => `${k} = excluded.${k}, `).join('')}state = excluded.state, updated_at = excluded.updated_at`,
        callId, ...cols.map((k) => extra[k]), JSON.stringify(state), nowSec()
      );
    },
    clear: (callId) => run(env, `DELETE FROM ${table} WHERE call_id = ?`, callId),
    prune: () => run(env, `DELETE FROM ${table} WHERE updated_at < ?`, nowSec() - 86400),
  };
}

// ------------------------------------------------------------------ screen helpers
export function go(c, name, data) {
  c.state.screen = name;
  if (data) Object.assign(c.state.data, data);
  return c.screens[name].prompt(c);
}

export const end = (c, message) => (message && c.say.push(text(message)), { end: true });
export const invalid = (c) => (c.say.push(text('הקשה לא חוקית')), c.screens[c.state.screen].prompt(c));

/** Single-key menu. items: [[digit, label], ...] -> "ל<label> הקישו <digit>" */
export function menu(c, intro, items, { star = true } = {}) {
  const parts = [...(intro ? [text(intro)] : []), ...items.map(([d, label]) => text(`ל${label} הקישו ${d}`))];
  if (star) parts.push(text('לחזרה הקישו כוכבית'));
  return { messages: parts, opts: { max: 1, min: 1 } };
}

/** A list read in full and numbered on (1, 2, … 10, 11 …); past 9 items the caller ends the number with #. */
export function numberedList(intro, lines, { star = true } = {}) {
  const many = lines.length > 9;
  const parts = [...(intro ? [text(intro)] : []), ...(many ? [text('הקישו את המספר ואחריו סולמית')] : []), ...lines.map((l) => text(l))];
  if (star) parts.push(text('לחזרה הקישו כוכבית'));
  return { messages: parts, opts: { max: String(lines.length).length, min: 1 } };
}

/** Free number ending with #. */
export const number = (messages, { min = 1, max = '' } = {}) => ({ messages: messages.map((m) => (typeof m === 'string' ? text(m) : m)), opts: { min, max } });

/** Options 1..n for a list (single key up to 10 items, otherwise number + #). */
export function listChoice(c, intro, rows, label, { zero, star = true } = {}) {
  const items = rows.map((r, i) => [String(i + 1), label(r)]);
  if (zero) items.unshift(['0', zero]);
  if (items.length <= 10) return menu(c, intro, items, { star });
  return number([intro, ...items.map(([d, l]) => `${l} ${d}`), 'הקישו את המספר וסולמית']);
}

export function chosenIndex(input, rows, { zero } = {}) {
  if (zero && input === '0') return -1;
  const i = Number(input) - 1;
  return Number.isInteger(i) && i >= 0 && i < rows.length ? i : null;
}
