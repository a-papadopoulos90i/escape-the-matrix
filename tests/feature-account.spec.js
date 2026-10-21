import { test, expect } from './fixtures.js';
import path from 'node:path';

// Account area (SPEC §3 / §5): free mode with firebaseConfig === null, and Google mode driven by a
// fake Firebase SDK injected into the real auth module inside the page (no network needed).
const DOC_KEY = 'escape-the-matrix:v1';
const UI_KEY = 'escape-the-matrix:ui';
const OUT = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'screenshots');
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const task = (id, title, extra = {}) => ({
  id, title, date: '2026-03-11', quadrant: 'do', order: 1, done: false, doneAt: null,
  createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z', timer: null, ...extra,
});
const SETTINGS = { showWeekends: false, bannerDismissed: false, tipsSeen: { 1: true, 2: true, 3: true, 4: true, 5: true } };
const LOCAL_DOC = { version: 1, updatedAt: '2026-03-05T00:00:00.000Z', settings: SETTINGS, tasks: [task('t_local', 'Local task')] };
const REMOTE_DOC = { version: 1, updatedAt: '2026-03-10T00:00:00.000Z', settings: SETTINGS, tasks: [task('t_remote', 'Remote task', { quadrant: 'plan' })] };
const REMOTE_ENVELOPE = { doc: REMOTE_DOC, updatedAt: '2026-03-10T00:00:00.000Z', email: 'andreas@example.com' };
const UI_STATE = { selectedDate: '2026-03-11', stage: 3, calendarMonth: '2026-03' };

function seed(page, { ui, doc } = {}) {
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (ui) localStorage.setItem(uiKey, JSON.stringify({ savedAt: Date.now(), ...ui }));
      if (doc) localStorage.setItem(docKey, JSON.stringify(doc));
    },
    { uiKey: UI_KEY, docKey: DOC_KEY, ui, doc },
  );
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const storedIds = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{"tasks":[]}').tasks.map((t) => t.id).sort(), DOC_KEY);
const storeIds = (page) => page.evaluate(() => window.__store.get().tasks.map((t) => t.id).sort());
const liveIds = (page) => page.evaluate(() => window.__store.get().tasks.filter((t) => !t.deleted).map((t) => t.id).sort());
const fakeValue = (page, expression) => page.evaluate((expr) => new Function('fake', `return ${expr}`)(window.__fake), expression);

/** The signed-out header shows a compact account icon; sign-in runs from the chooser it opens. */
const signInBtn = (page) => page.locator('#account .account-signin');
async function signInGoogle(page) {
  await signInBtn(page).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
}

/**
 * Re-mounts the account slot with the real auth module and a fake Firebase SDK (window.__fake holds
 * the fake's state; window.__store the store the session syncs). Resolves once initAuth resolved.
 */
