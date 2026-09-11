// Account area (SPEC §3, §5). Free mode renders "Sign in with Google"; Google mode renders the
// avatar + first name + menu (sync status, Sign out, Sign out & clear this device) and wires the
// Firebase session: on sign-in the local document is merged into the account, then every save is
// written to Firestore *and* localStorage while Firestore snapshots flow back into the store.
// The Firebase SDK is imported lazily and only when a config exists, so free mode never loads it.
import { firebaseConfig } from './firebase-config.js';
import { createEmptyDoc } from './store.js';
import { createLocalAdapter } from './storage/local.js';
import { createCloudAdapter } from './storage/cloud.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_MODULES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'];
const CANCELLED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
const STATUS_KEYS = { synced: 'account.synced', syncing: 'account.syncing', offline: 'account.offline', error: 'account.syncError' };
const FLUSH_TIMEOUT_MS = 3000; // a save stuck offline must not block signing out (localStorage has the data)

/** Loads the Firebase v10 modular SDK from gstatic and returns its functions as one flat object. */
export async function loadFirebase() {
  const modules = await Promise.all(SDK_MODULES.map((file) => import(SDK_BASE + file)));
  return Object.assign({}, ...modules);
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

function firstName(user) {
  const name = (user.displayName || '').trim();
  return name.split(/\s+/)[0] || (user.email || '').split('@')[0] || '?';
}

// ---------- View ----------

/**
 * Renders the account slot. showSignedOut() → Google button; showSignedIn(user, status) → avatar,
 * first name and a status dot that opens the account menu. setStatus() updates in place.
 */
export function createAccountView({ slot, ui, i18n, onSignIn, onSignOut, onSignOutClear }) {
  const { t } = i18n;
  let user = null;
  let status = 'syncing';
  let menu = null;
  let statusNodes = []; // [dot, label] pairs currently on screen

  const statusLabel = () => t(STATUS_KEYS[status] ?? STATUS_KEYS.syncing);

  function avatar(size) {
    const initial = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
    const fallback = ui.h('span', { class: 'account-avatar account-avatar--initials', 'aria-hidden': 'true' }, initial);
    if (!user.photoURL) return fallback;
    const img = ui.h('img', { class: 'account-avatar', src: user.photoURL, alt: '', width: size, height: size, referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(fallback), { once: true });
    return img;
  }

  /** A coloured dot + visible label; both tracked so setStatus() can refresh them. */
  function statusRow(className) {
    const dot = ui.h('span', { class: `account-dot account-dot--${status}`, 'aria-hidden': 'true' });
    const label = ui.h('span', { class: className }, statusLabel());
    statusNodes.push([dot, label]);
    return [dot, label];
  }

  function closeMenu() {
    menu?.close();
    menu = null;
  }

  function menuItem(label, handler, danger = false) {
    return ui.h(
      'button',
      { class: `menu__item ${danger ? 'menu__item--danger' : ''}`.trim(), type: 'button', role: 'menuitem', onClick: () => { closeMenu(); handler(); } },
      label,
    );
  }

  function openMenu(anchor) {
    if (menu) return closeMenu();
    const list = ui.h('div', { class: 'menu account-menu__actions', role: 'menu', 'aria-label': t('account.menu') },
      menuItem(t('account.signOut'), onSignOut),
      menuItem(t('account.signOutClear'), onSignOutClear, true),
    );
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = [...list.querySelectorAll('[role="menuitem"]')];
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(items.indexOf(document.activeElement) + step + items.length) % items.length]?.focus();
    });
    const content = ui.h(
      'div',
      { class: 'account-menu' },
      ui.h(
        'div',
        { class: 'account-menu__header' },
        avatar(36),
        ui.h(
          'div',
          { class: 'account-menu__who' },
          ui.h('p', { class: 'account-menu__name' }, user.displayName || firstName(user)),
          user.email && ui.h('p', { class: 'account-menu__email' }, user.email),
        ),
      ),
      ui.h('p', { class: 'account-menu__status' }, statusRow('account-menu__status-label')),
      list,
    );
    anchor.setAttribute('aria-expanded', 'true');
    menu = ui.popover({
      anchor,
      content,
      label: t('account.menu'),
      className: 'popover--menu popover--account',
      onClose: () => {
        menu = null;
        anchor.setAttribute('aria-expanded', 'false');
        statusNodes = statusNodes.filter(([dot]) => dot.isConnected);
      },
    });
  }

  const view = {
    showSignedOut() {
      closeMenu();
      user = null;
      statusNodes = [];
      slot.replaceChildren(
        ui.h('button', { class: 'btn btn-google', type: 'button', onClick: onSignIn }, ui.icon('google', { size: 18 }), t('account.signIn')),
      );
    },

    showSignedIn(nextUser, nextStatus = 'syncing') {
      closeMenu();
      user = nextUser;
      status = nextStatus;
      statusNodes = [];
      const button = ui.h(
        'button',
        { class: 'account-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: t('account.menu') },
        avatar(28),
        ui.h('span', { class: 'account-name' }, firstName(user)),
        statusRow('sr-only'),
      );
      button.append(ui.icon('chevron-down', { size: 16 }));
      button.addEventListener('click', () => openMenu(button));
      slot.replaceChildren(button);
    },

    setStatus(nextStatus) {
      if (!user || !STATUS_KEYS[nextStatus]) return;
      status = nextStatus;
      for (const [dot, label] of statusNodes) {
        dot.className = `account-dot account-dot--${status}`;
        label.textContent = statusLabel();
      }
    },

    /** Disables the sign-in button while the Google popup is open. */
    setBusy(busy) {
      const button = slot.querySelector('.btn-google');
      if (!button) return;
      button.disabled = busy;
      button.setAttribute('aria-busy', String(busy));
    },
  };
  return view;
}

