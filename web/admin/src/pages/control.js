// Super admin: control settings and the developers' inbox. Everyone: writing to the developers.
import { api } from '../api.js';
import { cx, formatDate, html, useState } from '../lib.js';
import { Badge, Button, Empty, ErrorBox, Field, Icon, Input, Spinner, TextArea, Toggle, confirm, toast, toastError, useLoad } from '../ui.js';

// ------------------------------------------------------------------ control settings
export function ControlPage({ onChanged }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/admin/control'));
  const [busy, setBusy] = useState('');
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  async function save(patch, label = 'נשמר') {
    const key = Object.keys(patch)[0];
    setBusy(key);
    try { setData(await api.patch('/admin/control', patch)); toast(label); onChanged?.(); }
    catch (e) { toastError(e); }
    setBusy('');
  }
  const toggle = (key, label, hint) => html`<div class="setting">
    <${Toggle} checked=${data[key]} onChange=${(v) => save({ [key]: v })} label=${label} hint=${hint} />
    ${busy === key && html`<span class="spinner" />`}
  </div>`;

  return html`<div class="page narrow">
    <header class="page-head"><div><h1>הגדרות שליטה</h1><p class="muted">מתגים כלליים לכל המערכת. השינוי חל מיד.</p></div></header>

    <section class="card">
      <h3><${Icon} name="clock" /> זמנים</h3>
      ${toggle('shabbat_enabled', 'זמני שבת פעילים', 'כבוי: מניינים של שבת לא מוצגים באתר ובטלפון, ולא ניתן להגדיר מניין לשבת בלבד')}
    </section>

    <section class="card">
      <h3><${Icon} name="home" /> אתר ציבורי</h3>
      ${toggle('public_site_enabled', 'האתר הציבורי פתוח', 'כבוי: המבקרים רואים הודעה שהאתר סגור זמנית')}
      <${NoticeEditor} value=${data.site_notice} onSave=${(v) => save({ site_notice: v }, 'ההודעה עודכנה')} />
    </section>

    <section class="card">
      <h3><${Icon} name="phone" /> שלוחות טלפון</h3>
      ${toggle('listen_enabled', 'קו שמיעת הזמנים פעיל', 'הקו הציבורי שבו כל אחד יכול לשמוע את הזמנים')}
      ${toggle('manage_phone_enabled', 'שלוחת הניהול פעילה', 'כבוי: אי אפשר לנהל בטלפון, רק באתר')}
      <${PhoneEditor} value=${data.listen_phone} onSave=${(v) => save({ listen_phone: v }, 'המספר עודכן')} />
    </section>

    <section class="card">
      <h3><${Icon} name="mail" /> פניות לצוות הפיתוח</h3>
      ${toggle('feedback_enabled', 'קבלת פניות פתוחה', 'כבוי: אף משתמש לא יכול לשלוח פנייה. חסימה של משתמש מסוים נעשית בעמוד המשתמשים')}
    </section>
  </div>`;
}

