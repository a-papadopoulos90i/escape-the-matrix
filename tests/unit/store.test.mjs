import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUADRANTS, createEmptyDoc, createStore, mergeDocs, normalizeDoc, timerElapsed, timerRemaining } from '../../js/store.js';

const DAY = '2026-03-11';
const OTHER_DAY = '2026-03-12';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Controllable clock so timer maths is deterministic. */
function makeClock(startMs = Date.UTC(2026, 2, 11, 9, 0, 0)) {
  let ms = startMs;
  return { now: () => ms, tick: (seconds) => (ms += seconds * 1000) };
}

function makeStore(doc) {
  const clock = makeClock();
  return { store: createStore(doc, { now: clock.now }), clock };
}

function fakeAdapter() {
  const adapter = { name: 'fake', saves: [], remote: null };
  adapter.load = async () => null;
  adapter.save = async (doc) => adapter.saves.push(doc);
  adapter.onRemote = (callback) => {
    adapter.remote = callback;
    return () => (adapter.remote = null);
  };
  return adapter;
}

test('createStore tolerates missing or corrupt input', () => {
  for (const input of [undefined, null, 'junk', 42, { tasks: 'nope' }]) {
    const doc = createStore(input).get();
    assert.equal(doc.version, 1);
    assert.deepEqual(doc.tasks, []);
    assert.equal(doc.settings.showWeekends, false);
    assert.deepEqual(doc.settings.tipsSeen, { 1: false, 2: false, 3: false, 4: false, 5: false });
  }
});

test('addTask creates the SPEC task shape and stamps the doc', () => {
  const { store } = makeStore();
  const task = store.addTask({ title: '  Marketing Order A5 ', date: DAY });
  assert.match(task.id, /^t_[a-z0-9]{7}$/);
  assert.equal(task.title, 'Marketing Order A5');
  assert.equal(task.date, DAY);
  assert.equal(task.quadrant, null);
  assert.equal(typeof task.order, 'number');
  assert.equal(task.done, false);
  assert.equal(task.doneAt, null);
  assert.equal(task.timer, null);
  assert.equal(task.createdAt, task.updatedAt);
  assert.equal(store.get().updatedAt, task.updatedAt);
  assert.throws(() => store.addTask({ title: 'x', date: 'not-a-date' }));
});

test('addTask keeps order strictly increasing', () => {
  const { store } = makeStore();
  const a = store.addTask({ title: 'a', date: DAY });
  const b = store.addTask({ title: 'b', date: DAY });
  assert.ok(b.order > a.order);
});

test('tasksForDate sorts by quadrant, done last, then order', () => {
  const { store } = makeStore();
  const unsorted = store.addTask({ title: 'unsorted', date: DAY });
  const del = store.addTask({ title: 'delete', date: DAY, quadrant: 'delete' });
  const doDone = store.addTask({ title: 'do-done', date: DAY, quadrant: 'do' });
  const doTodo = store.addTask({ title: 'do-todo', date: DAY, quadrant: 'do' });
  const plan = store.addTask({ title: 'plan', date: DAY, quadrant: 'plan' });
  store.addTask({ title: 'elsewhere', date: OTHER_DAY, quadrant: 'do' });
  store.toggleDone(doDone.id);

  const titles = store.tasksForDate(DAY).map((task) => task.title);
  assert.deepEqual(titles, ['do-todo', 'do-done', 'plan', 'delete', 'unsorted']);
  assert.deepEqual(store.statsForDate(DAY), { total: 5, done: 1 });
  assert.deepEqual(store.statsForDate('2026-01-01'), { total: 0, done: 0 });
  assert.ok([unsorted, del, doTodo, plan].every(Boolean));
});

test('setQuadrant validates and is undoable', () => {
  const { store } = makeStore();
  const task = store.addTask({ title: 'a', date: DAY });
  assert.equal(store.canUndo(), false);
  store.setQuadrant(task.id, 'plan');
  assert.equal(store.get().tasks[0].quadrant, 'plan');
  assert.equal(store.canUndo(), true);
  assert.equal(store.undo(), true);
  assert.equal(store.get().tasks[0].quadrant, null);
  assert.equal(store.canUndo(), false);
  assert.equal(store.undo(), false);
  store.setQuadrant(task.id, 'bogus');
  assert.equal(store.get().tasks[0].quadrant, null);
});

