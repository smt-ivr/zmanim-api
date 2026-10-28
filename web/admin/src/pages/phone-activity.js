// Activity on the phone lines: how many calls, when, what people look for, and every call step by step
// (what the caller pressed and what the system said).
import { api } from '../api.js';
import { cx, html, timeAgo, useEffect, useState } from '../lib.js';
import { Badge, Button, Empty, ErrorBox, Icon, Modal, Pager, Select, Spinner, confirm, toast, toastError, useDebounced, useLoad } from '../ui.js';

const LINE = { listen: 'קו שמיעה', manage: 'קו ניהול' };
const when = (iso) => new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const clock = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const seconds = (c) => Math.max(0, Math.round((new Date(c.ended_at || c.last_at) - new Date(c.started_at)) / 1000));
const duration = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} דק׳` : `${s} שנ׳`);
const pressed = (v) => (v === null ? null : v === 'None' || v === '' ? 'לא הקיש' : v.includes('*') ? 'כוכבית (חזרה)' : `הקיש ${v}`);

export function PhoneActivity({ me }) {
  const [line, setLine] = useState('all');
  const [days, setDays] = useState(7);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);
  const query = useDebounced(q, 300);
  useEffect(() => setPage(0), [line, days, query]);
  const params = new URLSearchParams({ days, page, ...(line !== 'all' ? { line } : {}), ...(query ? { q: query } : {}) });
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/admin/phone-activity?${params}`), [params.toString()]);

  const removeCall = (id) => setData((d) => ({ ...d, calls: d.calls.filter((c) => c.id !== id), total: d.total - 1 }));
  const s = data?.stats;
  const tile = (icon, label, value, sub) => html`<div class="card stat"><span class="stat-icon"><${Icon} name=${icon} size=${20} /></span>
    <div><div class="stat-value">${value}</div><div class="muted small">${label}${sub ? html` · ${sub}` : ''}</div></div></div>`;

  return html`<div class="page">
    <header class="page-head"><div><h1>פעילות בטלפון</h1><p class="muted">כל שיחה לקווים: מי התקשר, מה הקיש ומה שמע. נשמר חצי שנה.</p></div></header>
    <div class="toolbar filters">
      <div class="segmented">${[['all', 'כל הקווים'], ['listen', 'קו שמיעה'], ['manage', 'קו ניהול']].map(([k, l]) =>
        html`<button class=${cx(line === k && 'on')} onClick=${() => setLine(k)}>${l}</button>`)}</div>
      <${Select} value=${days} onChange=${setDays} options=${[{ value: 1, label: '24 השעות האחרונות' }, { value: 7, label: '7 הימים האחרונים' }, { value: 30, label: '30 הימים האחרונים' }, { value: 90, label: '3 חודשים' }, { value: 180, label: 'חצי שנה' }]} />
      <div class="search"><${Icon} name="phone" /><input class="input" dir="ltr" inputmode="tel" placeholder="חיפוש לפי מספר טלפון" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
    </div>
    ${loading && !data ? html`<${Spinner} />` : error && !data ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : html`
      <div class="stats">
        ${tile('phone', 'שיחות', s.calls, `היום ${s.today}`)}
        ${tile('users', 'מספרים שונים', s.callers)}
        ${tile('clock', 'משך ממוצע', duration(s.avg_seconds))}
        ${tile('list', 'מניינים שהושמעו', s.heard || 0, `${s.searches || 0} חיפושים`)}
        ${s.blocked > 0 && tile('shield', 'ניסיונות מטלפון לא מורשה', s.blocked)}
      </div>
      <div class="phone-charts">
        <div class="card"><h3>שעות השיחות</h3><${HourChart} hours=${data.by_hour} /></div>
        <div class="card"><h3>מה מחפשים בקו השמיעה</h3>
          ${data.prayers.length ? html`<${Ranking} rows=${data.prayers} unit="חיפושים" />
            ${data.areas.length > 1 && html`<h4 class="muted small rank-sub">לפי אזור</h4><${Ranking} rows=${data.areas} unit="חיפושים" />`}`
            : html`<p class="muted small">אין עדיין חיפושים בתקופה הזו</p>`}</div>
      </div>
      <div class="card table-wrap">
        ${data.calls.length === 0 ? html`<${Empty} icon="phone" title="אין שיחות בתקופה הזו" />` : html`
          <table class="table responsive calls-table">
            <thead><tr><th>מתי</th><th>קו</th><th>מתקשר</th><th>משך</th><th>מה קרה</th><th /></tr></thead>
            <tbody>${data.calls.map((c) => html`<tr key=${c.id} class="clickable" onClick=${() => setOpen(c.id)}>
              <td data-label="מתי"><b>${when(c.started_at)}</b><div class="muted small">${timeAgo(c.started_at)}</div></td>
              <td data-label="קו"><${Badge} tone=${c.line === 'manage' ? 'info' : 'neutral'}>${LINE[c.line]}<//></td>
              <td data-label="מתקשר">${c.user_name ? html`<b>${c.user_name}</b><div class="muted small" dir="ltr">${c.phone}</div>` : html`<span dir="ltr">${c.phone || 'חסוי'}</span>`}</td>
              <td data-label="משך">${duration(seconds(c))}${!c.ended_at && html`<div class="muted small">לא נרשם ניתוק</div>`}</td>
              <td data-label="מה קרה">${c.outcome === 'blocked' ? html`<${Badge} tone="warn">מספר לא מורשה<//>`
                : html`${c.steps} הקשות${c.line === 'listen' ? html` · ${c.heard ? `שמע ${c.heard} מניינים` : c.searches ? 'לא נמצאו מניינים' : 'לא הגיע לזמנים'}` : ''}`}</td>
              <td class="actions muted"><${Icon} name="chevron" /></td>
            </tr>`)}</tbody></table>
          <${Pager} page=${page} pageSize=${data.page_size} total=${data.total} onPage=${setPage} />`}
      </div>`}
    ${open && html`<${CallModal} id=${open} canDelete=${data?.can_delete} onClose=${() => setOpen(null)} onDeleted=${(id) => { removeCall(id); setOpen(null); }} />`}
  </div>`;
}

