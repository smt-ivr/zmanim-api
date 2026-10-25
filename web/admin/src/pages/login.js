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
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, fields, submit } = useSubmit(async () => onDone(await api.post('/auth/login', { login, password })));

  return html`<${AuthCard} title="כניסה למערכת" subtitle="ניהול זמני המניינים של בית הכנסת">
    <form class="form" onSubmit=${submit}>
      ${error && html`<div class="alert alert-error">${error}</div>`}
      <${Field} label="מייל או טלפון" error=${fields.login}>
        <${Input} dir="ltr" autocomplete="username" inputmode="email" value=${login} onInput=${setLogin} required autofocus />
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
