// The synagogue workspace: what a manager sees after login. Admins open any synagogue the same way.
import { api, fetchBlob } from '../api.js';
import { ALL_DAYS, DAY_FULL, VIA, cx, html, navigate, norm, pluralize, rememberSynagogue, timeAgo, useEffect, useMemo, useState } from '../lib.js';
import {
  Avatar, Badge, Button, DaysBadge, DaysPicker, Empty, ErrorBox, Field, FormModal, Icon, Input, Meter, Modal, Select, Spinner,
  TextArea, Toggle, confirm, toast, toastError, useLoad,
} from '../ui.js';
import { ChangeFeed } from './history.js';

export function SynagoguePicker({ synagogues }) {
  const [q, setQ] = useState('');
  if (!synagogues.length) {
    return html`<div class="page"><${Empty} icon="building" title="עדיין לא שויכת לבית כנסת">
      ההנהלה צריכה לשייך אותך לבית הכנסת שלך. לאחר השיוך הוא יופיע כאן.<//></div>`;
  }
  const shown = synagogues.filter((s) => !q || norm(`${s.name} ${s.area_name || ''}`).includes(norm(q)));
  return html`<div class="page">
    <header class="page-head"><div><h1>בתי הכנסת שלי</h1><p class="muted">${pluralize(synagogues.length, 'בית כנסת', 'בתי כנסת')}</p></div>
      ${synagogues.length > 6 && html`<div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>`}</header>
    <div class="cards">
      ${shown.map((s) => html`<a class="card card-link" href=${`#/s/${s.id}`}>
        <span class="stat-icon"><${Icon} name="building" size=${20} /></span><div class="grow"><b>${s.name}</b><div class="muted small">${s.area_name || ''}</div></div><${Icon} name="chevron" /></a>`)}
    </div>
  </div>`;
}

