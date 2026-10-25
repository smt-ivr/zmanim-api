// Settings for the Yemot HaMashiach phone extension: the api_link to paste into ext.ini.
import { API_ROOT, api } from '../api.js';
import { html } from '../lib.js';
import { Badge, Button, ErrorBox, Spinner, confirm, toast, toastError, useLoad } from '../ui.js';

export function PhonePanel() {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/admin/ivr'));
  if (loading && !data) return html`<${Spinner} />`;
  if (error && !data) return html`<${ErrorBox} error=${error} onRetry=${reload} />`;

  // The API sits next to this page, so the link is built from the address the admin is using now.
  const link = `${API_ROOT}${data.path}?key=${data.key}`;
  const ini = `type=api\napi_link=${link}\napi_hangup_send=yes`;

  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); toast('הועתק'); } catch { toast('לא ניתן להעתיק, סמנו והעתיקו ידנית', 'error'); }
  };
  async function rotate() {
    const ok = await confirm({ title: 'החלפת מפתח', body: 'הקישור הנוכחי יפסיק לעבוד מיד, ויהיה צריך לעדכן את ext.ini בימות המשיח.', confirmLabel: 'החלפה', danger: true });
    if (!ok) return;
    try { setData(await api.post('/admin/ivr/rotate')); toast('נוצר מפתח חדש'); } catch (e) { toastError(e); }
  }

  return html`<section class="narrow-section">
    <div class="card">
      <h3>הגדרת השלוחה בימות המשיח</h3>
      <p class="muted small">צרו שלוחה חדשה והדביקו את התוכן הבא בקובץ <code>ext.ini</code> שלה.</p>
      <pre class="code" dir="ltr">${ini}</pre>
      <div class="row gap-sm wrap">
        <${Button} kind="primary" icon="copy" onClick=${() => copy(ini)}>העתקת ההגדרות<//>
        <${Button} icon="copy" onClick=${() => copy(link)}>העתקת הקישור בלבד<//>
        <span class="grow" />
        <${Button} kind="ghost" icon="key" onClick=${rotate}>החלפת מפתח<//>
      </div>
    </div>
    <div class="card">
      <h3>מי יכול לנהל בטלפון</h3>
      <p class="muted small">המערכת מזהה את המתקשר לפי מספר הטלפון. מוסיפים או משנים טלפון בעמוד המשתמשים. מומלץ שכל משתמש יגדיר קוד אישי מתוך השלוחה.</p>
      <div class="list">
        ${data.phones.length === 0 && html`<div class="muted pad">אין משתמשים עם טלפון</div>`}
        ${data.phones.map((u) => html`<div class="list-row"><b class="grow">${u.name}</b><span dir="ltr">${u.phone}</span>
          <${Badge} tone=${u.role === 'admin' ? 'info' : 'neutral'}>${u.role === 'admin' ? 'מנהל מערכת' : 'מנהל בית כנסת'}<//></div>`)}
      </div>
    </div>
  </section>`;
}
