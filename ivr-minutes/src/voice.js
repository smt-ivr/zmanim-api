// Recorded voice for the two phone lines. Every fixed sentence the lines say has a key; when a recording
// was uploaded for it (to Yemot, from the admin page) it plays as a file (f-<path>), otherwise it is read
// by text-to-speech. Numbers stay text-to-speech, or Yemot's own number voice (n-) when chosen.
import { all, first } from './data.js';

/** [key, text, group, where] — the text is exactly what text-to-speech says without a recording. */
export const PHRASES = [
  ['so_far', 'עד כה קיבלת על עצמך תוספת שבת של', 'סכום', 'ואחריו הסכום שלה: ...של 45 דקות'],
  ['total_is', 'סך הכל קיבלת על עצמך תוספת שבת של', 'סכום', 'אחרי עדכון, ואחריו הסכום שלה'],
  ['none_yet', 'עדיין לא קיבלת על עצמך תוספת שבת', 'סכום', 'כשעוד אין לה דקות'],
  ['all_total', 'ובסך הכל קיבלו כל המשתתפות תוספת שבת של', 'סכום', 'בשלוחת הסכום, כשמסומן להשמיע גם את הסכום של כולן'],
  ['add_prompt', 'הקישי את מספר הדקות של תוספת שבת שאת מקבלת על עצמך עד', 'עדכון', 'ואחריו המקסימום: "...עד" 60'],
  ['end_hash', 'ובסיום הקישי סולמית', 'עדכון', 'בסוף בקשת ההקשה'],
  ['added', 'נרשמה תוספת של', 'עדכון', '"נרשמה תוספת של" 30 דקות'],
  ['range_add', 'ניתן להקיש בין 1 ל', 'עדכון', 'כשהוקש מספר גדול מדי: "...בין 1 ל" 60 דקות'],
  ['already_day', 'כבר עדכנת היום', 'מגבלה', 'כשכבר עדכנה היום (per=day)'],
  ['already_week', 'כבר עדכנת השבוע', 'מגבלה', 'כשכבר עדכנה השבוע (per=week)'],
  ['already_month', 'כבר עדכנת החודש', 'מגבלה', 'כשכבר עדכנה החודש (per=month)'],
  ['already', 'כבר עדכנת', 'מגבלה', 'per=ever, או זמן מתגלגל (ואחריו "ב 12 השעות האחרונות")'],
  ['tosefet_of', 'תוספת של', 'מגבלה', '"כבר עדכנת השבוע" "תוספת של" 30 דקות'],
  ['times', 'פעמים', 'מגבלה', 'כשמותר כמה פעמים: "כבר עדכנת השבוע 2 "פעמים'],
  ['last_update', 'בעדכון האחרון', 'מגבלה', 'ואחריו כמה דקות היו בעדכון האחרון'],
  ['edit_menu', 'לשינוי העדכון הקישי 1. ליציאה הקישי 2', 'שינוי עדכון', 'אחרי ההודעה שכבר עדכנה'],
  ['edit_prompt', 'הקישי את מספר הדקות המעודכן עד', 'שינוי עדכון', 'ואחריו המקסימום'],
  ['edit_cancel', 'לביטול העדכון הקישי 0', 'שינוי עדכון', 'אחרי המקסימום, לפני "ובסיום הקישי סולמית"'],
  ['range_edit', 'ניתן להקיש בין 0 ל', 'שינוי עדכון', 'כשהוקש מספר גדול מדי בשינוי'],
  ['changed_to', 'העדכון שונה לתוספת של', 'שינוי עדכון', '"העדכון שונה לתוספת של" 45 דקות'],
  ['canceled', 'העדכון בוטל', 'שינוי עדכון', 'אחרי הקשת 0'],
  ['not_found', 'העדכון לא נמצא', 'שינוי עדכון', 'נדיר: העדכון נמחק בינתיים'],
  ['minutes', 'דקות', 'מילים', 'אחרי כל מספר דקות: 45 "דקות"'],
  ['one_minute', 'דקה אחת', 'מילים', 'במקום "1 דקות"'],
  ['hours', 'שעות', 'מילים', 'עם hours=1: 3 "שעות"'],
  ['one_hour', 'שעה אחת', 'מילים', 'עם hours=1'],
  ['two_hours', 'שעתיים', 'מילים', 'עם hours=1'],
  ['and', 'ו', 'מילים', 'עם hours=1: שעתיים "ו" 15 דקות'],
  ['minus', 'מינוס', 'מילים', 'כשהסכום שלילי (אחרי תיקון ידני)'],
  ['invalid', 'הקשה לא חוקית', 'הודעות', 'הקשה שאינה 1 או 2'],
  ['no_input', 'לא התקבלה הקשה', 'הודעות', 'כשלא הוקש כלום'],
  ['not_updated', 'לא עודכן', 'הודעות', 'אחרי 3 ניסיונות לא תקינים'],
  ['no_phone', 'לא זוהה מספר הטלפון שלך. יש להתקשר ממספר מזוהה', 'הודעות', 'התקשרות ממספר חסוי'],
  ['blocked', 'הגישה לשלוחה זו חסומה', 'הודעות', 'קישור בלי המפתח הנכון'],
  ['error', 'אירעה תקלה, נסי שוב מאוחר יותר', 'הודעות', 'בתקלה'],
];
const TEXT = new Map(PHRASES.map(([k, t]) => [k, t]));

