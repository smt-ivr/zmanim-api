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

// After an explicit logout Google must not sign the user straight back in (One Tap auto-select).
const NO_AUTO = 'zmanim.google.noAuto';
export function googleLoggedOut() {
  try { localStorage.setItem(NO_AUTO, '1'); } catch { /* ignore */ }
  window.google?.accounts?.id?.disableAutoSelect();
}

const G_LOGO = html`<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

/**
 * "Sign in with Google": a placeholder of the same size shows at once, Google's button fades in over it
 * when ready (no jumping). Also shows Google's One Tap card, which signs a returning user in by itself.
 */
function GoogleButton({ clientId, onDone, onError }) {
  const box = useRef();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let noAuto = false;
    try { noAuto = localStorage.getItem(NO_AUTO) === '1'; } catch { /* ignore */ }
    loadGsi().then(() => {
      if (!alive || !box.current) return;
      const gid = window.google.accounts.id;
      gid.initialize({
        client_id: clientId,
        auto_select: !noAuto, // returning users are signed in without a click
        cancel_on_tap_outside: false,
        itp_support: true,
        use_fedcm_for_prompt: true,
        context: 'signin',
        callback: async ({ credential }) => {
          setBusy(true);
          try {
            const session = await api.post('/auth/google', { credential });
            try { localStorage.removeItem(NO_AUTO); } catch { /* ignore */ }
            onDone(session);
          } catch (e) { setBusy(false); onError(e.message); }
        },
      });
      if (noAuto) gid.disableAutoSelect();
      const slot = box.current.querySelector('.gsi-slot');
      gid.renderButton(slot, {
        theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'center', locale: 'he',
        width: Math.min(Math.max(box.current.offsetWidth, 200), 400),
      });
      // Show Google's button only once its frame has loaded
      const waitFrame = () => {
        const frame = slot.querySelector('iframe');
        if (!frame) return alive && setTimeout(waitFrame, 50);
        frame.addEventListener('load', () => alive && setTimeout(() => setReady(true), 120), { once: true });
      };
      waitFrame();
      setTimeout(() => alive && setReady(true), 4000); // never leave the placeholder forever
      gid.prompt(); // One Tap
    }).catch((e) => onError(e.message));
    return () => { alive = false; window.google?.accounts?.id?.cancel(); };
  }, [clientId]);

  return html`<div class=${`google-box${ready ? ' ready' : ''}${busy ? ' busy' : ''}`} ref=${box}>
    <div class="google-placeholder" aria-hidden=${ready}>${G_LOGO}<span>${busy ? 'מתחברים…' : 'המשך עם Google'}</span></div>
    <div class="gsi-slot" />
  </div>`;
}

export function Login({ onDone }) {
  const [mode, setMode] = useState('password'); // password | link | reset
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [sent, setSent] = useState(false);
  // Last known options first (no layout jump when the answer arrives), then the server's.
  const [options, setOptions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zmanim.authOptions')) || {}; } catch { return {}; }
  });
  const [googleError, setGoogleError] = useState(null);
  useEffect(() => {
    api.get('/auth/options').then((o) => {
      setOptions(o);
      try { localStorage.setItem('zmanim.authOptions', JSON.stringify(o)); } catch { /* ignore */ }
    }).catch(() => {});
  }, []);

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
