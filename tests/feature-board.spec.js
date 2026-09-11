import { test, expect } from 'playwright/test';
import path from 'node:path';

// Stages 4 & 5 — board, quadrant menus, fast-organize popover and the timer (SPEC §2, §8 items 6–11).
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const DAY = '2026-03-11';
const SHOTS = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'board-screenshots');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const formatShort = (d) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const nextWeekday = (from, weekday) => {
  let d = shiftDays(from, 7);
  while (d.getDay() !== weekday) d = shiftDays(d, 1);
  return d;
};

const task = (id, title, quadrant, extra = {}) => ({
  id, title, date: DAY, quadrant, order: Number(id.slice(2)), done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null, ...extra,
});
const SORTED = () => [
  task('t_1', 'Marketing Order A5', 'do'),
  task('t_2', 'Invoice Send', 'delegate'),
  task('t_3', 'Make - Excel Report', 'plan'),
];

function seed(page, { tasks, stage = 4, date = DAY, settings = {} }) {
  const doc = {
    version: 1,
    updatedAt: '2026-03-11T08:00:00.000Z',
    settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: true, 2: true, 3: true, 4: true, 5: true }, ...settings },
    tasks,
  };
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (sessionStorage.getItem('seeded')) return; // init scripts re-run on reload: seed once per tab
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(uiKey, JSON.stringify(ui));
      localStorage.setItem(docKey, JSON.stringify(doc));
    },
    { uiKey: UI_KEY, docKey: DOC_KEY, ui: { selectedDate: date, stage, calendarMonth: date.slice(0, 7) }, doc },
  );
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const panel = (page) => page.locator('#stage .panel:not(.panel--ghost)');
const quadrant = (page, q) => panel(page).locator(`.quadrant--${q}`);
const card = (page, title) => panel(page).locator('.task-card', { hasText: title });
const popover = (page) => page.locator('.popover--task');
const bar = (page) => page.locator('.timer-bar');
const readDoc = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DOC_KEY);
/** Saves are debounced (~150 ms): wait until the persisted doc satisfies `predicate`. */
const waitForSaved = (page, predicate) => expect.poll(async () => predicate(await readDoc(page))).toBe(true);
const taskById = (doc, id) => doc.tasks.find((t) => t.id === id);

async function openPopover(page, title) {
  await card(page, title).locator('.task-card__title').click();
  await expect(popover(page)).toBeVisible();
}

test('stage 4 shows the labelled quadrants, cards with checkbox + clock, and the unplaced strip', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: [...SORTED(), task('t_4', 'Loose end', null)] });
  await page.goto('/');
  await expect(panel(page).locator('.stage-title')).toHaveText('Ready to start');
  await expect(panel(page).locator('.quadrant__label')).toHaveText(['DO immediately', 'PLAN and prioritize', 'DELEGATE for completion', 'DELETE these tasks']);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5']);
  await expect(quadrant(page, 'plan').locator('.task-card')).toHaveText(['Make - Excel Report']);
  await expect(quadrant(page, 'delegate').locator('.task-card')).toHaveText(['Invoice Send']);
  await expect(quadrant(page, 'delete').locator('.task-card')).toHaveCount(0);
  const first = card(page, 'Marketing Order A5');
  await expect(first.locator('.task-card__check')).not.toBeChecked();
  await expect(first.locator('.task-card__clock--idle svg')).toBeVisible();
  await expect(panel(page).locator('.quadrant__more')).toHaveCount(4);

  const strip = panel(page).locator('.board__unplaced');
  await expect(strip).toHaveText('1 task not placed yet — Place them');
  await strip.locator('button').click();
  await expect(panel(page).locator('.stage-title')).toHaveText('Place them by priority:');
  expect(errors).toEqual([]);
});

