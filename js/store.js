// Immutable document store (SPEC §4/§5). Every mutation builds a new doc, stamps `updatedAt` on
// the touched tasks and the doc, notifies subscribers and schedules a debounced save to every
// attached adapter. No DOM access — the same code runs in the browser and in node tests.

export const QUADRANTS = ['do', 'plan', 'delegate', 'delete'];
export const TIMER_MODES = ['stopwatch', 'countdown'];

const QUADRANT_RANK = { do: 0, plan: 1, delegate: 2, delete: 3 };
const SAVE_DELAY_MS = 150;
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
      tipsSeen: { 1: false, 2: false, 3: false, 4: false, 5: false },
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
  };
}

/** Returns a clean task or null when the value cannot be a task (missing id / invalid date). */
function normalizeTask(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || !isDateKey(raw.date)) return null;
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : EPOCH;
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
  };
}

/** Coerces any value into a valid doc: fills defaults, drops broken tasks, dedupes ids. */
export function normalizeDoc(raw) {
  const base = createEmptyDoc();
  if (!isObject(raw)) return base;
  const settings = isObject(raw.settings) ? raw.settings : {};
  const tipsSeen = isObject(settings.tipsSeen) ? settings.tipsSeen : {};
  const tasks = new Map();
  if (Array.isArray(raw.tasks)) {
    for (const item of raw.tasks) {
      const task = normalizeTask(item);
      if (task) tasks.set(task.id, task);
    }
  }
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    settings: { ...base.settings, ...settings, tipsSeen: { ...base.settings.tipsSeen, ...tipsSeen } },
    tasks: [...tasks.values()],
  };
}

/** Union of tasks by id (newer updatedAt wins); settings come from the newer doc. Pure. */
export function mergeDocs(a, b) {
  const left = normalizeDoc(a);
  const right = normalizeDoc(b);
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
  let doc = normalizeDoc(initialDoc);
  const listeners = new Set();
  const errorListeners = new Set();
  const adapters = new Map(); // adapter → detach-remote function
  let undoEntry = null;
  let saveHandle = null;

  const stamp = () => isoAt(now());
  const find = (id) => doc.tasks.find((task) => task.id === id) ?? null;

  function notify(meta) {
    for (const listener of listeners) listener(doc, meta);
  }

  function scheduleSave() {
    clearTimeout(saveHandle);
    saveHandle = setTimeout(flush, SAVE_DELAY_MS);
  }

  /** Saves immediately to every adapter; errors go to onError listeners, never throw. */
  function flush() {
    clearTimeout(saveHandle);
    saveHandle = null;
    const snapshot = doc;
    const saves = [...adapters.keys()].map((adapter) =>
      Promise.resolve()
        .then(() => adapter.save(snapshot))
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

  /** Runs `mutate` and remembers the prior state of every task it touched, for undo(). */
  function undoable(mutate) {
    const before = doc.tasks;
    mutate();
    const beforeById = new Map(before.map((task) => [task.id, task]));
    const afterIds = new Set(doc.tasks.map((task) => task.id));
    const changed = [];
    for (const task of doc.tasks) {
      if (beforeById.get(task.id) !== task) changed.push({ id: task.id, task: beforeById.get(task.id) ?? null });
    }
    for (const task of before) {
      if (!afterIds.has(task.id)) changed.push({ id: task.id, task });
    }
    if (changed.length) undoEntry = changed;
  }

  function undo() {
    if (!undoEntry) return false;
    const entry = undoEntry;
    undoEntry = null;
    const at = stamp();
    const restore = new Map(entry.map(({ id, task }) => [id, task]));
    const kept = doc.tasks
      .filter((task) => !(restore.has(task.id) && restore.get(task.id) === null))
      .map((task) => (restore.has(task.id) ? { ...restore.get(task.id), updatedAt: at } : task));
    const present = new Set(kept.map((task) => task.id));
    const revived = entry
      .filter(({ id, task }) => task && !present.has(id))
      .map(({ task }) => ({ ...task, updatedAt: at }));
    commit([...kept, ...revived], { reason: 'undo' });
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
      doc = normalizeDoc(nextDoc);
      notify({ reason: 'replace' });
    },

    addTask({ title, date, quadrant = null }) {
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
      };
      commit([...doc.tasks, task], { reason: 'addTask', id: task.id });
      return task;
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

    removeTask(id) {
      undoable(() => {
        if (!find(id)) return;
        commit(
          doc.tasks.filter((task) => task.id !== id),
          { reason: 'removeTask', id },
        );
      });
    },

    setQuadrant(id, quadrant) {
      const next = QUADRANTS.includes(quadrant) ? quadrant : null;
      undoable(() => patchTask(id, () => ({ quadrant: next }), 'setQuadrant'));
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
      undoable(() => patchTask(id, () => ({ date }), 'moveTaskToDate'));
    },

    reorderTask(id, order) {
      if (!Number.isFinite(order)) return;
      patchTask(id, () => ({ order }), 'reorderTask');
    },

    /** Tasks of a day sorted by quadrant (do, plan, delegate, delete, unsorted), done last, then order. */
    tasksForDate(date) {
      return doc.tasks.filter((task) => task.date === date).sort(compareTasks);
    },

    statsForDate(date) {
      const tasks = doc.tasks.filter((task) => task.date === date);
      return { total: tasks.length, done: tasks.filter((task) => task.done).length };
    },

    setSetting(key, value) {
      commit(doc.tasks, { reason: 'setSetting', key }, { ...doc.settings, [key]: value });
    },

    undo,
    canUndo: () => undoEntry !== null,
    /** Wraps any batch of mutations so a single undo() reverts all of them. */
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

    resumeTimer(id) {
      const task = find(id);
      if (!task?.timer || task.timer.running || task.timer.stoppedAt) return null;
      const at = stamp();
      const next = { ...task, timer: { ...task.timer, startedAt: at, running: true }, updatedAt: at };
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

    /** The task whose timer is running or paused (not stopped), or null. */
    activeTimer() {
      return doc.tasks.find((task) => task.timer && !task.timer.stoppedAt) ?? null;
    },

    // ----- persistence -----

    /** Adds a save target; wires adapter.onRemote (merge by default). Returns a detach function. */
    attach(adapter) {
      const detachRemote =
        typeof adapter.onRemote === 'function'
          ? adapter.onRemote((remoteDoc, { merge = true } = {}) =>
              store.replace(merge ? mergeDocs(doc, remoteDoc) : remoteDoc),
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
