import { ApiError, api } from '../api.js';
import { html, useState } from '../lib.js';
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

export function Login({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, fields, submit } = useSubmit(async () => onDone(await api.post('/auth/login', { email, password })));

  return html`<${AuthCard} title="כניסה למערכת" subtitle="ניהול זמני המניינים של בית הכנסת">
    <form class="form" onSubmit=${submit}>
      ${error && html`<div class="alert alert-error">${error}</div>`}
      <${Field} label="מייל" error=${fields.email}>
        <${Input} type="email" dir="ltr" autocomplete="username" value=${email} onInput=${setEmail} required autofocus />
      <//>
      <${Field} label="סיסמה" error=${fields.password}>
        <div class="input-group">
          <${Input} type=${show ? 'text' : 'password'} dir="ltr" autocomplete="current-password" value=${password} onInput=${setPassword} required />
          <${Button} kind="ghost" icon=${show ? 'eyeOff' : 'eye'} aria-label="הצגת סיסמה" onClick=${() => setShow(!show)} />
        </div>
      <//>
      <${Button} kind="primary" class="btn-block" loading=${busy} type="submit">כניסה<//>
    </form>
  <//>`;
}

export function Setup({ enabled, onDone }) {
  const [v, setV] = useState({ setup_key: '', name: '', email: '', password: '' });
  const set = (k) => (x) => setV((s) => ({ ...s, [k]: x }));
  const { busy, error, fields, submit } = useSubmit(async () => onDone(await api.post('/setup', v)));

  if (!enabled) {
    return html`<${AuthCard} title="התקנה ראשונית" subtitle="עדיין אין משתמשים במערכת">
      <div class="alert alert-info">
        כדי ליצור את המנהל הראשון, הגדירו ב-Worker סוד בשם <code>SETUP_KEY</code> (Settings ← Variables and Secrets) ורעננו את הדף.
      </div>
    <//>`;
  }
  return html`<${AuthCard} title="התקנה ראשונית" subtitle="יצירת חשבון מנהל המערכת הראשון">
    <form class="form" onSubmit=${submit}>
      ${error && html`<div class="alert alert-error">${error}</div>`}
      <${Field} label="מפתח התקנה (SETUP_KEY)" error=${fields.setup_key}><${Input} dir="ltr" value=${v.setup_key} onInput=${set('setup_key')} required /><//>
      <${Field} label="שם מלא" error=${fields.name}><${Input} value=${v.name} onInput=${set('name')} required /><//>
      <${Field} label="מייל" error=${fields.email}><${Input} type="email" dir="ltr" value=${v.email} onInput=${set('email')} required /><//>
      <${Field} label="סיסמה" hint="8 תווים לפחות" error=${fields.password}><${Input} type="password" dir="ltr" autocomplete="new-password" value=${v.password} onInput=${set('password')} required /><//>
      <${Button} kind="primary" class="btn-block" loading=${busy} type="submit">יצירת מנהל וכניסה<//>
    </form>
  <//>`;
}
