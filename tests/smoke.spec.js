import { test, expect } from './fixtures.js';

const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';

const TITLES = {
  1: 'Pick your day',
  2: 'Write it all down',
  3: 'Place them by priority',
};

const activePanel = (page) => page.locator('#stage .panel:not(.panel--ghost)');
const activeTitle = (page) => activePanel(page).locator('.stage-title');

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Seeds localStorage before the app boots. */
function seed(page, { ui, doc } = {}) {
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (ui) localStorage.setItem(uiKey, JSON.stringify({ savedAt: Date.now(), ...ui }));
      if (doc) localStorage.setItem(docKey, JSON.stringify(doc));
    },
    { uiKey: UI_KEY, docKey: DOC_KEY, ui, doc },
  );
}

test('loads with the title, a 3-step stepper and no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Levelix — Escape the Matrix of your daily routine');
  await expect(page.locator('#stepper .step')).toHaveCount(3);
  await expect(page.locator('#stepper .step').nth(0)).toHaveAttribute('aria-current', 'step');
  await expect(activeTitle(page)).toHaveText(TITLES[1]);
  await expect(page.locator('#banner')).toContainText('Free mode');
  await expect(page.locator('#account button')).toHaveAttribute('aria-label', 'Sign in');
  expect(errors).toEqual([]);
});

test('the logo opens Home: three steps with screenshots, and its buttons lead into the app', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.locator('.brand').click();
  await expect(activePanel(page)).toHaveAttribute('data-stage', '0');
  await expect(page.locator('.brand')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#stepper .step[aria-current]')).toHaveCount(0);
  await expect(activeTitle(page)).toHaveText('Escape the Matrix.');
  const shots = activePanel(page).locator('.home-step__shot img');
  await expect(shots).toHaveCount(3);
  for (const img of await shots.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);
  }
  await expect(activePanel(page).getByRole('heading', { name: 'Start free' })).toBeVisible();

  await expect(page.locator('.report-fabs')).toBeHidden(); // Done + Time report live on the stages, not Home

  await activePanel(page).getByRole('button', { name: 'Open the calendar' }).click();
  await expect(activeTitle(page)).toHaveText(TITLES[1]);
  await expect(page.locator('.brand')).toHaveAttribute('aria-current', 'false');

  await page.locator('.brand').click();
  await page.reload();
  await expect(activePanel(page)).toHaveAttribute('data-stage', '0'); // Home is remembered like any tab
  expect(errors).toEqual([]);
});

test('the Time report button is always last, under every task, on Write down and Prioritize only', async ({ page }) => {
  await page.goto('/');
  const fab = page.getByRole('button', { name: 'Time report' });
  const steps = page.locator('#stepper .step');
  await expect(fab).toBeHidden(); // calendar
  const belowContent = () =>
    page.evaluate(() => {
      const panel = document.querySelector('#stage .panel:not(.panel--ghost)').getBoundingClientRect();
      const button = document.querySelector('.report-fabs').getBoundingClientRect();
      return { gap: Math.round(button.top - panel.bottom), centre: Math.round(button.left + button.width / 2 - innerWidth / 2) };
    });
  await steps.nth(1).click();
  await expect(fab).toBeVisible();
  const input = page.locator('.dump__input');
  for (let i = 1; i <= 12; i += 1) {
    await input.fill(`Task ${i}`);
    await input.press('Enter');
  }
  await expect(page.locator('#stage .panel:not(.panel--ghost) .dump-row')).toHaveCount(12);
  for (const n of [2, 3]) {
    await steps.nth(n - 1).click();
    await expect(fab).toBeVisible();
    await page.waitForTimeout(400); // cross-fade
    const { gap, centre } = await belowContent();
    expect(gap).toBeGreaterThanOrEqual(0); // never over a task
    expect(Math.abs(centre)).toBeLessThanOrEqual(8); // the row is centred (scrollbar gutter allowed)
  }
  await fab.click();
  await expect(page.getByRole('dialog', { name: 'Time spent per task' })).toBeVisible();
  await page.keyboard.press('Escape');
  await steps.nth(0).click();
  await expect(fab).toBeHidden();
});

