// Yemot HaMashiach "type=api" protocol: building response strings.
//
// Yemot calls api_link (GET by default) with ApiPhone, ApiCallId, ApiDID, ApiExtension, ...,
// plus every value collected by earlier `read` commands in this call (by its val_name).
// When the caller hangs up and api_hangup_send=yes, it calls once more with hangup=yes.
//
// Response = plain text commands joined by '&', e.g.
//   id_list_message=t-נשמר&read=t-לתפריט הקישו 1=s4,no,1,1,7,No,no,no,,,,Ok,None,
// Message parts are joined with '.', each prefixed by type: t- (TTS text), n- (number), d- (digits), f- (file).

/** Characters Yemot treats as syntax inside messages. */
const RESERVED = /[.\-"'&|=׳״]/g;

export const text = (s) => `t-${String(s).replace(RESERVED, ' ').replace(/\s+/g, ' ').trim()}`;
export const num = (n) => `n-${Math.trunc(Number(n))}`;
export const joinMessages = (parts) => parts.flat().filter(Boolean).join('.');

/**
 * Tap (keypad) read. Option order per Yemot docs (as implemented by yemot-router2):
 * val_name, re_enter_if_exists, max_digits, min_digits, sec_wait, typing_playback_mode,
 * block_asterisk_key, block_zero_key, replace_char, digits_allowed, amount_attempts,
 * allow_empty, empty_val, block_change_keyboard
 */
export function readDigits(messages, valName, { max = '', min = 1, wait = 10, attempts = 2 } = {}) {
  const ops = [valName, 'no', max, min, wait, 'No', 'no', 'no', '', '', attempts, 'Ok', 'None', ''];
  return `read=${joinMessages(messages)}=${ops.join(',')}`;
}

/** Speech-to-text read: val_name, re_enter_if_exists, 'voice', lang, block_typing, max_digits, quiet_max, max_length */
export function readVoice(messages, valName) {
  const ops = [valName, 'no', 'voice', 'he-IL', '', '', '', ''];
  return `read=${joinMessages(messages)}=${ops.join(',')}`;
}

export const idListMessage = (messages) => `id_list_message=${joinMessages(messages)}`;
export const hangup = () => 'go_to_folder=hangup';

// ------------------------------------------------------------------ speaking values
const DAY_WORDS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function speakDays(mask) {
  if (mask === 127) return 'כל יום';
  if (mask === 31) return 'ראשון עד חמישי';
  if (mask === 63) return 'ראשון עד שישי';
  if (mask === 64) return 'שבת';
  return 'בימים ' + DAY_WORDS.filter((_, i) => mask & (1 << i)).join(' ');
}

export function speakClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (m === 0) return `${h} בדיוק`;
  if (m < 10) return `${h} ו ${m} דקות`;
  return `${h} ${m}`;
}

export function speakMinyanTime(m) {
  if (m.time_kind === 'fixed') return `בשעה ${speakClock(m.time)}`;
  const n = Math.abs(m.offset_minutes);
  if (n === 0) return `ב${m.anchor_name}`;
  return `${n} דקות ${m.offset_minutes < 0 ? 'לפני' : 'אחרי'} ${m.anchor_name}`;
}

export function speakMinyan(m) {
  return [m.prayer_name, speakMinyanTime(m), speakDays(m.days), m.location_name && `ב${m.location_name}`, m.season_name && `ב${m.season_name}`, !m.is_active && 'מוסתר']
    .filter(Boolean)
    .join(', ');
}

/** "0583206823" -> spoken digit by digit. */
export const speakPhone = (p) => `d-${p}`;
