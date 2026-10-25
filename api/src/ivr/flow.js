// Management phone line (Yemot HaMashiach API extension). The engine (state, Yemot protocol) is in engine.js.
// Callers are identified by caller ID (users.phone); optionally they must also type their password.
import { actorFor, checkLock, logLoginStatement, recordFailure, verifyPassword } from '../auth.js';
import { all, first, nowIso, run, setClause } from '../db.js';
import { HttpError } from '../http.js';
import { getMinyan, listMinyanim, validateMinyan } from '../minyan.js';
import { INFO_FIELDS, MINYAN_COLUMNS, insertMinyan, parseFields } from '../routes/workspace.js';
import { getSettings } from '../settings.js';
import { normalizePhone } from '../validate.js';
import { callStore, chosenIndex, end, go, goodbye, invalid, listChoice, menu, number, readParams, reply, runCall } from './engine.js';
import { speakMinyan, speakPhone, text } from './yemot.js';

const PASSWORD_LIMIT = { max: 5, window: 30 * 60, lock: 30 * 60 };

// ------------------------------------------------------------------ entry point
export async function handleIvr({ env, request, url }) {
  try {
    const params = await readParams(request, url);
    return reply(await handle(env, params));
  } catch (err) {
    console.error('[ivr]', err?.stack || err);
    return reply(goodbye([text('אירעה תקלה, נסו שוב מאוחר יותר')]));
  }
}

async function handle(env, params) {
  if (params.hangup === 'yes') return runCall(env, params, { ...callStore(env, 'ivr_calls'), screens: SCREENS }, {});
  const key = await first(env, `SELECT value FROM settings WHERE key = 'ivr_key'`);
  if (!key || params.key !== key.value) return goodbye([text('הגישה לשלוחה זו חסומה')]);
  const settings = await getSettings(env);
  if (!settings.manage_phone_enabled) return goodbye([text('שלוחת הניהול סגורה כרגע')]);

  const phone = normalizePhone(params.ApiPhone);
  const user = phone ? await first(env, `SELECT * FROM users WHERE phone = ? AND is_active = 1`, phone) : null;
  if (!user) return goodbye([text('מספר הטלפון שממנו התקשרתם אינו מורשה לנהל את המערכת')]);

  const store = callStore(env, 'ivr_calls', { user_id: user.id });
  const flow = { ...store, screens: SCREENS, start, recover: goSynagogueOrHome };
  return runCall(env, params, flow, { user, actor: await actorFor(env, user), settings, store });
}

async function start(c) {
  await c.store.prune();
  if (c.user.phone_requires_password) return go(c, 'password');
  return welcome(c);
}

async function welcome(c) {
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).bind(nowIso(), c.user.id),
    logLoginStatement(c.env, c.user.id, 'phone', c.user.phone),
  ]);
  c.say.push(text(`שלום ${c.user.name}`));
  return goHome(c);
}

// ------------------------------------------------------------------ helpers
async function synagogue(c) {
  const s = await first(c.env, `SELECT * FROM synagogues WHERE id = ?`, c.state.data.sid);
  if (!s || (c.actor.role !== 'admin' && !c.actor.synagogue_ids.includes(s.id))) throw new HttpError(404, 'NOT_FOUND', 'בית הכנסת לא נמצא');
  return s;
}

async function mySynagogues(c) {
  return c.actor.role === 'admin'
    ? all(c.env, `SELECT id, name FROM synagogues ORDER BY id`)
    : all(c.env, `SELECT s.id, s.name FROM synagogue_managers sm JOIN synagogues s ON s.id = sm.synagogue_id WHERE sm.user_id = ? ORDER BY s.name`, c.user.id);
}

async function goHome(c) {
  if (c.actor.role === 'admin') return go(c, 'home');
  const list = await mySynagogues(c);
  if (list.length === 0) return end(c, 'עדיין לא שויכת לאף בית כנסת. פנו למנהל המערכת');
  if (list.length === 1) return go(c, 'syn', { sid: list[0].id, single: true });
  return go(c, 'home');
}

const goSynagogueOrHome = (c) => (c.state.data.sid ? go(c, 'syn') : goHome(c));

async function allowedPrayers(c, s) {
  return s.restrict_prayers
    ? all(c.env, `SELECT p.* FROM prayers p JOIN synagogue_prayers sp ON sp.prayer_id = p.id WHERE sp.synagogue_id = ? ORDER BY p.sort, p.id`, s.id)
    : all(c.env, `SELECT * FROM prayers ORDER BY sort, id`);
}

