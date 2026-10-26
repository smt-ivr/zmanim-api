import { ApiError, api } from '../api.js';
import { html, useEffect, useRef, useState } from '../lib.js';
import { Button, Field, Icon, Input } from '../ui.js';

function AuthCard({ title, subtitle, children }) {
  return html`<div class="auth">
    <div class="auth-card">
      <div class="auth-brand"><span class="brand-mark lg"><${Icon} name="clock" size=${26} /></span></div>
      <h1>${title}</h1>
      <p class="muted">${subtitle}</p>
      ${children}
    </div>
  </div>`;
}

function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      else setError(err.message);
      setBusy(false);
    }
  };
  return { busy, error, fields, submit };
}

/** Loads Google's sign-in script once. */
let gsiLoading;
function loadGsi() {
  gsiLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gsiLoading = null; reject(new Error('לא ניתן לטעון את הכניסה עם Google')); };
    document.head.appendChild(s);
  });
  return gsiLoading;
}

/** Google's own "Sign in with Google" button; the account's e-mail must belong to a user here. */
function GoogleButton({ clientId, onDone, onError }) {
  const ref = useRef();
  useEffect(() => {
    let alive = true;
    loadGsi().then(() => {
      if (!alive || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try { onDone(await api.post('/auth/google', { credential })); } catch (e) { onError(e.message); }
        },
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'he', width: Math.min(ref.current.offsetWidth || 320, 400),
      });
    }).catch((e) => onError(e.message));
    return () => { alive = false; };
  }, [clientId]);
  return html`<div class="google-btn" ref=${ref} />`;
}

export function Login({ onDone }) {
  const [mode, setMode] = useState('password'); // password | link | reset
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [sent, setSent] = useState(false);
  const [options, setOptions] = useState({ magic_link: false, password_reset: false, google_client_id: null });
  const [googleError, setGoogleError] = useState(null);
  useEffect(() => { api.get('/auth/options').then(setOptions).catch(() => {}); }, []);

  const { busy, error, fields, submit } = useSubmit(async () => {
    if (mode === 'password') return onDone(await api.post('/auth/login', { login, password }));
    await api.post(mode === 'link' ? '/auth/email-link' : '/auth/reset-request', { login });
    setSent(true);
  });
  const switchTo = (m) => { setMode(m); setSent(false); };

  if (sent) {
    return html`<${AuthCard} title="בדקו את המייל" subtitle="אם הפרטים רשומים במערכת, נשלח אליכם מייל עם קישור">
      <p class="muted small">הקישור תקף ${mode === 'link' ? 'ל-30 דקות' : 'לשעה'} ולשימוש אחד. לא הגיע? בדקו בתיקיית הספאם.</p>
      <${Button} class="btn-block" onClick=${() => switchTo('password')}>חזרה לכניסה<//>
    <//>`;
  }

  const titles = { password: ['כניסה למערכת', 'ניהול זמני המניינים של בית הכנסת'], link: ['כניסה בקישור למייל', 'נשלח לכם קישור כניסה, בלי סיסמה'], reset: ['איפוס סיסמה', 'נשלח לכם קישור לבחירת סיסמה חדשה'] };
  return html`<${AuthCard} title=${titles[mode][0]} subtitle=${titles[mode][1]}>
    <form class="form" onSubmit=${submit}>
      ${(error || googleError) && html`<div class="alert alert-error">${error || googleError}</div>`}
      ${mode === 'password' && options.google_client_id && html`
        <${GoogleButton} clientId=${options.google_client_id} onDone=${onDone} onError=${setGoogleError} />
        <div class="or"><span>או</span></div>`}
      <${Field} label="מייל או טלפון" error=${fields.login}>
        <${Input} dir="ltr" autocomplete="username" inputmode="email" value=${login} onInput=${setLogin} required autofocus />
      <//>
      ${mode === 'password' && html`<${Field} label="סיסמה" error=${fields.password}>
        <div class="input-group">
          <${Input} type=${show ? 'text' : 'password'} dir="ltr" autocomplete="current-password" value=${password} onInput=${setPassword} required />
          <${Button} kind="ghost" icon=${show ? 'eyeOff' : 'eye'} aria-label="הצגת סיסמה" onClick=${() => setShow(!show)} />
        </div>
      <//>`}
      <${Button} kind="primary" class="btn-block" loading=${busy} type="submit">${mode === 'password' ? 'כניסה' : 'שליחת קישור'}<//>
      <div class="auth-links">
        ${mode !== 'password' && html`<button type="button" class="link" onClick=${() => switchTo('password')}>כניסה עם סיסמה</button>`}
        ${mode !== 'link' && options.magic_link && html`<button type="button" class="link" onClick=${() => switchTo('link')}>כניסה עם קישור למייל</button>`}
        ${mode !== 'reset' && options.password_reset && html`<button type="button" class="link" onClick=${() => switchTo('reset')}>שכחתי סיסמה</button>`}
      </div>
    </form>
  <//>`;
}

/** #/link?t=... : one-time login link from an e-mail. */
export function LinkLogin({ token, onDone }) {
  const [error, setError] = useState(null);
  useEffect(() => {
    api.post('/auth/email-link/verify', { token }).then(onDone).catch((e) => setError(e.message));
  }, [token]);
  return html`<${AuthCard} title="כניסה בקישור" subtitle=${error ? '' : 'מתחברים…'}>
    ${error ? html`<div class="alert alert-error">${error}</div><a class="btn btn-secondary btn-block" href="#/">למסך הכניסה</a>` : html`<div class="loading"><span class="spinner" /></div>`}
  <//>`;
}

/** #/reset?t=... : choose a new password. */
export function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState('');
  const { busy, error, fields, submit } = useSubmit(async () => onDone(await api.post('/auth/reset', { token, new_password: password })));
  return html`<${AuthCard} title="בחירת סיסמה חדשה" subtitle="אחרי השמירה תיכנסו למערכת">
    <form class="form" onSubmit=${submit}>
      ${error && html`<div class="alert alert-error">${error}</div>`}
      <${Field} label="סיסמה חדשה" hint="4 תווים לפחות" error=${fields.new_password}>
        <${Input} type="password" dir="ltr" autocomplete="new-password" value=${password} onInput=${setPassword} required autofocus /><//>
      <${Button} kind="primary" class="btn-block" loading=${busy} type="submit">שמירה וכניסה<//>
      <a class="link center" href="#/">ביטול</a>
    </form>
  <//>`;
}
