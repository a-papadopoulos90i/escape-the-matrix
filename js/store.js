// Immutable document store (SPEC §4/§5). Every mutation builds a new doc, stamps `updatedAt` on
// the touched tasks and the doc, notifies subscribers and schedules a debounced save to every
// attached adapter. No DOM access — the same code runs in the browser and in node tests.
//
// Deletes are tombstones: removeTask() keeps the task with `deleted: true` so that mergeDocs()
// (a union by id where the newer version wins) propagates the deletion to other devices instead
// of resurrecting the task from their copy. Tombstones are hidden from every query and pruned by
// normalizeDoc() once they are older than TOMBSTONE_TTL_MS.

export const QUADRANTS = ['do', 'plan', 'delegate', 'delete'];
export const TIMER_MODES = ['stopwatch', 'countdown'];
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const QUADRANT_RANK = { do: 0, plan: 1, delegate: 2, delete: 3 };
const SAVE_DELAY_MS = 150;
const UNDO_LIMIT = 5; // one entry per visible Undo toast, with some slack
const EPOCH = '1970-01-01T00:00:00.000Z';
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDateKey = (value) => typeof value === 'string' && DATE_KEY_RE.test(value);
const isoAt = (ms) => new Date(ms).toISOString();

// ---------- Pure helpers ----------

export function createEmptyDoc() {
  return {
    version: 1,
    updatedAt: EPOCH,
    settings: {
      showWeekends: false,
      bannerDismissed: false,
      tipsSeen: { 1: false, 2: false, 3: false, 4: false },
    },
    tasks: [],
  };
}

function normalizeTimer(raw) {
  if (!isObject(raw) || !TIMER_MODES.includes(raw.mode)) return null;
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null;
  return {
    mode: raw.mode,
    durationSec: Number.isFinite(raw.durationSec) ? Math.max(0, raw.durationSec) : 0,
    startedAt,
    elapsedSec: Number.isFinite(raw.elapsedSec) ? Math.max(0, raw.elapsedSec) : 0,
    running: raw.running === true && startedAt !== null,
    stoppedAt: typeof raw.stoppedAt === 'string' ? raw.stoppedAt : null,
    alarmedAt: typeof raw.alarmedAt === 'string' ? raw.alarmedAt : null, // countdown alarm already raised
  };
}

/** Returns a clean task or null when the value cannot be a task (missing id / invalid date). */
function normalizeTask(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !isDateKey(raw.date)) return null;
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : EPOCH;
  const deleted = raw.deleted === true;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    date: raw.date,
    quadrant: QUADRANTS.includes(raw.quadrant) ? raw.quadrant : null,
    order: Number.isFinite(raw.order) ? raw.order : 0,
    done: raw.done === true,
    doneAt: typeof raw.doneAt === 'string' ? raw.doneAt : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : updatedAt,
    updatedAt,
    timer: normalizeTimer(raw.timer),
    // Carry-over (SPEC §2 Stage 4): `attempt` counts how many times the task has been put on a
    // day's plan; a task pulled to a later day leaves this copy behind as a record with
    // `carriedTo` set, and the new copy points back with `carriedFrom`.
    attempt: Number.isInteger(raw.attempt) && raw.attempt > 0 ? raw.attempt : 1,
    carriedTo: isDateKey(raw.carriedTo) ? raw.carriedTo : null,
    carriedFrom: typeof raw.carriedFrom === 'string' ? raw.carriedFrom : null,
    deleted,
    deletedAt: deleted ? (typeof raw.deletedAt === 'string' ? raw.deletedAt : updatedAt) : null,
  };
}

/** A task left behind on an earlier day after being pulled forward: shown as a record, never counted. */
export function isRecord(task) {
  return task.carriedTo !== null;
}

/**
 * Coerces any value into a valid doc: fills defaults, drops broken tasks, dedupes ids and prunes
 * tombstones older than TOMBSTONE_TTL_MS (`nowMs` is the reference clock, for tests).
 */
export function normalizeDoc(raw, nowMs = Date.now()) {
  const base = createEmptyDoc();
  if (!isObject(raw)) return base;
  const settings = isObject(raw.settings) ? raw.settings : {};
  const tipsSeen = isObject(settings.tipsSeen) ? settings.tipsSeen : {};
  const expired = isoAt(nowMs - TOMBSTONE_TTL_MS);
  const tasks = new Map();
  if (Array.isArray(raw.tasks)) {
    for (const item of raw.tasks) {
      const task = normalizeTask(item);
      if (task && !(task.deleted && task.deletedAt < expired)) tasks.set(task.id, task);
    }
  }
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    settings: { ...base.settings, ...settings, tipsSeen: { ...base.settings.tipsSeen, ...tipsSeen } },
    tasks: [...tasks.values()],
  };
}

