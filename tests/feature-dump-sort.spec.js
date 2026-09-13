import { test, expect } from 'playwright/test';
import path from 'node:path';

// Stage 2 (brain dump) and Stage 3 (place by priority) — behaviour, persistence, every placement
// path (mouse drag, touch drag, tap-to-place, keyboard, menu) and design screenshots.
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const DATE = '2026-03-11';
const OUT = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'screenshots');

const TITLES = ['Marketing Order A5', 'Invoice Send', 'Make - Excel Report', 'Call the bank'];

const panel = (page) => page.locator('#stage .panel:not(.panel--ghost)');
const pileCards = (page) => panel(page).locator('.sort__list .sort-card');
const quadrantCards = (page, q) => panel(page).locator(`.quadrant--${q} .task-card`); // stage-4 board cards
const cardByTitle = (page, title) => panel(page).locator('.sort-card', { hasText: title });
const priorityIcon = (page, title, q) => cardByTitle(page, title).locator(`.priority-icon--${q}`);

function doc(tasks, { tipsSeen = true } = {}) {
  return {
    version: 1,
    updatedAt: '2026-03-11T08:00:00.000Z',
    settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: tipsSeen, 2: tipsSeen, 3: tipsSeen, 4: tipsSeen, 5: tipsSeen } },
    tasks: tasks.map((title, i) => ({ id: `t_${i}`, title, date: DATE, quadrant: null, order: i + 1, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null })),
  };
}

function seed(page, { stage, tasks = [], tipsSeen = true }) {
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (sessionStorage.getItem('seeded')) return; // init scripts re-run on reload: seed once per tab
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(uiKey, JSON.stringify(ui));
      localStorage.setItem(docKey, JSON.stringify(doc));
    },
    { uiKey: UI_KEY, docKey: DOC_KEY, ui: { selectedDate: DATE, stage, calendarMonth: '2026-03' }, doc: doc(tasks, { tipsSeen }) },
  );
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function centre(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function mouseDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.move(to.x, to.y, { steps: 12 });
}

const storedTasks = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).tasks, DOC_KEY);
const inputValues = (locator) => locator.evaluateAll((inputs) => inputs.map((input) => input.value));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------- Stage 2 ----------

