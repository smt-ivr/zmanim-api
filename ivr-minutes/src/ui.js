// The admin page: one self-contained HTML document (no build, no external files).
// It talks to ./api/ relative to its own address, so it works under any prefix.
export const PAGE = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>תוספת שבת</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2330;--muted:#677084;--line:#e3e6ec;--accent:#2457c5;--accent-ink:#fff;--soft:#eef3fd;--danger:#c33a3a;--ok:#1d7a4c;--shadow:0 1px 2px rgba(20,30,50,.06),0 2px 8px rgba(20,30,50,.05)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#12151b;--card:#1a1f27;--ink:#e6e9ef;--muted:#98a1b3;--line:#2b323d;--accent:#6e9bff;--accent-ink:#0d1220;--soft:#1f2a40;--danger:#ff7b7b;--ok:#5fd39a;--shadow:none}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
header{background:var(--card);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:18px;margin:0;margin-inline-end:auto}
main{max-width:1050px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow);margin-bottom:16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.stat b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:13px}
.tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--line);overflow-x:auto}
.tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:8px 14px;color:var(--muted);font:inherit;cursor:pointer;white-space:nowrap}
.tabs button.on{color:var(--accent);border-color:var(--accent);font-weight:600}
input,select,textarea{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-width:0}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
button.btn{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 12px;cursor:pointer}
button.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button.btn.danger{color:var(--danger)}
button.btn:disabled{opacity:.5;cursor:default}
button.link{background:none;border:0;color:var(--accent);cursor:pointer;font:inherit;padding:0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.grow{flex:1}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:start;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:500;font-size:13px}
td.num{font-variant-numeric:tabular-nums}
tr.click{cursor:pointer}
tr.click:hover td{background:var(--soft)}
.muted{color:var(--muted)}
.small{font-size:13px}
.empty{color:var(--muted);text-align:center;padding:24px}
.err{color:var(--danger);min-height:1.5em}
.login{max-width:360px;margin:12vh auto}
.login h1{font-size:20px;margin-top:0}
pre{background:var(--soft);border-radius:8px;padding:10px 12px;direction:ltr;text-align:left;overflow-x:auto;margin:6px 0;font-size:13px;white-space:pre-wrap;word-break:break-all}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
label.f{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted)}
label.f input,label.f select{color:var(--ink);font-size:15px}
label.chk{display:flex;gap:8px;align-items:center}
dialog{border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);padding:0;width:min(640px,calc(100vw - 32px));max-height:85vh}
dialog::backdrop{background:rgba(0,0,0,.35)}
.dlg-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--line)}
.dlg-head h2{margin:0;font-size:17px;margin-inline-end:auto}
.dlg-body{padding:16px;overflow:auto;max-height:calc(85vh - 60px)}
.tag{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;background:var(--soft);color:var(--muted)}
.pos{color:var(--ok)}.neg{color:var(--danger)}
.hint{font-size:13px;color:var(--muted);margin:4px 0 0}
.rec{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--line)}
.rec:last-child{border-bottom:0}
.rec-text{flex:1;min-width:220px}
.rec.on .rec-text b::before{content:"✓ ";color:var(--ok)}
.rec-actions{display:flex;gap:6px;flex-wrap:wrap}
.rec-actions .btn{padding:5px 10px;font-size:14px}
#toast{position:fixed;bottom:16px;inset-inline-start:50%;transform:translateX(50%);background:var(--ink);color:var(--bg);padding:8px 16px;border-radius:8px;opacity:0;transition:opacity .2s;pointer-events:none}
#toast.on{opacity:1}
@media (max-width:600px){main{padding:12px}th,td{padding:7px 6px}}
</style>
</head>
<body>
<div id="app"></div>
<dialog id="dlg"></dialog>
<div id="toast"></div>
<script>
'use strict';
const BASE = location.pathname.replace(/[^/]*$/, '');
const API = BASE + 'api/';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const fmtDate = (s) => s ? new Date(s * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const fmtMin = (n) => { n = Number(n) || 0; const a = Math.abs(n), h = Math.floor(a / 60), m = a % 60; return (n < 0 ? '-' : '') + (h ? h + ':' + String(m).padStart(2, '0') + ' ש׳' : m + ' ד׳'); };
const num = (n) => Number(n || 0).toLocaleString('he-IL');

let token = store.get('minutes_token');
const state = { list: store.get('minutes_list') || 'main', tab: store.get('minutes_tab') || 'people', q: '' };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); }

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get('Content-Type')?.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && path !== 'login' && path !== 'password') { token = null; store.set('minutes_token', null); render(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'שגיאה');
  return data;
}

