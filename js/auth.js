// Account area (SPEC §3, §5). Signed out: an account icon that opens the sign-in chooser (Google,
// Apple, or a passwordless email link). Signed in: the
// avatar + first name + menu (sync status, Sign out, Sign out & clear this device) and wires the
// Firebase session: on sign-in the local document is merged into the account, then every save is
// written to Firestore *and* localStorage while Firestore snapshots flow back into the store.
// The Firebase SDK is imported lazily and only when a config exists, so free mode never loads it.
import { firebaseConfig, authProviders } from './firebase-config.js';
import * as dates from './dates.js';
import { createEmptyDoc } from './store.js';
import { createLocalAdapter } from './storage/local.js';
import { createCloudAdapter } from './storage/cloud.js';
import { lastSyncAgo, remindersEnabled, setRemindersOwner, syncWithReminders } from './reminders.js';
import { createBilling, VoucherError } from './billing.js';
import { capturePayReturn, checkoutUrl, REDEEM_EVENT, REFUND_POLICY_EVENT, setBuyer, SIGNIN_FOR_PRO_EVENT, takePendingCheckout } from './billing-links.js';
import { isPro, onPlanChange } from './plan.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_MODULES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-functions.js'];
const CANCELLED_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
const STATUS_KEYS = { synced: 'account.synced', syncing: 'account.syncing', offline: 'account.offline', error: 'account.syncError' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const GUEST = 'guest'; // where tasks written signed out wait until they are moved into an account
const liveCount = (doc) => (doc?.tasks ?? []).filter((task) => !task.deleted).length;
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
/** The sign-in methods this account already has: 'google', 'apple', 'password'. */
const linkedProviders = (user) =>
  (user?.providerData ?? []).map((info) => ({ 'google.com': 'google', 'apple.com': 'apple', password: 'password' })[info?.providerId]).filter(Boolean);
const LINK_ERRORS = {
  'auth/credential-already-in-use': 'account.linkTaken',
  'auth/email-already-in-use': 'account.linkTaken',
  'auth/account-exists-with-different-credential': 'account.linkTaken',
  'auth/provider-already-linked': 'account.linkAlready',
};

function firstName(user) {
  const name = (user.displayName || '').trim();
  return name.split(/\s+/)[0] || (user.email || '').split('@')[0] || '?';
}

// ---------- View ----------

/**
 * Renders the account slot. showSignedOut() → Google button; showSignedIn(user, status) → avatar,
 * first name and a status dot that opens the account menu. setStatus() updates in place.
 */
export function createAccountView({ slot, ui, i18n, onSignIn, onEmail, onSignOut, onSignOutClear, onClearAccount, onChangePassword, onSyncReminders, onGoPro, onSyncGuest, onLink, onSwitch, onDeleteAccount, onRefundPolicy, providers = ['google', 'apple', 'email'] }) {
  let plan = 'free'; // shown in the menu; the real answer lives in Firestore
  const { t } = i18n;
  let user = null;
  let status = 'syncing';
  let menu = null;
  let statusNodes = []; // [dot, label] pairs currently on screen
  let guestTasks = 0; // tasks written signed out, waiting in this browser to be moved into the account

  // Tasks waiting to be synced outrank the sync status: the dot turns red and blinks until they move.
  const statusLabel = () =>
    guestTasks ? t(guestTasks === 1 ? 'account.guestWaitingOne' : 'account.guestWaiting', { n: guestTasks }) : t(STATUS_KEYS[status] ?? STATUS_KEYS.syncing);
  const dotClass = () => `account-dot account-dot--${guestTasks ? 'attention' : status}`;

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
    const dot = ui.h('span', { class: dotClass(), 'aria-hidden': 'true' });
    const label = ui.h('span', { class: className }, statusLabel());
    statusNodes.push([dot, label]);
    return [dot, label];
  }

  function paintStatus() {
    for (const [dot, label] of statusNodes) {
      dot.className = dotClass();
      label.textContent = statusLabel();
    }
    slot.querySelector('.account-btn')?.setAttribute('title', `${t('account.menu')} · ${statusLabel()}`);
  }

  function closeMenu() {
    menu?.close();
    menu = null;
  }

  function menuItem(label, handler, danger = false, iconName = null) {
    return ui.h(
      'button',
      { class: `menu__item ${danger ? 'menu__item--danger' : ''}`.trim(), type: 'button', role: 'menuitem', onClick: () => { closeMenu(); handler(); } },
      iconName && ui.icon(iconName, { size: 16 }),
      label,
    );
  }

  function openMenu(anchor) {
    if (menu) return closeMenu();
    // The two actions that delete things wait behind the gear next to Sign out, so they are never one slip away.
    const danger = ui.h(
      'div',
      { class: 'account-menu__danger', id: 'account-danger', hidden: true },
      // Switch: to ANOTHER account, whose tasks stay apart from these.
      menuItem(t('account.switch'), onSwitch),
      // Connect: another way into THIS account (same tasks, same Pro) — Google or Apple, whichever it lacks.
      ...['google', 'apple']
        .filter((provider) => providers.includes(provider) && !linkedProviders(user).includes(provider))
        .map((provider) => menuItem(t(provider === 'apple' ? 'account.connectApple' : 'account.connectGoogle'), () => onLink(provider))),
      hasPassword(user) && menuItem(t('account.changePassword'), onChangePassword),
      menuItem(t('account.clearAccount'), onClearAccount, true, 'broom'),
      menuItem(t('account.deleteAccount'), onDeleteAccount, true, 'trash'),
      menuItem(t('account.signOutClear'), onSignOutClear, true, 'logout'), // the longest, last
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
      // Last, quietly: what the refund rules are, and whether this account's payment can be refunded.
      ui.h('div', { class: 'account-menu__policy' }, menuItem(t('refund.policy'), onRefundPolicy)),
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
        guestTasks
          ? ui.h(
              'button',
              { class: 'account-menu__sync', type: 'button', title: statusLabel(), onClick: () => (closeMenu(), onSyncGuest()) },
              ui.icon('refresh', { size: 14 }),
              t('account.syncGuest'),
            )
          : null,
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
      paintStatus();
    },

    /** How many tasks written signed out wait in this browser (0: none — the dot shows the sync status). */
    setGuestTasks(count) {
      guestTasks = count;
      paintStatus();
      if (menu && user) {
        closeMenu();
        openMenu(slot.querySelector('.account-btn'));
      }
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
      ui.h('p', { class: 'signin__subtitle text-muted' }, t({ pro: 'account.signInForPro', switch: 'account.switchSubtitle' }[reason] ?? 'account.signInSubtitle')),
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
    setRemindersOwner(false); // until this account is known to be the owner's, with its own tasks loaded
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
    } else if (!owner && liveCount(store.get())) {
      // Written signed out: it waits in this browser until the owner chooses to move it in (Sync).
      const waiting = local.takeStash(GUEST);
      local.stash(GUEST, waiting ? store.mergeDocs(waiting, store.get()) : store.get());
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
    view.setGuestTasks(liveCount(local.peekStash(GUEST)));
    setBuyer(user); // Go Pro now names this account, so paying turns it Pro without a code
    // Sent here by Go Pro while signed out: now that the account is known, go on to pay.
    const period = takePendingCheckout();
    if (period) window.location.assign(checkoutUrl(period));
    cloud.reconcile(store.get());
    checkOwner(user.uid, current);
  }

  /** The owner's own account turns on the Reminders bridge. config/owners can be read only by an owner,
   *  so for everyone else the read is refused and nothing changes. */
  async function checkOwner(uid, current) {
    let owner = false;
    try {
      const snapshot = await sdk.getDoc(sdk.doc(db, 'config', 'owners'));
      owner = Boolean(snapshot.exists?.() && snapshot.data()?.uids?.includes(uid));
    } catch {
      owner = false;
    }
    if (current === generation) setRemindersOwner(owner);
  }

  async function disconnect() {
    generation += 1;
    setRemindersOwner(false); // before the board turns into the guest's
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

  /**
   * Connect Google or Apple to the signed-in account, so either button opens it. A Google or Apple
   * login that already has its own Levelix account cannot be joined in — that account goes first.
   */
  async function linkProvider(provider) {
    const authProvider = provider === 'apple' ? appleProvider() : googleProvider();
    try {
      const result = await sdk.linkWithPopup(auth.currentUser, authProvider);
      view.updateUser(result?.user ?? auth.currentUser);
      ui.toast(t(provider === 'apple' ? 'account.linkedApple' : 'account.linkedGoogle'), { duration: 8000 });
    } catch (error) {
      if (CANCELLED_CODES.has(error?.code)) return;
      if (error?.code === 'auth/popup-blocked') return sdk.linkWithRedirect(auth.currentUser, authProvider);
      ui.toast(t(LINK_ERRORS[error?.code] ?? 'account.linkFailed', { provider: provider === 'apple' ? 'Apple' : 'Google' }), { duration: 12000 });
    }
  }

  /** Google's rule for deleting an account: a recent sign-in. Asks for it the way this account signs in. */
  async function signInAgain(user) {
    const methods = linkedProviders(user);
    if (methods.includes('google') || methods.includes('apple')) {
      return sdk.reauthenticateWithPopup(user, methods.includes('google') ? googleProvider() : appleProvider());
    }
    const password = await askPassword();
    if (!password) throw Object.assign(new Error('cancelled'), { code: 'auth/user-cancelled' });
    return sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, password));
  }

  function askPassword() {
    return new Promise((resolve) => {
      let value = null;
      const input = ui.h('input', { class: 'signin__field', type: 'password', autocomplete: 'current-password', placeholder: t('account.passwordPlaceholder'), 'aria-label': t('account.password') });
      ui.modal({
        title: t('account.confirmPasswordTitle'),
        content: ui.h('div', { class: 'signin' }, ui.h('p', { class: 'signin__subtitle text-muted' }, t('account.confirmPasswordBody')), input),
        actions: [{ label: t('common.cancel') }, { label: t('common.confirm'), primary: true, onClick: () => { value = input.value || null; } }],
        className: 'modal--signin',
        onClose: () => resolve(value),
      });
      input.focus();
    });
  }

  /**
   * Delete account: the account and everything in it go for good (the cloud copy is removed by the
   * cleanupAccount function as the account is deleted), and this device is cleared. Purchase records
   * stay, as tax law requires.
   */
  async function deleteAccount() {
    const user = auth.currentUser;
    if (!user) return;
    const ok = await ui.confirm(t('account.deleteConfirm', { email: user.email || t('account.thisAccount') }), {
      title: t('account.deleteTitle'),
      okLabel: t('account.deleteOk'),
      danger: true,
    });
    if (!ok) return;
    await disconnect(); // stop syncing first: nothing may be written to an account being deleted
    try {
      try {
        await sdk.deleteUser(user);
      } catch (error) {
        if (error?.code !== 'auth/requires-recent-login') throw error;
        await signInAgain(user);
        await sdk.deleteUser(user);
      }
    } catch (error) {
      await connect(user); // not deleted after all: back to the account as it was
      if (CANCELLED_CODES.has(error?.code)) return;
      throw error;
    }
    store.replace(createEmptyDoc());
    await store.flush();
    local.clear(); // last, so nothing writes the account's copy back
    ui.toast(t('account.deleted'), { duration: 8000 });
  }

  /**
   * Refund: within 14 days of paying, the latest purchase is refunded in full by the requestRefund
   * function, and Pro ends as soon as Stripe confirms (the webhook takes the paid time back).
   * `refundStatus` only asks whether it can be done; `refundNow` does it.
   */
  const askRefund = (data) => sdk.httpsCallable(sdk.getFunctions(app, 'europe-west1'), 'requestRefund')(data).then((result) => result.data ?? {});
  const refundStatus = () => (auth.currentUser ? askRefund({ check: true }) : Promise.resolve({ status: 'signed-out' }));
  const refundNow = () => askRefund({});

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
    const uid = auth.currentUser?.uid;
    await withTimeout(store.flush(), FLUSH_TIMEOUT_MS);
    await disconnect();
    await sdk.signOut(auth);
    if (clear) {
      store.replace(createEmptyDoc());
      local.clear();
      return;
    }
    // The account's tasks travel with the account: kept out of sight on this device (so it opens fast
    // next time), while anything written signed out and never moved in shows again.
    if (uid) local.stash(uid, store.get());
    store.replace(local.takeStash(GUEST) ?? createEmptyDoc());
    local.setOwner(null);
    await store.flush(); // replace() never saves: write the guest board over the account's copy now
  }

  /** Sync: the tasks written signed out move into this account and leave the browser. */
  async function syncGuest() {
    const waiting = local.peekStash(GUEST);
    const count = liveCount(waiting);
    if (!count) return view.setGuestTasks(0);
    const ok = await ui.confirm(t(count === 1 ? 'account.syncGuestConfirmOne' : 'account.syncGuestConfirm', { n: count, email: auth.currentUser?.email || t('account.thisAccount') }), {
      title: t('account.syncGuestTitle'),
      okLabel: t('account.syncGuestOk'),
    });
    if (!ok) return;
    local.takeStash(GUEST);
    store.replace(store.mergeDocs(store.get(), waiting)); // written back to the account by the reconcile
    await store.flush(); // …and to this browser's copy of the account
    view.setGuestTasks(0);
    ui.toast(t(count === 1 ? 'account.syncGuestDoneOne' : 'account.syncGuestDone', { n: count }));
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
    syncGuest,
    linkProvider,
    deleteAccount,
    refundStatus,
    refundNow,
    emailAuth,
    changePassword,
    signOut,
    clearAccount,
    redeem,
  };
}

