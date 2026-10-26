import { api } from '../api.js';
import { formatDate, html, norm, useState } from '../lib.js';
import { Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Icon, Input, Spinner, Toggle, confirm, toast, toastError, useLoad } from '../ui.js';

const ROLE = { admin: 'מנהל מערכת', manager: 'מנהל בית כנסת' };

export function AdminUsers({ me, system }) {
  const { data, error, loading, reload, setData } = useLoad(() =>
    Promise.all([api.get('/admin/users'), api.get('/admin/synagogues')]).then(([users, synagogues]) => ({ users, synagogues }))
  );
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [editing, setEditing] = useState(null);

  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const shown = data.users.filter((u) => (role === 'all' || u.role === role) && (!q || norm(`${u.name} ${u.email || ''} ${u.phone || ''}`).includes(norm(q))));
  const saved = (u, isNew) => setData((d) => ({ ...d, users: isNew ? [...d.users, u] : d.users.map((x) => (x.id === u.id ? u : x)) }));

  async function welcome(u) {
    if (!(await confirm({ title: `מייל פתיחה ל${u.name}`, body: `יישלח אל ${u.email} מייל עם שם המשתמש וקישור כניסה (תקף לשבוע).`, confirmLabel: 'שליחה' }))) return;
    try { await api.post(`/admin/users/${u.id}/welcome`); toast('המייל נשלח'); } catch (e) { toastError(e); }
  }

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
            <td><b>${u.name}</b>${u.is_super && html` <${Badge} tone="info">מנהל על<//>`}${u.is_super && u.is_hidden && html` <${Badge}>מוסתר<//>`}${u.id === me.id && html` <${Badge} tone="info">זה אתה<//>`}${!u.is_active && html` <${Badge} tone="warn">מושבת<//>`}
              <div class="muted small" dir="ltr">${[u.email, u.phone].filter(Boolean).join(' · ')}</div>
              <div class="row gap-sm">${u.must_change_password && html`<${Badge} tone="warn">חייב להחליף סיסמה<//>`}${u.phone_requires_password && html`<${Badge}>סיסמה בטלפון<//>`}${!u.can_message && html`<${Badge} tone="warn">חסום מפניות<//>`}</div></td>
            <td><${Badge} tone=${u.role === 'admin' ? 'info' : 'neutral'}>${ROLE[u.role]}<//></td>
            <td class="small">${u.role === 'admin' ? html`<span class="muted">כולם</span>` : u.synagogues.length ? u.synagogues.map((s) => s.name).join(', ') : html`<${Badge} tone="warn">לא שויך<//>`}</td>
            <td class="small muted">${formatDate(u.last_login_at)}</td>
            <td class="actions">
              ${system?.mail_ready && u.email && html`<${Button} kind="ghost" small icon="mail" title="שליחת מייל פתיחה עם קישור כניסה" onClick=${() => welcome(u)} />`}
              <${Button} kind="ghost" small icon="edit" title="עריכה" onClick=${() => setEditing(u)} />
              ${u.id !== me.id && !u.is_super && html`<${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => remove(u)} />`}
            </td>
          </tr>`)}</tbody></table></div>`}
    ${editing && html`<${UserModal} user=${editing === 'new' ? null : editing} me=${me} mailReady=${system?.mail_ready} synagogues=${data.synagogues}
        onClose=${() => setEditing(null)} onSaved=${saved} />`}
  </div>`;
}

function UserModal({ user, me, mailReady, synagogues, onClose, onSaved }) {
  const isNew = !user;
  const self = user?.id === me.id;
  const initial = {
    name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', role: user?.role ?? 'manager',
    is_active: user?.is_active ?? true, password: '', synagogue_ids: user?.synagogues.map((s) => s.id) ?? [],
    send_welcome: !user && Boolean(mailReady), send_password: false,
    must_change_password: user?.must_change_password ?? false,
    can_edit_email: user?.can_edit_email ?? true, can_edit_password: user?.can_edit_password ?? true, can_message: user?.can_message ?? true,
  };
  const save = (v) => {
    const body = { ...v, email: v.email || null, phone: v.phone || null };
    if (!body.password) { delete body.password; body.send_password = false; }
    if (self) { delete body.role; delete body.is_active; delete body.can_edit_email; delete body.can_edit_password; delete body.can_message; delete body.must_change_password; }
    return isNew ? api.post('/admin/users', body) : api.patch(`/admin/users/${user.id}`, body);
  };

  return html`<${FormModal} title=${isNew ? 'משתמש חדש' : `עריכת ${user.name}`} initial=${initial} save=${save} onClose=${onClose}
      onSaved=${(u) => {
        onSaved(u, isNew);
        if (u.welcome_error) toast(`${isNew ? 'המשתמש נוצר' : 'השינויים נשמרו'}, אבל המייל לא נשלח: ${u.welcome_error}`, 'error');
        else if (u.welcome_sent) toast(isNew ? 'המשתמש נוצר ונשלחו לו פרטי הכניסה במייל' : 'השינויים נשמרו ונשלחו פרטי הכניסה במייל');
        else toast(isNew ? 'המשתמש נוצר' : 'השינויים נשמרו');
      }}>
    ${({ values: v, set, errors }) => html`
      <div class="grid-2">
        <${Field} label="שם מלא" error=${errors.name}><${Input} value=${v.name} onInput=${set('name')} required /><//>
        <${Field} label="טלפון" error=${errors.phone} hint="לכניסה, ולניהול בשלוחת הטלפון מהמספר הזה"><${Input} dir="ltr" type="tel" value=${v.phone} onInput=${set('phone')} required /><//>
      </div>
      <${Field} label="מייל" error=${errors.email} hint="אפשר להיכנס עם המייל או עם הטלפון"><${Input} type="email" dir="ltr" value=${v.email} onInput=${set('email')} required /><//>
      <${Field} label=${isNew || !user.has_password ? 'סיסמה' : 'סיסמה חדשה'} error=${errors.password} hint=${isNew || !user.has_password ? '4 תווים לפחות. מסרו אותה למשתמש' : 'השאירו ריק כדי לא לשנות. שינוי מנתק את המשתמש מכל המכשירים'}>
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
      ${!self && html`<${Toggle} checked=${v.is_active} onChange=${set('is_active')} label="משתמש פעיל" hint="השבתה מנתקת את המשתמש מיד ומונעת כניסה" />`}
      ${!self && html`<${Toggle} checked=${v.must_change_password} onChange=${set('must_change_password')}
        label="חיוב החלפת סיסמה בכניסה הבאה" hint="המשתמש לא יוכל לעשות שום דבר עד שיבחר סיסמה משלו" />`}
      ${!self && html`<div class="sub-option">
        <${Toggle} checked=${v.send_welcome} onChange=${set('send_welcome')} disabled=${!mailReady}
          label=${isNew ? 'לשלוח למשתמש את פרטי הכניסה במייל' : 'לשלוח שוב את פרטי הכניסה במייל'}
          hint=${mailReady ? 'שם המשתמש וכפתור לכניסה ישירה בלי סיסמה (תקף לשבוע)' : 'שליחת מיילים לא מוגדרת. הגדירו אותה בהגדרות השליטה'} />
        ${v.send_welcome && html`<${Toggle} checked=${v.send_password && Boolean(v.password)} onChange=${set('send_password')} disabled=${!v.password}
          label="לכלול במייל גם את הסיסמה"
          hint=${v.password ? 'מומלץ יחד עם חיוב החלפת סיסמה' : isNew ? 'הקלידו סיסמה כדי לשלוח אותה' : 'רק סיסמה חדשה שמקלידים עכשיו אפשר לשלוח (הסיסמה הקיימת שמורה מוצפנת)'} />`}
      </div>`}
      ${!self && html`<h4>מה המשתמש יכול לשנות בעצמו</h4>
        <${Toggle} checked=${v.can_edit_email} onChange=${set('can_edit_email')} label="שינוי מייל" />
        <${Toggle} checked=${v.can_edit_password} onChange=${set('can_edit_password')} label="שינוי סיסמה" />
        ${me.is_super && html`<${Toggle} checked=${v.can_message} onChange=${set('can_message')} label="שליחת פניות לצוות הפיתוח" />`}`}`}
  <//>`;
}

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join('');
}