async function startFakeSession(page, { remote = REMOTE_ENVELOPE, signedIn = false, failLoads = 0, photoURL = null } = {}) {
  // The app's own initAuth() (free mode) renders the Google button asynchronously after boot; wait
  // for it so it cannot overwrite the slot after the fake session has taken it over.
  await signInBtn(page).waitFor();
  return page.evaluate(
    async ({ remote, signedIn, failLoads, photoURL }) => {
      const [{ initAuth }, { createStore }, { createLocalAdapter }, ui, i18n] = await Promise.all([
        import('./js/auth.js'),
        import('./js/store.js'),
        import('./js/storage/local.js'),
        import('./js/ui.js'),
        import('./js/i18n.js'),
      ]);
      const user = { uid: 'u1', displayName: 'Andreas Papadopoulos', email: 'andreas@example.com', photoURL, providerData: [{ providerId: 'google.com' }] };
      const fake = {
        user, current: signedIn ? user : null, remote, writes: [], authListeners: [], snapshotListeners: [],
        signOuts: 0, redirects: 0, popupError: null, providerParams: null, signedIn: [], failLoads,
      };
      const snapshot = (data, metadata) => ({ exists: () => data !== null, data: () => data, metadata });
      const apps = [];
      const sdk = {
        initializeApp: (config) => {
          apps.push({ config });
          return apps[0];
        },
        getApps: () => apps,
        getApp: () => apps[0],
        getAuth: () => ({ get currentUser() { return fake.current; } }),
        setPersistence: async () => {},
        browserLocalPersistence: 'LOCAL',
        onAuthStateChanged: (auth, callback) => {
          fake.authListeners.push(callback);
          queueMicrotask(() => callback(fake.current));
          return () => {};
        },
        GoogleAuthProvider: class {
          setCustomParameters(params) {
            fake.providerParams = params;
          }
        },
        OAuthProvider: class {
          constructor(providerId) {
            this.providerId = providerId;
            this.scopes = [];
          }
          addScope(scope) {
            this.scopes.push(scope);
          }
        },
        // Email + password: one known account (andreas@example.com / right-password).
        createUserWithEmailAndPassword: async (auth, email, password) => {
          if (email === user.email) throw Object.assign(new Error('taken'), { code: 'auth/email-already-in-use' });
          const created = { uid: 'u2', displayName: null, email, photoURL: null, providerData: [{ providerId: 'password' }] };
          fake.created = { email, password };
          fake.current = created;
          fake.authListeners.forEach((callback) => callback(created));
          return { user: created };
        },
        signInWithEmailAndPassword: async (auth, email, password) => {
          if (email !== user.email || password !== 'right-password') throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
          fake.current = { ...user, providerData: [{ providerId: 'password' }] };
          fake.authListeners.forEach((callback) => callback(fake.current));
          return { user: fake.current };
        },
        updateProfile: async (who, profile) => {
          Object.assign(who, profile);
          fake.profile = profile;
        },
        sendEmailVerification: async (who, settings) => {
          fake.verification = { email: who.email, settings };
        },
        sendPasswordResetEmail: async (auth, email, settings) => {
          fake.resets = [...(fake.resets ?? []), { email, settings }];
        },
        isSignInWithEmailLink: (auth, href) => href.includes('mode=signIn'),
        signInWithEmailLink: async (auth, email) => {
          fake.linkEmail = email;
          fake.current = user;
          fake.authListeners.forEach((callback) => callback(user));
        },
        signInWithPopup: async (auth, provider) => {
          fake.lastProvider = provider?.providerId ?? 'google.com';
          fake.lastScopes = provider?.scopes ?? [];
          if (fake.popupError) throw Object.assign(new Error('popup'), { code: fake.popupError });
          fake.current = fake.user; // a test may swap in another account before signing in
          fake.authListeners.forEach((callback) => callback(fake.user));
        },
        // Connecting another sign-in method, and deleting the account (with a fresh sign-in when asked).
        linkWithPopup: async (who, provider) => {
          if (fake.linkError) throw Object.assign(new Error('link'), { code: fake.linkError });
          who.providerData = [...(who.providerData ?? []), { providerId: provider?.providerId ?? 'google.com' }];
          fake.linked = provider?.providerId ?? 'google.com';
          return { user: who };
        },
        linkWithRedirect: async () => {},
        deleteUser: async () => {
          if (fake.deleteNeedsLogin > 0) {
            fake.deleteNeedsLogin -= 1;
            throw Object.assign(new Error('old login'), { code: 'auth/requires-recent-login' });
          }
          fake.deletedUsers = (fake.deletedUsers ?? 0) + 1;
          fake.current = null;
          fake.authListeners.forEach((callback) => callback(null));
        },
        reauthenticateWithPopup: async (who, provider) => {
          fake.reauthenticated = provider?.providerId ?? 'google.com';
        },
        signInWithRedirect: async () => {
          fake.redirects += 1;
        },
        getRedirectResult: async () => null,
        signOut: async () => {
          fake.signOuts += 1;
          fake.current = null;
          fake.authListeners.forEach((callback) => callback(null));
        },
        getFirestore: () => ({}),
        collection: (db, ...segments) => ({ path: segments.join('/') }),
        query: (source) => source,
        orderBy: () => null,
        limit: () => null,
        doc: (db, ...segments) => ({ path: segments.join('/') }),
        getDoc: async () => snapshot(fake.remote, { hasPendingWrites: false, fromCache: false }),
        // An account's months: users/{uid}/months/{YYYY-MM} → tasks (kept per account, so accounts never mix).
        getDocs: async (ref) => ({
          docs: Object.entries(fake.months[ref.path] ?? {}).map(([id, tasks]) => ({ id, data: () => ({ tasks }) })),
          metadata: { hasPendingWrites: false, fromCache: false },
        }),
        setDoc: async (ref, data) => {
          fake.writes.push(data);
          fake.remote = data;
        },
        // A batch writes the root and the months that changed; `writes` records the account it leaves behind.
        writeBatch: () => {
          const ops = [];
          return {
            set: (ref, data) => ops.push({ ref, data }),
            delete: (ref) => ops.push({ ref, data: null }),
            commit: async () => {
              let root = null;
              let monthsPath = null;
              for (const { ref, data } of ops) {
                const [owner, key] = ref.path.split('/months/');
                if (key === undefined) root = data;
                else {
                  monthsPath = `${owner}/months`;
                  fake.months[monthsPath] = { ...(fake.months[monthsPath] ?? {}) };
                  if (data) fake.months[monthsPath][key] = data.tasks;
                  else delete fake.months[monthsPath][key];
                }
              }
              if (root) fake.remote = root;
              const tasks = Object.values(fake.months[monthsPath ?? ''] ?? {}).flat();
              fake.writes.push({ doc: { settings: root?.settings ?? {}, tasks }, updatedAt: root?.updatedAt, email: root?.email });
            },
          };
        },
        onSnapshot: (ref, next) => {
          if (ref.path.endsWith('/months')) {
            fake.byPath[ref.path] = next; // months arrive only when a test pushes them
            return () => {};
          }
          fake.snapshotListeners.push(next);
          fake.byPath[ref.path] = next;
          return () => {};
        },
        // The Refund button's server call.
        getFunctions: () => ({}),
        httpsCallable: (functions, name) => async (data) => {
          fake.called = name;
          fake.calls = [...(fake.calls ?? []), data];
          return { data: data?.check ? fake.refundCheck : fake.refundResult };
        },
      };
      fake.byPath = {};
      fake.months = {};
      fake.snap = (data) => snapshot(data, { hasPendingWrites: false, fromCache: false });
      fake.push = (data, metadata = { hasPendingWrites: false, fromCache: false }) =>
        fake.snapshotListeners.forEach((next) => next(snapshot(data, metadata)));

      const local = createLocalAdapter();
      const store = createStore(await local.load());
      store.attach(local);
      window.__fake = fake;
      window.__store = store;
      await initAuth({
        store, ui, i18n,
        slot: document.getElementById('account'),
        setSignedIn: (value) => {
          fake.signedIn.push(value);
          document.getElementById('banner').hidden = value;
        },
        config: { apiKey: 'fake', projectId: 'fake' },
        providers: ['google', 'apple', 'email'], // every provider switched on, so Apple can be exercised
        loadSdk: async () => {
          if (fake.failLoads > 0) {
            fake.failLoads -= 1;
            throw new Error('offline');
          }
          return sdk;
        },
      });
    },
    { remote, signedIn, failLoads, photoURL },
  );
}

