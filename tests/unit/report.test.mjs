import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime } from '../../js/report.js';

test('parseTime reads h:mm:ss, m:ss and a plain number of minutes', () => {
  assert.equal(parseTime('1:30:00'), 5400);
  assert.equal(parseTime('90:00'), 5400);
  assert.equal(parseTime('45'), 2700);
  assert.equal(parseTime('0'), 0);
  assert.equal(parseTime('  2:05  '), 125);
});

test('parseTime refuses what it cannot read', () => {
  for (const bad of ['', 'abc', '1:2:3:4', '1:75', '-5', '1.5']) assert.equal(parseTime(bad), null, bad);
});
