// Dashboard: counts, what needs attention (requests, messages, synagogues without a manager) and the
// latest changes across all synagogues.
import { api } from '../api.js';
import { VIA, html, timeAgo } from '../lib.js';
import { Avatar, Empty, ErrorBox, Icon, Spinner, useLoad } from '../ui.js';

const ACTION_ICON = { create: 'plus', update: 'edit', delete: 'trash', duplicate: 'copy', copy: 'copy', show: 'eye', hide: 'eyeOff', bulk: 'list' };

export function AdminDashboard({ me, system }) {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/stats'));
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const stat = (icon, label, value, href, tone) => html`<a class=${`card stat ${tone || ''}`} href=${href}>
    <span class="stat-icon"><${Icon} name=${icon} size=${20} /></span><div><div class="stat-value">${value}</div><div class="muted small">${label}</div></div></a>`;
  const todo = [
    system.pending_registrations > 0 && ['inbox', `${system.pending_registrations} בקשות הצטרפות ממתינות לאישור`, '#/admin/registrations'],
    me.is_super && system.unread_messages > 0 && ['chat', `${system.unread_messages} הודעות שלא נקראו`, '#/admin/inbox'],
    data.unmanaged > 0 && ['user', `${data.unmanaged} בתי כנסת בלי גבאי`, '#/admin/synagogues?filter=unmanaged'],
  ].filter(Boolean);

  return html`<div class="page">
    <header class="page-head"><div><h1>שלום ${me.name.split(' ')[0]}</h1><p class="muted">תמונת מצב של המערכת</p></div></header>
    <div class="stats">
      ${stat('building', 'בתי כנסת', data.synagogues, '#/admin/synagogues')}
      ${stat('clock', 'מניינים', data.minyanim, '#/admin/synagogues')}
      ${stat('users', 'גבאי בתי כנסת', data.managers, '#/admin/users')}
      ${stat('eye', 'מוצגים לציבור', data.active_synagogues, '#/admin/synagogues')}
      ${me.perms.includes('phone') && stat('phone', 'שיחות בטלפון ב-24 שעות', data.phone_calls, '#/admin/phone')}
    </div>
    ${todo.length > 0 && html`<div class="card todo">
      <h3>דורש טיפול</h3>
      ${todo.map(([icon, text, href]) => html`<a class="todo-row" href=${href}><span class="stat-icon warn-icon"><${Icon} name=${icon} /></span><span class="grow">${text}</span><${Icon} name="chevron" /></a>`)}
    </div>`}
    <div class="grid-sidebar">
      <div class="card">
        <h3>עדכונים אחרונים</h3>
        ${data.activity.length === 0
          ? html`<${Empty} icon="clock" title="עדיין אין עדכונים">כאן יופיע כל שינוי בזמנים: מי שינה, מה, ואיך (באתר או בטלפון).<//>`
          : html`<div class="feed">${data.activity.map((a) => html`<div class="feed-row">
              <span class="feed-icon"><${Icon} name=${ACTION_ICON[a.action] || 'edit'} size=${15} /></span>
              <div class="grow">
                <div><a href=${`#/s/${a.synagogue_id}`}><b>${a.synagogue_name}</b></a> · ${a.summary}</div>
                <div class="muted small">${a.user_name || 'משתמש שנמחק'} · ${VIA[a.via] || ''} · ${timeAgo(a.created_at)}</div>
              </div></div>`)}</div>`}
      </div>
      <div class="card">
        <h3>בתי כנסת שעודכנו</h3>
        ${data.recent.length === 0 ? html`<p class="muted">אין עדיין</p>`
          : html`<div class="list plain">${data.recent.map((r) => html`<a class="list-row link-row" href=${`#/s/${r.id}`}>
              <${Icon} name="building" /><span class="grow ellipsis">${r.name}</span><span class="muted small">${timeAgo(r.updated_at)}</span></a>`)}</div>`}
      </div>
    </div>
  </div>`;
}
