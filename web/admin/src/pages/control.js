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
      <h3><${Icon} name="settings" /> שם המערכת</h3>
      <${NameEditor} value=${data.system_name} onSave=${(v) => save({ system_name: v }, 'השם עודכן בכל המקומות')} />
    </section>

    <section class="card">
      <h3><${Icon} name="clock" /> זמנים ועונות</h3>
      ${toggle('shabbat_enabled', 'זמני שבת פעילים', 'כבוי: זמני שבת לא מופיעים בשום מקום, לא באתר, לא בניהול ולא בטלפון')}
      ${toggle('public_season_choice', 'הציבור יכול לבחור עונה', 'כבוי: באתר ובטלפון מוצגת רק העונה הנוכחית. את תאריכי ההחלפה קובעים ב"הגדרות ורשימות ← עונות"')}
      ${toggle('minyan_notes_enabled', 'הערות למניינים', 'כבוי: אין שדה הערה במניין, והערות קיימות לא מוצגות')}
      <${PlaceEditor} data=${data} onSave=${(patch) => save(patch, 'המיקום לחישוב הזמנים עודכן')} />
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
      <h3><${Icon} name="mail" /> מיילים (Resend)</h3>
      ${toggle('mail_enabled', 'שליחת מיילים פעילה', 'נדרש לכניסה בקישור, לאיפוס סיסמה, למייל פתיחת משתמש ולתשובות לפניות')}
      <${MailEditor} data=${data} onSave=${(patch) => save(patch, 'הגדרות המייל נשמרו')} />
    </section>

    <section class="card">
      <h3><${Icon} name="key" /> כניסה למערכת</h3>
      ${!data.mail_ready && html`<p class="muted small">הכניסה בקישור ואיפוס הסיסמה פועלים רק כששליחת המיילים מוגדרת.</p>`}
      ${toggle('magic_link_enabled', 'כניסה עם קישור למייל', 'למי שלא זוכר סיסמה: מקבל קישור כניסה חד-פעמי למייל')}
      ${toggle('password_reset_enabled', 'איפוס סיסמה במייל', 'קישור לבחירת סיסמה חדשה. משתמש שנחסם לו שינוי סיסמה לא יכול לאפס')}
      ${toggle('google_login_enabled', 'כניסה עם Google', 'כפתור "כניסה עם Google" במסך הכניסה. נכנסים רק משתמשים שהמייל שלהם במערכת זהה לחשבון Google')}
    </section>

    <section class="card">
      <h3><${Icon} name="building" /> הצטרפות עצמית של בתי כנסת</h3>
      ${!data.mail_ready && html`<p class="muted small">ההצטרפות דורשת אימות מייל, ולכן פועלת רק כששליחת המיילים מוגדרת.</p>`}
      ${toggle('registration_enabled', 'פתוח להצטרפות', 'קישור "הצטרפות" באתר ובמסך הכניסה. כל בקשה עוברת אימות מייל ואחר כך אישור')}
      ${toggle('registration_notify', 'מייל על כל בקשה חדשה', 'נשלח למי שמאשר בקשות, אחרי שהמבקש אימת את המייל')}
      <p class="small">את רשימת החסומים ואת כל הנעילות מנהלים בעמוד <a class="link" href="#/admin/security">חסימות ונעילות</a>.</p>
      <p class="muted small">הגנה מספאם פועלת תמיד: שדה נסתר לרובוטים, חסימה של טופס שנשלח מהר מדי, עד 3 בקשות בשעה מאותה כתובת IP ו-3 ביום מאותו מייל, וחסימת קישורים בשדות. בקשה שנחסמה מקבלת אותה תשובה כמו בקשה רגילה, כך שהשולח לא יודע שנחסם.</p>
    </section>

    <section class="card">
      <h3><${Icon} name="chat" /> הודעות</h3>
      ${toggle('feedback_enabled', 'משתמשים יכולים לשלוח הודעות', 'כבוי: אף משתמש לא יכול לשלוח הודעה מהמערכת. חסימה של משתמש מסוים נעשית מתוך השיחה איתו')}
    </section>
  </div>`;
}

function MailEditor({ data, onSave }) {
  const [from, setFrom] = useState(data.mail_from || '');
  const [key, setKey] = useState('');
  const [inbound, setInbound] = useState(data.inbound_email || '');
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    try { const r = await api.post('/admin/control/test-mail'); toast(`נשלח מייל בדיקה אל ${r.sent_to}`); }
    catch (e) { toastError(e); }
    setBusy(false);
  }
  const submit = (e) => {
    e.preventDefault();
    const patch = { mail_from: from.trim(), inbound_email: inbound.trim() };
    if (key.trim()) patch.resend_api_key = key.trim();
    onSave(patch);
    setKey('');
  };
  return html`<form class="form setting-form" onSubmit=${submit}>
    <${Field} label="כתובת השולח" hint="כתובת מדומיין שאומת ב-Resend. לדוגמה: זמני מניינים <noreply@smti.uk>">
      <${Input} dir="ltr" value=${from} onInput=${setFrom} placeholder="Zmanim <noreply@example.com>" /><//>
    <${Field} label="מפתח API של Resend" hint=${data.resend_api_key ? `שמור: ${data.resend_api_key}. השאירו ריק כדי לא לשנות` : 'מתחיל ב-re_. נשמר בשרת ולא מוצג שוב במלואו'}>
      <${Input} dir="ltr" type="password" autocomplete="off" value=${key} onInput=${setKey} placeholder="re_…" /><//>
    <${Field} label="כתובת לקבלת מיילים (לא חובה)" hint="מיילים לכתובת הזו נכנסים להודעות במערכת, ותשובות למיילים חוזרות לשיחה. דורש הגדרת Email Routing ב-Cloudflare שמעבירה את הכתובת ל-Worker zmanim">
      <${Input} dir="ltr" type="email" value=${inbound} onInput=${setInbound} placeholder="zmanim@smti.uk" /><//>
    <div class="row gap-sm wrap">
      <${Button} kind="primary" small type="submit">שמירה<//>
      <${Button} small icon="mail" loading=${busy} disabled=${!data.mail_ready} onClick=${test}>שליחת מייל בדיקה אליי<//>
      ${data.mail_ready ? html`<${Badge} tone="info">מוכן לשליחה<//>` : html`<span class="muted small">יש להפעיל, להזין שולח ומפתח</span>`}
    </div>
  </form>`;
}

function NoticeEditor({ value, onSave }) {
  const [v, setV] = useState(value || '');
  return html`<form class="form setting-form" onSubmit=${(e) => (e.preventDefault(), onSave(v.trim()))}>
    <${Field} label="הודעה בראש האתר הציבורי" hint="ריק = אין הודעה. למשל: זמני החורף נכנסים לתוקף ביום ראשון">
      <${Input} value=${v} onInput=${setV} maxlength="300" /><//>
    <div class="row gap-sm"><${Button} kind="primary" small type="submit">שמירת ההודעה<//>${value && html`<${Button} small onClick=${() => { setV(''); onSave(''); }}>הסרה<//>`}</div>
  </form>`;
}

// Where sunrise / sunset are computed for minyanim set relative to them.
const PLACES = [
  ['ירושלים', 31.778, 35.235], ['בני ברק', 32.084, 34.834], ['בית שמש', 31.747, 34.988], ['מודיעין עילית', 31.932, 35.043],
  ['ביתר עילית', 31.700, 35.117], ['אלעד', 32.052, 34.951], ['אשדוד', 31.801, 34.650], ['פתח תקווה', 32.087, 34.887],
  ['חיפה', 32.794, 34.990], ['צפת', 32.965, 35.496],
];
function PlaceEditor({ data, onSave }) {
  const [lat, setLat] = useState(data.zmanim_lat || '');
  const [lng, setLng] = useState(data.zmanim_lng || '');
  const current = PLACES.find(([, a, b]) => String(a) === String(lat) && String(b) === String(lng));
  return html`<form class="form setting-form" onSubmit=${(e) => (e.preventDefault(), onSave({ zmanim_lat: String(lat).trim(), zmanim_lng: String(lng).trim() }))}>
    <${Field} group label="מיקום לחישוב זמני היום" hint="לפיו מחושבים הנץ, שקיעה וכו׳ למניינים שנקבעו ביחס אליהם">
      <div class="chips">${PLACES.map(([n, a, b]) => html`<button type="button" class=${cx('chip', current?.[0] === n && 'on')}
        onClick=${() => { setLat(a); setLng(b); }}>${n}</button>`)}</div><//>
    <div class="grid-2">
      <${Field} label="קו רוחב"><${Input} dir="ltr" value=${lat} onInput=${setLat} /><//>
      <${Field} label="קו אורך"><${Input} dir="ltr" value=${lng} onInput=${setLng} /><//>
    </div>
    <div><${Button} kind="primary" small type="submit">שמירה<//></div>
  </form>`;
}

function NameEditor({ value, onSave }) {
  const [v, setV] = useState(value || '');
  return html`<form class="form setting-form" onSubmit=${(e) => (e.preventDefault(), v.trim() && onSave(v.trim()))}>
    <${Field} label="השם שמופיע בכל המקומות" hint="באתר הציבורי, בממשק הניהול, במסך הכניסה, במיילים ובקו השמיעה בטלפון">
      <${Input} value=${v} onInput=${setV} maxlength="60" required /><//>
    <div><${Button} kind="primary" small type="submit">שמירה<//></div>
  </form>`;
}

function PhoneEditor({ value, onSave }) {
  const [v, setV] = useState(value || '');
  return html`<form class="form setting-form" onSubmit=${(e) => (e.preventDefault(), onSave(v.trim()))}>
    <${Field} label="מספר הקו שמוצג באתר"><${Input} dir="ltr" type="tel" value=${v} onInput=${setV} /><//>
    <div><${Button} kind="primary" small type="submit">שמירה<//></div>
  </form>`;
}