test('removeTask + undo restores the task with its fields', () => {
  const { store } = makeStore();
  const task = store.addTask({ title: 'keep me', date: DAY, quadrant: 'delegate' });
  store.removeTask(task.id);
  assert.equal(store.get().tasks.length, 0);
  assert.equal(store.undo(), true);
  const restored = store.get().tasks[0];
  assert.equal(restored.id, task.id);
  assert.equal(restored.title, 'keep me');
  assert.equal(restored.quadrant, 'delegate');
  store.removeTask('missing-id');
  assert.equal(store.get().tasks.length, 1);
});

test('moveTaskToDate + undo', () => {
  const { store } = makeStore();
  const task = store.addTask({ title: 'a', date: DAY, quadrant: 'do' });
  store.moveTaskToDate(task.id, OTHER_DAY);
  assert.equal(store.tasksForDate(DAY).length, 0);
  assert.equal(store.tasksForDate(OTHER_DAY)[0].quadrant, 'do');
  store.undo();
  assert.equal(store.tasksForDate(DAY).length, 1);
  assert.throws(() => store.moveTaskToDate(task.id, 'nope'));
});

test('undo is single-level: only the last undoable mutation reverts', () => {
  const { store } = makeStore();
  const a = store.addTask({ title: 'a', date: DAY });
  const b = store.addTask({ title: 'b', date: DAY });
  store.removeTask(a.id);
  store.removeTask(b.id);
  assert.equal(store.undo(), true);
  assert.deepEqual(store.get().tasks.map((task) => task.id), [b.id]);
  assert.equal(store.undo(), false);
});

test('undoable() groups several mutations into one undo step', () => {
  const { store } = makeStore();
  const a = store.addTask({ title: 'a', date: DAY });
  const b = store.addTask({ title: 'b', date: DAY });
  store.undoable(() => {
    store.moveTaskToDate(a.id, OTHER_DAY);
    store.moveTaskToDate(b.id, OTHER_DAY);
  });
  assert.equal(store.tasksForDate(OTHER_DAY).length, 2);
  store.undo();
  assert.equal(store.tasksForDate(DAY).length, 2);
});

test('toggleDone flips, stamps doneAt and stops a live timer', () => {
  const { store, clock } = makeStore();
  const task = store.addTask({ title: 'a', date: DAY });
  store.startTimer(task.id, { mode: 'stopwatch' });
  clock.tick(30);
  const done = store.toggleDone(task.id);
  assert.equal(done.done, true);
  assert.equal(typeof done.doneAt, 'string');
  assert.equal(done.timer.running, false);
  assert.equal(done.timer.elapsedSec, 30);
  assert.equal(typeof done.timer.stoppedAt, 'string');
  assert.equal(store.activeTimer(), null);
  const undone = store.toggleDone(task.id, false);
  assert.equal(undone.done, false);
  assert.equal(undone.doneAt, null);
});

test('updateTask patches known fields and ignores invalid values', () => {
  const { store } = makeStore();
  const task = store.addTask({ title: 'a', date: DAY });
  const updated = store.updateTask(task.id, { title: 'renamed', quadrant: 'do', bogus: 1 });
  assert.equal(updated.title, 'renamed');
  assert.equal(updated.quadrant, 'do');
  assert.equal('bogus' in updated, false);
  assert.ok(updated.updatedAt >= task.updatedAt);
  const unchanged = store.updateTask(task.id, { date: 'garbage' });
  assert.equal(unchanged.date, DAY);
  assert.equal(store.updateTask('missing', { title: 'x' }), null);
});

test('reorderTask and setSetting', () => {
  const { store } = makeStore();
  const task = store.addTask({ title: 'a', date: DAY });
  store.reorderTask(task.id, 5);
  assert.equal(store.get().tasks[0].order, 5);
  store.setSetting('showWeekends', true);
  assert.equal(store.get().settings.showWeekends, true);
  store.setSetting('tipsSeen', { ...store.get().settings.tipsSeen, 2: true });
  assert.equal(store.get().settings.tipsSeen[2], true);
});

