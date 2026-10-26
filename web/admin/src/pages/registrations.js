// Self-service synagogue registration: the public form (#/register), e-mail verification (#/verify)
// and the approvers' page (#/admin/registrations).
import { api } from '../api.js';
import { cx, formatDate, html, useEffect, useState } from '../lib.js';
import { Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Input, Select, Spinner, TextArea, Toggle, confirm, toast, toastError, useLoad } from '../ui.js';
import { AuthCard, useSubmit } from './login.js';

// ------------------------------------------------------------------ public form
export function RegisterPage() {
  const [form, setForm] = useState(null); // { enabled, form_token }
  const [areas, setAreas] = useState([]);
  const [v, setV] = useState({ synagogue_name: '', area_id: null, address: '', contact_name: '', email: '', phone: '', message: '', website: '' });
  const [sent, setSent] = useState(false);
  useEffect(() => {
    api.get('/public/registrations/form').then(setForm).catch(() => setForm({ enabled: false }));
    api.get('/public/catalog').then((c) => setAreas(c.areas)).catch(() => {});
  }, []);
  const set = (k) => (x) => setV((o) => ({ ...o, [k]: x }));
  const { busy, error, fields, submit } = useSubmit(async () => {
    await api.post('/public/registrations', { ...v, form_token: form.form_token });
    setSent(true);
  });

  if (!form) return html`<${AuthCard} title="הצטרפות בית כנסת" subtitle="טוען…"><div class="loading"><span class="spinner" /></div><//>`;
  if (!form.enabled) {
    return html`<${AuthCard} title="הצטרפות בית כנסת" subtitle="ההרשמה העצמית סגורה כרגע">
      <p class="muted center">להוספת בית כנסת פנו למנהל המערכת.</p><a class="btn btn-secondary btn-block" href="#/">למסך הכניסה</a><//>`;
  }
  if (sent) {
    return html`<${AuthCard} title="כמעט סיימנו" subtitle=${`שלחנו מייל אל ${v.email}`}>
      <div class="steps">
        <div class="step done"><b>1</b><span>שליחת הבקשה</span></div>
        <div class="step on"><b>2</b><span>אימות המייל: לחצו על הכפתור במייל</span></div>
        <div class="step"><b>3</b><span>אישור מנהל המערכת, ומייל עם כניסה ישירה</span></div>
      </div>
      <p class="muted small center">לא הגיע? בדקו בתיקיית הספאם. הקישור תקף ל-24 שעות.</p>
      <a class="btn btn-secondary btn-block" href="#/">למסך הכניסה</a><//>`;
  }
  return html`<${AuthCard} title="הצטרפות בית כנסת" subtitle="אחרי אימות המייל ואישור מנהל המערכת תקבלו כניסה לעדכון הזמנים">
    <form class="form" onSubmit=${submit}>
      ${error && html`<div class="alert alert-error">${error}</div>`}
      <${Field} label="שם בית הכנסת" error=${fields.synagogue_name}><${Input} value=${v.synagogue_name} onInput=${set('synagogue_name')} required maxlength="80" autofocus /><//>
      ${areas.length > 0 && html`<${Field} label="אזור" error=${fields.area_id}>
        <${Select} value=${v.area_id} onChange=${set('area_id')} placeholder="בחירת אזור" options=${areas.map((a) => ({ value: a.id, label: a.name }))} /><//>`}
      <${Field} label="כתובת" error=${fields.address}><${Input} value=${v.address} onInput=${set('address')} maxlength="150" /><//>
      <${Field} label="שם איש הקשר" error=${fields.contact_name}><${Input} value=${v.contact_name} onInput=${set('contact_name')} required maxlength="80" /><//>
      <div class="grid-2">
        <${Field} label="מייל" error=${fields.email}><${Input} type="email" dir="ltr" value=${v.email} onInput=${set('email')} required /><//>
        <${Field} label="טלפון" error=${fields.phone}><${Input} type="tel" dir="ltr" value=${v.phone} onInput=${set('phone')} required /><//>
      </div>
      <${Field} label="הודעה למנהל (לא חובה)" error=${fields.message}><${TextArea} value=${v.message} onInput=${set('message')} maxlength="500" rows="3" /><//>
      <div class="hp" aria-hidden="true"><label>אתר <input tabindex="-1" autocomplete="off" value=${v.website} onInput=${(e) => set('website')(e.currentTarget.value)} /></label></div>
      <${Button} kind="primary" class="btn-block" loading=${busy} type="submit">שליחת הבקשה<//>
      <a class="link center" href="#/">כבר יש לי משתמש</a>
    </form>
  <//>`;
}