test('Done: finished tasks by day with counts; deleting a task, a day or all of them makes room on Free, with Undo', async ({ page }) => {
  const today = new Date();
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const at = new Date().toISOString();
  const task = (id, date, done) => ({ id, title: id, date, quadrant: 'do', tag: 'do', done, doneAt: done ? at : null, createdAt: at, updatedAt: at, order: 0 });
  const tasks = [
    ...Array.from({ length: 98 }, (_, i) => task(`open ${i}`, key(today), false)),
    task('Wrote the report', key(today), true),
    task('Called the bank', key(yesterday), true),
  ];
  await seed(page, { doc: { version: 1, updatedAt: at, settings: {}, tasks } });
  await page.goto('/');

  // At 100 (finished ones included) Free is full: the message leads to Done.
  await page.locator('#stepper .step').nth(1).click();
  await page.locator('.dump__input').fill('One more');
  await page.locator('.dump__input').press('Enter');
  const toast = page.locator('.toast').filter({ hasText: 'finished ones included' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Done' }).click();

  const dialog = page.getByRole('dialog', { name: 'Done' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.history__stat').first()).toContainText('1'); // today
  await expect(dialog.locator('.history__stat').last()).toContainText('2'); // all time
  await expect(dialog.locator('.history__usage')).toContainText('100 of 100 tasks on Free');
  await expect(dialog.locator('.history__day')).toHaveCount(2);
  await expect(dialog.locator('.history__day').first()).toContainText('Wrote the report');

  await dialog.getByRole('button', { name: 'Delete this task: Called the bank' }).click();
  await expect(dialog.locator('.history__day')).toHaveCount(1);
  await expect(dialog.locator('.history__usage')).toContainText('99 of 100');
  await page.locator('.toast').filter({ hasText: 'Task deleted' }).getByRole('button', { name: 'Undo' }).click();
  await expect(dialog.locator('.history__day')).toHaveCount(2);

  // Delete all asks for a second press.
  await dialog.getByRole('button', { name: 'Delete all finished tasks' }).click();
  await expect(dialog.locator('.history__day')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Press again to delete all 2' }).click();
  await expect(dialog.locator('.history__empty')).toBeVisible();
  await expect(dialog.locator('.history__usage')).toContainText('98 of 100');
  await page.keyboard.press('Escape');

  // Room again: the task goes in. The Done button sits beside Time report.
  await page.locator('.dump__input').fill('One more');
  await page.locator('.dump__input').press('Enter');
  await expect(page.locator('.dump-row input').last()).toHaveValue('One more');
  await page.getByRole('button', { name: 'Done — your finished tasks' }).click();
  await expect(page.getByRole('dialog', { name: 'Done' }).locator('.history__empty')).toBeVisible();
});

test('"See an example" sweeps the logo colours on arrival and is hidden for signed-in users', async ({ page }) => {
  await page.goto('/');
  const demo = activePanel(page).locator('.calendar__demo');
  await expect(demo).toHaveClass(/is-inviting/);
  await page.evaluate(() => document.body.classList.add('is-signed-in')); // what the app sets on sign-in
  await expect(demo).toBeHidden();
});

test('a day opened from the calendar returns there: Back lands on the same view (normal or flipped), day selected', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0)); // today = Wed 11 Mar 2026
  const DAY = '2026-03-16';
  const task = { id: 't_1', title: 'Call the bank', date: DAY, quadrant: 'do', tag: 'do', order: 1, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null, attempt: 1, carriedTo: null };
  await seed(page, {
    ui: { stage: 1, selectedDate: '2026-03-11', calendarMonth: '2026-03' },
    doc: { version: 1, updatedAt: 'x', settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: true, 2: true, 3: true, 4: true } }, tasks: [task] },
  });
  await page.goto('/');
  const calendar = () => activePanel(page).locator('.calendar');
  const openFromFlip = async () => {
    const flip = activePanel(page).locator('.calendar__flip');
    if ((await flip.getAttribute('aria-pressed')) !== 'true') await flip.click();
    await expect(calendar()).toHaveClass(/calendar--flipped/);
    await activePanel(page).locator(`.calendar__day[data-key="${DAY}"]`).click();
    await page.getByRole('button', { name: 'Open day →' }).click();
    await expect(activePanel(page)).toHaveAttribute('data-stage', '3');
  };
  const expectFlippedCalendar = async () => {
    await expect(activePanel(page)).toHaveAttribute('data-stage', '1');
    await expect(calendar()).toHaveClass(/calendar--flipped/);
    await expect(activePanel(page).locator('.calendar__flip')).toHaveAttribute('aria-pressed', 'true');
    await expect(activePanel(page).locator(`.calendar__day[data-key="${DAY}"]`)).toHaveClass(/calendar__day--selected/);
  };

  // From the normal calendar: a non-today day opens Prioritize, and Back returns to the normal calendar.
  await activePanel(page).locator(`.calendar__day[data-key="${DAY}"]`).click();
  await expect(activePanel(page)).toHaveAttribute('data-stage', '3');
  await activePanel(page).getByRole('button', { name: '← Back' }).click();
  await expect(activePanel(page)).toHaveAttribute('data-stage', '1');
  await expect(calendar()).not.toHaveClass(/calendar--flipped/);
  await expect(activePanel(page).locator(`.calendar__day[data-key="${DAY}"]`)).toHaveClass(/calendar__day--selected/);

  await openFromFlip();
  await activePanel(page).getByRole('button', { name: '← Back' }).click();
  await expectFlippedCalendar();

  await openFromFlip();
  await activePanel(page).getByRole('button', { name: 'Back to calendar' }).click();
  await expectFlippedCalendar();

  // Prioritize reached any other way (here: the tab) keeps its normal Back, to Write down.
  await page.locator('#stepper .step').nth(2).click();
  await activePanel(page).getByRole('button', { name: '← Back' }).click();
  await expect(activePanel(page)).toHaveAttribute('data-stage', '2');
});

