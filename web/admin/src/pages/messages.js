// Messages with the administration, as a chat. Users: one conversation (#/messages).
// The administration: an inbox of conversations with users and with people who wrote by e-mail (#/admin/inbox).
import { api } from '../api.js';
import { VIA, cx, html, navigate, norm, timeAgo, useEffect, useMemo, useRef, useState } from '../lib.js';
import { Avatar, Badge, Button, Empty, ErrorBox, Field, FormModal, Icon, Input, Modal, Spinner, Toggle, confirm, toast, toastError, useLoad } from '../ui.js';

const POLL = 20000; // new messages appear while the screen is open

const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'היום';
  if (d.toDateString() === y.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
};
const clock = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/** Bubbles grouped by day. `mine(m)`: whether the message is on "my" side. */
function Thread({ messages, mine, empty }) {
  const end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  if (!messages.length) return html`<div class="chat-empty">${empty}</div>`;
  let lastDay = '';
  return html`<div class="chat-thread">
    ${messages.map((m) => {
      const day = dayLabel(m.created_at);
      const sep = day !== lastDay ? ((lastDay = day), html`<div class="chat-day"><span>${day}</span></div>`) : null;
      return html`${sep}<div class=${cx('bubble', mine(m) ? 'mine' : 'theirs')} key=${m.id}>
        ${m.staff_name && !mine(m) ? html`<small class="bubble-who">${m.staff_name}</small>` : ''}
        <div class="bubble-body">${m.body}</div>
        <small class="bubble-meta">${clock(m.created_at)}${m.via === 'email' ? ' · במייל' : ''}${m.emailed ? ' · נשלח גם במייל' : ''}</small>
      </div>`;
    })}
    <div ref=${end} />
  </div>`;
}

function Composer({ onSend, disabled, placeholder = 'כתבו הודעה…', extra }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(e) {
    e?.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try { await onSend(body.trim()); setBody(''); } catch (err) { toastError(err); }
    setBusy(false);
  }
  return html`<form class="composer" onSubmit=${send}>
    ${extra}
    <div class="composer-row">
      <textarea class="input" rows="1" placeholder=${placeholder} value=${body} disabled=${disabled}
        onInput=${(e) => { setBody(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`; }}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
      <${Button} kind="primary" icon="send" type="submit" loading=${busy} disabled=${disabled || !body.trim()} aria-label="שליחה" />
    </div>
  </form>`;
}

// ------------------------------------------------------------------ the user's side
export function MyMessages({ onRead }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/me/messages'));
  useEffect(() => { const t = setInterval(reload, POLL); return () => clearInterval(t); }, [reload]);
  useEffect(() => { if (data) onRead?.(); }, [data?.messages.length]);
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;
  const send = async (body) => {
    const m = await api.post('/me/messages', { body });
    setData((d) => ({ ...d, messages: [...d.messages, m] }));
  };
  return html`<div class="page narrow chat-page">
    <header class="page-head"><div><h1>הודעות להנהלה</h1><p class="muted">שאלה, בקשה או תקלה? כתבו כאן ונחזור אליכם בהקדם. התשובות יופיעו כאן.</p></div></header>
    <div class="card chat-card">
      <${Thread} messages=${data.messages} mine=${(m) => m.sender === 'user'} empty=${html`<${Icon} name="chat" size=${28} /><b>עדיין אין הודעות</b><span>כתבו את ההודעה הראשונה למטה</span>`} />
      ${data.blocked ? html`<div class="alert alert-info">${data.blocked}</div>` : html`<${Composer} onSend=${send} />`}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ the administration
