// localStorage adapter. Falls back to an in-memory map when storage is missing, blocked (private
// mode) or full, and never throws on corrupt values.

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

/** Returns window.localStorage only when it can actually be written to. */
function usableLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    const probe = '__etm_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
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

    /** Cross-tab updates: another tab wrote the doc. Delivered as a full replacement (no merge). */
    onRemote(callback) {
      if (!native || typeof window === 'undefined') return () => {};
      const handler = (event) => {
        if (event.key !== DOC_KEY || event.storageArea !== native) return;
        const doc = readJson(native, DOC_KEY);
        if (isDocLike(doc)) callback(doc, { merge: false });
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}
