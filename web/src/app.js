// Public site: minyan times by area, prayer and day. Read-only, no login.
import { h, render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const CONFIG = window.ZMANIM_CONFIG || {};
const SITE_ROOT = location.origin + location.pathname.replace(/[^/]*$/, '');
const API = (CONFIG.apiBase || SITE_ROOT).replace(/\/$/, '') + '/api/public';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const cx = (...p) => p.filter(Boolean).join(' ');
const norm = (s) => String(s ?? '').toLowerCase().replace(/["'׳״\s-]/g, '');
const formatPhone = (p) => (p && p.length === 9 ? `${p.slice(0, 2)}-${p.slice(2)}` : p && p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3)}` : p);

const store = {
  get(k, fallback) { try { const v = localStorage.getItem('zmanim.public.' + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('zmanim.public.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/** Current day (0 = Sunday) and "HH:MM" in Israel, whatever the visitor's time zone. */
function israelNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, time: `${parts.hour}:${parts.minute}` };
}
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function dateForDay(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
}

async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('לא ניתן לטעון את הנתונים כרגע');
  return res.json();
}

// ------------------------------------------------------------------ icons
const PATHS = {
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  pin: 'M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  building: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  back: 'M5 12h14M13 5l7 7-7 7',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};
const Icon = ({ name, size = 18 }) => html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${PATHS[name]} /></svg>`;

// ------------------------------------------------------------------ theme
function useTheme() {
  const [theme, setTheme] = useState(() => store.get('theme', ''));
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    store.set('theme', theme);
  }, [theme]);
  const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
  return [dark, () => setTheme(dark ? 'light' : 'dark')];
}

// ------------------------------------------------------------------ routing
function useHashRoute() {
  const read = () => location.hash.replace(/^#/, '') || '/';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => { setPath(read()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return path;
}

// ------------------------------------------------------------------ app
function App() {
  const path = useHashRoute();
  const [dark, toggleTheme] = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    Promise.all([get('/catalog'), get('/synagogues'), get('/minyanim')])
      .then(([catalog, synagogues, minyanim]) => setData({ catalog, synagogues, minyanim, byId: new Map(synagogues.map((s) => [s.id, s])) }))
      .catch(setError);
  };
  useEffect(load, []);

  const sMatch = path.match(/^\/s\/(\d+)/);
  let page;
  if (error) page = html`<div class="state"><b>${error.message}</b><button class="btn" onClick=${load}>נסו שוב</button></div>`;
  else if (!data) page = html`<div class="state"><span class="spinner" /> טוען את הזמנים…</div>`;
  else if (sMatch) page = html`<${SynagoguePage} data=${data} id=${Number(sMatch[1])} />`;
  else page = html`<${Home} data=${data} />`;

  return html`
    <header class="top">
      <div class="wrap top-row">
        <a class="brand" href="#/"><span class="brand-mark"><${Icon} name="clock" /></span><span>זמני מניינים</span></a>
        <div class="top-actions">
          ${CONFIG.phone && html`<a class="phone-pill" href=${`tel:${CONFIG.phone}`}><${Icon} name="phone" size=${16} /><span dir="ltr">${formatPhone(CONFIG.phone)}</span></a>`}
          <button class="icon-btn" onClick=${toggleTheme} aria-label=${dark ? 'מצב בהיר' : 'מצב כהה'}><${Icon} name=${dark ? 'sun' : 'moon'} /></button>
        </div>
      </div>
    </header>
    <main class="wrap">${page}</main>
    <footer class="foot">
      <div class="wrap foot-row">
        <span>זמני מניינים</span>
        ${CONFIG.phone && html`<a href=${`tel:${CONFIG.phone}`}>שמיעה בטלפון: <span dir="ltr">${formatPhone(CONFIG.phone)}</span></a>`}
        <a href="admin/" class="foot-admin"><${Icon} name="lock" size=${14} /> כניסת מנהלים</a>
      </div>
    </footer>`;
}

