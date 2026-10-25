import { badRequest, invalid } from './http.js';

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Declarative body parser. Collects every problem before failing, so the UI can mark all fields at once.
 *   const d = fields(body, { partial }).str('name', { required: true, max: 120 }).int('area_id', { nullable: true }).done();
 * In partial mode (PATCH) missing keys are skipped; present keys are validated the same way.
 */
export function fields(body, { partial = false } = {}) {
  const out = {};
  const errors = {};
  const api = {
    _field(key, opts, check) {
      const has = Object.prototype.hasOwnProperty.call(body, key);
      if (!has) {
        if (opts.required && !partial) errors[key] = 'שדה חובה';
        else if (!partial && 'default' in opts) out[key] = opts.default;
        return api;
      }
      const v = body[key];
      if (v === null || v === '') {
        if (opts.nullable) out[key] = null;
        else if (opts.required) errors[key] = 'שדה חובה';
        else if ('empty' in opts) out[key] = opts.empty;
        else errors[key] = 'ערך חסר';
        return api;
      }
      const res = check(v);
      if (typeof res === 'object' && res && 'error' in res) errors[key] = res.error;
      else out[key] = res;
      return api;
    },
    str(key, opts = {}) {
      return api._field(key, { empty: '', ...opts }, (v) => {
        if (typeof v !== 'string') return { error: 'חייב להיות טקסט' };
        const s = v.trim();
        if (!s && opts.required) return { error: 'שדה חובה' };
        if (opts.max && s.length > opts.max) return { error: `עד ${opts.max} תווים` };
        if (opts.min && s.length < opts.min) return { error: `לפחות ${opts.min} תווים` };
        return s;
      });
    },
    email(key, opts = {}) {
      return api._field(key, opts, (v) =>
        typeof v === 'string' && EMAIL_RE.test(v.trim()) && v.length <= 200
          ? v.trim().toLowerCase()
          : { error: 'כתובת מייל לא תקינה' }
      );
    },
    password(key, opts = {}) {
      return api._field(key, opts, (v) =>
        typeof v === 'string' && v.length >= 8 && v.length <= 200 ? v : { error: 'סיסמה של 8 תווים לפחות' }
      );
    },
    int(key, opts = {}) {
      return api._field(key, opts, (v) => {
        const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
        if (!Number.isInteger(n)) return { error: 'חייב להיות מספר שלם' };
        if (opts.min !== undefined && n < opts.min) return { error: `מינימום ${opts.min}` };
        if (opts.max !== undefined && n > opts.max) return { error: `מקסימום ${opts.max}` };
        return n;
      });
    },
    bool(key, opts = {}) {
      return api._field(key, opts, (v) =>
        typeof v === 'boolean' ? v : v === 1 || v === 0 ? v === 1 : { error: 'חייב להיות כן/לא' }
      );
    },
    time(key, opts = {}) {
      return api._field(key, opts, (v) => (typeof v === 'string' && TIME_RE.test(v) ? v : { error: 'שעה בפורמט HH:MM' }));
    },
    oneOf(key, values, opts = {}) {
      return api._field(key, opts, (v) => (values.includes(v) ? v : { error: 'ערך לא חוקי' }));
    },
    ids(key, opts = {}) {
      return api._field(key, opts, (v) => {
        if (!Array.isArray(v) || v.length > 500 || !v.every((x) => Number.isInteger(x) && x > 0)) {
          return { error: 'רשימת מזהים לא תקינה' };
        }
        return [...new Set(v)];
      });
    },
    done() {
      if (Object.keys(errors).length) throw invalid(errors);
      return out;
    },
  };
  return api;
}

export function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== String(value)) throw badRequest('מזהה לא תקין');
  return n;
}

export function queryInt(url, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`פרמטר ${name} לא תקין`);
  return n;
}
