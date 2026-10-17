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
import { lastSyncAgo, remindersEnabled, syncWithReminders } from './reminders.js';
import { createBilling, VoucherError } from './billing.js';
import { capturePayReturn, checkoutUrl, REDEEM_EVENT, setBuyer, SIGNIN_FOR_PRO_EVENT, takePendingCheckout } from './billing-links.js';
import { isPro, onPlanChange } from './plan.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_MODULES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'];
const CANCELLED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
const STATUS_KEYS = { synced: 'account.synced', syncing: 'account.syncing', offline: 'account.offline', error: 'account.syncError' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
// Firebase's email-and-password errors, in words. Wrong email and wrong password read the same on
// purpose (and Firebase reports them the same way), so nobody can probe who has an account.
const EMAIL_ERRORS = {
  'auth/invalid-credential': 'account.wrongPassword',
  'auth/invalid-login-credentials': 'account.wrongPassword',
  'auth/wrong-password': 'account.wrongPassword',
  'auth/user-not-found': 'account.wrongPassword',
  'auth/email-already-in-use': 'account.emailTaken',
  'auth/weak-password': 'account.passwordShort',
  'auth/invalid-email': 'account.emailInvalid',
  'auth/too-many-requests': 'account.tooMany',
  'auth/network-request-failed': 'account.offlineError',
};
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

/** Signed up with an email and password (not only Google or Apple), so there is a password to change. */
const hasPassword = (user) => (user?.providerData ?? []).some((info) => info?.providerId === 'password');

function firstName(user) {
  const name = (user.displayName || '').trim();
  return name.split(/\s+/)[0] || (user.email || '').split('@')[0] || '?';
}

// ---------- View ----------

/**
 * Renders the account slot. showSignedOut() → Google button; showSignedIn(user, status) → avatar,
 * first name and a status dot that opens the account menu. setStatus() updates in place.
 */
export function createAccountView({ slot, ui, i18n, onSignIn, onEmail, onSignOut, onSignOutClear, onClearAccount, onChangePassword, onSyncReminders, onGoPro, providers = ['google', 'apple', 'email'] }) {
  let plan = 'free'; // shown in the menu; the real answer lives in Firestore
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
    // The two actions that delete things wait behind the gear next to Sign out, so they are never one slip away.
    const danger = ui.h(
      'div',
      { class: 'account-menu__danger', id: 'account-danger', hidden: true },
      hasPassword(user) && menuItem(t('account.changePassword'), onChangePassword),
      menuItem(t('account.clearAccount'), onClearAccount, true),
      menuItem(t('account.signOutClear'), onSignOutClear, true),
    );
    const gear = ui.h(
      'button',
      {
        class: 'btn-icon account-menu__gear',
        type: 'button',
        role: 'menuitem',
        'aria-label': t('account.moreOptions'),
        title: t('account.moreOptions'),
        'aria-expanded': 'false',
        'aria-controls': 'account-danger',
        onClick: () => {
          danger.hidden = !danger.hidden;
          gear.setAttribute('aria-expanded', String(!danger.hidden));
          if (!danger.hidden) danger.querySelector('[role="menuitem"]')?.focus();
        },
      },
      ui.icon('settings', { size: 18 }),
    );
    const list = ui.h('div', { class: 'menu account-menu__actions', role: 'menu', 'aria-label': t('account.menu') },
      // Personal Mac bridge, opt-in only. The label carries when it last went through, so a bridge that
      // stopped days ago is visible at a glance.
      remindersEnabled() && menuItem(lastSyncAgo() ? t('reminders.syncAgo', { ago: lastSyncAgo() }) : t('reminders.sync'), onSyncReminders),
      plan !== 'pro' && menuItem(t('plan.goPro'), onGoPro),
      ui.h('div', { class: 'account-menu__signout' }, menuItem(t('account.signOut'), onSignOut), gear),
      danger,
    );
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = [...list.querySelectorAll('[role="menuitem"]')].filter((item) => !item.closest('[hidden]'));
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
          ui.h(
            'p',
            { class: 'account-menu__name' },
            user.displayName || firstName(user),
            plan === 'pro' ? ui.h('span', { class: 'account-menu__pro' }, t('plan.pro')) : null,
          ),
          user.email && ui.h('p', { class: 'account-menu__email' }, user.email),
        ),
      ),
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
        { class: 'account-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: `${t('account.menu')} · ${statusLabel()}` },
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
      slot.querySelector('.account-btn')?.setAttribute('title', `${t('account.menu')} · ${statusLabel()}`);
    },

    /** Free or Pro, as Firestore reports it: the menu shows it and hides the code entry once Pro. */
    setPlan(next) {
      plan = next === 'pro' ? 'pro' : 'free';
      if (menu) {
        closeMenu();
        if (user) openMenu(slot.querySelector('.account-btn'));
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

  /**
   * Sign-in chooser: Google, Apple (once configured), or an email and password — with "Create an account"
   * and "Forgot password?" in the same box. `reason: 'pro'` says why, when Go Pro sent the visitor here.
   */
  function openSignInModal({ reason } = {}) {
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

    let mode = 'signin'; // 'signin' | 'signup' | 'reset'
    const field = (attrs) => ui.h('input', { class: 'signin__field', ...attrs });
    const name = field({ type: 'text', autocomplete: 'name', placeholder: t('account.namePlaceholder'), 'aria-label': t('account.name'), hidden: true });
    const email = field({ type: 'email', autocomplete: 'email', placeholder: t('account.emailPlaceholder'), 'aria-label': t('account.email') });
    const password = field({ type: 'password', autocomplete: 'current-password', placeholder: t('account.passwordPlaceholder'), 'aria-label': t('account.password') });
    const submit = ui.h('button', { class: 'btn btn-primary signin__submit', type: 'submit' });
    const note = ui.h('p', { class: 'signin__note', role: 'status', 'aria-live': 'polite' });
    const swap = ui.h('button', { class: 'link-button', type: 'button', onClick: () => setMode(mode === 'signin' ? 'signup' : 'signin') });
    const forgot = ui.h('button', { class: 'link-button', type: 'button', onClick: () => setMode('reset') }, t('account.forgot'));
    const form = ui.h(
      'form',
      { class: 'signin__form', novalidate: true, onSubmit: (event) => (event.preventDefault(), send()) },
      name,
      email,
      password,
      submit,
      note,
      ui.h('p', { class: 'signin__links' }, swap, forgot),
    );

    const tell = (key, tone = 'info', values) => {
      note.textContent = key ? t(key, values) : '';
      note.dataset.tone = tone;
    };
    function setMode(next) {
      mode = next;
      name.hidden = mode !== 'signup';
      password.hidden = mode === 'reset';
      password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
      password.placeholder = t(mode === 'signup' ? 'account.newPasswordPlaceholder' : 'account.passwordPlaceholder');
      submit.textContent = t({ signin: 'account.signInEmail', signup: 'account.createAccount', reset: 'account.sendReset' }[mode]);
      swap.textContent = t(mode === 'signin' ? 'account.noAccount' : 'account.haveAccount');
      forgot.hidden = mode !== 'signin';
      tell(mode === 'reset' ? 'account.resetHint' : null);
    }
    async function send() {
      const address = email.value.trim();
      if (!EMAIL_PATTERN.test(address)) return tell('account.emailInvalid', 'error'), email.focus();
      if (mode === 'signup' && password.value.length < MIN_PASSWORD) return tell('account.passwordShort', 'error'), password.focus();
      if (mode === 'signin' && !password.value) return tell('account.passwordMissing', 'error'), password.focus();
      submit.disabled = true;
      try {
        const outcome = await onEmail({ mode, email: address, password: password.value, name: name.value.trim() });
        if (outcome === 'reset-sent') return tell('account.resetSent', 'info', { email: address });
        if (outcome === 'not-connected') return;
        handle.close();
      } catch (error) {
        tell(EMAIL_ERRORS[error?.code] ?? 'account.signInError', 'error');
      } finally {
        submit.disabled = false;
      }
    }
    setMode('signin');

    const content = ui.h(
      'div',
      { class: 'signin' },
      ui.h('p', { class: 'signin__subtitle text-muted' }, t(reason === 'pro' ? 'account.signInForPro' : 'account.signInSubtitle')),
      // Only the providers this deployment has switched on (firebase-config.js → authProviders).
      providers.includes('google') && option('google', 'account.continueGoogle', () => choose({ provider: 'google' }), 'google'),
      providers.includes('apple') && option('apple', 'account.continueApple', () => choose({ provider: 'apple' }), 'apple'),
      providers.includes('email') && [
        (providers.includes('google') || providers.includes('apple')) && ui.h('div', { class: 'signin__sep' }, ui.h('span', null, t('account.orEmail'))),
        form,
      ],
    );
    const handle = ui.modal({ title: t('account.signInTitle'), content, actions: [{ label: t('common.cancel') }], className: 'modal--signin' });
  }

  view.openSignIn = openSignInModal;
  /** The signed-in user changed (a name set at sign-up): redraw the button, keeping the sync status. */
  view.updateUser = (nextUser) => user && view.showSignedIn(nextUser, status);

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
  let billing = null; // watches billing/{uid} while signed in
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
    // One browser, several accounts: this browser's copy joins the account only if it is that
    // account's own, or was written signed out. Another account's copy is set aside — never mixed in —
    // and handed back when that account signs in here again.
    const owner = local.owner();
    if (owner && owner !== user.uid) {
      local.stash(owner, store.get());
      store.replace(createEmptyDoc());
    }
    const stashed = local.takeStash(user.uid);
    if (stashed) store.replace(store.mergeDocs(store.get(), stashed));
    local.setOwner(user.uid);
    const remote = await cloud.load();
    if (current !== generation) return cloud.dispose(); // signed out meanwhile
    if (remote) store.replace(store.mergeDocs(store.get(), remote));
    await store.flush(); // merged doc → localStorage first
    if (current !== generation) return cloud.dispose();
    const detach = store.attach(cloud); // write-through saves + live snapshots (merged on arrival)
    // Whatever a merge adds on top of the server copy is written back so every device converges.
    const unsubscribe = store.subscribe((doc, meta) => meta.reason === 'replace' && cloud.reconcile(doc));
    link = { cloud, detach, unsubscribe };
    billing = createBilling({ db, uid: user.uid, firestore: sdk, onPlan: (plan) => view.setPlan(plan) });
    setBuyer(user); // Go Pro now names this account, so paying turns it Pro without a code
    // Sent here by Go Pro while signed out: now that the account is known, go on to pay.
    const period = takePendingCheckout();
    if (period) window.location.assign(checkoutUrl(period));
    cloud.reconcile(store.get());
  }

  async function disconnect() {
    generation += 1;
    billing?.dispose();
    billing = null;
    setBuyer(null);
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

  /** `{ provider: 'google' | 'apple' }` opens that provider's popup (or a redirect when popups are blocked). */
  async function signIn({ provider = 'google' } = {}) {
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

  // Where the links in Firebase's emails (reset password, confirm address) send people back to.
  const backHere = () => ({ url: `${window.location.origin}/` });

  /**
   * Email and password: sign in, create an account (named, and asked to confirm the address), or mail a
   * link to set a new password. Errors are thrown to the dialog, which says what went wrong in place.
   */
  async function emailAuth({ mode, email, password, name }) {
    if (mode === 'reset') {
      await sdk.sendPasswordResetEmail(auth, email, backHere());
      return 'reset-sent';
    }
    if (mode === 'signup') {
      const credential = await sdk.createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await sdk.updateProfile(credential.user, { displayName: name });
        view.updateUser(auth.currentUser ?? credential.user);
      }
      sdk.sendEmailVerification?.(credential.user, backHere()).catch(() => {}); // a nicety: never blocks signing up
      return 'signed-up';
    }
    await sdk.signInWithEmailAndPassword(auth, email, password);
    return 'signed-in';
  }

  /** Change password: the same safe route as "Forgot password?" — a link to the account's own address. */
  async function changePassword() {
    const email = auth.currentUser?.email;
    if (!email) return;
    await sdk.sendPasswordResetEmail(auth, email, backHere());
    ui.toast(t('account.changePasswordSent', { email }), { duration: 8000 });
  }

  /** Opening an emailed sign-in link (from before passwords existed) lands here with a one-time code: finish signing in, then clean the address bar. */
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
  /** Turns a voucher code into Pro on this account (the rules do the checking). */
  function redeem(code) {
    if (!billing) throw new VoucherError('failed');
    return billing.redeem(code);
  }

  return {
    signIn,
    emailAuth,
    changePassword,
    signOut,
    clearAccount,
    redeem,
  };
}

/** "I have a code": one field, checked against Firestore when submitted. */
export function openRedeemModal({ ui, i18n, session }) {
  const { t } = i18n;
  const input = ui.h('input', {
    class: 'redeem__input',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: t('plan.codePlaceholder'),
    'aria-label': t('plan.codeTitle'),
  });
  const content = ui.h('div', { class: 'redeem' }, ui.h('p', { class: 'text-muted' }, t('plan.codeHint')), input);
  const submit = async (api) => {
    try {
      await (await session()).redeem(input.value);
      api.close();
      ui.toast(t('plan.unlocked'), { duration: 8000 });
    } catch (error) {
      const reason = ['invalid', 'unknown', 'used', 'expired'].includes(error?.reason) ? error.reason : 'failed';
      ui.toast(t(`plan.code${reason[0].toUpperCase()}${reason.slice(1)}`), { duration: 8000 });
      input.focus();
    }
  };
  const modal = ui.modal({
    title: t('plan.codeTitle'),
    content,
    actions: [
      { label: t('common.cancel') },
      { label: t('plan.unlock'), primary: true, onClick: (api) => (submit(api), false) }, // stays open until a code works
    ],
  });
  input.addEventListener('keydown', (event) => event.key === 'Enter' && submit(modal));
  input.focus();
  return modal;
}

/** "Go Pro" from the account menu: the two plans, each straight to its Stripe checkout, and the code box for whoever has one. */
export function openGoProModal({ ui, i18n, session }) {
  const { t } = i18n;
  const option = (period) =>
    ui.h(
      'a',
      { class: 'gopro__plan', href: checkoutUrl(period), rel: 'noopener' },
      ui.h('span', { class: 'gopro__name' }, t(`home.pricing.${period}.name`)),
      ui.h('span', { class: 'gopro__price' }, t(`home.pricing.${period}.price`), ' ', ui.h('span', { class: 'gopro__period' }, t(`home.pricing.${period}.period`))),
      ui.h('span', { class: 'gopro__note' }, t(`home.pricing.${period}.note`)),
    );
  let modal = null;
  const code = ui.h('button', { class: 'link-button', type: 'button', onClick: () => (modal?.close(), openRedeemModal({ ui, i18n, session })) }, t('plan.enterCode'));
  modal = ui.modal({
    title: t('plan.goProTitle'),
    content: ui.h(
      'div',
      { class: 'gopro' },
      ui.h('p', { class: 'text-muted' }, t('plan.goProLead')),
      ui.h('div', { class: 'gopro__plans' }, option('monthly'), option('yearly')),
      ui.h('p', { class: 'gopro__code' }, t('home.pricing.paid'), ' ', code),
    ),
    actions: [{ label: t('common.close') }],
  });
  return modal;
}

/**
 * Back from Stripe: the payment is through, the code is not here yet. It says what happens next and
 * opens the code box, so the customer never has to hunt for where the code goes.
 */
export function openPaidModal({ ui, i18n, session }) {
  const { t } = i18n;
  const body = ui.h('p', null, t('plan.paidBody'));
  const hint = ui.h('p', { class: 'text-muted' }, t('plan.paidHint'));
  // Signed in when they paid: the webhook turns the account Pro within seconds, and this says so.
  const showOn = () => {
    body.textContent = t('plan.paidOn');
    hint.hidden = true;
  };
  if (isPro()) showOn();
  const stop = onPlanChange((plan) => plan === 'pro' && showOn());
  return ui.modal({
    title: t('plan.paidTitle'),
    content: ui.h('div', { class: 'redeem' }, body, hint),
    onClose: stop,
    actions: [
      { label: t('common.close') },
      { label: t('plan.enterCode'), onClick: () => void openRedeemModal({ ui, i18n, session }) },
    ],
  });
}

// ---------- Entry point ----------

// Page-wide requests (from Home) go to the account area that is mounted now; listened to once.
let pageEvents = null;
let listening = false;
function listenToPage() {
  if (listening) return;
  listening = true;
  document.addEventListener(REDEEM_EVENT, () => pageEvents?.redeem());
  document.addEventListener(SIGNIN_FOR_PRO_EVENT, () => pageEvents?.signInForPro());
}

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
    onEmail: async (payload) => {
      if (!config) return showNotConnected(ui, i18n), 'not-connected';
      return (await session()).emailAuth(payload);
    },
    onChangePassword: () => run(async () => (await session()).changePassword()),
    onSignOut: () => run(async () => (await session()).signOut()),
    onSignOutClear: () => run(async () => (await session()).signOut({ clear: true })),
    onClearAccount: () => run(async () => (await session()).clearAccount()),
    onSyncReminders: () => syncWithReminders({ store, ui, i18n }),
    onGoPro: () => openGoProModal({ ui, i18n, session }),
  });

  view.showSignedOut();
  setSignedIn(false);
  // The pricing section asks for the code box, or for sign-in before Go Pro, from outside this module.
  pageEvents = {
    redeem: () => openRedeemModal({ ui, i18n, session }),
    signInForPro: () => (config ? view.openSignIn({ reason: 'pro' }) : showNotConnected(ui, i18n)),
  };
  listenToPage();
  if (capturePayReturn()) openPaidModal({ ui, i18n, session });
  if (!config) return;
  await session().catch(() => {}); // offline first visit: stay in free mode, the button retries
}