test('ticking a task strikes it through, sinks it to the bottom, persists and updates the day bar', async ({ page }) => {
  await seed(page, { tasks: [...SORTED(), task('t_5', 'Call supplier', 'do')] });
  await page.goto('/');
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5', 'Call supplier']);
  await card(page, 'Marketing Order A5').locator('.task-card__check').check();
  const done = card(page, 'Marketing Order A5');
  await expect(done).toHaveClass(/task-card--done/);
  await expect(done.locator('.task-card__title')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Call supplier', 'Marketing Order A5']);
  await expect(page.locator('.daybar__progress')).toContainText('1/4 done');

  await waitForSaved(page, (doc) => taskById(doc, 't_1').done);
  await page.reload();
  await expect(card(page, 'Marketing Order A5').locator('.task-card__check')).toBeChecked();
  await card(page, 'Marketing Order A5').locator('.task-card__check').uncheck();
  await expect(card(page, 'Marketing Order A5')).not.toHaveClass(/task-card--done/);
  await expect(page.locator('.daybar__progress')).toContainText('0/4 done');
});

test('"…" menu: add here, mark all done, clear done with undo, delete all only in the gray quadrant', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: SORTED() });
  await page.goto('/');

  // Only the gray quadrant offers "Delete all tasks here".
  await quadrant(page, 'do').locator('.quadrant__more').click();
  await expect(page.locator('[role="menuitem"]')).toHaveText(['+ Add task here', 'Mark all done', 'Move unfinished to next day', 'Clear done tasks']);
  await page.keyboard.press('Escape');
  await quadrant(page, 'delete').locator('.quadrant__more').click();
  await expect(page.locator('[role="menuitem"]').last()).toHaveText('Delete all tasks here');

  // Add task here → inline row; Enter commits and keeps a fresh row; Escape closes it.
  await page.locator('[role="menuitem"]', { hasText: 'Add task here' }).click();
  const input = quadrant(page, 'delete').locator('.task-card__input');
  await expect(input).toBeFocused();
  await input.fill('Sort old emails');
  await input.press('Enter');
  await expect(quadrant(page, 'delete').locator('.task-card:not(.task-card--new)')).toHaveText(['Sort old emails']);
  await expect(quadrant(page, 'delete').locator('.task-card__input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(quadrant(page, 'delete').locator('.task-card__input')).toHaveCount(0);

  // Mark all done, then clear done tasks (undoable).
  await quadrant(page, 'delegate').locator('.quadrant__more').click();
  await page.locator('[role="menuitem"]', { hasText: 'Mark all done' }).click();
  await expect(card(page, 'Invoice Send')).toHaveClass(/task-card--done/);
  await quadrant(page, 'delegate').locator('.quadrant__more').click();
  await page.locator('[role="menuitem"]', { hasText: 'Clear done tasks' }).click();
  await expect(card(page, 'Invoice Send')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Task deleted');
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(card(page, 'Invoice Send')).toHaveClass(/task-card--done/);

  // Delete all tasks here (gray) asks for confirmation.
  await quadrant(page, 'delete').locator('.quadrant__more').click();
  await page.locator('[role="menuitem"]', { hasText: 'Delete all tasks here' }).click();
  const dialog = page.locator('[role="dialog"].modal');
  await expect(dialog).toContainText('Delete all tasks in this quadrant?');
  await dialog.locator('button', { hasText: 'Cancel' }).click();
  await expect(card(page, 'Sort old emails')).toHaveCount(1);
  await quadrant(page, 'delete').locator('.quadrant__more').click();
  await page.locator('[role="menuitem"]', { hasText: 'Delete all tasks here' }).click();
  await dialog.locator('button', { hasText: 'Delete' }).click();
  await expect(card(page, 'Sort old emails')).toHaveCount(0);
  await expect.poll(async () => (await readDoc(page)).tasks.map((t) => t.title).sort()).toEqual(['Invoice Send', 'Make - Excel Report', 'Marketing Order A5']);
  expect(errors).toEqual([]);
});

test('"Move unfinished to next day" moves only open tasks and can be undone', async ({ page }) => {
  await seed(page, { tasks: [...SORTED(), task('t_6', 'Already done', 'do', { done: true })] });
  await page.goto('/');
  await quadrant(page, 'do').locator('.quadrant__more').click();
  await page.locator('[role="menuitem"]', { hasText: 'Move unfinished to next day' }).click();
  await expect(page.locator('.toast')).toContainText('Moved to Thu 12 Mar');
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Already done']);
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5', 'Already done']);
});

test('popover opens from the title with the three actions, edit, move to and delete', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: SORTED(), stage: 5 });
  await page.goto('/');
  await expect(panel(page).locator('.stage-title')).toHaveText('fast organize');

  await openPopover(page, 'Marketing Order A5');
  await expect(popover(page).locator('.task-popover__title')).toHaveText('Marketing Order A5');
  await expect(popover(page).locator('.action-btn')).toHaveCount(3);
  await expect(popover(page).locator('.action-btn--play')).toHaveAttribute('aria-label', 'Start the timer or the countdown');
  await expect(popover(page).locator('.action-btn--calendar')).toHaveAttribute('aria-label', 'Postpone to another day');
  await expect(popover(page).locator('.action-btn--forward')).toHaveAttribute('aria-label', "Send to the next day's list");
  await expect(popover(page).locator('.task-popover__link')).toHaveText(['Edit', 'Move to ▾', 'Delete']);
  await expect(popover(page).locator('.action-btn--play')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await expect(card(page, 'Marketing Order A5').locator('.task-card__title')).toBeFocused();

  await openPopover(page, 'Marketing Order A5');
  await panel(page).locator('.stage-title').click();
  await expect(popover(page)).toHaveCount(0);

  // Edit
  await openPopover(page, 'Marketing Order A5');
  await popover(page).locator('.task-popover__link', { hasText: 'Edit' }).click();
  const input = popover(page).locator('input[type="text"]');
  await expect(input).toBeFocused();
  await input.fill('Marketing Order A6');
  await input.press('Enter');
  await expect(popover(page)).toHaveCount(0);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A6']);

  // Move to ▾
  await openPopover(page, 'Marketing Order A6');
  await popover(page).locator('.task-popover__link', { hasText: 'Move to' }).click();
  await expect(page.locator('[role="menuitem"]')).toHaveText(['PLAN and prioritize', 'DELEGATE for completion', 'DELETE these tasks']);
  await page.locator('[role="menuitem"]', { hasText: 'PLAN and prioritize' }).click();
  await expect(quadrant(page, 'plan').locator('.task-card')).toHaveText(['Make - Excel Report', 'Marketing Order A6']);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveCount(0);

  // Delete (confirm) with undo
  await openPopover(page, 'Marketing Order A6');
  await popover(page).locator('.task-popover__link', { hasText: 'Delete' }).click();
  await expect(page.locator('[role="dialog"].modal')).toContainText('Delete this task?');
  await page.locator('[role="dialog"].modal button', { hasText: 'Delete' }).click();
  await expect(card(page, 'Marketing Order A6')).toHaveCount(0);
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(card(page, 'Marketing Order A6')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('▶ starts a countdown: clock live, bar visible, survives reload, pause/resume/stop', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: SORTED(), stage: 5 });
  await page.goto('/');
  await expect(bar(page)).toBeHidden();

  await openPopover(page, 'Marketing Order A5');
  await popover(page).locator('.action-btn--play').click();
  await expect(popover(page).locator('.timer-picker__stopwatch')).toHaveText('Stopwatch');
  await expect(popover(page).locator('.timer-picker__preset')).toHaveText(['5', '15', '25', '45', '60']);
  await expect(popover(page).locator('.timer-picker__custom')).toBeVisible();
  await popover(page).locator('.timer-picker__preset', { hasText: /^5$/ }).click();
  await expect(popover(page)).toHaveCount(0);

  const clock = card(page, 'Marketing Order A5').locator('.task-card__clock');
  await expect(clock).toHaveClass(/task-card__clock--running/);
  await expect(clock).toHaveText(/^0[45]:\d\d$/);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.timer-bar__title')).toHaveText('Marketing Order A5');
  await expect(bar(page).locator('.timer-bar__time')).toHaveText(/^0[45]:\d\d$/);
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Pause');
  const before = await bar(page).locator('.timer-bar__time').textContent();
  await page.waitForTimeout(1600);
  const after = await bar(page).locator('.timer-bar__time').textContent();
  expect(after < before).toBe(true);

  // Persisted: still running after a reload (and while on another stage).
  await page.reload();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Pause');
  await expect(card(page, 'Marketing Order A5').locator('.task-card__clock')).toHaveClass(/task-card__clock--running/);
  await page.locator('#stepper .step').nth(0).click();
  await expect(bar(page)).toBeVisible();
  await page.locator('#stepper .step').nth(4).click();

  await bar(page).locator('.timer-bar__pause').click();
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Resume');
  await expect(card(page, 'Marketing Order A5').locator('.task-card__clock')).toHaveClass(/task-card__clock--paused/);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').timer.running === false);
  await page.reload();
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Resume');
  await bar(page).locator('.timer-bar__pause').click();
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Pause');

  await bar(page).locator('.timer-bar__stop').click();
  await expect(bar(page)).toBeHidden();
  await expect(card(page, 'Marketing Order A5').locator('.task-card__clock')).toHaveClass(/task-card__clock--done/);
  await expect(card(page, 'Marketing Order A5').locator('.task-card__clock')).toHaveText(/^00:0\d$/);
  expect(errors).toEqual([]);
});