test('timers: stopwatch start / pause / resume / stop', () => {
  const { store, clock } = makeStore();
  const task = store.addTask({ title: 'a', date: DAY });
  const started = store.startTimer(task.id, { mode: 'stopwatch' });
  assert.equal(started.timer.running, true);
  assert.equal(started.timer.durationSec, 0);
  assert.equal(store.activeTimer().id, task.id);

  clock.tick(10);
  assert.equal(timerElapsed(store.get().tasks[0].timer, clock.now()), 10);
  const paused = store.pauseTimer(task.id);
  assert.equal(paused.timer.running, false);
  assert.equal(paused.timer.elapsedSec, 10);
  assert.equal(store.activeTimer().id, task.id, 'paused timer is still active');

  clock.tick(100);
  assert.equal(timerElapsed(store.get().tasks[0].timer, clock.now()), 10, 'paused time does not count');
  store.resumeTimer(task.id);
  clock.tick(5);
  assert.equal(timerElapsed(store.get().tasks[0].timer, clock.now()), 15);

  const stopped = store.stopTimer(task.id);
  assert.equal(stopped.timer.elapsedSec, 15);
  assert.equal(stopped.timer.running, false);
  assert.equal(typeof stopped.timer.stoppedAt, 'string');
  assert.equal(store.activeTimer(), null);
  assert.equal(store.stopTimer(task.id), null, 'stopping twice is a no-op');
  assert.equal(store.resumeTimer(task.id), null, 'a stopped timer cannot resume');
});

test('timers: countdown remaining and only one live timer at a time', () => {
  const { store, clock } = makeStore();
  const a = store.addTask({ title: 'a', date: DAY });
  const b = store.addTask({ title: 'b', date: DAY });
  store.startTimer(a.id, { mode: 'countdown', durationSec: 60 });
  clock.tick(20);
  assert.equal(timerRemaining(store.get().tasks[0].timer, clock.now()), 40);
  store.startTimer(b.id, { mode: 'countdown', durationSec: 300 });
  const [taskA, taskB] = store.get().tasks;
  assert.equal(taskA.timer.running, false);
  assert.equal(taskA.timer.elapsedSec, 20);
  assert.equal(typeof taskA.timer.stoppedAt, 'string');
  assert.equal(taskB.timer.running, true);
  assert.equal(store.activeTimer().id, b.id);
  clock.tick(400);
  assert.equal(timerRemaining(store.get().tasks[1].timer, clock.now()), 0);
  assert.throws(() => store.startTimer(a.id, { mode: 'nope' }));
});

test('timer state survives a reload through normalizeDoc', () => {
  const { store, clock } = makeStore();
  const task = store.addTask({ title: 'a', date: DAY });
  store.startTimer(task.id, { mode: 'countdown', durationSec: 90 });
  clock.tick(15);
  const reloaded = createStore(JSON.parse(JSON.stringify(store.get())), { now: clock.now });
  assert.equal(reloaded.activeTimer().id, task.id);
  assert.equal(timerRemaining(reloaded.get().tasks[0].timer, clock.now()), 75);
});

test('subscribe receives reasons; replace notifies without saving; mutations save debounced', async () => {
  const { store } = makeStore();
  const adapter = fakeAdapter();
  store.attach(adapter);
  const reasons = [];
  const unsubscribe = store.subscribe((doc, meta) => reasons.push(meta.reason));

  store.replace({ tasks: [], settings: { showWeekends: true } });
  store.addTask({ title: 'a', date: DAY });
  store.addTask({ title: 'b', date: DAY });
  assert.deepEqual(reasons, ['replace', 'addTask', 'addTask']);
  assert.equal(adapter.saves.length, 0, 'saves are debounced');

  await sleep(250);
  assert.equal(adapter.saves.length, 1, 'one save for two quick mutations');
  assert.equal(adapter.saves[0].tasks.length, 2);
  assert.equal(adapter.saves[0].settings.showWeekends, true);

  unsubscribe();
  store.addTask({ title: 'c', date: DAY });
  assert.equal(reasons.length, 3);
  await store.flush();
  assert.equal(adapter.saves.length, 2);
});