/**
 * Union of tasks by id (newer updatedAt wins — so a newer tombstone beats an older live copy and
 * a later edit elsewhere revives a task); settings come from the newer doc. Pure.
 */
export function mergeDocs(a, b, nowMs = Date.now()) {
  const left = normalizeDoc(a, nowMs);
  const right = normalizeDoc(b, nowMs);
  const byId = new Map();
  for (const task of [...left.tasks, ...right.tasks]) {
    const current = byId.get(task.id);
    if (!current || task.updatedAt > current.updatedAt) byId.set(task.id, task);
  }
  const newest = right.updatedAt > left.updatedAt ? right : left;
  return {
    version: 1,
    updatedAt: newest.updatedAt,
    settings: { ...newest.settings, tipsSeen: { ...newest.settings.tipsSeen } },
    tasks: [...byId.values()],
  };
}

/** Seconds accumulated by a timer, including the live segment when it is running. */
export function timerElapsed(timer, nowMs = Date.now()) {
  if (!timer) return 0;
  const live = timer.running && timer.startedAt ? Math.max(0, (nowMs - Date.parse(timer.startedAt)) / 1000) : 0;
  return timer.elapsedSec + live;
}

/** Seconds left on a countdown (0 for stopwatches or when finished). */
export function timerRemaining(timer, nowMs = Date.now()) {
  if (!timer || timer.mode !== 'countdown') return 0;
  return Math.max(0, timer.durationSec - timerElapsed(timer, nowMs));
}

function quadrantRank(task) {
  return task.quadrant === null ? QUADRANTS.length : QUADRANT_RANK[task.quadrant];
}

