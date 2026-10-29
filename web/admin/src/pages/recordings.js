// Recordings in your own voice for the phone line: every sentence and name the listening line says.
// Upload a sound file; it goes straight to Yemot and from then on plays instead of the computer voice.
// A recording can be paused (read by text-to-speech again) without deleting it. Whatever has no
// recording keeps being read by text-to-speech.
import { api, fetchBlob } from '../api.js';
import { cx, html, timeAgo, useEffect, useRef, useState } from '../lib.js';
import { Badge, Button, Empty, ErrorBox, Field, Icon, Input, Pager, Spinner, Toggle, confirm, toast, toastError, useDebounced, useLoad } from '../ui.js';

const enc = encodeURIComponent;

/** Plays a recording from Yemot (through the API, with the session). One at a time. */
let current = null;
async function play(path, setPlaying) {
  if (current) { current.audio.pause(); current.done(); }
  setPlaying(true);
  try {
    const url = URL.createObjectURL(await fetchBlob(path));
    const audio = new Audio(url);
    const done = () => { setPlaying(false); URL.revokeObjectURL(url); if (current?.audio === audio) current = null; };
    current = { audio, done };
    audio.onended = done;
    audio.onerror = () => { done(); toast('לא ניתן להשמיע את הקובץ', 'error'); };
    await audio.play();
  } catch (e) { setPlaying(false); toastError(e); }
}

