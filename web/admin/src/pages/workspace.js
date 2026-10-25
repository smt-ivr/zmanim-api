// The synagogue workspace: what a manager sees after login. Admins open any synagogue the same way.
import { api } from '../api.js';
import { ALL_DAYS, DAY_FULL, cx, html, norm, pluralize, useMemo, useState } from '../lib.js';
import {
  Badge, Button, DaysBadge, DaysPicker, Empty, ErrorBox, Field, FormModal, Icon, Input, Meter, Select, Spinner,
  TextArea, Toggle, confirm, toast, toastError, useLoad,
} from '../ui.js';

export function SynagoguePicker({ synagogues }) {
  if (!synagogues.length) {
    return html`<div class="page"><${Empty} icon="building" title="עדיין לא שויכת לבית כנסת">
      מנהל המערכת צריך לשייך אותך לבית הכנסת שלך. לאחר השיוך הוא יופיע כאן.<//></div>`;
  }
  return html`<div class="page">
    <header class="page-head"><h1>בתי הכנסת שלי</h1></header>
    <div class="cards">
      ${synagogues.map((s) => html`<a class="card card-link" href=${`#/s/${s.id}`}>
        <${Icon} name="building" size=${22} /><div><b>${s.name}</b><div class="muted small">${s.area_name || ''}</div></div></a>`)}
    </div>
  </div>`;
}