/** Anchors the given prayer may use (an anchor without listed prayers fits all). */
async function anchorsFor(c, prayerId) {
  const [anchors, links] = await Promise.all([
    all(c.env, `SELECT id, name FROM anchors ORDER BY sort, id`),
    all(c.env, `SELECT anchor_id, prayer_id FROM anchor_prayers`),
  ]);
  return anchors.filter((a) => {
    const own = links.filter((l) => l.anchor_id === a.id);
    return !own.length || own.some((l) => l.prayer_id === prayerId);
  });
}

/** Admins visible to this caller (a hidden super admin is visible only to himself). */
const visibleAdmins = (c) =>
  all(c.env, `SELECT id, name, phone, is_super FROM users WHERE role = 'admin' AND is_active = 1 ${c.user.is_super ? '' : 'AND NOT (is_super = 1 AND is_hidden = 1)'} ORDER BY is_super DESC, id`);

// ------------------------------------------------------------------ screens
// Each screen: prompt(c) -> ask; handle(c, input) -> ask; back: screen name, null (= hang up) or function.
const SCREENS = {
  password: {
    back: undefined,
    prompt: () => number(['הקישו את הסיסמה שלכם וסולמית'], { min: 1 }),
    async handle(c, input) {
      const key = `phone:${c.user.id}`;
      try { await checkLock(c.env, key); } catch { return end(c, 'יותר מדי ניסיונות שגויים, נסו שוב מאוחר יותר'); }
      if (!(await verifyPassword(input, c.user.password_hash))) {
        await recordFailure(c.env, key, PASSWORD_LIMIT);
        c.state.pwFails = (c.state.pwFails || 0) + 1;
        if (c.state.pwFails >= 3) return end(c, 'סיסמה שגויה');
        c.say.push(text('סיסמה שגויה'));
        return c.screens.password.prompt(c);
      }
      await run(c.env, `DELETE FROM login_attempts WHERE key = ?`, key);
      return welcome(c);
    },
  },

  home: {
    back: null,
    async prompt(c) {
      if (c.actor.role === 'admin') {
        return menu(c, 'תפריט ראשי', [
          ['1', 'כניסה לבית כנסת לפי מספר'], ['2', 'שמיעת רשימת בתי הכנסת'], ['3', 'הוספת בית כנסת'],
          ['4', 'ניהול מנהלי מערכת'], ['5', 'דרישת סיסמה בשיחה'],
        ], { star: false });
      }
      const list = await mySynagogues(c);
      c.state.data.list = list.map((s) => s.id);
      return menu(c, 'בחירת בית כנסת', [...list.slice(0, 8).map((s, i) => [String(i + 1), s.name]), ['9', 'דרישת סיסמה בשיחה']], { star: false });
    },
    async handle(c, input) {
      if (c.actor.role !== 'admin') {
        if (input === '9') return go(c, 'phonePw');
        const sid = c.state.data.list?.[Number(input) - 1];
        return sid ? go(c, 'syn', { sid, single: false }) : invalid(c);
      }
      if (input === '1') return go(c, 'synPick');
      if (input === '2') {
        const list = await mySynagogues(c);
        if (!list.length) c.say.push(text('אין עדיין בתי כנסת'));
        for (const s of list.slice(0, 40)) c.say.push(text(`בית כנסת מספר ${s.id}, ${s.name}`));
        return go(c, 'home');
      }
      if (input === '3') return go(c, 'synNewName');
      if (input === '4') return go(c, 'admins');
      if (input === '5') return go(c, 'phonePw');
      return invalid(c);
    },
  },

  synPick: {
    back: 'home',
    prompt: () => number(['הקישו את מספר בית הכנסת וסולמית. לחזרה הקישו כוכבית']),
    async handle(c, input) {
      const s = await first(c.env, `SELECT id FROM synagogues WHERE id = ?`, Number(input));
      if (!s) { c.say.push(text('בית כנסת לא נמצא')); return go(c, 'synPick'); }
      return go(c, 'syn', { sid: s.id, single: false });
    },
  },

  synNewName: {
    back: 'home',
    prompt: () => ({ voice: true, messages: [text('אמרו את שם בית הכנסת החדש לאחר הצליל')] }),
    handle: (c, input) => go(c, 'synNewConfirm', { newName: input.slice(0, 120) }),
  },
  synNewConfirm: {
    back: 'home',
    prompt: (c) => menu(c, `שם בית הכנסת: ${c.state.data.newName}`, [['1', 'אישור'], ['2', 'אמירה מחדש']]),
    async handle(c, input) {
      if (input === '2') return go(c, 'synNewName');
      if (input !== '1') return invalid(c);
      return go(c, 'synNewArea');
    },
  },
  synNewArea: {
    back: 'home',
    async prompt(c) {
      const areas = await all(c.env, `SELECT id, name FROM areas ORDER BY sort, name`);
      c.state.data.areas = areas.map((a) => a.id);
      if (!areas.length) return { ...menu(c, 'לפני הוספת בית כנסת יש להגדיר אזורים באתר הניהול', []) };
      return listChoice(c, 'בחירת אזור לבית הכנסת', areas, (a) => a.name);
    },
    async handle(c, input) {
      const i = chosenIndex(input, c.state.data.areas);
      if (i === null) return invalid(c);
      const res = await run(c.env, `INSERT INTO synagogues (name, area_id) VALUES (?, ?)`, c.state.data.newName, c.state.data.areas[i]);
      c.say.push(text(`בית הכנסת נוצר, מספרו ${res.meta.last_row_id}`));
      return go(c, 'syn', { sid: res.meta.last_row_id, single: false });
    },
  },

  // -------------------------------------------------------------- inside a synagogue
  syn: {
    back: (c) => (c.state.data.single ? end(c) : goHome(c)),
    async prompt(c) {
      const s = await synagogue(c);
      const items = [['1', 'שמיעת המניינים'], ['2', 'הוספת מניין'], ['3', 'עריכת מניין'], ['4', 'ניהול מיקומים']];
      if (c.actor.role === 'admin') items.push(['5', 'הגדרות בית הכנסת'], ['6', 'מנהלי בית הכנסת']);
      if (c.state.data.single) items.push(['9', 'דרישת סיסמה בשיחה']);
      return menu(c, s.name, items, { star: !c.state.data.single });
    },
    async handle(c, input) {
      const admin = c.actor.role === 'admin';
      switch (input) {
        case '1': {
          const list = await listMinyanim(c.env, c.state.data.sid);
          if (!list.length) c.say.push(text('אין עדיין מניינים'));
          list.forEach((m, i) => c.say.push(text(`מניין ${i + 1}, ${speakMinyan(m)}`)));
          return go(c, 'syn');
        }
        case '2': {
          c.state.data.mode = 'add';
          c.state.data.draft = { days: 127, location_id: null, season_id: null, notes: '', is_active: true };
          return go(c, 'mPrayer');
        }
        case '3': return go(c, 'mEditPick');
        case '4': return go(c, 'locs');
        case '5': return admin ? go(c, 'synSettings') : invalid(c);
        case '6': return admin ? go(c, 'synManagers') : invalid(c);
        case '9': return c.state.data.single ? go(c, 'phonePw') : invalid(c);
        default: return invalid(c);
      }
    },
  },

  // -------------------------------------------------------------- minyan wizard (add / edit)
  mPrayer: {
    back: 'syn',
    async prompt(c) {
      const prayers = await allowedPrayers(c, await synagogue(c));
      c.state.data.prayers = prayers.map((p) => p.id);
      if (!prayers.length) return { ...menu(c, 'לא הוגדרו תפילות', []), empty: true };
      return listChoice(c, 'בחירת תפילה', prayers, (p) => p.name);
    },
    handle(c, input) {
      const i = chosenIndex(input, c.state.data.prayers);
      if (i === null) return invalid(c);
      c.state.data.draft.prayer_id = c.state.data.prayers[i];
      return go(c, 'mKind');
    },
  },
  mKind: {
    back: 'syn',
    async prompt(c) {
      const anchors = await anchorsFor(c, c.state.data.draft.prayer_id);
      if (!anchors.length) return menu(c, 'סוג הזמן', [['1', 'שעה קבועה']]);
      return menu(c, 'סוג הזמן', [['1', 'שעה קבועה'], ['2', 'זמן ביחס לזמני היום, למשל לפני השקיעה']]);
    },
    handle(c, input) {
      if (input === '1') return go(c, 'mTime');
      if (input === '2') return go(c, 'mAnchor');
      return invalid(c);
    },
  },
  mTime: {
    back: 'syn',
    prompt: () => number(['הקישו את השעה בארבע ספרות. לדוגמה, לשבע וחצי הקישו אפס שבע שלוש אפס'], { min: 4, max: 4 }),
    handle(c, input) {
      if (!/^([01]\d|2[0-3])[0-5]\d$/.test(input)) { c.say.push(text('שעה לא תקינה')); return go(c, 'mTime'); }
      Object.assign(c.state.data.draft, { time_kind: 'fixed', time: `${input.slice(0, 2)}:${input.slice(2)}`, anchor_id: null, offset_minutes: null });
      return afterTime(c);
    },
  },
  mAnchor: {
    back: 'syn',
    async prompt(c) {
      const anchors = await anchorsFor(c, c.state.data.draft.prayer_id);
      c.state.data.anchors = anchors.map((a) => a.id);
      return listChoice(c, 'ביחס לאיזה זמן', anchors, (a) => a.name);
    },
    handle(c, input) {
      const i = chosenIndex(input, c.state.data.anchors);
      if (i === null) return invalid(c);
      Object.assign(c.state.data.draft, { time_kind: 'relative', time: null, anchor_id: c.state.data.anchors[i] });
      return go(c, 'mOffset');
    },
  },
  mOffset: {
    back: 'syn',
    prompt: () => number(['הקישו מספר דקות וסולמית. לזמן המדויק הקישו אפס וסולמית'], { max: 3 }),
    handle(c, input) {
      const n = Number(input);
      if (!/^\d{1,3}$/.test(input) || n > 720) return invalid(c);
      c.state.data.draft.offset_minutes = n;
      return n === 0 ? afterTime(c) : go(c, 'mDir');
    },
  },
  mDir: {
    back: 'syn',
    prompt: (c) => menu(c, null, [['1', 'לפני'], ['2', 'אחרי']]),
    handle(c, input) {
      if (input !== '1' && input !== '2') return invalid(c);
      const n = Math.abs(c.state.data.draft.offset_minutes);
      c.state.data.draft.offset_minutes = input === '1' ? -n : n;
      return afterTime(c);
    },
  },
  mDays: {
    back: 'syn',
    prompt: (c) => menu(c, 'באילו ימים', c.settings.shabbat_enabled
      ? [['1', 'כל יום'], ['2', 'ראשון עד חמישי'], ['3', 'ראשון עד שישי'], ['4', 'שבת בלבד'], ['5', 'בחירת ימים']]
      : [['1', 'כל ימות החול'], ['2', 'ראשון עד חמישי'], ['3', 'ראשון עד שישי'], ['5', 'בחירת ימים']]),
    handle(c, input) {
      const masks = c.settings.shabbat_enabled ? { 1: 127, 2: 31, 3: 63, 4: 64 } : { 1: 63, 2: 31, 3: 63 };
      if (input === '5') return go(c, 'mDaysCustom');
      if (!masks[input]) return invalid(c);
      c.state.data.draft.days = masks[input];
      return afterDays(c);
    },
  },
  mDaysCustom: {
    back: 'syn',
    prompt: (c) => number([`הקישו את מספרי הימים ברצף וסולמית. ראשון אחת, שני שתיים, וכן הלאה${c.settings.shabbat_enabled ? ', שבת שבע' : ', שישי שש'}. לדוגמה ראשון שלישי וחמישי, אחת שלוש חמש`], { max: 7 }),
    handle(c, input) {
      if (!(c.settings.shabbat_enabled ? /^[1-7]+$/ : /^[1-6]+$/).test(input)) return invalid(c);
      c.state.data.draft.days = [...input].reduce((m, d) => m | (1 << (Number(d) - 1)), 0);
      return afterDays(c);
    },
  },
  mLoc: {
    back: 'syn',
    async prompt(c) {
      const locs = await all(c.env, `SELECT id, name FROM locations WHERE synagogue_id = ? ORDER BY sort, id`, c.state.data.sid);
      c.state.data.locs = locs.map((l) => l.id);
      return listChoice(c, 'בחירת מיקום', locs, (l) => l.name, { zero: 'ללא מיקום' });
    },
    handle(c, input) {
      const i = chosenIndex(input, c.state.data.locs, { zero: true });
      if (i === null) return invalid(c);
      c.state.data.draft.location_id = i === -1 ? null : c.state.data.locs[i];
      return c.state.data.mode === 'add' ? goSeason(c) : go(c, 'mConfirm');
    },
  },
  mSeason: {
    back: 'syn',
    async prompt(c) {
      const seasons = await all(c.env, `SELECT id, name FROM seasons ORDER BY sort, id`);
      c.state.data.seasons = seasons.map((x) => x.id);
      return listChoice(c, 'בחירת עונה', seasons, (x) => x.name, { zero: 'כל השנה' });
    },
    handle(c, input) {
      const i = chosenIndex(input, c.state.data.seasons, { zero: true });
      if (i === null) return invalid(c);
      c.state.data.draft.season_id = i === -1 ? null : c.state.data.seasons[i];
      return go(c, 'mConfirm');
    },
  },
  mConfirm: {
    back: 'syn',
    async prompt(c) {
      const d = c.state.data.draft;
      const [prayer, anchor, loc, season] = await Promise.all([
        first(c.env, `SELECT name FROM prayers WHERE id = ?`, d.prayer_id),
        d.anchor_id ? first(c.env, `SELECT name FROM anchors WHERE id = ?`, d.anchor_id) : null,
        d.location_id ? first(c.env, `SELECT name FROM locations WHERE id = ?`, d.location_id) : null,
        d.season_id ? first(c.env, `SELECT name FROM seasons WHERE id = ?`, d.season_id) : null,
      ]);
      const summary = speakMinyan({ ...d, prayer_name: prayer?.name, anchor_name: anchor?.name, location_name: loc?.name, season_name: season?.name });
      return menu(c, `המניין: ${summary}`, [['1', 'שמירה'], ['2', 'ביטול']]);
    },
    async handle(c, input) {
      if (input === '2') { c.say.push(text('בוטל')); return go(c, 'syn'); }
      if (input !== '1') return invalid(c);
      const s = await synagogue(c);
      const d = c.state.data.draft;
      if (c.state.data.mode === 'add') {
        await insertMinyan(c.env, s, d);
        c.say.push(text('המניין נשמר'));
      } else {
        const row = await validateMinyan(c.env, s, d);
        const set = setClause(row, MINYAN_COLUMNS);
        await run(c.env, `UPDATE minyanim SET ${set.sql}, updated_at = ? WHERE id = ? AND synagogue_id = ?`, ...set.params, nowIso(), c.state.data.editId, s.id);
        c.say.push(text('המניין עודכן'));
      }
      return go(c, 'syn');
    },
  },

  mEditPick: {
    back: 'syn',
    async prompt(c) {
      const list = await listMinyanim(c.env, c.state.data.sid);
      c.state.data.mins = list.map((m) => m.id);
      if (!list.length) return { ...menu(c, 'אין עדיין מניינים', []) };
      return number(['הקישו את מספר המניין וסולמית. מספרי המניינים מושמעים בשמיעת המניינים. לחזרה הקישו כוכבית']);
    },
    async handle(c, input) {
      const id = c.state.data.mins[Number(input) - 1];
      if (!id) return invalid(c);
      return go(c, 'mEdit', { editId: id });
    },
  },
  mEdit: {
    back: 'syn',
    async prompt(c) {
      const m = await getMinyan(c.env, c.state.data.editId);
      if (!m || m.synagogue_id !== c.state.data.sid) { c.say.push(text('המניין לא נמצא')); return SCREENS.syn.prompt((c.state.screen = 'syn', c)); }
      return menu(c, speakMinyan(m), [
        ['1', 'שינוי שעה'], ['2', 'שינוי ימים'], ['3', 'שינוי מיקום'], ['4', m.is_active ? 'הסתרה מהציבור' : 'הצגה לציבור'],
        ['5', 'שכפול'], ['6', 'מחיקה'],
      ]);
    },
    async handle(c, input) {
      const s = await synagogue(c);
      const m = await first(c.env, `SELECT * FROM minyanim WHERE id = ? AND synagogue_id = ?`, c.state.data.editId, s.id);
      if (!m) return go(c, 'syn');
      c.state.data.mode = 'edit';
      c.state.data.draft = { ...Object.fromEntries(MINYAN_COLUMNS.map((k) => [k, m[k]])), is_active: m.is_active === 1 };
      switch (input) {
        case '1': return go(c, 'mKind');
        case '2': return go(c, 'mDays');
        case '3': return go(c, 'mLoc');
        case '4':
          await run(c.env, `UPDATE minyanim SET is_active = ?, updated_at = ? WHERE id = ?`, m.is_active ? 0 : 1, nowIso(), m.id);
          c.say.push(text(m.is_active ? 'המניין הוסתר מהציבור' : 'המניין מוצג לציבור'));
          return go(c, 'mEdit');
        case '5':
          await insertMinyan(c.env, s, { ...c.state.data.draft });
          c.say.push(text('המניין שוכפל, הוא נוסף לסוף הרשימה'));
          return go(c, 'syn');
        case '6': return go(c, 'mDelete');
        default: return invalid(c);
      }
    },
  },
  mDelete: {
    back: 'mEdit',
    prompt: (c) => menu(c, 'למחיקת המניין', [['1', 'אישור מחיקה'], ['2', 'ביטול']]),
    async handle(c, input) {
      if (input === '1') {
        await run(c.env, `DELETE FROM minyanim WHERE id = ? AND synagogue_id = ?`, c.state.data.editId, c.state.data.sid);
        c.say.push(text('המניין נמחק'));
        return go(c, 'syn');
      }
      return input === '2' ? go(c, 'mEdit') : invalid(c);
    },
  },

  // -------------------------------------------------------------- locations
  locs: {
    back: 'syn',
    async prompt(c) {
      const locs = await all(c.env, `SELECT id, name FROM locations WHERE synagogue_id = ? ORDER BY sort, id`, c.state.data.sid);
      c.state.data.locs = locs.map((l) => l.id);
      const intro = locs.length ? `המיקומים: ${locs.map((l, i) => `${i + 1} ${l.name}`).join(', ')}` : 'אין מיקומים';
      return menu(c, intro, [['1', 'הוספת מיקום'], ['2', 'מחיקת מיקום']]);
    },
    handle(c, input) {
      if (input === '1') return go(c, 'locNewName');
      if (input === '2') return c.state.data.locs.length ? go(c, 'locDelete') : invalid(c);
      return invalid(c);
    },
  },
  locNewName: {
    back: 'locs',
    prompt: () => ({ voice: true, messages: [text('אמרו את שם המיקום לאחר הצליל, לדוגמה היכל ראשי')] }),
    handle: (c, input) => go(c, 'locNewConfirm', { newName: input.slice(0, 80) }),
  },
  locNewConfirm: {
    back: 'locs',
    prompt: (c) => menu(c, `שם המיקום: ${c.state.data.newName}`, [['1', 'אישור'], ['2', 'אמירה מחדש']]),
    async handle(c, input) {
      if (input === '2') return go(c, 'locNewName');
      if (input !== '1') return invalid(c);
      const s = await synagogue(c);
      const { n, top } = await first(c.env, `SELECT COUNT(*) AS n, COALESCE(MAX(sort), 0) AS top FROM locations WHERE synagogue_id = ?`, s.id);
      if (n >= s.max_locations) { c.say.push(text(`הגעתם למכסה של ${s.max_locations} מיקומים`)); return go(c, 'locs'); }
      await run(c.env, `INSERT INTO locations (synagogue_id, name, sort) VALUES (?, ?, ?)`, s.id, c.state.data.newName, top + 10);
      c.say.push(text('המיקום נוסף'));
      return go(c, 'locs');
    },
  },
  locDelete: {
    back: 'locs',
    prompt: () => number(['הקישו את מספר המיקום למחיקה וסולמית. המניינים שבו יישארו בלי מיקום']),
    async handle(c, input) {
      const id = c.state.data.locs[Number(input) - 1];
      if (!id) return invalid(c);
      await run(c.env, `DELETE FROM locations WHERE id = ? AND synagogue_id = ?`, id, c.state.data.sid);
      c.say.push(text('המיקום נמחק'));
      return go(c, 'locs');
    },
  },

  // -------------------------------------------------------------- admin: synagogue settings & managers
  synSettings: {
    back: 'syn',
    async prompt(c) {
      const s = await synagogue(c);
      const open = parseFields(s.editable_fields).length > 0;
      const status = `${s.is_active ? 'מוצג לציבור' : 'מוסתר מהציבור'}, מכסת מניינים ${s.max_minyanim}, מכסת מיקומים ${s.max_locations}, עריכת פרטים על ידי המנהל ${open ? 'פתוחה' : 'חסומה'}`;
      return menu(c, status, [
        ['1', s.is_active ? 'הסתרה מהציבור' : 'הצגה לציבור'], ['2', 'שינוי מכסת מניינים'], ['3', 'שינוי מכסת מיקומים'],
        ['4', open ? 'חסימת עריכת כל הפרטים' : 'פתיחת כל הפרטים לעריכה'], ['5', 'מחיקת בית הכנסת'],
      ]);
    },
    async handle(c, input) {
      if (c.actor.role !== 'admin') return go(c, 'syn');
      const s = await synagogue(c);
      const toggle = async (col) => {
        await run(c.env, `UPDATE synagogues SET ${col} = 1 - ${col}, updated_at = ? WHERE id = ?`, nowIso(), s.id);
        c.say.push(text('עודכן'));
        return go(c, 'synSettings');
      };
      switch (input) {
        case '1': return toggle('is_active');
        case '2': return go(c, 'synLimit', { limitCol: 'max_minyanim' });
        case '3': return go(c, 'synLimit', { limitCol: 'max_locations' });
        case '4': {
          // Phone shortcut: all or nothing. Field-by-field choice is on the website.
          const next = parseFields(s.editable_fields).length ? [] : INFO_FIELDS;
          await run(c.env, `UPDATE synagogues SET editable_fields = ?, updated_at = ? WHERE id = ?`, JSON.stringify(next), nowIso(), s.id);
          c.say.push(text('עודכן'));
          return go(c, 'synSettings');
        }
        case '5': return go(c, 'synDelete');
        default: return invalid(c);
      }
    },
  },
  synLimit: {
    back: 'synSettings',
    prompt: () => number(['הקישו את המכסה החדשה וסולמית'], { max: 4 }),
    async handle(c, input) {
      const n = Number(input);
      const max = c.state.data.limitCol === 'max_minyanim' ? 1000 : 100;
      if (!/^\d+$/.test(input) || n > max) return invalid(c);
      // limitCol comes from our own menu, never from input
      const col = c.state.data.limitCol === 'max_minyanim' ? 'max_minyanim' : 'max_locations';
      await run(c.env, `UPDATE synagogues SET ${col} = ?, updated_at = ? WHERE id = ?`, n, nowIso(), c.state.data.sid);
      c.say.push(text('המכסה עודכנה'));
      return go(c, 'synSettings');
    },
  },
  synDelete: {
    back: 'synSettings',
    prompt: () => number(['מחיקה תמחק גם את כל המניינים והמיקומים. לאישור הקישו שוב את מספר בית הכנסת וסולמית. לביטול הקישו כוכבית']),
    async handle(c, input) {
      if (Number(input) !== c.state.data.sid) { c.say.push(text('המספר לא תואם, המחיקה בוטלה')); return go(c, 'synSettings'); }
      await run(c.env, `DELETE FROM synagogues WHERE id = ?`, c.state.data.sid);
      c.say.push(text('בית הכנסת נמחק'));
      c.state.data.sid = null;
      return go(c, 'home');
    },
  },
  synManagers: {
    back: 'syn',
    async prompt(c) {
      const list = await all(c.env, `SELECT u.id, u.name, u.phone FROM synagogue_managers sm JOIN users u ON u.id = sm.user_id WHERE sm.synagogue_id = ? ORDER BY u.id`, c.state.data.sid);
      c.state.data.mgrs = list.map((u) => u.id);
      const intro = list.length ? [text('המנהלים:'), ...list.flatMap((u, i) => [text(`${i + 1}, ${u.name}`), u.phone && speakPhone(u.phone)])] : [text('אין מנהלים לבית כנסת זה')];
      const m = menu(c, null, [['1', 'הוספת מנהל לפי מספר טלפון'], ['2', 'הסרת מנהל']]);
      return { ...m, messages: [...intro.filter(Boolean), ...m.messages] };
    },
    handle(c, input) {
      if (input === '1') return go(c, 'mgrAdd');
      if (input === '2') return c.state.data.mgrs.length ? go(c, 'mgrRemove') : invalid(c);
      return invalid(c);
    },
  },
  mgrAdd: {
    back: 'synManagers',
    prompt: () => number(['הקישו את מספר הטלפון של המנהל וסולמית'], { min: 9, max: 10 }),
    async handle(c, input) {
      const phone = normalizePhone(input);
      if (!phone) { c.say.push(text('מספר לא תקין')); return go(c, 'mgrAdd'); }
      let u = await first(c.env, `SELECT * FROM users WHERE phone = ?`, phone);
      if (u?.role === 'admin') { c.say.push(text('זהו מנהל מערכת, יש לו כבר גישה לכל בתי הכנסת')); return go(c, 'synManagers'); }
      if (!u) {
        const res = await run(c.env, `INSERT INTO users (name, phone, role) VALUES (?, ?, 'manager')`, `מנהל ${phone}`, phone);
        u = { id: res.meta.last_row_id };
      }
      await run(c.env, `INSERT OR IGNORE INTO synagogue_managers (synagogue_id, user_id) VALUES (?, ?)`, c.state.data.sid, u.id);
      c.say.push(text('המנהל נוסף. הוא יכול להתקשר עכשיו מהטלפון שלו ולנהל את בית הכנסת'));
      return go(c, 'synManagers');
    },
  },
  mgrRemove: {
    back: 'synManagers',
    prompt: () => number(['הקישו את מספר המנהל ברשימה וסולמית']),
    async handle(c, input) {
      const id = c.state.data.mgrs[Number(input) - 1];
      if (!id) return invalid(c);
      await run(c.env, `DELETE FROM synagogue_managers WHERE synagogue_id = ? AND user_id = ?`, c.state.data.sid, id);
      c.say.push(text('המנהל הוסר מבית הכנסת'));
      return go(c, 'synManagers');
    },
  },

  // -------------------------------------------------------------- admin: system admins
  admins: {
    back: 'home',
    async prompt(c) {
      const list = await visibleAdmins(c);
      c.state.data.admins = list.map((u) => u.id);
      const intro = [text('מנהלי המערכת:'), ...list.flatMap((u, i) => [text(`${i + 1}, ${u.name}`), u.phone && speakPhone(u.phone)])];
      const m = menu(c, null, [['1', 'הוספת מנהל מערכת לפי טלפון'], ['2', 'הסרת מנהל מערכת']]);
      return { ...m, messages: [...intro.filter(Boolean), ...m.messages] };
    },
    handle(c, input) {
      if (input === '1') return go(c, 'adminAdd');
      if (input === '2') return go(c, 'adminRemove');
      return invalid(c);
    },
  },
  adminAdd: {
    back: 'admins',
    prompt: () => number(['הקישו את מספר הטלפון וסולמית'], { min: 9, max: 10 }),
    async handle(c, input) {
      const phone = normalizePhone(input);
      if (!phone) { c.say.push(text('מספר לא תקין')); return go(c, 'adminAdd'); }
      const u = await first(c.env, `SELECT id, is_super FROM users WHERE phone = ?`, phone);
      if (u?.is_super) { c.say.push(text('מספר זה כבר מנהל מערכת')); return go(c, 'admins'); }
      if (u) {
        await run(c.env, `UPDATE users SET role = 'admin', is_active = 1, updated_at = ? WHERE id = ?`, nowIso(), u.id);
        await run(c.env, `DELETE FROM synagogue_managers WHERE user_id = ?`, u.id);
      } else {
        await run(c.env, `INSERT INTO users (name, phone, role) VALUES (?, ?, 'admin')`, `מנהל ${phone}`, phone);
      }
      c.say.push(text('מנהל המערכת נוסף'));
      return go(c, 'admins');
    },
  },
  adminRemove: {
    back: 'admins',
    prompt: () => number(['הקישו את מספר המנהל ברשימה וסולמית']),
    async handle(c, input) {
      const id = c.state.data.admins[Number(input) - 1];
      if (!id) return invalid(c);
      if (id === c.user.id) { c.say.push(text('לא ניתן להסיר את עצמך')); return go(c, 'admins'); }
      const target = await first(c.env, `SELECT is_super FROM users WHERE id = ?`, id);
      if (target?.is_super) { c.say.push(text('לא ניתן להסיר את מנהל העל')); return go(c, 'admins'); }
      await run(c.env, `UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?`, nowIso(), id);
      await run(c.env, `DELETE FROM sessions WHERE user_id = ?`, id);
      c.say.push(text('מנהל המערכת הושבת'));
      return go(c, 'admins');
    },
  },

  // -------------------------------------------------------------- "ask my password on calls"
  phonePw: {
    back: (c) => goSynagogueOrHome(c),
    prompt: (c) => c.user.phone_requires_password
      ? menu(c, 'כרגע נדרשת סיסמה בכל שיחה', [['1', 'ביטול דרישת הסיסמה']])
      : number(['כרגע אין דרישת סיסמה בשיחה. כדי לדרוש סיסמה בכל שיחה, הקישו את הסיסמה שלכם וסולמית. זה עובד רק אם הסיסמה מורכבת מספרות. לחזרה הקישו כוכבית']),
    async handle(c, input) {
      if (c.user.phone_requires_password) {
        if (input !== '1') return invalid(c);
        await run(c.env, `UPDATE users SET phone_requires_password = 0 WHERE id = ?`, c.user.id);
        c.user.phone_requires_password = 0;
        c.say.push(text('דרישת הסיסמה בוטלה'));
        return goSynagogueOrHome(c);
      }
      const key = `phone:${c.user.id}`;
      try { await checkLock(c.env, key); } catch { return end(c, 'יותר מדי ניסיונות שגויים, נסו שוב מאוחר יותר'); }
      if (!(await verifyPassword(input, c.user.password_hash))) {
        await recordFailure(c.env, key, PASSWORD_LIMIT);
        c.say.push(text('הסיסמה שגויה. אם הסיסמה שלכם כוללת אותיות, החליפו אותה באתר לסיסמה מספרית'));
        return goSynagogueOrHome(c);
      }
      await run(c.env, `UPDATE users SET phone_requires_password = 1 WHERE id = ?`, c.user.id);
      c.user.phone_requires_password = 1;
      c.say.push(text('מעכשיו תתבקשו להקיש את הסיסמה בכל שיחה'));
      return goSynagogueOrHome(c);
    },
  },
};

// Wizard order: add = prayer, kind, time, days, location, season, confirm. Edit jumps to confirm after the changed part.
const afterTime = (c) => (c.state.data.mode === 'add' ? go(c, 'mDays') : go(c, 'mConfirm'));
const afterDays = (c) => (c.state.data.mode === 'add' ? goLocation(c) : go(c, 'mConfirm'));
async function goLocation(c) {
  const { n } = await first(c.env, `SELECT COUNT(*) AS n FROM locations WHERE synagogue_id = ?`, c.state.data.sid);
  return n ? go(c, 'mLoc') : goSeason(c);
}
async function goSeason(c) {
  const { n } = await first(c.env, `SELECT COUNT(*) AS n FROM seasons`);
  return n ? go(c, 'mSeason') : go(c, 'mConfirm');
}
