// Messages with the administration, as a chat. Users: one conversation (#/messages).
// The administration: an inbox of conversations with users and with people who wrote by e-mail (#/admin/inbox).
import { api, fileUrl } from '../api.js';
import { VIA, cx, html, navigate, norm, timeAgo, useEffect, useMemo, useRef, useState } from '../lib.js';
import { Avatar, Badge, Button, CheckList, Empty, ErrorBox, Field, FormModal, Icon, Input, Modal, Spinner, SynagogueMultiPicker, Toggle, confirm, toast, toastError, useDebounced, useLoad } from '../ui.js';

const POLL = 20000; // new messages appear while the screen is open

const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'היום';
  if (d.toDateString() === y.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
};
const MAX_FILES = 5;
const MAX_FILE = 10 * 1024 * 1024;
const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const isImage = (f) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(f.type);

/** The files of a message: pictures as previews, other files as a card that opens or downloads. */
function Files({ files }) {
  if (!files?.length) return null;
  return html`<div class="bubble-files">
    ${files.map((f) => isImage(f)
      ? html`<a class="file-pic" href=${fileUrl(f.url)} target="_blank" rel="noopener" key=${f.id} title=${f.name}><img src=${fileUrl(f.url)} alt=${f.name} loading="lazy" /></a>`
      : html`<a class="file-card" href=${fileUrl(f.url)} target="_blank" rel="noopener" key=${f.id}>
          <span class="file-icon"><${Icon} name="file" size=${18} /></span>
          <span class="file-text"><b class="ellipsis">${f.name}</b><small>${size(f.size)}</small></span>
          <${Icon} name="download" size=${16} />
        </a>`)}
  </div>`;
}

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
        <${Files} files=${m.files} />
        ${m.body && html`<div class="bubble-body">${m.body}</div>`}
        <small class="bubble-meta">${clock(m.created_at)}${m.broadcast_id ? ' · הודעה קבוצתית' : ''}${m.via === 'email' ? ' · במייל' : ''}${m.emailed ? ' · נשלח במייל' : ''}
          ${m.emailed && m.sender === 'staff' ? (m.opened_at
            ? html` · <span class="opened" title=${m.open_count > 1 ? `נפתח ${m.open_count} פעמים` : ''}>✓✓ נפתח ${dayLabel(m.opened_at) === 'היום' ? 'היום' : dayLabel(m.opened_at)} ${clock(m.opened_at)}</span>`
            : ' · עוד לא נפתח') : ''}</small>
      </div>`;
    })}
    <div ref=${end} />
  </div>`;
}