test('stage 2: add via the field, edit inline, delete with undo, and persist', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { stage: 2 });
  await page.goto('/');

  await expect(panel(page).locator('.stage-title')).toHaveText('Write it all down');
  await expect(panel(page).locator('.stage-subtitle')).toHaveText("Don't judge, don't sort. Just get everything out of your head.");
  const input = panel(page).locator('.dump__input');
  const next = panel(page).locator('.stage-nav__next');
  await expect(next).toBeDisabled();

  // Add three tasks: Enter submits, the field clears and keeps focus.
  for (const text of TITLES.slice(0, 3)) {
    await input.fill(text);
    await page.keyboard.press('Enter');
  }
  const rows = panel(page).locator('.dump-row');
  await expect(rows).toHaveCount(3);
  await expect.poll(() => inputValues(rows.locator('input'))).toEqual(TITLES.slice(0, 3));
  await expect(rows.locator('.dump-row__num')).toHaveText(['1', '2', '3']);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await expect(next).toBeEnabled();

  // The "Add" button also works.
  await input.fill(TITLES[3]);
  await panel(page).locator('.dump__add-btn').click();
  await expect(rows).toHaveCount(4);

  // Inline edit of an existing row.
  await rows.nth(1).locator('input').fill('Invoice Send (edited)');
  await rows.nth(1).locator('input').press('Enter');
  await expect.poll(async () => (await storedTasks(page)).map((task) => task.title)).toContain('Invoice Send (edited)');

  // ✕ deletes with an Undo toast.
  await rows.nth(0).hover();
  await rows.nth(0).locator('.dump-row__delete').click();
  await expect(rows).toHaveCount(3);
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(rows).toHaveCount(4);

  await page.reload();
  await expect(panel(page).locator('.dump-row')).toHaveCount(4);
  await expect(panel(page).locator('.stage-nav__next')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('stage 2: the list renumbers after a delete', async ({ page }) => {
  await seed(page, { stage: 2 });
  await page.goto('/');
  const input = panel(page).locator('.dump__input');
  for (const text of ['One', 'Two', 'Three']) {
    await input.fill(text);
    await page.keyboard.press('Enter');
  }
  const rows = panel(page).locator('.dump-row');
  await expect(rows.locator('.dump-row__num')).toHaveText(['1', '2', '3']);
  await rows.nth(0).hover();
  await rows.nth(0).locator('.dump-row__delete').click();
  await expect(rows.locator('.dump-row__num')).toHaveText(['1', '2']);
  await expect.poll(() => inputValues(rows.locator('input'))).toEqual(['Two', 'Three']);
});

// ---------- Stage 3 ----------

test.describe('stage 3 (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test('stage 3: tag each task with a priority, re-tag, untag, and the Next label', async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { stage: 3, tasks: TITLES });
    await page.goto('/');

    await expect(panel(page).locator('.sort__matrix .quadrant')).toHaveCount(4); // the four boxes preview the day
    await expect(pileCards(page)).toHaveCount(4);
    const next = panel(page).locator('.stage-nav__next');
    await expect(next).toHaveText('Next →');

    // Each priority icon tags the task; it stays in the list with the chosen icon ringed.
    const quadrants = ['do', 'plan', 'delegate', 'delete'];
    for (const [i, q] of quadrants.entries()) {
      await priorityIcon(page, TITLES[i], q).click();
      await expect(priorityIcon(page, TITLES[i], q)).toHaveClass(/is-active/);
      await expect(pileCards(page)).toHaveCount(4); // tagged tasks stay in the list
    }
    await expect(next).toHaveText('Next →'); // nothing left untagged

    // Re-tag: tapping a different icon moves the tag.
    await priorityIcon(page, TITLES[0], 'delete').click();
    await expect(priorityIcon(page, TITLES[0], 'do')).not.toHaveClass(/is-active/);
    await expect(priorityIcon(page, TITLES[0], 'delete')).toHaveClass(/is-active/);

    // Untag: tapping the active icon again returns the task to the backlog.
    await priorityIcon(page, TITLES[1], 'plan').click();
    await expect(priorityIcon(page, TITLES[1], 'plan')).not.toHaveClass(/is-active/);
    await expect(next).toHaveText('Next →');

    await expect
      .poll(async () => Object.fromEntries((await storedTasks(page)).map((task) => [task.title, task.tag])))
      .toEqual({ [TITLES[0]]: 'delete', [TITLES[1]]: null, [TITLES[2]]: 'delegate', [TITLES[3]]: 'delete' });
    // Tagging is a label only: nothing was placed on a day.
    await expect
      .poll(async () => (await storedTasks(page)).every((task) => task.quadrant === null))
      .toBe(true);

    // So Stage 4's boxes stay empty and the tasks are still on the waiting list.
    await page.locator('#stepper .step').nth(3).click();
    await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
    await expect(quadrantCards(page, 'delete')).toHaveCount(0);
    await expect(quadrantCards(page, 'delegate')).toHaveCount(0);
    await expect(panel(page).locator('.waiting-card')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('stage 3: keyboard (Enter on an icon tags it) and delete with undo', async ({ page }) => {
    await seed(page, { stage: 3, tasks: TITLES.slice(0, 2) });
    await page.goto('/');

    await priorityIcon(page, TITLES[0], 'do').focus();
    await page.keyboard.press('Enter');
    await expect(priorityIcon(page, TITLES[0], 'do')).toHaveClass(/is-active/);
    await expect(panel(page).locator('[aria-live="polite"]').last()).toHaveText('Tagged Urgent & Important');

    // The red ✕ deletes the task, with Undo.
    await cardByTitle(page, TITLES[1]).locator('.sort-card__delete').click();
    await expect(pileCards(page)).toHaveCount(1);
    await page.locator('.toast__action', { hasText: 'Undo' }).click();
    await expect(pileCards(page)).toHaveCount(2);
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1100 } });

  test('stage 3: tapping a priority icon tags the task (touch)', async ({ page }) => {
    await seed(page, { stage: 3, tasks: TITLES.slice(0, 1) });
    await page.goto('/');
    const icon = priorityIcon(page, TITLES[0], 'delegate');
    const { x, y } = await centre(icon);
    await page.touchscreen.tap(x, y);
    await expect(icon).toHaveClass(/is-active/);
    await expect.poll(async () => (await storedTasks(page))[0].tag).toBe('delegate');
  });
});

test.describe('mobile', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 740 } });

  test('375px: stages 2 and 3 have no horizontal scroll; tapping an icon tags a task', async ({ page }) => {
    await seed(page, { stage: 2, tasks: TITLES.slice(0, 3) });
    await page.goto('/');
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await expect(panel(page).locator('.dump-row')).toHaveCount(3);

    await page.locator('#stepper .step').nth(2).click();
    await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);

    await priorityIcon(page, TITLES[0], 'do').click();
    await expect(priorityIcon(page, TITLES[0], 'do')).toHaveClass(/is-active/);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('375px: a full list scrolls inside itself', async ({ page }) => {
    const many = Array.from({ length: 25 }, (_, i) => `Task number ${i + 1}`);
    await seed(page, { stage: 3, tasks: many });
    await page.goto('/');
    await expect(pileCards(page)).toHaveCount(25);
    const list = panel(page).locator('.sort__list');
    await list.scrollIntoViewIfNeeded();
    const before = await list.evaluate((el) => el.scrollTop);
    const from = await centre(pileCards(page).nth(3));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y - step * 30 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await expect(pileCards(page)).toHaveCount(25);
  });
});

// ---------- Screenshots ----------

for (const [label, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 375, height: 760 } })) {
  test(`screenshots (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, { stage: 2, tasks: TITLES.slice(0, 3), tipsSeen: false });
    await page.goto('/');
    await expect(panel(page).locator('.dump-row').first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `${label}-stage2.png`), fullPage: true });
    await page.locator('#stepper .step').nth(2).click();
    await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
    await expect(pileCards(page).first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `${label}-stage3.png`), fullPage: true });
    await priorityIcon(page, TITLES[0], 'do').click();
    await priorityIcon(page, TITLES[1], 'delegate').click();
    await page.screenshot({ path: path.join(OUT, `${label}-stage3-placed.png`), fullPage: true });
  });
}