/** #/verify?t=... : the button in the verification e-mail. */
export function VerifyPage({ token }) {
  const [state, setState] = useState({ step: 'working' });
  useEffect(() => {
    api.post('/public/registrations/verify', { token })
      .then((r) => setState({ step: 'done', ...r }))
      .catch((e) => setState({ step: 'failed', error: e.message }));
  }, [token]);
  if (state.step === 'working') return html`<${AuthCard} title="אימות המייל" subtitle="רגע…"><div class="loading"><span class="spinner" /></div><//>`;
  if (state.step === 'failed') {
    return html`<${AuthCard} title="לא הצלחנו לאמת" subtitle=${state.error}>
      <a class="btn btn-primary btn-block" href="#/register">שליחת בקשה חדשה</a><//>`;
  }
  const decided = state.status === 'approved' ? 'הבקשה כבר אושרה. בדקו במייל את פרטי הכניסה.' : state.status === 'rejected' ? 'הבקשה כבר טופלה.' : null;
  return html`<${AuthCard} title="המייל אומת" subtitle=${state.synagogue_name}>
    <div class="auth-success"><span>✓</span></div>
    <p class="center">${decided || 'הבקשה הועברה לאישור מנהל המערכת. כשתאושר יישלח אליכם מייל עם כפתור לכניסה ישירה.'}</p>
    <a class="btn btn-secondary btn-block" href="#/">למסך הכניסה</a>
  <//>`;
}

// ------------------------------------------------------------------ approvers
const STATUS = { unverified: ['ממתינה לאימות מייל', 'info'], pending: ['ממתינה לאישור', 'warn'], approved: ['אושרה', 'success'], rejected: ['נדחתה', 'neutral'] };

