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