test('clicking each stepper step shows the right stage title', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const steps = page.locator('#stepper .step');
  for (const n of [2, 3, 1]) {
    await steps.nth(n - 1).click();
    await expect(activeTitle(page)).toHaveText(TITLES[n]);
    await expect(steps.nth(n - 1)).toHaveAttribute('aria-current', 'step');
    await expect(activePanel(page)).toHaveAttribute('data-stage', String(n));
  }
  await expect(page.locator('#stage .panel--ghost')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Back / Next buttons walk the stages; stage 4 returns to the calendar', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0)); // today = Wed 11 Mar 2026
  await page.goto('/');
  // Stage 1 has no nav buttons — you enter by picking a day.
  await expect(activePanel(page).locator('.stage-nav')).toHaveCount(0);
  // Picking a day opens Ready; the dump is one tab away.
  await activePanel(page).locator('.calendar__day[data-key="2026-03-19"]').click();
  await expect(activeTitle(page)).toHaveText(TITLES[3]);
  await page.locator('#stepper .step').nth(1).click();
  await expect(activeTitle(page)).toHaveText(TITLES[2]);

  // Stage 2 only lets Next through once the day has a task (SPEC §2).
  await activePanel(page).locator('.dump__input').fill('Smoke task');
  await page.keyboard.press('Enter');
  await activePanel(page).locator('.stage-nav__next').click();
  await expect(activeTitle(page)).toHaveText(TITLES[3]);
  await expect(activePanel(page).locator('.stage-nav__next')).toHaveText('Back to calendar');
  await activePanel(page).locator('.stage-nav__next').click();
  await expect(activeTitle(page)).toHaveText(TITLES[1]);
});

test('keyboard arrows drive the shell', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('ArrowRight');
  await expect(activeTitle(page)).toHaveText(TITLES[2]);
  // → mirrors "Next →", which Stage 2 disables until the day has a task (SPEC §2).
  await page.keyboard.press('ArrowRight');
  await expect(activeTitle(page)).toHaveText(TITLES[2]);
  await activePanel(page).locator('.dump__input').fill('Smoke task');
  await page.keyboard.press('Enter');
  await activeTitle(page).click(); // leave the input so the shortcut is live again
  await page.keyboard.press('ArrowRight');
  await expect(activeTitle(page)).toHaveText(TITLES[3]);

  // On Prioritize the arrows walk the days instead; Shift + arrow still changes the stage.
  const day = () => activePanel(page).locator('.stage-nav__day-label');
  const started = await day().textContent();
  await page.keyboard.press('ArrowRight');
  await expect(day()).not.toHaveText(started);
  await page.keyboard.press('ArrowLeft');
  await expect(day()).toHaveText(started);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(activeTitle(page)).toHaveText(TITLES[2]);

  // The app moved focus to the new stage's title by itself: no green ring for that. Tab shows it.
  const ring = () => page.evaluate(() => ({ tag: document.activeElement.tagName, outline: getComputedStyle(document.activeElement).outlineStyle }));
  await expect.poll(async () => (await ring()).tag).not.toBe('BODY');
  await expect.poll(async () => (await ring()).outline).toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.locator('html')).toHaveClass(/kbd-nav/);
  await page.mouse.click(5, 5);
  await expect(page.locator('html')).not.toHaveClass(/kbd-nav/);
});

