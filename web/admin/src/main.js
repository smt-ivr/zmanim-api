// App shell: session bootstrap, hash routing, layout.
import { api, hasToken, onUnauthorized, setToken } from './api.js';
import { cx, html, navigate, render, useEffect, useState } from './lib.js';
import { AdminCatalog } from './pages/admin-catalog.js';
import { AdminDashboard } from './pages/admin-dashboard.js';
import { AdminSynagogues } from './pages/admin-synagogues.js';
import { AdminUsers } from './pages/admin-users.js';
import { Login } from './pages/login.js';
import { Profile } from './pages/profile.js';
import { ControlPage, Inbox, MyFeedback } from './pages/control.js';
import { SynagoguePicker, Workspace } from './pages/workspace.js';
import { Button, Icon, Spinner, toast } from './ui.js';

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

  if (session.status === 'loading') return html`<div class="boot"><${Spinner} /></div>`;
  if (session.status === 'anon') return html`<${Login} onDone=${signedIn} />`;

  const { user, synagogues, system } = session;
  const isAdmin = user.role === 'admin';

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    setToken(null);
    setSession({ status: 'anon' });
    navigate('/');
  }

  // Resolve page
  let page;
  const sMatch = path.match(/^\/s\/(\d+)/);
  if (sMatch) page = html`<${Workspace} key=${sMatch[1]} id=${Number(sMatch[1])} user=${user} system=${system} onChanged=${refreshMe} />`;
  else if (path === '/profile') page = html`<${Profile} user=${user} onChanged=${refreshMe} />`;
  else if (path === '/feedback') page = html`<${MyFeedback} />`;
  else if (user.is_super && path === '/admin/control') page = html`<${ControlPage} onChanged=${refreshMe} />`;
  else if (user.is_super && path === '/admin/inbox') page = html`<${Inbox} />`;
  else if (isAdmin && path === '/admin/synagogues') page = html`<${AdminSynagogues} onChanged=${refreshMe} />`;
  else if (isAdmin && path === '/admin/users') page = html`<${AdminUsers} me=${user} />`;
  else if (isAdmin && path === '/admin/catalog') page = html`<${AdminCatalog} />`;
  else if (isAdmin) page = html`<${AdminDashboard} />`;
  else if (synagogues.length === 1) {
    page = html`<${Workspace} key=${synagogues[0].id} id=${synagogues[0].id} user=${user} system=${system} onChanged=${refreshMe} />`;
  } else page = html`<${SynagoguePicker} synagogues=${synagogues} />`;

  const link = (href, icon, label, active) => html`
    <a href=${'#' + href} class=${cx('nav-link', active && 'active')}><${Icon} name=${icon} /><span>${label}</span></a>`;

  return html`<div class=${cx('shell', menuOpen && 'menu-open')}>
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><${Icon} name="clock" /></span><div><b>זמני מניינים</b><small>${user.is_super ? 'מנהל על' : isAdmin ? 'מנהל מערכת' : 'מנהל בית כנסת'}</small></div></div>
      <nav>
        ${isAdmin && html`
          <div class="nav-section">ניהול כללי</div>
          ${link('/', 'home', 'לוח בקרה', path === '/')}
          ${link('/admin/synagogues', 'building', 'בתי כנסת', path === '/admin/synagogues')}
          ${link('/admin/users', 'users', 'משתמשים', path === '/admin/users')}
          ${link('/admin/catalog', 'list', 'הגדרות ורשימות', path === '/admin/catalog')}`}
        ${user.is_super && html`
          <div class="nav-section">מנהל על</div>
          ${link('/admin/control', 'settings', 'הגדרות שליטה', path === '/admin/control')}
          ${link('/admin/inbox', 'mail', 'פניות לצוות', path === '/admin/inbox')}`}
        ${synagogues.length > 0 && html`<div class="nav-section">${isAdmin ? 'כניסה לבית כנסת' : 'בתי הכנסת שלי'}</div>
          <div class="nav-scroll">
            ${synagogues.slice(0, isAdmin ? 12 : 100).map((s) => link(`/s/${s.id}`, 'building', s.name, sMatch ? Number(sMatch[1]) === s.id : !isAdmin && synagogues.length === 1 && path === '/'))}
            ${isAdmin && synagogues.length > 12 && html`<a class="nav-link muted" href="#/admin/synagogues"><span>כל בתי הכנסת…</span></a>`}
          </div>`}
      </nav>
      <div class="sidebar-foot">
        <a href="../" class="nav-link" target="_blank" rel="noopener"><${Icon} name="external" /><span>לאתר הציבורי</span></a>
        ${system?.feedback_enabled && !user.is_super && link('/feedback', 'mail', 'פנייה לצוות הפיתוח', path === '/feedback')}
        <a href="#/profile" class=${cx('nav-link', path === '/profile' && 'active')}><${Icon} name="user" /><span>${user.name}</span></a>
        <div class="row gap-sm">
          <${Button} kind="ghost" small icon=${dark ? 'sun' : 'moon'} title=${dark ? 'מצב בהיר' : 'מצב כהה'}
            onClick=${() => { applyTheme(dark ? 'light' : 'dark'); setDark(!dark); }} />
          <${Button} kind="ghost" small icon="logout" onClick=${logout}>יציאה<//>
        </div>
      </div>
    </aside>
    <div class="scrim" onClick=${() => setMenuOpen(false)} />
    <main class="main">
      <div class="topbar"><${Button} kind="ghost" icon="menu" aria-label="תפריט" onClick=${() => setMenuOpen(true)} /><b>זמני מניינים</b></div>
      ${page}
    </main>
  </div>`;
}

// Remove the static "loading" placeholder first (it also disarms the load-error watchdog in index.html).
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
