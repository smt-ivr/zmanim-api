import { api } from '../api.js';
import { html, norm, pluralize, timeAgo, useEffect, useMemo, useState } from '../lib.js';
import {
  Avatar, Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Icon, Input, Pager, Select, Spinner, SynagogueMultiPicker, Toggle,
  confirm, toast, toastError, useLoad,
} from '../ui.js';
import { UserHistory } from './history.js';

const ROLE = { admin: 'מנהל מערכת', manager: 'גבאי בית כנסת' };
const PAGE = 50;

export function AdminUsers({ me, system }) {
  // What this admin may change: managers need 'managers', admins need 'admins' (the super admin: everything).
  const mayManage = (u) => !u.is_super && me.perms.includes(u.role === 'admin' ? 'admins' : 'managers');
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/admin/users').then((users) => ({ users })));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [syn, setSyn] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  useEffect(() => setPage(0), [q, role, status, syn]);

  const shown = useMemo(() => (data?.users || []).filter((u) =>
    (role === 'all' || u.role === role) &&
    (status === 'all' || (status === 'active' ? u.is_active : status === 'disabled' ? !u.is_active : status === 'locked' ? u.locked_until
      : status === 'unassigned' ? u.role === 'manager' && !u.synagogues.length : status === 'never' ? !u.last_login_at : true)) &&
    (!syn || u.synagogues.some((s) => norm(s.name).includes(norm(syn)))) &&
    (!q || norm(`${u.name} ${u.email || ''} ${u.phone || ''}`).includes(norm(q)))), [data, q, role, status, syn]);

  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;
  const pageItems = shown.slice(page * PAGE, (page + 1) * PAGE);
  const count = (r) => data.users.filter((u) => r === 'all' || u.role === r).length;
  const saved = (u, isNew) => setData((d) => ({ ...d, users: isNew ? [...d.users, u] : d.users.map((x) => (x.id === u.id ? u : x)) }));

  async function welcome(u) {
    if (!(await confirm({ title: `מייל פתיחה ל${u.name}`, body: `יישלח אל ${u.email} מייל עם שם המשתמש וקישור כניסה (תקף לשבוע).`, confirmLabel: 'שליחה' }))) return;
    try { await api.post(`/admin/users/${u.id}/welcome`); toast('המייל נשלח'); } catch (e) { toastError(e); }
  }

  async function unlock(u) {
    try { await api.post(`/admin/users/${u.id}/unlock`); saved({ ...u, locked_until: null }, false); toast(`הנעילה של ${u.name} שוחררה`); }
    catch (e) { toastError(e); }
  }

  async function remove(u) {
    if (!(await confirm({ title: `מחיקת ${u.name}`, body: 'המשתמש יימחק וינותק מכל המכשירים. בתי הכנסת שלו לא יימחקו.', confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/users/${u.id}`); setData((d) => ({ ...d, users: d.users.filter((x) => x.id !== u.id) })); toast('המשתמש נמחק'); }
    catch (e) { toastError(e); }
  }

  return html`<div class="page">
    <header class="page-head">
      <div><h1>משתמשים</h1><p class="muted">${pluralize(count('manager'), 'גבאי בית כנסת', 'גבאי בתי כנסת')} · ${pluralize(count('admin'), 'מנהל מערכת', 'מנהלי מערכת')}</p></div>
      ${(me.perms.includes('managers') || me.perms.includes('admins')) && html`<${Button} kind="primary" icon="plus" onClick=${() => setEditing('new')}>משתמש חדש<//>`}
    </header>
    <div class="tabs">
      ${[['all', 'כולם'], ['manager', 'גבאי בתי כנסת'], ['admin', 'מנהלי מערכת']].map(([k, l]) =>
        html`<button class=${role === k ? 'tab active' : 'tab'} onClick=${() => setRole(k)}>${l}<span class="count">${count(k)}</span></button>`)}
    </div>
    <div class="toolbar filters">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש לפי שם, מייל או טלפון…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      <div class="search"><${Icon} name="building" /><input class="input" placeholder="סינון לפי בית כנסת…" value=${syn} onInput=${(e) => setSyn(e.currentTarget.value)} /></div>
      <${Select} value=${status} onChange=${setStatus} options=${[
        { value: 'all', label: 'כל המצבים' }, { value: 'active', label: 'פעילים' }, { value: 'disabled', label: 'מושבתים' }, { value: 'locked', label: 'נעולים' },
        { value: 'unassigned', label: 'בלי בית כנסת' }, { value: 'never', label: 'עוד לא נכנסו' }]} />
    </div>
    ${shown.length === 0
      ? html`<${Empty} icon="users" title="אין משתמשים שמתאימים לסינון" />`
      : html`<div class="table-wrap card"><table class="table responsive">
          <thead><tr><th>שם</th><th>תפקיד</th><th>בתי כנסת</th><th>כניסה אחרונה</th><th /></tr></thead>
          <tbody>${pageItems.map((u) => html`<tr key=${u.id} class=${u.is_active ? '' : 'inactive'}>
            <td data-label="שם"><div class="row gap-sm"><${Avatar} name=${u.name} size=${32} /><div class="grow"><b>${u.name}</b>${u.is_super && u.is_hidden && html` <${Badge}>מוסתר<//>`}${u.id === me.id && html` <${Badge} tone="info">זה אתה<//>`}${!u.is_active && html` <${Badge} tone="warn">מושבת<//>`}
              <div class="muted small" dir="ltr">${[u.email, u.phone].filter(Boolean).join(' · ')}</div>
              <div class="row gap-sm">${u.locked_until && html`<${Badge} tone="warn">נעול עד ${new Date(u.locked_until * 1000).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}<//>`}${u.role === 'admin' && !u.is_super && u.perms.length < Object.keys(PERMS).length - 1 && html`<${Badge} tone="info">${u.perms.length ? `הרשאות חלקיות (${u.perms.length})` : 'צפייה בלבד'}<//>`}${u.must_change_password && html`<${Badge} tone="warn">חייב להחליף סיסמה<//>`}${u.phone_requires_password && html`<${Badge}>סיסמה בטלפון<//>`}${!u.can_message && html`<${Badge} tone="warn">חסום מהודעות<//>`}</div></div></div></td>
            <td data-label="תפקיד"><${Badge} tone=${u.role === 'admin' ? 'info' : 'neutral'}>${ROLE[u.role]}<//></td>
            <td data-label="בתי כנסת" class="small">${u.role === 'admin' ? html`<span class="muted">כולם</span>` : u.synagogues.length
              ? html`${u.synagogues.slice(0, 2).map((s, i) => html`${i ? ', ' : ''}<a href=${`#/s/${s.id}`}>${s.name}</a>`)}${u.synagogues.length > 2 ? html` <span class="muted">ועוד ${u.synagogues.length - 2}</span>` : ''}`
              : html`<${Badge} tone="warn">לא שויך<//>`}</td>
            <td data-label="כניסה אחרונה" class="small muted">${u.last_login_at ? timeAgo(u.last_login_at) : 'עוד לא נכנס'}</td>
            <td class="actions">
              ${mayManage(u) && system?.mail_ready && u.email && html`<${Button} kind="ghost" small icon="mail" title="שליחת פרטי כניסה במייל" onClick=${() => welcome(u)} />`}
              ${mayManage(u) && u.locked_until && html`<${Button} kind="ghost" small icon="key" title="שחרור הנעילה" onClick=${() => unlock(u)} />`}
              ${(mayManage(u) || me.is_super) && html`<${Button} kind="ghost" small icon="history" title="היסטוריה" onClick=${() => setHistory(u)} />`}
              ${(mayManage(u) || u.id === me.id) && html`<${Button} kind="ghost" small icon="edit" title="עריכה" onClick=${() => setEditing(u)} />`}
              ${mayManage(u) && u.id !== me.id && !u.is_super && html`<${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => remove(u)} />`}
            </td>
          </tr>`)}</tbody></table>
          <${Pager} page=${page} pageSize=${PAGE} total=${shown.length} onPage=${setPage} /></div>`}
    ${editing && html`<${UserModal} user=${editing === 'new' ? null : editing} me=${me} mailReady=${system?.mail_ready}
        onClose=${() => setEditing(null)} onSaved=${saved} />`}
    ${history && html`<${UserHistory} user=${history} onClose=${() => setHistory(null)} />`}
  </div>`;
}

function UserModal({ user, me, mailReady, onClose, onSaved }) {
  const isNew = !user;
  const self = user?.id === me.id;
  const initial = {
    name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', role: user?.role ?? 'manager',
    is_active: user?.is_active ?? true, password: '', synagogues: user?.synagogues ?? [],
    send_welcome: !user && Boolean(mailReady), send_password: false,
    must_change_password: user?.must_change_password ?? false,
    admin_perms: user?.perms ?? DEFAULT_PERMS,
    can_edit_email: user?.can_edit_email ?? true, can_edit_password: user?.can_edit_password ?? true, can_message: user?.can_message ?? true,
  };
  const save = (v) => {
    const { synagogues, ...rest } = v;
    const body = { ...rest, email: v.email || null, phone: v.phone || null, synagogue_ids: synagogues.map((s) => s.id) };
    if (!body.password) { delete body.password; body.send_password = false; }
    if (!me.is_super || v.role !== 'admin') delete body.admin_perms;
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
          <button type="button" class=${v.role === 'manager' ? 'on' : ''} onClick=${() => set('role')('manager')}>גבאי בית כנסת</button>
          <button type="button" class=${v.role === 'admin' ? 'on' : ''} onClick=${() => set('role')('admin')}>מנהל מערכת</button>
        </div><//>`}
      ${v.role === 'manager'
        ? html`<${Field} group label="בתי הכנסת שהוא גבאי בהם" error=${errors.synagogue_ids}>
            <${SynagogueMultiPicker} value=${v.synagogues} onChange=${set('synagogues')} /><//>`
        : user?.is_super
          ? html`<div class="alert alert-info">למשתמש זה יש את כל ההרשאות.</div>`
          : me.is_super
            ? html`<${Field} group label="מה מנהל המערכת הזה יכול לעשות" hint="צפייה בכל בתי הכנסת והמשתמשים מותרת תמיד. מה שלא מסומן חסום, גם באתר וגם בטלפון">
                <${CheckList} options=${Object.entries(PERMS).map(([value, label]) => ({ value, label }))} value=${v.admin_perms} onChange=${set('admin_perms')} />
                <div class="row gap-sm pad-top">
                  <button type="button" class="link" onClick=${() => set('admin_perms')(Object.keys(PERMS))}>הכל</button>
                  <button type="button" class="link" onClick=${() => set('admin_perms')(DEFAULT_PERMS)}>ברירת מחדל</button>
                  <button type="button" class="link" onClick=${() => set('admin_perms')([])}>צפייה בלבד</button>
                </div><//>`
            : html`<div class="alert alert-info">אין לך הרשאה לשנות הרשאות של מנהלים.</div>`}
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

// Same list as the server (api/src/auth.js PERMS).
const PERMS = {
  synagogues: 'הוספה ועריכה של בתי כנסת והגדרותיהם',
  synagogues_delete: 'מחיקת בתי כנסת',
  minyanim: 'עדכון זמנים, מיקומים ופרטים בכל בית כנסת',
  managers: 'ניהול גבאי בתי כנסת (משתמשים)',
  admins: 'ניהול מנהלי מערכת אחרים',
  catalog: 'הגדרות ורשימות (תפילות, זמני ייחוס, עונות, אזורים)',
  phone: 'הגדרות שלוחות הטלפון',
  registrations: 'אישור בקשות הצטרפות של בתי כנסת',
};
const DEFAULT_PERMS = Object.keys(PERMS).filter((p) => p !== 'registrations');

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(12)), (n) => chars[n % chars.length]).join('');
}
