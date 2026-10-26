// Super admin: every lock (accounts locked after failed logins, IPs, phone line, e-mail links,
// registration limits) with unlock and manual lock, and the registration blocklist.
import { api } from '../api.js';
import { cx, html, useState } from '../lib.js';
import { Badge, Button, Empty, ErrorBox, Field, Input, Select, Spinner, confirm, toast, toastError, useLoad } from '../ui.js';

const until = (sec) => {
  const d = new Date(sec * 1000);
  const mins = Math.max(1, Math.round((sec * 1000 - Date.now()) / 60000));
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return mins < 60 ? `עוד ${mins} דק׳ (${time})` : mins < 1440 ? `עד ${time}` : `עד ${d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })} ${time}`;
};

export function SecurityPage() {
  return html`<div class="page">
    <header class="page-head"><div><h1>חסימות ונעילות</h1>
      <p class="muted">חשבונות שננעלו אחרי ניסיונות כושלים, כתובות IP, ורשימת החסומים מהצטרפות. נעילה אוטומטית משתחררת לבד בתום הזמן.</p></div></header>
    <${Locks} />
    <${Blocklist} />
  </div>`;
}

function Locks() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/locks'));
  const [filter, setFilter] = useState('locked');
  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const shown = filter === 'locked' ? data.filter((l) => l.locked) : data;
  const lockedCount = data.filter((l) => l.locked).length;

  async function unlock(l) {
    try { await api.del(`/admin/locks?key=${encodeURIComponent(l.key)}`); toast(l.locked ? 'הנעילה שוחררה' : 'המונה אופס'); reload(); }
    catch (e) { toastError(e); }
  }
  async function unlockAll() {
    if (!(await confirm({ title: 'שחרור כל הנעילות', body: `לשחרר ${lockedCount} נעילות פעילות?`, confirmLabel: 'שחרור' }))) return;
    try { await api.del('/admin/locks'); toast('כל הנעילות שוחררו'); reload(); } catch (e) { toastError(e); }
  }

  return html`<section class="card section-card">
    <div class="row gap-sm wrap"><h3 class="grow">נעילות וניסיונות כושלים</h3>
      <div class="segmented">
        <button class=${cx(filter === 'locked' && 'on')} onClick=${() => setFilter('locked')}>נעולים (${lockedCount})</button>
        <button class=${cx(filter === 'all' && 'on')} onClick=${() => setFilter('all')}>כולל ניסיונות (${data.length})</button>
      </div>
      ${lockedCount > 1 && html`<${Button} onClick=${unlockAll}>שחרור הכל<//>`}
      <${Button} kind="ghost" small onClick=${reload}>רענון<//>
    </div>
    ${shown.length === 0
      ? html`<${Empty} icon="shield" title=${filter === 'locked' ? 'אין כרגע אף חשבון או כתובת נעולים' : 'אין ניסיונות כושלים ב-24 השעות האחרונות'} />`
      : html`<div class="table-wrap"><table class="table">
          <thead><tr><th>סוג</th><th>מי / מה</th><th>ניסיונות</th><th>מצב</th><th /></tr></thead>
          <tbody>${shown.map((l) => html`<tr key=${l.key}>
            <td class="small">${l.kind_label}</td>
            <td>${l.user ? html`<b>${l.user.name}</b> <span class="muted small" dir="ltr">${l.kind === 'phone' || l.kind === 'mail' ? '' : l.value}</span>` : html`<span dir="ltr">${l.value}</span>`}</td>
            <td>${l.failures || '—'}</td>
            <td>${l.locked ? html`<${Badge} tone="warn">נעול ${until(l.locked_until)}<//>` : html`<span class="muted small">פתוח</span>`}</td>
            <td class="actions"><${Button} small kind=${l.locked ? 'primary' : 'ghost'} onClick=${() => unlock(l)}>${l.locked ? 'שחרור' : 'איפוס'}<//></td>
          </tr>`)}</tbody></table></div>`}
    <${ManualLock} onDone=${reload} />
  </section>`;
}

function ManualLock({ onDone }) {
  const [type, setType] = useState('ip');
  const [value, setValue] = useState('');
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try { await api.post('/admin/locks', { type, value, hours: Number(hours) }); toast('ננעל'); setValue(''); onDone(); }
    catch (err) { toastError(err); }
    setBusy(false);
  }
  return html`<details class="manual-lock">
    <summary>נעילה ידנית</summary>
    <form class="form-row" onSubmit=${submit}>
      <${Select} value=${type} onChange=${setType} options=${[
        { value: 'ip', label: 'כתובת IP (כניסות)' }, { value: 'login', label: 'משתמש (מייל או טלפון)' },
        { value: 'reg_email', label: 'הצטרפות: מייל' }, { value: 'reg_ip', label: 'הצטרפות: IP' }]} />
      <${Input} dir="ltr" value=${value} onInput=${setValue} placeholder=${type.includes('ip') ? '1.2.3.4' : 'name@example.com'} required />
      <${Select} value=${hours} onChange=${setHours} options=${[[1, 'שעה'], [24, 'יום'], [168, 'שבוע'], [720, 'חודש'], [8760, 'שנה']].map(([v, l]) => ({ value: v, label: l }))} />
      <${Button} kind="primary" loading=${busy} type="submit">נעילה<//>
    </form>
  </details>`;
}

function Blocklist() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/control'));
  const [entry, setEntry] = useState('');
  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const lines = (data.registration_blocklist || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const kind = (l) => (l.startsWith('@') ? 'דומיין' : l.includes('@') ? 'מייל' : /^[\d+\-\s]+$/.test(l) && l.replace(/\D/g, '').length >= 9 ? 'טלפון' : 'IP');
  const save = async (next, message) => {
    try { await api.patch('/admin/control', { registration_blocklist: next.join('\n') }); toast(message); reload(); }
    catch (e) { toastError(e); }
  };
  const add = (e) => {
    e.preventDefault();
    const v = entry.trim();
    if (!v) return;
    if (lines.some((l) => l.toLowerCase() === v.toLowerCase())) return toast('כבר ברשימה');
    save([...lines, v], 'נוסף לרשימת החסומים').then(() => setEntry(''));
  };
  return html`<section class="card section-card">
    <h3>חסומים מהצטרפות של בתי כנסת</h3>
    <p class="muted small">בקשת הצטרפות ממייל, דומיין, טלפון או IP שברשימה נבלעת בשקט: המבקש רואה שהבקשה נשלחה, ושום דבר לא נשמר.</p>
    <form class="form-row" onSubmit=${add}>
      <${Input} dir="ltr" value=${entry} onInput=${setEntry} placeholder="spam@example.com / @domain.com / 0501234567 / 1.2.3.4" />
      <${Button} kind="primary" icon="plus" type="submit">הוספה<//>
    </form>
    ${lines.length === 0
      ? html`<p class="muted">הרשימה ריקה.</p>`
      : html`<div class="block-list">${lines.map((l) => html`<div class="block-item" key=${l}>
          <${Badge}>${kind(l)}<//><span dir="ltr" class="grow">${l}</span>
          <${Button} kind="ghost" small icon="trash" title="הסרה" onClick=${() => save(lines.filter((x) => x !== l), 'הוסר מהרשימה')} />
        </div>`)}</div>`}
  </section>`;
}
