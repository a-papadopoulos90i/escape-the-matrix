// localStorage adapter. Falls back to an in-memory map when storage is missing or blocked (private
// mode) and never throws on corrupt values. A full quota is not a reason to fall back: the saved
// document must stay readable, and a failed write is reported through save() rejecting so the
// app can warn the user.

export const DOC_KEY = 'escape-the-matrix:v1';
export const UI_KEY = 'escape-the-matrix:ui';
// Which account this browser's copy belongs to, and the copies of other accounts that signed in here
// before (set aside, never mixed in, handed back when that account signs in again).
export const OWNER_KEY = 'escape-the-matrix:owner';
const STASH_PREFIX = 'escape-the-matrix:v1:';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDocLike = (value) => isObject(value) && Array.isArray(value.tasks);

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

/** Returns window.localStorage only when it can actually be read (access may throw when blocked). */
function usableLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    storage.getItem('__etm_probe__');
    return storage;
  } catch {
    return null;
  }
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function createLocalAdapter() {
  const native = usableLocalStorage();
  const storage = native ?? memoryStorage();

  return {
    name: 'local',
    /** False when running on the in-memory fallback (nothing survives a reload). */
    persistent: native !== null,

    async load() {
      const doc = readJson(storage, DOC_KEY);
      return isDocLike(doc) ? doc : null;
    },

    async save(doc) {
      if (!writeJson(storage, DOC_KEY, doc)) throw new Error('localStorage write failed');
    },

    /** Per-device UI state ({ selectedDate, stage, calendarMonth }); never synced. */
    loadUi() {
      const ui = readJson(storage, UI_KEY);
      return isObject(ui) ? ui : {};
    },

    saveUi(ui) {
      writeJson(storage, UI_KEY, ui);
    },

    /** The uid this browser's copy belongs to (null: tasks written signed out, never tied to an account). */
    owner() {
      try {
        return storage.getItem(OWNER_KEY) || null;
      } catch {
        return null;
      }
    },

    /** Ties this browser's copy to an account (null: it belongs to no account — signed out). */
    setOwner(uid) {
      try {
        if (uid) storage.setItem(OWNER_KEY, uid);
        else storage.removeItem(OWNER_KEY);
      } catch {
        /* storage blocked — nothing to remember */
      }
    },

    /** Sets another account's copy aside until it signs in here again. */
    stash(uid, doc) {
      writeJson(storage, STASH_PREFIX + uid, doc);
    },

    /** The copy set aside for this key, left where it is (null when there is none). */
    peekStash(uid) {
      const doc = readJson(storage, STASH_PREFIX + uid);
      return isDocLike(doc) ? doc : null;
    },

    /** The copy set aside for this account (once), or null. */
    takeStash(uid) {
      const doc = readJson(storage, STASH_PREFIX + uid);
      try {
        storage.removeItem(STASH_PREFIX + uid);
      } catch {
        /* nothing to remove */
      }
      return isDocLike(doc) ? doc : null;
    },

    clear() {
      try {
        storage.removeItem(DOC_KEY);
        storage.removeItem(UI_KEY);
        storage.removeItem(OWNER_KEY);
        // Every account's set-aside copy goes too: "clear this device" means all of it.
        if (native) {
          const stashed = [];
          for (let i = 0; i < native.length; i += 1) if (native.key(i)?.startsWith(STASH_PREFIX)) stashed.push(native.key(i));
          stashed.forEach((key) => native.removeItem(key));
        }
      } catch {
        /* nothing to clear */
      }
    },

    /**
     * Cross-tab updates: another tab wrote the doc — or removed it ("Sign out & clear this
     * device", cleared site data). Delivered as a full replacement (no merge); a removal replaces
     * the doc with an empty one so the other tab cannot write the cleared data back.
     */
    onRemote(callback) {
      if (!native || typeof window === 'undefined') return () => {};
      const handler = (event) => {
        if (event.storageArea !== native || (event.key !== null && event.key !== DOC_KEY)) return; // key null = storage.clear()
        const raw = native.getItem(DOC_KEY);
        if (raw === null) return callback({ tasks: [] }, { merge: false }); // removed by the other tab
        const doc = readJson(native, DOC_KEY);
        if (isDocLike(doc)) callback(doc, { merge: false });
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}
