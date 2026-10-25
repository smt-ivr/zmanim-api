// Phone management (Yemot HaMashiach API extension).
//
// Stateless HTTP, stateful call: where the caller is in the menu tree is kept in ivr_calls (by ApiCallId).
// Every prompt reads into a fresh value name s1, s2, s3 ... so Yemot never re-uses an old answer;
// on each request we take the answer to the prompt we asked last (s<step>).
//
// Rule: this endpoint ALWAYS answers with valid Yemot text (HTTP 200). Anything else makes Yemot play
// "system error" to the caller.
import { actorFor, checkLock, hashPassword, recordFailure, verifyPassword } from '../auth.js';
import { all, first, nowIso, nowSec, run, setClause } from '../db.js';
import { HttpError } from '../http.js';
import { getMinyan, listMinyanim, validateMinyan } from '../minyan.js';
import { MINYAN_COLUMNS, insertMinyan } from '../routes/workspace.js';
import { normalizePhone } from '../validate.js';
import { hangup, idListMessage, readDigits, readVoice, speakDays, speakMinyan, speakPhone, text } from './yemot.js';

const PIN_LIMIT = { max: 5, window: 30 * 60, lock: 30 * 60 };

// ------------------------------------------------------------------ entry point
export async function handleIvr({ env, request, url }) {
  try {
    const params = await readParams(request, url);
    return reply(await handle(env, params));
  } catch (err) {
    console.error('[ivr]', err?.stack || err);
    return reply(`${idListMessage([text('אירעה תקלה, נסו שוב מאוחר יותר')])}&${hangup()}`);
  }
}

const reply = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function readParams(request, url) {
  const merged = new URLSearchParams(url.search);
  if (request.method === 'POST') {
    const type = request.headers.get('Content-Type') || '';
    const body = type.includes('json')
      ? new URLSearchParams(Object.entries(await request.json().catch(() => ({}))))
      : new URLSearchParams(await request.text());
    for (const [k, v] of body) merged.append(k, v);
  }
  // Yemot may repeat a key; the last one wins.
  const out = {};
  for (const [k, v] of merged) out[k] = v;
  return out;
}

async function handle(env, params) {
  const key = await first(env, `SELECT value FROM settings WHERE key = 'ivr_key'`);
  if (!key || params.key !== key.value) {
    return `${idListMessage([text('הגישה לשלוחה זו חסומה')])}&${hangup()}`;
  }
  const callId = params.ApiCallId || `phone-${params.ApiPhone}`;
  if (params.hangup === 'yes') {
    await run(env, `DELETE FROM ivr_calls WHERE call_id = ?`, callId);
    return '';
  }

  const phone = normalizePhone(params.ApiPhone);
  const user = phone ? await first(env, `SELECT * FROM users WHERE phone = ? AND is_active = 1`, phone) : null;
  if (!user) {
    return `${idListMessage([text('מספר הטלפון שממנו התקשרתם אינו מורשה לנהל את המערכת')])}&${hangup()}`;
  }

  const row = await first(env, `SELECT * FROM ivr_calls WHERE call_id = ?`, callId);
  let state = row && row.user_id === user.id ? JSON.parse(row.state) : null;
  const c = { env, user, actor: await actorFor(env, user), say: [], state };

  let ask;
  if (!state) {
    await run(env, `DELETE FROM ivr_calls WHERE updated_at < ?`, nowSec() - 86400); // old calls
    c.state = state = { step: 0, screen: null, data: {}, empties: 0 };
    ask = await start(c);
  } else {
    const input = state.step ? params[`s${state.step}`] : undefined;
    if (input === undefined) return state.prompt; // repeated request: ask the same question again
    ask = await answer(c, String(input).trim());
  }

  if (ask.end) {
    await run(env, `DELETE FROM ivr_calls WHERE call_id = ?`, callId);
    return [c.say.length && idListMessage(c.say), hangup()].filter(Boolean).join('&');
  }

  state.step += 1;
  const val = `s${state.step}`;
  const read = ask.voice ? readVoice(ask.messages, val) : readDigits(ask.messages, val, ask.opts);
  const prompt = [c.say.length && idListMessage(c.say), read].filter(Boolean).join('&');
  state.prompt = read; // a repeat does not replay one-time announcements
  await run(
    env,
    `INSERT INTO ivr_calls (call_id, user_id, state, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(call_id) DO UPDATE SET user_id = excluded.user_id, state = excluded.state, updated_at = excluded.updated_at`,
    callId, user.id, JSON.stringify(state), nowSec()
  );
  return prompt;
}

async function start(c) {
  if (c.user.ivr_pin_hash) return go(c, 'pin');
  await run(c.env, `UPDATE users SET last_login_at = ? WHERE id = ?`, nowIso(), c.user.id);
  c.say.push(text(`שלום ${c.user.name}`));
  return goHome(c);
}

