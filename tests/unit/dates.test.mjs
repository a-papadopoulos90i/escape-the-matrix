import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  addMonths,
  formatLong,
  formatShort,
  fromKey,
  fromMonthKey,
  isValidKey,
  isValidMonthKey,
  isWeekend,
  monthGrid,
  monthName,
  monthOfKey,
  nextVisibleDay,
  prevVisibleDay,
  toKey,
  toMonthKey,
  todayKey,
  weekdayIndex,
} from '../../js/dates.js';

test('monthGrid: March 2026 with weekends hidden starts Mar 2 and ends Apr 10', () => {
  const rows = monthGrid(2026, 2, false);
  assert.equal(rows.length, 6);
  for (const row of rows) assert.equal(row.length, 5);
  assert.deepEqual(rows[0], ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']);
  assert.deepEqual(rows[4], ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03']);
  assert.equal(rows[5][0], '2026-04-06');
  assert.equal(rows[5][4], '2026-04-10');
});

test('monthGrid: March 2026 with weekends starts on the Monday of the week containing the 1st', () => {
  const rows = monthGrid(2026, 2, true);
  assert.equal(rows.length, 6);
  for (const row of rows) assert.equal(row.length, 7);
  assert.equal(rows[0][0], '2026-02-23');
  assert.equal(rows[0][6], '2026-03-01');
  assert.equal(rows[5][6], '2026-04-05');
});

test('monthGrid: a month starting on Monday keeps its 1st in the first cell', () => {
  assert.equal(monthGrid(2026, 5, false)[0][0], '2026-06-01');
  assert.equal(monthGrid(2026, 5, true)[0][0], '2026-06-01');
});

test('monthGrid: a month starting on Saturday skips to the next Monday when weekends are hidden', () => {
  assert.equal(monthGrid(2026, 7, false)[0][0], '2026-08-03');
  assert.equal(monthGrid(2026, 7, true)[0][0], '2026-07-27');
});

test('formatLong / formatShort', () => {
  assert.equal(formatLong('2026-03-11'), 'Wednesday, 11 March 2026');
  assert.equal(formatShort('2026-09-15'), 'Tue 15 Sep');
  assert.equal(formatShort('2026-03-02'), 'Mon 2 Mar');
});

test('toKey / fromKey round-trip and validation', () => {
  assert.equal(toKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(toKey(fromKey('2026-12-31')), '2026-12-31');
  assert.equal(isValidKey('2026-03-11'), true);
  assert.equal(isValidKey('2026-02-30'), false);
  assert.equal(isValidKey('2026-13-01'), false);
  assert.equal(isValidKey('11/03/2026'), false);
  assert.equal(isValidKey(null), false);
  assert.equal(todayKey(new Date(2026, 8, 12)), '2026-09-12');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-03-31', 1), '2026-04-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 2), '2026-03-02');
});

test('weekend helpers', () => {
  assert.equal(isWeekend('2026-03-07'), true); // Saturday
  assert.equal(isWeekend('2026-03-08'), true); // Sunday
  assert.equal(isWeekend('2026-03-09'), false);
  assert.equal(weekdayIndex('2026-03-09'), 0);
  assert.equal(weekdayIndex('2026-03-08'), 6);
});

test('nextVisibleDay / prevVisibleDay skip weekends only when hidden', () => {
  assert.equal(nextVisibleDay('2026-03-06', false), '2026-03-09'); // Fri → Mon
  assert.equal(nextVisibleDay('2026-03-06', true), '2026-03-07'); // Fri → Sat
  assert.equal(prevVisibleDay('2026-03-09', false), '2026-03-06'); // Mon → Fri
  assert.equal(prevVisibleDay('2026-03-09', true), '2026-03-08'); // Mon → Sun
  assert.equal(nextVisibleDay('2026-03-07', false), '2026-03-09'); // Sat → Mon
});

test('month helpers', () => {
  assert.equal(monthName(2), 'March');
  assert.equal(toMonthKey(2026, 2), '2026-03');
  assert.deepEqual(fromMonthKey('2026-03'), { year: 2026, month: 2 });
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthOfKey('2026-03-11'), '2026-03');
  assert.equal(isValidMonthKey('2026-03'), true);
  assert.equal(isValidMonthKey('2026-13'), false);
  assert.equal(isValidMonthKey('2026-3'), false);
});
