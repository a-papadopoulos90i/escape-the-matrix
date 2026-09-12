// localStorage adapter. Falls back to an in-memory map when storage is missing or blocked (private
// mode) and never throws on corrupt values. A full quota is not a reason to fall back: the saved
// document must stay readable, and a failed write is reported through save() rejecting so the
// app can warn the user.

export const DOC_KEY = 'escape-the-matrix:v1';
export const UI_KEY = 'escape-the-matrix:ui';

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

    clear() {
      try {
        storage.removeItem(DOC_KEY);
        storage.removeItem(UI_KEY);
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
