import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync } from '../../tools/reminders-bridge/plan.mjs';

const TODAY = '2026-09-15';
const OLD = Date.parse('2026-09-10T10:00:00Z');
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, date: '2026-09-12', placed: false, done: false, updatedAt: '2026-09-14T10:00:00.000Z', ...extra });
const reminder = (taskId, extra = {}) => ({
  id: `R-${taskId}`, title: `Task ${taskId}`, body: `levelix:${taskId}`, completed: false, date: null, created: OLD, modified: OLD, ...extra,
});
const agreed = (extra = {}) => ({ title: 'Task a', rDate: null, lDate: '2026-09-12', placed: false, done: false, ...extra });

test('a new open task becomes a reminder; a day only when it is placed', () => {
  const { ops, state } = planSync({ tasks: [task('a'), task('b', { placed: true })], today: TODAY });
  assert.deepEqual(ops, [
    { op: 'create', taskId: 'a', title: 'Task a', date: null },
    { op: 'create', taskId: 'b', title: 'Task b', date: '2026-09-12' },
  ]);
  assert.deepEqual(state.b, { title: 'Task b', rDate: '2026-09-12', lDate: '2026-09-12', placed: true, done: false });
});

test('removing the day in Reminders sends a waiting task to today', () => {
  const { ops, result, state } = planSync({
    tasks: [task('a', { date: '2026-09-23' })],
    reminders: [reminder('a', { date: null })],
    state: { a: agreed({ rDate: '2026-09-23', lDate: '2026-09-23' }) },
    today: TODAY,
  });
  assert.deepEqual(ops, []);
  assert.deepEqual(result.changedInReminders, [{ id: 'a', date: TODAY }]);
  assert.deepEqual(state.a, { title: 'Task a', rDate: null, lDate: TODAY, placed: false, done: false });
});

test('removing the day of a placed task in Reminders unplaces it too', () => {
  const { result } = planSync({
    tasks: [task('a', { placed: true })],
    reminders: [reminder('a', { date: null })],
    state: { a: agreed({ rDate: '2026-09-12', placed: true }) },
    today: TODAY,
  });
  assert.deepEqual(result.changedInReminders, [{ id: 'a', date: TODAY, unplace: true }]);
});

test('a new day in Reminders moves the task; a new day in Levelix moves the reminder; both → Levelix wins', () => {
  const base = { a: agreed({ rDate: '2026-09-12', placed: true }) };
  const fromReminders = planSync({ tasks: [task('a', { placed: true })], reminders: [reminder('a', { date: '2026-09-20' })], state: base, today: TODAY });
  assert.deepEqual(fromReminders.result.changedInReminders, [{ id: 'a', date: '2026-09-20' }]);
  assert.deepEqual(fromReminders.ops, []);

  const fromLevelix = planSync({ tasks: [task('a', { placed: true, date: '2026-09-18' })], reminders: [reminder('a', { date: '2026-09-12' })], state: base, today: TODAY });
  assert.deepEqual(fromLevelix.ops, [{ op: 'update', id: 'R-a', date: '2026-09-18' }]);

  const both = planSync({ tasks: [task('a', { placed: true, date: '2026-09-18' })], reminders: [reminder('a', { date: '2026-09-20' })], state: base, today: TODAY });
  assert.deepEqual(both.ops, [{ op: 'update', id: 'R-a', date: '2026-09-18' }]);
  assert.deepEqual(both.result.changedInReminders, []);
});

test('a waiting task keeps no day in Reminders and nothing churns', () => {
  const { ops, result } = planSync({ tasks: [task('a')], reminders: [reminder('a')], state: { a: agreed() }, today: TODAY });
  assert.deepEqual(ops, []);
  assert.deepEqual(result.changedInReminders, []);
});

test('titles: the side that changed wins', () => {
  const base = { a: agreed() };
  const renamedThere = planSync({ tasks: [task('a')], reminders: [reminder('a', { title: 'Renamed there' })], state: base, today: TODAY });
  assert.deepEqual(renamedThere.result.changedInReminders, [{ id: 'a', title: 'Renamed there' }]);
  const renamedHere = planSync({ tasks: [task('a', { title: 'Renamed here' })], reminders: [reminder('a')], state: base, today: TODAY });
  assert.deepEqual(renamedHere.ops, [{ op: 'update', id: 'R-a', title: 'Renamed here' }]);
});

