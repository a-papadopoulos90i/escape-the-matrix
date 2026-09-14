import { test, expect } from './fixtures.js';
import path from 'node:path';

// Stage 2 (brain dump) and Stage 3 (place by priority) — behaviour, persistence, every placement
// path (mouse drag, touch drag, tap-to-place, keyboard, menu) and design screenshots.
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const DATE = '2026-03-11';
const OUT = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'screenshots');

const TITLES = ['Marketing Order A5', 'Invoice Send', 'Make - Excel Report', 'Call the bank'];

const panel = (page) => page.locator('#stage .panel:not(.panel--ghost)');

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

test.describe('mobile', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 740 } });

  test('375px: the dump and the board both fit without horizontal scroll', async ({ page }) => {
    await seed(page, { stage: 2, tasks: TITLES.slice(0, 3) });
    await page.goto('/');
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await expect(panel(page).locator('.dump-row')).toHaveCount(3);

    await page.locator('#stepper .step').nth(2).click(); // Prioritize (the board)
    await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
    await expect(panel(page).locator('.quadrant')).toHaveCount(4);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
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
    await expect(panel(page).locator('.quadrant').first()).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `${label}-stage3.png`), fullPage: true });
  });
}

test('Write down rows carry the waiting list\'s priority controls: glyphs tag, the priority icon files a tagged task', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { stage: 2, tasks: TITLES.slice(0, 2) });
  await page.goto('/');
  const rows = panel(page).locator('.dump-row');
  const stored = async (id) => (await storedTasks(page)).find((task) => task.id === id);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.waiting-place')).toHaveCount(4);
  await expect(rows.nth(0).locator('.task-card__priority')).toHaveClass(/task-card__priority--none/);

  // A glyph tags the task; it stays on the list.
  await rows.nth(0).hover();
  await rows.nth(0).locator('.waiting-place--plan').click();
  await expect(rows.nth(0).locator('.task-card__priority')).toHaveClass(/priority-icon--plan/);
  await expect(rows.nth(0).locator('.waiting-place--plan')).toHaveClass(/is-active/);
  await expect(rows).toHaveCount(2);
  await expect.poll(async () => (await stored('t_0')).tag).toBe('plan');

  // An untagged row's icon opens the priority menu.
  await rows.nth(1).locator('.task-card__priority').click();
  await page.getByRole('menuitem', { name: 'Urgent / Important', exact: true }).click();
  await expect(rows.nth(1).locator('.task-card__priority')).toHaveClass(/priority-icon--do/);

  // A tagged row's icon activates the tag: the task goes into that quadrant for the open day.
  await rows.nth(0).locator('.task-card__priority').click();
  await expect(rows).toHaveCount(1);
  await expect.poll(async () => { const task = await stored('t_0'); return `${task.quadrant}/${task.tag}/${task.date}`; }).toBe(`plan/plan/${DATE}`);
  expect(errors).toEqual([]);
});
