import { api } from '../api.js';
import { formatDate, html, useState } from '../lib.js';
import { Button, Field, Input, toast } from '../ui.js';
import { ApiError } from '../api.js';

export function Profile({ user, onChanged }) {
  const [info, setInfo] = useState({ name: user.name });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');

  async function run(which, fn) {
    setBusy(which);
    setErrors({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast(err.message, 'error');
    }
    setBusy('');
  }

  const saveInfo = (e) => (e.preventDefault(), run('info', async () => {
    await api.patch('/me', info);
    await onChanged();
    toast('הפרטים נשמרו');
  }));
  const savePw = (e) => (e.preventDefault(), run('pw', async () => {
    await api.put('/me/password', pw);
    setPw({ current_password: '', new_password: '' });
    toast('הסיסמה עודכנה. מכשירים אחרים נותקו');
  }));

  return html`<div class="page narrow">
    <header class="page-head"><div><h1>הפרופיל שלי</h1><p class="muted">${user.email || user.phone} · כניסה אחרונה ${formatDate(user.last_login_at)}</p></div></header>
    <form class="card form" onSubmit=${saveInfo}>
      <h3>פרטים אישיים</h3>
      <div class="grid-2">
        <${Field} label="שם" error=${errors.name}><${Input} value=${info.name} onInput=${(v) => setInfo({ ...info, name: v })} /><//>
        <${Field} label="טלפון לשלוחה" hint="נקבע על ידי מנהל המערכת"><${Input} dir="ltr" value=${user.phone || '—'} disabled /><//>
      </div>
      <div class="row end"><${Button} kind="primary" type="submit" loading=${busy === 'info'}>שמירה<//></div>
    </form>
    ${user.has_password && html`<form class="card form" onSubmit=${savePw}>
      <h3>החלפת סיסמה</h3>
      <div class="grid-2">
        <${Field} label="סיסמה נוכחית" error=${errors.current_password}>
          <${Input} type="password" dir="ltr" autocomplete="current-password" value=${pw.current_password} onInput=${(v) => setPw({ ...pw, current_password: v })} /><//>
        <${Field} label="סיסמה חדשה" hint="4 תווים לפחות" error=${errors.new_password}>
          <${Input} type="password" dir="ltr" autocomplete="new-password" value=${pw.new_password} onInput=${(v) => setPw({ ...pw, new_password: v })} /><//>
      </div>
      <div class="row end"><${Button} kind="primary" type="submit" loading=${busy === 'pw'}>עדכון סיסמה<//></div>
    </form>`}
  </div>`;
}