export function Inbox({ onRead }) {
  const list = useLoad(() => api.get('/admin/conversations'));
  const [openId, setOpenId] = useState(() => Number(new URLSearchParams(location.hash.split('?')[1] || '').get('c')) || null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [starting, setStarting] = useState(false);
  const [mailLog, setMailLog] = useState(false);
  useEffect(() => { const t = setInterval(list.reload, POLL); return () => clearInterval(t); }, [list.reload]);

  const shown = useMemo(() => (list.data || []).filter((c) =>
    (filter === 'all' || (filter === 'unread' ? c.staff_unread > 0 : filter === 'email' ? !c.user_id : c.status === 'open')) &&
    (!q || norm(`${c.name} ${c.email || ''} ${c.user_phone || ''} ${c.last_body || ''}`).includes(norm(q)))), [list.data, q, filter]);
  if (list.loading && !list.data) return html`<div class="page"><${Spinner} /></div>`;
  if (list.error && !list.data) return html`<div class="page"><${ErrorBox} error=${list.error} onRetry=${list.reload} /></div>`;
  const unread = list.data.filter((c) => c.staff_unread > 0).length;
  const open = (id) => { setOpenId(id); history.replaceState(null, '', `#/admin/inbox?c=${id}`); };

  return html`<div class="page wide">
    <header class="page-head"><div><h1>הודעות</h1>
      <p class="muted">${unread ? `${unread} שיחות עם הודעות שלא נקראו` : 'אין הודעות שלא נקראו'}. כשאינך מחובר, הודעה חדשה נשלחת אליך במייל.</p></div>
      <div class="row gap-sm"><${Button} kind="ghost" icon="mail" onClick=${() => setMailLog(true)}>מיילים שהתקבלו<//>
        <${Button} icon="plus" onClick=${() => setStarting(true)}>שיחה חדשה<//></div></header>
    <div class=${cx('inbox', openId && 'has-open')}>
      <aside class="inbox-list card">
        <div class="inbox-tools">
          <div class="search wide"><${Icon} name="search" /><input class="input" placeholder="חיפוש…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
          <div class="segmented full small-seg">
            ${[['all', 'הכל'], ['unread', 'לא נקראו'], ['email', 'מהמייל']].map(([k, l]) => html`<button class=${cx(filter === k && 'on')} onClick=${() => setFilter(k)}>${l}</button>`)}
          </div>
        </div>
        <div class="inbox-items">
          ${shown.length === 0 && html`<div class="muted center pad">אין שיחות</div>`}
          ${shown.map((c) => html`<button key=${c.id} class=${cx('conv', openId === c.id && 'active', c.staff_unread > 0 && 'unread')} onClick=${() => open(c.id)}>
            <${Avatar} name=${c.name || c.email} size=${38} />
            <span class="conv-main">
              <span class="row gap-sm"><b class="grow ellipsis">${c.name || c.email}</b><small class="muted">${timeAgo(c.last_message_at)}</small></span>
              <span class="row gap-sm"><small class="muted ellipsis grow">${c.last_sender === 'staff' ? 'את/ה: ' : ''}${c.last_body}</small>
                ${!c.user_id && html`<${Badge}>מייל<//>`}${c.staff_unread > 0 && html`<b class="nav-count">${c.staff_unread}</b>`}</span>
            </span>
          </button>`)}
        </div>
      </aside>
      <section class="inbox-pane card">
        ${openId ? html`<${Conversation} key=${openId} id=${openId} onBack=${() => { setOpenId(null); history.replaceState(null, '', '#/admin/inbox'); }}
            onChange=${() => { list.reload(); onRead?.(); }} />`
          : html`<div class="chat-empty"><${Icon} name="chat" size=${32} /><b>בחרו שיחה</b><span>או התחילו שיחה חדשה עם משתמש או כתובת מייל</span></div>`}
      </section>
    </div>
    ${mailLog && html`<${Modal} title="מיילים שהתקבלו בכתובת המערכת" onClose=${() => setMailLog(false)}><${MailLog} /><//>`}
    ${starting && html`<${StartModal} onClose=${() => setStarting(false)} onStarted=${(c) => { list.reload(); open(c.id); }} />`}
  </div>`;
}

function Conversation({ id, onBack, onChange }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/admin/conversations/${id}`), [id]);
  const [byMail, setByMail] = useState(false);
  useEffect(() => { const t = setInterval(reload, POLL); return () => clearInterval(t); }, [reload]);
  useEffect(() => { if (data) onChange(); }, [data?.messages.length]);
  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const c = data.conversation;
  const external = !c.user_id;
  const send = async (body) => {
    const m = await api.post(`/admin/conversations/${id}/messages`, { body, send_email: byMail });
    setData((d) => ({ ...d, messages: [...d.messages, m] }));
    if (m.emailed) toast('נשלח גם במייל');
  };
  async function blockUser() {
    try { await api.patch(`/admin/users/${c.user_id}`, { can_message: !c.can_message }); toast(c.can_message ? 'המשתמש לא יוכל לשלוח הודעות' : 'המשתמש יכול שוב לשלוח הודעות'); reload(); }
    catch (e) { toastError(e); }
  }
  async function remove() {
    if (!(await confirm({ title: 'מחיקת שיחה', body: 'כל ההודעות בשיחה יימחקו.', confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/conversations/${id}`); toast('השיחה נמחקה'); onBack(); onChange(); } catch (e) { toastError(e); }
  }
  return html`<div class="conv-view">
    <header class="conv-head">
      <${Button} kind="ghost" icon="chevron" class="only-mobile flip" aria-label="חזרה" onClick=${onBack} />
      <${Avatar} name=${c.name || c.email} size=${36} />
      <div class="grow"><b>${c.name || c.email}</b>
        <div class="muted small" dir="ltr">${[c.email, c.user_phone].filter(Boolean).join(' · ')}</div></div>
      ${external ? html`<${Badge}>פנייה במייל<//>` : c.can_message === false && html`<${Badge} tone="warn">חסום מהודעות<//>`}
      ${!external && html`<${Button} kind="ghost" small onClick=${blockUser}>${c.can_message ? 'חסימה' : 'ביטול חסימה'}<//>`}
      <${Button} kind="ghost" small icon="trash" title="מחיקת השיחה" onClick=${remove} />
    </header>
    ${c.subject && html`<div class="conv-subject">נושא: ${c.subject}</div>`}
    <${Thread} messages=${data.messages} mine=${(m) => m.sender === 'staff'} empty=${html`<span>אין הודעות בשיחה</span>`} />
    <${Composer} onSend=${send} placeholder=${external ? 'תשובה במייל…' : 'תשובה…'}
      extra=${external ? html`<div class="composer-note">התשובה תישלח במייל אל ${c.email}</div>`
        : c.email && html`<div class="composer-note"><${Toggle} checked=${byMail} onChange=${setByMail} label=${`לשלוח גם במייל (${c.email})`} /></div>`} />
  </div>`;
}

function StartModal({ onClose, onStarted }) {
  const users = useLoad(() => api.get('/admin/users'));
  const [mode, setMode] = useState('user');
  const [q, setQ] = useState('');
  const pick = async (body) => { try { const c = await api.post('/admin/conversations', body); onClose(); onStarted(c); } catch (e) { toastError(e); } };
  const shown = (users.data || []).filter((u) => !u.is_super && (!q || norm(`${u.name} ${u.email} ${u.phone}`).includes(norm(q)))).slice(0, 30);
  return html`<${FormModal} title="שיחה חדשה" initial=${{ email: '', name: '' }} submitLabel="פתיחת שיחה" onClose=${onClose}
      save=${(v) => api.post('/admin/conversations', { email: v.email, name: v.name })} onSaved=${(c) => onStarted(c)}>
    ${({ values: v, set, errors }) => html`
      <div class="segmented full"><button type="button" class=${cx(mode === 'user' && 'on')} onClick=${() => setMode('user')}>משתמש במערכת</button>
        <button type="button" class=${cx(mode === 'email' && 'on')} onClick=${() => setMode('email')}>כתובת מייל</button></div>
      ${mode === 'user'
        ? html`<div class="search wide"><${Icon} name="search" /><input class="input" placeholder="חיפוש משתמש…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} autofocus /></div>
            <div class="syn-results">${users.loading ? html`<${Spinner} />` : shown.map((u) => html`<button type="button" class="syn-item" onClick=${() => pick({ user_id: u.id })}>
              <${Avatar} name=${u.name} size=${28} /><span class="grow"><b>${u.name}</b><small dir="ltr">${u.email}</small></span></button>`)}</div>`
        : html`<${Field} label="מייל" error=${errors.email}><${Input} type="email" dir="ltr" value=${v.email} onInput=${set('email')} /><//>
            <${Field} label="שם (לא חובה)"><${Input} value=${v.name} onInput=${set('name')} /><//>
            <p class="muted small">ההודעות לכתובת הזו יישלחו במייל, והתשובות שלה יחזרו לשיחה (כשקבלת מיילים מוגדרת).</p>`}`}
  <//>`;
}

/** Every e-mail that reached the inbound address, and what happened to it. */
function MailLog() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/email-log'));
  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  if (!data.length) {
    return html`<${Empty} icon="mail" title="עדיין לא הגיע אף מייל">
      אם שלחתם מייל לכתובת ולא מופיע כאן כלום, המייל לא הגיע לשרת. בדקו ב-Cloudflare ← Email Routing ← Activity log מה קרה איתו.<//>`;
  }
  const tone = { accepted: 'success', ignored: 'neutral', error: 'warn' };
  const label = { accepted: 'התקבל', ignored: 'סונן', error: 'שגיאה' };
  return html`<div class="feed">${data.map((l) => html`<div class="feed-row" key=${l.id}>
    <div class="grow"><div class="row gap-sm wrap"><b dir="ltr">${l.sender}</b><${Badge} tone=${tone[l.status]}>${label[l.status]}<//></div>
      <div class="small">${l.subject || html`<span class="muted">ללא נושא</span>`}</div>
      <div class="muted small">${l.detail} · ${timeAgo(l.created_at)}</div></div>
  </div>`)}</div>`;
}