function compareTasks(a, b) {
  return (
    quadrantRank(a) - quadrantRank(b) ||
    Number(isRecord(a)) - Number(isRecord(b)) ||
    Number(a.done) - Number(b.done) ||
    a.order - b.order ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function randomId(taken) {
  let id;
  do id = `t_${Math.random().toString(36).slice(2, 9)}`;
  while (taken.has(id));
  return id;
}

// ---------- Store ----------

/**
 * @param {object} [initialDoc] persisted doc (any shape is tolerated)
 * @param {{ now?: () => number }} [options] clock override for tests
 */
export function createStore(initialDoc, { now = Date.now } = {}) {
  let doc = normalizeDoc(initialDoc, now());
  const listeners = new Set();
  const errorListeners = new Set();
  const adapters = new Map(); // adapter → detach-remote function
  let undoEntries = []; // oldest first; each entry is the token handed out by undoable()
  let undoDepth = 0;
  let saveHandle = null;

  const stamp = () => isoAt(now());
  const live = (task) => !task.deleted;
  const find = (id) => doc.tasks.find((task) => task.id === id && live(task)) ?? null;

  function notify(meta) {
    for (const listener of listeners) listener(doc, meta);
  }

  function scheduleSave() {
    clearTimeout(saveHandle);
    saveHandle = setTimeout(flush, SAVE_DELAY_MS);
  }

  /**
   * Saves now to every adapter; errors go to onError listeners, never throw. `immediate` also
   * asks adapters with their own write debounce (the cloud) to write at once — for pagehide,
   * where no timer will ever fire again.
   */
  function flush({ immediate = false } = {}) {
    clearTimeout(saveHandle);
    saveHandle = null;
    const snapshot = doc;
    const saves = [...adapters.keys()].map((adapter) =>
      Promise.resolve()
        .then(() => {
          const saved = adapter.save(snapshot);
          if (immediate && typeof adapter.flush === 'function') adapter.flush();
          return saved;
        })
        .catch((error) => {
          for (const listener of errorListeners) listener(error, adapter);
        }),
    );
    return Promise.all(saves);
  }

  function commit(tasks, meta, settings = doc.settings) {
    doc = { ...doc, updatedAt: stamp(), settings, tasks };
    notify(meta);
    scheduleSave();
  }

  /** Applies `patcher(task)` to one task; returns the new task or null when the id is unknown. */
  function patchTask(id, patcher, reason) {
    const task = find(id);
    if (!task) return null;
    const next = { ...task, ...patcher(task), updatedAt: stamp() };
    commit(
      doc.tasks.map((item) => (item.id === id ? next : item)),
      { reason, id },
    );
    return next;
  }

  function stoppedTimer(timer, ms) {
    return { ...timer, elapsedSec: timerElapsed(timer, ms), startedAt: null, running: false, stoppedAt: isoAt(ms) };
  }

  /** Only one timer may be live: stops every other unfinished timer. */
  function stopOtherTimers(tasks, keepId) {
    const ms = now();
    return tasks.map((task) =>
      task.id !== keepId && task.timer && !task.timer.stoppedAt
        ? { ...task, timer: stoppedTimer(task.timer, ms), updatedAt: isoAt(ms) }
        : task,
    );
  }

  /**
   * Runs `mutate` and records, per touched task, the fields it changed (their prior values).
   * Returns a token for undo(token), or null when nothing changed. Nested calls fold into the
   * outermost one so a batch reverts as a single step.
   */
  function undoable(mutate) {
    const before = doc.tasks;
    undoDepth += 1;
    try {
      mutate();
    } finally {
      undoDepth -= 1;
    }
    if (undoDepth > 0) return null;
    const beforeById = new Map(before.map((task) => [task.id, task]));
    const changes = [];
    for (const task of doc.tasks) {
      const prior = beforeById.get(task.id);
      if (prior === task) continue;
      if (!prior) {
        changes.push({ id: task.id, patch: null, prior: null }); // created inside: undo deletes it
        continue;
      }
      const patch = {};
      for (const key of Object.keys(prior)) {
        if (key !== 'updatedAt' && prior[key] !== task[key]) patch[key] = prior[key];
      }
      changes.push({ id: task.id, patch, prior });
    }
    if (!changes.length) return null;
    undoEntries.push(changes);
    if (undoEntries.length > UNDO_LIMIT) undoEntries.shift();
    return changes;
  }

  /**
   * Reverts one recorded step. With a token, that step (each Undo toast reverts its own action);
   * without one, the most recent step, after which nothing older can be undone (single-level).
   * Only the fields the step changed are restored, so edits made since survive.
   */
  function undo(token) {
    let entry;
    if (token === undefined) {
      entry = undoEntries.pop();
      undoEntries = [];
    } else {
      const index = undoEntries.indexOf(token);
      if (index < 0) return false;
      [entry] = undoEntries.splice(index, 1);
    }
    if (!entry) return false;
    const at = stamp();
    const pending = new Map(entry.map((change) => [change.id, change]));
    const tasks = doc.tasks.map((task) => {
      const change = pending.get(task.id);
      if (!change) return task;
      pending.delete(task.id);
      if (change.patch === null) return { ...task, deleted: true, deletedAt: at, updatedAt: at };
      return { ...task, ...change.patch, updatedAt: at };
    });
    const revived = [...pending.values()].filter((change) => change.prior).map((change) => ({ ...change.prior, updatedAt: at }));
    commit([...tasks, ...revived], { reason: 'undo' });
    return true;
  }

  function nextOrder() {
    const maxOrder = doc.tasks.reduce((max, task) => Math.max(max, task.order), 0);
    return Math.max(now(), maxOrder + 1);
  }

  const store = {
    get: () => doc,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Reports adapter save failures: listener(error, adapter). */
    onError(listener) {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },

    /** Swaps the whole doc (remote change). Notifies subscribers but never saves. */
    replace(nextDoc) {
      doc = normalizeDoc(nextDoc, now());
      notify({ reason: 'replace' });
    },

    /** Swaps the whole doc AND persists it (used by the local "load demo data" action). */
    importDoc(nextDoc) {
      const clean = normalizeDoc(nextDoc, now());
      commit(clean.tasks, { reason: 'import' }, clean.settings);
    },

    /** The live (not deleted) task with this id, or null. */
    findTask: find,

    addTask({ title, date, quadrant = null, attempt = 1, carriedFrom = null }) {
      if (!isDateKey(date)) throw new Error(`addTask: invalid date "${date}"`);
      const at = stamp();
      const task = {
        id: randomId(new Set(doc.tasks.map((item) => item.id))),
        title: String(title ?? '').trim(),
        date,
        quadrant: QUADRANTS.includes(quadrant) ? quadrant : null,
        order: nextOrder(),
        done: false,
        doneAt: null,
        createdAt: at,
        updatedAt: at,
        timer: null,
        attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
        carriedTo: null,
        carriedFrom: typeof carriedFrom === 'string' ? carriedFrom : null,
        deleted: false,
        deletedAt: null,
      };
      commit([...doc.tasks, task], { reason: 'addTask', id: task.id });
      return task;
    },

    /**
     * Unfinished tasks left on days before `date` that were actually **placed in a quadrant** —
     * not done, not already carried forward, not in the DELETE quadrant, and not still sitting in
     * the waiting list (`quadrant === null`) — oldest day first. These are what "Pull them here"
     * offers: only committed, unfinished work carries forward, so a task left in a waiting list
     * stays put and is never pulled again once it lands in one.
     */
    unfinishedBefore(date) {
      return doc.tasks
        .filter((task) => live(task) && !isRecord(task) && !task.done && task.quadrant !== null && task.quadrant !== 'delete' && task.date < date)
        .sort((a, b) => a.date.localeCompare(b.date) || compareTasks(a, b));
    },

    /**
     * Pulls tasks forward to `date`: each gets a fresh copy there (in the waiting list, attempt + 1)
     * while the original stays on its day as a record (`carriedTo`) that no longer counts.
     * One undo token reverts the whole batch.
     */
    carryOver(ids, date) {
      if (!isDateKey(date)) throw new Error(`carryOver: invalid date "${date}"`);
      return undoable(() => {
        for (const id of ids) {
          const task = find(id);
          if (!task || isRecord(task) || task.date >= date) continue;
          store.addTask({ title: task.title, date, attempt: task.attempt + 1, carriedFrom: task.id });
          patchTask(id, () => ({ carriedTo: date }), 'carryOver');
        }
      });
    },

    /** Generic patch; unknown fields are dropped and invalid values are ignored. */
    updateTask(id, patch) {
      return patchTask(
        id,
        (task) => {
          const merged = normalizeTask({ ...task, ...patch, id: task.id });
          return merged ?? {};
        },
        'updateTask',
      );
    },

    /** Tombstones the task (stops its timer); the task disappears from every query. Returns an undo token. */
    removeTask(id) {
      return undoable(() => {
        if (!find(id)) return;
        const ms = now();
        commit(
          doc.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  timer: task.timer && !task.timer.stoppedAt ? stoppedTimer(task.timer, ms) : task.timer,
                  deleted: true,
                  deletedAt: isoAt(ms),
                  updatedAt: isoAt(ms),
                }
              : task,
          ),
          { reason: 'removeTask', id },
        );
      });
    },

    // Placing a task in a quadrant also stamps it with the day it was placed on (the waiting list is
    // a global backlog, so an item can be placed from any day). Sending it back to the list
    // (quadrant null) leaves its date untouched.
    setQuadrant(id, quadrant, date = null) {
      const next = QUADRANTS.includes(quadrant) ? quadrant : null;
      return undoable(() => patchTask(id, () => (next !== null && isDateKey(date) ? { quadrant: next, date } : { quadrant: next }), 'setQuadrant'));
    },

    /** Marking done also stops a live timer on that task. */
    toggleDone(id, done) {
      return patchTask(
        id,
        (task) => {
          const next = typeof done === 'boolean' ? done : !task.done;
          const stopTimer = next && task.timer && !task.timer.stoppedAt;
          return {
            done: next,
            doneAt: next ? stamp() : null,
            timer: stopTimer ? stoppedTimer(task.timer, now()) : task.timer,
          };
        },
        'toggleDone',
      );
    },

    moveTaskToDate(id, date) {
      if (!isDateKey(date)) throw new Error(`moveTaskToDate: invalid date "${date}"`);
      return undoable(() => patchTask(id, () => ({ date }), 'moveTaskToDate'));
    },

    reorderTask(id, order) {
      if (!Number.isFinite(order)) return;
      patchTask(id, () => ({ order }), 'reorderTask');
    },

    /** Tasks of a day sorted by quadrant (do, plan, delegate, delete, unsorted), done last, then order. */
    tasksForDate(date) {
      return doc.tasks.filter((task) => task.date === date && live(task)).sort(compareTasks);
    },

    /**
     * The waiting list is a single global backlog: every unplaced task (quadrant === null), from any
     * day, shown on every day and on "Write it all down". An item stays until it is placed in a
     * quadrant, ticked done, or deleted. Records (carried-forward originals) are history.
     */
    waitingTasks() {
      return doc.tasks
        .filter((task) => live(task) && !isRecord(task) && task.quadrant === null && !task.done)
        .sort(compareTasks);
    },

    /**
     * Every open task, from any day, in one list — what Stage 3 prioritises against. Unplaced
     * backlog items and tasks already placed on some day both appear; finished ones and records
     * (carried-forward originals) do not. Independent of the selected day.
     */
    allTasks() {
      return doc.tasks
        .filter((task) => live(task) && !isRecord(task) && !task.done)
        .sort(compareTasks);
    },

    /** Counts for a day — only tasks actually placed in a quadrant count; the global waiting-list
     *  backlog belongs to no single day, and records (carried to a later day) are left out. */
    statsForDate(date) {
      const tasks = doc.tasks.filter((task) => task.date === date && live(task) && !isRecord(task) && task.quadrant !== null);
      return {
        total: tasks.length,
        done: tasks.filter((task) => task.done).length,
      };
    },

    setSetting(key, value) {
      commit(doc.tasks, { reason: 'setSetting', key }, { ...doc.settings, [key]: value });
    },

    undo,
    /** True when undo() has something to revert (or, with a token, when that step still can be). */
    canUndo: (token) => (token === undefined ? undoEntries.length > 0 : undoEntries.includes(token)),
    /** Wraps any batch of mutations so a single undo reverts all of them; returns the undo token. */
    undoable,

    // ----- timers -----

    startTimer(id, { mode = 'stopwatch', durationSec = 0 } = {}) {
      if (!TIMER_MODES.includes(mode)) throw new Error(`startTimer: unknown mode "${mode}"`);
      const task = find(id);
      if (!task) return null;
      const at = stamp();
      const timer = {
        mode,
        durationSec: mode === 'countdown' ? Math.max(1, Math.round(durationSec)) : 0,
        startedAt: at,
        elapsedSec: 0,
        running: true,
        stoppedAt: null,
        alarmedAt: null,
      };
      const next = { ...task, timer, updatedAt: at };
      commit(
        stopOtherTimers(doc.tasks, id).map((item) => (item.id === id ? next : item)),
        { reason: 'startTimer', id },
      );
      return next;
    },

    pauseTimer(id) {
      const task = find(id);
      if (!task?.timer?.running) return null;
      return patchTask(
        id,
        ({ timer }) => ({ timer: { ...timer, elapsedSec: timerElapsed(timer, now()), startedAt: null, running: false } }),
        'pauseTimer',
      );
    },

    // Resumes a paused OR a stopped timer, keeping its accumulated time (a stopped timer's
    // stoppedAt is cleared so "Continue" picks up where it left off). Only one timer runs at a time.
    resumeTimer(id) {
      const task = find(id);
      if (!task?.timer || task.timer.running) return null;
      const at = stamp();
      const next = { ...task, timer: { ...task.timer, startedAt: at, running: true, stoppedAt: null }, updatedAt: at };
      commit(
        stopOtherTimers(doc.tasks, id).map((item) => (item.id === id ? next : item)),
        { reason: 'resumeTimer', id },
      );
      return next;
    },

    stopTimer(id) {
      const task = find(id);
      if (!task?.timer || task.timer.stoppedAt) return null;
      return patchTask(id, ({ timer }) => ({ timer: stoppedTimer(timer, now()) }), 'stopTimer');
    },

    /** Records that the countdown alarm was raised, so a reload does not raise it again. */
    markTimerAlarmed(id) {
      const task = find(id);
      if (!task?.timer || task.timer.alarmedAt) return null;
      return patchTask(id, ({ timer }) => ({ timer: { ...timer, alarmedAt: stamp() } }), 'alarmTimer');
    },

    /** The live task whose timer is running or paused (not stopped), or null. */
    activeTimer() {
      return doc.tasks.find((task) => live(task) && task.timer && !task.timer.stoppedAt) ?? null;
    },

    // ----- persistence -----

    /** Adds a save target; wires adapter.onRemote (merge by default). Returns a detach function. */
    attach(adapter) {
      const detachRemote =
        typeof adapter.onRemote === 'function'
          ? adapter.onRemote((remoteDoc, { merge = true } = {}) =>
              store.replace(merge ? mergeDocs(doc, remoteDoc, now()) : remoteDoc),
            )
          : null;
      adapters.set(adapter, detachRemote);
      return () => store.detach(adapter);
    },

    detach(adapter) {
      const detachRemote = adapters.get(adapter);
      if (typeof detachRemote === 'function') detachRemote();
      adapters.delete(adapter);
    },

    flush,
    mergeDocs,
  };

  return store;
}