export function Workspace({ id, user, system, onChanged }) {
  const shabbat = system?.shabbat_enabled !== false;
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/synagogues/${id}`), [id]);
  const [tab, setTab] = useState('minyanim');
  useEffect(() => { if (data) rememberSynagogue(data.synagogue); }, [data?.synagogue.id]);

  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const { synagogue: s, settings, usage, managers } = data;
  const isAdmin = user.role === 'admin';
  // Local updates keep the screen instant; usage counters follow the lists.
  const update = (fn) => setData((d) => {
    const next = fn(d);
    return { ...next, usage: { locations: next.locations.length, minyanim: next.minyanim.length } };
  });

  const tabs = [
    ['minyanim', 'מניינים', usage.minyanim],
    ['locations', 'מיקומים', usage.locations],
    ...(isAdmin ? [['managers', 'גבאים', managers.length]] : []),
    ['info', 'פרטים'],
    ['history', 'היסטוריה'],
  ];
  const canSettings = isAdmin && user.perms.includes('synagogues');

  return html`<div class="page">
    ${isAdmin && html`<nav class="crumbs"><a href="#/admin/synagogues">בתי כנסת</a><span>›</span><span>${s.area_name || 'ללא אזור'}</span></nav>`}
    <header class="page-head ws-head">
      <div>
        <div class="row gap-sm wrap">
          <h1>${s.name}</h1>
          ${!s.is_active && html`<${Badge} tone="warn">מוסתר מהציבור<//>`}
        </div>
        <p class="muted">${[s.area_name, s.address].filter(Boolean).join(' · ') || 'ללא כתובת'}</p>
      </div>
      ${canSettings && html`<${Button} icon="settings" onClick=${() => navigate(`/admin/synagogues?edit=${s.id}`)}>הגדרות בית הכנסת<//>`}
      <div class="ws-meters">
        ${settings.max_minyanim > 0 && html`<${Meter} label="מניינים" used=${usage.minyanim} max=${settings.max_minyanim} />`}
        ${settings.max_locations > 0 && html`<${Meter} label="מיקומים" used=${usage.locations} max=${settings.max_locations} />`}
      </div>
    </header>

    <div class="tabs" role="tablist">
      ${tabs.map(([key, label, count]) => html`<button role="tab" aria-selected=${tab === key}
        class=${cx('tab', tab === key && 'active')} onClick=${() => setTab(key)}>${label}${count !== undefined && html`<span class="count">${count}</span>`}</button>`)}
    </div>

    ${tab === 'minyanim' && html`<${MinyanimTab} data=${data} update=${update} shabbat=${shabbat} />`}
    ${tab === 'locations' && html`<${LocationsTab} data=${data} update=${update} />`}
    ${tab === 'info' && html`<${InfoTab} data=${data} isAdmin=${isAdmin && !settings.read_only} onSaved=${(d) => { setData(d); onChanged(); }} />`}
    ${tab === 'managers' && html`<${ManagersTab} data=${data} user=${user} reload=${reload} />`}
    ${tab === 'history' && html`<${HistoryTab} synagogueId=${s.id} user=${user} />`}
  </div>`;
}

// ------------------------------------------------------------------ minyanim
function MinyanimTab({ data, update, shabbat }) {
  const { synagogue: s, settings, minyanim, locations, catalog } = data;
  const [view, setView] = useState(() => { try { return localStorage.getItem('zmanim.view') || 'list'; } catch { return 'list'; } });
  // Every minyan belongs to a season; the screen always works inside one season (the current one by default).
  const [season, setSeason] = useState(catalog.current_season?.id ?? catalog.seasons[0]?.id ?? null);
  const seasonName = catalog.seasons.find((x) => x.id === season)?.name ?? '';
  const [location, setLocation] = useState(null);
  // Managers edit the current season only, unless the synagogue allows more.
  const editableSeasons = settings.editable_season_ids;
  const seasonEditable = season !== null && (!editableSeasons || editableSeasons.includes(season));
  const canEdit = () => seasonEditable;
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | minyan
  const [copying, setCopying] = useState(false);

  const setViewSaved = (v) => { setView(v); try { localStorage.setItem('zmanim.view', v); } catch { /* ignore */ } };
  const base = `/synagogues/${s.id}/minyanim`;
  const full = Boolean(settings.max_minyanim) && minyanim.length >= settings.max_minyanim; // 0 = unlimited

  const shown = useMemo(() => minyanim.filter((m) =>
    m.season_id === season &&
    (location === null || m.location_id === location) &&
    (!q || norm(`${m.prayer_name} ${m.time_label} ${m.location_name || ''} ${m.notes}`).includes(norm(q)))
  ), [minyanim, season, location, q]);

  const replace = (m) => update((d) => ({ ...d, minyanim: sortMinyanim(d.minyanim.map((x) => (x.id === m.id ? m : x)), catalog) }));
  const add = (m) => update((d) => ({ ...d, minyanim: sortMinyanim([...d.minyanim, m], catalog) }));

  async function toggleActive(m) {
    try { replace(await api.patch(`${base}/${m.id}`, { is_active: !m.is_active })); toast(m.is_active ? 'המניין הוסתר מהציבור' : 'המניין מוצג לציבור'); }
    catch (e) { toastError(e); }
  }
  async function duplicate(m) {
    try { const copy = await api.post(`${base}/${m.id}/duplicate`); add(copy); setEditing(copy); }
    catch (e) { toastError(e); }
  }
  async function remove(m) {
    const ok = await confirm({ title: 'מחיקת מניין', body: `למחוק את ${m.prayer_name} ב-${m.time_label}?`, confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    try { await api.del(`${base}/${m.id}`); update((d) => ({ ...d, minyanim: d.minyanim.filter((x) => x.id !== m.id) })); toast('המניין נמחק'); }
    catch (e) { toastError(e); }
  }

  const actions = { edit: setEditing, duplicate, remove, toggleActive, full, canEdit };
  const inSeason = minyanim.filter((m) => m.season_id === season);
  const canCopy = seasonEditable && catalog.seasons.length > 1;
  const reload = async () => { const d = await api.get(`/synagogues/${s.id}`); update(() => d); };

  if (season === null) {
    return html`<${Empty} icon="clock" title="לא הוגדרו עונות">לפני הוספת מניינים יש להגדיר עונות (למשל קיץ וחורף). פנו להנהלה.<//>`;
  }

  const current = catalog.current_season;
  const otherSeason = current && season !== current.id;
  // Other seasons are a side option: a small selector, with a note while one is shown.
  const seasonSelect = catalog.seasons.length > 1 && html`<label class="season-select" title="עונה">
    <${Icon} name="clock" size=${16} />
    <select value=${season} onChange=${(e) => setSeason(Number(e.currentTarget.value))} aria-label="עונה">
      ${catalog.seasons.map((x) => html`<option value=${x.id}>זמני ${x.name}${x.id === current?.id ? ' (העונה הנוכחית)' : ''}</option>`)}
    </select></label>`;

  return html`<section>
    ${settings.read_only && html`<div class="alert alert-info">צפייה בלבד: אין לך הרשאה לעדכן זמנים בבתי כנסת. לשינוי פנו להנהלה.</div>`}
    ${otherSeason && html`<div class="alert alert-season">
      <span>מוצגים <b>זמני ${seasonName}</b>, לא העונה הנוכחית.${!seasonEditable && !settings.read_only ? ' לעדכון עונה זו פנו להנהלה.' : ''}</span>
      <button class="link" onClick=${() => setSeason(current.id)}>חזרה לזמני ${current.name}</button></div>`}
    <div class="toolbar">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש מניין…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${locations.length > 0 && html`<${Select} value=${location} onChange=${setLocation} placeholder="כל המיקומים"
          options=${locations.map((x) => ({ value: x.id, label: x.name }))} />`}
      <div class="segmented" role="group" aria-label="תצוגה">
        <button class=${cx(view === 'list' && 'on')} onClick=${() => setViewSaved('list')}><${Icon} name="list" /> רשימה</button>
        <button class=${cx(view === 'week' && 'on')} onClick=${() => setViewSaved('week')}><${Icon} name="grid" /> שבועי</button>
      </div>
      ${seasonSelect}
      <span class="grow" />
      ${canCopy && html`<${Button} kind="ghost" icon="copy" onClick=${() => setCopying(true)}>העתקה מעונה אחרת<//>`}
      ${seasonEditable && html`<${Button} kind="primary" icon="plus" disabled=${full} title=${full ? 'הגעתם למכסת המניינים' : ''} onClick=${() => setEditing('new')}>מניין חדש<//>`}
    </div>

    ${inSeason.length === 0
      ? html`<${Empty} icon="clock" title=${`עדיין אין מניינים בזמני ${seasonName}`}>
          ${seasonEditable ? 'הוסיפו מניין, או העתיקו את המניינים מעונה אחרת ועדכנו רק את מה שמשתנה.' : ''}
          ${seasonEditable && html`<div class="pad row gap-sm justify-center">
            <${Button} kind="primary" icon="plus" disabled=${full} onClick=${() => setEditing('new')}>מניין חדש<//>
            ${canCopy && html`<${Button} icon="copy" onClick=${() => setCopying(true)}>העתקה מעונה אחרת<//>`}
          </div>`}<//>`
      : shown.length === 0
        ? html`<${Empty} icon="search" title="אין מניינים שמתאימים לסינון" />`
        : view === 'list'
          ? html`<${MinyanList} minyanim=${shown} catalog=${catalog} actions=${actions} shabbat=${shabbat} notes=${settings.notes_enabled} />`
          : html`<${WeekView} minyanim=${shown} onEdit=${(m) => canEdit(m) && setEditing(m)} shabbat=${shabbat} />`}

    ${editing && html`<${MinyanModal} data=${data} shabbat=${shabbat} season=${season} seasonName=${seasonName} minyan=${editing === 'new' ? null : editing}
        onClose=${() => setEditing(null)} onSaved=${(m, isNew) => (isNew ? add(m) : replace(m))} />`}
    ${copying && html`<${CopySeasonModal} data=${data} to=${season} onClose=${() => setCopying(false)} onDone=${reload} />`}
  </section>`;
}

function sortMinyanim(list, catalog) {
  const order = new Map(catalog.prayers.map((p, i) => [p.id, i]));
  const key = (m) => [order.get(m.prayer_id) ?? 999, m.time_kind === 'relative' ? 1 : 0, m.time || '', m.anchor_id || 0, m.offset_minutes || 0, m.id];
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
}

function MinyanList({ minyanim, actions, shabbat, notes }) {
  const [history, setHistory] = useState(null);
  const groups = [];
  for (const m of minyanim) {
    const g = groups.at(-1);
    if (g && g.prayer === m.prayer_name) g.items.push(m);
    else groups.push({ prayer: m.prayer_name, items: [m] });
  }
  return html`<div class="groups">
    ${groups.map((g) => html`<div class="group">
      <div class="group-head"><h3>${g.prayer}</h3><span class="muted small">${pluralize(g.items.length, 'מניין', 'מניינים')}</span></div>
      <div class="minyan-list">
        ${g.items.map((m) => html`<div key=${m.id} class=${cx('minyan', !m.is_active && 'inactive')}>
          <button class="minyan-time" onClick=${() => actions.canEdit(m) && actions.edit(m)} title=${actions.canEdit(m) ? 'עריכה' : ''}>
            <span class=${cx('time', m.time_kind === 'relative' && 'relative')}>${m.time_label}</span>
          </button>
          <div class="minyan-info">
            <div class="row gap-sm wrap">
              <${DaysBadge} mask=${m.days} shabbat=${shabbat} />
              ${m.location_name && html`<span class="meta"><${Icon} name="pin" size=${14} />${m.location_name}</span>`}
              ${!m.is_active && html`<${Badge} tone="warn">מוסתר<//>`}
            </div>
            ${m.rosh_chodesh_time && html`<div class="muted small">ראש חודש: ${m.rosh_chodesh_time}</div>`}
            ${notes && m.notes && html`<div class="muted small">${m.notes}</div>`}
            <button class="updated-by" title="היסטוריית שינויים" onClick=${() => setHistory(m)}>
              <${Icon} name="history" size=${13} />
              ${m.updated_by_name ? `עודכן ע״י ${m.updated_by_name}` : 'עודכן'}${m.updated_via ? ` · ${VIA[m.updated_via]}` : ''} · ${timeAgo(m.updated_at)}
            </button>
          </div>
          ${actions.canEdit(m)
            ? html`<div class="minyan-actions">
                <${Button} kind="ghost" small icon=${m.is_active ? 'eye' : 'eyeOff'} title=${m.is_active ? 'הסתרה מהציבור' : 'הצגה לציבור'} onClick=${() => actions.toggleActive(m)} />
                <${Button} kind="ghost" small icon="copy" title="שכפול" disabled=${actions.full} onClick=${() => actions.duplicate(m)} />
                <${Button} kind="ghost" small icon="edit" title="עריכה" onClick=${() => actions.edit(m)} />
                <${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => actions.remove(m)} />
              </div>`
            : null}
        </div>`)}
      </div>
    </div>`)}
    ${history && html`<${Modal} title=${`היסטוריה: ${history.prayer_name} ${history.time_label}`} onClose=${() => setHistory(null)}>
      <${LogList} synagogueId=${history.synagogue_id} minyanId=${history.id} /><//>`}
  </div>`;
}

function LogList({ synagogueId, minyanId, canDelete = false }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/synagogues/${synagogueId}/log${minyanId ? `?minyan_id=${minyanId}` : ''}`), [synagogueId, minyanId]);
  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!data.length) return html`<${Empty} icon="history" title="אין עדיין שינויים רשומים">שינויים מכאן והלאה יירשמו: מי שינה, מה, ואיך (באתר או בטלפון).<//>`;
  return html`<${ChangeFeed} rows=${data} canDelete=${canDelete} onDeleted=${(id) => setData((d) => d.filter((l) => l.id !== id))} />`;
}

