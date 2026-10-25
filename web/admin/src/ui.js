// Shared UI building blocks: icons, buttons, form fields, modal, toasts, confirm dialog, data hooks.
import { ApiError } from './api.js';
import { ALL_DAYS, DAYS, DAY_PRESETS, cx, html, render, useCallback, useEffect, useRef, useState } from './lib.js';

// ------------------------------------------------------------------ icons (inline, 24px grid)
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  building: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  pin: 'M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22M14.1 14.1a3 3 0 1 1-4.2-4.2',
  menu: 'M3 6h18M3 12h18M3 18h18',
  check: 'M5 12l5 5L20 7',
  external: 'M14 3h7v7M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM15.5 7.5l3 3L22 7l-3-3',
};
export const Icon = ({ name, size = 18 }) => html`
  <svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d=${PATHS[name]} />
  </svg>`;

// ------------------------------------------------------------------ basics
export const Button = ({ kind = 'secondary', icon, children, loading, small, disabled, class: c, ...rest }) => html`
  <button type="button" class=${cx('btn', `btn-${kind}`, small && 'btn-sm', !children && 'btn-icon', c)}
          disabled=${loading || disabled} ...${rest}>
    ${loading ? html`<span class="spinner" />` : icon && html`<${Icon} name=${icon} size=${small ? 16 : 18} />`}
    ${children && html`<span>${children}</span>`}
  </button>`;

export const Spinner = ({ label = 'טוען…' }) => html`<div class="loading"><span class="spinner" /> ${label}</div>`;

export const Empty = ({ icon = 'list', title, children }) => html`
  <div class="empty"><div class="empty-icon"><${Icon} name=${icon} size=${28} /></div>
    <div class="empty-title">${title}</div>${children && html`<div class="empty-body">${children}</div>`}</div>`;

export const Badge = ({ tone = 'neutral', children }) => html`<span class=${`badge badge-${tone}`}>${children}</span>`;

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return html`<div class="alert alert-error">
    <span>${error.message}</span>${onRetry && html`<${Button} small onClick=${onRetry}>נסו שוב<//>`}</div>`;
}

/** Progress of a quota: "12 / 50". */
export function Meter({ label, used, max }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 100;
  return html`<div class="meter" title=${`${used} מתוך ${max}`}>
    <div class="meter-top"><span>${label}</span><b dir="ltr">${used} / ${max}</b></div>
    <div class="meter-bar"><div class=${cx('meter-fill', pct >= 100 ? 'full' : pct >= 80 && 'warn')} style=${{ width: pct + '%' }} /></div>
  </div>`;
}

// ------------------------------------------------------------------ form fields
/** `group`: the content is several controls (chips, checkboxes) rather than one input, so it gets a
 *  labelled group instead of a <label> (a label would hijack the name of the first button inside). */
export function Field({ label, error, hint, children, group, class: c }) {
  const body = html`
    ${label && html`<span class="field-label">${label}</span>`}
    ${children}
    ${error ? html`<span class="field-error">${error}</span>` : hint && html`<span class="field-hint">${hint}</span>`}`;
  const cls = cx('field', error && 'has-error', c);
  return group
    ? html`<div class=${cls} role="group" aria-label=${label}>${body}</div>`
    : html`<label class=${cls}>${body}</label>`;
}

export const Input = ({ value, onInput, ...rest }) =>
  html`<input class="input" value=${value ?? ''} onInput=${(e) => onInput(e.currentTarget.value)} ...${rest} />`;

export const TextArea = ({ value, onInput, ...rest }) =>
  html`<textarea class="input" rows="3" value=${value ?? ''} onInput=${(e) => onInput(e.currentTarget.value)} ...${rest} />`;

/** options: [{ value, label }]; value null is shown as the placeholder option. */
export function Select({ value, onChange, options, placeholder, ...rest }) {
  return html`<select class="input" value=${value ?? ''} onChange=${(e) => {
      const v = e.currentTarget.value;
      onChange(v === '' ? null : isNaN(v) ? v : Number(v));
    }} ...${rest}>
    ${placeholder !== undefined && html`<option value="">${placeholder}</option>`}
    ${options.map((o) => html`<option value=${o.value}>${o.label}</option>`)}
  </select>`;
}

export const Toggle = ({ checked, onChange, label, hint }) => html`
  <label class="toggle">
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span class="toggle-track"><span class="toggle-thumb" /></span>
    <span class="toggle-text"><span>${label}</span>${hint && html`<small>${hint}</small>`}</span>
  </label>`;

