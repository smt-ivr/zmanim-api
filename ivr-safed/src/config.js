// Everything specific to this synagogue. Change here only.

/** Safed, as in the Itim LeBina calendar (elevation 779 m). */
export const PLACE = { lat: 32.96465, lng: 35.496, elevation: 779, tz: 'Asia/Jerusalem' };

/** Candle lighting: this many minutes before sunset-from-elevation (Itim LeBina, Safed). */
export const CANDLE_MINUTES = 30;

/**
 * Our sunset comes out 7–18 seconds later than Itim LeBina's (it rounds down to 15 s).
 * Taking 10 s off makes every minute match the calendar (checked on 8–13 Nov 2026).
 */
export const CORRECTION_SECONDS = -10;

/**
 * Defaults for what the extension says, in order. `before`: minutes before candle lighting
 * (0 = at candle lighting, negative = after); null = not said unless the link gives a value.
 * Every value can be changed from the link in ext.ini, see README.md.
 */
export const ITEMS = [
  { key: 'kollel', name: 'כולל ערב שבת', before: null },
  { key: 'minha', name: 'מנחה ערב שבת', before: 0 },
];

/** Manual fixes for a specific Friday, if the calendar ever differs: { '2026-11-13': '16:12' }. */
export const CANDLE_OVERRIDES = {};