function HistoryTab({ synagogueId, user }) {
  return html`<section class="narrow-section"><div class="card"><${LogList} synagogueId=${synagogueId} canDelete=${user.is_super} /></div></section>`;
}

/** Managers of the synagogue (admins): add an existing manager or a new user, remove. */
function ManagersTab({ data, user, reload }) {
  const { synagogue: s, managers } = data;
  const may = user.perms.includes('managers');
  const [adding, setAdding] = useState(false);
  const [newUser, setNewUser] = useState(false);
  async function remove(m) {
    if (!(await confirm({ title: `הסרת ${m.name}`, body: `${m.name} לא ינהל יותר את ${s.name}. המשתמש עצמו לא יימחק.`, confirmLabel: 'הסרה', danger: true }))) return;
    try { await api.del(`/admin/synagogues/${s.id}/managers/${m.id}`); toast('הוסר'); reload(); } catch (e) { toastError(e); }
  }
  return html`<section class="narrow-section">
    ${may && html`<div class="toolbar"><span class="grow muted small">גבאי בית הכנסת מעדכנים את הזמנים באתר ובטלפון.</span>
      <${Button} icon="userPlus" onClick=${() => setAdding(true)}>הוספת גבאי קיים<//>
      <${Button} kind="primary" icon="plus" onClick=${() => setNewUser(true)}>משתמש חדש<//></div>`}
    ${managers.length === 0
      ? html`<${Empty} icon="users" title="אין גבאים לבית הכנסת">${may ? 'הוסיפו גבאי כדי שיוכל לעדכן את הזמנים.' : ''}<//>`
      : html`<div class="card list">${managers.map((m) => html`<div class="list-row" key=${m.id}>
          <${Avatar} name=${m.name} size=${34} />
          <div class="grow"><b>${m.name}</b>${!m.is_active ? html` <${Badge} tone="warn">מושבת<//>` : ''}
            <div class="muted small" dir="ltr">${[m.email, m.phone].filter(Boolean).join(' · ')}</div></div>
          <span class="muted small">${m.last_login_at ? `כניסה ${timeAgo(m.last_login_at)}` : 'עוד לא נכנס'}</span>
          ${may && html`<${Button} kind="ghost" small icon="trash" title="הסרה מבית הכנסת" onClick=${() => remove(m)} />`}
        </div>`)}</div>`}
    ${adding && html`<${AddManagerModal} synagogue=${s} exclude=${managers.map((m) => m.id)} onClose=${() => setAdding(false)} onDone=${reload} />`}
    ${newUser && html`<${NewManagerModal} synagogue=${s} onClose=${() => setNewUser(false)} onDone=${reload} />`}
  </section>`;
}

function AddManagerModal({ synagogue, exclude, onClose, onDone }) {
  const users = useLoad(() => api.get('/admin/users'));
  const [q, setQ] = useState('');
  const shown = (users.data || []).filter((u) => u.role === 'manager' && !exclude.includes(u.id) && (!q || norm(`${u.name} ${u.email} ${u.phone}`).includes(norm(q)))).slice(0, 40);
  const add = async (u) => {
    try { await api.post(`/admin/synagogues/${synagogue.id}/managers`, { user_id: u.id }); toast(`${u.name} נוסף כגבאי`); onClose(); onDone(); } catch (e) { toastError(e); }
  };
  return html`<${Modal} title=${`הוספת גבאי ל${synagogue.name}`} onClose=${onClose}>
    <div class="search wide"><${Icon} name="search" /><input class="input" placeholder="חיפוש לפי שם, מייל או טלפון…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} autofocus /></div>
    <div class="syn-results">${users.loading ? html`<${Spinner} />` : shown.length === 0 ? html`<div class="muted pad center">לא נמצאו גבאים</div>`
      : shown.map((u) => html`<button type="button" class="syn-item" onClick=${() => add(u)}><${Avatar} name=${u.name} size=${28} />
          <span class="grow"><b>${u.name}</b><small dir="ltr">${u.email} · ${u.phone}</small></span>
          <small class="muted">${pluralize(u.synagogues.length, 'בית כנסת', 'בתי כנסת')}</small></button>`)}</div>
  <//>`;
}

