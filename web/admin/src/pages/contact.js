// #/contact: anyone can write to the administration. First they prove their e-mail address (Google, or a
// 6-digit code sent to it), then they chat like a user: the answers appear here and arrive by e-mail.
import { API_ROOT, ApiError } from '../api.js';
import { html, useEffect, useState } from '../lib.js';
import { Button, Field, Icon, Input, Spinner, toastError } from '../ui.js';
import { AuthCard, GoogleButton, useSubmit } from './login.js';
import { Composer, Thread, asForm } from './messages.js';

const KEY = 'zmanim.guest';
const saved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const save = (g) => { try { g ? localStorage.setItem(KEY, JSON.stringify(g)) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

/** The public chat API, with the guest token (not a user's session). */
async function call(method, path, body, token) {
  const form = body instanceof FormData;
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) };
  let res;
  try { res = await fetch(`${API_ROOT}/api/public/chat${path}`, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) }); }
  catch { throw new ApiError(0, { message: 'אין חיבור לשרת. בדקו את החיבור לאינטרנט' }); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error);
  return data;
}

export function ContactPage() {
  const [options, setOptions] = useState(null);
  const [guest, setGuest] = useState(saved);
  useEffect(() => { call('GET', '/options').then(setOptions).catch(() => setOptions({ enabled: false })); }, []);
  const signedIn = (g) => { save(g); setGuest(g); };

  if (!options) return html`<${AuthCard} title="פנייה להנהלה" subtitle="טוען…"><div class="loading"><span class="spinner" /></div><//>`;
  if (!options.enabled) {
    return html`<${AuthCard} title="פנייה להנהלה" subtitle="שליחת הודעות דרך האתר סגורה כרגע">
      <a class="btn btn-secondary btn-block" href="../">לאתר</a><//>`;
  }
  if (!guest) return html`<${Verify} options=${options} onDone=${signedIn} />`;
  return html`<${GuestChat} guest=${guest} options=${options} onExpired=${() => signedIn(null)} />`;
}

/** Prove the e-mail: Google, or a code sent to it. */
function Verify({ options, onDone }) {
  const [step, setStep] = useState('email'); // email | code
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [googleError, setGoogleError] = useState(null);
  const send = useSubmit(async () => { await call('POST', '/code', { email }); setStep('code'); });
  const check = useSubmit(async () => onDone(await call('POST', '/verify', { email, code, name })));

  if (step === 'code') {
    return html`<${AuthCard} title="הקלידו את הקוד" subtitle=${html`שלחנו קוד בן 6 ספרות אל <b dir="ltr">${email}</b>`}>
      <form class="form" onSubmit=${check.submit}>
        ${check.error && html`<div class="alert alert-error">${check.error}</div>`}
        <${Field} label="קוד האימות" error=${check.fields.code}>
          <${Input} class="code-input" dir="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value=${code} onInput=${(v) => setCode(v.replace(/\D/g, ''))} required autofocus /><//>
        <${Button} kind="primary" class="btn-block" loading=${check.busy} type="submit" disabled=${code.length !== 6}>אימות והמשך<//>
        <div class="auth-links">
          <button type="button" class="link" onClick=${() => { setCode(''); setStep('email'); }}>שינוי המייל</button>
          <button type="button" class="link" onClick=${() => call('POST', '/code', { email }).catch(toastError)}>שליחת קוד חדש</button>
        </div>
      </form>
    <//>`;
  }
  return html`<${AuthCard} title="פנייה להנהלה" subtitle="שאלה, בקשה או תיקון בזמנים? כתבו לנו. קודם מאמתים את המייל, כדי שנוכל לענות">
    <div class="form">
      ${googleError && html`<div class="alert alert-error">${googleError}</div>`}
      ${options.google_client_id && html`
        <${GoogleButton} clientId=${options.google_client_id} endpoint="/public/chat/google" oneTap=${false} onDone=${onDone} onError=${setGoogleError} />
        ${options.code && html`<div class="or"><span>או קוד למייל</span></div>`}`}
      ${options.code && html`<form class="form-inner" onSubmit=${send.submit}>
        ${send.error && html`<div class="alert alert-error">${send.error}</div>`}
        <${Field} label="שם (לא חובה)"><${Input} value=${name} onInput=${setName} maxlength="80" autocomplete="name" /><//>
        <${Field} label="המייל שלכם" error=${send.fields.email}><${Input} type="email" dir="ltr" value=${email} onInput=${setEmail} required autocomplete="email" /><//>
        <${Button} kind="primary" class="btn-block" loading=${send.busy} type="submit">שליחת קוד אימות<//>
      </form>`}
      <a class="link center" href="../">חזרה לאתר</a>
    </div>
  <//>`;
}

/** The conversation, like a user's chat. */
function GuestChat({ guest, options, onExpired }) {
  const [data, setData] = useState(null);
  const load = () => call('GET', '', undefined, guest.token).then(setData).catch((e) => (e.status === 403 ? onExpired() : toastError(e)));
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [guest.token]);
  const send = async (body, files) => {
    const m = await call('POST', '/messages', asForm({ body }, files), guest.token);
    setData((d) => ({ ...d, messages: [...d.messages, m] }));
  };
  return html`<div class="contact-page">
    <header class="contact-head">
      <a class="brand" href="../"><span class="brand-mark"><${Icon} name="clock" /></span><b>${options.system_name}</b></a>
      <span class="muted small" dir="ltr">${guest.email}</span>
      <button class="link small" onClick=${onExpired}>יציאה</button>
    </header>
    <div class="page narrow chat-page">
      <header class="page-head"><div><h1>פנייה להנהלה</h1><p class="muted">כתבו כאן. התשובה תופיע בדף הזה ותישלח גם למייל שלכם.</p></div></header>
      <div class="card chat-card">
        ${!data ? html`<${Spinner} />` : html`<${Thread} messages=${data.messages} mine=${(m) => m.sender === 'user'}
          empty=${html`<${Icon} name="chat" size=${28} /><b>עדיין אין הודעות</b><span>כתבו את ההודעה הראשונה למטה</span>`} />`}
        <${Composer} onSend=${send} />
      </div>
    </div>
  </div>`;
}