export function Workspace({ id, user, onChanged }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/synagogues/${id}`), [id]);
  const [tab, setTab] = useState('minyanim');

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
    ['info', 'פרטי בית הכנסת'],
  ];

  return html`<div class="page">
    <header class="page-head ws-head">
      <div>
        <div class="row gap-sm wrap">
          <h1>${s.name}</h1>
          ${!s.is_active && html`<${Badge} tone="warn">מוסתר מהציבור<//>`}
        </div>
        <p class="muted">${[s.area_name, s.address].filter(Boolean).join(' · ') || 'ללא כתובת'}
          ${isAdmin && html` · מנהלים: ${managers.length ? managers.map((m) => m.name).join(', ') : 'אין'}`}</p>
      </div>
      <div class="ws-meters">
        <${Meter} label="מניינים" used=${usage.minyanim} max=${settings.max_minyanim} />
        <${Meter} label="מיקומים" used=${usage.locations} max=${settings.max_locations} />
      </div>
    </header>

    <div class="tabs" role="tablist">
      ${tabs.map(([key, label, count]) => html`<button role="tab" aria-selected=${tab === key}
        class=${cx('tab', tab === key && 'active')} onClick=${() => setTab(key)}>${label}${count !== undefined && html`<span class="count">${count}</span>`}</button>`)}
      ${isAdmin && html`<span class="grow" /><a class="link small" href="#/admin/synagogues">הגדרות מנהל לבית הכנסת ←</a>`}
    </div>

    ${tab === 'minyanim' && html`<${MinyanimTab} data=${data} update=${update} />`}
    ${tab === 'locations' && html`<${LocationsTab} data=${data} update=${update} />`}
    ${tab === 'info' && html`<${InfoTab} data=${data} isAdmin=${isAdmin} onSaved=${(d) => { setData(d); onChanged(); }} />`}
  </div>`;
}

// ------------------------------------------------------------------ minyanim
function MinyanimTab({ data, update }) {
  const { synagogue: s, settings, minyanim, locations, catalog } = data;
  const [view, setView] = useState(() => { try { return localStorage.getItem('zmanim.view') || 'list'; } catch { return 'list'; } });
  const [season, setSeason] = useState(null);
  const [location, setLocation] = useState(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | minyan

  const setViewSaved = (v) => { setView(v); try { localStorage.setItem('zmanim.view', v); } catch { /* ignore */ } };
  const base = `/synagogues/${s.id}/minyanim`;
  const full = minyanim.length >= settings.max_minyanim;

  const shown = useMemo(() => minyanim.filter((m) =>
    (season === null || m.season_id === null || m.season_id === season) &&
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

  const actions = { edit: setEditing, duplicate, remove, toggleActive, full };

  return html`<section>
    <div class="toolbar">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש מניין…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${catalog.seasons.length > 1 && html`<${Select} value=${season} onChange=${setSeason} placeholder="כל העונות"
          options=${catalog.seasons.map((x) => ({ value: x.id, label: x.name }))} />`}
      ${locations.length > 0 && html`<${Select} value=${location} onChange=${setLocation} placeholder="כל המיקומים"
          options=${locations.map((x) => ({ value: x.id, label: x.name }))} />`}
      <div class="segmented" role="group" aria-label="תצוגה">
        <button class=${cx(view === 'list' && 'on')} onClick=${() => setViewSaved('list')}><${Icon} name="list" /> רשימה</button>
        <button class=${cx(view === 'week' && 'on')} onClick=${() => setViewSaved('week')}><${Icon} name="grid" /> שבועי</button>
      </div>
      <span class="grow" />
      <${Button} kind="primary" icon="plus" disabled=${full} title=${full ? 'הגעתם למכסת המניינים' : ''} onClick=${() => setEditing('new')}>מניין חדש<//>
    </div>

    ${minyanim.length === 0
      ? html`<${Empty} icon="clock" title="עדיין אין מניינים">התחילו בהוספת המניין הראשון של בית הכנסת.
          <div class="pad"><${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>מניין חדש<//></div><//>`
      : shown.length === 0
        ? html`<${Empty} icon="search" title="אין מניינים שמתאימים לסינון" />`
        : view === 'list'
          ? html`<${MinyanList} minyanim=${shown} catalog=${catalog} actions=${actions} />`
          : html`<${WeekView} minyanim=${shown} onEdit=${setEditing} />`}

    ${editing && html`<${MinyanModal} data=${data} minyan=${editing === 'new' ? null : editing}
        onClose=${() => setEditing(null)} onSaved=${(m, isNew) => (isNew ? add(m) : replace(m))} />`}
  </section>`;
}

function sortMinyanim(list, catalog) {
  const order = new Map(catalog.prayers.map((p, i) => [p.id, i]));
  const key = (m) => [order.get(m.prayer_id) ?? 999, m.time_kind === 'fixed' ? 0 : 1, m.time || '', m.anchor_id || 0, m.offset_minutes || 0, m.id];
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
}

function MinyanList({ minyanim, actions }) {
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
          <button class="minyan-time" onClick=${() => actions.edit(m)} title="עריכה">
            <span class=${cx('time', m.time_kind === 'relative' && 'relative')}>${m.time_label}</span>
          </button>
          <div class="minyan-info">
            <div class="row gap-sm wrap">
              <${DaysBadge} mask=${m.days} />
              ${m.location_name && html`<span class="meta"><${Icon} name="pin" size=${14} />${m.location_name}</span>`}
              ${m.season_name && html`<${Badge}>${m.season_name}<//>`}
              ${!m.is_active && html`<${Badge} tone="warn">מוסתר<//>`}
            </div>
            ${m.notes && html`<div class="muted small">${m.notes}</div>`}
          </div>
          <div class="minyan-actions">
            <${Button} kind="ghost" small icon=${m.is_active ? 'eye' : 'eyeOff'} title=${m.is_active ? 'הסתרה מהציבור' : 'הצגה לציבור'} onClick=${() => actions.toggleActive(m)} />
            <${Button} kind="ghost" small icon="copy" title="שכפול" disabled=${actions.full} onClick=${() => actions.duplicate(m)} />
            <${Button} kind="ghost" small icon="edit" title="עריכה" onClick=${() => actions.edit(m)} />
            <${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => actions.remove(m)} />
          </div>
        </div>`)}
      </div>
    </div>`)}
  </div>`;
}

function WeekView({ minyanim, onEdit }) {
  return html`<div class="week">
    ${DAY_FULL.map((day, i) => {
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

function MinyanModal({ data, minyan, onClose, onSaved }) {
  const { synagogue: s, locations, catalog } = data;
  const isNew = !minyan;
  const defaultSeason = null; // all year
  const initial = minyan
    ? { ...minyan, offset_dir: minyan.offset_minutes < 0 ? -1 : 1, offset_abs: Math.abs(minyan.offset_minutes ?? 0) }
    : {
        prayer_id: catalog.prayers[0]?.id ?? null, time_kind: 'fixed', time: '', anchor_id: catalog.anchors[0]?.id ?? null,
        offset_dir: -1, offset_abs: 0, days: ALL_DAYS, location_id: locations[0]?.id ?? null, season_id: defaultSeason, notes: '', is_active: true,
      };

  async function save(v) {
    const body = {
      prayer_id: v.prayer_id, time_kind: v.time_kind, days: v.days, location_id: v.location_id,
      season_id: v.season_id, notes: v.notes, is_active: v.is_active,
      time: v.time_kind === 'fixed' ? v.time || null : null,
      anchor_id: v.time_kind === 'relative' ? v.anchor_id : null,
      offset_minutes: v.time_kind === 'relative' ? (v.offset_abs === '' || v.offset_abs === null ? null : v.offset_dir * Number(v.offset_abs)) : null,
    };
    const base = `/synagogues/${s.id}/minyanim`;
    return isNew ? api.post(base, body) : api.patch(`${base}/${minyan.id}`, body);
  }

  return html`<${FormModal} title=${isNew ? 'מניין חדש' : 'עריכת מניין'} initial=${initial} save=${save} onClose=${onClose}
      onSaved=${(m) => { onSaved(m, isNew); toast(isNew ? 'המניין נוסף' : 'המניין עודכן'); }}>
    ${({ values: v, set, errors }) => {
      const prayer = catalog.prayers.find((p) => p.id === v.prayer_id);
      const bounds = prayer && (prayer.earliest || prayer.latest)
        ? `טווח מותר: ${prayer.earliest || '00:00'}–${prayer.latest || '23:59'}` : '';
      return html`
        <${Field} group label="תפילה" error=${errors.prayer_id}>
          <div class="chips">${catalog.prayers.map((p) => html`<button type="button" class=${cx('chip', v.prayer_id === p.id && 'on')} onClick=${() => set('prayer_id')(p.id)}>${p.name}</button>`)}</div>
        <//>
        <${Field} group label="סוג זמן">
          <div class="segmented full">
            <button type="button" class=${cx(v.time_kind === 'fixed' && 'on')} onClick=${() => set('time_kind')('fixed')}>שעה קבועה</button>
            <button type="button" class=${cx(v.time_kind === 'relative' && 'on')} onClick=${() => set('time_kind')('relative')} disabled=${!catalog.anchors.length}>ביחס לזמן היום</button>
          </div>
        <//>
        ${v.time_kind === 'fixed'
          ? html`<${Field} label="שעה" error=${errors.time} hint=${bounds}>
              <${Input} type="time" dir="ltr" class="input input-time" value=${v.time} onInput=${set('time')} required /><//>`
          : html`<div class="grid-3">
              <${Field} label="דקות" error=${errors.offset_minutes}>
                <${Input} type="number" min="0" max="720" dir="ltr" value=${v.offset_abs} onInput=${(x) => set('offset_abs')(x === '' ? '' : Number(x))} /><//>
              <${Field} label="לפני / אחרי">
                <${Select} value=${v.offset_dir} onChange=${set('offset_dir')} options=${[{ value: -1, label: 'לפני' }, { value: 1, label: 'אחרי' }]} /><//>
              <${Field} label="זמן ייחוס" error=${errors.anchor_id}>
                <${Select} value=${v.anchor_id} onChange=${set('anchor_id')} options=${catalog.anchors.map((a) => ({ value: a.id, label: a.name }))} /><//>
            </div>`}
        <${Field} group label="ימים" error=${errors.days}><${DaysPicker} value=${v.days} onChange=${set('days')} /><//>
        <div class="grid-2">
          <${Field} label="מיקום" error=${errors.location_id}>
            <${Select} value=${v.location_id} onChange=${set('location_id')} placeholder="ללא מיקום" options=${locations.map((l) => ({ value: l.id, label: l.name }))} /><//>
          <${Field} label="עונה" error=${errors.season_id}>
            <${Select} value=${v.season_id} onChange=${set('season_id')} placeholder="כל השנה" options=${catalog.seasons.map((x) => ({ value: x.id, label: x.name }))} /><//>
        </div>
        <${Field} label="הערה (תוצג לציבור)" error=${errors.notes}><${Input} value=${v.notes} onInput=${set('notes')} maxlength="300" placeholder="למשל: ותיקין, מניין מהיר" /><//>
        <${Toggle} checked=${v.is_active} onChange=${set('is_active')} label="מוצג לציבור" hint="כבו כדי להסתיר את המניין זמנית בלי למחוק אותו" />`;
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
  const full = locations.length >= settings.max_locations;

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
  </section>`;
}

// ------------------------------------------------------------------ details
function InfoTab({ data, isAdmin, onSaved }) {
  const { synagogue: s, settings, catalog } = data;
  const canEdit = isAdmin || settings.can_edit_info;
  const [v, setV] = useState({ name: s.name, area_id: s.area_id, address: s.address, phone: s.phone, notes: s.notes });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (x) => setV((st) => ({ ...st, [k]: x }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try { onSaved(await api.patch(`/synagogues/${s.id}`, v)); toast('הפרטים נשמרו'); }
    catch (err) { err.fields && Object.keys(err.fields).length ? setErrors(err.fields) : toastError(err); }
    setBusy(false);
  }

  const allowed = settings.allowed_prayer_ids;
  return html`<section class="grid-sidebar">
    <form class="card form" onSubmit=${save}>
      <h3>פרטים לציבור</h3>
      ${!canEdit && html`<div class="alert alert-info">מנהל המערכת לא אפשר עריכה של פרטי בית הכנסת. לשינויים פנו אליו.</div>`}
      <fieldset disabled=${!canEdit}>
        <div class="grid-2">
          <${Field} label="שם בית הכנסת" error=${errors.name}><${Input} value=${v.name} onInput=${set('name')} /><//>
          <${Field} label="אזור" error=${errors.area_id}>
            <${Select} value=${v.area_id} onChange=${set('area_id')} placeholder="ללא אזור" options=${catalog.areas.map((a) => ({ value: a.id, label: a.name }))} /><//>
          <${Field} label="כתובת" error=${errors.address}><${Input} value=${v.address} onInput=${set('address')} /><//>
          <${Field} label="טלפון" error=${errors.phone}><${Input} dir="ltr" value=${v.phone} onInput=${set('phone')} /><//>
        </div>
        <${Field} label="הערות כלליות" error=${errors.notes}><${TextArea} value=${v.notes} onInput=${set('notes')} /><//>
      </fieldset>
      ${canEdit && html`<div class="row end"><${Button} kind="primary" type="submit" loading=${busy}>שמירה<//></div>`}
    </form>
    <aside class="card">
      <h3>מה מוגדר לבית הכנסת</h3>
      <ul class="facts">
        <li><span>מכסת מניינים</span><b>${settings.max_minyanim}</b></li>
        <li><span>מכסת מיקומים</span><b>${settings.max_locations}</b></li>
        <li><span>עריכת פרטים</span><b>${settings.can_edit_info ? 'מותרת' : 'חסומה'}</b></li>
        <li><span>תפילות</span><b>${allowed ? catalog.prayers.map((p) => p.name).join(', ') || 'אין' : 'כל התפילות'}</b></li>
      </ul>
      <p class="muted small">ההגדרות נקבעות על ידי מנהל המערכת.</p>
    </aside>
  </section>`;
}