test.describe('free mode (firebaseConfig = null)', () => {
  test('renders a compact account icon that opens a sign-in chooser (Google, Apple and email), and the free-mode banner', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    const button = signInBtn(page);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', 'Sign in');
    await expect(button).toHaveText(''); // icon only, no wording
    expect(await button.evaluate((el) => el.tagName)).toBe('BUTTON');
    await button.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByRole('button', { name: 'Continue with Google' }).locator('svg.icon--google')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Continue with Apple' }).locator('svg.icon--apple')).toHaveCount(1);
    await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(dialog.getByLabel('Password')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'New here? Create an account' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#banner')).toContainText('Free mode');
    expect(errors).toEqual([]);
  });

  test('the chooser → Continue with Google opens the not-connected modal; OK, Escape and the backdrop close it', async ({ page }) => {
    await page.goto('/');
    const dialog = page.locator('[role="dialog"]');
    const open = async () => {
      await signInGoogle(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.modal__title')).toHaveText('Sign-in is not connected yet');
      await expect(dialog).toContainText('Your tasks stay saved in this browser');
      // GitHub Pages would serve ./SETUP.md as raw Markdown, so the link opens the rendered guide.
      await expect(dialog.locator('a[href="https://github.com/a-papadopoulos90i/escape-the-matrix/blob/main/SETUP.md"]')).toHaveText('How to connect it (SETUP.md)');
    };

    await open();
    await expect(dialog).toHaveCSS('opacity', '1'); // entrance animation finished
    await page.screenshot({ path: path.join(OUT, 'account-not-connected-modal.png') });
    await dialog.getByRole('button', { name: 'OK' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(signInBtn(page)).toBeFocused();

    await open();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await open();
    await page.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
  });

  test('the free-mode banner dismisses, is remembered in settings and stays hidden after reload', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('#banner');
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
    await expect
      .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.settings?.bannerDismissed ?? null, DOC_KEY))
      .toBe(true);
    await page.reload();
    await expect(page.locator('#account .account-signin')).toBeVisible();
    await expect(banner).toBeHidden();
  });
});