/** One sentence / name: what to say, its status, and upload / listen / pause / delete. */
function RecRow({ item, onChanged, canRecord }) {
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState('');
  const file = useRef();
  async function pick(e) {
    const f = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', f, f.name);
      const r = await api.post(`/admin/recordings/${enc(item.key)}`, form);
      toast('הועלה לימות המשיח ויושמע בקו מעכשיו');
      onChanged({ ...item, recorded: true, paused: false, error: null, changed: false, updated_at: r.updated_at });
    } catch (err) { toastError(err); }
    setBusy('');
  }
  async function pause(paused) {
    setBusy('pause');
    try {
      await api.patch(`/admin/recordings/${enc(item.key)}`, { paused });
      toast(paused ? 'מושהה: יישמע בקול המחשב' : 'ההקלטה מושמעת שוב');
      onChanged({ ...item, paused, error: paused ? item.error : null });
    } catch (e) { toastError(e); }
    setBusy('');
  }
  async function remove() {
    if (!(await confirm({ title: 'מחיקת ההקלטה', body: `הקובץ יימחק מימות המשיח, ו"${item.text}" יוקרא שוב בקול המחשב.`, confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/recordings/${enc(item.key)}`); toast('ההקלטה נמחקה'); onChanged({ ...item, recorded: false, paused: false, changed: false }); } catch (e) { toastError(e); }
  }
  const state = !item.recorded ? 'off' : item.paused ? 'paused' : 'on';
  return html`<div class=${cx('rec-row', state === 'on' && 'done')}>
    <div class="rec-main">
      <span class=${cx('rec-state', state)}><${Icon} name=${state === 'on' ? 'check' : state === 'paused' ? 'stop' : 'upload'} size=${15} /></span>
      <div class="grow">
        <div class="rec-text">${item.text}</div>
        <div class="muted small">${[item.where, item.recorded && item.updated_at && `הועלה ${timeAgo(item.updated_at)}`].filter(Boolean).join(' · ')}
          ${item.paused && html` <${Badge}>מושהה · נשמע בקול המחשב<//>`}
          ${item.error && html`<div class="rec-error"><${Icon} name="close" size=${13} /> ההשמעה בקו נכשלה: ${item.error}</div>`}
          ${item.changed && html` <${Badge} tone="warn">הנוסח השתנה מאז ההעלאה<//>`}</div>
      </div>
      <div class="rec-actions">
        ${item.recorded && html`<${Button} small kind="ghost" icon=${playing ? 'stop' : 'play'} title="השמעה"
          onClick=${() => (playing ? (current?.audio.pause(), current?.done()) : play(`/admin/recordings/${enc(item.key)}/audio`, setPlaying))} />`}
        ${item.recorded && html`<${Button} small kind="ghost" loading=${busy === 'pause'} onClick=${() => pause(!item.paused)}>${item.paused ? 'הפעלה' : 'השהיה'}<//>`}
        ${canRecord && html`<input type="file" accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.amr" hidden ref=${file} onChange=${pick} />
          <${Button} small icon="upload" kind=${item.recorded ? 'ghost' : 'primary'} title="קובץ שמע: wav, mp3, m4a ועוד" loading=${busy === 'upload'}
            onClick=${() => file.current.click()}>${item.recorded ? 'החלפה' : 'העלאת קובץ'}<//>`}
        ${item.recorded && html`<${Button} small kind="ghost" icon="trash" title="מחיקה" onClick=${remove} />`}
      </div>
    </div>
  </div>`;
}

export function RecordingsPage() {
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/admin/recordings'));
  const [tab, setTab] = useState('phrases');
  const [show, setShow] = useState('all');
  if (loading && !data) return html`<div class="page"><${Spinner} /></div>`;
  if (error && !data) return html`<div class="page"><${ErrorBox} error=${error} onRetry=${reload} /></div>`;
  const ready = Boolean(data.settings.token);
  const done = data.items.filter((i) => i.recorded).length;
  const changed = (it) => setData((d) => ({ ...d, items: d.items.map((x) => (x.key === it.key ? it : x)) }));
  const shown = data.items.filter((i) => show === 'all' || (show === 'missing' ? !i.recorded : i.recorded));
  const groups = [...new Set(shown.map((i) => i.group))];

  return html`<div class="page">
    <header class="page-head"><div><h1>הקלטות לקו הטלפון</h1>
      <p class="muted">מה שתקליטו כאן יושמע בקו השמיעה בקול שלכם, במקום קול המחשב. מה שלא הוקלט ממשיך להיקרא כרגיל.</p></div></header>
    <${YemotSettings} settings=${data.settings} webhook=${data.webhook} onSaved=${(s) => setData((d) => ({ ...d, settings: s }))} onSynced=${reload} />
    <div class="stats">
      <div class="card stat"><span class="stat-icon"><${Icon} name="mic" size=${20} /></span><div><div class="stat-value">${done} / ${data.items.length}</div><div class="muted small">משפטים ומילים הוקלטו</div>
        <div class="rec-meter"><span style=${`width:${(done / Math.max(1, data.items.length)) * 100}%`} /></div></div></div>
      <div class="card stat"><span class="stat-icon"><${Icon} name="building" size=${20} /></span><div><div class="stat-value">${data.synagogues.recorded} / ${data.synagogues.total}</div><div class="muted small">שמות בתי כנסת הוקלטו</div>
        <div class="rec-meter"><span style=${`width:${(data.synagogues.recorded / Math.max(1, data.synagogues.total)) * 100}%`} /></div></div></div>
    </div>
    ${!ready && html`<div class="alert alert-info">כדי להעלות הקלטות, הזינו קודם למעלה את הטוקן של ימות המשיח.</div>`}
    ${data.errors > 0 && html`<div class="alert alert-error">${data.errors === 1 ? 'הקלטה אחת לא הושמעה בקו' : `${data.errors} הקלטות לא הושמעו בקו`} (ימות המשיח דיווחו על שגיאה). הן הושהו ונשמעות בקול המחשב עד שתעלו אותן מחדש. מסומנות באדום ברשימה.</div>`}
    <div class="tabs">
      <button class=${cx('tab', tab === 'phrases' && 'active')} onClick=${() => setTab('phrases')}>משפטים ומילים<span class="count">${data.items.length}</span></button>
      <button class=${cx('tab', tab === 'syn' && 'active')} onClick=${() => setTab('syn')}>שמות בתי כנסת<span class="count">${data.synagogues.total}</span></button>
    </div>
    ${tab === 'phrases' ? html`
      <div class="toolbar"><div class="segmented">${[['all', 'הכל'], ['missing', 'חסרים'], ['done', 'הוקלטו']].map(([k, l]) =>
        html`<button class=${cx(show === k && 'on')} onClick=${() => setShow(k)}>${l}</button>`)}</div>
        <span class="muted small grow">מעלים קובץ שמע לכל שורה (wav, mp3, m4a ועוד). מקליטים בדיוק את מה שכתוב; מספרים נאמרים כמילים (8 = "שמונה"). "השהיה" משאירה את הקובץ אבל משמיעה את השורה בקול המחשב.</span></div>
      ${groups.length === 0 ? html`<${Empty} icon="mic" title="אין כאן כלום" />` : groups.map((g) => html`<section class="card rec-group" key=${g}>
        <h3>${g}</h3>
        ${shown.filter((i) => i.group === g).map((i) => html`<${RecRow} key=${i.key} item=${i} onChanged=${changed} canRecord=${ready} />`)}
      </section>`)}`
      : html`<${SynagogueRecordings} canRecord=${ready} onChanged=${(delta) => setData((d) => ({ ...d, synagogues: { ...d.synagogues, recorded: d.synagogues.recorded + delta } }))} />`}
  </div>`;
}

function SynagogueRecordings({ canRecord, onChanged }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('missing');
  const [page, setPage] = useState(0);
  const query = useDebounced(q, 300);
  useEffect(() => setPage(0), [query, filter]);
  const params = new URLSearchParams({ page, ...(query ? { q: query } : {}), ...(filter !== 'all' ? { filter } : {}) });
  const { data, error, loading, reload, setData } = useLoad(() => api.get(`/admin/recordings/synagogues?${params}`), [params.toString()]);
  return html`<div>
    <div class="toolbar filters">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="חיפוש בית כנסת…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      <div class="segmented">${[['missing', 'חסרים'], ['recorded', 'הוקלטו'], ['all', 'הכל']].map(([k, l]) =>
        html`<button class=${cx(filter === k && 'on')} onClick=${() => setFilter(k)}>${l}</button>`)}</div>
    </div>
    <p class="muted small">בקובץ אומרים רק את השם, למשל "מאור חיים". האות "ב" נאמרת לפניו ("במאור חיים"), וגם אותה אפשר להקליט בלשונית המשפטים.</p>
    ${loading && !data ? html`<${Spinner} />` : error && !data ? html`<${ErrorBox} error=${error} onRetry=${reload} />`
      : data.items.length === 0 ? html`<${Empty} icon="building" title=${filter === 'missing' ? 'כל בתי הכנסת הוקלטו' : 'לא נמצאו בתי כנסת'} />`
      : html`<section class="card rec-group">
          ${data.items.map((s) => html`<${RecRow} key=${s.id} canRecord=${canRecord}
            item=${{ key: `syn:${s.id}`, text: s.name, where: s.area_name, recorded: s.recorded, paused: s.paused, error: s.error, changed: s.changed, updated_at: s.updated_at }}
            onChanged=${(it) => { onChanged(it.recorded === s.recorded ? 0 : it.recorded ? 1 : -1); setData((d) => ({ ...d, items: d.items.map((x) => (x.id === s.id ? { ...x, recorded: it.recorded, paused: it.paused, error: it.error, changed: it.changed, updated_at: it.updated_at } : x)) })); }} />`)}
          <${Pager} page=${page} pageSize=${data.page_size} total=${data.total} onPage=${setPage} />
        </section>`}
  </div>`;
}

/** The Yemot connection: token, folders, on/off, check, read the folders. */
function YemotSettings({ settings, webhook, onSaved, onSynced }) {
  const [open, setOpen] = useState(!settings.token);
  const [v, setV] = useState({ token: settings.token, folder: settings.folder, syn_folder: settings.syn_folder });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');
  const run = async (what, fn) => { setBusy(what); try { await fn(); } catch (e) { e.fields && Object.keys(e.fields).length ? setErrors(e.fields) : toastError(e); } setBusy(''); };
  const save = () => run('save', async () => { setErrors({}); const s = await api.patch('/admin/recordings/settings', v); onSaved(s); setV({ token: s.token, folder: s.folder, syn_folder: s.syn_folder }); toast('נשמר'); });
  const enabled = (on) => run('toggle', async () => { onSaved(await api.patch('/admin/recordings/settings', { enabled: on })); toast(on ? 'ההקלטות מושמעות בקו' : 'הקו חוזר לקול המחשב בלבד'); });
  return html`<div class="card yemot-settings">
    <div class="row gap-sm wrap">
      <span class="stat-icon"><${Icon} name="phone" size=${18} /></span>
      <div class="grow"><b>חיבור לימות המשיח</b><div class="muted small">${settings.token ? `טוקן ${settings.token} · תיקיות ${settings.folder}, ${settings.syn_folder}` : 'לא הוגדר טוקן'}</div></div>
      <${Toggle} checked=${settings.enabled} onChange=${enabled} label="השמעת ההקלטות בקו" disabled=${busy === 'toggle'} />
      <${Button} small kind="ghost" icon=${open ? 'up' : 'settings'} onClick=${() => setOpen(!open)}>${open ? 'סגירה' : 'הגדרות'}<//>
    </div>
    ${open && html`<div class="yemot-form">
      <div class="grid-2">
        <${Field} label="טוקן API של ימות המשיח" hint="מספר המערכת:סיסמה, או טוקן שהופק באזור האישי" error=${errors.token}>
          <${Input} dir="ltr" value=${v.token} onInput=${(x) => setV({ ...v, token: x })} placeholder="0771234567:password" /><//>
        <div />
        <${Field} label="תיקייה למשפטים" hint="אותיות באנגלית וספרות בלבד, בלי - ובלי _" error=${errors.folder}><${Input} dir="ltr" value=${v.folder} onInput=${(x) => setV({ ...v, folder: x })} /><//>
        <${Field} label="תיקייה לשמות בתי כנסת" error=${errors.syn_folder}><${Input} dir="ltr" value=${v.syn_folder} onInput=${(x) => setV({ ...v, syn_folder: x })} /><//>
      </div>
      <div class="row gap-sm wrap">
        <${Button} kind="primary" loading=${busy === 'save'} onClick=${save}>שמירה<//>
        <${Button} loading=${busy === 'test'} disabled=${!settings.token} onClick=${() => run('test', async () => { await api.post('/admin/recordings/test'); toast('החיבור לימות המשיח תקין'); })}>בדיקת חיבור<//>
        <${Button} icon="refresh" loading=${busy === 'sync'} disabled=${!settings.token} onClick=${() => run('sync', async () => { const r = await api.post('/admin/recordings/sync'); toast(`נקראו התיקיות: ${r.added} נוספו, ${r.removed} הוסרו`); onSynced(); })}>סנכרון מהתיקיות<//>
        <span class="muted small grow">סנכרון: קבצים שהעליתם לתיקיות בעצמכם (בשם שמופיע ברשימה) יושמעו, וקבצים שנמחקו שם יוסרו.</span>
      </div>
      <div class="webhook-box">
        <b>דיווח על קובץ שלא הושמע</b>
        <p class="muted small">הוסיפו את השורה הזו להגדרות שלוחת קו השמיעה בימות המשיח. כשקובץ לא יושמע, ימות המשיח ידווחו לכאן, וההקלטה תושהה אוטומטית עד שתעלו אותה מחדש.</p>
        <div class="row gap-sm"><code dir="ltr" class="grow">${webhook}</code>
          <${Button} small icon="copy" onClick=${() => navigator.clipboard?.writeText(webhook).then(() => toast('הועתק'), () => toast('לא ניתן להעתיק', 'error'))}>העתקה<//></div>
      </div>
    </div>`}
  </div>`;
}