function NewManagerModal({ synagogue, onClose, onDone }) {
  const initial = { name: '', email: '', phone: '', password: Math.random().toString(36).slice(2, 10), send_welcome: true, must_change_password: true };
  return html`<${FormModal} title=${`משתמש חדש ל${synagogue.name}`} initial=${initial} submitLabel="יצירה" onClose=${onClose}
      save=${(v) => api.post('/admin/users', { ...v, role: 'manager', synagogue_ids: [synagogue.id] })}
      onSaved=${(u) => { toast(u.welcome_sent ? `${u.name} נוסף ונשלחו לו פרטי כניסה` : `${u.name} נוסף`); onDone(); }}>
    ${({ values: v, set, errors }) => html`
      <${Field} label="שם מלא" error=${errors.name}><${Input} value=${v.name} onInput=${set('name')} required autofocus /><//>
      <div class="grid-2">
        <${Field} label="מייל" error=${errors.email}><${Input} type="email" dir="ltr" value=${v.email} onInput=${set('email')} required /><//>
        <${Field} label="טלפון" error=${errors.phone}><${Input} type="tel" dir="ltr" value=${v.phone} onInput=${set('phone')} required /><//>
      </div>
      <${Toggle} checked=${v.send_welcome} onChange=${set('send_welcome')} label="לשלוח מייל עם כניסה ישירה" hint="המשתמש ייכנס בלחיצה ויבחר סיסמה משלו" />`}
  <//>`;
}

function WeekView({ minyanim, onEdit, shabbat }) {
  return html`<div class=${cx('week', !shabbat && 'no-shabbat')}>
    ${(shabbat ? DAY_FULL : DAY_FULL.slice(0, 6)).map((day, i) => {
      const items = minyanim.filter((m) => m.days & (1 << i));
      return html`<div class=${cx('week-day', i === 6 && 'shabbat')}>
        <div class="week-head">${day}</div>
        ${items.length === 0 && html`<div class="muted small pad">—</div>`}
        ${items.map((m) => html`<button class=${cx('week-item', !m.is_active && 'inactive')} onClick=${() => onEdit(m)}>
          <b>${m.time_label}</b><span>${m.prayer_name}${m.location_name ? ` · ${m.location_name}` : ''}</span></button>`)}
      </div>`;
    })}
  </div>`;
}

