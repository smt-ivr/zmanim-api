// The admin page: one self-contained HTML document (no build, no external files).
// It talks to ./api/ relative to its own address, so it works under any prefix.
// Login by link: <page>?code=<password> logs in and removes the code from the address bar.
// String.raw: backslashes in the page's script stay as written. The page must not contain backticks or "${".
export const PAGE = String.raw`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>תוספת שבת</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%233d4fc4'/%3E%3Cpath d='M16 6c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-3.5 2-6 5-10z' fill='%23ffc94d'/%3E%3Crect x='14.5' y='19' width='3' height='8' rx='1.5' fill='white'/%3E%3C/svg%3E">
<style>
:root{
  --bg:#f3f4f8;--panel:#fff;--panel-2:#f8f9fc;--ink:#171b2c;--ink-2:#3b4258;--muted:#6b7389;--line:#e4e7ef;--line-2:#eef0f5;
  --accent:#3d4fc4;--accent-2:#5566e0;--accent-ink:#fff;--accent-soft:#eceffd;--gold:#c98a0c;--gold-soft:#fff5dc;
  --ok:#14825a;--ok-soft:#e3f6ee;--danger:#c4343d;--danger-soft:#fdecee;--warn:#a96500;--warn-soft:#fff3e0;
  --shadow:0 1px 2px rgba(23,27,44,.05),0 4px 16px rgba(23,27,44,.05);--shadow-lg:0 12px 40px rgba(23,27,44,.18);
  --radius:14px;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#0f1220;--panel:#171b2e;--panel-2:#1c2136;--ink:#e8eaf3;--ink-2:#c3c8da;--muted:#8f97b0;--line:#2a3048;--line-2:#222840;
  --accent:#7d8cff;--accent-2:#97a3ff;--accent-ink:#0d1020;--accent-soft:#232a4d;--gold:#ffc94d;--gold-soft:#3a3018;
  --ok:#4fd6a0;--ok-soft:#173a2f;--danger:#ff7c84;--danger-soft:#3d1d24;--warn:#ffb649;--warn-soft:#3b2c14;
  --shadow:none;--shadow-lg:0 12px 40px rgba(0,0,0,.5);
}}
:root[data-theme=dark]{
  --bg:#0f1220;--panel:#171b2e;--panel-2:#1c2136;--ink:#e8eaf3;--ink-2:#c3c8da;--muted:#8f97b0;--line:#2a3048;--line-2:#222840;
  --accent:#7d8cff;--accent-2:#97a3ff;--accent-ink:#0d1020;--accent-soft:#232a4d;--gold:#ffc94d;--gold-soft:#3a3018;
  --ok:#4fd6a0;--ok-soft:#173a2f;--danger:#ff7c84;--danger-soft:#3d1d24;--warn:#ffb649;--warn-soft:#3b2c14;
  --shadow:none;--shadow-lg:0 12px 40px rgba(0,0,0,.5);
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI","Noto Sans Hebrew",Arial,sans-serif;-webkit-font-smoothing:antialiased}
svg.i{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
button{font:inherit;color:inherit}
input,select,textarea{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;min-width:0;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent);padding:0}
a{color:var(--accent)}

/* layout */
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top-in{max-width:1180px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;margin-inline-end:auto;font-weight:700;font-size:18px}
.brand-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;color:#ffd166;box-shadow:0 4px 12px color-mix(in srgb,var(--accent) 35%,transparent)}
.brand small{display:block;font-weight:500;font-size:12px;color:var(--muted);margin-top:-2px}
.role{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:4px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-weight:600}
.role.manager{background:var(--gold-soft);color:var(--gold)}
.listpick{display:flex;align-items:center;gap:6px}
.listpick select{padding:6px 10px;border-radius:999px;font-size:14px}
.nav{max-width:1180px;margin:0 auto;padding:0 12px;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav button{display:flex;align-items:center;gap:7px;background:none;border:0;padding:10px 14px;border-radius:10px 10px 0 0;color:var(--muted);cursor:pointer;white-space:nowrap;border-bottom:2.5px solid transparent;font-weight:500}
.nav button:hover{color:var(--ink)}
.nav button.on{color:var(--accent);border-bottom-color:var(--accent);font-weight:650}
.nav .count{font-size:11.5px;background:var(--line-2);color:var(--muted);border-radius:999px;padding:0 7px;line-height:18px}
main{max-width:1180px;margin:0 auto;padding:18px 16px 60px}

/* cards & stats */
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:16px}
.card-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line-2);flex-wrap:wrap}
.card-h h3{margin:0;font-size:16px;margin-inline-end:auto;display:flex;align-items:center;gap:8px}
.card-b{padding:16px 18px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:18px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;display:flex;gap:12px;align-items:center;box-shadow:var(--shadow)}
.stat .ico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;flex:none}
.stat .ico svg{width:21px;height:21px}
.stat b{display:block;font-size:24px;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.stat span{color:var(--muted);font-size:13px}
.t-accent{background:var(--accent-soft);color:var(--accent)}.t-gold{background:var(--gold-soft);color:var(--gold)}.t-ok{background:var(--ok-soft);color:var(--ok)}.t-danger{background:var(--danger-soft);color:var(--danger)}
.stat.hero{background:linear-gradient(135deg,var(--accent),var(--accent-2));border-color:transparent;color:#fff}
.stat.hero span{color:rgba(255,255,255,.82)}
.stat.hero .ico{background:rgba(255,255,255,.16);color:#ffd166}

/* period bar */
.period{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px;box-shadow:var(--shadow)}
.period .lbl{display:flex;align-items:center;gap:8px;font-weight:600}
.period select{padding:6px 10px;border-radius:10px;font-size:14px;max-width:100%}
.period.past{border-color:var(--gold);background:var(--gold-soft)}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:8px 13px;cursor:pointer;font-weight:550;white-space:nowrap;transition:background .15s,border-color .15s,transform .05s;text-decoration:none;font-size:14.5px}
.btn:hover{background:var(--panel-2);border-color:color-mix(in srgb,var(--line) 60%,var(--muted))}
.btn:active{transform:translateY(1px)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{background:var(--accent-2);border-color:var(--accent-2)}
.btn.danger{color:var(--danger)}
.btn.danger.solid{background:var(--danger);border-color:var(--danger);color:#fff}
.btn.ghost{background:transparent;border-color:transparent}
.btn.ghost:hover{background:var(--line-2)}
.btn.sm{padding:5px 9px;font-size:13.5px;border-radius:8px}
.btn.icon{padding:7px}
.btn:disabled{opacity:.5;cursor:default}
.link{background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font-weight:550}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.grow{flex:1}
.muted{color:var(--muted)}.small{font-size:13px}
.pos{color:var(--ok)}.neg{color:var(--danger)}
.err{color:var(--danger);min-height:1.4em;font-size:14px}
.hint{font-size:13px;color:var(--muted);margin:6px 0 0}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;border-radius:999px;padding:1px 9px;background:var(--line-2);color:var(--ink-2);font-weight:550;white-space:nowrap}
.chip.danger{background:var(--danger-soft);color:var(--danger)}.chip.ok{background:var(--ok-soft);color:var(--ok)}.chip.gold{background:var(--gold-soft);color:var(--gold)}.chip.accent{background:var(--accent-soft);color:var(--accent)}.chip.warn{background:var(--warn-soft);color:var(--warn)}
.seg{display:inline-flex;background:var(--line-2);border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}
.seg button{border:0;background:none;padding:5px 11px;border-radius:8px;cursor:pointer;color:var(--muted);font-weight:550;font-size:13.5px}
.seg button.on{background:var(--panel);color:var(--ink);box-shadow:var(--shadow)}
.search{position:relative;flex:1;min-width:200px}
.search svg{position:absolute;inset-inline-start:11px;top:50%;transform:translateY(-50%);color:var(--muted)}
.search input{width:100%;padding-inline-start:36px}

/* tables */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:start;padding:10px 14px;border-bottom:1px solid var(--line-2);white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:12.5px;background:var(--panel-2);position:sticky;top:0}
th.sort{cursor:pointer;user-select:none}
th.sort:hover{color:var(--ink)}
th .arr{opacity:.4;font-size:11px}
th.on .arr{opacity:1;color:var(--accent)}
tbody tr:last-child td{border-bottom:0}
td.num{font-variant-numeric:tabular-nums}
tr.click{cursor:pointer}
tr.click:hover td{background:var(--panel-2)}
.phone{direction:ltr;text-align:right;font-variant-numeric:tabular-nums;font-weight:550}
.rank{width:30px;height:24px;border-radius:7px;display:inline-grid;place-items:center;font-size:12.5px;font-weight:700;background:var(--line-2);color:var(--muted)}
.rank.r1{background:#ffe9a8;color:#8a5b00}.rank.r2{background:#e7eaf1;color:#4a5268}.rank.r3{background:#f6dcc6;color:#8a4b1c}
.bar{display:flex;align-items:center;gap:10px;min-width:150px}
.bar b{min-width:48px;font-variant-numeric:tabular-nums}
.bar i{display:block;height:6px;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));opacity:.85}
.bar .track{flex:1;background:var(--line-2);border-radius:99px;overflow:hidden;max-width:160px}
.empty{color:var(--muted);text-align:center;padding:38px 16px}
.empty svg{width:34px;height:34px;opacity:.5;display:block;margin:0 auto 8px}
.pager{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1px solid var(--line-2);font-size:13.5px;color:var(--muted)}

/* forms */
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
label.f{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--muted);font-weight:550}
label.f input,label.f select,label.f textarea{color:var(--ink);font-size:15px;font-weight:400}
label.chk{display:flex;gap:9px;align-items:center;cursor:pointer}
pre{background:var(--panel-2);border:1px solid var(--line-2);border-radius:10px;padding:12px 14px;direction:ltr;text-align:left;overflow-x:auto;margin:8px 0;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--line-2);padding:2px 7px;border-radius:6px;font-size:13.5px}

/* dialogs */
dialog{border:0;border-radius:18px;background:var(--panel);color:var(--ink);padding:0;width:min(720px,calc(100vw - 24px));max-height:88vh;box-shadow:var(--shadow-lg)}
dialog.narrow{width:min(440px,calc(100vw - 24px))}
dialog::backdrop{background:rgba(12,15,30,.45);backdrop-filter:blur(2px)}
dialog[open]{animation:pop .16s ease-out}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.dlg-head{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line-2)}
.dlg-head h2{margin:0;font-size:17px;margin-inline-end:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dlg-body{padding:18px 20px;overflow:auto;max-height:calc(88vh - 64px)}
.dlg-foot{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start;padding:14px 20px;border-top:1px solid var(--line-2);background:var(--panel-2)}
.person-total{display:flex;align-items:baseline;gap:8px;margin:4px 0 14px}
.person-total b{font-size:30px;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
.note-box{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:12px;font-size:14px;margin-bottom:14px}
.note-box.danger{background:var(--danger-soft);color:var(--danger)}
.note-box.info{background:var(--accent-soft);color:var(--ink-2)}
.note-box.gold{background:var(--gold-soft);color:var(--ink-2)}

/* recordings */
.rec{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--line-2)}
.rec:last-child{border-bottom:0}
.rec-text{flex:1;min-width:230px}
.rec-state{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--line-2);color:var(--muted)}
.rec.on .rec-state{background:var(--ok-soft);color:var(--ok)}
.rec.paused .rec-state{background:var(--warn-soft);color:var(--warn)}
.rec-state svg{width:15px;height:15px}
.rec-actions{display:flex;gap:6px;flex-wrap:wrap}
.progress{height:8px;border-radius:99px;background:var(--line-2);overflow:hidden;margin-top:8px}
.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--ok),#4fd6a0)}

/* login */
.login{min-height:100vh;display:grid;place-items:center;padding:16px;background:radial-gradient(1200px 500px at 50% -10%,var(--accent-soft),transparent)}
.login-card{width:min(400px,100%);background:var(--panel);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow-lg);padding:28px}
.login-card .brand-mark{width:52px;height:52px;border-radius:15px;margin-bottom:14px}
.login-card .brand-mark svg{width:26px;height:26px}
.login-card h1{margin:0 0 4px;font-size:22px}
.login-card input{width:100%;font-size:16px;padding:12px 14px;margin:18px 0 10px;text-align:center;letter-spacing:3px}
.login-card .btn{width:100%;padding:12px}

/* toast */
#toast{position:fixed;bottom:22px;left:50%;transform:translate(-50%,12px);background:var(--ink);color:var(--bg);padding:10px 18px;border-radius:12px;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:50;display:flex;gap:8px;align-items:center;box-shadow:var(--shadow-lg);font-weight:550}
#toast.on{opacity:1;transform:translate(-50%,0)}
#toast.bad{background:var(--danger);color:#fff}
.skel{height:14px;border-radius:7px;background:linear-gradient(90deg,var(--line-2),var(--line),var(--line-2));background-size:200% 100%;animation:sk 1.2s infinite linear;margin:12px 0}
@keyframes sk{to{background-position:-200% 0}}
@media (max-width:700px){
  main{padding:12px 10px 50px}.top-in{padding:8px 12px}
  th,td{padding:9px 10px}.hide-sm{display:none}
  .stat b{font-size:19px}.card-h,.card-b{padding-inline:14px}.rec{padding-inline:14px}
  .brand small{display:none}
  .stats{grid-template-columns:1fr 1fr;gap:8px}.stats .hero,.stats .stat:last-child{grid-column:1/-1}
  .stat{padding:11px 12px;gap:10px}.stat .ico{width:34px;height:34px;border-radius:10px}.stat .ico svg{width:18px;height:18px}.stat span{font-size:12px}
  .bar{min-width:0}.bar .track{display:none}
  .card-h .btn{flex:1}
}
</style>
</head>
<body>
<div id="app"></div>
<dialog id="dlg"></dialog>
<dialog id="ask" class="narrow"></dialog>
<div id="toast"></div>
<script>
'use strict';
const BASE = location.pathname.replace(/[^/]*$/, '');
const API = BASE + 'api/';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
const num = (n) => Number(n || 0).toLocaleString('he-IL');
const fmtMin = (n) => num(n) + ' דקות';
const fmtDate = (s) => s ? new Date(s * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
function ago(s) {
  if (!s) return '';
  const d = Math.floor(Date.now() / 1000) - s;
  if (d < 60) return 'עכשיו';
  if (d < 3600) return 'לפני ' + Math.floor(d / 60) + ' דק׳';
  if (d < 86400) return 'לפני ' + Math.floor(d / 3600) + ' שע׳';
  if (d < 86400 * 7) { const n = Math.floor(d / 86400); return n === 1 ? 'אתמול' : 'לפני ' + n + ' ימים'; }
  return fmtDate(s).split(',')[0];
}

const PATHS = {
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.7 5.7l12.6 12.6',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 15V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
  trash: 'M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z',
  flame: 'M12 3c2.5 3.5 5 6 5 9.5a5 5 0 0 1-10 0C7 9 9.5 6.5 12 3zM12 21a2 2 0 0 0 2-2c0-1.5-2-3-2-3s-2 1.5-2 3a2 2 0 0 0 2 2z',
  week: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2',
  today: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  play: 'M7 5l12 7-12 7z', stop: 'M6 6h12v12H6z', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-1.3 3.2M13.2 12.7L4 22M7 19l2 2M9 17l2 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  file: 'M14 3H6v18h12V7zM14 3v4h4', lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
};
const ic = (n, extra = '') => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"' + extra + '><path d="' + PATHS[n] + '"/></svg>';

let token = store.get('minutes_token');
const me = { role: null, manager_set: false };
const isAdmin = () => me.role === 'admin';
const state = { list: store.get('minutes_list') || 'main', tab: store.get('minutes_tab') || 'people', q: '', filter: 'all', sort: 'minutes', dir: -1, page: 0, logBy: 'all', period: 'current' };
const PAGE_SIZE = 50;
const WHO = { phone: ['טלפון', ''], admin: ['מנהל ראשי', 'accent'], manager: ['מנהלת', 'gold'] };

function toast(msg, bad) {
  const t = $('#toast');
  t.className = bad ? 'bad' : '';
  t.innerHTML = ic(bad ? 'x' : 'check') + '<span>' + esc(msg) + '</span>';
  requestAnimationFrame(() => t.classList.add('on'));
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
const fail = (err) => toast(err.message || String(err), true);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && path !== 'login' && path !== 'password') { logout(); throw new Error(data.error || 'יש להתחבר מחדש'); }
  if (!res.ok) throw new Error(data.error || 'שגיאה');
  return data;
}

/** A confirm / form dialog on top of everything: resolves true/false (or the form's values). */
function ask({ title, text = '', ok = 'אישור', danger = false, form = '' }) {
  return new Promise((resolve) => {
    const d = $('#ask');
    d.innerHTML = '<form method="dialog"><div class="dlg-head"><h2>' + esc(title) + '</h2></div><div class="dlg-body">' +
      (text ? '<p style="margin-top:0">' + text + '</p>' : '') + form + '</div>' +
      '<div class="dlg-foot"><button class="btn ' + (danger ? 'danger solid' : 'primary') + '" value="ok">' + esc(ok) + '</button><button class="btn" value="cancel" formnovalidate>ביטול</button></div></form>';
    const f = d.querySelector('form');
    d.onclose = () => {
      if (d.returnValue !== 'ok') return resolve(false);
      resolve(form ? Object.fromEntries(new FormData(f)) : true);
    };
    d.returnValue = '';
    d.showModal();
    const first = d.querySelector('.dlg-body input, .dlg-body select');
    if (first) first.focus();
  });
}

function dialog(title, body, foot = '') {
  const d = $('#dlg');
  d.innerHTML = '<div class="dlg-head"><h2>' + title + '</h2><button class="btn ghost icon" data-close title="סגירה">' + ic('x') + '</button></div><div class="dlg-body">' + body + '</div>' + (foot ? '<div class="dlg-foot">' + foot + '</div>' : '');
  d.querySelector('[data-close]').onclick = () => d.close();
  if (!d.open) d.showModal();
  return d;
}

function logout() { token = null; store.set('minutes_token', null); me.role = null; render(); }

// ------------------------------------------------------------------ login (also by link: ?code=…)
async function loginWith(password) {
  const r = await api('login', { method: 'POST', body: { password } });
  token = r.token; store.set('minutes_token', token); me.role = r.role;
}

async function renderLogin(msg = '') {
  let configured = true;
  try { configured = (await api('status')).configured; } catch {}
  $('#app').innerHTML = '<div class="login"><div class="login-card"><div class="brand-mark">' + ic('flame') + '</div>' +
    '<h1>תוספת שבת</h1><div class="muted">ממשק הניהול של השלוחה</div>' +
    (configured ? '<form id="lf"><input id="pw" type="password" placeholder="סיסמה" autocomplete="current-password" required autofocus inputmode="numeric">' +
      '<button class="btn primary">' + ic('lock') + ' כניסה</button><p class="err" id="le">' + esc(msg) + '</p></form>'
      : '<p class="err">עדיין לא הוגדרה סיסמת ניהול במסד הנתונים.</p>') + '</div></div>';
  const f = $('#lf');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try { await loginWith($('#pw').value); render(); } catch (err) { $('#le').textContent = err.message; btn.disabled = false; }
  };
}

// ------------------------------------------------------------------ shell
const TABS = [
  ['people', 'משתתפות', 'users'],
  ['log', 'היסטוריה', 'history'],
  ['blocked', 'חסומים', 'ban'],
  ['recordings', 'הקלטות', 'mic'],
  ['setup', 'הגדרות', 'sliders'],
];

async function render() {
  if (!token) return renderLogin();
  try { Object.assign(me, await api('me')); } catch (e) { return renderLogin(e.message); }
  if (!isAdmin()) state.list = 'main';
  $('#app').innerHTML =
    '<header class="top"><div class="top-in">' +
    '<div class="brand"><div class="brand-mark">' + ic('flame') + '</div><div>תוספת שבת<small>מעקב אחרי הדקות שהמאזינות מקבלות על עצמן</small></div></div>' +
    (isAdmin() ? '<div class="listpick"><select id="list" title="רשימה"></select><button class="btn sm" id="newList">' + ic('plus') + ' רשימה</button></div>' : '') +
    '<span class="role ' + me.role + '">' + ic(isAdmin() ? 'shield' : 'users') + (isAdmin() ? 'מנהל ראשי' : 'מנהלת הקו') + '</span>' +
    '<button class="btn ghost icon" id="logout" title="יציאה">' + ic('logout') + '</button>' +
    '</div><nav class="nav" id="tabs">' + TABS.map(([k, label, icon]) => '<button data-tab="' + k + '">' + ic(icon) + label + '<span class="count" id="cnt-' + k + '" hidden></span></button>').join('') + '</nav></header>' +
    '<main><div id="period"></div><div class="stats" id="stats">' + '<div class="stat"><div class="skel" style="width:100%"></div></div>'.repeat(4) + '</div><div id="view"></div></main>';
  $('#logout').onclick = async () => { if (await ask({ title: 'יציאה מהממשק', text: 'לצאת מהחשבון בדפדפן הזה?', ok: 'יציאה' })) logout(); };
  if (isAdmin()) {
    $('#newList').onclick = async () => {
      const r = await ask({ title: 'רשימה חדשה', text: 'רשימה נפרדת עם ספירה משלה. בשלוחה מוסיפים לה <code>list=</code> עם השם.', ok: 'יצירה',
        form: '<label class="f">שם הרשימה (אותיות, מספרים, _ או -)<input name="name" required maxlength="40"></label>' });
      if (!r || !r.name) return;
      if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(r.name.trim())) return toast('שם לא תקין: אותיות, מספרים, _ או - בלבד', true);
      setList(r.name.trim());
    };
    $('#list').onchange = (e) => setList(e.target.value);
    await loadLists();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) { state.tab = b.dataset.tab; store.set('minutes_tab', state.tab); showTab(); } };
  showTab();
}

async function loadLists() {
  const lists = await api('lists');
  if (!lists.some((l) => l.list === state.list)) lists.push({ list: state.list });
  $('#list').innerHTML = lists.map((l) => '<option value="' + esc(l.list) + '"' + (l.list === state.list ? ' selected' : '') + '>' + esc(l.list === 'main' ? 'רשימה ראשית' : l.list) + '</option>').join('');
}

function setList(name) { state.list = name; state.page = 0; state.period = 'current'; store.set('minutes_list', name); if (isAdmin()) loadLists(); showTab(); }
const L = () => 'list=' + encodeURIComponent(state.list) + (state.period !== 'current' ? '&period=' + state.period : '');

async function loadStats() {
  const s = await api('summary?' + L());
  $('#stats').innerHTML =
    '<div class="stat hero"><div class="ico">' + ic('flame') + '</div><div><b>' + fmtMin(s.minutes) + '</b><span>' + (state.period === 'all' ? 'סך הכל בכל הזמן' : state.period === 'current' ? 'סך הכל בתקופה הנוכחית' : 'סך הכל בתקופה הזו') + '</span></div></div>' +
    '<div class="stat"><div class="ico t-gold">' + ic('week') + '</div><div><b>' + fmtMin(s.week_minutes) + '</b><span>השבוע · ' + num(s.week_phones) + ' משתתפות</span></div></div>' +
    '<div class="stat"><div class="ico t-ok">' + ic('today') + '</div><div><b>' + fmtMin(s.today_minutes) + '</b><span>היום · ' + num(s.today_phones) + ' משתתפות</span></div></div>' +
    '<div class="stat"><div class="ico t-accent">' + ic('users') + '</div><div><b>' + num(s.phones) + '</b><span>משתתפות · ' + num(s.entries) + ' עדכונים</span></div></div>';
  const c = $('#cnt-blocked'); if (c) { c.textContent = num(s.blocked); c.hidden = !s.blocked; }
}

function showTab() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const view = $('#view'); view.onclick = view.oninput = view.onchange = null;
  stopPlaying();
  loadStats().catch(fail);
  loadPeriods().catch(fail);
  view.innerHTML = '<div class="card"><div class="card-b"><div class="skel" style="width:40%"></div><div class="skel"></div><div class="skel" style="width:80%"></div></div></div>';
  (({ people: viewPeople, log: viewLog, blocked: viewBlocked, recordings: viewRecordings, setup: viewSetup })[state.tab] || viewPeople)()
    .catch((e) => { view.innerHTML = '<div class="card"><div class="card-b err">' + esc(e.message) + '</div></div>'; });
}

// ------------------------------------------------------------------ periods: reset starts the count over (nothing is deleted)
async function loadPeriods() {
  const el = $('#period');
  if (!el) return;
  if (!['people', 'blocked'].includes(state.tab) && state.period === 'current') { el.innerHTML = ''; el.className = ''; }
  const p = await api('periods?list=' + encodeURIComponent(state.list));
  if (!['people', 'blocked'].includes(state.tab) && state.period === 'current') return;
  const range = (from, to) => (from ? fmtDate(from).split(',')[0] : 'ההתחלה') + ' – ' + (to ? fmtDate(to).split(',')[0] : 'היום');
  const opts = '<option value="current">תקופה נוכחית · מאז ' + (p.current.from ? fmtDate(p.current.from).split(',')[0] : 'ההתחלה') + '</option>' +
    p.past.map((x) => '<option value="' + x.id + '">' + range(x.from, x.to) + ' · ' + fmtMin(x.minutes) + (x.note ? ' · ' + esc(x.note) : '') + '</option>').join('') +
    (p.past.length ? '<option value="all">כל הזמן</option>' : '');
  const viewingPast = state.period !== 'current';
  el.className = 'period' + (viewingPast ? ' past' : '');
  el.innerHTML = '<span class="lbl">' + ic('week') + (viewingPast ? 'מוצגת תקופה קודמת' : 'תקופה') + '</span>' +
    '<select id="per_sel">' + opts + '</select><span class="grow"></span>' +
    (viewingPast ? '<button class="btn sm" id="per_back">חזרה לתקופה הנוכחית</button>'
      : '<button class="btn sm" id="per_reset">' + ic('history') + ' איפוס והתחלה מחדש</button>' +
        (p.past.length ? '<button class="btn sm ghost" id="per_undo" title="מבטל את האיפוס האחרון: הסכום חוזר להיות כמו לפניו">ביטול האיפוס האחרון</button>' : ''));
  $('#per_sel').value = state.period;
  $('#per_sel').onchange = (e) => { state.period = e.target.value; state.page = 0; showTab(); };
  const back = $('#per_back'); if (back) back.onclick = () => { state.period = 'current'; showTab(); };
  const reset = $('#per_reset');
  if (reset) reset.onclick = async () => {
    const r = await ask({ title: 'איפוס והתחלה מחדש', ok: 'איפוס', danger: true,
      text: 'הספירה תתחיל מאפס: בשלוחה ובממשק ייספר רק מה שיעודכן מעכשיו, וכל אחת תוכל לעדכן שוב. <b>שום נתון לא נמחק</b>: התקופה שנסגרת (' + fmtMin(p.current.minutes) + ', ' + num(p.current.phones) + ' משתתפות) נשמרת ואפשר לצפות בה מכאן. אפשר גם לבטל את האיפוס.',
      form: '<label class="f">שם לתקופה שנסגרת (לא חובה)<input name="note" maxlength="200" placeholder="למשל: חשוון תשפ״ז"></label>' });
    if (!r) return;
    try { await api('reset', { method: 'POST', body: { list: state.list, note: r.note } }); toast('אופס. הספירה התחילה מחדש'); state.period = 'current'; showTab(); } catch (err) { fail(err); }
  };
  const undo = $('#per_undo');
  if (undo) undo.onclick = async () => {
    const last = p.past[0];
    if (!(await ask({ title: 'ביטול האיפוס האחרון', text: 'האיפוס מ־' + fmtDate(last.to) + ' יבוטל, והתקופה הקודמת (' + fmtMin(last.minutes) + ') תתחבר חזרה לתקופה הנוכחית.', ok: 'ביטול האיפוס' }))) return;
    try { await api('reset?list=' + encodeURIComponent(state.list), { method: 'DELETE' }); toast('האיפוס בוטל'); showTab(); } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------------ people
async function viewPeople() {
  const rows = await api('people?' + L());
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  $('#view').innerHTML =
    '<div class="card"><div class="card-h">' +
    '<div class="search">' + ic('search') + '<input id="q" placeholder="חיפוש לפי טלפון או שם" value="' + esc(state.q) + '"></div>' +
    '<div class="seg" id="flt"><button data-f="all">הכל</button><button data-f="named">עם שם</button><button data-f="blocked">חסומים</button></div>' +
    '<button class="btn primary" id="addManual">' + ic('plus') + ' הוספה ידנית</button>' +
    '<button class="btn" id="importBtn">' + ic('upload') + ' ייבוא</button>' +
    '<button class="btn" id="csv">' + ic('download') + ' לאקסל</button>' +
    '</div><div class="table-wrap" id="ptable"></div><div id="pager"></div></div>';
  const cols = [['rank', '#', false], ['phone', 'טלפון', true], ['name', 'שם', true], ['minutes', 'דקות', true], ['entries', 'עדכונים', true, 'hide-sm'], ['last_at', 'עדכון אחרון', true, 'hide-sm']];
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const draw = () => {
    document.querySelectorAll('#flt button').forEach((b) => b.classList.toggle('on', b.dataset.f === state.filter));
    const q = state.q.trim(), qd = q.replace(/\D/g, '');
    let shown = ranked.filter((r) => (state.filter === 'all' || (state.filter === 'named' ? r.name : r.blocked)) && (!q || (qd && r.phone.includes(qd)) || r.name.includes(q)));
    const k = state.sort, dir = state.dir;
    shown.sort((a, b) => (a[k] > b[k] ? dir : a[k] < b[k] ? -dir : a.rank - b.rank));
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const page = shown.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    $('#ptable').innerHTML = page.length
      ? '<table><thead><tr>' + cols.map(([key, label, sortable, cls]) => '<th class="' + (cls || '') + (sortable ? ' sort' : '') + (k === key ? ' on' : '') + '" data-sort="' + (sortable ? key : '') + '">' + label + (sortable ? ' <span class="arr">' + (k === key ? (dir < 0 ? '▼' : '▲') : '↕') + '</span>' : '') + '</th>').join('') + '</tr></thead><tbody>' +
        page.map((r) => '<tr class="click" data-phone="' + esc(r.phone) + '">' +
          '<td><span class="rank' + (r.rank <= 3 && r.minutes > 0 ? ' r' + r.rank : '') + '">' + r.rank + '</span></td>' +
          '<td class="phone">' + esc(r.phone) + '</td>' +
          '<td>' + (r.name ? esc(r.name) : '<span class="muted">—</span>') + (r.blocked ? ' <span class="chip danger">' + ic('ban', ' style="width:12px;height:12px"') + 'חסום</span>' : '') + '</td>' +
          '<td><div class="bar"><b>' + num(r.minutes) + '</b><div class="track"><i style="width:' + Math.max(2, (r.minutes / max) * 100) + '%"></i></div></div></td>' +
          '<td class="num hide-sm">' + num(r.entries) + '</td>' +
          '<td class="muted small hide-sm" title="' + esc(fmtDate(r.last_at)) + '">' + ago(r.last_at) + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="empty">' + ic('users') + (rows.length ? 'לא נמצאו תוצאות' : 'עדיין אין עדכונים ברשימה זו') + '</div>';
    $('#pager').innerHTML = shown.length > PAGE_SIZE
      ? '<div class="pager"><span>' + num(state.page * PAGE_SIZE + 1) + '–' + num(Math.min(shown.length, (state.page + 1) * PAGE_SIZE)) + ' מתוך ' + num(shown.length) + '</span><span class="row">' +
        '<button class="btn sm" data-pg="-1"' + (state.page ? '' : ' disabled') + '>הקודם</button><button class="btn sm" data-pg="1"' + (state.page < pages - 1 ? '' : ' disabled') + '>הבא</button></span></div>'
      : (shown.length ? '<div class="pager"><span>' + num(shown.length) + ' משתתפות</span></div>' : '');
  };
  draw();
  $('#q').oninput = (e) => { state.q = e.target.value; state.page = 0; draw(); };
  $('#flt').onclick = (e) => { const f = e.target.dataset.f; if (f) { state.filter = f; state.page = 0; draw(); } };
  $('#pager').onclick = (e) => { const p = e.target.dataset.pg; if (p) { state.page += Number(p); draw(); } };
  $('#ptable').onclick = (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th && th.dataset.sort) { const k = th.dataset.sort; state.dir = state.sort === k ? -state.dir : (k === 'phone' || k === 'name' ? 1 : -1); state.sort = k; draw(); return; }
    const tr = e.target.closest('tr[data-phone]'); if (tr) openPerson(tr.dataset.phone);
  };
  $('#addManual').onclick = () => openManual();
  $('#importBtn').onclick = () => openImport();
  $('#csv').onclick = async () => {
    const res = await fetch(API + 'export?' + L(), { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return toast('הייצוא נכשל', true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = 'tosefet-shabbat-' + state.list + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

async function openManual(phone = '') {
  const r = await ask({ title: 'הוספה ידנית', ok: 'הוספה', form:
    '<div class="grid2"><label class="f">טלפון<input name="phone" dir="ltr" inputmode="tel" required value="' + esc(phone) + '"></label>' +
    '<label class="f">דקות (מספר שלילי מפחית)<input name="minutes" type="number" required></label></div>' +
    '<label class="f" style="margin-top:12px">הערה (לא חובה)<input name="note" maxlength="200"></label>' });
  if (!r) return;
  try {
    await api('entries', { method: 'POST', body: { list: state.list, phone: r.phone, minutes: Number(r.minutes), note: r.note } });
    toast('נוסף'); if (phone) openPerson(phone); showTab();
  } catch (err) { fail(err); }
}

async function openPerson(phone) {
  let p;
  try { p = await api('people/' + phone + '?' + L()); } catch (e) { return fail(e); }
  const src = (e) => ({ phone: '<span class="chip">' + ic('phone', ' style="width:12px;height:12px"') + 'טלפון</span>', import: '<span class="chip warn">ייבוא</span>', admin: '<span class="chip accent">ידני</span>' }[e.source] || esc(e.source));
  const d = dialog('<span class="phone">' + esc(phone) + '</span>' + (p.name ? ' <span class="muted" style="font-weight:500">· ' + esc(p.name) + '</span>' : '') + (p.blocked ? ' <span class="chip danger">חסום</span>' : ''),
    (p.blocked ? '<div class="note-box danger">' + ic('ban') + '<div><b>המספר חסום</b> ולא יכול לעדכן בטלפון' + (p.blocked_note ? ' · ' + esc(p.blocked_note) : '') + '</div></div>' : '') +
    '<div class="person-total"><b>' + num(p.minutes) + '</b><span class="muted">דקות תוספת שבת' + (state.period === 'current' ? ' בתקופה הנוכחית' : state.period === 'all' ? '' : ' בתקופה הזו') + ' · ' + num(p.entries.length) + ' עדכונים' + (p.ever !== p.minutes ? ' · בכל הזמן: ' + fmtMin(p.ever) : '') + '</span></div>' +
    '<div class="row" style="margin-bottom:16px"><input id="pname" class="grow" placeholder="שם לזיהוי (נראה רק בממשק)" value="' + esc(p.name) + '" maxlength="80"><button class="btn" id="saveName">' + ic('check') + ' שמירת שם</button></div>' +
    '<div class="card" style="margin:0"><div class="table-wrap">' + (p.entries.length ? '<table><thead><tr><th>מתי</th><th>דקות</th><th>מקור</th><th class="hide-sm">הערה</th><th></th></tr></thead><tbody>' +
      p.entries.map((e) => '<tr data-id="' + e.id + '"><td class="small">' + fmtDate(e.created_at) + (e.updated_at !== e.created_at ? '<div class="muted">שונה ' + fmtDate(e.updated_at) + '</div>' : '') + '</td>' +
        '<td class="num"><b class="' + (e.minutes < 0 ? 'neg' : '') + '">' + num(e.minutes) + '</b></td><td>' + src(e) + '</td><td class="small hide-sm">' + esc(e.note) + '</td>' +
        '<td><span class="row" style="gap:2px;flex-wrap:nowrap"><button class="btn ghost icon sm" data-act="edit" title="עריכה">' + ic('edit') + '</button><button class="btn ghost icon sm danger" data-act="del" title="מחיקה">' + ic('trash') + '</button></span></td></tr>').join('') +
      '</tbody></table>' : '<div class="empty">אין עדכונים</div>') + '</div></div>',
    '<button class="btn primary" id="addFor">' + ic('plus') + ' הוספה</button>' +
    '<button class="btn ' + (p.blocked ? '' : 'danger') + '" id="blockBtn">' + ic('ban') + (p.blocked ? 'ביטול חסימה' : 'חסימה מעדכון') + '</button>' +
    '<span class="grow"></span><button class="btn danger" id="delAll">' + ic('trash') + ' מחיקת כל הנתונים</button>');
  $('#saveName', d).onclick = async () => { try { await api('people/' + phone, { method: 'PUT', body: { list: state.list, name: $('#pname', d).value } }); toast('השם נשמר'); openPerson(phone); showTab(); } catch (e) { fail(e); } };
  $('#addFor', d).onclick = () => openManual(phone);
  $('#blockBtn', d).onclick = async () => {
    try {
      if (p.blocked) {
        if (!(await ask({ title: 'ביטול חסימה', text: 'לבטל את החסימה של <b class="phone">' + esc(phone) + '</b>? המספר יוכל שוב לעדכן דקות בטלפון.', ok: 'ביטול החסימה', danger: true }))) return;
        await api('blocked/' + phone, { method: 'DELETE' }); toast('החסימה בוטלה');
      } else {
        const r = await ask({ title: 'חסימה מעדכון', text: 'המספר <b class="phone">' + esc(phone) + '</b> לא יוכל לעדכן דקות בטלפון. שמיעת הסכום תמשיך לעבוד.', ok: 'חסימה', danger: true,
          form: '<label class="f">סיבה (לא חובה)<input name="note" maxlength="200"></label><label class="chk" style="margin-top:12px"><input type="checkbox" name="del"> למחוק גם את כל הדקות שהמספר עדכן עד עכשיו</label>' });
        if (!r) return;
        await api('blocked', { method: 'POST', body: { phone, note: r.note, delete_entries: r.del === 'on' } }); toast('נחסם');
      }
      openPerson(phone); showTab();
    } catch (err) { fail(err); }
  };
  $('#delAll', d).onclick = async () => {
    if (!(await ask({ title: 'מחיקת כל הנתונים', text: 'למחוק את כל ' + num(p.entries.length) + ' העדכונים (' + fmtMin(p.minutes) + ') של <b class="phone">' + esc(phone) + '</b> ברשימה זו?', ok: 'מחיקה', danger: true }))) return;
    try { await api('people/' + phone + '?' + L(), { method: 'DELETE' }); toast('נמחק'); d.close(); showTab(); } catch (e) { fail(e); }
  };
  const tb = d.querySelector('tbody');
  if (tb) tb.onclick = async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    const id = b.closest('tr').dataset.id;
    const entry = p.entries.find((x) => String(x.id) === id);
    try {
      if (b.dataset.act === 'del') {
        if (!(await ask({ title: 'מחיקת עדכון', text: 'למחוק את העדכון של ' + fmtMin(entry.minutes) + ' מ־' + fmtDate(entry.created_at) + '?', ok: 'מחיקה', danger: true }))) return;
        await api('entries/' + id, { method: 'DELETE' });
      } else {
        const r = await ask({ title: 'עריכת עדכון', ok: 'שמירה', form: '<label class="f">דקות<input name="minutes" type="number" required value="' + entry.minutes + '"></label><label class="f" style="margin-top:12px">הערה<input name="note" maxlength="200" value="' + esc(entry.note || '') + '"></label>' });
        if (!r) return;
        await api('entries/' + id, { method: 'PATCH', body: { minutes: Number(r.minutes), note: r.note } });
      }
      toast('עודכן'); openPerson(phone); loadStats();
    } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------------ import from the old Yemot extension
function openImport() {
  const d = dialog(ic('upload') + ' ייבוא מימות המשיח',
    '<div class="note-box info">' + ic('info') + '<div>מעלים את קובץ ה־JSON של הלוג מהשלוחה הקודמת בימות המשיח. כל שורה נרשמת בשעה המקורית שלה. אפשר לייבא שוב קובץ חדש יותר: שורות שכבר יובאו לא נספרות פעמיים.</div></div>' +
    '<form id="impf" class="grid2">' +
    '<label class="f" style="grid-column:1/-1">קובץ JSON<input type="file" name="file" accept=".json,application/json" required></label>' +
    '<label class="f">לייבא רק מתאריך<input type="date" name="since" value="2026-10-17"></label>' +
    '<label class="f">לא לספור רישום של יותר מ־ (דקות)<input type="number" name="max" min="1" value="10000" required></label>' +
    '<label class="chk"><input type="checkbox" name="skip" checked> לדלג על מספרים חסומים</label>' +
    '<div class="row" style="grid-column:1/-1"><button class="btn primary">' + ic('upload') + ' ייבוא</button><span class="err" id="ie"></span></div></form><div id="ires"></div>');
  $('#impf', d).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#ie', d).textContent = '';
    let rows;
    try {
      const parsed = JSON.parse(await f.get('file').text());
      rows = Array.isArray(parsed) ? parsed : parsed.data;
      if (!Array.isArray(rows)) throw new Error();
    } catch { $('#ie', d).textContent = 'הקובץ אינו לוג JSON של ימות המשיח'; return; }
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'מייבא…';
    try {
      const r = await api('import', { method: 'POST', body: { list: state.list, max: Number(f.get('max')), skip_blocked: f.get('skip') === 'on', since: f.get('since'), rows } });
      $('#ires', d).innerHTML = '<div class="note-box gold" style="margin:14px 0 0">' + ic('check') + '<div><b>יובאו ' + num(r.added) + ' רישומים (' + fmtMin(r.minutes) + ')</b><div class="small muted">מתוך ' + num(r.rows) + ' שורות · לפני התאריך: ' + num(r.before) + ' · כבר יובאו קודם: ' + num(r.already) + ' · מעל המקסימום: ' + num(r.over_max) + ' · ממספרים חסומים: ' + num(r.blocked) + ' · לא תקינות: ' + num(r.invalid) + '</div>' +
        (r.over_max_rows.length ? '<div class="small" style="margin-top:6px">לא נספרו (מעל המקסימום): ' + r.over_max_rows.map((x) => '<span class="phone">' + esc(x.phone) + '</span> ' + esc(x.minutes)).join(' · ') + '</div>' : '') + '</div></div>';
      showTab();
    } catch (err) { $('#ie', d).textContent = err.message; }
    btn.disabled = false; btn.innerHTML = ic('upload') + ' ייבוא';
  };
}

// ------------------------------------------------------------------ blocked numbers
async function viewBlocked() {
  const rows = await api('blocked');
  $('#view').innerHTML =
    '<div class="card"><div class="card-h"><h3>' + ic('ban') + ' מספרים חסומים <span class="chip">' + num(rows.length) + '</span></h3></div><div class="card-b">' +
    '<p class="muted small" style="margin-top:0">מספר חסום לא יכול לעדכן דקות בטלפון (ושומע "לא ניתן לעדכן ממספר טלפון זה"). שמיעת הסכום ממשיכה לעבוד. החסימה חלה על כל הרשימות.</p>' +
    '<form id="bf" class="row"><input name="phone" dir="ltr" inputmode="tel" placeholder="מספר טלפון" required style="width:170px">' +
    '<input name="note" class="grow" placeholder="סיבה (לא חובה)" maxlength="200"><label class="chk small"><input type="checkbox" name="del"> למחוק גם את הדקות שלו</label><button class="btn danger solid">' + ic('ban') + ' חסימה</button></form></div>' +
    (rows.length ? '<div class="table-wrap"><table><thead><tr><th>טלפון</th><th>סיבה</th><th class="hide-sm">דקות שנשארו</th><th class="hide-sm">מתי</th><th></th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td class="phone">' + esc(r.phone) + '</td><td class="small">' + esc(r.note) + '</td><td class="num hide-sm">' + num(r.minutes) + '</td><td class="small muted hide-sm">' + fmtDate(r.created_at) + '</td><td><button class="btn sm" data-unblock="' + esc(r.phone) + '">ביטול חסימה</button></td></tr>').join('') +
      '</tbody></table></div>' : '<div class="empty">' + ic('shield') + 'אין מספרים חסומים</div>') + '</div>';
  $('#bf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (!(await ask({ title: 'חסימה', text: 'לחסום את <b class="phone">' + esc(f.get('phone')) + '</b>' + (f.get('del') === 'on' ? ' <b>ולמחוק את כל הדקות שלו</b>' : '') + '?', ok: 'חסימה', danger: true }))) return;
    try { await api('blocked', { method: 'POST', body: { phone: f.get('phone'), note: f.get('note'), delete_entries: f.get('del') === 'on' } }); toast('נחסם'); showTab(); } catch (err) { fail(err); }
  };
  $('#view').onclick = async (e) => {
    const b = e.target.closest('[data-unblock]'); if (!b) return;
    const p = b.dataset.unblock;
    if (!(await ask({ title: 'ביטול חסימה', text: 'לבטל את החסימה של <b class="phone">' + esc(p) + '</b>? המספר יוכל שוב לעדכן דקות בטלפון.', ok: 'ביטול החסימה', danger: true }))) return;
    try { await api('blocked/' + p, { method: 'DELETE' }); toast('החסימה בוטלה'); showTab(); } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------------ history
async function viewLog() {
  const q = state.logBy === 'all' ? '' : '&by=' + state.logBy;
  const rows = await api('log?' + L() + '&limit=500' + q);
  const act = (r) => ({ add: ['הוספה', 'ok'], edit: ['שינוי', 'accent'], delete: ['מחיקה', 'danger'], import: ['ייבוא', 'warn'], reset: ['איפוס', 'gold'], unreset: ['ביטול איפוס', 'gold'] }[r.action] || [r.action, '']);
  const what = (r) => r.action === 'reset' || r.action === 'unreset' ? '<span class="small">' + (r.action === 'reset' ? 'נסגרה תקופה של ' : 'חזרה תקופה של ') + fmtMin(r.minutes) + ' (' + num(r.before) + ' משתתפות)</span>' : r.action === 'import' ? '<span class="pos">+' + num(r.minutes) + '</span> <span class="small muted">(' + num(r.before) + ' רישומים)</span>'
    : r.action === 'add' ? '<span class="' + (r.minutes < 0 ? 'neg' : 'pos') + '">' + (r.minutes > 0 ? '+' : '') + num(r.minutes) + '</span>'
    : r.action === 'edit' ? num(r.before) + ' ← <b>' + num(r.minutes) + '</b>' : '<span class="neg">−' + num(r.before) + '</span>';
  const who = (by) => { const [t, c] = WHO[by] || [by, '']; return '<span class="chip ' + c + '">' + t + '</span>'; };
  $('#view').innerHTML =
    '<div class="card"><div class="card-h"><h3>' + ic('history') + ' היסטוריה</h3>' +
    '<div class="seg" id="lby"><button data-by="all">הכל</button><button data-by="admin">מנהל ראשי</button><button data-by="manager">מנהלת</button><button data-by="phone">טלפון</button></div>' +
    (isAdmin() ? '<button class="btn sm" id="delMine">' + ic('trash') + ' מחיקת ההיסטוריה שלי</button><button class="btn sm danger" id="delAllLog">' + ic('trash') + ' מחיקת כל ההיסטוריה</button>' : '') +
    '</div><div class="table-wrap">' + (rows.length ? '<table><thead><tr><th>מתי</th><th>טלפון</th><th class="hide-sm">שם</th><th>פעולה</th><th>דקות</th><th>על ידי</th>' + (isAdmin() ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map((r) => { const [a, c] = act(r); return '<tr' + (r.phone ? ' class="click" data-phone="' + esc(r.phone) + '"' : '') + ' data-id="' + r.id + '"><td class="small" title="' + esc(fmtDate(r.at)) + '">' + fmtDate(r.at) + '</td><td class="phone">' + esc(r.phone) + '</td><td class="hide-sm">' + esc(r.name) + '</td><td><span class="chip ' + c + '">' + a + '</span></td><td class="num">' + what(r) + '</td><td>' + who(r.by) + '</td>' +
        (isAdmin() ? '<td><button class="btn ghost icon sm danger" data-del-log="' + r.id + '" title="מחיקת השורה מההיסטוריה">' + ic('x') + '</button></td>' : '') + '</tr>'; }).join('') +
      '</tbody></table>' : '<div class="empty">' + ic('history') + 'אין היסטוריה להצגה</div>') + '</div>' +
    (rows.length >= 500 ? '<div class="pager"><span>מוצגות 500 הפעולות האחרונות</span></div>' : '') + '</div>';
  document.querySelectorAll('#lby button').forEach((b) => b.classList.toggle('on', b.dataset.by === state.logBy));
  $('#lby').onclick = (e) => { const b = e.target.dataset.by; if (b) { state.logBy = b; viewLog().catch(fail); } };
  if (isAdmin()) {
    $('#delMine').onclick = async () => {
      if (!(await ask({ title: 'מחיקת ההיסטוריה שלי', text: 'למחוק מההיסטוריה של הרשימה הזו את כל הפעולות שעשית (מנהל ראשי)? הדקות עצמן לא משתנות.', ok: 'מחיקה', danger: true }))) return;
      try { const r = await api('log?' + L() + '&scope=mine', { method: 'DELETE' }); toast('נמחקו ' + num(r.deleted) + ' שורות'); viewLog(); } catch (e) { fail(e); }
    };
    $('#delAllLog').onclick = async () => {
      if (!(await ask({ title: 'מחיקת כל ההיסטוריה', text: 'למחוק את <b>כל</b> ההיסטוריה של הרשימה הזו (שלך, של המנהלת ושל הטלפון)? הדקות עצמן לא משתנות. אי אפשר לשחזר.', ok: 'מחיקת הכל', danger: true }))) return;
      try { const r = await api('log?' + L() + '&scope=all', { method: 'DELETE' }); toast('נמחקו ' + num(r.deleted) + ' שורות'); viewLog(); } catch (e) { fail(e); }
    };
  }
  $('#view').onclick = async (e) => {
    const del = e.target.closest('[data-del-log]');
    if (del) {
      e.stopPropagation();
      if (!(await ask({ title: 'מחיקת שורה', text: 'למחוק את השורה הזו מההיסטוריה? הדקות עצמן לא משתנות.', ok: 'מחיקה', danger: true }))) return;
      try { await api('log/' + del.dataset.delLog, { method: 'DELETE' }); toast('נמחק'); viewLog(); } catch (err) { fail(err); }
      return;
    }
    const tr = e.target.closest('tr[data-phone]'); if (tr) openPerson(tr.dataset.phone);
  };
}

// ------------------------------------------------------------------ recordings
let playing = null; // { audio, url, btn }
function stopPlaying() { if (playing) { playing.audio.pause(); URL.revokeObjectURL(playing.url); playing.btn.innerHTML = ic('play'); playing = null; } }
let recorder = null; // { rec, key, btn, stream }

async function viewRecordings() {
  const data = await api('recordings');
  const s = data.settings;
  const done = data.items.filter((i) => i.recorded).length;
  const errors = data.items.filter((i) => i.error).length;
  const groups = [...new Set(data.items.map((i) => i.group))];
  const row = (i) => {
    const st = !i.recorded ? 'off' : i.paused ? 'paused' : 'on';
    return '<div class="rec ' + st + '" data-key="' + i.key + '"><span class="rec-state">' + ic(st === 'on' ? 'check' : st === 'paused' ? 'stop' : 'mic') + '</span>' +
      '<div class="rec-text"><b>' + esc(i.text) + '</b><div class="small muted">' + esc(i.where) + (i.recorded && i.updated_at ? ' · הועלה ' + ago(i.updated_at) : '') + '</div>' +
      (i.paused ? '<span class="chip warn">מושהה · נשמע בקול המחשב</span> ' : '') + (i.changed ? '<span class="chip warn">הנוסח השתנה מאז ההעלאה</span> ' : '') +
      (i.error ? '<div class="small neg">ההשמעה בקו נכשלה: ' + esc(i.error) + '</div>' : '') + '</div>' +
      '<div class="rec-actions">' + (i.recorded ? '<button class="btn sm icon" data-act="play" title="השמעה">' + ic('play') + '</button>' : '') +
      '<button class="btn sm" data-act="mic">' + ic('mic') + ' הקלטה</button>' +
      '<button class="btn sm' + (i.recorded ? '' : ' primary') + '" data-act="file">' + ic('upload') + (i.recorded ? ' החלפה' : ' העלאה') + '</button>' +
      (i.recorded ? '<button class="btn sm" data-act="pause">' + (i.paused ? 'הפעלה' : 'השהיה') + '</button><button class="btn sm icon danger" data-act="del" title="מחיקה">' + ic('trash') + '</button>' : '') + '</div></div>';
  };
  $('#view').innerHTML =
    (isAdmin() ? '<div class="card"><div class="card-h"><h3>' + ic('key') + ' חיבור לימות המשיח</h3>' + (s.has_token ? '<span class="chip ok">' + ic('check', ' style="width:12px;height:12px"') + 'יש טוקן שמור · ' + esc(s.token) + '</span>' : '<span class="chip warn">עדיין אין טוקן</span>') + '</div><div class="card-b">' +
      '<p class="muted small" style="margin-top:0">ההקלטות עולות ישר למערכת שלכם בימות המשיח, ומשם מושמעות בשלוחות במקום קול המחשב. משפט שלא הוקלט ממשיך להיקרא בקול המחשב.</p>' +
      '<form id="rs" class="grid2"><label class="f">טוקן של ימות המשיח<input id="r_token" dir="ltr" autocomplete="off" placeholder="' + (s.has_token ? esc(s.token) : 'מספר מערכת:סיסמה, או טוקן') + '"></label>' +
      '<label class="f">תיקייה בימות המשיח (אותיות באנגלית וספרות)<input id="r_folder" dir="ltr" value="' + esc(s.folder) + '"></label>' +
      '<label class="chk"><input type="checkbox" id="r_enabled"' + (s.enabled ? ' checked' : '') + '> להשמיע את ההקלטות בשלוחות</label>' +
      '<label class="chk"><input type="checkbox" id="r_numbers"' + (s.yemot_numbers ? ' checked' : '') + '> מספרים בקול המערכת של ימות המשיח</label>' +
      '<div class="row" style="grid-column:1/-1"><button class="btn primary">' + ic('check') + ' שמירה</button><button class="btn" type="button" id="r_test"' + (s.has_token ? '' : ' disabled') + '>בדיקת החיבור</button></div></form></div></div>'
      : (!s.has_token ? '<div class="note-box info">' + ic('info') + '<div>כדי להעלות הקלטות, המנהל הראשי צריך קודם לחבר את המערכת לימות המשיח.</div></div>' : '')) +
    '<div class="card"><div class="card-b"><div class="row"><b>' + done + ' מתוך ' + data.items.length + ' משפטים הוקלטו</b>' + (errors ? '<span class="chip danger">' + errors + ' נכשלו בהשמעה (הושהו)</span>' : '') + '</div>' +
    '<div class="progress"><i style="width:' + (done / Math.max(1, data.items.length)) * 100 + '%"></i></div></div></div>' +
    groups.map((g) => '<div class="card"><div class="card-h"><h3>' + esc(g) + '</h3></div>' + data.items.filter((i) => i.group === g).map(row).join('') + '</div>').join('') +
    '<input type="file" id="r_file" accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.amr" hidden>';

  if (isAdmin()) {
    $('#rs').onsubmit = async (e) => {
      e.preventDefault();
      const body = { folder: $('#r_folder').value, enabled: $('#r_enabled').checked, yemot_numbers: $('#r_numbers').checked };
      if ($('#r_token').value.trim()) body.token = $('#r_token').value.trim();
      try { await api('recordings/settings', { method: 'PATCH', body }); toast('נשמר'); viewRecordings(); } catch (err) { fail(err); }
    };
    $('#r_test').onclick = async () => { try { await api('recordings/test', { method: 'POST' }); toast('החיבור לימות המשיח תקין'); } catch (err) { fail(err); } };
  }

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
    if (f && pickKey) { try { await send(pickKey, f, f.name); } catch (err) { fail(err); } }
  };
  $('#view').onclick = async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const key = btn.closest('[data-key]').dataset.key;
    const act = btn.dataset.act;
    const needToken = () => { if (!s.has_token) { toast('אין עדיין חיבור לימות המשיח', true); return true; } return false; };
    try {
      if (act === 'file') { if (needToken()) return; pickKey = key; $('#r_file').click(); }
      if (act === 'play') {
        if (playing && playing.btn === btn) return stopPlaying();
        stopPlaying();
        const res = await fetch(API + 'recordings/' + key + '/audio', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'לא ניתן להשמיע');
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        playing = { audio, url, btn };
        audio.onended = stopPlaying;
        btn.innerHTML = ic('stop');
        await audio.play();
      }
      if (act === 'mic') {
        if (recorder && recorder.key === key) { recorder.rec.stop(); return; }
        if (recorder) return toast('יש הקלטה אחרת פעילה', true);
        if (needToken()) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        const chunks = [];
        rec.ondataavailable = (ev) => chunks.push(ev.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          recorder = null;
          btn.innerHTML = ic('mic') + ' הקלטה'; btn.classList.remove('danger', 'solid');
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (!blob.size) return;
          const back = new Audio(URL.createObjectURL(blob));
          back.play().catch(() => {});
          const ok = await ask({ title: 'להעלות את ההקלטה?', text: 'ההקלטה מושמעת עכשיו לבדיקה. אחרי ההעלאה היא תושמע בשלוחה במקום קול המחשב.', ok: 'העלאה' });
          back.pause();
          if (!ok) return;
          try { await send(key, blob, 'recording.' + ((rec.mimeType || '').includes('ogg') ? 'ogg' : (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm')); } catch (err) { fail(err); }
        };
        recorder = { rec, key, btn, stream };
        rec.start();
        btn.innerHTML = ic('stop') + ' סיום'; btn.classList.add('danger', 'solid');
      }
      if (act === 'pause') {
        const paused = btn.textContent.trim() === 'השהיה';
        await api('recordings/' + key, { method: 'PATCH', body: { paused } });
        toast(paused ? 'מושהה: יישמע בקול המחשב' : 'ההקלטה מושמעת שוב'); viewRecordings();
      }
      if (act === 'del') {
        if (!(await ask({ title: 'מחיקת הקלטה', text: 'הקובץ יימחק מימות המשיח והמשפט ייקרא שוב בקול המחשב.', ok: 'מחיקה', danger: true }))) return;
        await api('recordings/' + key, { method: 'DELETE' }); toast('נמחק'); viewRecordings();
      }
    } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------------ settings
async function viewSetup() {
  const { key } = await api('settings');
  const saved = JSON.parse(store.get('minutes_setup') || '{}');
  const v = { max: 60, times: 1, per: 'week', perN: 12, perUnit: 'h', edit: true, showMax: true, say: 'all', ...saved };
  const copyBtn = (id) => '<button class="btn sm" data-copy="' + id + '">' + ic('copy') + ' העתקה</button>';
  $('#view').innerHTML =
    '<div class="card"><div class="card-h"><h3>' + ic('phone') + ' שלוחת עדכון דקות</h3>' + copyBtn('addIni') + '</div><div class="card-b">' +
    '<div class="grid2"><label class="f">כמה דקות לכל היותר בעדכון אחד<input id="s_max" type="number" min="1" max="99999" value="' + v.max + '"></label>' +
    '<label class="f">כמה עדכונים מותרים<input id="s_times" type="number" min="1" max="999" value="' + v.times + '"></label>' +
    '<label class="f">בכל<select id="s_per"><option value="day">יום (לפי התאריך)</option><option value="week">שבוע (מיום ראשון)</option><option value="month">חודש</option><option value="rolling">פרק זמן מתגלגל…</option><option value="ever">בכל הזמן (בלי איפוס)</option></select></label>' +
    '<label class="f" id="rollWrap">פרק הזמן<span class="row"><input id="s_n" type="number" min="1" max="9999" value="' + v.perN + '" style="width:90px"><select id="s_unit"><option value="m">דקות</option><option value="h">שעות</option><option value="d">ימים</option></select></span></label></div>' +
    '<div class="row" style="margin-top:14px;gap:20px"><label class="chk"><input type="checkbox" id="s_edit"' + (v.edit ? ' checked' : '') + '> אפשר לשנות את העדכון האחרון כשהגיעו למגבלה</label>' +
    '<label class="chk"><input type="checkbox" id="s_showmax"' + (v.showMax !== false ? ' checked' : '') + '> להשמיע לפני ההקשה מה המקסימום</label></div>' +
    '<p class="hint">הגדרות השלוחה בימות המשיח:</p><pre id="addIni"></pre></div></div>' +
    '<div class="card"><div class="card-h"><h3>' + ic('flame') + ' שלוחת שמיעת הסכום</h3>' + copyBtn('totalIni') + '</div><div class="card-b">' +
    '<label class="f" style="max-width:380px">מה שומעים<select id="s_say"><option value="all">רק הסכום הכללי של כל המשתתפות</option><option value="both">הסכום הכללי, ואחריו הסכום האישי</option><option value="mine">רק הסכום האישי</option></select></label>' +
    '<pre id="totalIni"></pre></div></div>' +
    (isAdmin()
      ? '<div class="card"><div class="card-h"><h3>' + ic('users') + ' כניסה למנהלת הקו</h3><span class="chip ' + (me.manager_set ? 'ok' : 'warn') + '">' + (me.manager_set ? 'מוגדרת סיסמה' : 'אין סיסמה') + '</span></div><div class="card-b">' +
        '<p class="muted small" style="margin-top:0">עם הסיסמה הזו המנהלת רואה ומנהלת רק את הרשימה הראשית: משתתפות, חסומים, היסטוריה (בלי מחיקה) והקלטות. היא לא רואה את הטוקן של ימות המשיח, לא מחליפה סיסמאות ולא יוצרת רשימות.</p>' +
        '<form id="mpf" class="row"><input name="code" id="mp_code" placeholder="סיסמה חדשה למנהלת" minlength="4" required autocomplete="off" dir="ltr" style="width:220px"><button class="btn primary">' + ic('key') + (me.manager_set ? ' החלפת הסיסמה' : ' קביעת סיסמה') + '</button>' +
        (me.manager_set ? '<button class="btn danger" type="button" id="mp_del">' + ic('trash') + ' ביטול הגישה</button>' : '') + '</form>' +
        '<div id="mp_link"></div><p class="hint">אפשר להיכנס גם בקישור ישיר: כתובת הממשק ואחריה <code dir="ltr">?code=הסיסמה</code>. החלפת הסיסמה מנתקת את המנהלת מכל המכשירים.</p></div></div>' +
        '<div class="card"><div class="card-h"><h3>' + ic('link') + ' מפתח גישה לשלוחות</h3></div><div class="card-b">' +
        '<p class="muted small" style="margin-top:0">המפתח נכלל בהגדרות שלמעלה, ובלעדיו השלוחה חסומה. החלפת המפתח משביתה את ההגדרות הישנות עד שתעדכנו אותן בימות המשיח.</p>' +
        '<div class="row"><code dir="ltr">' + esc(key) + '</code><button class="btn danger sm" id="rotate">החלפת מפתח</button></div></div></div>' +
        '<div class="card"><div class="card-h"><h3>' + ic('lock') + ' הסיסמה הראשית שלך</h3></div><div class="card-b">' +
        '<form id="pwf" class="row"><input id="pw_cur" type="password" placeholder="הסיסמה הנוכחית" autocomplete="current-password" required><input id="pw_new" type="password" placeholder="סיסמה חדשה" autocomplete="new-password" minlength="4" required><button class="btn">החלפת סיסמה</button></form>' +
        '<p class="hint">אחרי ההחלפה כל שאר המחוברים בסיסמה הראשית מתנתקים.</p></div></div>'
      : '') +
    '<div class="card"><div class="card-b small muted"><b style="color:var(--ink)">איך זה עובד:</b> כל משתתפת מזוהה לפי מספר הטלפון שלה. בשלוחת העדכון היא שומעת כמה תוספת שבת קיבלה על עצמה עד כה, מקישה כמה דקות היא מקבלת על עצמה ומאשרת, והדקות מצטברות. ' +
    'אם כבר עדכנה את מספר הפעמים המותר בפרק הזמן (ברירת המחדל: פעם בשבוע), היא יכולה לשנות את העדכון האחרון (או לבטל אותו בהקשת 0). מספר חסוי לא יכול לעדכן.</div></div>';
  $('#s_per').value = v.per; $('#s_unit').value = v.perUnit; $('#s_say').value = v.say || 'all';
  const origin = location.origin + BASE;
  const update = () => {
    const c = { max: +$('#s_max').value || 60, times: +$('#s_times').value || 1, per: $('#s_per').value, perN: +$('#s_n').value || 1, perUnit: $('#s_unit').value, edit: $('#s_edit').checked, showMax: $('#s_showmax').checked, say: $('#s_say').value };
    store.set('minutes_setup', JSON.stringify(c));
    $('#rollWrap').style.display = c.per === 'rolling' ? '' : 'none';
    // Yemot does not take parameters in api_link: fixed values go in api_add_0, api_add_1 … (numbered from 0, no gaps)
    const common = ['key=' + key, ...(state.list !== 'main' ? ['list=' + state.list] : [])];
    const addQ = [...common, 'max=' + c.max, 'times=' + c.times, 'per=' + (c.per === 'rolling' ? c.perN + c.perUnit : c.per), ...(c.edit ? [] : ['edit=no']), ...(c.showMax ? [] : ['show_max=no'])];
    const totQ = [...common, ...(c.say !== 'all' ? ['say=' + c.say] : [])];
    const ini = (path, q) => ['type=api', 'api_link=' + origin + path, ...q.map((x, i) => 'api_add_' + i + '=' + x), 'api_hangup_send=no', 'api_send_webhook_error_link=' + origin + 'file-error/' + key].join('\n');
    $('#addIni').textContent = ini('add', addQ);
    $('#totalIni').textContent = ini('total', totQ);
  };
  $('#view').oninput = (e) => { if (e.target.closest('#mpf, #pwf')) return; update(); };
  $('#view').onchange = $('#view').oninput;
  update();
  if (isAdmin()) {
    $('#pwf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        token = (await api('password', { method: 'POST', body: { current: $('#pw_cur').value, next: $('#pw_new').value } })).token;
        store.set('minutes_token', token); e.target.reset(); toast('הסיסמה הוחלפה');
      } catch (err) { fail(err); }
    };
    $('#mpf').onsubmit = async (e) => {
      e.preventDefault();
      const code = $('#mp_code').value.trim();
      if (me.manager_set && !(await ask({ title: 'החלפת סיסמת המנהלת', text: 'המנהלת תנותק מכל המכשירים ותצטרך להיכנס עם הסיסמה החדשה.', ok: 'החלפה' }))) return;
      try {
        await api('manager-password', { method: 'POST', body: { code } });
        me.manager_set = true; toast('הסיסמה של המנהלת נשמרה');
        const link = location.origin + BASE + '?code=' + encodeURIComponent(code);
        $('#mp_link').innerHTML = '<div class="note-box gold" style="margin:12px 0 0">' + ic('link') + '<div style="min-width:0"><b>קישור כניסה למנהלת:</b><pre id="mpl" style="margin:6px 0">' + esc(link) + '</pre>' + copyBtn('mpl') + '</div></div>';
        e.target.reset();
      } catch (err) { fail(err); }
    };
    const del = $('#mp_del');
    if (del) del.onclick = async () => {
      if (!(await ask({ title: 'ביטול הגישה של המנהלת', text: 'הסיסמה של המנהלת תימחק והיא תנותק מכל המכשירים.', ok: 'ביטול הגישה', danger: true }))) return;
      try { await api('manager-password', { method: 'DELETE' }); me.manager_set = false; toast('הגישה בוטלה'); viewSetup(); } catch (err) { fail(err); }
    };
  }
  $('#view').onclick = async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText($('#' + c.dataset.copy).textContent); toast('הועתק'); } catch { toast('לא ניתן להעתיק', true); } }
    if (e.target.id === 'rotate') {
      if (!(await ask({ title: 'החלפת מפתח', text: 'ההגדרות הקיימות בימות המשיח יפסיקו לעבוד עד שתעדכנו אותן.', ok: 'החלפה', danger: true }))) return;
      try { await api('settings/rotate-key', { method: 'POST' }); toast('המפתח הוחלף'); viewSetup(); } catch (err) { fail(err); }
    }
  };
}

// ------------------------------------------------------------------ start (?code= logs in and is removed from the address bar)
(async () => {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) {
    params.delete('code');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
    try { await loginWith(code); } catch (e) { token = null; store.set('minutes_token', null); return renderLogin(e.message); }
  }
  render();
})();
</script>
</body>
</html>`;
