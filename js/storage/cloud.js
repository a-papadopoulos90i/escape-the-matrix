// Firestore adapter (SPEC §5). One document per user — users/{uid} = { doc, updatedAt, email } —
// where `doc` is the exact persisted document shape and `updatedAt` is the ISO write time.
//
// Rules of the road:
// - Writes are debounced and coalesced; save() never rejects (failures surface via onStatus).
// - Nothing is written before the server state has been read once (load() or the first server
//   snapshot), so a device that starts offline cannot blindly overwrite the account.
// - A snapshot is applied only when it is newer than the version this device last wrote or
//   applied; echoes of our own writes (`hasPendingWrites`) and stale cached copies are skipped.
// - reconcile(doc) writes the local document back when it holds something the server lacks
//   (e.g. the union produced by a merge) so every device converges on the same document.
// The Firestore functions are injected so unit tests run without the SDK.
import { normalizeDoc } from '../store.js';

const SAVE_DELAY_MS = 400;
const USERS_COLLECTION = 'users';

const defaultIsOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Content fingerprint of a document: task order and envelope timestamps do not matter. */
export function docSignature(doc) {
  const { settings, tasks } = normalizeDoc(doc);
  const sorted = [...tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({ settings, tasks: sorted });
}

/** Reads { doc, updatedAt } from a snapshot; null when the document is missing or malformed. */
function readEnvelope(snapshot) {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!data || typeof data.doc !== 'object' || data.doc === null) return null;
  return { doc: data.doc, updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '' };
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
  const { doc, getDoc, setDoc, onSnapshot } = firestore;
  const ref = doc(db, USERS_COLLECTION, uid);

  let syncedAt = ''; // envelope updatedAt of the newest version we wrote or applied
  let remoteSig = null; // signature of the doc we believe the server holds
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

  async function write(docToWrite) {
    const updatedAt = nextStamp();
    syncedAt = updatedAt;
    remoteSig = docSignature(docToWrite);
    try {
      await setDoc(ref, { doc: docToWrite, updatedAt, email });
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
    if (!envelope || envelope.updatedAt <= syncedAt) return;
    syncedAt = envelope.updatedAt;
    remoteSig = docSignature(envelope.doc);
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
        const envelope = readEnvelope(await getDoc(ref));
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
      if (docSignature(localDoc) === remoteSig) return;
      if (!normalizeDoc(localDoc).tasks.length && remoteSig !== null && remoteSig !== docSignature(null)) return;
      save(localDoc);
    },

    /** Live updates: callback(remoteDoc) for every newer server version. Returns unsubscribe. */
    onRemote(callback) {
      unsubscribe?.();
      unsubscribe = onSnapshot(
        ref,
        (snapshot) => {
          const fromServer = !snapshot.metadata?.fromCache;
          if (!snapshot.metadata?.hasPendingWrites) applyEnvelope(readEnvelope(snapshot), callback);
          if (fromServer) markRemoteKnown();
          report();
        },
        (error) => {
          lastError = error;
          report();
        },
      );
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