function NoticeEditor({ value, onSave }) {
  const [v, setV] = useState(value || '');
  return html`<form class="form setting-form" onSubmit=${(e) => (e.preventDefault(), onSave(v.trim()))}>
    <${Field} label="הודעה בראש האתר הציבורי" hint="ריק = אין הודעה. למשל: זמני החורף נכנסים לתוקף ביום ראשון">
      <${Input} value=${v} onInput=${setV} maxlength="300" /><//>
    <div class="row gap-sm"><${Button} kind="primary" small type="submit">שמירת ההודעה<//>${value && html`<${Button} small onClick=${() => { setV(''); onSave(''); }}>הסרה<//>`}</div>
  </form>`;
}

function PhoneEditor({ value, onSave }) {
  const [v, setV] = useState(value || '');
  return html`<form class="form setting-form" onSubmit=${(e) => (e.preventDefault(), onSave(v.trim()))}>
    <${Field} label="מספר הקו שמוצג באתר"><${Input} dir="ltr" type="tel" value=${v} onInput=${setV} /><//>
    <div><${Button} kind="primary" small type="submit">שמירה<//></div>
  </form>`;
}

// ------------------------------------------------------------------ inbox (super admin)
export function Inbox() {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/admin/feedback'));
  const [filter, setFilter] = useState('all');
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  const unread = data.filter((f) => !f.is_read).length;
  const shown = filter === 'unread' ? data.filter((f) => !f.is_read) : data;
  const setRead = async (f, is_read) => {
    try { await api.patch(`/admin/feedback/${f.id}`, { is_read }); setData((d) => d.map((x) => (x.id === f.id ? { ...x, is_read } : x))); }
    catch (e) { toastError(e); }
  };
  const remove = async (f) => {
    if (!(await confirm({ title: 'מחיקת פנייה', body: 'למחוק את הפנייה?', confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/feedback/${f.id}`); setData((d) => d.filter((x) => x.id !== f.id)); } catch (e) { toastError(e); }
  };
  const block = async (f) => {
    const ok = await confirm({ title: `חסימת ${f.user_name}`, body: 'המשתמש לא יוכל לשלוח פניות נוספות. אפשר לבטל בעמוד המשתמשים.', confirmLabel: 'חסימה', danger: true });
    if (!ok) return;
    try {
      await api.patch(`/admin/users/${f.user_id}`, { can_message: false });
      setData((d) => d.map((x) => (x.user_id === f.user_id ? { ...x, can_message: false } : x)));
      toast('המשתמש נחסם מפניות');
    } catch (e) { toastError(e); }
  };

  return html`<div class="page narrow">
    <header class="page-head"><div><h1>פניות לצוות הפיתוח</h1><p class="muted">רק מנהל העל רואה את הפניות. ${unread ? `${unread} לא נקראו` : 'הכל נקרא'}</p></div>
      <div class="segmented"><button class=${cx(filter === 'all' && 'on')} onClick=${() => setFilter('all')}>הכל</button><button class=${cx(filter === 'unread' && 'on')} onClick=${() => setFilter('unread')}>לא נקראו</button></div>
    </header>
    ${shown.length === 0
      ? html`<${Empty} icon="mail" title="אין פניות" />`
      : shown.map((f) => html`<article class=${cx('card', 'message', !f.is_read && 'unread')} key=${f.id}>
          <header class="message-head">
            <div><b>${f.user_name}</b> <span class="muted small" dir="ltr">${[f.user_phone, f.user_email].filter(Boolean).join(' · ')}</span>
              ${!f.can_message && html` <${Badge} tone="warn">חסום מפניות<//>`}</div>
            <span class="muted small">${formatDate(f.created_at)}</span>
          </header>
          <p class="message-body">${f.body}</p>
          <div class="row gap-sm wrap">
            <${Button} small onClick=${() => setRead(f, !f.is_read)}>${f.is_read ? 'סימון כלא נקרא' : 'סימון כנקרא'}<//>
            ${f.can_message && html`<${Button} small kind="ghost" onClick=${() => block(f)}>חסימת המשתמש מפניות<//>`}
            <span class="grow" /><${Button} small kind="ghost" icon="trash" title="מחיקה" onClick=${() => remove(f)} />
          </div>
        </article>`)}
  </div>`;
}

// ------------------------------------------------------------------ write to the developers (everyone)
export function MyFeedback() {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/me/feedback'));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { const item = await api.post('/me/feedback', { body: text }); setData((d) => ({ ...d, items: [item, ...d.items] })); setText(''); toast('הפנייה נשלחה, תודה!'); }
    catch (err) { toastError(err); }
    setBusy(false);
  }

  return html`<div class="page narrow">
    <header class="page-head"><div><h1>פנייה לצוות הפיתוח</h1><p class="muted">רעיון, תקלה או בקשה? כתבו לנו. הפניות מגיעות רק למנהל העל.</p></div></header>
    ${data.blocked
      ? html`<div class="alert alert-info">${data.blocked}</div>`
      : html`<form class="card form" onSubmit=${send}>
          <${Field} label="הפנייה שלך"><${TextArea} value=${text} onInput=${setText} rows="5" maxlength="2000" placeholder="כתבו כאן…" /><//>
          <div class="row end"><${Button} kind="primary" type="submit" loading=${busy} disabled=${!text.trim()}>שליחה<//></div>
        </form>`}
    ${data.items.length > 0 && html`<h3 class="section-title">פניות ששלחת</h3>
      ${data.items.map((f) => html`<div class="card message" key=${f.id}><span class="muted small">${formatDate(f.created_at)}</span><p class="message-body">${f.body}</p></div>`)}`}
  </div>`;
}