test('attach wires onRemote (merge by default, plain replace when asked) and detach unwires', () => {
  const { store } = makeStore();
  const adapter = fakeAdapter();
  const detach = store.attach(adapter);
  const local = store.addTask({ title: 'local', date: DAY });

  adapter.remote({ ...createEmptyDoc(), tasks: [{ ...local, id: 't_remote1', title: 'remote' }] });
  assert.deepEqual(store.get().tasks.map((task) => task.title).sort(), ['local', 'remote']);

  adapter.remote({ ...createEmptyDoc(), tasks: [] }, { merge: false });
  assert.equal(store.get().tasks.length, 0);

  detach();
  assert.equal(adapter.remote, null);
});

test('save errors are reported through onError, never thrown', async () => {
  const { store } = makeStore();
  const failing = { name: 'failing', load: async () => null, save: async () => { throw new Error('quota'); } };
  const errors = [];
  store.attach(failing);
  store.onError((error, adapter) => errors.push([error.message, adapter.name]));
  store.addTask({ title: 'a', date: DAY });
  await store.flush();
  assert.deepEqual(errors, [['quota', 'failing']]);
});

test('mergeDocs unions tasks by id, newer updatedAt wins, settings from the newer doc', () => {
  const base = { id: 't_1', date: DAY, title: 'old', quadrant: null, order: 1, done: false, createdAt: '2026-03-01T00:00:00.000Z' };
  const a = {
    updatedAt: '2026-03-10T00:00:00.000Z',
    settings: { showWeekends: false, bannerDismissed: true },
    tasks: [
      { ...base, updatedAt: '2026-03-09T00:00:00.000Z' },
      { ...base, id: 't_onlyA', title: 'only in a', updatedAt: '2026-03-09T00:00:00.000Z' },
    ],
  };
  const b = {
    updatedAt: '2026-03-11T00:00:00.000Z',
    settings: { showWeekends: true },
    tasks: [
      { ...base, title: 'new', quadrant: 'do', updatedAt: '2026-03-10T00:00:00.000Z' },
      { ...base, id: 't_onlyB', title: 'only in b', updatedAt: '2026-03-09T00:00:00.000Z' },
    ],
  };
  const merged = mergeDocs(a, b);
  assert.equal(merged.version, 1);
  assert.equal(merged.updatedAt, b.updatedAt);
  assert.equal(merged.settings.showWeekends, true);
  assert.equal(merged.settings.bannerDismissed, false, 'settings come wholesale from the newer doc');
  assert.deepEqual(
    merged.tasks.map((task) => [task.id, task.title]).sort(),
    [['t_1', 'new'], ['t_onlyA', 'only in a'], ['t_onlyB', 'only in b']],
  );
  assert.equal(merged.tasks.find((task) => task.id === 't_1').quadrant, 'do');

  const reversed = mergeDocs(b, a);
  assert.equal(reversed.settings.showWeekends, true, 'order of arguments does not matter');
  assert.deepEqual(mergeDocs(null, undefined).tasks, []);
});

test('normalizeDoc drops invalid tasks, dedupes ids and keeps valid quadrants', () => {
  const doc = normalizeDoc({
    tasks: [
      { id: 't_1', date: DAY, title: 'ok', quadrant: 'plan' },
      { id: 't_1', date: DAY, title: 'dupe wins' },
      { id: 't_2', date: 'bad-date', title: 'dropped' },
      { date: DAY, title: 'no id' },
      { id: 't_3', date: DAY, quadrant: 'weird', timer: { mode: 'nope' } },
      'garbage',
    ],
  });
  assert.deepEqual(doc.tasks.map((task) => task.id), ['t_1', 't_3']);
  assert.equal(doc.tasks[0].title, 'dupe wins');
  assert.equal(doc.tasks[1].quadrant, null);
  assert.equal(doc.tasks[1].timer, null);
  assert.deepEqual(QUADRANTS, ['do', 'plan', 'delegate', 'delete']);
});