async function answer(c, input) {
  const screen = SCREENS[c.state.screen];
  if (input === 'None' || input === '') {
    // No key pressed in time
    if (++c.state.empties >= 3) {
      c.say.push(text('לא התקבלה הקשה, להתראות'));
      return { end: true };
    }
    return screen.prompt(c);
  }
  c.state.empties = 0;
  if (input.includes('*') && screen.back !== undefined) {
    return typeof screen.back === 'function' ? screen.back(c) : screen.back === null ? bye(c) : go(c, screen.back);
  }
  try {
    return await screen.handle(c, input);
  } catch (err) {
    if (err instanceof HttpError) {
      c.say.push(text(err.fields ? Object.values(err.fields).join(', ') : err.message));
      return goSynagogueOrHome(c);
    }
    throw err;
  }
}

// ------------------------------------------------------------------ helpers
function go(c, name, data) {
  c.state.screen = name;
  if (data) Object.assign(c.state.data, data);
  return SCREENS[name].prompt(c);
}

const bye = (c) => (c.say.push(text('להתראות')), { end: true });
const invalid = (c) => (c.say.push(text('הקשה לא חוקית')), SCREENS[c.state.screen].prompt(c));

/** Single-key menu. items: [[digit, label], ...] -> "ל<label> הקישו <digit>" */
function menu(c, intro, items, { star = true } = {}) {
  const parts = [...(intro ? [text(intro)] : []), ...items.map(([d, label]) => text(`ל${label} הקישו ${d}`))];
  if (star) parts.push(text('לחזרה הקישו כוכבית'));
  return { messages: parts, opts: { max: 1, min: 1 } };
}

/** Free number ending with #. */
const number = (messages, { min = 1, max = '' } = {}) => ({ messages: messages.map((m) => (typeof m === 'string' ? text(m) : m)), opts: { min, max } });

const pick = (input, items) => items.find(([d]) => d === input);

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
  if (list.length === 0) {
    c.say.push(text('עדיין לא שויכת לאף בית כנסת. פנו למנהל המערכת'));
    return { end: true };
  }
  if (list.length === 1) return go(c, 'syn', { sid: list[0].id, single: true });
  return go(c, 'home');
}

const goSynagogueOrHome = (c) => (c.state.data.sid ? go(c, 'syn') : goHome(c));

async function allowedPrayers(c, s) {
  return s.restrict_prayers
    ? all(c.env, `SELECT p.* FROM prayers p JOIN synagogue_prayers sp ON sp.prayer_id = p.id WHERE sp.synagogue_id = ? ORDER BY p.sort, p.id`, s.id)
    : all(c.env, `SELECT * FROM prayers ORDER BY sort, id`);
}

/** Options 1..n for a list (single key up to 9 items, otherwise number + #). */
function listChoice(c, intro, rows, label, { zero } = {}) {
  const items = rows.map((r, i) => [String(i + 1), label(r)]);
  if (zero) items.unshift(['0', zero]);
  if (items.length <= 10) return menu(c, intro, items);
  return number([intro, ...items.map(([d, l]) => `${l} ${d}`), 'הקישו את המספר וסולמית']);
}
const chosenIndex = (input, rows, { zero } = {}) => {
  if (zero && input === '0') return -1;
  const i = Number(input) - 1;
  return Number.isInteger(i) && i >= 0 && i < rows.length ? i : null;
};

