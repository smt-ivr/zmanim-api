// Recordings in your own voice for the phone line: every sentence and name the listening line says.
// Record here (or upload a file); it goes straight to Yemot and from then on plays instead of the
// computer voice. Whatever is not recorded keeps being read by text-to-speech.
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

/** Record with the microphone: start, stop, listen, then upload or record again. */
function Recorder({ onUpload, onCancel }) {
  const [state, setState] = useState('starting'); // starting | recording | review | denied
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState(null); // { blob, url, name }
  const [busy, setBusy] = useState(false);
  const rec = useRef(null);
  async function start() {
    setClip(null); setSeconds(0);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { setState('denied'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = r.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size < 800) { toast('ההקלטה קצרה מדי', 'error'); setState('idle'); return; }
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      setClip({ blob, url: URL.createObjectURL(blob), name: `recording.${ext}` });
      setState('review');
    };
    rec.current = r;
    r.start(250);
    setState('recording');
  }
  useEffect(() => { start(); return () => { if (rec.current?.state === 'recording') rec.current.stop(); }; }, []);
  useEffect(() => {
    if (state !== 'recording') return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  async function upload() {
    setBusy(true);
    try { await onUpload(clip.blob, clip.name); } catch (e) { toastError(e); }
    setBusy(false);
  }
  if (state === 'denied') return html`<div class="recorder"><div class="alert alert-info grow">אין גישה למיקרופון. אשרו גישה בדפדפן (ליד כתובת האתר) ונסו שוב.</div>
    <${Button} small onClick=${start}>לנסות שוב<//><${Button} small kind="ghost" onClick=${onCancel}>ביטול<//></div>`;
  if (state === 'recording' || state === 'starting') return html`<div class="recorder live">
    <span class="rec-dot" /><b>מקליט</b><span class="rec-time">${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}</span>
    <span class="grow muted small">אמרו את המשפט בקול ברור, ולחצו "סיום"</span>
    <${Button} small kind="primary" icon="stop" onClick=${() => rec.current?.stop()}>סיום<//>
    <${Button} small kind="ghost" onClick=${() => { rec.current.onstop = null; rec.current.stop(); rec.current.stream?.getTracks?.().forEach((t) => t.stop()); onCancel(); }}>ביטול<//>
  </div>`;
  if (state === 'review') return html`<div class="recorder">
    <audio controls src=${clip.url} class="grow" />
    <${Button} small kind="primary" icon="upload" loading=${busy} onClick=${upload}>שמירה בימות המשיח<//>
    <${Button} small icon="mic" onClick=${start} disabled=${busy}>מחדש<//>
    <${Button} small kind="ghost" onClick=${onCancel} disabled=${busy}>ביטול<//>
  </div>`;
  return html`<div class="recorder"><${Button} small icon="mic" onClick=${start}>הקלטה<//><${Button} small kind="ghost" onClick=${onCancel}>ביטול<//></div>`;
}

/** One sentence / name: what to say, its status, and record / upload / listen / delete. */
function RecRow({ item, onChanged, canRecord }) {
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef();
  async function upload(blob, name) {
    const f = new FormData();
    f.append('file', blob, name);
    const r = await api.post(`/admin/recordings/${enc(item.key)}`, f);
    toast('נשמר בימות המשיח ויושמע בקו מעכשיו');
    setRecording(false);
    onChanged({ ...item, recorded: true, changed: false, updated_at: r.updated_at });
  }
  async function pick(e) {
    const f = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    setBusy(true);
    try { await upload(f, f.name); } catch (err) { toastError(err); }
    setBusy(false);
  }
  async function remove() {
    if (!(await confirm({ title: 'מחיקת ההקלטה', body: `"${item.text}" יוקרא שוב בקול המחשב.`, confirmLabel: 'מחיקה', danger: true }))) return;
    try { await api.del(`/admin/recordings/${enc(item.key)}`); toast('ההקלטה נמחקה'); onChanged({ ...item, recorded: false, changed: false }); } catch (e) { toastError(e); }
  }
  return html`<div class=${cx('rec-row', item.recorded && 'done')}>
    <div class="rec-main">
      <span class=${cx('rec-state', item.recorded ? 'on' : 'off')}><${Icon} name=${item.recorded ? 'check' : 'mic'} size=${15} /></span>
      <div class="grow">
        <div class="rec-text">${item.text}</div>
        <div class="muted small">${[item.where, item.recorded && item.updated_at && `הוקלט ${timeAgo(item.updated_at)}`].filter(Boolean).join(' · ')}
          ${item.changed && html` <${Badge} tone="warn">הנוסח השתנה מאז ההקלטה<//>`}</div>
      </div>
      <div class="rec-actions">
        ${item.recorded && html`<${Button} small kind="ghost" icon=${playing ? 'stop' : 'play'} title="השמעה"
          onClick=${() => (playing ? (current?.audio.pause(), current?.done()) : play(`/admin/recordings/${enc(item.key)}/audio`, setPlaying))} />`}
        ${canRecord && html`<${Button} small icon="mic" kind=${item.recorded ? 'ghost' : 'primary'} onClick=${() => setRecording(true)}>${item.recorded ? 'מחדש' : 'הקלטה'}<//>
          <input type="file" accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg" hidden ref=${file} onChange=${pick} />
          <${Button} small icon="upload" title="העלאת קובץ שמע (wav, mp3, m4a ועוד)" loading=${busy} onClick=${() => file.current.click()}>העלאת קובץ<//>`}
        ${item.recorded && html`<${Button} small kind="ghost" icon="trash" title="מחיקה" onClick=${remove} />`}
      </div>
    </div>
    ${recording && html`<${Recorder} onUpload=${upload} onCancel=${() => setRecording(false)} />`}
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
    <${YemotSettings} settings=${data.settings} onSaved=${(s) => setData((d) => ({ ...d, settings: s }))} onSynced=${reload} />
    <div class="stats">
      <div class="card stat"><span class="stat-icon"><${Icon} name="mic" size=${20} /></span><div><div class="stat-value">${done} / ${data.items.length}</div><div class="muted small">משפטים ומילים הוקלטו</div>
        <div class="rec-meter"><span style=${`width:${(done / Math.max(1, data.items.length)) * 100}%`} /></div></div></div>
      <div class="card stat"><span class="stat-icon"><${Icon} name="building" size=${20} /></span><div><div class="stat-value">${data.synagogues.recorded} / ${data.synagogues.total}</div><div class="muted small">שמות בתי כנסת הוקלטו</div>
        <div class="rec-meter"><span style=${`width:${(data.synagogues.recorded / Math.max(1, data.synagogues.total)) * 100}%`} /></div></div></div>
    </div>
    ${!ready && html`<div class="alert alert-info">כדי להקליט, הזינו קודם למעלה את הטוקן של ימות המשיח.</div>`}
    <div class="tabs">
      <button class=${cx('tab', tab === 'phrases' && 'active')} onClick=${() => setTab('phrases')}>משפטים ומילים<span class="count">${data.items.length}</span></button>
      <button class=${cx('tab', tab === 'syn' && 'active')} onClick=${() => setTab('syn')}>שמות בתי כנסת<span class="count">${data.synagogues.total}</span></button>
    </div>
    ${tab === 'phrases' ? html`
      <div class="toolbar"><div class="segmented">${[['all', 'הכל'], ['missing', 'חסרים'], ['done', 'הוקלטו']].map(([k, l]) =>
        html`<button class=${cx(show === k && 'on')} onClick=${() => setShow(k)}>${l}</button>`)}</div>
        <span class="muted small grow">מקליטים כאן במיקרופון, או מעלים קובץ שמע מוכן (wav, mp3, m4a ועוד). קראו בדיוק את מה שכתוב; מספרים נקראים כמילים (8 = "שמונה").</span></div>
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
    <p class="muted small">מקליטים רק את השם, למשל "אהל משה". המילים "בבית כנסת" נאמרות לפניו (גם אותן אפשר להקליט בלשונית המשפטים).</p>
    ${loading && !data ? html`<${Spinner} />` : error && !data ? html`<${ErrorBox} error=${error} onRetry=${reload} />`
      : data.items.length === 0 ? html`<${Empty} icon="building" title=${filter === 'missing' ? 'כל בתי הכנסת הוקלטו' : 'לא נמצאו בתי כנסת'} />`
      : html`<section class="card rec-group">
          ${data.items.map((s) => html`<${RecRow} key=${s.id} canRecord=${canRecord}
            item=${{ key: `syn:${s.id}`, text: s.name, where: s.area_name, recorded: s.recorded, changed: s.changed, updated_at: s.updated_at }}
            onChanged=${(it) => { onChanged(it.recorded === s.recorded ? 0 : it.recorded ? 1 : -1); setData((d) => ({ ...d, items: d.items.map((x) => (x.id === s.id ? { ...x, recorded: it.recorded, changed: false, updated_at: it.updated_at } : x)) })); }} />`)}
          <${Pager} page=${page} pageSize=${data.page_size} total=${data.total} onPage=${setPage} />
        </section>`}
  </div>`;
}

/** The Yemot connection: token, folders, on/off, check, read the folders. */
function YemotSettings({ settings, onSaved, onSynced }) {
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
        <${Field} label="תיקייה למשפטים" hint="נוצרת בימות המשיח בהעלאה הראשונה" error=${errors.folder}><${Input} dir="ltr" value=${v.folder} onInput=${(x) => setV({ ...v, folder: x })} /><//>
        <${Field} label="תיקייה לשמות בתי כנסת" error=${errors.syn_folder}><${Input} dir="ltr" value=${v.syn_folder} onInput=${(x) => setV({ ...v, syn_folder: x })} /><//>
      </div>
      <div class="row gap-sm wrap">
        <${Button} kind="primary" loading=${busy === 'save'} onClick=${save}>שמירה<//>
        <${Button} loading=${busy === 'test'} disabled=${!settings.token} onClick=${() => run('test', async () => { await api.post('/admin/recordings/test'); toast('החיבור לימות המשיח תקין'); })}>בדיקת חיבור<//>
        <${Button} icon="refresh" loading=${busy === 'sync'} disabled=${!settings.token} onClick=${() => run('sync', async () => { const r = await api.post('/admin/recordings/sync'); toast(`נקראו התיקיות: ${r.added} נוספו, ${r.removed} הוסרו`); onSynced(); })}>סנכרון מהתיקיות<//>
        <span class="muted small grow">סנכרון: קבצים שהעליתם לתיקיות בעצמכם (בשם שמופיע ברשימה) יושמעו, וקבצים שנמחקו שם יוסרו.</span>
      </div>
    </div>`}
  </div>`;
}
