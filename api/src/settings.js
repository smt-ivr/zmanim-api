// System-wide control settings (super admin). Stored as strings in the settings table.
import { all, batch, q } from './db.js';

export const SETTINGS = {
  shabbat_enabled: { type: 'bool', default: false },      // Shabbat minyanim visible/editable
  public_site_enabled: { type: 'bool', default: true },   // public site + public API
  site_notice: { type: 'text', default: '', max: 300 },   // banner on the public site
  listen_phone: { type: 'text', default: '043132030', max: 20 }, // number shown on the public site
  listen_enabled: { type: 'bool', default: true },        // public listening phone line
  manage_phone_enabled: { type: 'bool', default: true },  // management phone line
  feedback_enabled: { type: 'bool', default: true },      // messages to the developers
  minyan_notes_enabled: { type: 'bool', default: false }, // free-text note on a minyan
  public_season_choice: { type: 'bool', default: false }, // public may view other seasons (default: current only)
  mail_enabled: { type: 'bool', default: false },         // send e-mail through Resend
  mail_from: { type: 'text', default: '', max: 200 },     // "זמני מניינים <noreply@example.com>"
  resend_api_key: { type: 'secret', default: '', max: 200 }, // never returned to the browser in full
  magic_link_enabled: { type: 'bool', default: true },    // login with a one-time e-mail link
  password_reset_enabled: { type: 'bool', default: true },
  google_login_enabled: { type: 'bool', default: true },  // "Sign in with Google" (matched by the user's e-mail)
  google_client_id: { type: 'text', default: '89500817024-tbvsuu4dci6bqh173l65ua9lc65pe24p.apps.googleusercontent.com', max: 200 },
  zmanim_lat: { type: 'text', default: '31.778', max: 12 }, // where sunrise/sunset are computed (default Jerusalem)
  zmanim_lng: { type: 'text', default: '35.235', max: 12 },
};

export const SHABBAT_BIT = 64;

export async function getSettings(env) {
  const rows = await all(env, `SELECT key, value FROM settings`);
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    Object.entries(SETTINGS).map(([k, def]) => [k, raw[k] === undefined ? def.default : def.type === 'bool' ? raw[k] === '1' : raw[k]])
  );
}

export async function saveSettings(env, values) {
  const statements = Object.entries(values)
    .filter(([k]) => SETTINGS[k])
    .map(([k, v]) =>
      q(env, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        k, SETTINGS[k].type === 'bool' ? (v ? '1' : '0') : String(v ?? ''))
    );
  if (statements.length) await batch(env, statements);
}

/** Settings safe to show in the control panel (secrets masked). */
export function publicView(settings) {
  const out = { ...settings };
  for (const [k, def] of Object.entries(SETTINGS)) {
    if (def.type === 'secret') out[k] = settings[k] ? `••••${settings[k].slice(-4)}` : '';
  }
  out.mail_ready = Boolean(settings.mail_enabled && settings.resend_api_key && settings.mail_from);
  return out;
}

// ------------------------------------------------------------------ seasons
/** Today's month-day in Israel, 'MM-DD'. */
export function israelMonthDay(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.month}-${p.day}`;
}

/** Rosh Chodesh in Israel on this date: day 30 or day 1 of the Hebrew month (Rosh Hashana is not counted). */
export function isRoshChodesh(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const d = Number(p.day);
  return d === 30 || (d === 1 && !/^Tishri/.test(p.month));
}

/**
 * The current season: when seasons have start dates (MM-DD), the one that started last (wrapping
 * around the year); otherwise the season marked as default. null when there are no seasons.
 */
export async function currentSeason(env, today = israelMonthDay()) {
  const seasons = await all(env, `SELECT id, name, starts_md, is_default FROM seasons ORDER BY sort, id`);
  const dated = seasons.filter((s) => s.starts_md).sort((a, b) => a.starts_md.localeCompare(b.starts_md));
  if (dated.length) return [...dated].reverse().find((s) => s.starts_md <= today) ?? dated.at(-1);
  return seasons.find((s) => s.is_default) ?? seasons[0] ?? null;
}

/** Days mask as the public sees it (Shabbat removed while Shabbat is disabled). */
export const visibleDays = (mask, settings) => (settings.shabbat_enabled ? mask : mask & ~SHABBAT_BIT);
