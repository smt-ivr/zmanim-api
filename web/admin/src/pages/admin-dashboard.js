import { api } from '../api.js';
import { formatDate, html } from '../lib.js';
import { Empty, ErrorBox, Icon, Spinner, useLoad } from '../ui.js';

export function AdminDashboard() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/stats'));
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const stat = (icon, label, value, href, tone) => html`<a class=${`card stat ${tone || ''}`} href=${href}>
    <span class="stat-icon"><${Icon} name=${icon} size=${20} /></span><div><div class="stat-value">${value}</div><div class="muted">${label}</div></div></a>`;

  return html`<div class="page">
    <header class="page-head"><div><h1>לוח בקרה</h1><p class="muted">תמונת מצב של כל המערכת</p></div></header>
    <div class="stats">
      ${stat('building', 'בתי כנסת', data.synagogues, '#/admin/synagogues')}
      ${stat('eye', 'פעילים לציבור', data.active_synagogues, '#/admin/synagogues')}
      ${stat('clock', 'מניינים', data.minyanim, '#/admin/synagogues')}
      ${stat('users', 'מנהלי בתי כנסת', data.managers, '#/admin/users')}
      ${data.unmanaged > 0 && stat('user', 'בתי כנסת ללא מנהל', data.unmanaged, '#/admin/synagogues', 'warn')}
    </div>
    <div class="card">
      <h3>עודכנו לאחרונה</h3>
      ${data.recent.length === 0
        ? html`<${Empty} icon="clock" title="עדיין אין מניינים במערכת">צרו בית כנסת ושייכו אליו מנהל כדי להתחיל.<//>`
        : html`<div class="list">${data.recent.map((r) => html`<a class="list-row link-row" href=${`#/s/${r.id}`}>
            <${Icon} name="building" /><b class="grow">${r.name}</b><span class="muted small">${formatDate(r.updated_at)}</span></a>`)}</div>`}
    </div>
  </div>`;
}
