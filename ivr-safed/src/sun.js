// Sunset for a place and date, to the second (NOAA solar position algorithm).
// "Sunset from elevation" lowers the horizon by the dip of an observer at that height,
// the way the Itim LeBina calendar does for most cities.

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Julian century for a UTC instant (ms). */
const century = (ms) => (ms / 86400000 + 2440587.5 - 2451545) / 36525;

/** Solar declination (deg) and equation of time (minutes) at Julian century t. */
function solar(t) {
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * M)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M))
    + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0))
    - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  return { decl, eqTime };
}

/**
 * Sunset as a UTC instant (ms) on the civil date y-m-d at lat/lng, seen from `elevation` metres.
 * Iterates twice so the sun's position is taken at the moment of sunset itself.
 */
export function sunset(y, m, d, { lat, lng, elevation = 0 }) {
  const zenith = 90 + 50 / 60 + (elevation > 0 ? 0.0347 * Math.sqrt(elevation) : 0);
  const midnight = Date.UTC(y, m - 1, d);
  let minutes = 720 - 4 * lng; // first guess: solar noon
  for (let i = 0; i < 3; i++) {
    const { decl, eqTime } = solar(century(midnight + minutes * 60000));
    const cosH = Math.cos(rad(zenith)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
    const H = deg(Math.acos(cosH));
    minutes = 720 - 4 * (lng - H) - eqTime;
  }
  return midnight + minutes * 60000;
}
