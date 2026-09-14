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
      if (ui) localStorage.setItem(uiKey, JSON.stringify(ui));
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
      const user = { uid: 'u1', displayName: 'Andreas Papadopoulos', email: 'andreas@example.com', photoURL };
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
        getAuth: () => ({}),
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
        sendSignInLinkToEmail: async (auth, email, settings) => {
          fake.linkSent = { email, settings };
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
          fake.current = user;
          fake.authListeners.forEach((callback) => callback(user));
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
        doc: (db, collection, id) => ({ path: `${collection}/${id}` }),
        getDoc: async () => snapshot(fake.remote, { hasPendingWrites: false, fromCache: false }),
        setDoc: async (ref, data) => {
          fake.writes.push(data);
          fake.remote = data;
        },
        onSnapshot: (ref, next) => {
          fake.snapshotListeners.push(next);
          return () => {};
        },
      };
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
  test('renders a compact account icon that opens a sign-in chooser (Google + email; Apple hidden until configured), and the free-mode banner', async ({ page }) => {
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
    await expect(dialog.getByRole('button', { name: 'Continue with Apple' })).toHaveCount(0); // not in authProviders yet
    await expect(dialog.getByRole('button', { name: 'Continue with email' })).toBeVisible();
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

    // --- Sign in: local ∪ remote → store, localStorage and (reconciled) Firestore ---
    await signInGoogle(page);
    await expect(accountBtn).toBeVisible();
    await expect(accountBtn.locator('.account-name')).toHaveText('Andreas');
    await expect(accountBtn.locator('.account-avatar--initials')).toHaveText('A');
    await expect(status).toHaveText('Synced ✓');
    await expect(page.locator('#banner')).toBeHidden();
    expect(await fakeValue(page, 'fake.providerParams')).toEqual({ prompt: 'select_account' });
    expect(await fakeValue(page, 'fake.signedIn.at(-1)')).toBe(true);
    expect(await storeIds(page)).toEqual(['t_local', 't_remote']);
    expect(await storedIds(page)).toEqual(['t_local', 't_remote']);
    await expect.poll(() => fakeValue(page, 'fake.writes.length')).toBe(1);
    const written = await fakeValue(page, 'fake.writes[0]');
    expect(written.email).toBe('andreas@example.com');
    expect(written.doc.tasks.map((t) => t.id).sort()).toEqual(['t_local', 't_remote']);
    expect(written.updatedAt > REMOTE_ENVELOPE.updatedAt).toBe(true);

    // --- Account menu ---
    await accountBtn.click();
    const menu = page.locator('.popover--account');
    await expect(menu).toBeVisible();
    await expect(accountBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('.account-menu__name')).toHaveText('Andreas Papadopoulos');
    await expect(menu.locator('.account-menu__email')).toHaveText('andreas@example.com');
    await expect(menu.locator('.account-menu__status')).toHaveText('Synced ✓');
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['Sign out', 'Clear account', 'Sign out & clear this device']);
    await expect(menu.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Clear account' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Sign out & clear this device' })).toBeFocused();
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
          const base = window.__fake.writes[0].doc;
          const live = { ...base.tasks[0], id, title: id, updatedAt };
          window.__fake.push({ doc: { ...base, updatedAt, tasks: [live] }, updatedAt, email: 'andreas@example.com' }, metadata);
        },
        { id, offsetMs, metadata },
      );
    const MINUTE = 60_000;
    await pushRemote('t_live', MINUTE);
    expect(await storeIds(page)).toEqual(['t_live', 't_local', 't_remote']);
    await expect.poll(() => fakeValue(page, 'fake.writes.length')).toBe(2);
    expect((await fakeValue(page, 'fake.writes[1]')).doc.tasks.map((t) => t.id).sort()).toEqual(['t_live', 't_local', 't_remote']);
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
    await menu.getByRole('menuitem', { name: 'Clear account' }).click();
    const clearDialog = page.locator('[role="dialog"]');
    await expect(clearDialog).toContainText('Delete all tasks in your account?');
    await clearDialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await liveIds(page)).toHaveLength(4);
    await accountBtn.click();
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

    // --- Sign out keeps the local copy ---
    await accountBtn.click();
    await menu.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(account.locator('.account-signin')).toBeVisible();
    await expect(page.locator('#banner')).toBeVisible();
    expect(await fakeValue(page, 'fake.signOuts')).toBe(1);
    expect((await storedIds(page)).length).toBe(4);

    // --- Sign out & clear this device (confirm first) ---
    await signInGoogle(page);
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();
    await menu.getByRole('menuitem', { name: 'Sign out & clear this device' }).click();
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog).toContainText('delete the tasks saved in this browser');
    await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(accountBtn).toBeVisible();
    expect(await fakeValue(page, 'fake.signOuts')).toBe(1);

    await accountBtn.click();
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

  test('Continue with email mails a sign-in link; opening the link signs in and cleans the address bar', async ({ page }) => {
    await seed(page, { ui: UI_STATE, doc: LOCAL_DOC });
    await page.goto('/');
    await startFakeSession(page);
    await signInBtn(page).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'Continue with email' }).click(); // nothing typed yet
    await expect(page.locator('.toast', { hasText: 'Enter a valid email address.' })).toBeVisible();
    await expect(dialog).toBeVisible(); // stays open to fix the address
    await dialog.getByRole('textbox').fill('andreas@example.com');
    await dialog.getByRole('textbox').press('Enter');
    await expect(page.locator('.toast', { hasText: 'Check andreas@example.com' })).toBeVisible();
    expect(await fakeValue(page, 'fake.linkSent.email')).toBe('andreas@example.com');
    expect(await fakeValue(page, 'fake.linkSent.settings.handleCodeInApp')).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('escape-the-matrix:emailForSignIn'))).toBe('andreas@example.com');

    // The emailed link brings the user back to the site with a one-time code.
    await page.goto('/?mode=signIn&oobCode=abc123&apiKey=fake');
    await startFakeSession(page);
    await expect(page.locator('#account .account-btn')).toBeVisible();
    expect(await fakeValue(page, 'fake.linkEmail')).toBe('andreas@example.com');
    await expect.poll(() => page.evaluate(() => location.search)).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('escape-the-matrix:emailForSignIn'))).toBeNull();
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
    const calls = [];
    await page.route('http://127.0.0.1:47827/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      calls.push({ pathname, body: JSON.parse(request.postData() || '{}') });
      const body = pathname === '/sync'
        ? { created: 1, updated: 0, deleted: 0, completedInReminders: ['t_local'], imports: [{ reminderId: 'x-apple-reminder://R1', title: 'Buy milk', date: '2026-03-12' }] }
        : { linked: 1 };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/?reminders=on');
    await expect.poll(() => page.evaluate(() => location.search)).toBe('');
    await startFakeSession(page, { signedIn: true });
    const accountBtn = page.locator('#account .account-btn');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();
    await page.getByRole('menuitem', { name: 'Sync with Reminders' }).click();
    await expect(page.locator('.toast', { hasText: 'Reminders synced' })).toBeVisible();

    expect(calls[0].pathname).toBe('/sync');
    expect(calls[0].body.tasks.map((task) => task.id)).toContain('t_local');
    const tasks = await page.evaluate(() => window.__store.get().tasks);
    const imported = tasks.find((task) => task.title === 'Buy milk');
    expect(imported).toMatchObject({ date: '2026-03-12', quadrant: null, done: false });
    expect(tasks.find((task) => task.id === 't_local').done).toBe(true);
    expect(calls[1]).toEqual({ pathname: '/link', body: { links: [{ reminderId: 'x-apple-reminder://R1', taskId: imported.id }] } });
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
    await expect(accountBtn.locator('.sr-only')).toHaveText('Synced ✓');
    expect(await storeIds(page)).toEqual(['t_local', 't_remote']);
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