/** Calls per hour of day: one series, bars with hover values. */
function HourChart({ hours }) {
  const max = Math.max(1, ...hours);
  const [hover, setHover] = useState(null);
  return html`<div class="hour-chart" dir="ltr" onMouseLeave=${() => setHover(null)}>
    <div class="hour-bars">${hours.map((n, h) => html`<button type="button" class=${cx('hour-col', hover === h && 'on')} key=${h}
        onMouseEnter=${() => setHover(h)} onFocus=${() => setHover(h)} aria-label=${`${h}:00 — ${n} שיחות`}>
        <span class="hour-bar" style=${`height:${n ? Math.max(4, (n / max) * 100) : 0}%`} /></button>`)}</div>
    <div class="hour-axis">${[0, 6, 12, 18, 23].map((h) => html`<span style=${`left:${((h + 0.5) / 24) * 100}%`}>${String(h).padStart(2, '0')}</span>`)}</div>
    <div class="hour-tip" dir="rtl">${hover === null ? html`<span class="muted">העבירו את העכבר על עמודה לפרטים</span>`
      : html`<b>${String(hover).padStart(2, '0')}:00–${String(hover).padStart(2, '0')}:59</b> · ${hours[hover]} שיחות`}</div>
  </div>`;
}

function Ranking({ rows, unit }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return html`<div class="ranking">${rows.map((r) => html`<div class="rank-row" key=${r.name} title=${`${r.n} ${unit}${r.empty ? `, ${r.empty} בלי תוצאות` : ''}`}>
    <span class="rank-name ellipsis">${r.name}</span>
    <span class="rank-track"><span class="rank-bar" style=${`width:${(r.n / max) * 100}%`} /></span>
    <b class="rank-n">${r.n}</b></div>`)}</div>`;
}

function CallModal({ id, canDelete, onClose, onDeleted }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/admin/phone-activity/${id}`), [id]);
  async function remove() {
    if (!(await confirm({ title: 'מחיקת השיחה מהיומן', body: 'השיחה וכל השלבים שלה יימחקו לצמיתות.', confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/phone-activity/${id}`); toast('נמחק מהיומן'); onDeleted(id); } catch (e) { toastError(e); }
  }
  return html`<${Modal} wide title=${data ? `שיחה ב${LINE[data.line]} · ${when(data.started_at)}` : 'שיחה'} onClose=${onClose}
      footer=${canDelete && html`<${Button} kind="ghost" icon="trash" onClick=${remove}>מחיקה מהיומן<//>`}>
    ${loading && !data ? html`<${Spinner} />` : error && !data ? html`<${ErrorBox} error=${error} onRetry=${reload} />` : html`
      <div class="call-head muted small">
        ${data.user_name && html`<b class="text">${data.user_name}</b> · `}<span dir="ltr">${data.phone || 'מספר חסוי'}</span>
        · משך ${duration(seconds(data))} · ${data.steps} שלבים${data.line === 'listen' ? ` · שמע ${data.heard} מניינים` : ''}${data.ended_at ? ' · ניתק' : ''}</div>
      <ol class="call-steps">${data.events.map((e, i) => html`<li key=${i}>
        ${pressed(e.in) && html`<div class="call-in"><span class="call-key">${pressed(e.in)}</span><small class="muted">${clock(e.at)}</small></div>`}
        ${e.say && html`<div class="call-say"><${Icon} name="phone" size=${14} /><div class="grow">${e.say}</div>${!pressed(e.in) && html`<small class="muted">${clock(e.at)}</small>`}</div>`}
      </li>`)}</ol>`}
  <//>`;
}