// ---------- Not connected (firebaseConfig === null) ----------

function showNotConnected(ui, i18n) {
  const { t } = i18n;
  ui.modal({
    title: t('account.notConnected.title'),
    content: ui.h(
      'div',
      null,
      ui.h('p', null, t('account.notConnected.body')),
      ui.h('p', null, ui.h('a', { href: './SETUP.md', target: '_blank', rel: 'noopener' }, t('account.notConnected.link'))),
    ),
    actions: [{ label: t('common.ok'), primary: true }],
  });
}

// ---------- Firebase session ----------

/**
 * Owns the Auth + Firestore instances for one page. connect(user) merges local data into the
 * account and attaches the cloud adapter; disconnect() detaches it and keeps the local copy.
 */
async function startSession({ sdk, config, store, ui, i18n, view, setSignedIn }) {
  const { t } = i18n;
  const app = sdk.getApps().length ? sdk.getApp() : sdk.initializeApp(config); // a retried start reuses the app
  const auth = sdk.getAuth(app);
  await sdk.setPersistence(auth, sdk.browserLocalPersistence);
  const db = sdk.getFirestore(app);
  const local = createLocalAdapter();
  let link = null; // { cloud, detach, unsubscribe } while a cloud adapter is attached
  let generation = 0; // bumps on every connect/disconnect so stale async work bails out

  async function connect(user) {
    const current = ++generation;
    view.showSignedIn(user, 'syncing');
    setSignedIn(true);
    const cloud = createCloudAdapter({
      db,
      uid: user.uid,
      email: user.email,
      firestore: sdk,
      onStatus: (status) => current === generation && view.setStatus(status),
    });
    const remote = await cloud.load();
    if (current !== generation) return cloud.dispose(); // signed out meanwhile
    if (remote) store.replace(store.mergeDocs(store.get(), remote));
    await store.flush(); // merged doc → localStorage first
    if (current !== generation) return cloud.dispose();
    const detach = store.attach(cloud); // write-through saves + live snapshots (merged on arrival)
    // Whatever a merge adds on top of the server copy is written back so every device converges.
    const unsubscribe = store.subscribe((doc, meta) => meta.reason === 'replace' && cloud.reconcile(doc));
    link = { cloud, detach, unsubscribe };
    cloud.reconcile(store.get());
  }

  async function disconnect() {
    generation += 1;
    const active = link;
    link = null;
    if (active) {
      active.unsubscribe();
      await withTimeout(active.cloud.flush(), FLUSH_TIMEOUT_MS);
      active.detach();
      active.cloud.dispose();
    }
    view.showSignedOut();
    setSignedIn(false);
  }

  async function signIn() {
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await sdk.signInWithPopup(auth, provider);
    } catch (error) {
      if (error?.code === 'auth/popup-blocked') return sdk.signInWithRedirect(auth, provider);
      if (!CANCELLED_CODES.has(error?.code)) throw error;
    }
  }

  async function signOut({ clear = false } = {}) {
    if (clear) {
      const ok = await ui.confirm(t('account.clearConfirm'), { title: t('account.signOutClear'), okLabel: t('account.signOutClear'), danger: true });
      if (!ok) return;
    }
    await withTimeout(store.flush(), FLUSH_TIMEOUT_MS);
    await disconnect();
    await sdk.signOut(auth);
    if (!clear) return;
    store.replace(createEmptyDoc());
    local.clear();
  }

  const reportError = () => ui.toast(t('account.signInError'));
  sdk.onAuthStateChanged(auth, (user) => (user ? connect(user) : disconnect()).catch(reportError));
  sdk.getRedirectResult(auth).catch((error) => !CANCELLED_CODES.has(error?.code) && reportError());
  return { signIn, signOut };
}

// ---------- Entry point ----------

/**
 * Mounts the account area into `slot`. `config` and `loadSdk` default to the real Firebase config
 * and SDK loader; tests inject fakes. Resolves once a persisted session (if any) was restored.
 */
export async function initAuth({ store, ui, i18n, slot, setSignedIn, config = firebaseConfig, loadSdk = loadFirebase }) {
  const { t } = i18n;
  let sessionPromise = null;
  const session = () => {
    sessionPromise ??= loadSdk()
      .then((sdk) => startSession({ sdk, config, store, ui, i18n, view, setSignedIn }))
      .catch((error) => {
        sessionPromise = null; // a failed SDK load is retried on the next click
        throw error;
      });
    return sessionPromise;
  };

  const run = async (action) => {
    try {
      await action();
    } catch {
      ui.toast(t('account.signInError'));
    }
  };

  const view = createAccountView({
    slot,
    ui,
    i18n,
    onSignIn: () => {
      if (!config) return showNotConnected(ui, i18n);
      view.setBusy(true);
      run(async () => (await session()).signIn()).finally(() => view.setBusy(false));
    },
    onSignOut: () => run(async () => (await session()).signOut()),
    onSignOutClear: () => run(async () => (await session()).signOut({ clear: true })),
  });

  view.showSignedOut();
  setSignedIn(false);
  if (!config) return;
  await session().catch(() => {}); // offline first visit: stay in free mode, the button retries
}