test('no speech-bubble tips and no "?" button (tips were removed)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bubble')).toHaveCount(0);
  await expect(page.locator('#tip-button')).toHaveCount(0);
  for (const n of [2, 3]) {
    await page.locator('#stepper .step').nth(n - 1).click();
    await expect(page.locator('.bubble')).toHaveCount(0);
  }
});

test('free-mode banner dismissal is remembered', async ({ page }) => {
  await page.goto('/');
  await page.locator('#banner button').click();
  await expect(page.locator('#banner')).toBeHidden();
  await page.reload();
  await expect(activeTitle(page)).toBeVisible();
  await expect(page.locator('#banner')).toBeHidden();
});

test('per-device UI state (stage + selected day) is restored on reload', async ({ page }) => {
  await seed(page, {
    ui: { selectedDate: '2026-03-11', stage: 3, calendarMonth: '2026-03' },
    doc: {
      version: 1,
      updatedAt: '2026-03-11T08:00:00.000Z',
      settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: true, 2: true, 3: true, 4: true } },
      tasks: [
        { id: 't_a', title: 'A', date: '2026-03-11', quadrant: 'do', order: 1, done: true, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null },
        { id: 't_b', title: 'B', date: '2026-03-11', quadrant: null, order: 2, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null },
      ],
    },
  });
  await page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0));
  await page.goto('/');
  await expect(activeTitle(page)).toHaveText(TITLES[3]);
  await expect(activePanel(page)).toHaveAttribute('data-stage', '3');
  // The day it restored is the one whose tasks show on the board.
  await page.locator('#stepper .step').nth(2).click();
  await expect(activePanel(page).locator('.task-card')).toContainText(['A']);
});

const DAY_DOC = (date) => ({
  version: 1,
  updatedAt: `${date}T08:00:00.000Z`,
  settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: true, 2: true, 3: true, 4: true } },
  tasks: [{ id: 't_a', title: 'A', date, quadrant: 'do', order: 1, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null }],
});

test('coming back on another day opens on today; the stage you left is still restored', async ({ page }) => {
  await seed(page, {
    ui: { selectedDate: '2026-03-09', stage: 3, calendarMonth: '2026-03', savedAt: new Date(2026, 2, 9, 18, 0, 0).getTime() },
    doc: DAY_DOC('2026-03-09'),
  });
  await page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0)); // two days later
  await page.goto('/');
  await expect(activePanel(page)).toHaveAttribute('data-stage', '3');
  await expect(activePanel(page).locator('.stage-nav__day-label')).toHaveText('Wed 11 Mar');
});

test('a tab left open overnight follows the day: looking at it again shows today', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 2, 11, 23, 50, 0) });
  await seed(page, { ui: { selectedDate: '2026-03-11', stage: 3, calendarMonth: '2026-03' }, doc: DAY_DOC('2026-03-11') });
  await page.goto('/');
  await expect(activePanel(page).locator('.stage-nav__day-label')).toHaveText('Wed 11 Mar');

  await page.clock.fastForward('00:20:00'); // past midnight, with the tab still open
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(activePanel(page).locator('.stage-nav__day-label')).toHaveText('Thu 12 Mar');
});

test('back from Stripe: ?pro=thanks says the payment landed and leads to the code box', async ({ page }) => {
  await page.goto('/?pro=thanks');
  const paid = page.getByRole('dialog', { name: 'Payment received — thank you!' });
  await expect(paid).toBeVisible();
  await expect(paid).toContainText('on its way to the email you paid with');
  await expect(page).toHaveURL(/\/$/); // the parameter is read once and dropped

  await paid.getByRole('button', { name: 'I have a code' }).click();
  await expect(page.getByRole('dialog', { name: 'Unlock Levelix Pro' })).toBeVisible();
});