test.describe('Google mode (fake Firebase SDK)', () => {
  test('sign-in merges local + remote, syncs live, shows the account menu; sign-out keeps or clears local data', async ({ page, context }) => {
    const errors = collectErrors(page);
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page);

    const account = page.locator('#account');
    const accountBtn = account.locator('.account-btn');
    const status = accountBtn.locator('.sr-only');
    await expect(account.locator('.account-signin')).toBeVisible();
    await expect(page.locator('#banner')).toBeVisible();

    // --- Sign in: the account opens with its own tasks; the one written signed out waits to be synced ---
    await signInGoogle(page);
    await expect(accountBtn).toBeVisible();
    await expect(accountBtn.locator('.account-name')).toHaveText('Andreas');
    await expect(accountBtn.locator('.account-avatar--initials')).toHaveText('A');
    await expect(status).toHaveText('1 task in this browser is waiting to sync');
    await expect(accountBtn.locator('.account-dot')).toHaveClass(/account-dot--attention/); // red, blinking
    await expect(page.locator('#banner')).toBeHidden();
    expect(await fakeValue(page, 'fake.providerParams')).toEqual({ prompt: 'select_account' });
    expect(await fakeValue(page, 'fake.signedIn.at(-1)')).toBe(true);
    await expect.poll(() => storeIds(page)).toEqual(['t_remote']);

    // Sync (in the menu header): asked first, then the task moves into the account and leaves the browser.
    await accountBtn.click();
    const syncButton = page.locator('.popover--account .account-menu__sync');
    await expect(syncButton).toHaveText('Sync');
    await expect(page.locator('.popover--account')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: path.join(OUT, 'account-menu-sync.png') });
    await syncButton.click();
    const syncDialog = page.getByRole('dialog', { name: 'Move these tasks into your account?' });
    await expect(syncDialog).toContainText('The task saved in this browser moves into andreas@example.com');
    await syncDialog.getByRole('button', { name: 'Move into my account' }).click();
    await expect(page.locator('.toast', { hasText: '1 task moved into your account.' })).toBeVisible();
    expect(await storeIds(page)).toEqual(['t_local', 't_remote']);
    await expect.poll(() => storedIds(page)).toEqual(['t_local', 't_remote']); // saves are debounced
    await expect(status).toHaveText('Synced ✓');
    await expect(accountBtn.locator('.account-dot')).toHaveClass(/account-dot--synced/);
    await expect.poll(() => fakeValue(page, 'fake.writes.at(-1).doc.tasks.map((t) => t.id).sort()')).toEqual(['t_local', 't_remote']);
    const written = await fakeValue(page, 'fake.writes.at(-1)');
    expect(written.email).toBe('andreas@example.com');
    expect(written.updatedAt > REMOTE_ENVELOPE.updatedAt).toBe(true);

    // --- Account menu ---
    await accountBtn.click();
    const menu = page.locator('.popover--account');
    await expect(menu).toBeVisible();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('.account-menu__name')).toHaveText('Andreas Papadopoulos');
    await expect(menu.locator('.account-menu__email')).toHaveText('andreas@example.com');
    // The sync status sits on the avatar now, not as a row in the menu.
    await expect(menu.locator('.account-menu__status')).toHaveCount(0);
    await expect(accountBtn.locator('.account-dot')).toBeVisible();
    await expect(accountBtn.locator('.account-dot')).toHaveClass(/account-dot--synced/);
    await expect(accountBtn).toHaveAttribute('title', 'Account menu · Synced ✓');
    // Go Pro, Sign out — and the deleting actions only behind the gear.
    await expect(menu.getByRole('menuitem', { name: 'Go Pro' })).toBeFocused();
    await expect(menu.getByRole('menuitem', { name: 'I have a code' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Clear account' })).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const gear = menu.getByRole('menuitem', { name: 'More account options' });
    await expect(gear).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(gear).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem', { name: 'Switch account' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Connect Apple' })).toBeFocused(); // signed in with Google: Apple can join
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Clear account' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Delete account' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    // The long one closes the menu, and every red item carries its own picture.
    await expect(menu.getByRole('menuitem', { name: 'Sign out & clear this device' })).toBeFocused();
    await expect(menu.locator('.menu__item--danger svg')).toHaveCount(3);
    await expect(menu.getByRole('menuitem', { name: 'Connect Google' })).toHaveCount(0); // it signed in with Google
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Refund policy' })).toBeFocused(); // last, outside the gear
    await expect(menu).toHaveCSS('opacity', '1');
    await page.screenshot({ path: path.join(OUT, 'account-menu-desktop.png') });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'false');

    // --- Live snapshots: newer versions merge in and are reconciled back; echoes/stale are ignored ---
    // Our reconcile write was stamped with the wall clock, so "newer" means later than now.
    const pushRemote = (id, offsetMs, metadata) =>
      page.evaluate(
        ({ id, offsetMs, metadata }) => {
          const updatedAt = new Date(Date.now() + offsetMs).toISOString();
          const base = window.__fake.writes.at(-1).doc;
          const live = { ...base.tasks[0], id, title: id, updatedAt };
          window.__fake.push({ doc: { ...base, updatedAt, tasks: [live] }, updatedAt, email: 'andreas@example.com' }, metadata);
        },
        { id, offsetMs, metadata },
      );
    const MINUTE = 60_000;
    await pushRemote('t_live', MINUTE);
    expect(await storeIds(page)).toEqual(['t_live', 't_local', 't_remote']);
    await expect.poll(() => fakeValue(page, 'fake.writes.at(-1).doc.tasks.map((t) => t.id).sort()')).toEqual(['t_live', 't_local', 't_remote']);
    await pushRemote('t_echo', 2 * MINUTE, { hasPendingWrites: true, fromCache: true });
    await pushRemote('t_stale', -365 * 24 * 60 * MINUTE, { hasPendingWrites: false, fromCache: false });
    expect(await storeIds(page)).toEqual(['t_live', 't_local', 't_remote']);

    // --- Write-through: a local mutation reaches both localStorage and Firestore ---
    await page.evaluate(() => window.__store.addTask({ title: 'Typed here', date: '2026-03-11' }));
    await expect.poll(() => storedIds(page).then((list) => list.length)).toBe(4);
    await expect.poll(() => fakeValue(page, 'fake.writes.at(-1).doc.tasks.length')).toBe(4);
    await expect(status).toHaveText('Synced ✓');

    // --- Clear account: confirm first; every task is tombstoned here and in Firestore, still signed in, Undo restores ---
    await accountBtn.click();
    await menu.getByRole('menuitem', { name: 'More account options' }).click();
    await menu.getByRole('menuitem', { name: 'Clear account' }).click();
    const clearDialog = page.locator('[role="dialog"]');
    await expect(clearDialog).toContainText('Delete all tasks in your account?');
    await clearDialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await liveIds(page)).toHaveLength(4);
    await accountBtn.click();
    await menu.getByRole('menuitem', { name: 'More account options' }).click();
    await menu.getByRole('menuitem', { name: 'Clear account' }).click();
    await clearDialog.getByRole('button', { name: 'Delete all tasks' }).click();
    await expect.poll(() => liveIds(page)).toEqual([]);
    await expect(accountBtn).toBeVisible();
    await expect.poll(() => fakeValue(page, 'fake.writes.at(-1).doc.tasks.every((t) => t.deleted)')).toBe(true);
    await page.locator('.toast', { hasText: 'All tasks deleted' }).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => liveIds(page).then((ids) => ids.length)).toBe(4);

    // --- Offline / online ---
    await context.setOffline(true);
    await expect(status).toHaveText('Offline');
    await context.setOffline(false);
    await expect(status).toHaveText('Synced ✓');

    // --- Sign out: the tasks travel with the account — the board is a guest's again ---
    await accountBtn.click();
    await menu.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(account.locator('.account-signin')).toBeVisible();
    await expect(page.locator('#banner')).toBeVisible();
    expect(await fakeValue(page, 'fake.signOuts')).toBe(1);
    expect(await storedIds(page)).toEqual([]);
    expect(await storeIds(page)).toEqual([]);

    // --- Sign out & clear this device (confirm first) ---
    await signInGoogle(page);
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();
    await menu.getByRole('menuitem', { name: 'More account options' }).click();
    await menu.getByRole('menuitem', { name: 'Sign out & clear this device' }).click();
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog).toContainText('delete the tasks saved in this browser');
    await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(accountBtn).toBeVisible();
    expect(await fakeValue(page, 'fake.signOuts')).toBe(1);

    await accountBtn.click();
    await menu.getByRole('menuitem', { name: 'More account options' }).click();
    await menu.getByRole('menuitem', { name: 'Sign out & clear this device' }).click();
    await confirmDialog.getByRole('button', { name: 'Sign out & clear this device' }).click();
    await expect(account.locator('.account-signin')).toBeVisible();
    expect(await fakeValue(page, 'fake.signOuts')).toBe(2);
    expect(await page.evaluate((key) => localStorage.getItem(key), DOC_KEY)).toBeNull();
    expect(await storeIds(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('popup blocked falls back to redirect; a cancelled popup is silent; other errors toast', async ({ page }) => {
    await page.goto('/');
    await startFakeSession(page);
    const button = signInBtn(page);

    await page.evaluate(() => (window.__fake.popupError = 'auth/popup-blocked'));
    await signInGoogle(page);
    await expect.poll(() => fakeValue(page, 'fake.redirects')).toBe(1);
    await expect(button).toBeEnabled();
    await expect(page.locator('.toast')).toHaveCount(0);

    await page.evaluate(() => (window.__fake.popupError = 'auth/popup-closed-by-user'));
    await signInGoogle(page);
    await expect(button).toBeEnabled();
    await expect(page.locator('.toast')).toHaveCount(0);

    await page.evaluate(() => (window.__fake.popupError = 'auth/network-request-failed'));
    await signInGoogle(page);
    await expect(page.locator('.toast')).toContainText('Sign-in failed');
    await expect(button).toBeVisible();
  });

  test('Continue with Apple signs in through the apple.com provider, asking for email and name', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page);
    await signInBtn(page).click();
    await page.getByRole('button', { name: 'Continue with Apple' }).click();
    await expect(page.locator('#account .account-btn')).toBeVisible();
    expect(await fakeValue(page, 'fake.lastProvider')).toBe('apple.com');
    expect(await fakeValue(page, 'fake.lastScopes')).toEqual(['email', 'name']);
  });

  test('email and password: wrong details say so in place; the right ones sign in', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page);
    await signInBtn(page).click();
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    const note = dialog.locator('.signin__note');

    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click(); // nothing typed yet
    await expect(note).toHaveText('Enter a valid email address.');
    await dialog.getByRole('textbox', { name: 'Email' }).fill('andreas@example.com');
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(note).toHaveText('Enter your password.');
    await dialog.getByLabel('Password').fill('wrong-one');
    await dialog.getByLabel('Password').press('Enter');
    await expect(note).toHaveText('Wrong email or password.');
    await expect(note).toHaveAttribute('data-tone', 'error');
    await expect(dialog).toBeVisible(); // stays open to try again

    await dialog.getByLabel('Password').fill('right-password');
    await dialog.getByLabel('Password').press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#account .account-btn')).toBeVisible();

    // An account with a password can change it, from behind the gear — by a link to its own address.
    await page.locator('#account .account-btn').click();
    const menu = page.locator('.popover--account');
    await menu.getByRole('menuitem', { name: 'More account options' }).click();
    await menu.getByRole('menuitem', { name: 'Change password' }).click();
    await expect(page.locator('.toast', { hasText: 'We sent a link to andreas@example.com' })).toBeVisible();
    expect(await fakeValue(page, 'fake.resets.at(-1).email')).toBe('andreas@example.com');
  });

  test('email: create an account (named, address confirmed by mail) or get a reset link for a forgotten password', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page);
    await signInBtn(page).click();
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    const note = dialog.locator('.signin__note');

    // Forgot password: one field, a link by mail, and the same answer whether or not the account exists.
    await dialog.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(dialog.getByLabel('Password')).toBeHidden();
    await expect(note).toHaveText('Enter your email and we will send you a link to set a new password.');
    await dialog.getByRole('textbox', { name: 'Email' }).fill('maria@example.com');
    await dialog.getByRole('button', { name: 'Send me a reset link' }).click();
    await expect(note).toContainText('If there is an account for maria@example.com, a link to set a new password is on its way');
    expect(await fakeValue(page, 'fake.resets[0].settings.url')).toMatch(/^http:\/\/localhost:\d+\/$/);

    // Create an account: a short password is refused; a taken address points to signing in instead.
    await dialog.getByRole('button', { name: 'Have an account? Sign in' }).click();
    await dialog.getByRole('button', { name: 'New here? Create an account' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Forgot password?' })).toBeHidden();
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Maria Ioannou');
    await dialog.getByRole('textbox', { name: 'Email' }).fill('andreas@example.com');
    await dialog.getByLabel('Password').fill('short');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(note).toHaveText('Choose a password of at least 8 characters.');
    await dialog.getByLabel('Password').fill('long-enough-1');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(note).toContainText('There is already an account with this email');

    await dialog.getByRole('textbox', { name: 'Email' }).fill('maria@example.com');
    await dialog.getByRole('button', { name: 'Create account' }).click();
    await expect(dialog).toHaveCount(0);
    const button = page.locator('#account .account-btn');
    await expect(button.locator('.account-name')).toHaveText('Maria');
    expect(await fakeValue(page, 'fake.created')).toEqual({ email: 'maria@example.com', password: 'long-enough-1' });
    expect(await fakeValue(page, 'fake.profile.displayName')).toBe('Maria Ioannou');
    expect(await fakeValue(page, 'fake.verification.email')).toBe('maria@example.com');
  });

  test('a sign-in link opened on another device asks for the email first', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/?mode=signIn&oobCode=abc123&apiKey=fake');
    const session = startFakeSession(page);
    const dialog = page.getByRole('dialog', { name: 'Confirm your email' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('andreas@example.com');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await session;
    await expect(page.locator('#account .account-btn')).toBeVisible();
    expect(await fakeValue(page, 'fake.linkEmail')).toBe('andreas@example.com');
  });

  test('Sync with Reminders (personal Mac bridge, opt-in with ?reminders=on): sends tasks, imports, ticks, links', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.addInitScript(() => localStorage.setItem('escape-the-matrix:owner', 'u1')); // this browser's copy is the account's own
    const calls = [];
    await page.route('http://127.0.0.1:47827/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      calls.push({ pathname, body: JSON.parse(request.postData() || '{}') });
      const body = pathname === '/sync'
        ? { created: 1, updated: 0, deleted: 0, completedInReminders: ['t_local'], reopenedInReminders: [], changedInReminders: [{ id: 't_local', title: 'Renamed in Reminders', date: '2026-03-20' }], deletedInReminders: [], imports: [{ reminderId: 'x-apple-reminder://R1', title: 'Buy milk', date: '2026-03-12' }] }
        : { linked: 1 };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/?reminders=on');
    await expect(page.locator('.toast', { hasText: 'Reminders sync is on in this browser' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.search)).toBe('');
    await startFakeSession(page, { signedIn: true });
    const accountBtn = page.locator('#account .account-btn');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();
    await page.getByRole('menuitem', { name: 'Sync with Reminders' }).click();
    await expect(page.locator('.toast', { hasText: 'Reminders synced' })).toBeVisible();

    expect(calls[0].pathname).toBe('/sync');
    expect(calls[0].body.tasks.find((task) => task.id === 't_local')).toMatchObject({ placed: expect.any(Boolean), updatedAt: expect.any(String) });
    expect(calls[0].body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tasks = await page.evaluate(() => window.__store.get().tasks);
    const imported = tasks.find((task) => task.title === 'Buy milk');
    expect(imported).toMatchObject({ date: '2026-03-12', quadrant: null, done: false });
    expect(tasks.find((task) => task.id === 't_local')).toMatchObject({ done: true, title: 'Renamed in Reminders', date: '2026-03-20' });
    expect(calls[1]).toEqual({ pathname: '/link', body: { links: [{ reminderId: 'x-apple-reminder://R1', taskId: imported.id, title: 'Buy milk', rDate: '2026-03-12', lDate: '2026-03-12', quadrant: null }] } });
  });

  test('with the opt-in on, the sync runs by itself — nothing to press', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    const calls = [];
    await page.route('http://127.0.0.1:47827/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      calls.push(pathname);
      const body =
        pathname === '/sync'
          ? { created: 0, updated: 0, deleted: 0, completedInReminders: ['t_local'], reopenedInReminders: [], changedInReminders: [], deletedInReminders: [], imports: [] }
          : { linked: 0 };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });

    await page.goto('/?reminders=on'); // no menu, no click — the shell starts syncing on its own
    await expect(page.locator('.toast', { hasText: 'Reminders synced' })).toBeVisible({ timeout: 20000 });
    expect(calls[0]).toBe('/sync');
    await expect
      .poll(async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DOC_KEY)).tasks.find((task) => task.id === 't_local').done)
      .toBe(true); // ticked in Reminders, ticked here
  });

  test('when both sides changed the same task, it asks which one stands and sends the answer', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    const calls = [];
    await page.route('http://127.0.0.1:47827/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const body = JSON.parse(request.postData() || '{}');
      calls.push({ pathname, resolve: body.resolve });
      const empty = { created: 0, updated: 0, deleted: 0, completedInReminders: [], reopenedInReminders: [], changedInReminders: [], deletedInReminders: [], imports: [] };
      // The first sync reports the clash; once an answer arrives, it is settled.
      const conflicts = body.resolve && Object.keys(body.resolve).length
        ? []
        : [{ id: 't_local', title: 'Local task', fields: { date: { levelix: '2026-03-12', reminders: '2026-03-20' }, done: { levelix: false, reminders: true } } }];
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ...empty, conflicts }) });
    });

    await page.goto('/?reminders=on');
    const dialog = page.getByRole('dialog', { name: 'Changed in both places' });
    await expect(dialog).toBeVisible({ timeout: 20000 });
    await expect(dialog).toContainText('Local task');
    await expect(dialog).toContainText('2026-03-12'); // what Levelix says
    await expect(dialog).toContainText('2026-03-20'); // what Reminders says

    await dialog.getByRole('button', { name: 'Keep Reminders' }).click();
    await expect.poll(() => calls.at(-1)?.resolve).toEqual({ t_local: 'reminders' });
    await expect(page.getByRole('dialog', { name: 'Changed in both places' })).toHaveCount(0);
  });

  test('Sync with Reminders tells you to restart an out-of-date bridge instead of claiming success', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.route('http://127.0.0.1:47827/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ created: 0, updated: 0, deleted: 0, completedInReminders: [], imports: [] }) }),
    );
    await page.goto('/?reminders=on');
    await startFakeSession(page, { signedIn: true });
    await page.locator('#account .account-btn').click();
    await page.getByRole('menuitem', { name: 'Sync with Reminders' }).click();
    await expect(page.locator('.toast', { hasText: 'older version' })).toBeVisible();
    await expect(page.locator('.toast', { hasText: 'Reminders synced' })).toHaveCount(0);
  });

  test('Go Pro in the account menu offers both plans, each to its checkout, and the code box for a code', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page, { signedIn: true });
    await page.locator('#account .account-btn').click();
    await page.getByRole('menuitem', { name: 'Go Pro' }).click();

    const chooser = page.getByRole('dialog', { name: 'Go Pro' });
    await expect(chooser.locator('.gopro__plan')).toHaveCount(2);
    await expect(chooser.locator('.gopro__plan').nth(0)).toContainText('€28');
    await expect(chooser.locator('.gopro__plan').nth(0)).toHaveAttribute('href', /^https:\/\/buy\.stripe\.com\/9B628r2w0gHX6kx5Mi6Zy00\?client_reference_id=/);
    await expect(chooser.locator('.gopro__plan').nth(1)).toContainText('Pro monthly');
    await expect(chooser.locator('.gopro__plan').nth(1)).toHaveAttribute('href', /^https:\/\/buy\.stripe\.com\/6oUbJ17Qk0IZbERfmS6Zy01\?client_reference_id=/);
    await chooser.getByRole('button', { name: 'I have a code' }).click();

    const dialog = page.getByRole('dialog', { name: 'Unlock Levelix Pro' });
    await expect(dialog).toBeVisible();
    await dialog.locator('.redeem__input').fill('abc');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.locator('.toast', { hasText: 'That does not look like a code' })).toBeVisible();
    await expect(dialog).toBeVisible(); // the dialog stays open so the code can be corrected
  });

  test('two accounts on one browser never mix: each signs in to its own tasks; guest work joins only when synced', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC }); // t_local: written signed out, belongs to nobody yet
    await page.goto('/');
    await startFakeSession(page);
    const account = page.locator('#account');
    const menu = page.locator('.popover--account');
    const signOut = async () => {
      await account.locator('.account-btn').click();
      await menu.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
      await expect(signInBtn(page)).toBeVisible();
    };

    // Account A (Google): its own task only; the guest task joins when A presses Sync.
    await signInGoogle(page);
    await expect(account.locator('.account-btn')).toBeVisible();
    await expect.poll(() => storeIds(page)).toEqual(['t_remote']);
    await account.locator('.account-btn').click();
    await page.locator('.popover--account .account-menu__sync').click();
    await page.getByRole('dialog', { name: 'Move these tasks into your account?' }).getByRole('button', { name: 'Move into my account' }).click();
    await expect.poll(() => storeIds(page)).toEqual(['t_local', 't_remote']);
    await signOut();
    await expect.poll(() => storeIds(page)).toEqual([]); // signed out, the board is a guest's

    // Account B (say, Apple with a hidden email) signs in on the same browser: only B's own tasks.
    await page.evaluate(() => {
      const other = { id: 't_other', title: 'Only B has this', date: '2026-03-11', quadrant: 'do', order: 1, done: false, doneAt: null, createdAt: 'x', updatedAt: '2026-03-10T00:00:00.000Z', timer: null };
      window.__fake.user = { uid: 'u9', displayName: 'Someone Else', email: 'w8j@privaterelay.appleid.com', photoURL: null };
      window.__fake.remote = { doc: { version: 1, updatedAt: '2026-03-10T00:00:00.000Z', settings: {}, tasks: [other] }, updatedAt: '2026-03-10T00:00:00.000Z', email: 'w8j@privaterelay.appleid.com' };
      window.__fake.writes.length = 0;
    });
    await signInGoogle(page);
    await expect(account.locator('.account-name')).toHaveText('Someone');
    await expect.poll(() => storeIds(page)).toEqual(['t_other']);
    // Nothing of A's was written into B's account.
    await expect.poll(() => fakeValue(page, 'fake.writes.every((w) => w.doc.tasks.every((t) => t.id === "t_other"))')).toBe(true);
    await signOut();

    // A again: A's copy (set aside on this browser) comes back, and B's task does not follow.
    await page.evaluate(() => {
      window.__fake.user = { uid: 'u1', displayName: 'Andreas Papadopoulos', email: 'andreas@example.com', photoURL: null };
      window.__fake.remote = null; // even with nothing to read from the server, A's own copy is here
    });
    await signInGoogle(page);
    await expect(account.locator('.account-name')).toHaveText('Andreas');
    await expect.poll(() => storeIds(page)).toEqual(['t_local', 't_remote']);
  });

  test('Connect Apple from behind the gear: either button then opens this account; a login with its own account is refused', async ({ page }) => {
    await seed(page, { ui: UI_STATE });
    await page.goto('/');
    await startFakeSession(page, { signedIn: true });
    const button = page.locator('#account .account-btn');
    const menu = page.locator('.popover--account');
    const gear = async () => {
      await button.click();
      await menu.getByRole('menuitem', { name: 'More account options' }).click();
    };

    await gear();
    await expect(menu.getByRole('menuitem', { name: 'Connect Google' })).toHaveCount(0); // it signed in with Google
    await page.evaluate(() => (window.__fake.linkError = 'auth/credential-already-in-use'));
    await menu.getByRole('menuitem', { name: 'Connect Apple' }).click();
    await expect(page.locator('.toast', { hasText: 'That Apple login already has its own Levelix account' })).toBeVisible();

    await page.evaluate(() => (window.__fake.linkError = null));
    await gear();
    await menu.getByRole('menuitem', { name: 'Connect Apple' }).click();
    await expect(page.locator('.toast', { hasText: 'Apple is connected — either button now opens this account.' })).toBeVisible();
    expect(await fakeValue(page, 'fake.linked')).toBe('apple.com');
    await gear();
    await expect(menu.getByRole('menuitem', { name: 'Connect Apple' })).toHaveCount(0);
  });

  test('Switch account: signs out (this account keeps its tasks) and opens the sign-in straight away', async ({ page }) => {
    await seed(page, { ui: UI_STATE });
    await page.goto('/');
    await startFakeSession(page, { signedIn: true });
    await page.locator('#account .account-btn').click();
    await page.locator('.popover--account').getByRole('menuitem', { name: 'More account options' }).click(); // behind the gear
    await page.locator('.popover--account').getByRole('menuitem', { name: 'Switch account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    await expect(dialog).toContainText('Choose the account to open. Each account keeps its own tasks and Pro.');
    await expect(page.locator('#account .account-name')).toHaveCount(0); // signed out underneath
    await expect.poll(() => page.evaluate(() => localStorage.getItem('escape-the-matrix:v1:u1') !== null)).toBe(true); // its copy set aside
  });

  test('Delete account: asked first (signing in again when Google wants it), then the account and this device are cleared', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.addInitScript(() => localStorage.setItem('escape-the-matrix:owner', 'u1'));
    await page.goto('/');
    await startFakeSession(page, { signedIn: true });
    const button = page.locator('#account .account-btn');
    const menu = page.locator('.popover--account');
    const askToDelete = async () => {
      await button.click();
      await menu.getByRole('menuitem', { name: 'More account options' }).click();
      await menu.getByRole('menuitem', { name: 'Delete account' }).click();
      return page.getByRole('dialog', { name: 'Delete your Levelix account?' });
    };

    let dialog = await askToDelete();
    await expect(dialog).toContainText('The account andreas@example.com is deleted for good');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(button).toBeVisible();
    expect(await fakeValue(page, 'fake.deletedUsers ?? 0')).toBe(0);

    await page.evaluate(() => (window.__fake.deleteNeedsLogin = 1)); // the last sign-in is too old
    dialog = await askToDelete();
    await dialog.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.locator('.toast', { hasText: 'Your account has been deleted.' })).toBeVisible();
    expect(await fakeValue(page, 'fake.reauthenticated')).toBe('google.com');
    expect(await fakeValue(page, 'fake.deletedUsers')).toBe(1);
    await expect(signInBtn(page)).toBeVisible();
    expect(await storeIds(page)).toEqual([]);
    expect(await page.evaluate(() => [localStorage.getItem('escape-the-matrix:v1'), localStorage.getItem('escape-the-matrix:owner')])).toEqual([null, null]);
  });

  test('Refund policy, last in the account menu: the server says first whether this payment can be refunded; the button works only then', async ({ page }) => {
    await seed(page, { ui: UI_STATE });
    await page.goto('/');
    await startFakeSession(page, { signedIn: true });
    const button = page.locator('#account .account-btn');
    const menu = page.locator('.popover--account');
    const openPolicy = async (check) => {
      await page.evaluate((check) => (window.__fake.refundCheck = check), check);
      await button.click();
      await menu.getByRole('menuitem', { name: 'Refund policy' }).click(); // not behind the gear
      return page.getByRole('dialog', { name: 'Refund policy' });
    };

    // Pro from a code nobody paid for (the owner's own account): the rules, and a button that cannot be used.
    await page.evaluate(() => window.__fake.byPath['billing/u1'](window.__fake.snap({ plan: 'pro', period: 'monthly', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(), source: 'voucher' })));
    let dialog = await openPolicy({ status: 'none' });
    await expect(dialog).toContainText('Within 14 days of paying for Levelix Pro');
    await expect(dialog.locator('.refund__status')).toHaveText('Pro on this account came from a code that was not paid for, so there is nothing to refund.');
    await expect(dialog.getByRole('button', { name: 'Refund', exact: true })).toBeDisabled();
    expect(await fakeValue(page, 'fake.calls')).toEqual([{ check: true }]); // only asked — nothing refunded
    await page.keyboard.press('Escape');

    // Past the 14 days: says until when it could have been.
    dialog = await openPolicy({ status: 'too-late', paidAt: '2026-09-01T10:00:00.000Z', until: '2026-09-15T10:00:00.000Z' });
    await expect(dialog.locator('.refund__status')).toHaveText('Your payment on 1 September 2026 is past the 14 days — they ended on 15 September 2026.');
    await expect(dialog.getByRole('button', { name: 'Refund', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');

    // Within the 14 days: the button names the amount and refunds.
    await page.evaluate(() => (window.__fake.refundResult = { status: 'refunded', amount: 480, currency: 'eur' }));
    dialog = await openPolicy({ status: 'eligible', amount: 480, currency: 'eur', paidAt: '2026-10-17T10:00:00.000Z', until: '2026-10-31T10:00:00.000Z' });
    await expect(dialog.locator('.refund__status')).toHaveText('Your payment of €4,80 on 17 October 2026 can be refunded until 31 October 2026.');
    await dialog.getByRole('button', { name: 'Refund €4,80' }).click();
    await expect(page.locator('.toast', { hasText: 'Refund on its way: €4,80 back to your card. Pro has ended.' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Refund/ })).toHaveCount(0);
    expect(await fakeValue(page, 'fake.calls')).toEqual([{ check: true }, { check: true }, { check: true }, {}]);
    expect(await fakeValue(page, 'fake.called')).toBe('requestRefund');
  });

  test('Go Pro on Home while signed out: sign in first, then straight on to the checkout with the account', async ({ page }) => {
    await page.route('https://buy.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe stub</title>' }));
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page);
    await page.locator('.brand').click();
    await page.locator('.home-plan--monthly').getByRole('link', { name: 'Go Pro' }).click();

    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    await expect(dialog).toContainText('Sign in first, so Pro lands on your account');
    await expect(page.getByRole('dialog')).toHaveCount(1); // only the sign-in, nothing else on top
    await dialog.getByRole('button', { name: 'Continue with Google' }).click();
    await page.waitForURL(/^https:\/\/buy\.stripe\.com\/6oUbJ17Qk0IZbERfmS6Zy01\?client_reference_id=u1$/);
  });

  test('when the SDK cannot load, free mode stays usable and the button retries on click', async ({ page }) => {
    await page.goto('/');
    await startFakeSession(page, { failLoads: 1 });
    const button = signInBtn(page);
    await expect(button).toBeVisible();
    await expect(page.locator('.toast')).toHaveCount(0);
    await signInGoogle(page);
    await expect(page.locator('#account .account-btn')).toBeVisible();
  });

  test('a persisted session restores on load; photo avatar renders; mobile header has no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page, { signedIn: true, photoURL: PNG_1PX });
    const accountBtn = page.locator('#account .account-btn');
    await expect(accountBtn).toBeVisible();
    await expect(accountBtn.locator('img.account-avatar')).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(accountBtn.locator('.account-name')).toBeHidden();
    // The task written signed out waits to be synced; the account shows its own.
    await expect(accountBtn.locator('.sr-only')).toHaveText('1 task in this browser is waiting to sync');
    await expect.poll(() => storeIds(page)).toEqual(['t_remote']);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(OUT, 'account-mobile-signed-in.png') });
    await accountBtn.click();
    const menu = page.locator('.popover--account');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('opacity', '1');
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: path.join(OUT, 'account-mobile-menu.png') });
  });
});
