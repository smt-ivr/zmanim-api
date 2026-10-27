import { h, render } from 'preact';
import htm from 'htm';

export { h, render };
export { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
export const html = htm.bind(h);

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const DAY_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const ALL_DAYS = 127;
export const DAY_PRESETS = [
  { label: 'כל יום', mask: 127 },
  { label: 'א׳-ה׳', mask: 31 },
  { label: 'א׳-ו׳', mask: 63 },
  { label: 'שבת', mask: 64 },
];

export const pluralize = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** Normalizes a search string for matching Hebrew text (ignores spacing and geresh). */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/["'׳״\s-]/g, '');

export const navigate = (path) => { location.hash = path; };

/** "לפני 5 דק׳", "אתמול", "12 בנוב׳" */
export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'לפני שעה' : `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', ...(days > 300 ? { year: 'numeric' } : {}) });
}

export const VIA = { web: 'באתר', phone: 'בטלפון', email: 'במייל' };

/** Recently opened synagogues (this browser), newest first. */
const RECENT_KEY = 'zmanim.recent';
export function recentSynagogues() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
export function rememberSynagogue(s) {
  if (!s?.id) return;
  const list = [{ id: s.id, name: s.name, area_name: s.area_name || '' }, ...recentSynagogues().filter((x) => x.id !== s.id)].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