// ------------------------------------------------------------------ login
async function renderLogin() {
  let configured = true;
  try { configured = (await api('status')).configured; } catch {}
  $('#app').innerHTML = '<div class="login card"><h1>תוספת שבת · כניסה</h1>' + (configured
    ? '<form id="lf"><div class="row"><input id="pw" type="password" class="grow" placeholder="סיסמה" autocomplete="current-password" required autofocus><button class="btn primary">כניסה</button></div><p class="err" id="le"></p></form>'
    : '<p>עדיין לא הוגדרה סיסמת ניהול במסד הנתונים.</p>') + '</div>';
  const f = $('#lf');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    try { token = (await api('login', { method: 'POST', body: { password: $('#pw').value } })).token; store.set('minutes_token', token); render(); }
    catch (err) { $('#le').textContent = err.message; }
  };
}

// ------------------------------------------------------------------ shell
async function render() {
  if (!token) return renderLogin();
  $('#app').innerHTML = \`
<header>
  <h1>תוספת שבת</h1>
  <label class="row small muted">רשימה <select id="list"></select></label>
  <button class="btn" id="newList" title="רשימה חדשה">+ רשימה</button>
  <button class="btn" id="logout">יציאה</button>
</header>
<main>
  <div class="stats" id="stats"></div>
  <div class="tabs" id="tabs">
    <button data-tab="people">משתתפות</button>
    <button data-tab="log">פעילות</button>
    <button data-tab="recordings">הקלטות</button>
    <button data-tab="setup">הגדרת שלוחות</button>
  </div>
  <div id="view"></div>
</main>\`;
  $('#logout').onclick = () => { token = null; store.set('minutes_token', null); render(); };
  $('#newList').onclick = () => {
    const name = (prompt('שם הרשימה החדשה (אותיות, מספרים, _ או -):') || '').trim();
    if (!name) return;
    if (!/^[\\p{L}\\p{N}_-]{1,40}$/u.test(name)) return alert('שם לא תקין');
    setList(name);
  };
  $('#list').onchange = (e) => setList(e.target.value);
  $('#tabs').onclick = (e) => { const t = e.target.dataset.tab; if (t) { state.tab = t; store.set('minutes_tab', t); showTab(); } };
  await loadLists();
  showTab();
}

async function loadLists() {
  const lists = await api('lists');
  if (!lists.some((l) => l.list === state.list)) lists.push({ list: state.list, phones: 0, minutes: 0 });
  $('#list').innerHTML = lists.map((l) => '<option value="' + esc(l.list) + '"' + (l.list === state.list ? ' selected' : '') + '>' + esc(l.list === 'main' ? 'ראשית (main)' : l.list) + '</option>').join('');
}

function setList(name) { state.list = name; store.set('minutes_list', name); loadLists(); showTab(); }

async function loadStats() {
  const s = await api('summary?list=' + encodeURIComponent(state.list));
  $('#stats').innerHTML = [
    [fmtMin(s.minutes), 'סך הכל תוספת שבת (' + num(s.minutes) + ' דקות)'],
    [num(s.phones), 'משתתפות'],
    [num(s.entries), 'עדכונים'],
    [fmtMin(s.today_minutes), 'נוסף היום · ' + num(s.today_phones) + ' משתתפות'],
  ].map(([b, t]) => '<div class="stat"><b>' + b + '</b><span>' + esc(t) + '</span></div>').join('');
}

function showTab() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const view = $('#view'); view.onclick = view.oninput = view.onchange = null;
  stopPlaying();
  loadStats().catch((e) => toast(e.message));
  (({ people: viewPeople, log: viewLog, recordings: viewRecordings, setup: viewSetup })[state.tab] || viewPeople)().catch((e) => { $('#view').innerHTML = '<div class="card err">' + esc(e.message) + '</div>'; });
}

// ------------------------------------------------------------------ people
async function viewPeople() {
  $('#view').innerHTML = \`<div class="card">
    <div class="row" style="margin-bottom:12px">
      <input id="q" class="grow" placeholder="חיפוש לפי טלפון או שם" value="\${esc(state.q)}">
      <button class="btn" id="addManual">+ הוספה ידנית</button>
      <a class="btn" id="csv" href="#" style="text-decoration:none;display:inline-block;border:1px solid var(--line);border-radius:8px;padding:7px 12px;color:inherit">ייצוא לאקסל</a>
    </div>
    <div class="table-wrap" id="ptable"><p class="empty">טוען…</p></div></div>\`;
  const rows = await api('people?list=' + encodeURIComponent(state.list));
  const draw = () => {
    const q = state.q.trim();
    const shown = q ? rows.filter((r) => r.phone.includes(q.replace(/\\D/g, '') || '\\u0000') || r.name.includes(q)) : rows;
    $('#ptable').innerHTML = shown.length ? '<table><thead><tr><th>#</th><th>טלפון</th><th>שם</th><th>נצבר</th><th>דקות</th><th>עדכונים</th><th>עדכון אחרון</th></tr></thead><tbody>' +
      shown.map((r, i) => '<tr class="click" data-phone="' + esc(r.phone) + '"><td class="muted">' + (i + 1) + '</td><td dir="ltr" style="text-align:right">' + esc(r.phone) + '</td><td>' + esc(r.name) + '</td><td class="num"><b>' + fmtMin(r.minutes) + '</b></td><td class="num">' + num(r.minutes) + '</td><td class="num">' + num(r.entries) + '</td><td class="muted small">' + fmtDate(r.last_at) + '</td></tr>').join('') +
      '</tbody></table>' : '<p class="empty">' + (rows.length ? 'לא נמצאו תוצאות' : 'עדיין אין עדכונים ברשימה זו') + '</p>';
  };
  draw();
  $('#q').oninput = (e) => { state.q = e.target.value; draw(); };
  $('#ptable').onclick = (e) => { const tr = e.target.closest('tr[data-phone]'); if (tr) openPerson(tr.dataset.phone); };
  $('#addManual').onclick = () => openManual();
  $('#csv').onclick = async (e) => {
    e.preventDefault();
    const res = await fetch(API + 'export?list=' + encodeURIComponent(state.list), { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return toast('הייצוא נכשל');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = 'minutes-' + state.list + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

function dialog(title, body) {
  const d = $('#dlg');
  d.innerHTML = '<div class="dlg-head"><h2>' + esc(title) + '</h2><button class="btn" data-close>סגירה</button></div><div class="dlg-body">' + body + '</div>';
  d.querySelector('[data-close]').onclick = () => d.close();
  if (!d.open) d.showModal();
  return d;
}

function openManual(phone = '') {
  const d = dialog('הוספה ידנית', \`<form id="mf" class="grid2">
    <label class="f">טלפון<input name="phone" dir="ltr" inputmode="tel" required value="\${esc(phone)}"></label>
    <label class="f">דקות (מספר שלילי מפחית)<input name="minutes" type="number" required></label>
    <label class="f" style="grid-column:1/-1">הערה<input name="note" maxlength="200"></label>
    <div class="row" style="grid-column:1/-1"><button class="btn primary">הוספה</button><span class="err" id="me"></span></div></form>\`);
  $('#mf', d).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('entries', { method: 'POST', body: { list: state.list, phone: f.get('phone'), minutes: Number(f.get('minutes')), note: f.get('note') } });
      toast('נוסף'); d.close(); showTab();
    } catch (err) { $('#me', d).textContent = err.message; }
  };
}

async function openPerson(phone) {
  const p = await api('people/' + phone + '?list=' + encodeURIComponent(state.list));
  const src = (e) => e.source === 'phone' ? '<span class="tag">טלפון</span>' : '<span class="tag">ידני</span>';
  const d = dialog(phone + (p.name ? ' · ' + p.name : ''), \`
    <div class="row" style="margin-bottom:12px">
      <input id="pname" class="grow" placeholder="שם (לזיהוי בממשק בלבד)" value="\${esc(p.name)}" maxlength="80">
      <button class="btn" id="saveName">שמירת שם</button>
    </div>
    <p>סך הכל: <b>\${fmtMin(p.minutes)}</b> <span class="muted">(\${num(p.minutes)} דקות)</span></p>
    <div class="table-wrap">\${p.entries.length ? '<table><thead><tr><th>מתי</th><th>דקות</th><th>מקור</th><th>הערה</th><th></th></tr></thead><tbody>' +
      p.entries.map((e) => '<tr data-id="' + e.id + '"><td class="small">' + fmtDate(e.created_at) + (e.updated_at !== e.created_at ? '<br><span class="muted">שונה ' + fmtDate(e.updated_at) + '</span>' : '') + '</td><td class="num"><b>' + num(e.minutes) + '</b></td><td>' + src(e) + '</td><td class="small">' + esc(e.note) + '</td><td><button class="link" data-act="edit">עריכה</button> · <button class="link" data-act="del" style="color:var(--danger)">מחיקה</button></td></tr>').join('') +
      '</tbody></table>' : '<p class="empty">אין עדכונים</p>'}</div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="addFor">+ הוספה ידנית</button>
      <span class="grow"></span>
      <button class="btn danger" id="delAll">מחיקת כל הנתונים של המספר</button>
    </div>\`);
  $('#saveName', d).onclick = async () => { await api('people/' + phone, { method: 'PUT', body: { list: state.list, name: $('#pname', d).value } }); toast('נשמר'); showTab(); };
  $('#addFor', d).onclick = () => openManual(phone);
  $('#delAll', d).onclick = async () => {
    if (!confirm('למחוק את כל העדכונים של ' + phone + ' ברשימה זו?')) return;
    await api('people/' + phone + '?list=' + encodeURIComponent(state.list), { method: 'DELETE' }); toast('נמחק'); d.close(); showTab();
  };
  d.querySelector('tbody')?.addEventListener('click', async (ev) => {
    const act = ev.target.dataset.act; if (!act) return;
    const id = ev.target.closest('tr').dataset.id;
    const entry = p.entries.find((x) => String(x.id) === id);
    try {
      if (act === 'del') { if (!confirm('למחוק עדכון של ' + entry.minutes + ' דקות?')) return; await api('entries/' + id, { method: 'DELETE' }); }
      else {
        const v = prompt('מספר הדקות:', entry.minutes); if (v == null) return;
        const note = prompt('הערה:', entry.note || ''); if (note == null) return;
        await api('entries/' + id, { method: 'PATCH', body: { minutes: Number(v), note } });
      }
      toast('עודכן'); openPerson(phone); loadStats();
    } catch (err) { alert(err.message); }
  });
}

// ------------------------------------------------------------------ log
async function viewLog() {
  $('#view').innerHTML = '<div class="card"><div class="table-wrap" id="ltable"><p class="empty">טוען…</p></div></div>';
  const rows = await api('log?list=' + encodeURIComponent(state.list) + '&limit=300');
  const act = (r) => r.action === 'add' ? 'הוספה' : r.action === 'edit' ? 'שינוי' : 'מחיקה';
  const what = (r) => r.action === 'add' ? '<span class="' + (r.minutes < 0 ? 'neg' : 'pos') + '">' + (r.minutes > 0 ? '+' : '') + num(r.minutes) + '</span>'
    : r.action === 'edit' ? num(r.before) + ' ← ' + num(r.minutes) : '<span class="neg">' + num(r.before) + '</span>';
  $('#ltable').innerHTML = rows.length ? '<table><thead><tr><th>מתי</th><th>טלפון</th><th>שם</th><th>פעולה</th><th>דקות</th><th>על ידי</th></tr></thead><tbody>' +
    rows.map((r) => '<tr class="click" data-phone="' + esc(r.phone) + '"><td class="small">' + fmtDate(r.at) + '</td><td dir="ltr" style="text-align:right">' + esc(r.phone) + '</td><td>' + esc(r.name) + '</td><td>' + act(r) + '</td><td class="num">' + what(r) + '</td><td><span class="tag">' + (r.by === 'phone' ? 'טלפון' : 'ממשק') + '</span></td></tr>').join('') +
    '</tbody></table>' : '<p class="empty">אין פעילות עדיין</p>';
  $('#ltable').onclick = (e) => { const tr = e.target.closest('tr[data-phone]'); if (tr) openPerson(tr.dataset.phone); };
}

// ------------------------------------------------------------------ recordings
let playing = null; // { audio, url, btn }
function stopPlaying() { if (playing) { playing.audio.pause(); URL.revokeObjectURL(playing.url); playing.btn.textContent = '▶ השמעה'; playing = null; } }
let recorder = null; // { rec, key, btn, stream }

async function viewRecordings() {
  const data = await api('recordings');
  const s = data.settings;
  const done = data.items.filter((i) => i.recorded).length;
  const errors = data.items.filter((i) => i.error).length;
  const groups = [...new Set(data.items.map((i) => i.group))];
  const row = (i) => {
    const st = !i.recorded ? 'off' : i.paused ? 'paused' : 'on';
    return '<div class="rec ' + st + '" data-key="' + i.key + '">' +
      '<div class="rec-text"><b>' + esc(i.text) + '</b><div class="small muted">' + esc(i.where) + ' · קובץ: <span dir="ltr">' + esc(i.file) + '</span>' +
      (i.recorded && i.updated_at ? ' · הועלה ' + fmtDate(i.updated_at) : '') + '</div>' +
      (i.paused ? '<span class="tag">מושהה · נשמע בקול המחשב</span> ' : '') +
      (i.changed ? '<span class="tag">הנוסח השתנה מאז ההעלאה</span> ' : '') +
      (i.error ? '<div class="small neg">ההשמעה בקו נכשלה: ' + esc(i.error) + '</div>' : '') + '</div>' +
      '<div class="rec-actions">' +
      (i.recorded ? '<button class="btn" data-act="play">▶ השמעה</button>' : '') +
      '<button class="btn" data-act="mic">● הקלטה</button>' +
      '<button class="btn' + (i.recorded ? '' : ' primary') + '" data-act="file">' + (i.recorded ? 'החלפה' : 'העלאת קובץ') + '</button>' +
      (i.recorded ? '<button class="btn" data-act="pause">' + (i.paused ? 'הפעלה' : 'השהיה') + '</button><button class="btn danger" data-act="del">מחיקה</button>' : '') +
      '</div></div>';
  };
  $('#view').innerHTML =
    '<div class="card"><h3 style="margin-top:0">חיבור לימות המשיח</h3>' +
    '<p class="muted small" style="margin-top:0">ההקלטות עולות ישר למערכת שלכם בימות המשיח, ומשם מושמעות בשלוחות במקום קול המחשב. משפט שלא הוקלט ממשיך להיקרא בקול המחשב.</p>' +
    '<form id="rs" class="grid2">' +
    '<label class="f">טוקן של ימות המשיח' + '<input id="r_token" dir="ltr" autocomplete="off" placeholder="' + (s.has_token ? esc(s.token) : 'מספר מערכת:סיסמה, או טוקן') + '"></label>' +
    '<label class="f">תיקייה בימות המשיח (אותיות באנגלית וספרות)<input id="r_folder" dir="ltr" value="' + esc(s.folder) + '"></label>' +
    '<label class="chk"><input type="checkbox" id="r_enabled"' + (s.enabled ? ' checked' : '') + '> להשמיע את ההקלטות בשלוחות</label>' +
    '<label class="chk"><input type="checkbox" id="r_numbers"' + (s.yemot_numbers ? ' checked' : '') + '> מספרים בקול המערכת של ימות המשיח (במקום קול המחשב)</label>' +
    '<div class="row" style="grid-column:1/-1"><button class="btn primary">שמירה</button><button class="btn" type="button" id="r_test"' + (s.has_token ? '' : ' disabled') + '>בדיקת החיבור</button>' +
    '<span class="small ' + (s.has_token ? 'pos' : 'muted') + '">' + (s.has_token ? '✓ יש טוקן שמור (' + esc(s.token) + ')' : 'עדיין אין טוקן') + '</span></div></form></div>' +
    '<div class="stats"><div class="stat"><b>' + done + ' / ' + data.items.length + '</b><span>משפטים הוקלטו</span></div>' +
    (errors ? '<div class="stat"><b class="neg">' + errors + '</b><span>נכשלו בהשמעה (הושהו)</span></div>' : '') + '</div>' +
    (!s.has_token ? '<div class="card">כדי להעלות הקלטות, הזינו קודם למעלה את הטוקן של ימות המשיח.</div>' : '') +
    groups.map((g) => '<div class="card"><h3 style="margin-top:0">' + esc(g) + '</h3>' + data.items.filter((i) => i.group === g).map(row).join('') + '</div>').join('') +
    '<input type="file" id="r_file" accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.amr" hidden>';

  $('#rs').onsubmit = async (e) => {
    e.preventDefault();
    const body = { folder: $('#r_folder').value, enabled: $('#r_enabled').checked, yemot_numbers: $('#r_numbers').checked };
    if ($('#r_token').value.trim()) body.token = $('#r_token').value.trim();
    try { await api('recordings/settings', { method: 'PATCH', body }); toast('נשמר'); viewRecordings(); } catch (err) { alert(err.message); }
  };
  $('#r_test').onclick = async () => { try { await api('recordings/test', { method: 'POST' }); toast('החיבור לימות המשיח תקין ✓'); } catch (err) { alert(err.message); } };

  let pickKey = null;
  const send = async (key, blob, name) => {
    const form = new FormData();
    form.append('file', blob, name);
    toast('מעלה לימות המשיח…');
    const res = await fetch(API + 'recordings/' + key, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'ההעלאה נכשלה');
    toast('הועלה ויושמע בשלוחה מעכשיו');
    viewRecordings();
  };
  $('#r_file').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f && pickKey) { try { await send(pickKey, f, f.name); } catch (err) { alert(err.message); } }
  };
  $('#view').onclick = async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const key = btn.closest('[data-key]').dataset.key;
    const act = btn.dataset.act;
    try {
      if (act === 'file') { if (!s.has_token) return alert('יש להזין קודם טוקן של ימות המשיח'); pickKey = key; $('#r_file').click(); }
      if (act === 'play') {
        if (playing && playing.btn === btn) return stopPlaying();
        stopPlaying();
        btn.textContent = 'טוען…';
        const res = await fetch(API + 'recordings/' + key + '/audio', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) { btn.textContent = '▶ השמעה'; throw new Error((await res.json().catch(() => ({}))).error || 'לא ניתן להשמיע'); }
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        playing = { audio, url, btn };
        audio.onended = stopPlaying;
        btn.textContent = '■ עצירה';
        await audio.play();
      }
      if (act === 'mic') {
        if (recorder && recorder.key === key) { recorder.rec.stop(); return; }
        if (recorder) return alert('יש הקלטה אחרת פעילה');
        if (!s.has_token) return alert('יש להזין קודם טוקן של ימות המשיח');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        const chunks = [];
        rec.ondataavailable = (ev) => chunks.push(ev.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          recorder = null;
          btn.textContent = '● הקלטה'; btn.classList.remove('primary');
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (!blob.size) return;
          const back = new Audio(URL.createObjectURL(blob));
          back.play().catch(() => {});
          if (!confirm('להעלות את ההקלטה? (היא מושמעת עכשיו לבדיקה)')) { back.pause(); return; }
          back.pause();
          try { await send(key, blob, 'recording.' + ((rec.mimeType || '').includes('ogg') ? 'ogg' : (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm')); } catch (err) { alert(err.message); }
        };
        recorder = { rec, key, btn, stream };
        rec.start();
        btn.textContent = '■ סיום הקלטה'; btn.classList.add('primary');
      }
      if (act === 'pause') {
        const paused = btn.textContent === 'השהיה';
        await api('recordings/' + key, { method: 'PATCH', body: { paused } });
        toast(paused ? 'מושהה: יישמע בקול המחשב' : 'ההקלטה מושמעת שוב'); viewRecordings();
      }
      if (act === 'del') {
        if (!confirm('למחוק את ההקלטה? הקובץ יימחק מימות המשיח והמשפט ייקרא שוב בקול המחשב.')) return;
        await api('recordings/' + key, { method: 'DELETE' }); toast('נמחק'); viewRecordings();
      }
    } catch (err) { alert(err.message); }
  };
}

// ------------------------------------------------------------------ setup (Yemot extension settings)
async function viewSetup() {
  const { key } = await api('settings');
  const saved = JSON.parse(store.get('minutes_setup') || '{}');
  const v = { max: 60, times: 1, per: 'week', perN: 12, perUnit: 'h', edit: true, hours: false, all: false, ...saved };
  $('#view').innerHTML = \`
  <div class="card">
    <h3 style="margin-top:0">שלוחת עדכון דקות</h3>
    <div class="grid2">
      <label class="f">כמה דקות לכל היותר בעדכון אחד<input id="s_max" type="number" min="1" max="99999" value="\${v.max}"></label>
      <label class="f">כמה עדכונים מותרים<input id="s_times" type="number" min="1" max="999" value="\${v.times}"></label>
      <label class="f">בכל
        <select id="s_per">
          <option value="day">יום (לפי התאריך)</option><option value="week">שבוע (מיום ראשון)</option><option value="month">חודש</option>
          <option value="rolling">פרק זמן מתגלגל…</option><option value="ever">בכל הזמן (בלי איפוס)</option>
        </select></label>
      <label class="f" id="rollWrap">פרק הזמן
        <span class="row"><input id="s_n" type="number" min="1" max="9999" value="\${v.perN}" style="width:90px"><select id="s_unit"><option value="m">דקות</option><option value="h">שעות</option><option value="d">ימים</option></select></span></label>
    </div>
    <div class="row" style="margin-top:12px;gap:18px">
      <label class="chk"><input type="checkbox" id="s_edit" \${v.edit ? 'checked' : ''}> אפשר לשנות את העדכון האחרון כשהגיעו למגבלה</label>
      <label class="chk"><input type="checkbox" id="s_hours" \${v.hours ? 'checked' : ''}> להשמיע בשעות ודקות</label>
    </div>
    <p class="hint">הגדרות השלוחה בימות המשיח (ext.ini):</p>
    <pre id="addIni"></pre>
    <button class="btn" data-copy="addIni">העתקה</button>
  </div>
  <div class="card">
    <h3 style="margin-top:0">שלוחת שמיעת הסכום</h3>
    <label class="chk"><input type="checkbox" id="s_all" \${v.all ? 'checked' : ''}> להשמיע גם את הסכום של כל המשתתפות</label>
    <pre id="totalIni"></pre>
    <button class="btn" data-copy="totalIni">העתקה</button>
  </div>
  <div class="card">
    <h3 style="margin-top:0">מפתח גישה</h3>
    <p class="muted small">המפתח נכלל בקישורים שלמעלה, ובלעדיו השלוחה חסומה. החלפת המפתח משביתה את הקישורים הישנים עד שתעדכנו אותם בימות המשיח.</p>
    <div class="row"><code dir="ltr">\${esc(key)}</code><button class="btn danger" id="rotate">החלפת מפתח</button></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">סיסמת הממשק</h3>
    <form id="pwf" class="row">
      <input id="pw_cur" type="password" placeholder="הסיסמה הנוכחית" autocomplete="current-password" required>
      <input id="pw_new" type="password" placeholder="סיסמה חדשה" autocomplete="new-password" minlength="4" required>
      <button class="btn">החלפת סיסמה</button>
    </form>
    <p class="hint">אחרי ההחלפה כל שאר המחוברים מתנתקים.</p>
  </div>
  <div class="card small muted">
    <b>איך זה עובד:</b> כל משתתפת מזוהה לפי מספר הטלפון שלה. בשלוחת העדכון היא שומעת כמה תוספת שבת קיבלה על עצמה עד כה, מקישה כמה דקות היא מקבלת על עצמה ומאשרת, והדקות מצטברות.
    אם כבר עדכנה את מספר הפעמים המותר בפרק הזמן (ברירת המחדל: פעם בשבוע), היא יכולה לשנות את העדכון האחרון (או לבטל אותו בהקשת 0).
    בשלוחת הסכום היא רק שומעת כמה נצבר לה. מספר חסוי לא יכול לעדכן. רשימה אחרת (<span dir="ltr">list=</span>) נותנת ספירה נפרדת לגמרי.
  </div>\`;
  $('#s_per').value = v.per; $('#s_unit').value = v.perUnit;
  const origin = location.origin + BASE;
  const update = () => {
    const c = { max: +$('#s_max').value || 60, times: +$('#s_times').value || 1, per: $('#s_per').value, perN: +$('#s_n').value || 1, perUnit: $('#s_unit').value, edit: $('#s_edit').checked, hours: $('#s_hours').checked, all: $('#s_all').checked };
    store.set('minutes_setup', JSON.stringify(c));
    $('#rollWrap').style.display = c.per === 'rolling' ? '' : 'none';
    // Yemot does not take parameters in api_link: fixed values go in api_add_0, api_add_1 … (numbered from 0, no gaps)
    const common = ['key=' + key, ...(state.list !== 'main' ? ['list=' + state.list] : []), ...(c.hours ? ['hours=1'] : [])];
    const addQ = [...common, 'max=' + c.max, 'times=' + c.times, 'per=' + (c.per === 'rolling' ? c.perN + c.perUnit : c.per), ...(c.edit ? [] : ['edit=no'])];
    const totQ = [...common, ...(c.all ? ['all=1'] : [])];
    const ini = (path, q) => ['type=api', 'api_link=' + origin + path, ...q.map((x, i) => 'api_add_' + i + '=' + x),
      'api_hangup_send=no', 'api_send_webhook_error_link=' + origin + 'file-error/' + key].join('\\n');
    $('#addIni').textContent = ini('add', addQ);
    $('#totalIni').textContent = ini('total', totQ);
  };
  $('#view').oninput = update; $('#view').onchange = update;
  update();
  $('#pwf').onsubmit = async (e) => {
    e.preventDefault();
    try {
      token = (await api('password', { method: 'POST', body: { current: $('#pw_cur').value, next: $('#pw_new').value } })).token;
      store.set('minutes_token', token); e.target.reset(); toast('הסיסמה הוחלפה');
    } catch (err) { alert(err.message); }
  };
  $('#view').onclick = async (e) => {
    const id = e.target.dataset.copy;
    if (id) { try { await navigator.clipboard.writeText($('#' + id).textContent); toast('הועתק'); } catch { toast('לא ניתן להעתיק'); } }
    if (e.target.id === 'rotate') {
      if (!confirm('להחליף את המפתח? הקישורים הקיימים בימות המשיח יפסיקו לעבוד עד שתעדכנו אותם.')) return;
      await api('settings/rotate-key', { method: 'POST' }); toast('המפתח הוחלף'); viewSetup();
    }
  };
}

render();
</script>
</body>
</html>`;