/** Multi-select as a filterable list of checkboxes. */
export function CheckList({ options, value, onChange, searchable, empty = 'אין אפשרויות' }) {
  const [q, setQ] = useState('');
  const shown = q ? options.filter((o) => o.label.includes(q)) : options;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return html`<div class="checklist">
    ${searchable && options.length > 6 && html`<input class="input input-sm" placeholder="סינון…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />`}
    <div class="checklist-items">
      ${shown.length === 0 && html`<div class="muted small pad">${empty}</div>`}
      ${shown.map((o) => html`<label class="check">
        <input type="checkbox" checked=${value.includes(o.value)} onChange=${() => toggle(o.value)} />
        <span>${o.label}</span>${o.sub && html`<small class="muted">${o.sub}</small>`}</label>`)}
    </div>
  </div>`;
}

export function DaysPicker({ value, onChange }) {
  return html`<div class="days-picker">
    <div class="day-chips">
      ${DAYS.map((d, i) => html`<button type="button" class=${cx('chip', value & (1 << i) && 'on')}
          aria-pressed=${Boolean(value & (1 << i))} onClick=${() => onChange(value ^ (1 << i))}>${d}</button>`)}
    </div>
    <div class="day-presets">
      ${DAY_PRESETS.map((p) => html`<button type="button" class=${cx('link', value === p.mask && 'active')} onClick=${() => onChange(p.mask)}>${p.label}</button>`)}
    </div>
  </div>`;
}

export const DaysBadge = ({ mask }) => html`<span class="days">
  ${DAYS.map((d, i) => html`<i class=${mask & (1 << i) ? 'on' : ''}>${d.replace('׳', '')}</i>`)}</span>`;

export const isAllDays = (mask) => mask === ALL_DAYS;

// ------------------------------------------------------------------ modal
export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    ref.current?.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      prev?.focus?.();
    };
  }, []);
  return html`<div class="modal-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${cx('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" ref=${ref}>
      <header class="modal-head"><h2>${title}</h2><${Button} kind="ghost" icon="close" aria-label="סגירה" onClick=${onClose} /></header>
      <div class="modal-body">${children}</div>
      ${footer && html`<footer class="modal-foot">${footer}</footer>`}
    </div>
  </div>`;
}

/**
 * A modal form bound to an API call. `save(values)` returns a promise; server field errors
 * (422) are shown next to the matching inputs automatically.
 */
export function FormModal({ title, initial, save, onClose, onSaved, children, wide, submitLabel = 'שמירה', danger }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const set = useCallback((key) => (v) => setValues((s) => ({ ...s, [key]: v })), []);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const result = await save(values);
      onSaved?.(result, values);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setMessage(err.message);
      setBusy(false);
    }
  }

  return html`<${Modal} title=${title} onClose=${onClose} wide=${wide}
      footer=${html`${danger}<span class="grow" /><${Button} kind="ghost" onClick=${onClose}>ביטול<//>
        <${Button} kind="primary" loading=${busy} onClick=${submit}>${submitLabel}<//>`}>
    <form onSubmit=${submit} class="form">
      ${message && html`<div class="alert alert-error">${message}</div>`}
      ${children({ values, set, errors, setValues })}
      <button type="submit" hidden />
    </form>
  <//>`;
}

// ------------------------------------------------------------------ toasts & confirm (imperative)
const toastRoot = document.createElement('div');
toastRoot.className = 'toasts';
toastRoot.setAttribute('aria-live', 'polite');
document.body.appendChild(toastRoot);
let toasts = [];
let toastSeq = 0;
const drawToasts = () =>
  render(html`${toasts.map((t) => html`<div key=${t.id} class=${`toast toast-${t.tone}`}>
    ${t.tone === 'success' && html`<${Icon} name="check" />`}<span>${t.text}</span>
    ${t.action && html`<button class="link" onClick=${() => { t.action.run(); dismiss(t.id); }}>${t.action.label}</button>`}
  </div>`)}`, toastRoot);
const dismiss = (id) => { toasts = toasts.filter((t) => t.id !== id); drawToasts(); };

export function toast(text, tone = 'success', action) {
  const id = ++toastSeq;
  toasts = [...toasts.slice(-1), { id, text, tone, action }];
  drawToasts();
  setTimeout(() => dismiss(id), action ? 7000 : 3000);
}
export const toastError = (err) => toast(err?.message || 'שגיאה', 'error');

const confirmRoot = document.createElement('div');
document.body.appendChild(confirmRoot);

/** await confirm({ title, body, confirmLabel, danger, typeToConfirm }) -> boolean */
export function confirm({ title, body, confirmLabel = 'אישור', danger = false, typeToConfirm }) {
  return new Promise((resolve) => {
    const close = (result) => { render(null, confirmRoot); resolve(result); };
    function Dialog() {
      const [typed, setTyped] = useState('');
      const ok = !typeToConfirm || typed.trim() === typeToConfirm;
      return html`<${Modal} title=${title} onClose=${() => close(false)}
          footer=${html`<span class="grow" /><${Button} kind="ghost" onClick=${() => close(false)}>ביטול<//>
            <${Button} kind=${danger ? 'danger' : 'primary'} disabled=${!ok} onClick=${() => close(true)}>${confirmLabel}<//>`}>
        <div class="confirm-body">${body}</div>
        ${typeToConfirm && html`<${Field} label=${`להמשך הקלידו: ${typeToConfirm}`}>
          <${Input} value=${typed} onInput=${setTyped} onKeyDown=${(e) => e.key === 'Enter' && ok && close(true)} /><//>`}
      <//>`;
    }
    render(html`<${Dialog} />`, confirmRoot);
  });
}

// ------------------------------------------------------------------ data hook
/** Loads data from `fn` and exposes { data, error, loading, reload, setData }. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, deps);
  useEffect(() => { load(); }, [load]);
  const setData = useCallback((upd) => setState((s) => ({ ...s, data: typeof upd === 'function' ? upd(s.data) : upd })), []);
  return { ...state, reload: load, setData };
}