/** Anchors the prayer may use (an anchor without listed prayers fits all). */
const anchorsForPrayer = (anchors, prayerId) => anchors.filter((a) => !a.prayer_ids?.length || a.prayer_ids.includes(prayerId));

// The minyan's season is the one the screen is in: a new minyan is added to it, editing keeps it.
function MinyanModal({ data, minyan, shabbat, season, seasonName, onClose, onSaved }) {
  const { synagogue: s, settings, locations, catalog } = data;
  const isNew = !minyan;
  const initial = minyan
    ? { ...minyan, offset_dir: minyan.offset_minutes < 0 ? -1 : 1, offset_abs: Math.abs(minyan.offset_minutes ?? 0), rosh_chodesh_on: Boolean(minyan.rosh_chodesh_time) }
    : {
        prayer_id: catalog.prayers[0]?.id ?? null, time_kind: 'fixed', time: '', end_time: '', every_minutes: 15, anchor_id: null,
        offset_dir: -1, offset_abs: 0, days: shabbat ? ALL_DAYS : 63, location_id: locations[0]?.id ?? null,
        notes: '', is_active: true, rosh_chodesh_on: false, rosh_chodesh_time: '',
      };

  async function save(v) {
    const prayer = catalog.prayers.find((p) => p.id === v.prayer_id);
    const body = {
      prayer_id: v.prayer_id, time_kind: v.time_kind, days: v.days, location_id: v.location_id,
      is_active: v.is_active,
      time: v.time_kind !== 'relative' ? v.time || null : null,
      end_time: v.time_kind === 'interval' ? v.end_time || null : null,
      every_minutes: v.time_kind === 'interval' ? Number(v.every_minutes) || null : null,
      anchor_id: v.time_kind === 'relative' ? v.anchor_id : null,
      offset_minutes: v.time_kind === 'relative' ? (v.offset_abs === '' || v.offset_abs === null ? null : v.offset_dir * Number(v.offset_abs)) : null,
      rosh_chodesh_time: v.time_kind === 'fixed' && prayer?.has_rosh_chodesh && v.rosh_chodesh_on ? v.rosh_chodesh_time || null : null,
    };
    if (settings.notes_enabled) body.notes = v.notes;
    if (isNew) body.season_id = season;
    const base = `/synagogues/${s.id}/minyanim`;
    return isNew ? api.post(base, body) : api.patch(`${base}/${minyan.id}`, body);
  }

  const chips = (items, value, onPick, error) => html`<div class="chips">${items.map(([val, label, disabled]) =>
    html`<button type="button" class=${cx('chip', value === val && 'on')} disabled=${disabled} onClick=${() => onPick(val)}>${label}</button>`)}</div>`;

  return html`<${FormModal} title=${`${isNew ? 'מניין חדש' : 'עריכת מניין'} · זמני ${seasonName}`} initial=${initial} save=${save} onClose=${onClose}
      onSaved=${(m) => { onSaved(m, isNew); toast(isNew ? 'המניין נוסף' : 'המניין עודכן'); }}>
    ${({ values: v, set, errors }) => {
      const prayer = catalog.prayers.find((p) => p.id === v.prayer_id);
      const anchors = anchorsForPrayer(catalog.anchors, v.prayer_id);
      const bounds = prayer && (prayer.earliest || prayer.latest) ? `טווח מותר: ${prayer.earliest || '00:00'}–${prayer.latest || '23:59'}` : '';
      const kinds = [['fixed', 'שעה קבועה'], ['relative', 'ביחס לזמן היום', !anchors.length]];
      if (settings.allow_interval || v.time_kind === 'interval') kinds.push(['interval', 'סבב (שטיבלאך)']);
      const pickKind = (k) => {
        set('time_kind')(k);
        if (k === 'relative' && !anchors.some((a) => a.id === v.anchor_id)) set('anchor_id')(anchors[0]?.id ?? null);
      };
      return html`
        <${Field} group label="תפילה" error=${errors.prayer_id}>
          ${chips(catalog.prayers.map((p) => [p.id, p.name]), v.prayer_id, set('prayer_id'))}
        <//>
        <${Field} group label="סוג זמן" error=${errors.time_kind}>${chips(kinds, v.time_kind, pickKind)}<//>

        ${v.time_kind === 'fixed' && html`
          <${Field} label="שעה" error=${errors.time} hint=${bounds}>
            <${Input} type="time" dir="ltr" class="input input-time" value=${v.time} onInput=${set('time')} required /><//>
          ${prayer?.has_rosh_chodesh && html`<div class="sub-option">
            <${Toggle} checked=${v.rosh_chodesh_on} onChange=${set('rosh_chodesh_on')} label="בראש חודש בשעה אחרת" />
            ${v.rosh_chodesh_on && html`<${Field} label="שעה בראש חודש" error=${errors.rosh_chodesh_time}>
              <${Input} type="time" dir="ltr" class="input input-time" value=${v.rosh_chodesh_time} onInput=${set('rosh_chodesh_time')} /><//>`}
          </div>`}`}

        ${v.time_kind === 'interval' && html`<div class="grid-3">
          <${Field} label="מהשעה" error=${errors.time} hint=${bounds}><${Input} type="time" dir="ltr" value=${v.time} onInput=${set('time')} /><//>
          <${Field} label="עד השעה" error=${errors.end_time}><${Input} type="time" dir="ltr" value=${v.end_time} onInput=${set('end_time')} /><//>
          <${Field} label="כל כמה דקות" error=${errors.every_minutes}><${Input} type="number" min="5" max="240" dir="ltr" value=${v.every_minutes} onInput=${set('every_minutes')} /><//>
        </div>`}

        ${v.time_kind === 'relative' && html`
          <${Field} group label="זמן ייחוס" error=${errors.anchor_id}>${chips(anchors.map((a) => [a.id, a.name]), v.anchor_id, set('anchor_id'))}<//>
          <div class="grid-2">
            <${Field} label="דקות" error=${errors.offset_minutes}>
              <${Input} type="number" min="0" max="720" dir="ltr" value=${v.offset_abs} onInput=${(x) => set('offset_abs')(x === '' ? '' : Number(x))} /><//>
            <${Field} group label="לפני / אחרי">${chips([[-1, 'לפני'], [1, 'אחרי']], v.offset_dir, set('offset_dir'))}<//>
          </div>`}

        <${Field} group label="ימים" error=${errors.days}><${DaysPicker} value=${v.days} onChange=${set('days')} shabbat=${shabbat} /><//>
        ${locations.length > 0 && html`<${Field} group label="מיקום" error=${errors.location_id}>
          ${chips([[null, 'ללא מיקום'], ...locations.map((l) => [l.id, l.name])], v.location_id, set('location_id'))}<//>`}
        ${settings.notes_enabled && html`<${Field} label="הערה (תוצג לציבור)" error=${errors.notes}><${Input} value=${v.notes} onInput=${set('notes')} maxlength="300" placeholder="למשל: ותיקין, מניין מהיר" /><//>`}
        <${Toggle} checked=${v.is_active} onChange=${set('is_active')} label="מוצג לציבור" hint="כבו כדי להסתיר את המניין זמנית בלי למחוק אותו" />`;
    }}
  <//>`;
}

