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

/** The clock on a card opens the popover straight on the timer picker. */
async function openTimer(page, title) {
  await card(page, title).locator('.task-card__clock').click();
  await expect(popover(page).locator('.timer-picker__stopwatch')).toBeVisible();
}

/** The ⏩ on a card opens the schedule picker (Next day + a calendar to postpone). */
async function openSchedule(page, title) {
  await card(page, title).locator('.task-card__forward').click();
  await expect(popover(page).locator('.schedule-picker__nextday')).toBeVisible();
}

test('stage 4 shows the labelled quadrants, cards with checkbox + clock, and the waiting list', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: [...SORTED(), task('t_4', 'Loose end', null)] });
  await page.goto('/');
  await expect(panel(page).locator('.stage-title')).toHaveText('Ready to start');
  await expect(panel(page).locator('.quadrant__label')).toHaveText(['Do now', 'Schedule', 'Delegate', 'Drop']);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5']);
  await expect(quadrant(page, 'plan').locator('.task-card')).toHaveText(['Make - Excel Report']);
  await expect(quadrant(page, 'delegate').locator('.task-card')).toHaveText(['Invoice Send']);
  await expect(quadrant(page, 'delete').locator('.task-card')).toHaveCount(0);
  const first = card(page, 'Marketing Order A5');
  await expect(first.locator('.task-card__check')).not.toBeChecked();
  await expect(first.locator('.task-card__clock--idle svg')).toBeVisible();
  await expect(panel(page).locator('.quadrant__add')).toHaveCount(4);
  await expect(panel(page).locator('.quadrant__more')).toHaveCount(0);

  const waiting = panel(page).locator('.waiting');
  await expect(waiting.locator('.waiting__label')).toHaveText('Waiting list (1)');
  await expect(waiting.locator('.waiting-card')).toHaveText(/Loose end/);
  await expect(waiting.locator('.waiting-place')).toHaveCount(4); // one glyph per quadrant, no dropdown
  await waiting.locator('.waiting-place--do').click(); // file it into Do now directly
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5', 'Loose end']);
  await expect(panel(page).locator('.waiting')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a waiting task has its own checkbox: it completes in place and counts as done', async ({ page }) => {
  await seed(page, { tasks: [...SORTED(), task('t_9', 'Water the plants', null)] });
  await page.goto('/');
  const wcard = panel(page).locator('.waiting-card', { hasText: 'Water the plants' });
  await expect(wcard.locator('.task-card__check')).toHaveCount(1);
  await wcard.locator('.task-card__check').check();
  await expect(wcard).toHaveClass(/task-card--done/);
  await waitForSaved(page, (doc) => taskById(doc, 't_9').done === true && taskById(doc, 't_9').quadrant === null);
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

  await waitForSaved(page, (doc) => taskById(doc, 't_1').done);
  await page.reload();
  await expect(card(page, 'Marketing Order A5').locator('.task-card__check')).toBeChecked();
  await card(page, 'Marketing Order A5').locator('.task-card__check').uncheck();
  await expect(card(page, 'Marketing Order A5')).not.toHaveClass(/task-card--done/);
});

test('the footer + adds a task straight into the quadrant (no more "…" menu)', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: SORTED() });
  await page.goto('/');

  // Each quadrant has a single "+" and no "…" menu.
  await expect(panel(page).locator('.quadrant__add')).toHaveCount(4);
  await expect(panel(page).locator('.quadrant__more')).toHaveCount(0);

  // + opens an inline row; Enter commits and keeps a fresh row; Escape closes it.
  await quadrant(page, 'delete').locator('.quadrant__add').click();
  const input = quadrant(page, 'delete').locator('.task-card__input');
  await expect(input).toBeFocused();
  await input.fill('Sort old emails');
  await input.press('Enter');
  await expect(quadrant(page, 'delete').locator('.task-card:not(.task-card--new)')).toHaveText(['Sort old emails']);
  await expect(quadrant(page, 'delete').locator('.task-card__input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(quadrant(page, 'delete').locator('.task-card__input')).toHaveCount(0);
  await expect
    .poll(async () => (await readDoc(page)).tasks.filter((t) => !t.deleted).map((t) => t.title).sort())
    .toEqual(['Invoice Send', 'Make - Excel Report', 'Marketing Order A5', 'Sort old emails']);
  expect(errors).toEqual([]);
});

const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('the card title opens rename in place; the ⏩ opens the schedule picker', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  await expect(panel(page).locator('.stage-title')).toHaveText('Ready to start');

  // Title → rename input directly (no action row).
  await card(page, 'Marketing Order A5').locator('.task-card__title').click();
  const input = popover(page).locator('input[type="text"]');
  await expect(input).toBeFocused();
  await expect(popover(page).locator('.action-btn')).toHaveCount(0);
  await input.fill('Marketing Order A6');
  await input.press('Enter');
  await expect(popover(page)).toHaveCount(0);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A6']);

  // ⏩ on the card → schedule picker: "Next day" on top, a calendar to postpone below.
  await openSchedule(page, 'Marketing Order A6');
  await expect(popover(page).locator('.schedule-picker__nextday')).toBeFocused();
  await expect(popover(page).locator('.schedule-picker__date')).toBeVisible();
  await expect(popover(page).locator('.schedule-picker__date')).toHaveAttribute('min', toKey(new Date()));
  expect(errors).toEqual([]);
});

