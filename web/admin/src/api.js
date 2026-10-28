// The only module that knows about HTTP. Everything else calls api.get/post/...
// Default: the admin lives in <site>/admin/ and the API in <site>/api (site = domain root or a prefix like /zmanim/).
export const SITE_ROOT = location.origin + location.pathname.replace(/admin\/[^]*$/, '').replace(/[^/]*$/, '');
export const API_ROOT = (window.ZMANIM_CONFIG?.apiBase || SITE_ROOT).replace(/\/$/, '');
const BASE = API_ROOT + '/api';
const TOKEN_KEY = 'zmanim.token';

let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }

const listeners = new Set();
export const onUnauthorized = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function setToken(t) {
  token = t;
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
export const hasToken = () => Boolean(token);

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || 'שגיאה');
    this.status = status;
    this.code = error.code;
    this.fields = error.fields || {};
  }
}

async function request(method, path, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = body instanceof FormData; // files: the browser sets the multipart type itself
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { message: 'אין חיבור לשרת. בדקו את החיבור לאינטרנט' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data.error);
    if (res.status === 401 && path !== '/auth/login') {
      setToken(null);
      listeners.forEach((fn) => fn(err));
    }
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') location.reload(); // the admin just required a new password: show that screen
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

/** Full address of a file link the API returned (e.g. "api/f/<token>"). */
export const fileUrl = (path) => `${API_ROOT}/${path}`;