/** Copy minyanim from another season into the season on screen; clashes are skipped, not doubled. */
function CopySeasonModal({ data, to, onClose, onDone }) {
  const { synagogue: s, minyanim, catalog } = data;
  const sources = catalog.seasons.filter((x) => x.id !== to);
  const count = (id) => minyanim.filter((m) => m.season_id === id).length;
  const toName = catalog.seasons.find((x) => x.id === to)?.name;
  const first = sources.find((x) => count(x.id)) ?? sources[0];
  const pick = (id) => minyanim.filter((m) => m.season_id === id).map((m) => m.id);
  const initial = { from: first?.id ?? null, ids: pick(first?.id), replace: false };

  async function save(v) {
    if (!v.ids.length) throw new Error('לא נבחרו מניינים להעתקה');
    const copiedPrayers = new Set(minyanim.filter((m) => v.ids.includes(m.id)).map((m) => m.prayer_id));
    const doomed = minyanim.filter((m) => m.season_id === to && copiedPrayers.has(m.prayer_id)).length;
    if (v.replace && doomed && !(await confirm({ title: 'החלפת מניינים', body: `${pluralize(doomed, 'מניין', 'מניינים')} בזמני ${toName} יימחקו ויוחלפו. להמשיך?`, confirmLabel: 'החלפה', danger: true }))) {
      throw new Error('ההעתקה בוטלה');
    }
    // replace clears only the prayers being copied
    const prayer_ids = [...new Set(minyanim.filter((m) => v.ids.includes(m.id)).map((m) => m.prayer_id))];
    return api.post(`/synagogues/${s.id}/seasons/copy`, { from_season_id: v.from, to_season_id: to, minyan_ids: v.ids, prayer_ids, replace: v.replace });
  }

  return html`<${FormModal} title=${`העתקה לזמני ${toName}`} initial=${initial} save=${save} onClose=${onClose} submitLabel="העתקה"
      onSaved=${(r) => {
        toast(r.skipped.length ? `הועתקו ${r.copied}. ${pluralize(r.skipped.length, 'מניין דולג', 'מניינים דולגו')} (כבר קיים מניין באותה שעה ובאותו מיקום)` : `הועתקו ${pluralize(r.copied, 'מניין', 'מניינים')}`);
        onDone();
      }}>
    ${({ values: v, setValues, set }) => {
      const source = minyanim.filter((m) => m.season_id === v.from);
      const prayerIds = [...new Set(source.map((m) => m.prayer_id))];
      const prayersShown = catalog.prayers.filter((p) => prayerIds.includes(p.id));
      // Choosing prayers selects (or clears) all their minyanim; single minyanim can then be unchecked.
      const prayerOn = (pid) => source.some((m) => m.prayer_id === pid && v.ids.includes(m.id));
      const togglePrayer = (pid) => {
        const of = source.filter((m) => m.prayer_id === pid).map((m) => m.id);
        set('ids')(prayerOn(pid) ? v.ids.filter((x) => !of.includes(x)) : [...new Set([...v.ids, ...of])]);
      };
      const list = source;
      const toggle = (id) => set('ids')(v.ids.includes(id) ? v.ids.filter((x) => x !== id) : [...v.ids, id]);
      return html`
        <${Field} group label="מאיזו עונה להעתיק">
          <div class="chips">${sources.map((x) => html`<button type="button" class=${cx('chip', v.from === x.id && 'on')}
              onClick=${() => setValues((o) => ({ ...o, from: x.id, ids: pick(x.id) }))}>זמני ${x.name} (${count(x.id)})</button>`)}</div><//>
        ${prayersShown.length > 1 && html`<${Field} group label="אילו תפילות להעתיק">
          <div class="chips">${prayersShown.map((p) => html`<button type="button" class=${cx('chip', prayerOn(p.id) && 'on')} onClick=${() => togglePrayer(p.id)}>${p.name}</button>`)}</div><//>`}
        ${list.length === 0
          ? html`<div class="alert alert-info">אין מניינים בעונה זו</div>`
          : html`<${Field} group label=${`מניינים להעתקה (${v.ids.length} מתוך ${list.length})`}>
              <div class="checklist"><div class="checklist-items">
                <label class="check"><input type="checkbox" checked=${v.ids.length === list.length}
                    onChange=${() => set('ids')(v.ids.length === list.length ? [] : list.map((m) => m.id))} /><b>בחירת הכל</b></label>
                ${list.map((m) => html`<label class="check" key=${m.id}><input type="checkbox" checked=${v.ids.includes(m.id)} onChange=${() => toggle(m.id)} />
                  ${m.prayer_name} · <span>${m.time_label}</span><small class="muted">${m.days_label}${m.location_name ? ` · ${m.location_name}` : ''}</small></label>`)}
              </div></div><//>`}
        <${Toggle} checked=${v.replace} onChange=${set('replace')} label=${`מחיקת המניינים הקיימים בזמני ${toName} לפני ההעתקה (רק של התפילות שמועתקות)`}
            hint=${count(to) ? `כרגע יש ${pluralize(count(to), 'מניין', 'מניינים')} בזמני ${toName}. בלי סימון, מניין שכבר קיים באותה שעה ובאותו מיקום ידולג` : 'אין כרגע מניינים בעונת היעד'} />
        <p class="muted small">המניינים המועתקים הם עותק נפרד: אחרי ההעתקה אפשר לשנות בזמני ${toName} רק את מה שמשתנה.</p>`;
    }}
  <//>`;
}