test('back from Stripe signed in: the thank-you turns into "Pro is on" the moment the account becomes Pro', async ({ page }) => {
  await page.goto('/?pro=thanks');
  const paid = page.getByRole('dialog', { name: 'Payment received — thank you!' });
  await expect(paid).toContainText('Pro turns on by itself in a few seconds');
  // The webhook's write reaches the app as a plan change (the same module the app uses, via the import map).
  await page.evaluate(async () => (await import('./js/plan.js')).setPlan('pro'));
  await expect(paid).toContainText('Levelix Pro is on');
  await expect(paid.getByText('Got a code?')).toBeHidden();
});

test('Home: each Pro plan leads to its own Stripe checkout', async ({ page }) => {
  await page.goto('/');
  await page.locator('.brand').click();
  const plans = activePanel(page).locator('.home-plan');
  await expect(plans.nth(1).getByRole('link', { name: 'Go Pro' })).toHaveAttribute('href', 'https://buy.stripe.com/6oUbJ17Qk0IZbERfmS6Zy01'); // monthly
  await expect(plans.nth(2).getByRole('link', { name: 'Go Pro' })).toHaveAttribute('href', 'https://buy.stripe.com/9B628r2w0gHX6kx5Mi6Zy00'); // yearly
  await expect(activePanel(page).getByRole('button', { name: 'Coming soon' })).toHaveCount(0);
});

test('Home: "Already paid?" opens the code box without hunting through the account menu', async ({ page }) => {
  await page.goto('/');
  await page.locator('.brand').click();
  const paid = activePanel(page).locator('.home-pricing__paid');
  await paid.scrollIntoViewIfNeeded();
  await expect(paid).toContainText('Already paid?');
  await paid.getByRole('button', { name: 'I have a code' }).click();
  await expect(page.getByRole('dialog', { name: 'Unlock Levelix Pro' })).toBeVisible();
});

test('Home links to Support, Privacy and Terms, and each page names the seller and leads to the others', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.locator('.brand').click();
  const footer = activePanel(page).locator('.home-footer');
  await expect(footer.getByRole('link')).toHaveText(['Support', 'Privacy', 'Terms']);

  for (const [link, heading] of [['Support', 'Support'], ['Privacy', 'Privacy policy'], ['Terms', 'Terms of service']]) {
    await page.goto('/');
    await page.locator('.brand').click();
    await activePanel(page).locator('.home-footer').getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.locator('.legal')).toContainText('Riga Feraiou 44, 56625 Thessaloniki, Greece');
    await expect(page.locator('.legal')).toContainText('info@levelix.eu');
    await expect(page.locator('.legal')).toContainText('ΑΦΜ) 150496621'); // the seller's tax ID, as the law asks
    await expect(page.locator('.legal__footer a[aria-current="page"]')).toHaveText(link);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(page.locator('.legal')).toContainText('Full refund within 14 days'); // the guarantee is said up front
  expect(errors).toEqual([]);
});

test('the sign-in chooser → Continue with Google opens the not-connected modal when firebaseConfig is null', async ({ page }) => {
  await page.goto('/');
  await page.locator('#account button').click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toContainText('Sign-in is not connected yet');
  await expect(dialog.locator('a[href="https://github.com/a-papadopoulos90i/escape-the-matrix/blob/main/SETUP.md"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('every field types at 16px, so tapping one never zooms the page in', async ({ page }) => {
    await page.goto('/');
    await page.locator('#stepper .step').nth(1).click(); // Write down: the add field and the rows
    await page.locator('.dump__input').fill('A task to type into');
    await page.keyboard.press('Enter');

    const smallest = await page.evaluate(() => {
      const fields = [...document.querySelectorAll('input, textarea, select')].filter((el) => !['checkbox', 'radio'].includes(el.type));
      return Math.min(...fields.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    });
    expect(smallest).toBeGreaterThanOrEqual(16); // iOS zooms in below this and stays zoomed
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test('mobile viewport: no horizontal scroll and the shell stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('#stepper .step').nth(2).click();
  await expect(activeTitle(page)).toHaveText(TITLES[3]);
  await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
  const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowAfter).toBeLessThanOrEqual(0);
});
