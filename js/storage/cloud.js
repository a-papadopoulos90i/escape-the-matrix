// Firestore adapter (SPEC §5). One account = a root document plus one document per month of tasks:
//   users/{uid}                 = { format: 2, settings, updatedAt, email }
//   users/{uid}/months/{key}    = { tasks: [...], updatedAt }      key = 'YYYY-MM' (task.date) or 'undated'
// so no single document approaches Firestore's 1 MiB limit (one month would need ~2,300 tasks). Every
// write is one batch — the root (its updatedAt is the version) plus only the months whose tasks changed —
// so a task moving between months moves atomically. Accounts still in the old single-document format
// ({ doc, updatedAt, email }) are read as before and move to months with their next write.
//
// Rules of the road:
// - Writes are debounced and coalesced; save() never rejects (failures surface via onStatus).
// - Nothing is written before the server state has been read once (load() or the first server
//   snapshot), so a device that starts offline cannot blindly overwrite the account.
// - A snapshot is applied only when it is newer than the version this device last wrote or
//   applied (or the same version with content not yet seen — the root and the months arrive as
//   separate snapshots); echoes of our own writes (`hasPendingWrites`) and stale copies are skipped.
// - reconcile(doc) writes the local document back when it holds something the server lacks
//   (e.g. the union produced by a merge) so every device converges on the same document.
// The Firestore functions are injected so unit tests run without the SDK.
import { normalizeDoc } from '../store.js';

const SAVE_DELAY_MS = 400;
const USERS_COLLECTION = 'users';
const MONTHS = 'months';
const FORMAT = 2;

/** Which month document a task lives in. */
export const monthOf = (task) => (/^\d{4}-\d{2}-\d{2}$/.test(task?.date ?? '') ? task.date.slice(0, 7) : 'undated');

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The doc's tasks split into months: Map key → tasks sorted by id (stable, so equal months compare equal). */
export function monthsOf(doc) {
  const months = new Map();
  for (const task of normalizeDoc(doc).tasks) {
    const key = monthOf(task);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(task);
  }
  for (const tasks of months.values()) tasks.sort(byId);
  return months;
}

const monthSignature = (tasks) => JSON.stringify(tasks);

/** One task list from several sources: the same id twice keeps the newer copy (a task caught moving). */
function uniteTasks(lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const task of list ?? []) {
      const known = byKey.get(task?.id);
      if (!task?.id || (known && (known.updatedAt ?? '') >= (task.updatedAt ?? ''))) continue;
      byKey.set(task.id, task);
    }
  }
  return [...byKey.values()];
}

const defaultIsOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Content fingerprint of a document: task order and envelope timestamps do not matter. */
export function docSignature(doc) {
  const { settings, tasks } = normalizeDoc(doc);
  const sorted = [...tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({ settings, tasks: sorted });
}

/**
 * The account as one { doc, updatedAt } from the root document and its months (either may be missing).
 * An old single-document account brings its whole doc in `root.doc`; months written since join it.
 */
function assemble(root, months) {
  const legacy = root && typeof root.doc === 'object' && root.doc !== null ? root.doc : null;
  if (!root && !months.size) return null;
  if (root && !legacy && root.format !== FORMAT && !months.size) return null; // malformed
  const settings = (legacy?.settings ?? root?.settings) || {};
  const tasks = uniteTasks([legacy?.tasks, ...months.values()]);
  const updatedAt = typeof root?.updatedAt === 'string' ? root.updatedAt : '';
  return { doc: { version: 1, updatedAt, settings, tasks }, updatedAt };
}

/** Month documents from a query snapshot: Map key → tasks. */
function readMonths(querySnapshot) {
  const months = new Map();
  for (const item of querySnapshot?.docs ?? []) {
    const tasks = item.data()?.tasks;
    if (Array.isArray(tasks)) months.set(item.id, tasks);
  }
  return months;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * @param {object} options
 * @param {object} options.db Firestore instance
 * @param {string} options.uid signed-in user id (document id)
 * @param {string|null} [options.email] stored next to the doc for readability in the console
 * @param {{ doc, getDoc, setDoc, onSnapshot }} options.firestore modular SDK functions
 * @param {(status: 'synced'|'syncing'|'offline'|'error', error?: Error) => void} [options.onStatus]
 */
export function createCloudAdapter({
  db,
  uid,
  email = null,
  firestore,
  onStatus,
  saveDelayMs = SAVE_DELAY_MS,
  isOnline = defaultIsOnline,
  now = Date.now,
}) {
  const { doc, collection, getDoc, getDocs, onSnapshot, writeBatch } = firestore;
  const ref = doc(db, USERS_COLLECTION, uid);
  const monthsRef = collection(db, USERS_COLLECTION, uid, MONTHS);
  const monthRef = (key) => doc(db, USERS_COLLECTION, uid, MONTHS, key);

  let syncedAt = ''; // envelope updatedAt of the newest version we wrote or applied
  let remoteSig = null; // signature of the doc we believe the server holds
  let remoteMonths = new Map(); // key → signature of each month document the server holds
  let oldFormat = false; // the account is still one whole document: rewrite it as months at the first chance
  let rootLatest = null; // last root data seen by the listener (pending writes included)
  let monthsLatest = new Map(); // last month documents seen by the listener (pending writes included)
  let remoteKnown = false; // true once the server state has been read at least once
  let loading = false; // true while load() is fetching the server document
  let queued = null; // latest doc waiting to be written
  let pending = null; // deferred resolved when `queued` has been written
  let timer = null;
  let writing = null; // promise of the write in flight
  let lastError = null;
  let reported = null;
  let unsubscribe = null;
  let disposed = false;

  // ----- status -----

  function status() {
    if (!isOnline()) return 'offline';
    if (lastError) return 'error';
    return loading || queued !== null || writing ? 'syncing' : 'synced';
  }

  function report() {
    const next = status();
    if (next === reported) return;
    reported = next;
    onStatus?.(next, next === 'error' ? lastError : undefined);
  }

  // ----- writing -----

  /** ISO write stamp, kept strictly newer than anything we have seen (guards clock skew). */
  function nextStamp() {
    const wall = new Date(now()).toISOString();
    if (wall > syncedAt) return wall;
    const parsed = Date.parse(syncedAt);
    return Number.isNaN(parsed) ? wall : new Date(parsed + 1).toISOString();
  }

  /** One batch: the root (new version) and only the months whose tasks changed; emptied months go. */
  async function write(docToWrite) {
    const updatedAt = nextStamp();
    syncedAt = updatedAt;
    remoteSig = docSignature(docToWrite);
    const months = monthsOf(docToWrite);
    const written = new Map();
    const batch = writeBatch(db);
    batch.set(ref, { format: FORMAT, settings: normalizeDoc(docToWrite).settings, updatedAt, email }); // drops an old `doc`
    for (const [key, tasks] of months) {
      const signature = monthSignature(tasks);
      written.set(key, signature);
      if (remoteMonths.get(key) !== signature) batch.set(monthRef(key), { tasks, updatedAt });
    }
    for (const key of remoteMonths.keys()) if (!months.has(key)) batch.delete(monthRef(key));
    try {
      await batch.commit();
      remoteMonths = written;
      oldFormat = false;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
  }

  /** Writes the queued doc now (after any write in flight); drains anything queued meanwhile. */
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (writing) await writing;
    if (queued === null || !remoteKnown || disposed) return;
    const next = queued;
    const done = pending;
    queued = null;
    pending = null;
    writing = write(next);
    report();
    await writing;
    writing = null;
    done.resolve();
    report();
    if (queued !== null) await flush();
  }

  function save(docToSave) {
    if (disposed) return Promise.resolve();
    queued = docToSave;
    pending ??= deferred();
    clearTimeout(timer);
    timer = setTimeout(flush, saveDelayMs);
    report();
    return pending.promise;
  }

  // ----- reading -----

  function markRemoteKnown() {
    if (remoteKnown) return;
    remoteKnown = true;
    if (queued !== null) flush();
  }

  /**
   * Applies a server envelope when it is newer than what we last wrote or applied. A doc queued
   * before this version arrived (e.g. the local copy reconciled while load() was offline) is
   * dropped first: the merge the callback performs re-queues whatever the local side still adds,
   * so the stale pre-merge doc can never overwrite the newer server copy.
   */
  function applyEnvelope(envelope, callback) {
    if (!envelope || envelope.updatedAt < syncedAt) return;
    const signature = docSignature(envelope.doc);
    if (envelope.updatedAt === syncedAt && signature === remoteSig) return; // nothing new in this version
    syncedAt = envelope.updatedAt;
    remoteSig = signature;
    if (queued !== null) {
      queued = null;
      pending?.resolve();
      pending = null;
    }
    callback(envelope.doc);
  }

  const adapter = {
    name: 'cloud',

    async load() {
      loading = true;
      report();
      try {
        const [rootSnapshot, monthsSnapshot] = await Promise.all([getDoc(ref), getDocs(monthsRef)]);
        const months = readMonths(monthsSnapshot);
        remoteMonths = new Map([...months].map(([key, tasks]) => [key, monthSignature([...tasks].sort(byId))]));
        const root = rootSnapshot.exists() ? rootSnapshot.data() : null;
        oldFormat = Boolean(root && typeof root.doc === 'object' && root.doc !== null);
        const envelope = assemble(root, months);
        remoteKnown = true;
        lastError = null;
        if (!envelope) {
          remoteSig = docSignature(null);
          return null;
        }
        if (envelope.updatedAt > syncedAt) syncedAt = envelope.updatedAt;
        remoteSig = docSignature(envelope.doc);
        return envelope.doc;
      } catch (error) {
        lastError = error;
        return null;
      } finally {
        loading = false;
        report();
      }
    },

    save,
    flush,

    /**
     * Writes `localDoc` unless the server already holds the same content. A merge result can only
     * be empty when the server holds nothing, so an empty doc (a device that was just cleared)
     * is never reconciled over an account that has tasks.
     */
    reconcile(localDoc) {
      if (docSignature(localDoc) === remoteSig && !oldFormat) return; // an old-format account is rewritten anyway
      if (!normalizeDoc(localDoc).tasks.length && remoteSig !== null && remoteSig !== docSignature(null)) return;
      save(localDoc);
    },

    /**
     * Live updates: callback(remoteDoc) for every newer server version. The root and the months are two
     * listeners; each snapshot re-assembles the account from the latest of both. Returns unsubscribe.
     */
    onRemote(callback) {
      unsubscribe?.();
      const failed = (error) => {
        lastError = error;
        report();
      };
      const changed = (snapshot) => {
        if (!snapshot.metadata?.hasPendingWrites) {
          remoteMonths = new Map([...monthsLatest].map(([key, tasks]) => [key, monthSignature([...tasks].sort(byId))]));
          applyEnvelope(assemble(rootLatest, monthsLatest), callback);
        }
        if (!snapshot.metadata?.fromCache) markRemoteKnown();
        report();
      };
      const stopRoot = onSnapshot(
        ref,
        (snapshot) => {
          rootLatest = snapshot.exists() ? snapshot.data() : null;
          changed(snapshot);
        },
        failed,
      );
      const stopMonths = onSnapshot(
        monthsRef,
        (snapshot) => {
          monthsLatest = readMonths(snapshot);
          changed(snapshot);
        },
        failed,
      );
      unsubscribe = () => {
        stopRoot();
        stopMonths();
      };
      return () => {
        unsubscribe?.();
        unsubscribe = null;
      };
    },

    /** Recomputes the status (call on online/offline events). */
    refreshStatus: report,

    /** Stops listening and drops queued writes; resolves anyone still awaiting save(). */
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      queued = null;
      pending?.resolve();
      pending = null;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', report);
        window.removeEventListener('offline', report);
      }
    },
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', report);
    window.addEventListener('offline', report);
  }

  return adapter;
}