/** A recordable part of a sentence. */
export const P = (key) => {
  if (!TEXT.has(key)) throw new Error(`unknown phrase ${key}`);
  return { key, text: TEXT.get(key) };
};

/** File name in the Yemot folder: letters and digits only ("add_prompt" -> "addprompt"). */
export const fileName = (key) => key.replace(/[^a-z0-9]/gi, '');

/** Characters Yemot treats as syntax inside a message. */
export const clean = (s) => String(s).replace(/[.\-"'&|=׳״,]/g, ' ').replace(/\s+/g, ' ').trim();

const partText = (p) => (typeof p === 'object' ? p.text : String(p));

/**
 * The voice of one request: renders a sentence (a string, or an array of strings / P(key) parts)
 * into Yemot message parts. With nothing recorded, a sentence is read as one piece of text, as before.
 */
export async function loadVoice(env) {
  let files = new Map();
  let yemotNumbers = false;
  try {
    const [enabled, numbers] = await Promise.all([
      first(env, `SELECT value FROM minutes_settings WHERE key = 'recordings_enabled'`),
      first(env, `SELECT value FROM minutes_settings WHERE key = 'yemot_numbers'`),
    ]);
    yemotNumbers = numbers?.value === '1';
    if (enabled?.value !== '0') {
      const rows = await all(env, `SELECT key, path FROM minutes_recordings WHERE paused = 0`);
      files = new Map(rows.map((r) => [r.key, r.path]));
    }
  } catch (e) { console.error('[ivr-minutes] voice', e?.message || e); }
  return { render: (line) => render(line, files, yemotNumbers) };
}

/** Plain text-to-speech (no database), e.g. when loading the voice failed. */
export const plainVoice = { render: (line) => render(line, new Map(), false) };

function render(line, files, yemotNumbers) {
  const parts = Array.isArray(line) ? line : [line];
  const special = (p) => (typeof p === 'object' && files.has(p.key)) || (yemotNumbers && /^\d+$/.test(partText(p)));
  if (!parts.some(special)) {
    const t = clean(parts.map(partText).join(' '));
    return t ? [`t-${t}`] : [];
  }
  const out = [];
  let buf = [];
  const flush = () => { const t = clean(buf.join(' ')); if (t) out.push(`t-${t}`); buf = []; };
  for (const p of parts) {
    if (typeof p === 'object' && files.has(p.key)) { flush(); out.push(`f-${files.get(p.key)}`); continue; }
    const t = partText(p);
    if (yemotNumbers && /^\d+$/.test(t)) { flush(); out.push(`n-${t}`); continue; }
    buf.push(t);
  }
  flush();
  return out;
}
