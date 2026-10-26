// Times of day (sunrise, sunset, ...) for a date and place, so minyanim set relative to them get a clock time.
// NOAA solar position formulas; accurate to about a minute, which is what a minyan time needs.

/** What an anchor can be computed as. `angle` = degrees below the horizon (sunrise/sunset include refraction). */
export const CALCS = {
  alot: { name: 'עלות השחר', angle: 16.1, rising: true },
  sunrise: { name: 'הנץ החמה', angle: 0.833, rising: true },
  chatzot: { name: 'חצות היום', noon: true },
  sunset: { name: 'שקיעה', angle: 0.833, rising: false },
  tzeit: { name: 'צאת הכוכבים', angle: 8.5, rising: false },
  rabbeinu_tam: { name: 'זמן רבינו תם', angle: 0.833, rising: false, plus: 72 }, // 72 minutes after sunset
};

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Sun declination and equation of time (minutes) at a Julian day. */
function sun(jd) {
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * m)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(
    y * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(m)) + 4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0))
    - 0.5 * y * y * Math.sin(4 * rad(l0)) - 1.25 * e * e * Math.sin(2 * rad(m))
  );
  return { decl, eqTime };
}

/** Minutes after UTC midnight of the event on a civil date, or null (sun never reaches the angle). */
function utcMinutes(y, mo, d, lat, lng, calc) {
  const jd0 = Date.UTC(y, mo - 1, d) / 86400000 + 2440587.5;
  let minutes = 720 - 4 * lng;
  for (let i = 0; i < 2; i++) { // refine at the event's own time
    const { decl, eqTime } = sun(jd0 + minutes / 1440);
    const noon = 720 - 4 * lng - eqTime;
    if (calc.noon) { minutes = noon; continue; }
    const cosH = (Math.cos(rad(90 + calc.angle)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
    if (cosH < -1 || cosH > 1) return null;
    const h = 4 * deg(Math.acos(cosH));
    minutes = calc.rising ? noon - h : noon + h;
  }
  return minutes;
}

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "YYYY-MM-DD" of a moment, in Israel. */
export const israelDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(date);

/** Israel clock time ("HH:MM") of an anchor kind on an Israel date ("YYYY-MM-DD"). */
export function zmanTime(dateStr, kind, { lat, lng }) {
  const calc = CALCS[kind];
  if (!calc) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const min = utcMinutes(y, mo, d, lat, lng, calc);
  if (min === null) return null;
  return clock.format(new Date(Date.UTC(y, mo - 1, d) + Math.round(min + (calc.plus || 0)) * 60000));
}

/** { anchorId: "HH:MM" } for every computable anchor on a date. */
export function anchorTimes(anchors, dateStr, place) {
  const out = {};
  for (const a of anchors) {
    const t = a.calc && zmanTime(dateStr, a.calc, place);
    if (t) out[a.id] = t;
  }
  return out;
}

/** Clock time of a relative minyan from its anchor's time, or null when the anchor is not computed. */
export function relativeClock(m, times) {
  const base = times[m.anchor_id];
  if (!base) return null;
  const total = Number(base.slice(0, 2)) * 60 + Number(base.slice(3)) + (m.offset_minutes || 0);
  if (total < 0 || total >= 1440) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The place times are computed for (system setting; default Jerusalem). */
export const placeOf = (settings) => ({ lat: Number(settings.zmanim_lat) || 31.778, lng: Number(settings.zmanim_lng) || 35.235 });