test('a reminder deleted in Reminders deletes its task (finished or not) and never recreates it', () => {
  const { ops, result, state } = planSync({
    tasks: [task('a'), task('b', { done: true })],
    reminders: [],
    state: { a: agreed(), b: agreed({ title: 'Task b' }) },
    today: TODAY,
  });
  assert.deepEqual(ops, []);
  assert.deepEqual(result.deletedInReminders, ['a', 'b']);
  assert.deepEqual(state, {});
});

test('a task deleted in Levelix deletes its reminder', () => {
  const { ops, result, state } = planSync({ tasks: [], deleted: ['a'], reminders: [reminder('a')], state: { a: agreed() }, today: TODAY });
  assert.deepEqual(ops, [{ op: 'delete', id: 'R-a' }]);
  assert.equal(result.deleted, 1);
  assert.deepEqual(state, {});
});

test('without a saved state: a reminder edited after the task wins, one the bridge just created does not', () => {
  const edited = reminder('a', { date: null, created: OLD, modified: Date.parse('2026-09-15T08:00:00Z') });
  const before = planSync({ tasks: [task('a', { date: '2026-09-23' })], reminders: [edited], today: TODAY });
  assert.deepEqual(before.result.changedInReminders, [{ id: 'a', date: TODAY }]);

  const justCreated = reminder('b', { date: '2026-09-01', created: Date.parse('2026-09-15T08:00:00Z'), modified: Date.parse('2026-09-15T08:00:02Z') });
  const fresh = planSync({ tasks: [task('b', { placed: true })], reminders: [justCreated], today: TODAY });
  assert.deepEqual(fresh.ops, [{ op: 'update', id: 'R-b', date: '2026-09-12' }]);
  assert.deepEqual(fresh.result.changedInReminders, []);
});

test('ticks merge both ways; untagged open reminders are imported', () => {
  const { ops, result } = planSync({
    tasks: [task('a', { done: true }), task('b')],
    reminders: [reminder('a'), reminder('b', { completed: true }), { id: 'R-new', title: ' Buy milk ', body: '', completed: false, date: '2026-09-20', created: OLD, modified: OLD }],
    state: { a: agreed(), b: agreed({ title: 'Task b' }) },
    today: TODAY,
  });
  assert.deepEqual(ops, [{ op: 'update', id: 'R-a', completed: true }]);
  assert.deepEqual(result.completedInReminders, ['b']);
  assert.deepEqual(result.imports, [{ reminderId: 'R-new', title: 'Buy milk', date: '2026-09-20' }]);
});

test('ticks: the side that changed since the last sync wins, and unticking works both ways', () => {
  const bothDone = { a: agreed({ done: true }) };
  const untickedHere = planSync({ tasks: [task('a')], reminders: [reminder('a', { completed: true })], state: bothDone, today: TODAY });
  assert.deepEqual(untickedHere.ops, [{ op: 'update', id: 'R-a', completed: false }]);
  assert.deepEqual(untickedHere.result.completedInReminders, []);
  assert.equal(untickedHere.state.a.done, false);

  const untickedThere = planSync({ tasks: [task('a', { done: true })], reminders: [reminder('a')], state: bothDone, today: TODAY });
  assert.deepEqual(untickedThere.ops, []);
  assert.deepEqual(untickedThere.result.reopenedInReminders, ['a']);

  const tickedThere = planSync({ tasks: [task('a')], reminders: [reminder('a', { completed: true })], state: { a: agreed() }, today: TODAY });
  assert.deepEqual(tickedThere.result.completedInReminders, ['a']);
  assert.deepEqual(tickedThere.ops, []);
});

test('ticks without a saved record: Levelix wins unless the reminder was edited after the task', () => {
  const noDone = { a: { title: 'Task a', rDate: null, lDate: '2026-09-12', placed: false } };
  const older = planSync({ tasks: [task('a')], reminders: [reminder('a', { completed: true, modified: OLD })], state: noDone, today: TODAY });
  assert.deepEqual(older.ops, [{ op: 'update', id: 'R-a', completed: false }]);
  const newer = planSync({ tasks: [task('a')], reminders: [reminder('a', { completed: true, modified: Date.parse('2026-09-15T08:00:00Z') })], state: noDone, today: TODAY });
  assert.deepEqual(newer.result.completedInReminders, ['a']);
});