export function AdminRegistrations({ onChanged, isSuper }) {
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/admin/registrations'), api.get('/public/catalog')]));
  const [filter, setFilter] = useState('pending');
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [blocking, setBlocking] = useState(null);
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;
  const [{ items, unverified }, catalog] = data;
  const shown = filter === 'all' ? items : items.filter((r) => r.status === filter);
  const pendingCount = items.filter((r) => r.status === 'pending').length;
  const act = async (r, action, message) => {
    try { await api.post(`/admin/registrations/${r.id}/${action}`); toast(message); done(); } catch (e) { toastError(e); }
  };
  const done = () => { reload(); onChanged?.(); };
  async function remove(r) {
    if (!(await confirm({ title: 'מחיקת בקשה', body: `למחוק את הבקשה של ${r.synagogue_name}?`, confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/registrations/${r.id}`); toast('נמחק'); done(); } catch (e) { toastError(e); }
  }

  return html`<div class="page">
    <header class="page-head"><div><h1>בקשות הצטרפות</h1>
      <p class="muted">בתי כנסת שנרשמו בעצמם. בקשה עוברת לאישור אחרי שהמבקש אימת את המייל, ואפשר גם לאמת ידנית.</p></div>
      ${isSuper && html`<a class="btn btn-secondary" href="#/admin/security">חסימות ונעילות</a>`}</header>
    <div class="toolbar">
      <div class="segmented">
        ${[['pending', `ממתינות לאישור (${pendingCount})`], ['unverified', `ממתינות לאימות (${unverified})`], ['approved', 'אושרו'], ['rejected', 'נדחו'], ['all', 'הכל']].map(([k, l]) =>
          html`<button class=${cx(filter === k && 'on')} onClick=${() => setFilter(k)}>${l}</button>`)}
      </div>
    </div>
    ${shown.length === 0
      ? html`<${Empty} icon="building" title=${filter === 'pending' ? 'אין בקשות ממתינות' : 'אין בקשות'} />`
      : html`<div class="cards reg-cards">${shown.map((r) => html`<div class="card reg-card" key=${r.id}>
          <div class="row gap-sm wrap"><h3 class="grow">${r.synagogue_name}</h3>
            ${r.blocked && html`<${Badge} tone="warn">חסום<//>`}
            <${Badge} tone=${r.expired ? 'neutral' : STATUS[r.status][1]}>${r.expired ? 'קישור האימות פג' : STATUS[r.status][0]}<//></div>
          <dl class="reg-dl">
            <dt>אזור</dt><dd>${r.area_name || html`<span class="muted">לא נבחר</span>`}</dd>
            <dt>כתובת</dt><dd>${r.address || '—'}</dd>
            <dt>איש קשר</dt><dd>${r.contact_name}${r.existing_user ? html` <${Badge}>משתמש קיים<//>` : ''}</dd>
            <dt>מייל</dt><dd dir="ltr">${r.email}</dd>
            <dt>טלפון</dt><dd dir="ltr">${r.phone}</dd>
            ${r.ip && html`<dt>IP</dt><dd dir="ltr">${r.ip}</dd>`}
            <dt>נשלחה</dt><dd>${formatDate(r.verified_at || r.created_at)}</dd>
            ${r.status !== 'pending' && html`<dt>טופלה</dt><dd>${formatDate(r.decided_at)}${r.decided_by_name ? ` · ${r.decided_by_name}` : ''}</dd>`}
            ${r.reason && html`<dt>סיבה</dt><dd>${r.reason}</dd>`}
          </dl>
          ${r.message && html`<blockquote class="reg-msg">${r.message}</blockquote>`}
          <div class="row gap-sm">
            ${r.status === 'pending' && html`
              <${Button} kind="primary" icon="check" onClick=${() => setApproving(r)}>אישור<//>
              <${Button} onClick=${() => setRejecting(r)}>דחייה<//>`}
            ${r.status === 'unverified' && html`
              <${Button} icon="mail" onClick=${() => act(r, 'resend', `נשלח שוב מייל אימות אל ${r.email}`)}>שליחת אימות שוב<//>
              <${Button} icon="check" onClick=${() => act(r, 'verify', 'הבקשה עברה לאישור')}>אימות ידני<//>`}
            ${r.status === 'approved' && r.synagogue_id && html`<a class="btn btn-secondary" href=${`#/s/${r.synagogue_id}`}>לבית הכנסת</a>`}
            <span class="grow" />
            <${Button} kind="ghost" small icon="shield" title="חסימה" onClick=${() => setBlocking(r)} />
            <${Button} kind="ghost" small icon="trash" title="מחיקה" onClick=${() => remove(r)} />
          </div>
        </div>`)}</div>`}
    ${approving && html`<${ApproveModal} r=${approving} areas=${catalog.areas} onClose=${() => setApproving(null)} onDone=${done} />`}
    ${rejecting && html`<${RejectModal} r=${rejecting} onClose=${() => setRejecting(null)} onDone=${done} />`}
    ${blocking && html`<${BlockModal} r=${blocking} onClose=${() => setBlocking(null)} onDone=${done} />`}
  </div>`;
}

function ApproveModal({ r, areas, onClose, onDone }) {
  const initial = { synagogue_name: r.synagogue_name, area_id: r.area_id, address: r.address };
  return html`<${FormModal} title=${`אישור ${r.synagogue_name}`} initial=${initial} submitLabel="אישור ופתיחה" onClose=${onClose}
      save=${(v) => api.post(`/admin/registrations/${r.id}/approve`, v)}
      onSaved=${(res) => {
        toast(res.mail === 'sent' ? `בית הכנסת נפתח ונשלחו פרטי כניסה אל ${r.email}` : `בית הכנסת נפתח, אבל המייל לא נשלח: ${res.mail}`, res.mail === 'sent' ? undefined : 'error');
        onDone();
      }}>
    ${({ values: v, set, errors }) => html`
      <${Field} label="שם בית הכנסת" error=${errors.synagogue_name}><${Input} value=${v.synagogue_name} onInput=${set('synagogue_name')} /><//>
      <${Field} label="אזור" error=${errors.area_id}><${Select} value=${v.area_id} onChange=${set('area_id')} placeholder="בחירת אזור" options=${areas.map((a) => ({ value: a.id, label: a.name }))} /><//>
      <${Field} label="כתובת" error=${errors.address}><${Input} value=${v.address} onInput=${set('address')} /><//>
      <div class="alert alert-info">${r.existing_user
        ? `ל-${r.email} כבר יש משתמש. בית הכנסת יתווסף אליו, ויישלח לו מייל עם כניסה ישירה.`
        : `ייפתח משתמש מנהל בית כנסת ל${r.contact_name} (${r.email}). הוא יקבל מייל עם כניסה ישירה, ויתבקש לבחור סיסמה בכניסה הראשונה.`}</div>`}
  <//>`;
}

/** Adds the request's e-mail / domain / phone / IP to the blocklist (and rejects an open request quietly). */
function BlockModal({ r, onClose, onDone }) {
  const options = [['email', `המייל ${r.email}`], ['domain', `כל הדומיין @${r.email.split('@')[1]}`], ['phone', `הטלפון ${r.phone}`], ...(r.ip ? [['ip', `כתובת ה-IP ${r.ip}`]] : [])];
  return html`<${FormModal} title=${`חסימת ${r.contact_name}`} initial=${{ what: ['email'] }} submitLabel="חסימה" onClose=${onClose}
      save=${(v) => { if (!v.what.length) throw new Error('יש לבחור מה לחסום'); return api.post(`/admin/registrations/${r.id}/block`, v); }}
      onSaved=${(res) => { toast(`נוספו לרשימת החסומים: ${res.blocked.join(', ')}`); onDone(); }}>
    ${({ values: v, set }) => html`
      <${Field} group label="מה לחסום מהצטרפות" hint=${/gmail|walla|yahoo|hotmail|outlook/.test(r.email) ? 'שימו לב: חסימת דומיין של שירות מייל ציבורי תחסום את כל המשתמשים בו' : ''}>
        <${CheckList} options=${options.map(([value, label]) => ({ value, label }))} value=${v.what} onChange=${set('what')} /><//>
      ${(r.status === 'pending' || r.status === 'unverified') && html`<div class="alert alert-info">הבקשה תסומן כנדחתה, בלי לשלוח מייל למבקש.</div>`}
      <p class="muted small">את רשימת החסומים המלאה מנהל העל מנהל בעמוד "חסימות ונעילות".</p>`}
  <//>`;
}

function RejectModal({ r, onClose, onDone }) {
  return html`<${FormModal} title=${`דחיית ${r.synagogue_name}`} initial=${{ reason: '', notify: true, block: false }} submitLabel="דחייה" onClose=${onClose}
      save=${(v) => api.post(`/admin/registrations/${r.id}/reject`, v)}
      onSaved=${() => { toast('הבקשה נדחתה'); onDone(); }}>
    ${({ values: v, set, errors }) => html`
      <${Field} label="סיבה (לא חובה)" error=${errors.reason}><${TextArea} value=${v.reason} onInput=${set('reason')} rows="3" maxlength="500" /><//>
      <${Toggle} checked=${v.notify && !v.block} disabled=${v.block} onChange=${set('notify')} label="לשלוח למבקש מייל עם הסיבה" />
      <${Toggle} checked=${v.block} onChange=${set('block')} label="ספאם: לחסום את המייל הזה" hint="המייל נוסף לרשימת החסומים בהגדרות השליטה, ולא יישלח אליו מייל" />`}
  <//>`;
}