// ------------------------------------------------------------------ screens
// Each screen: prompt(c) -> ask; handle(c, input) -> ask; back: screen name, null (= hang up) or function.
const SCREENS = {
  pin: {
    back: undefined,
    prompt: () => number(['הקישו את הקוד האישי וסולמית'], { min: 1 }),
    async handle(c, input) {
      const key = `pin:${c.user.id}`;
      try { await checkLock(c.env, key); } catch { c.say.push(text('יותר מדי ניסיונות שגויים, נסו מאוחר יותר')); return { end: true }; }
      if (!(await verifyPassword(input, c.user.ivr_pin_hash))) {
        await recordFailure(c.env, key, PIN_LIMIT);
        c.state.pinFails = (c.state.pinFails || 0) + 1;
        if (c.state.pinFails >= 3) { c.say.push(text('קוד שגוי, להתראות')); return { end: true }; }
        c.say.push(text('קוד שגוי'));
        return SCREENS.pin.prompt(c);
      }
      await run(c.env, `DELETE FROM login_attempts WHERE key = ?`, key);
      c.say.push(text(`שלום ${c.user.name}`));
      return goHome(c);
    },
  },

  home: {
    back: null,
    async prompt(c) {
      if (c.actor.role === 'admin') {
        return menu(c, 'תפריט ראשי', [
          ['1', 'כניסה לבית כנסת לפי מספר'], ['2', 'שמיעת רשימת בתי הכנסת'], ['3', 'הוספת בית כנסת'],
          ['4', 'ניהול מנהלי מערכת'], ['5', 'הגדרת קוד אישי'],
        ], { star: false });
      }
      const list = await mySynagogues(c);
      c.state.data.list = list.map((s) => s.id);
      return menu(c, 'בחירת בית כנסת', [...list.slice(0, 8).map((s, i) => [String(i + 1), s.name]), ['9', 'הגדרת קוד אישי']], { star: false });
    },
    async handle(c, input) {
      if (c.actor.role !== 'admin') {
        if (input === '9') return go(c, 'pinSet');
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
      if (input === '5') return go(c, 'pinSet');
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
      const res = await run(c.env, `INSERT INTO synagogues (name) VALUES (?)`, c.state.data.newName);
      c.say.push(text(`בית הכנסת נוצר, מספרו ${res.meta.last_row_id}`));
      return go(c, 'syn', { sid: res.meta.last_row_id, single: false });
    },
  },

  // -------------------------------------------------------------- inside a synagogue
  syn: {
    back: (c) => (c.state.data.single ? bye(c) : goHome(c)),
    async prompt(c) {
      const s = await synagogue(c);
      const items = [['1', 'שמיעת המניינים'], ['2', 'הוספת מניין'], ['3', 'עריכת מניין'], ['4', 'ניהול מיקומים']];
      if (c.actor.role === 'admin') items.push(['5', 'הגדרות בית הכנסת'], ['6', 'מנהלי בית הכנסת']);
      if (c.state.data.single) items.push(['9', 'הגדרת קוד אישי']);
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
        case '9': return c.state.data.single ? go(c, 'pinSet') : invalid(c);
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
      const anchors = await all(c.env, `SELECT id FROM anchors`);
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
      const anchors = await all(c.env, `SELECT * FROM anchors ORDER BY sort, id`);
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
    prompt: (c) => menu(c, 'באילו ימים', [['1', 'כל יום'], ['2', 'ראשון עד חמישי'], ['3', 'ראשון עד שישי'], ['4', 'שבת בלבד'], ['5', 'בחירת ימים']]),
    handle(c, input) {
      const masks = { 1: 127, 2: 31, 3: 63, 4: 64 };
      if (input === '5') return go(c, 'mDaysCustom');
      if (!masks[input]) return invalid(c);
      c.state.data.draft.days = masks[input];
      return afterDays(c);
    },
  },
  mDaysCustom: {
    back: 'syn',
    prompt: () => number(['הקישו את מספרי הימים ברצף וסולמית. ראשון אחת, שני שתיים, וכן הלאה, שבת שבע. לדוגמה ראשון שלישי וחמישי, אחת שלוש חמש'], { max: 7 }),
    handle(c, input) {
      if (!/^[1-7]+$/.test(input)) return invalid(c);
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
      const status = `${s.is_active ? 'מוצג לציבור' : 'מוסתר מהציבור'}, מכסת מניינים ${s.max_minyanim}, מכסת מיקומים ${s.max_locations}, עריכת פרטים ${s.can_edit_info ? 'מותרת' : 'חסומה'}`;
      return menu(c, status, [
        ['1', s.is_active ? 'הסתרה מהציבור' : 'הצגה לציבור'], ['2', 'שינוי מכסת מניינים'], ['3', 'שינוי מכסת מיקומים'],
        ['4', s.can_edit_info ? 'חסימת עריכת פרטים' : 'התרת עריכת פרטים'], ['5', 'מחיקת בית הכנסת'],
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
        case '4': return toggle('can_edit_info');
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
      const list = await all(c.env, `SELECT id, name, phone FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id`);
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
      const u = await first(c.env, `SELECT id FROM users WHERE phone = ?`, phone);
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
      await run(c.env, `UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?`, nowIso(), id);
      await run(c.env, `DELETE FROM sessions WHERE user_id = ?`, id);
      c.say.push(text('מנהל המערכת הושבת'));
      return go(c, 'admins');
    },
  },

  // -------------------------------------------------------------- personal PIN
  pinSet: {
    back: (c) => goSynagogueOrHome(c),
    prompt: (c) => number([c.user.ivr_pin_hash ? 'יש לך קוד אישי. להחלפה הקישו קוד חדש של ארבע עד שמונה ספרות וסולמית, להסרת הקוד הקישו אפס וסולמית' : 'קוד אישי מגן על הניהול גם אם מישהו מתחזה למספר שלך. הקישו קוד של ארבע עד שמונה ספרות וסולמית'], { max: 8 }),
    async handle(c, input) {
      if (input === '0') {
        await run(c.env, `UPDATE users SET ivr_pin_hash = NULL WHERE id = ?`, c.user.id);
        c.user.ivr_pin_hash = null;
        c.say.push(text('הקוד הוסר'));
        return goSynagogueOrHome(c);
      }
      if (!/^\d{4,8}$/.test(input)) return invalid(c);
      return go(c, 'pinRepeat', { newPin: input });
    },
  },
  pinRepeat: {
    back: (c) => goSynagogueOrHome(c),
    prompt: () => number(['הקישו שוב את הקוד לאישור וסולמית'], { max: 8 }),
    async handle(c, input) {
      if (input !== c.state.data.newPin) { c.say.push(text('הקודים לא תואמים')); delete c.state.data.newPin; return go(c, 'pinSet'); }
      await run(c.env, `UPDATE users SET ivr_pin_hash = ? WHERE id = ?`, await hashPassword(input), c.user.id);
      delete c.state.data.newPin;
      c.say.push(text('הקוד נשמר. מעכשיו תתבקשו להקיש אותו בכל שיחה'));
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
