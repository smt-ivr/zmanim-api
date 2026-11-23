// The extensions' settings, kept in the database per list (minutes_settings, key "cfg:<list>") and edited in
// the admin page. Yemot's extension settings need only the link and the key; parameters such as max= or
// per= in the extension are ignored.
import { first, run } from './data.js';
import { parsePer } from './period.js';

export const DEFAULTS = { max: 60, times: 1, per: 'week', edit: true, showMax: true, say: 'all' };

const int = (v, lo, hi, dflt) => (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : dflt);
const perOk = (v) => ['day', 'week', 'month', 'ever'].includes(v) || /^\d{1,4}[mhd]$/.test(v);

/** Cleans a settings object (from the database or the page); a missing or invalid value keeps the one in `base`. */
export function clean(c = {}, base = DEFAULTS) {
  return {
    max: int(c.max, 1, 99999, base.max),
    times: int(c.times, 1, 999, base.times),
    per: perOk(String(c.per)) && (parsePer(c.per).kind !== 'rolling' || parsePer(c.per).n > 0) ? String(c.per) : base.per,
    edit: typeof c.edit === 'boolean' ? c.edit : base.edit,
    showMax: typeof c.showMax === 'boolean' ? c.showMax : base.showMax,
    say: ['all', 'both', 'mine'].includes(c.say) ? c.say : base.say,
  };
}

export async function getConfig(env, list) {
  const row = await first(env, `SELECT value FROM minutes_settings WHERE key = ?`, `cfg:${list}`);
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  return clean(saved, DEFAULTS);
}

export async function saveConfig(env, list, c) {
  const value = clean(c, await getConfig(env, list)); // only valid values change
  await run(env, `INSERT INTO minutes_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, `cfg:${list}`, JSON.stringify(value));
  return value;
}
