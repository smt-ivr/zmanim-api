// Records calls to the phone lines: each step keeps what the caller pressed and what the system said,
// so the administration can see exactly how the lines are used. Kept for 180 days.
import { nowIso, run } from '../db.js';

const MAX_EVENTS = 300;

/** Plain words of a Yemot answer ("id_list_message=t-...&read=t-...=s3,...") for the call timeline. */
export function spoken(body) {
  return String(body || '').split('&').filter(Boolean).map((part) => {
    let v = part.slice(part.indexOf('=') + 1);
    if (part.startsWith('read=')) v = v.slice(0, v.lastIndexOf('='));
    return v.split('.').map((m) => m.replace(/^[tnd]-/, '').replace(/^f-.*/, '')).filter(Boolean).join('. ');
  }).filter(Boolean).join('. ').slice(0, 1500);
}

/** log: { line, phone, userId } */
export function callLog(env, log) {
  const where = `line = ? AND call_id = ?`;
  return {
    async start(callId, extra = {}) {
      await run(env, `INSERT INTO phone_calls (line, call_id, phone, user_id, outcome) VALUES (?, ?, ?, ?, ?) ON CONFLICT(line, call_id) DO NOTHING`,
        log.line, callId, log.phone || '', log.userId ?? null, extra.outcome || '');
    },
    async step(callId, { screen, input, body }) {
      const ev = JSON.stringify({ at: nowIso(), screen: screen || '', in: input ?? null, say: spoken(body) });
      await run(env, `UPDATE phone_calls SET events = CASE WHEN steps < ${MAX_EVENTS} THEN json_insert(events, '$[#]', json(?)) ELSE events END,
        steps = steps + 1, last_at = ? WHERE ${where}`, ev, nowIso(), log.line, callId);
    },
    end: (callId) => run(env, `UPDATE phone_calls SET ended_at = ? WHERE ${where} AND ended_at IS NULL`, nowIso(), log.line, callId),
    /** Listening line: a search and how many minyanim were read. */
    async search(callId, { area, prayer, from, found }) {
      await run(env, `INSERT INTO phone_searches (call_id, area_id, prayer_id, from_min, found) SELECT id, ?, ?, ?, ? FROM phone_calls WHERE ${where}`,
        area ?? null, prayer ?? null, from ?? null, found, log.line, callId);
      await run(env, `UPDATE phone_calls SET searches = searches + 1, heard = heard + ? WHERE ${where}`, found, log.line, callId);
    },
    prune: () => run(env, `DELETE FROM phone_calls WHERE started_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-180 days')`),
  };
}
