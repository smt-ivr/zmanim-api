// My account: name and phone are set by the admin; e-mail and password are mine (unless the admin locked them).
import { ApiError, api } from '../api.js';
import { formatDate, html, useState } from '../lib.js';
import { Badge, Button, Field, Icon, Input, Spinner, Toggle, toast, useLoad } from '../ui.js';

function useSave() {
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');
  async function run(which, fn) {
    setBusy(which);
    setErrors({});
    try { await fn(); return true; } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast(err.message, 'error');
      return false;
    } finally { setBusy(''); }
  }
  return { errors, busy, run };
}

export function Profile({ user, onChanged }) {
  const { errors, busy, run } = useSave();
  const [email, setEmail] = useState(user.email || '');
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [phonePw, setPhonePw] = useState('');
  const locked = html`<span class="muted small">לשינוי פנו להנהלה</span>`;

  const saveEmail = (e) => (e.preventDefault(), run('email', async () => { await api.patch('/me', { email }); await onChanged(); toast('המייל עודכן'); }));
  const savePw = (e) => (e.preventDefault(), run('pw', async () => {
    await api.put('/me/password', pw);
    setPw({ current_password: '', new_password: '' });
    toast('הסיסמה עודכנה. מכשירים אחרים נותקו');
  }));
  const setPhoneRequired = (enabled) => run('phone', async () => {
    await api.put('/me/phone-password', { enabled, password: phonePw });
    setPhonePw('');
    await onChanged();
    toast(enabled ? 'מעכשיו תידרש הסיסמה גם בשיחות לשלוחה' : 'דרישת הסיסמה בטלפון בוטלה');
  });
  const setHidden = (is_hidden) => run('hidden', async () => { await api.patch('/me', { is_hidden }); await onChanged(); toast(is_hidden ? 'אתה מוסתר משאר המנהלים' : 'אתה גלוי לשאר המנהלים'); });

  return html`<div class="page narrow">
    <header class="page-head"><div><h1>הפרופיל שלי</h1>
      <p class="muted">${user.role === 'admin' ? 'מנהל מערכת' : 'מנהל בית כנסת'} · כניסה אחרונה ${formatDate(user.last_login_at)}</p></div></header>

    <section class="card form">
      <h3>פרטים אישיים</h3>
      <div class="grid-2">
        <${Field} label="שם"><div class="readonly-value">${user.name}</div><//>
        <${Field} label="טלפון (כניסה ושלוחת ניהול)"><div class="readonly-value" dir="ltr">${user.phone || '—'}</div><//>
      </div>
      <p class="muted small">את השם והטלפון מעדכנת ההנהלה.</p>
    </section>

    <form class="card form" onSubmit=${saveEmail}>
      <h3>מייל</h3>
      ${user.can_edit_email
        ? html`<${Field} label="כתובת מייל (אפשר להיכנס איתה במקום הטלפון)" error=${errors.email}><${Input} type="email" dir="ltr" value=${email} onInput=${setEmail} /><//>
            <div class="row end"><${Button} kind="primary" type="submit" loading=${busy === 'email'} disabled=${email === user.email}>שמירה<//></div>`
        : html`<div class="readonly-value" dir="ltr">${user.email || '—'}</div>${locked}`}
    </form>

    <form class="card form" onSubmit=${savePw}>
      <h3>סיסמה</h3>
      ${user.can_edit_password
        ? html`<div class="grid-2">
            <${Field} label="סיסמה נוכחית" error=${errors.current_password}>
              <${Input} type="password" dir="ltr" autocomplete="current-password" value=${pw.current_password} onInput=${(v) => setPw({ ...pw, current_password: v })} /><//>
            <${Field} label="סיסמה חדשה" hint=${user.phone_requires_password ? 'ספרות בלבד, כי היא נדרשת גם בטלפון' : '4 תווים לפחות'} error=${errors.new_password}>
              <${Input} type="password" dir="ltr" autocomplete="new-password" value=${pw.new_password} onInput=${(v) => setPw({ ...pw, new_password: v })} /><//>
          </div>
          <div class="row end"><${Button} kind="primary" type="submit" loading=${busy === 'pw'}>עדכון סיסמה<//></div>`
        : locked}
    </form>

    <section class="card form">
      <h3><${Icon} name="phone" /> סיסמה גם בשלוחת הטלפון</h3>
      <p class="muted small">בשלוחת הניהול מזהים אותך לפי מספר הטלפון. אפשר לדרוש בנוסף את הסיסמה שלך בכל שיחה, כדי שמי שמתחזה למספר שלך לא יוכל לנהל. הסיסמה צריכה להיות מספרית, כדי שאפשר יהיה להקיש אותה בטלפון.</p>
      ${user.phone_requires_password
        ? html`<div class="row gap-sm wrap"><${Badge} tone="info">פעיל: הסיסמה נדרשת בכל שיחה<//><span class="grow" />
            <${Button} loading=${busy === 'phone'} onClick=${() => setPhoneRequired(false)}>ביטול<//></div>`
        : html`<div class="row gap-sm wrap">
            <${Field} label="הסיסמה הנוכחית שלך, לאישור" error=${errors.password} class="grow"><${Input} type="password" dir="ltr" inputmode="numeric" value=${phonePw} onInput=${setPhonePw} /><//>
            <${Button} kind="primary" loading=${busy === 'phone'} disabled=${!phonePw} onClick=${() => setPhoneRequired(true)}>הפעלה<//>
          </div>`}
    </section>

    ${user.is_super && html`<section class="card">
      <h3><${Icon} name="shield" /> פרטיות</h3>
      <div class="setting"><${Toggle} checked=${user.is_hidden} onChange=${setHidden} label="הסתרה משאר המנהלים"
        hint="מנהלים אחרים לא יראו אותך ברשימות המשתמשים ובשלוחה. גם כשאתה גלוי, הם לא יכולים לערוך או למחוק אותך" /></div>
    </section>`}

    <${LoginHistory} />
  </div>`;
}

function LoginHistory() {
  const { data, loading } = useLoad(() => api.get('/me/logins'));
  return html`<section class="card">
    <h3>הכניסות שלי</h3>
    ${loading && !data ? html`<${Spinner} />` : !data?.length ? html`<p class="muted">אין כניסות רשומות</p>` : data.map((l) => html`<div class="login-row">
      <${Icon} name=${l.channel === 'phone' ? 'phone' : 'home'} />
      <span class="grow">${l.channel === 'phone' ? 'שלוחת טלפון' : 'אתר'} <span class="muted small" dir="ltr">${l.detail}</span></span>
      <span class="muted small">${formatDate(l.created_at)}</span></div>`)}
  </section>`;
}