// ------------------------------------------------------------------ locations
function LocationsTab({ data, update }) {
  const { synagogue: s, settings, locations } = data;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const base = `/synagogues/${s.id}/locations`;
  const full = Boolean(settings.max_locations) && locations.length >= settings.max_locations;

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { const loc = await api.post(base, { name }); update((d) => ({ ...d, locations: [...d.locations, loc] })); setName(''); toast('המיקום נוסף'); }
    catch (err) { toastError(err); }
    setBusy(false);
  }
  async function rename(loc) {
    if (!editName.trim() || editName.trim() === loc.name) return setEditingId(null);
    try {
      const row = await api.patch(`${base}/${loc.id}`, { name: editName });
      update((d) => ({
        ...d,
        locations: d.locations.map((l) => (l.id === loc.id ? { ...l, name: row.name } : l)),
        minyanim: d.minyanim.map((m) => (m.location_id === loc.id ? { ...m, location_name: row.name } : m)),
      }));
      setEditingId(null);
    } catch (err) { toastError(err); }
  }
  async function remove(loc) {
    const body = loc.minyanim_count
      ? `${pluralize(loc.minyanim_count, 'מניין משויך', 'מניינים משויכים')} למיקום זה. המניינים יישארו, אבל בלי מיקום.`
      : 'למחוק את המיקום?';
    if (!(await confirm({ title: `מחיקת "${loc.name}"`, body, confirmLabel: 'מחיקה', danger: true }))) return;
    try {
      await api.del(`${base}/${loc.id}`);
      update((d) => ({
        ...d,
        locations: d.locations.filter((l) => l.id !== loc.id),
        minyanim: d.minyanim.map((m) => (m.location_id === loc.id ? { ...m, location_id: null, location_name: null } : m)),
      }));
      toast('המיקום נמחק');
    } catch (err) { toastError(err); }
  }
  async function move(index, dir) {
    const ids = locations.map((l) => l.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    try { const list = await api.put(`${base}/order`, { ids }); update((d) => ({ ...d, locations: list })); }
    catch (err) { toastError(err); }
  }

  return html`<section class="narrow-section">
    <fieldset class="plain" disabled=${settings.read_only}>
    <form class="toolbar" onSubmit=${add}>
      <input class="input grow" placeholder=${full ? `הגעתם למכסה של ${settings.max_locations} מיקומים` : 'שם מיקום חדש, למשל: היכל ראשי, עזרת נשים, מניין עליון'}
        value=${name} onInput=${(e) => setName(e.currentTarget.value)} disabled=${full} maxlength="80" />
      <${Button} kind="primary" icon="plus" type="submit" loading=${busy} disabled=${full || !name.trim()}>הוספה<//>
    </form>
    ${locations.length === 0
      ? html`<${Empty} icon="pin" title="אין מיקומים">מיקומים עוזרים למתפללים לדעת איפה בבית הכנסת מתקיים כל מניין. זה לא חובה.<//>`
      : html`<div class="card list">
        ${locations.map((l, i) => html`<div class="list-row" key=${l.id}>
          <div class="order-btns">
            <${Button} kind="ghost" small icon="up" title="למעלה" disabled=${i === 0} onClick=${() => move(i, -1)} />
            <${Button} kind="ghost" small icon="down" title="למטה" disabled=${i === locations.length - 1} onClick=${() => move(i, 1)} />
          </div>
          ${editingId === l.id
            ? html`<form class="row gap-sm grow" onSubmit=${(e) => (e.preventDefault(), rename(l))}>
                <input class="input grow" value=${editName} onInput=${(e) => setEditName(e.currentTarget.value)} autofocus maxlength="80"
                  onKeyDown=${(e) => e.key === 'Escape' && setEditingId(null)} />
                <${Button} kind="primary" small type="submit">שמירה<//><${Button} kind="ghost" small onClick=${() => setEditingId(null)}>ביטול<//></form>`
            : html`<div class="grow"><b>${l.name}</b> <span class="muted small">${pluralize(l.minyanim_count, 'מניין', 'מניינים')}</span></div>
                <${Button} kind="ghost" small icon="edit" title="שינוי שם" onClick=${() => { setEditingId(l.id); setEditName(l.name); }} />
                <${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => remove(l)} />`}
        </div>`)}
      </div>`}
    </fieldset>
  </section>`;
}

// ------------------------------------------------------------------ details
const FIELD_LABELS = { name: 'שם', area_id: 'אזור', address: 'כתובת', phone: 'טלפון', notes: 'הערות' };

/** Is the synagogue's name recorded for the phone line (in the administration's voice)? Listen, or ask for it. */
function NameRecording({ synagogue: s, admin }) {
  const { data } = useLoad(() => api.get(`/synagogues/${s.id}/recording`), [s.id]);
  const [playing, setPlaying] = useState(false);
  if (!data) return null;
  async function listen() {
    setPlaying(true);
    try {
      const url = URL.createObjectURL(await fetchBlob(`/synagogues/${s.id}/recording?audio=1`));
      const a = new Audio(url);
      a.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      await a.play();
    } catch (e) { setPlaying(false); toastError(e); }
  }
  const ask = `שלום, אשמח שיוקלט שם בית הכנסת "${s.name}" לקו הטלפון.`;
  return html`<div class="name-rec">
    <h4><${Icon} name="mic" size=${15} /> השם בקו הטלפון</h4>
    ${data.recorded
      ? html`<p class="small">שם בית הכנסת מוקלט ונשמע בקו בקול אנושי.</p>
          <${Button} small icon="play" loading=${playing} onClick=${listen}>השמעה<//>`
      : admin ? html`<p class="small muted">השם נקרא כרגע בקול המחשב.</p><a class="link small" href="#/admin/recordings">להקלטה בעמוד ההקלטות</a>`
      : html`<p class="small muted">השם נקרא כרגע בקול המחשב. אפשר לבקש שיוקלט בקול אנושי.</p>
          <${Button} small icon="mic" onClick=${() => navigate(`/messages?draft=${encodeURIComponent(ask)}`)}>בקשת הקלטה<//>`}
  </div>`;
}

function InfoTab({ data, isAdmin, onSaved }) {
  const { synagogue: s, settings, catalog } = data;
  // Admins edit everything; managers only the fields the admin opened for this synagogue.
  const open = (k) => isAdmin || settings.editable_fields.includes(k);
  const anyOpen = isAdmin || settings.editable_fields.length > 0;
  const [v, setV] = useState({ name: s.name, area_id: s.area_id, address: s.address, phone: s.phone, notes: s.notes });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (x) => setV((st) => ({ ...st, [k]: x }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const body = Object.fromEntries(Object.entries(v).filter(([k]) => open(k)));
    try { onSaved(await api.patch(`/synagogues/${s.id}`, body)); toast('הפרטים נשמרו'); }
    catch (err) { err.fields && Object.keys(err.fields).length ? setErrors(err.fields) : toastError(err); }
    setBusy(false);
  }

  const allowed = settings.allowed_prayer_ids;
  return html`<section class="grid-sidebar">
    <form class="card form" onSubmit=${save}>
      <h3>פרטים לציבור</h3>
      <div class="grid-2">
        <${Field} label="שם בית הכנסת" error=${errors.name}><${Input} value=${v.name} onInput=${set('name')} disabled=${!open('name')} /><//>
        <${Field} label="אזור" error=${errors.area_id}>
          <${Select} value=${v.area_id} onChange=${set('area_id')} disabled=${!open('area_id')} options=${catalog.areas.map((a) => ({ value: a.id, label: a.name }))} /><//>
        <${Field} label="כתובת" error=${errors.address}><${Input} value=${v.address} onInput=${set('address')} disabled=${!open('address')} /><//>
        <${Field} label="טלפון" error=${errors.phone}><${Input} dir="ltr" value=${v.phone} onInput=${set('phone')} disabled=${!open('phone')} /><//>
      </div>
      <${Field} label="הערות כלליות" error=${errors.notes}><${TextArea} value=${v.notes} onInput=${set('notes')} disabled=${!open('notes')} /><//>
      ${!isAdmin && settings.editable_fields.length < 5 && html`<p class="muted small">כדי לשנות ${anyOpen ? 'את שאר' : 'את'} הפרטים, פנו להנהלה.</p>`}
      ${anyOpen && html`<div class="row end"><${Button} kind="primary" type="submit" loading=${busy}>שמירה<//></div>`}
    </form>
    <aside class="card">
      <h3>מה מוגדר לבית הכנסת</h3>
      <ul class="facts">
        <li><span>מכסת מניינים</span><b>${settings.max_minyanim}</b></li>
        <li><span>מכסת מיקומים</span><b>${settings.max_locations}</b></li>
        <li><span>פרטים שאפשר לערוך</span><b>${settings.editable_fields.length ? settings.editable_fields.map((k) => FIELD_LABELS[k]).join(', ') : 'אין'}</b></li>
        <li><span>תפילות</span><b>${allowed ? catalog.prayers.map((p) => p.name).join(', ') || 'אין' : 'כל התפילות'}</b></li>
      </ul>
      <p class="muted small">ההגדרות נקבעות על ידי ההנהלה.</p>
      <${NameRecording} synagogue=${s} admin=${isAdmin} />
    </aside>
  </section>`;
}
