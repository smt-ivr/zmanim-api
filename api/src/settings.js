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
        k, SETTINGS[k].type === 'bool' ? (v ? '1' : '0') : String(v))
    );
  if (statements.length) await batch(env, statements);
}

/** Days mask as the public sees it (Shabbat removed while Shabbat is disabled). */
export const visibleDays = (mask, settings) => (settings.shabbat_enabled ? mask : mask & ~SHABBAT_BIT);
