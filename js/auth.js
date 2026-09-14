// Account area (SPEC §3, §5). Signed out: an account icon that opens the sign-in chooser (Google,
// Apple, or a passwordless email link). Signed in: the
// avatar + first name + menu (sync status, Sign out, Sign out & clear this device) and wires the
// Firebase session: on sign-in the local document is merged into the account, then every save is
// written to Firestore *and* localStorage while Firestore snapshots flow back into the store.
// The Firebase SDK is imported lazily and only when a config exists, so free mode never loads it.
import { firebaseConfig, authProviders } from './firebase-config.js';
import { createEmptyDoc } from './store.js';
import { createLocalAdapter } from './storage/local.js';
import { createCloudAdapter } from './storage/cloud.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_MODULES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'];
const CANCELLED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
const STATUS_KEYS = { synced: 'account.synced', syncing: 'account.syncing', offline: 'account.offline', error: 'account.syncError' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_FOR_LINK_KEY = 'escape-the-matrix:emailForSignIn'; // remembered until the emailed link is opened
const FLUSH_TIMEOUT_MS = 3000; // a save stuck offline must not block signing out (localStorage has the data)

/** Firestore rejects a document over 1 MiB with invalid-argument; retrying cannot fix that, so the user is told. */
function isTooLarge(error) {
  return error?.code === 'invalid-argument' || /exceeds the maximum size|too large/i.test(error?.message ?? '');
}

/** Loads the Firebase v10 modular SDK from gstatic and returns its functions as one flat object. */
export async function loadFirebase() {
  const modules = await Promise.all(SDK_MODULES.map((file) => import(SDK_BASE + file)));
  return Object.assign({}, ...modules);
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/** Runs a localStorage call, returning null when storage is unavailable (private mode, blocked site data). */
function storage(action) {
  try {
    return action();
  } catch {
    return null;
  }
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
export function createAccountView({ slot, ui, i18n, onSignIn, onSignOut, onSignOutClear, onClearAccount, providers = ['google', 'apple', 'email'] }) {
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
      menuItem(t('account.clearAccount'), onClearAccount, true),
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
      // A compact icon button (matches the gear), no wording — it opens the sign-in chooser.
      slot.replaceChildren(
        ui.h(
          'button',
          { class: 'btn-icon account-signin', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('account.signIn'), title: t('account.signIn'), onClick: openSignInModal },
          ui.icon('user', { size: 20 }),
        ),
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

    /** Disables the sign-in button while the provider popup is open. */
    setBusy(busy) {
      const button = slot.querySelector('.account-signin');
      if (!button) return;
      button.disabled = busy;
      button.setAttribute('aria-busy', String(busy));
    },
  };

  /** Sign-in chooser: Google, Apple, or a passwordless link sent to the typed email address. */
  function openSignInModal() {
    const option = (iconName, labelKey, onSelect, variant) =>
      ui.h(
        'button',
        { class: `btn signin-option signin-option--${variant}`, type: 'button', onClick: onSelect },
        ui.icon(iconName, { size: 18 }),
        ui.h('span', null, t(labelKey)),
      );
    const choose = (method) => {
      handle.close();
      onSignIn(method);
    };
    const email = ui.h('input', {
      class: 'signin__email',
      type: 'email',
      autocomplete: 'email',
      enterkeyhint: 'send',
      placeholder: t('account.emailPlaceholder'),
      'aria-label': t('account.continueEmail'),
      onKeydown: (event) => event.key === 'Enter' && sendLink(),
    });
    const sendLink = () => {
      const address = email.value.trim();
      if (!EMAIL_PATTERN.test(address)) {
        ui.toast(t('account.emailInvalid'));
        return email.focus();
      }
      choose({ provider: 'email', email: address });
    };
    const content = ui.h(
      'div',
      { class: 'signin' },
      ui.h('p', { class: 'signin__subtitle text-muted' }, t('account.signInSubtitle')),
      // Only the providers this deployment has switched on (firebase-config.js → authProviders).
      providers.includes('google') && option('google', 'account.continueGoogle', () => choose({ provider: 'google' }), 'google'),
      providers.includes('apple') && option('apple', 'account.continueApple', () => choose({ provider: 'apple' }), 'apple'),
      providers.includes('email') && [
        (providers.includes('google') || providers.includes('apple')) && ui.h('div', { class: 'signin__sep' }, ui.h('span', null, t('account.or'))),
        email,
        option('mail', 'account.continueEmail', sendLink, 'email'),
      ],
    );
    const handle = ui.modal({ title: t('account.signInTitle'), content, actions: [{ label: t('common.cancel') }], className: 'modal--signin' });
  }

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
      // The rendered guide on GitHub: GitHub Pages would serve ./SETUP.md as raw Markdown.
      ui.h('p', null, ui.h('a', { href: t('account.notConnected.url'), target: '_blank', rel: 'noopener' }, t('account.notConnected.link'))),
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
  let warnedTooLarge = false;

  async function connect(user) {
    const current = ++generation;
    view.showSignedIn(user, 'syncing');
    setSignedIn(true);
    const cloud = createCloudAdapter({
      db,
      uid: user.uid,
      email: user.email,
      firestore: sdk,
      onStatus: (status, error) => {
        if (current !== generation) return;
        view.setStatus(status);
        if (status === 'error' && isTooLarge(error) && !warnedTooLarge) {
          warnedTooLarge = true;
          ui.toast(t('account.tooLarge'), { duration: 0 });
        }
      },
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

  /** `{ provider: 'google' | 'apple' }` opens that provider's popup; `{ provider: 'email', email }` mails a sign-in link. */
  async function signIn({ provider = 'google', email } = {}) {
    if (provider === 'email') return sendEmailLink(email);
    const authProvider = provider === 'apple' ? appleProvider() : googleProvider();
    try {
      await sdk.signInWithPopup(auth, authProvider);
    } catch (error) {
      if (error?.code === 'auth/popup-blocked') return sdk.signInWithRedirect(auth, authProvider);
      if (!CANCELLED_CODES.has(error?.code)) throw error;
    }
  }

  function googleProvider() {
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return provider;
  }

  function appleProvider() {
    const provider = new sdk.OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    return provider;
  }

  /** Passwordless email: Firebase mails a one-time link back to this page; the address is remembered here. */
  async function sendEmailLink(email) {
    await sdk.sendSignInLinkToEmail(auth, email, { url: window.location.origin + window.location.pathname, handleCodeInApp: true });
    storage(() => localStorage.setItem(EMAIL_FOR_LINK_KEY, email));
    ui.toast(t('account.linkSent', { email }), { duration: 8000 });
  }

  /** Opening the emailed link lands here with a one-time code: finish signing in, then clean the address bar. */
  async function completeEmailLink() {
    const href = window.location.href;
    if (!sdk.isSignInWithEmailLink?.(auth, href)) return;
    const email = storage(() => localStorage.getItem(EMAIL_FOR_LINK_KEY)) || (await askEmail()); // another device asks
    try {
      if (email) await sdk.signInWithEmailLink(auth, email, href);
      storage(() => localStorage.removeItem(EMAIL_FOR_LINK_KEY));
    } finally {
      window.history.replaceState(null, '', window.location.pathname); // the code is single-use: drop it
    }
  }

  function askEmail() {
    return new Promise((resolve) => {
      let value = null;
      const input = ui.h('input', { class: 'signin__email', type: 'email', autocomplete: 'email', placeholder: t('account.emailPlaceholder'), 'aria-label': t('account.continueEmail') });
      ui.modal({
        title: t('account.confirmEmailTitle'),
        content: ui.h('div', { class: 'signin' }, ui.h('p', { class: 'signin__subtitle text-muted' }, t('account.confirmEmailBody')), input),
        actions: [{ label: t('common.cancel') }, { label: t('common.confirm'), primary: true, onClick: () => { value = input.value.trim() || null; } }],
        className: 'modal--signin',
        onClose: () => resolve(value),
      });
    });
  }

  /** Deletes every task in the account (tombstones, so every signed-in device follows); stays signed in. */
  async function clearAccount() {
    const ok = await ui.confirm(t('account.clearAccountConfirm'), { title: t('account.clearAccount'), okLabel: t('account.clearAccountOk'), danger: true });
    if (!ok) return;
    const token = store.clearAll();
    ui.toast(t('account.cleared'), { action: { label: t('toast.undo'), onClick: () => store.undo(token) } });
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
  completeEmailLink().catch(reportError);
  return { signIn, signOut, clearAccount };
}

// ---------- Entry point ----------

/**
 * Mounts the account area into `slot`. `config` and `loadSdk` default to the real Firebase config
 * and SDK loader; tests inject fakes. Resolves once a persisted session (if any) was restored.
 */
export async function initAuth({ store, ui, i18n, slot, setSignedIn, config = firebaseConfig, loadSdk = loadFirebase, providers = authProviders }) {
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
    providers,
    onSignIn: (method) => {
      if (!config) return showNotConnected(ui, i18n);
      view.setBusy(true);
      run(async () => (await session()).signIn(method)).finally(() => view.setBusy(false));
    },
    onSignOut: () => run(async () => (await session()).signOut()),
    onSignOutClear: () => run(async () => (await session()).signOut({ clear: true })),
    onClearAccount: () => run(async () => (await session()).clearAccount()),
  });

  view.showSignedOut();
  setSignedIn(false);
  if (!config) return;
  await session().catch(() => {}); // offline first visit: stay in free mode, the button retries
}
