// App shell: session bootstrap, hash routing, layout.
import { api, hasToken, onUnauthorized, setToken } from './api.js';
import { cx, html, navigate, recentSynagogues, render, useEffect, useState } from './lib.js';
import { AdminCatalog } from './pages/admin-catalog.js';
import { AdminDashboard } from './pages/admin-dashboard.js';
import { AdminSynagogues } from './pages/admin-synagogues.js';
import { AdminUsers } from './pages/admin-users.js';
import { ChoosePassword, LinkLogin, Login, ResetPassword, googleLoggedOut } from './pages/login.js';
import { Profile } from './pages/profile.js';
import { AdminRegistrations, RegisterPage, VerifyPage } from './pages/registrations.js';
import { SecurityPage } from './pages/security.js';
import { ControlPage } from './pages/control.js';
import { Inbox, MyMessages } from './pages/messages.js';
import { SynagoguePicker, Workspace } from './pages/workspace.js';
import { Avatar, Button, Credit, Icon, Modal, Spinner, SynagogueSearch, toast } from './ui.js';
import { PhoneActivity } from './pages/phone-activity.js';
import { RecordingsPage } from './pages/recordings.js';

// ------------------------------------------------------------------ routing (#/path)
const parseHash = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];

function useRoute() {
  const [path, setPath] = useState(parseHash());
  useEffect(() => {
    const on = () => setPath(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

// ------------------------------------------------------------------ theme
const THEME_KEY = 'zmanim.theme';
function initialTheme() {
  try { return localStorage.getItem(THEME_KEY) || ''; } catch { return ''; }
}
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem(THEME_KEY, t) : localStorage.removeItem(THEME_KEY); } catch { /* ignore */ }
}
applyTheme(initialTheme());
const isDark = () =>
  document.documentElement.dataset.theme === 'dark' ||
  (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

// ------------------------------------------------------------------ app
function App() {
  const path = useRoute();
  const [session, setSession] = useState({ status: hasToken() ? 'loading' : 'anon' }); // loading | anon | ready
  const [menuOpen, setMenuOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  // "/" opens the synagogue switcher (like a search shortcut)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); setPicking(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const [dark, setDark] = useState(isDark());

  async function boot() {
    if (!hasToken()) {
      setSession({ status: 'anon' });
      return;
    }
    try {
      const me = await api.get('/me');
      setSession({ status: 'ready', ...me });
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
      setSession({ status: 'anon' });
    }
  }

  useEffect(() => {
    boot();
    return onUnauthorized(() => {
      setSession({ status: 'anon' });
      toast('ההתחברות פגה, יש להתחבר מחדש', 'error');
    });
  }, []);
  useEffect(() => setMenuOpen(false), [path]);

  const signedIn = (data) => {
    setToken(data.token);
    setSession({ status: 'loading' });
    boot().then(() => navigate('/'));
  };
  const refreshMe = () => api.get('/me').then((me) => setSession((s) => ({ ...s, ...me })));

  // One-time e-mail links work whether or not someone is signed in on this browser.
  const linkToken = new URLSearchParams(location.hash.split('?')[1] || '').get('t');
  if (path === '/link' && linkToken) return html`<${LinkLogin} token=${linkToken} onDone=${signedIn} />`;
  if (path === '/reset' && linkToken) return html`<${ResetPassword} token=${linkToken} onDone=${signedIn} />`;
  if (path === '/verify' && linkToken) return html`<${VerifyPage} token=${linkToken} />`;
  if (path === '/register' && session.status !== 'ready') return html`<${RegisterPage} />`;
  if (session.status === 'loading') return html`<div class="boot"><${Spinner} /></div>`;
  if (session.status === 'anon') return html`<${Login} onDone=${signedIn} />`;

  const { user, synagogues, system } = session;
  const isAdmin = user.role === 'admin';
  const appName = system.name || 'מערכת זמני התפילות';
  const can = (perm) => isAdmin && (user.perms || []).includes(perm);
  document.title = `ניהול · ${appName}`;

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    googleLoggedOut();
    setToken(null);
    setSession({ status: 'anon' });
    navigate('/');
  }
  if (user.must_change_password) return html`<${ChoosePassword} user=${user} onDone=${refreshMe} onLogout=${logout} />`;

  // Resolve page
  let page;
  const sMatch = path.match(/^\/s\/(\d+)/);
  const openSynagogue = sMatch ? Number(sMatch[1]) : !isAdmin && synagogues.length === 1 && path === '/' ? synagogues[0].id : null;
  const messagesOn = system.feedback_enabled || user.is_super;
  if (openSynagogue) page = html`<${Workspace} key=${openSynagogue} id=${openSynagogue} user=${user} system=${system} onChanged=${refreshMe} />`;
  else if (path === '/profile') page = html`<${Profile} user=${user} onChanged=${refreshMe} />`;
  else if ((path === '/messages' || path === '/feedback') && !user.is_super) page = html`<${MyMessages} onRead=${refreshMe} />`;
  else if (user.is_super && (path === '/admin/inbox' || path === '/messages')) page = html`<${Inbox} onRead=${refreshMe} />`;
  else if (user.is_super && path === '/admin/control') page = html`<${ControlPage} onChanged=${refreshMe} />`;
  else if (user.is_super && path === '/admin/recordings') page = html`<${RecordingsPage} />`;
  else if (user.is_super && path === '/admin/security') page = html`<${SecurityPage} />`;
  else if (can('registrations') && path === '/admin/registrations') page = html`<${AdminRegistrations} onChanged=${refreshMe} isSuper=${user.is_super} />`;
  else if (isAdmin && path === '/admin/synagogues') page = html`<${AdminSynagogues} onChanged=${refreshMe} perms=${user.perms} />`;
  else if (isAdmin && path === '/admin/users') page = html`<${AdminUsers} me=${user} system=${system} />`;
  else if (can('phone') && path === '/admin/phone') page = html`<${PhoneActivity} me=${user} />`;
  else if (isAdmin && path === '/admin/catalog') page = html`<${AdminCatalog} perms=${user.perms} />`;
  else if (isAdmin) page = html`<${AdminDashboard} me=${user} system=${system} />`;
  else page = html`<${SynagoguePicker} synagogues=${synagogues} />`;

  const link = (href, icon, label, active, count) => html`
    <a href=${'#' + href} class=${cx('nav-link', active && 'active')}><${Icon} name=${icon} /><span>${label}</span>${count > 0 && html`<b class="nav-count">${count}</b>`}</a>`;
  const multi = isAdmin || synagogues.length > 1;
  const recent = isAdmin ? recentSynagogues().slice(0, 5) : [];

  return html`<div class=${cx('shell', menuOpen && 'menu-open')}>
    <aside class="sidebar">
      <a class="brand" href="#/"><span class="brand-mark"><${Icon} name="clock" /></span><div><b>${appName}</b><small>${isAdmin ? 'ניהול המערכת' : 'ניהול בית הכנסת'}</small></div></a>
      ${multi && html`<button class="switcher" onClick=${() => setPicking(true)}>
        <${Icon} name="search" /><span class="grow">${isAdmin ? 'מעבר לבית כנסת…' : 'בחירת בית כנסת…'}</span><kbd>/</kbd></button>`}
      <nav>
        ${isAdmin && html`
          ${link('/', 'home', 'לוח בקרה', path === '/')}
          ${link('/admin/synagogues', 'building', 'בתי כנסת', path === '/admin/synagogues')}
          ${link('/admin/users', 'users', 'משתמשים', path === '/admin/users')}
          ${user.is_super && link('/admin/inbox', 'chat', 'הודעות', path === '/admin/inbox', system.unread_messages)}
          ${can('registrations') && link('/admin/registrations', 'inbox', 'בקשות הצטרפות', path === '/admin/registrations', system.pending_registrations)}
          ${can('phone') && link('/admin/phone', 'phone', 'פעילות בטלפון', path === '/admin/phone')}
          ${user.is_super && link('/admin/recordings', 'mic', 'הקלטות', path === '/admin/recordings')}
          ${link('/admin/catalog', 'list', 'רשימות והגדרות', path === '/admin/catalog')}
          ${user.is_super && html`
            ${link('/admin/control', 'settings', 'הגדרות מערכת', path === '/admin/control')}
            ${link('/admin/security', 'shield', 'חסימות ונעילות', path === '/admin/security')}`}`}
        ${!isAdmin && html`
          ${synagogues.length > 1 && link('/', 'building', 'בתי הכנסת שלי', path === '/')}
          ${synagogues.slice(0, 30).map((s) => link(`/s/${s.id}`, 'building', s.name, openSynagogue === s.id))}
          ${messagesOn && link('/messages', 'chat', 'הודעות להנהלה', path === '/messages', system.unread_messages)}`}
        ${recent.length > 0 && html`<div class="nav-section">נפתחו לאחרונה</div>
          ${recent.map((s) => link(`/s/${s.id}`, 'building', s.name, openSynagogue === s.id))}`}
      </nav>
      <div class="sidebar-foot">
        <div class="me-row">
          <a href="#/profile" class=${cx('me', path === '/profile' && 'active')}><${Avatar} name=${user.name} size=${30} />
            <span class="grow"><b>${user.name}</b><small>הפרופיל שלי</small></span></a>
          <${Button} kind="ghost" small icon=${dark ? 'sun' : 'moon'} title=${dark ? 'מצב בהיר' : 'מצב כהה'}
            onClick=${() => { applyTheme(dark ? 'light' : 'dark'); setDark(!dark); }} />
          <${Button} kind="ghost" small icon="logout" title="יציאה" onClick=${logout} />
        </div>
        <div class="row foot-links">
          <a href="../" target="_blank" rel="noopener" class="small muted"><${Icon} name="external" size=${14} /> לאתר הציבורי</a>
          <span class="grow" /><${Credit} />
        </div>
      </div>
    </aside>
    <div class="scrim" onClick=${() => setMenuOpen(false)} />
    <main class="main">
      <div class="topbar">
        <${Button} kind="ghost" icon="menu" aria-label="תפריט" onClick=${() => setMenuOpen(true)} />
        <b class="grow topbar-title">${appName}</b>
        ${multi && html`<${Button} kind="ghost" icon="search" aria-label="מעבר לבית כנסת" onClick=${() => setPicking(true)} />`}
      </div>
      ${page}
    </main>
    ${picking && html`<${Modal} title="מעבר לבית כנסת" onClose=${() => setPicking(false)}>
      <${SynagogueSearch} onPick=${(s) => { setPicking(false); navigate(`/s/${s.id}`); }} />
    <//>`}
  </div>`;
}

// Remove the static "loading" placeholder first (it also disarms the load-error watchdog in index.html).
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
