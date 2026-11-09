import assert from 'node:assert/strict';
import test from 'node:test';
import { candleLighting, comingFriday, message } from '../src/index.js';

const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

test('candle lighting matches Itim LeBina for Safed (30 min before sunset from elevation)', () => {
  // Calendar sunset-from-elevation 8–13 Nov 2026: 16:45:45 16:45:00 16:44:15 16:43:45 16:43:00 16:42:30
  const want = { 8: '16:15', 9: '16:15', 10: '16:14', 11: '16:13', 12: '16:13', 13: '16:12' };
  for (const [d, t] of Object.entries(want)) assert.equal(hm(candleLighting({ y: 2026, m: 11, d: +d })), t, `Nov ${d}`);
});

test('coming Friday: Monday → that week, Friday → today, Shabbat → next week', () => {
  assert.deepEqual(comingFriday(new Date('2026-11-09T10:00:00Z')), { y: 2026, m: 11, d: 13 });
  assert.deepEqual(comingFriday(new Date('2026-11-13T10:00:00Z')), { y: 2026, m: 11, d: 13 });
  assert.deepEqual(comingFriday(new Date('2026-11-14T10:00:00Z')), { y: 2026, m: 11, d: 20 });
});

const MON = new Date('2026-11-09T10:00:00Z'); // candle lighting that week: 16:12
const say = (q) => message(MON, new URLSearchParams(q));

test('default: minha at candle lighting, kollel only once given', () => {
  assert.equal(say(''), 'id_list_message=t-מנחה ערב שבת בשעה 16 12&');
  assert.equal(say('kollel=30'), 'id_list_message=t-כולל ערב שבת בשעה 15 42.t-מנחה ערב שבת בשעה 16 12&');
});

test('link parameters', () => {
  assert.equal(say('minha=-5'), 'id_list_message=t-מנחה ערב שבת בשעה 16 17&');
  assert.equal(say('kollel=12&minha=off'), 'id_list_message=t-כולל ערב שבת בשעה 16&');
  assert.equal(say('say_candles=1&candle=40'), 'id_list_message=t-הדלקת נרות בשעה 16 ו 2 דקות.t-מנחה ערב שבת בשעה 16 ו 2 דקות&');
  assert.equal(say('items=שיעור:60;מנחה:0'), 'id_list_message=t-שיעור בשעה 15 12.t-מנחה בשעה 16 12&');
  assert.equal(say('minha=abc'), 'id_list_message=t-מנחה ערב שבת בשעה 16 12&');
});
