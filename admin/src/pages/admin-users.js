import { api } from '../api.js';
import { formatDate, html, norm, useState } from '../lib.js';
import { Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Icon, Input, Spinner, Toggle, confirm, toast, toastError, useLoad } from '../ui.js';

const ROLE = { admin: 'מנהל מערכת', manager: 'מנהל בית כנסת' };

export function AdminUsers({ me }) {
  const { data, error, loading, reload, setData } = useLoad(() =>
    Promise.all([api.get('/admin/users'), api.get('/admin/synagogues')]).then(([users, synagogues]) => ({ users, synagogues }))
  );
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [editing, setEditing] = useState(null);

  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const shown = data.users.filter((u) => (role === 'all' || u.role === role) && (!q || norm(`${u.name} ${u.email} ${u.phone}`).includes(norm(q))));
  const saved = (u, isNew) => setData((d) => ({ ...d, users: isNew ? [...d.users, u] : d.users.map((x) => (x.id === u.id ? u : x)) }));

  async function remove(u) {
    if (!(await confirm({ title: `מחיקת ${u.name}`, body: 'המשתמש יימחק וינותק מכל המכשירים. בתי הכנסת שלו לא יימחקו.', confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/users/${u.id}`); setData((d) => ({ ...d, users: d.users.filter((x) => x.id !== u.id) })); toast('המשתמש נמחק'); }
    catch (e) { toastError(e); }
  }

  return html`<div class="page">
    <header class="page-head">
      <div><h1>משתמשים</h1><p class="muted">מנהלי מערכת ומנהלי בתי כנסת</p></div>
      <${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>משתמש חדש<//>
    </header>
    <div class="toolbar">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש לפי שם, מייל או טלפון…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      <div class="segmented">
        ${[['all', 'הכל'], ['manager', 'מנהלי בתי כנסת'], ['admin', 'מנהלי מערכת']].map(([k, l]) =>
          html`<button class=${role === k ? 'on' : ''} onClick=${() => setRole(k)}>${l}</button>`)}
      </div>
    </div>
    ${shown.length === 0
      ? html`<${Empty} icon="users" title="אין משתמשים להצגה" />`
      : html`<div class="table-wrap card"><table class="table">
          <thead><tr><th>שם</th><th>תפקיד</th><th>בתי כנסת</th><th>כניסה אחרונה</th><th /></tr></thead>
          <tbody>${shown.map((u) => html`<tr key=${u.id} class=${u.is_active ? '' : 'inactive'}>
            <td><b>${u.name}</b>${u.id === me.id && html` <${Badge} tone="info">זה אתה<//>`}${!u.is_active && html` <${Badge} tone="warn">מושבת<//>`}
              <div class="muted small" dir="ltr">${u.email}</div></td>
            <td><${Badge} tone=${u.role === 'admin' ? 'info' : 'neutral'}>${ROLE[u.role]}<//></td>
            <td class="small">${u.role === 'admin' ? html`<span class="muted">כולם</span>` : u.synagogues.length ? u.synagogues.map((s) => s.name).join(', ') : html`<${Badge} tone="warn">לא שויך<//>`}</td>
            <td class="small muted">${formatDate(u.last_login_at)}</td>
            <td class="actions">
              <${Button} kind="ghost" small icon="edit" title="עריכה" onClick=${() => setEditing(u)} />
              ${u.id !== me.id && html`<${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => remove(u)} />`}
            </td>
          </tr>`)}</tbody></table></div>`}
    ${editing && html`<${UserModal} user=${editing === 'new' ? null : editing} me=${me} synagogues=${data.synagogues}
        onClose=${() => setEditing(null)} onSaved=${saved} />`}
  </div>`;
}

function UserModal({ user, me, synagogues, onClose, onSaved }) {
  const isNew = !user;
  const self = user?.id === me.id;
  const initial = {
    name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', role: user?.role ?? 'manager',
    is_active: user?.is_active ?? true, password: '', synagogue_ids: user?.synagogues.map((s) => s.id) ?? [],
  };
  const save = (v) => {
    const body = { ...v };
    if (!isNew && !body.password) delete body.password;
    if (self) { delete body.role; delete body.is_active; }
    return isNew ? api.post('/admin/users', body) : api.patch(`/admin/users/${user.id}`, body);
  };

  return html`<${FormModal} title=${isNew ? 'משתמש חדש' : `עריכת ${user.name}`} initial=${initial} save=${save} onClose=${onClose}
      onSaved=${(u) => { onSaved(u, isNew); toast(isNew ? 'המשתמש נוצר' : 'השינויים נשמרו'); }}>
    ${({ values: v, set, errors }) => html`
      <div class="grid-2">
        <${Field} label="שם מלא" error=${errors.name}><${Input} value=${v.name} onInput=${set('name')} required /><//>
        <${Field} label="טלפון" error=${errors.phone}><${Input} dir="ltr" value=${v.phone} onInput=${set('phone')} /><//>
      </div>
      <${Field} label="מייל (שם משתמש)" error=${errors.email}><${Input} type="email" dir="ltr" value=${v.email} onInput=${set('email')} required /><//>
      <${Field} label=${isNew ? 'סיסמה' : 'סיסמה חדשה'} error=${errors.password} hint=${isNew ? '8 תווים לפחות. מסרו אותה למשתמש' : 'השאירו ריק כדי לא לשנות. שינוי מנתק את המשתמש מכל המכשירים'}>
        <div class="input-group">
          <${Input} dir="ltr" value=${v.password} onInput=${set('password')} autocomplete="new-password" />
          <${Button} kind="ghost" icon="key" title="יצירת סיסמה" onClick=${() => set('password')(randomPassword())} />
        </div><//>
      ${!self && html`<${Field} group label="תפקיד">
        <div class="segmented full">
          <button type="button" class=${v.role === 'manager' ? 'on' : ''} onClick=${() => set('role')('manager')}>מנהל בית כנסת</button>
          <button type="button" class=${v.role === 'admin' ? 'on' : ''} onClick=${() => set('role')('admin')}>מנהל מערכת</button>
        </div><//>`}
      ${v.role === 'manager'
        ? html`<${Field} group label="בתי הכנסת שהוא מנהל" error=${errors.synagogue_ids}>
            <${CheckList} searchable options=${synagogues.map((s) => ({ value: s.id, label: s.name, sub: s.area_name || '' }))} value=${v.synagogue_ids} onChange=${set('synagogue_ids')} empty="אין בתי כנסת" /><//>`
        : html`<div class="alert alert-info">מנהל מערכת מנהל את כל בתי הכנסת, המשתמשים וההגדרות.</div>`}
      ${!self && html`<${Toggle} checked=${v.is_active} onChange=${set('is_active')} label="משתמש פעיל" hint="השבתה מנתקת את המשתמש מיד ומונעת כניסה" />`}`}
  <//>`;
}

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join('');
}