test('starting a second timer asks to stop the first; Done ✓ ticks the task', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 5 });
  await page.goto('/');
  await openPopover(page, 'Marketing Order A5');
  await popover(page).locator('.action-btn--play').click();
  await popover(page).locator('.timer-picker__stopwatch').click();
  await expect(bar(page).locator('.timer-bar__title')).toHaveText('Marketing Order A5');

  await openPopover(page, 'Invoice Send');
  await popover(page).locator('.action-btn--play').click();
  await popover(page).locator('.timer-picker__preset', { hasText: '15' }).click();
  const dialog = page.locator('[role="dialog"].modal');
  await expect(dialog).toContainText('Stop the current timer and start a new one?');
  await dialog.locator('button', { hasText: 'Confirm' }).click();
  await expect(bar(page).locator('.timer-bar__title')).toHaveText('Invoice Send');
  await expect(card(page, 'Marketing Order A5').locator('.task-card__clock')).toHaveClass(/task-card__clock--done/);

  await bar(page).locator('.timer-bar__done').click();
  await expect(bar(page)).toBeHidden();
  await expect(card(page, 'Invoice Send')).toHaveClass(/task-card--done/);
});

test('a countdown reaching 0 flashes the bar and shows "Time\'s up!"', async ({ page }) => {
  const errors = collectErrors(page);
  const timer = { mode: 'countdown', durationSec: 3, startedAt: new Date(Date.now() - 1000).toISOString(), elapsedSec: 0, running: true, stoppedAt: null };
  await seed(page, { tasks: [task('t_1', 'Marketing Order A5', 'do', { timer })], stage: 4 });
  await page.goto('/');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveClass(/timer-bar--finished/, { timeout: 6000 });
  await expect(bar(page)).toHaveClass(/timer-bar--flash/);
  await expect(bar(page).locator('.timer-bar__status')).toHaveText("Time's up!");
  await expect(bar(page).locator('.timer-bar__time')).toHaveText('00:00');
  await expect(card(page, 'Marketing Order A5').locator('.task-card__clock')).toHaveClass(/task-card__clock--finished/);
  await bar(page).locator('.timer-bar__done').click();
  await expect(card(page, 'Marketing Order A5')).toHaveClass(/task-card--done/);
  await expect(bar(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('📅 postpones to the chosen date (min today) with Undo', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 5 });
  await page.goto('/');
  const target = shiftDays(new Date(), 3);
  await openPopover(page, 'Make - Excel Report');
  await popover(page).locator('.action-btn--calendar').click();
  const input = popover(page).locator('input[type="date"]');
  await expect(input).toHaveAttribute('min', toKey(new Date()));
  await input.fill(toKey(target));
  await popover(page).locator('button[type="submit"]').click();
  await expect(popover(page)).toHaveCount(0);
  await expect(card(page, 'Make - Excel Report')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText(`Moved to ${formatShort(target)}`);
  await waitForSaved(page, (doc) => taskById(doc, 't_3').date === toKey(target));
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(card(page, 'Make - Excel Report')).toHaveCount(1);
});

const fridayTasks = (friday) => [
  { ...task('t_1', 'Marketing Order A5', 'do'), date: toKey(friday) },
  { ...task('t_2', 'Invoice Send', 'delegate'), date: toKey(friday) },
];

test('⏩ sends Friday tasks to Monday when weekends are hidden, with Undo', async ({ page }) => {
  const friday = nextWeekday(new Date(), 5);
  const monday = shiftDays(friday, 3);
  await seed(page, { tasks: fridayTasks(friday), stage: 5, date: toKey(friday) });
  await page.goto('/');
  await openPopover(page, 'Marketing Order A5');
  await popover(page).locator('.action-btn--forward').click();
  await expect(card(page, 'Marketing Order A5')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText(`Moved to ${formatShort(monday)}`);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').date === toKey(monday));
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(card(page, 'Marketing Order A5')).toHaveCount(1);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').date === toKey(friday));
});

test('⏩ sends Friday tasks to Saturday when weekends are shown', async ({ page }) => {
  const friday = nextWeekday(new Date(), 5);
  const saturday = shiftDays(friday, 1);
  await seed(page, { tasks: fridayTasks(friday), stage: 5, date: toKey(friday), settings: { showWeekends: true } });
  await page.goto('/');
  await openPopover(page, 'Invoice Send');
  await popover(page).locator('.action-btn--forward').click();
  await expect(card(page, 'Invoice Send')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText(`Moved to ${formatShort(saturday)}`);
});

test('tips: "Done mark ✅" on stage 4 and the dark list on stage 5; ? re-opens them', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 3, settings: { tipsSeen: { 1: true, 2: true, 3: true, 4: false, 5: false } } });
  await page.goto('/');
  await page.locator('#stepper .step').nth(3).click();
  const bubble = page.locator('.bubble');
  await expect(bubble).toHaveText(/Done mark ✅/);
  await expect(bubble).toHaveClass(/bubble--green/);
  await bubble.locator('.bubble__close').click();
  await expect(bubble).toHaveCount(0);
  await page.locator('#tip-button').click();
  await expect(bubble).toHaveText(/Done mark ✅/);

  await page.locator('#stepper .step').nth(4).click();
  await expect(bubble).toContainText('Organize them by priority:');
  await expect(bubble.locator('li')).toHaveText(['start the timer or the clock down', 'postpone for another day', "send it to the next day's list"]);
  await expect(bubble).toHaveClass(/bubble--dark/);
});

test('mobile: no horizontal scroll with the popover and the timer bar open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await seed(page, { tasks: SORTED(), stage: 5 });
  await page.goto('/');
  await openPopover(page, 'Marketing Order A5');
  await popover(page).locator('.action-btn--play').click();
  await popover(page).locator('.timer-picker__preset', { hasText: '25' }).click();
  await expect(bar(page)).toBeVisible();
  await openPopover(page, 'Invoice Send');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await popover(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: path.join(SHOTS, 'mobile-stage5-popover-bar.png'), fullPage: true, animations: 'disabled' });
});

for (const [label, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 375, height: 760 } })) {
  test(`screenshots (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, { tasks: SORTED(), stage: 4, settings: { tipsSeen: { 1: true, 2: true, 3: true, 4: false, 5: false } } });
    await page.goto('/');
    await expect(page.locator('.bubble')).toHaveText(/Done mark/);
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage4.png`), fullPage: true, animations: 'disabled' });
    await page.locator('#stepper .step').nth(4).click();
    await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
    await expect(page.locator('.bubble')).toContainText('Organize them by priority:');
    await openPopover(page, 'Marketing Order A5');
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage5-popover.png`), fullPage: true, animations: 'disabled' });
    await popover(page).locator('.action-btn--play').click();
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage5-picker.png`), fullPage: true, animations: 'disabled' });
    await popover(page).locator('.timer-picker__preset', { hasText: '25' }).click();
    await expect(bar(page)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage5-timer.png`), fullPage: true, animations: 'disabled' });
  });
}