const euros = (cents) => `€${(Number(cents) / 100).toFixed(2).replace('.', ',')}`;
const longDate = (iso) => dates.formatLong(dates.todayKey(new Date(iso))).split(', ')[1]; // "17 October 2026"

/**
 * Refund policy: the rules, and — for the signed-in account — whether its payment can be refunded,
 * asked of the server first. The Refund button works only when it can (within 14 days of a payment);
 * otherwise it stays, disabled, with the reason above it. `session` is null when there is no Firebase.
 */
export function openRefundPolicy({ ui, i18n, session, onSignIn }) {
  const { t } = i18n;
  const status = ui.h('p', { class: 'refund__status', role: 'status' }, t('refund.checking'));
  const button = ui.h('button', { class: 'btn btn-danger refund__button', type: 'button', disabled: true }, t('refund.button'));
  const signIn = ui.h('button', { class: 'btn btn-primary refund__signin', type: 'button', hidden: true, onClick: () => (modal.close(), onSignIn()) }, t('account.signIn'));
  const content = ui.h(
    'div',
    { class: 'refund' },
    ui.h('p', null, t('refund.rule')),
    ui.h('p', { class: 'text-muted' }, t('refund.exceptions')),
    ui.h('div', { class: 'refund__box' }, status, button, signIn),
    ui.h('a', { class: 'refund__terms', href: './terms.html' }, t('refund.terms')),
  );
  const modal = ui.modal({ title: t('refund.policy'), content, className: 'modal--refund', actions: [{ label: t('common.close'), primary: true }] });

  const show = (text, { can = false, amount = null } = {}) => {
    status.textContent = text;
    status.classList.toggle('is-ok', can);
    button.disabled = !can;
    button.textContent = amount ? t('refund.buttonAmount', { amount }) : t('refund.button');
  };

  function explain(result) {
    const amount = result.amount != null ? euros(result.amount) : null;
    switch (result.status) {
      case 'eligible':
        return show(t('refund.eligible', { amount, paid: longDate(result.paidAt), until: longDate(result.until) }), { can: true, amount });
      case 'refunded':
        button.hidden = true;
        ui.toast(t('refund.done', { amount }), { duration: 12000 });
        return show(t('refund.done', { amount }));
      case 'too-late':
        return show(t('refund.tooLate', { paid: longDate(result.paidAt), until: longDate(result.until) }));
      case 'already':
        return show(t('refund.already', { paid: longDate(result.paidAt) }));
      case 'signed-out':
        signIn.hidden = false;
        return show(t('refund.signedOut'));
      default:
        return show(isPro() ? t('refund.noneCode') : t('refund.none'));
    }
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = t('refund.working');
    try {
      explain(await (await session()).refundNow());
    } catch {
      show(t('refund.failed'));
    }
  });

  if (!session) return void explain({ status: 'signed-out' });
  session()
    .then((current) => current.refundStatus())
    .then(explain, () => show(t('refund.checkFailed')));
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
      ui.h('div', { class: 'gopro__plans' }, option('yearly'), option('monthly')),
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
    // Pro is on: the code box has nothing left to do.
    const codeButton = [...(body.closest('.modal')?.querySelectorAll('.modal__actions .btn') ?? [])].find((button) => button.textContent === t('plan.enterCode'));
    if (codeButton) codeButton.hidden = true;
  };
  const stop = onPlanChange((plan) => plan === 'pro' && showOn());
  const handle = ui.modal({
    title: t('plan.paidTitle'),
    content: ui.h('div', { class: 'redeem' }, body, hint),
    onClose: stop,
    actions: [
      { label: t('common.close'), primary: true },
      { label: t('plan.enterCode'), onClick: () => void openRedeemModal({ ui, i18n, session }) },
    ],
  });
  if (isPro()) showOn();
  return handle;
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
  document.addEventListener(REFUND_POLICY_EVENT, () => pageEvents?.refundPolicy());
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
    onSyncGuest: () => run(async () => (await session()).syncGuest()),
    onDeleteAccount: () => run(async () => (await session()).deleteAccount()),
    onRefundPolicy: () => openRefundPolicy({ ui, i18n, session: config ? session : null, onSignIn: () => view.openSignIn() }),
    onLink: (provider) => run(async () => (await session()).linkProvider(provider)),
    // Switch account: sign out as usual (this account's tasks stay with it), then straight to the sign-in.
    onSwitch: () =>
      run(async () => {
        await (await session()).signOut();
        view.openSignIn({ reason: 'switch' });
      }),
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
    refundPolicy: () => openRefundPolicy({ ui, i18n, session: config ? session : null, onSignIn: () => view.openSignIn() }),
  };
  listenToPage();
  if (capturePayReturn()) openPaidModal({ ui, i18n, session });
  if (!config) return;
  await session().catch(() => {}); // offline first visit: stay in free mode, the button retries
}