// ------------------------------------------------------------------ home
function Home({ data }) {
  const { catalog, minyanim, byId } = data;
  const now = israelNow();
  const defaultSeason = catalog.seasons.find((s) => s.is_default)?.id ?? null;

  const [offset, setOffset] = useState(0); // days from today
  const [area, setArea] = useState(() => store.get('area', null));
  const [prayer, setPrayer] = useState(null);
  const [season, setSeason] = useState(defaultSeason);
  const [q, setQ] = useState('');
  const [view, setView] = useState(() => store.get('view', 'time'));
  useEffect(() => store.set('area', area), [area]);
  useEffect(() => store.set('view', view), [view]);

  const day = (now.day + offset) % 7;
  const validArea = area !== null && catalog.areas.some((a) => a.id === area) ? area : null;

  const shown = useMemo(() => minyanim.filter((m) => {
    const s = byId.get(m.synagogue_id);
    return s && (m.days & (1 << day)) &&
      (validArea === null || s.area_id === validArea) &&
      (prayer === null || m.prayer_id === prayer) &&
      (season === null || m.season_id === null || m.season_id === season) &&
      (!q || norm(`${s.name} ${s.address} ${s.area_name || ''} ${m.location_name || ''}`).includes(norm(q)));
  }), [minyanim, day, validArea, prayer, season, q]);

  const upcoming = offset === 0
    ? shown.filter((m) => m.time_kind === 'fixed' && toMinutes(m.time) >= toMinutes(now.time))
        .sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6)
    : [];

  return html`
    <section class="hero">
      <h1>זמני מניינים</h1>
      <p>כל המניינים בבתי הכנסת, לפי אזור, תפילה ויום.</p>
      ${CONFIG.phone && html`<a class="hero-phone" href=${`tel:${CONFIG.phone}`}>
        <span class="hero-phone-icon"><${Icon} name="phone" size=${20} /></span>
        <span><small>${CONFIG.phoneReady ? 'שמיעת הזמנים בטלפון' : 'בקרוב: שמיעת הזמנים בטלפון'}</small><b dir="ltr">${formatPhone(CONFIG.phone)}</b></span>
      </a>`}
    </section>

    <div class="days" role="tablist" aria-label="יום">
      ${[0, 1, 2, 3, 4, 5, 6].map((o) => {
        const d = (now.day + o) % 7;
        return html`<button role="tab" aria-selected=${offset === o} class=${cx('day', offset === o && 'on', d === 6 && 'shabbat')} onClick=${() => setOffset(o)}>
          <b>${o === 0 ? 'היום' : o === 1 ? 'מחר' : DAY_NAMES[d]}</b><small>${o < 2 ? `יום ${DAY_SHORT[d]}` : dateForDay(o)}</small></button>`;
      })}
    </div>

    <div class="filters">
      <div class="search"><${Icon} name="search" /><input type="search" placeholder="חיפוש בית כנסת או כתובת" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${catalog.areas.length > 0 && html`<div class="chips" role="group" aria-label="אזור">
        <button class=${cx('chip', validArea === null && 'on')} onClick=${() => setArea(null)}>כל האזורים</button>
        ${catalog.areas.map((a) => html`<button class=${cx('chip', validArea === a.id && 'on')} onClick=${() => setArea(a.id)}>${a.name}</button>`)}
      </div>`}
      <div class="filters-row">
        <div class="seg" role="group" aria-label="תפילה">
          <button class=${cx(prayer === null && 'on')} onClick=${() => setPrayer(null)}>הכל</button>
          ${catalog.prayers.map((p) => html`<button class=${cx(prayer === p.id && 'on')} onClick=${() => setPrayer(p.id)}>${p.name}</button>`)}
        </div>
        ${catalog.seasons.length > 1 && html`<select class="select" value=${season ?? ''} onChange=${(e) => setSeason(e.currentTarget.value ? Number(e.currentTarget.value) : null)} aria-label="עונה">
          ${catalog.seasons.map((s) => html`<option value=${s.id}>זמני ${s.name}</option>`)}
          <option value="">כל העונות</option>
        </select>`}
        <div class="seg view-toggle" role="group" aria-label="תצוגה">
          <button class=${cx(view === 'time' && 'on')} onClick=${() => setView('time')}><${Icon} name="clock" size=${16} /> לפי שעה</button>
          <button class=${cx(view === 'syn' && 'on')} onClick=${() => setView('syn')}><${Icon} name="building" size=${16} /> לפי בית כנסת</button>
        </div>
      </div>
    </div>

    ${upcoming.length > 0 && !q && html`<section class="upcoming">
      <h2>המניינים הקרובים</h2>
      <div class="upcoming-row">${upcoming.map((m) => {
        const mins = toMinutes(m.time) - toMinutes(now.time);
        const s = byId.get(m.synagogue_id);
        return html`<a class="up-card" href=${`#/s/${s.id}`}>
          <span class="up-in">${mins === 0 ? 'עכשיו' : mins < 60 ? `בעוד ${mins} דק׳` : `בעוד ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')} שע׳`}</span>
          <b class="up-time">${m.time}</b><span>${m.prayer_name}</span><small>${s.name}</small></a>`;
      })}</div>
    </section>`}

    ${shown.length === 0
      ? html`<div class="state"><b>אין מניינים שמתאימים לבחירה</b><span>נסו יום, אזור או תפילה אחרים</span></div>`
      : view === 'time' ? html`<${ByTime} list=${shown} byId=${byId} catalog=${catalog} />` : html`<${BySynagogue} list=${shown} byId=${byId} />`}
  `;
}

function groupByPrayer(list, catalog) {
  const order = new Map(catalog.prayers.map((p, i) => [p.id, i]));
  const groups = new Map();
  for (const m of list) {
    if (!groups.has(m.prayer_id)) groups.set(m.prayer_id, { name: m.prayer_name, fixed: [], relative: [] });
    groups.get(m.prayer_id)[m.time_kind === 'fixed' ? 'fixed' : 'relative'].push(m);
  }
  return [...groups.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99)).map(([, g]) => {
    g.fixed.sort((a, b) => a.time.localeCompare(b.time));
    g.relative.sort((a, b) => a.anchor_id - b.anchor_id || a.offset_minutes - b.offset_minutes);
    return g;
  });
}

function ByTime({ list, byId, catalog }) {
  return html`<div class="groups">${groupByPrayer(list, catalog).map((g) => html`<section class="group">
    <h2>${g.name} <small>${g.fixed.length + g.relative.length}</small></h2>
    <div class="rows">
      ${[...g.fixed, ...g.relative].map((m) => {
        const s = byId.get(m.synagogue_id);
        return html`<a class="row" href=${`#/s/${s.id}`}>
          <span class=${cx('time', m.time_kind === 'relative' && 'rel')}>${m.time_label}</span>
          <span class="row-main"><b>${s.name}</b>
            <small>${[s.area_name, m.location_name].filter(Boolean).join(' · ')}${m.notes ? ` · ${m.notes}` : ''}</small></span>
        </a>`;
      })}
    </div>
  </section>`)}</div>`;
}

function BySynagogue({ list, byId }) {
  const bySyn = new Map();
  for (const m of list) {
    if (!bySyn.has(m.synagogue_id)) bySyn.set(m.synagogue_id, []);
    bySyn.get(m.synagogue_id).push(m);
  }
  const syns = [...bySyn.keys()].map((id) => byId.get(id)).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return html`<div class="cards">${syns.map((s) => {
    const prayers = new Map();
    for (const m of bySyn.get(s.id)) {
      if (!prayers.has(m.prayer_name)) prayers.set(m.prayer_name, []);
      prayers.get(m.prayer_name).push(m);
    }
    return html`<a class="card" href=${`#/s/${s.id}`}>
      <div class="card-head"><b>${s.name}</b><small>${[s.area_name, s.address].filter(Boolean).join(' · ')}</small></div>
      ${[...prayers.entries()].map(([name, ms]) => html`<div class="card-line"><span class="card-prayer">${name}</span>
        <span class="times">${ms.map((m) => html`<span class=${cx('t', m.time_kind === 'relative' && 'rel')}>${m.time_label}</span>`)}</span></div>`)}
    </a>`;
  })}</div>`;
}

// ------------------------------------------------------------------ synagogue page
function SynagoguePage({ data, id }) {
  const s = data.byId.get(id);
  const today = israelNow().day;
  const [day, setDay] = useState(null); // null = whole week
  if (!s) return html`<div class="state"><b>בית הכנסת לא נמצא</b><a class="btn" href="#/">לכל בתי הכנסת</a></div>`;
  const all = data.minyanim.filter((m) => m.synagogue_id === id);
  const list = day === null ? all : all.filter((m) => m.days & (1 << day));
  const groups = groupByPrayer(list, data.catalog);
  const mapUrl = s.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}` : null;

  return html`
    <a class="back" href="#/"><${Icon} name="back" size=${16} /> לכל בתי הכנסת</a>
    <section class="syn-head">
      <h1>${s.name}</h1>
      <div class="syn-meta">
        ${s.area_name && html`<span><${Icon} name="pin" size=${16} /> ${s.area_name}</span>`}
        ${s.address && html`<a href=${mapUrl} target="_blank" rel="noopener"><${Icon} name="map" size=${16} /> ${s.address}</a>`}
        ${s.phone && html`<a href=${`tel:${s.phone}`}><${Icon} name="phone" size=${16} /> <span dir="ltr">${s.phone}</span></a>`}
      </div>
      ${s.notes && html`<p class="syn-notes">${s.notes}</p>`}
    </section>
    <div class="chips">
      <button class=${cx('chip', day === null && 'on')} onClick=${() => setDay(null)}>כל השבוע</button>
      ${DAY_NAMES.map((n, i) => html`<button class=${cx('chip', day === i && 'on')} onClick=${() => setDay(i)}>${i === today ? `היום (${n})` : n}</button>`)}
    </div>
    ${groups.length === 0
      ? html`<div class="state"><b>אין מניינים ${day === null ? 'רשומים' : 'ביום זה'}</b></div>`
      : html`<div class="groups">${groups.map((g) => html`<section class="group">
          <h2>${g.name}</h2>
          <div class="rows">${[...g.fixed, ...g.relative].map((m) => html`<div class="row static">
            <span class=${cx('time', m.time_kind === 'relative' && 'rel')}>${m.time_label}</span>
            <span class="row-main"><span class="week">${DAY_SHORT.map((d, i) => html`<i class=${cx(m.days & (1 << i) && 'on', i === today && 'today')}>${d.replace('׳', '')}</i>`)}</span>
              <small>${[m.location_name, m.season_name && `זמני ${m.season_name}`, m.notes].filter(Boolean).join(' · ')}</small></span>
          </div>`)}</div>
        </section>`)}</div>`}`;
}

// Remove the static "loading" placeholder first (it also disarms the load-error watchdog in index.html).
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