function Composer({ onSend, disabled, placeholder = 'כתבו הודעה…', extra, initial = '' }) {
  const [body, setBody] = useState(initial);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const picker = useRef();
  const ready = body.trim() || files.length;
  function add(list) {
    const next = [...files];
    for (const f of list) {
      if (f.size > MAX_FILE) { toast(`הקובץ ${f.name} גדול מדי (עד 10MB)`, 'error'); continue; }
      if (next.length >= MAX_FILES) { toast(`אפשר לצרף עד ${MAX_FILES} קבצים`, 'error'); break; }
      next.push(f);
    }
    setFiles(next);
  }
  async function send(e) {
    e?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try { await onSend(body.trim(), files); setBody(''); setFiles([]); } catch (err) { if (!err.silent) toastError(err); }
    setBusy(false);
  }
  return html`<form class=${cx('composer', busy && 'busy')} onSubmit=${send}
      onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { e.preventDefault(); if (!disabled) add([...e.dataTransfer.files]); }}>
    ${extra}
    ${files.length > 0 && html`<div class="composer-files">
      ${files.map((f, i) => html`<span class="file-chip" key=${i}><${Icon} name=${f.type.startsWith('image/') ? 'eye' : 'file'} size=${14} />
        <span class="ellipsis">${f.name}</span><small>${size(f.size)}</small>
        <button type="button" aria-label="הסרה" onClick=${() => setFiles(files.filter((_, j) => j !== i))}><${Icon} name="close" size=${13} /></button></span>`)}
    </div>`}
    <div class="composer-row">
      <input type="file" multiple hidden ref=${picker} onChange=${(e) => { add([...e.currentTarget.files]); e.currentTarget.value = ''; }} />
      <${Button} kind="ghost" icon="clip" type="button" class="attach" disabled=${disabled || busy} aria-label="צירוף קובץ" title="צירוף קובץ" onClick=${() => picker.current.click()} />
      <textarea class="input" rows="1" placeholder=${placeholder} value=${body} disabled=${disabled}
        onInput=${(e) => { setBody(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`; }}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
        onPaste=${(e) => { const pasted = [...(e.clipboardData?.files || [])]; if (pasted.length) { e.preventDefault(); add(pasted); } }} />
      <${Button} kind="primary" icon="send" type="submit" loading=${busy} disabled=${disabled || !ready} aria-label="שליחה" />
    </div>
  </form>`;
}

/** JSON when there are no files, otherwise a form with the same fields. */
function asForm(fields, files) {
  if (!files.length) return fields;
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  for (const file of files) f.append('files', file, file.name);
  return f;
}

// ------------------------------------------------------------------ the user's side
export function MyMessages({ onRead }) {
  // a ready text from another screen (e.g. asking for a recording): #/messages?draft=...
  const [draft] = useState(() => new URLSearchParams(location.hash.split('?')[1] || '').get('draft') || '');
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/me/messages'));
  useEffect(() => { const t = setInterval(reload, POLL); return () => clearInterval(t); }, [reload]);
  useEffect(() => { if (data) onRead?.(); }, [data?.messages.length]);
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;
  const send = async (body, files) => {
    const m = await api.post('/me/messages', asForm({ body }, files));
    setData((d) => ({ ...d, messages: [...d.messages, m] }));
  };
  return html`<div class="page narrow chat-page">
    <header class="page-head"><div><h1>הודעות להנהלה</h1><p class="muted">שאלה, בקשה או תקלה? כתבו כאן ונחזור אליכם בהקדם. התשובות יופיעו כאן.</p></div></header>
    <div class="card chat-card">
      <${Thread} messages=${data.messages} mine=${(m) => m.sender === 'user'} empty=${html`<${Icon} name="chat" size=${28} /><b>עדיין אין הודעות</b><span>כתבו את ההודעה הראשונה למטה</span>`} />
      ${data.blocked ? html`<div class="alert alert-info">${data.blocked}</div>` : html`<${Composer} onSend=${send} initial=${draft} />`}
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
  const [broadcast, setBroadcast] = useState(false);
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
        <${Button} icon="users" onClick=${() => setBroadcast(true)}>הודעה לכמה גבאים<//>
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
    ${broadcast && html`<${BroadcastModal} onClose=${() => setBroadcast(false)} onSent=${() => list.reload()} />`}
    ${starting && html`<${StartModal} onClose=${() => setStarting(false)} onStarted=${(c) => { list.reload(); open(c.id); }} />`}
  </div>`;
}

function Conversation({ id, onBack, onChange }) {
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/admin/conversations/${id}`), [id]);
  const [byMail, setByMail] = useState(false);
  useEffect(() => { const t = setInterval(reload, POLL); return () => clearInterval(t); }, [reload]);
  // When the person wrote by e-mail, answer by e-mail by default.
  const lastFromThem = data?.messages.filter((m) => m.sender === 'user').at(-1);
  useEffect(() => { if (lastFromThem) setByMail(lastFromThem.via === 'email'); }, [lastFromThem?.id]);
  useEffect(() => { if (data) onChange(); }, [data?.messages.length]);
  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;
  const c = data.conversation;
  const external = !c.user_id;
  const send = async (body, files) => {
    const m = await api.post(`/admin/conversations/${id}/messages`, asForm({ body, send_email: byMail }, files));
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

// ------------------------------------------------------------------ one message to many gabbaim
const TARGETS = [['all', 'כל הגבאים'], ['areas', 'לפי אזור'], ['synagogues', 'לפי בית כנסת'], ['users', 'בחירת משתמשים']];

function BroadcastModal({ onClose, onSent }) {
  const [kind, setKind] = useState('all');
  const [areaIds, setAreaIds] = useState([]);
  const [synagogues, setSynagogues] = useState([]);
  const [userIds, setUserIds] = useState([]);
  const [byMail, setByMail] = useState(true);
  const areas = useLoad(() => api.get('/admin/catalog/areas'));
  const users = useLoad(() => api.get('/admin/users'));
  const recent = useLoad(() => api.get('/admin/broadcasts'));
  const ids = kind === 'areas' ? areaIds : kind === 'synagogues' ? synagogues.map((x) => x.id) : kind === 'users' ? userIds : [];
  const key = useDebounced(`${kind}:${ids.join(',')}`, 250);
  const who = useLoad(() => api.get(`/admin/broadcasts/recipients?kind=${key.split(':')[0]}&ids=${key.split(':')[1]}`), [key]);
  const mailOff = who.data && !who.data.mail_ready;
  useEffect(() => { if (mailOff) setByMail(false); }, [mailOff]);

  async function send(body, files) {
    if (!who.data?.count) throw new Error('בחרו למי לשלוח');
    if (!(await confirm({ title: 'שליחת הודעה קבוצתית', body: `ההודעה תישלח ל-${who.data.count} נמענים${byMail ? ', כל אחד גם במייל' : ''}. כל אחד יראה אותה בשיחה שלו איתך.`, confirmLabel: 'שליחה' }))) throw Object.assign(new Error(''), { silent: true });
    const fields = { body, send_email: byMail, kind, ids: kind === 'all' ? [] : ids };
    const r = await api.post('/admin/broadcasts', files.length ? asForm({ ...fields, ids: JSON.stringify(fields.ids) }, files) : fields);
    toast(`נשלח ל-${r.recipients}${r.emailed ? `, ${r.emailed} גם במייל` : ''}`);
    onSent(); onClose();
  }

  return html`<${Modal} wide title="הודעה לכמה גבאים" onClose=${onClose}>
    <div class="broadcast">
      <div class="segmented full">${TARGETS.map(([k, l]) => html`<button type="button" class=${cx(kind === k && 'on')} onClick=${() => setKind(k)}>${l}</button>`)}</div>
      <div class="broadcast-pick">
        ${kind === 'all' && html`<p class="muted small">כל הגבאים הפעילים במערכת.</p>`}
        ${kind === 'areas' && (areas.data ? html`<${CheckList} options=${areas.data.map((a) => ({ value: a.id, label: a.name }))} value=${areaIds} onChange=${setAreaIds} searchable />` : html`<${Spinner} />`)}
        ${kind === 'synagogues' && html`<${SynagogueMultiPicker} value=${synagogues} onChange=${setSynagogues} />`}
        ${kind === 'users' && (users.data ? html`<${CheckList} searchable value=${userIds} onChange=${setUserIds}
            options=${users.data.filter((u) => u.is_active).map((u) => ({ value: u.id, label: u.name, sub: u.role === 'admin' ? 'מנהל מערכת' : u.synagogues.map((x) => x.name).slice(0, 2).join(', ') }))} />` : html`<${Spinner} />`)}
      </div>
      <div class="broadcast-who">
        <${Icon} name="users" size=${16} />
        ${who.data ? html`<span><b>${who.data.count} נמענים</b>${who.data.count > 0 && html`<span class="muted small"> · ${who.data.names.join(', ')}${who.data.count > who.data.names.length ? '…' : ''}</span>`}</span>` : html`<span class="muted">בודק…</span>`}
      </div>
      <div class="card broadcast-compose">
        <${Composer} onSend=${send} placeholder="כתבו את ההודעה…"
          extra=${html`<${Toggle} checked=${byMail} onChange=${setByMail} disabled=${mailOff}
            label=${mailOff ? 'שליחת מיילים אינה מוגדרת במערכת' : `לשלוח גם במייל${who.data ? ` (${who.data.with_email} עם כתובת מייל)` : ''}`} />`} />
      </div>
      ${recent.data?.length > 0 && html`<div class="broadcast-recent"><h4>נשלחו לאחרונה</h4>
        ${recent.data.slice(0, 6).map((b) => html`<div class="feed-row" key=${b.id}>
          <span class="feed-icon"><${Icon} name="users" size=${15} /></span>
          <div class="grow"><div class="ellipsis">${b.body || '📎 קבצים'}</div>
            <div class="muted small">${b.target} · ${b.recipients} נמענים${b.emailed ? ` · ${b.emailed} במייל, ${b.opened} פתחו` : ''} · ${timeAgo(b.created_at)}</div></div>
        </div>`)}</div>`}
    </div>
  <//>`;
}