test('a card drags into another quadrant; the red ✕ deletes it with undo', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');

  // Drag "Marketing Order A5" from DO into PLAN (press on the title, move past the threshold, drop).
  const from = await centre(card(page, 'Marketing Order A5').locator('.task-card__title'));
  const to = await centre(quadrant(page, 'plan'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(quadrant(page, 'plan')).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect(quadrant(page, 'plan').locator('.task-card')).toHaveText(['Make - Excel Report', 'Marketing Order A5']);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveCount(0);

  // A plain click on a title still opens the popover (drag did not swallow it).
  await openPopover(page, 'Invoice Send');
  await page.keyboard.press('Escape');

  // The red ✕ deletes at once, with an Undo toast.
  await card(page, 'Invoice Send').locator('.task-card__delete').click();
  await expect(card(page, 'Invoice Send')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Task deleted');
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(card(page, 'Invoice Send')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('▶ starts a countdown: clock live, bar visible, survives reload, pause/resume/stop', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  await expect(bar(page)).toBeHidden();

  await openTimer(page, 'Marketing Order A5');
  await expect(popover(page).locator('.timer-picker__stopwatch')).toHaveText('Count up');
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
  await page.locator('#stepper .step').nth(3).click();

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

test('starting a second timer asks to stop the first; Done ticks the task', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  await openTimer(page, 'Marketing Order A5');
  await popover(page).locator('.timer-picker__stopwatch').click();
  await expect(bar(page).locator('.timer-bar__title')).toHaveText('Marketing Order A5');

  await openTimer(page, 'Invoice Send');
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
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  const target = shiftDays(new Date(), 3);
  await openSchedule(page, 'Make - Excel Report');
  const input = popover(page).locator('.schedule-picker__date');
  await expect(input).toHaveAttribute('min', toKey(new Date()));
  await input.fill(toKey(target));
  await popover(page).locator('.schedule-picker button[type="submit"]').click();
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

test('⏩ sends a Friday task to Monday (skips the weekend) with Undo', async ({ page }) => {
  const friday = nextWeekday(new Date(), 5);
  const monday = shiftDays(friday, 3);
  await seed(page, { tasks: fridayTasks(friday), stage: 4, date: toKey(friday) });
  await page.goto('/');
  await openSchedule(page, 'Marketing Order A5');
  await popover(page).locator('.schedule-picker__nextday').click();
  await expect(card(page, 'Marketing Order A5')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText(`Moved to ${formatShort(monday)}`);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').date === toKey(monday));
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(card(page, 'Marketing Order A5')).toHaveCount(1);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').date === toKey(friday));
});

test('two "Undo" toasts each revert their own delete, in any order', async ({ page }) => {
  await seed(page, { tasks: [...SORTED(), task('t_5', 'Call supplier', 'do')], stage: 4 });
  await page.goto('/');
  const del = async (title) => {
    await card(page, title).locator('.task-card__delete').click(); // the red ✕ deletes at once
    await expect(card(page, title)).toHaveCount(0);
  };
  await del('Marketing Order A5');
  await del('Call supplier');
  const undos = page.locator('.toast__action', { hasText: 'Undo' });
  await expect(undos).toHaveCount(2);
  await undos.first().click(); // the older toast → the older delete
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5']);
  await undos.first().click();
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5', 'Call supplier']);
  await expect(undos).toHaveCount(0);
});

test('📅 postpones a task to any day, a weekend included, and it shows on the calendar', async ({ page }) => {
  const saturday = nextWeekday(new Date(), 6);
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  await openSchedule(page, 'Invoice Send');
  await popover(page).locator('.schedule-picker__date').fill(toKey(saturday));
  await popover(page).locator('.schedule-picker button[type="submit"]').click();
  await expect(card(page, 'Invoice Send')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText(`Moved to ${formatShort(saturday)}`);
  await waitForSaved(page, (doc) => taskById(doc, 't_2').date === toKey(saturday));
  await page.locator('#stepper .step').nth(0).click();
  await panel(page).locator('.calendar__today').click();
  await expect(panel(page).locator(`.calendar__day[data-key="${toKey(saturday)}"]`)).toHaveAttribute('title', '0 of 1 done');
});

test('the clock icon opens the timer picker directly; presets carry the "min" unit', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  const clock = card(page, 'Invoice Send').locator('.task-card__clock');
  expect(await clock.evaluate((el) => el.tagName)).toBe('BUTTON');
  await clock.click();
  await expect(popover(page)).toBeVisible();
  await expect(popover(page).locator('.timer-picker__preset')).toHaveText(['5', '15', '25', '45', '60']);
  await expect(popover(page).locator('.timer-picker__unit')).toHaveText('min');
  await popover(page).locator('.timer-picker__stopwatch').click();
  await expect(bar(page)).toBeVisible();
  await card(page, 'Invoice Send').locator('.task-card__clock').click();
  await expect(popover(page).locator('.timer-picker__stopwatch')).toBeVisible('the clock always opens the timer picker');
});

test('a countdown that ran out while the page was closed alarms once after the reload', async ({ page }) => {
  const errors = collectErrors(page);
  const timer = { mode: 'countdown', durationSec: 60, startedAt: new Date(Date.now() - 120_000).toISOString(), elapsedSec: 0, running: true, stoppedAt: null };
  await seed(page, { tasks: [task('t_1', 'Marketing Order A5', 'do', { timer })], stage: 4 });
  await page.goto('/');
  await expect(bar(page)).toHaveClass(/timer-bar--finished/);
  await expect(bar(page)).toHaveClass(/timer-bar--flash/);
  await expect(bar(page).locator('.timer-bar__status')).toHaveText("Time's up!");
  await waitForSaved(page, (doc) => typeof taskById(doc, 't_1').timer.alarmedAt === 'string');
  await page.reload();
  await expect(bar(page)).toHaveClass(/timer-bar--finished/);
  await page.waitForTimeout(1500);
  await expect(bar(page)).not.toHaveClass(/timer-bar--flash/, 'already acknowledged: no second alarm');
  expect(errors).toEqual([]);
});

test('a stage change starts at the top of the page and moves focus to the new stage title', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  const many = Array.from({ length: 8 }, (_, i) => task(`t_${i + 1}`, `Task ${i + 1}`, 'do'));
  await seed(page, { tasks: many, stage: 3, settings: { tipsSeen: { 1: true, 2: true, 3: true, 4: false } } });
  await page.goto('/');
  const next = panel(page).locator('.stage-nav__next');
  await next.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await next.click();
  await expect(panel(page).locator('.stage-title')).toHaveText('Ready to start');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(panel(page).locator('.stage-title')).toBeFocused();
  await expect(page.locator('.bubble')).toHaveCount(0); // tips were removed
});

test('keyboard: Tab stays inside the task popover, Escape closes it', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  await openSchedule(page, 'Marketing Order A5');
  await popover(page).locator('.schedule-picker button[type="submit"]').focus(); // the last control
  await page.keyboard.press('Tab');
  await expect(popover(page)).toBeVisible();
  expect(await page.evaluate(() => document.activeElement.closest('.popover--task') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
});

test('desktop: one long quadrant does not stretch the other three', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const many = Array.from({ length: 25 }, (_, i) => task(`t_${i + 10}`, `Task ${i + 1}`, 'do'));
  await seed(page, { tasks: [...many, task('t_2', 'Invoice Send', 'delegate'), task('t_3', 'Make - Excel Report', 'plan')], stage: 4 });
  await page.goto('/');
  const heights = {};
  for (const q of ['do', 'plan', 'delegate', 'delete']) heights[q] = (await quadrant(page, q).boundingBox()).height;
  expect(heights.do).toBeGreaterThan(900);
  expect(heights.plan).toBeLessThan(400);
  expect(heights.delegate).toBeLessThan(400);
  expect(heights.delete).toBeLessThan(400);
});

test('no speech-bubble tips and no "?" button on the board (tips were removed)', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 4, settings: { tipsSeen: { 1: false, 2: false, 3: false, 4: false } } });
  await page.goto('/');
  await expect(page.locator('.bubble')).toHaveCount(0);
  await expect(page.locator('#tip-button')).toHaveCount(0);
});

test('mobile: no horizontal scroll with the popover and the timer bar open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await seed(page, { tasks: SORTED(), stage: 4 });
  await page.goto('/');
  await openTimer(page, 'Marketing Order A5');
  await popover(page).locator('.timer-picker__preset', { hasText: '25' }).click();
  await expect(bar(page)).toBeVisible();
  await openPopover(page, 'Invoice Send');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await popover(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: path.join(SHOTS, 'mobile-stage4-popover-bar.png'), fullPage: true, animations: 'disabled' });
});

for (const [label, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 375, height: 760 } })) {
  test(`screenshots (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, { tasks: SORTED(), stage: 4 });
    await page.goto('/');
    await expect(panel(page).locator('.quadrant__label').first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage4.png`), fullPage: true, animations: 'disabled' });
    await openPopover(page, 'Marketing Order A5');
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage4-popover.png`), fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await openTimer(page, 'Marketing Order A5');
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage4-picker.png`), fullPage: true, animations: 'disabled' });
    await popover(page).locator('.timer-picker__preset', { hasText: '25' }).click();
    await expect(bar(page)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${label}-stage4-timer.png`), fullPage: true, animations: 'disabled' });
  });
}
