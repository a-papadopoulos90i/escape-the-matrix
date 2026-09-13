import { test, expect } from 'playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// SPEC §8 acceptance checklist as browser scenarios (items 1–15 and 17–19; 16 is a code review).
// Every test gets a fresh context. Date-dependent scenarios freeze "today" at 2026-03-11 with
// page.clock.setFixedTime (real timers keep running); the countdown scenario uses real time.
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const TODAY = '2026-03-11'; // a Wednesday
const FIXED_NOW = new Date(2026, 2, 11, 9, 0, 0);
const ROOT = path.resolve(process.cwd(), '..');

const TITLES = ['Marketing Order A5', 'Invoice Send', 'Make - Excel Report'];
const RGB = {
  red: 'rgb(209, 62, 56)',
  redFill: 'rgb(255, 230, 225)',
  yellow: 'rgb(225, 144, 31)',
  yellowFill: 'rgb(255, 239, 209)',
  blue: 'rgb(35, 130, 186)',
  blueFill: 'rgb(221, 242, 255)',
  gray: 'rgb(135, 127, 115)',
  grayFill: 'rgb(240, 238, 233)',
  green: 'rgb(31, 143, 87)',
  today: 'rgb(61, 139, 255)',
};

// ---------- Helpers ----------

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const panel = (page) => page.locator('#stage .panel:not(.panel--ghost)');
const stageTitle = (page) => panel(page).locator('.stage-title');
const step = (page, n) => page.locator('#stepper .step').nth(n - 1);
const cell = (page, key) => panel(page).locator(`.calendar__day[data-key="${key}"]`);
const quadrant = (page, q) => panel(page).locator(`.quadrant--${q}`);
const card = (page, title) => panel(page).locator('.task-card', { hasText: title });
const pileCards = (page) => panel(page).locator('.sort__list .sort-card');
const popover = (page) => page.locator('.popover--task');
const bubble = (page) => page.locator('.bubble');
const bar = (page) => page.locator('.timer-bar');

const task = (id, title, date, quadrant = null, extra = {}) => ({
  id, title, date, quadrant, order: Number(id.slice(2)), done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null, ...extra,
});
const sortedTasks = (date = TODAY) => [
  task('t_1', TITLES[0], date, 'do'),
  task('t_2', TITLES[1], date, 'delegate'),
  task('t_3', TITLES[2], date, 'plan'),
];
const unsortedTasks = (date = TODAY) => TITLES.map((title, i) => task(`t_${i + 1}`, title, date));

/** Seeds localStorage before the app boots (once per tab, so a reload keeps what the app saved). */
function seed(page, { tasks = [], stage = 1, date = TODAY, tipsSeen = true, settings = {} }) {
  const seen = { 1: tipsSeen, 2: tipsSeen, 3: tipsSeen, 4: tipsSeen };
  const doc = { version: 1, updatedAt: '2026-03-11T08:00:00.000Z', settings: { showWeekends: false, bannerDismissed: true, tipsSeen: seen, ...settings }, tasks };
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (sessionStorage.getItem('seeded')) return;
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

const readDoc = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DOC_KEY);
const taskById = (doc, id) => doc.tasks.find((item) => item.id === id);
/** Saves are debounced (~150 ms): wait until the persisted doc exists and satisfies `predicate`. */
const waitForSaved = (page, predicate) =>
  expect.poll(async () => {
    const doc = await readDoc(page);
    return doc !== null && predicate(doc);
  }).toBe(true);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const inputValues = (locator) => locator.evaluateAll((inputs) => inputs.map((input) => input.value));
/** Resolves once the slide/fade transition finished (no ghost panel left). */
const settled = (page) => expect(page.locator('#stage .panel--ghost')).toHaveCount(0);

async function goToStage(page, n) {
  await step(page, n).click();
  await settled(page);
}

/** Closes every open bubble (stage 4 shows two). */
async function closeTip(page) {
  while (await bubble(page).count()) await bubble(page).first().locator('.bubble__close').click();
  await expect(bubble(page)).toHaveCount(0);
}

/** Tap-to-place target: the quadrant's outer corner, clear of the pile in the matrix centre. */
async function tapQuadrant(page, q) {
  const target = quadrant(page, q);
  const box = await target.boundingBox();
  const x = q === 'do' || q === 'delegate' ? 24 : box.width - 24;
  const y = q === 'do' || q === 'plan' ? 24 : box.height - 24;
  await target.click({ position: { x, y } });
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

/** A touch drag starts with a short press (so a plain swipe still scrolls), then the finger moves. */
async function touchDrag(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await page.waitForTimeout(350);
  for (let i = 1; i <= 8; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function typeTasks(page, titles) {
  const input = panel(page).locator('.dump__input');
  for (const title of titles) {
    await input.fill(title);
    await page.keyboard.press('Enter');
  }
}

async function openPopover(page, title) {
  await card(page, title).locator('.task-card__title').click();
  await expect(popover(page)).toBeVisible();
}

/** The card ⏩ opens the schedule picker (Next day + a calendar to postpone). */
async function openSchedule(page, title) {
  await card(page, title).locator('.task-card__forward').click();
  await expect(popover(page).locator('.schedule-picker__nextday')).toBeVisible();
}

/** Ratio of a calendar cell's green fill to the cell height. */
const fillRatio = (locator) =>
  locator.evaluate((el) => el.querySelector('.calendar__fill').offsetHeight / el.clientHeight);

// ---------- Walkthrough (the whole loop, end to end) ----------

test('walkthrough: pick a day, dump, sort, work the board, organize, back to a green calendar', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');

  // Stage 1 → an empty day opens Stage 2.
  await expect(stageTitle(page)).toHaveText('Pick your day');
  await closeTip(page);
  await cell(page, '2026-03-12').click();
  await settled(page);
  await expect(stageTitle(page)).toHaveText('Write it all down');
  await closeTip(page);

  // Stage 2 → three tasks, then Next.
  await typeTasks(page, TITLES);
  await expect(panel(page).locator('.dump-row')).toHaveCount(3);
  await panel(page).locator('.stage-nav__next').click();
  await settled(page);

  // Stage 3 → place each task a different way.
  await expect(stageTitle(page)).toHaveText('Place them by priority:');
  await closeTip(page);
  await expect(pileCards(page)).toHaveCount(3);
  await expect(panel(page).locator('.stage-nav__next')).toHaveText('Next (3 waiting) →');
  await mouseDrag(page, await centre(pileCards(page).first()), await centre(quadrant(page, 'do')));
  await expect(quadrant(page, 'do')).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect(quadrant(page, 'do').locator('.sort-card')).toHaveText([TITLES[0]]);
  await pileCards(page).first().locator('.sort-card__grab').click();
  await tapQuadrant(page, 'delegate');
  await expect(quadrant(page, 'delegate').locator('.sort-card')).toHaveText([TITLES[1]]);
  await pileCards(page).first().locator('.sort-card__grab').focus();
  await page.keyboard.press('2');
  await expect(quadrant(page, 'plan').locator('.sort-card')).toHaveText([TITLES[2]]);
  await expect(panel(page).locator('.sort__done')).toHaveText('All placed ✓');
  await expect(panel(page).locator('.stage-nav__next')).toHaveText('Next →');
  await panel(page).locator('.stage-nav__next').click();
  await settled(page);

  // Stage 4 → tick one task.
  await expect(stageTitle(page)).toHaveText('Ready to start');
  await closeTip(page);
  await card(page, TITLES[2]).locator('.task-card__check').check();
  await expect(card(page, TITLES[2])).toHaveClass(/task-card--done/);

  // Still on stage 4 → send one task to the next day (the fast-organize popover), then back to the calendar.
  await openSchedule(page, TITLES[1]);
  await popover(page).locator('.schedule-picker__nextday').click();
  await expect(card(page, TITLES[1])).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Moved to Fri 13 Mar');
  await panel(page).locator('.stage-nav__next').click();
  await settled(page);

  await expect(stageTitle(page)).toHaveText('Pick your day');
  await expect(cell(page, '2026-03-12')).toHaveClass(/calendar__day--planned/);
  await expect(cell(page, '2026-03-12')).toHaveAttribute('title', '1 of 2 done');
  expect(await fillRatio(cell(page, '2026-03-12'))).toBeCloseTo(0.1, 1); // one done task → one stripe
  await expect(cell(page, '2026-03-13')).toHaveAttribute('title', '0 of 1 done');
  await expect(cell(page, TODAY)).toHaveClass(/calendar__day--today/);

  await page.reload();
  await expect(cell(page, '2026-03-12')).toHaveAttribute('title', '1 of 2 done');
  expect(errors).toEqual([]);
});

// ---------- 1–3: calendar ----------

test('1. fresh load shows Stage 1 with the current month, today outlined blue, weekends hidden', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await expect(step(page, 1)).toHaveAttribute('aria-current', 'step');
  await expect(stageTitle(page)).toHaveText('Pick your day');
  await expect(panel(page).locator('.calendar__month')).toHaveText('March 2026');
  await expect(panel(page).locator('.calendar__weekday')).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const days = panel(page).locator('.calendar__day');
  await expect(days).toHaveCount(30);
  await expect(days.first()).toHaveAttribute('data-key', '2026-03-02');
  await expect(days.last()).toHaveAttribute('data-key', '2026-04-10');
  const today = cell(page, TODAY);
  await expect(today).toHaveClass(/calendar__day--today/);
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today).toHaveCSS('border-top-color', RGB.today);
  await expect(today).toHaveCSS('border-top-width', '2px');
  await expect(cell(page, '2026-03-12')).toHaveCSS('border-top-color', 'rgb(226, 222, 211)');
  await expect(panel(page).locator('.switch__input')).not.toBeChecked();
});

test('2. "Show weekends" adds Sat/Sun columns and persists across reload', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await panel(page).locator('.switch').click();
  await expect(panel(page).locator('.calendar__weekday')).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  await expect(panel(page).locator('.calendar__day')).toHaveCount(42);
  await expect(panel(page).locator('.calendar__day').first()).toHaveAttribute('data-key', '2026-03-01');
  await waitForSaved(page, (doc) => doc.settings.showWeekends === true);

  await page.reload();
  await expect(panel(page).locator('.switch__input')).toBeChecked();
  await expect(panel(page).locator('.calendar__weekday')).toHaveCount(7);
  await expect(cell(page, '2026-03-14')).toBeVisible();
});

test('3. clicking an empty day opens Stage 2 with that date in the day bar', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await expect(cell(page, '2026-03-19')).toHaveAttribute('title', 'No tasks yet');
  await cell(page, '2026-03-19').click();
  await settled(page);
  await expect(step(page, 2)).toHaveAttribute('aria-current', 'step');
  await expect(stageTitle(page)).toHaveText('Write it all down');
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY)).selectedDate).toBe('2026-03-19');
});

// ---------- 4: brain dump ----------

test('4. adding tasks builds a numbered list; ✕ deletes with Undo; reload keeps them', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto('/');
  await cell(page, TODAY).click();
  await settled(page);
  const next = panel(page).locator('.stage-nav__next');
  await expect(next).toBeDisabled();

  await typeTasks(page, TITLES);
  const rows = panel(page).locator('.dump-row');
  await expect(rows).toHaveCount(3);
  await expect.poll(() => inputValues(rows.locator('input'))).toEqual(TITLES);
  await expect(rows.locator('.dump-row__num')).toHaveText(['1', '2', '3']);
  await expect(next).toBeEnabled();

  await rows.nth(1).hover();
  await rows.nth(1).locator('.dump-row__delete').click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.toast')).toContainText('Task deleted');
  await waitForSaved(page, (doc) => doc.tasks.filter((item) => !item.deleted).length === 2);

  await page.reload();
  await expect(stageTitle(page)).toHaveText('Write it all down');
  await expect.poll(() => inputValues(panel(page).locator('.dump-row input'))).toEqual([TITLES[0], TITLES[2]]);
});

// ---------- 5: sorting ----------

test('5. Stage 3: coloured matrix, tasks listed below; mouse drag, tap-to-place and keys 1–4 work', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.clock.setFixedTime(FIXED_NOW);
  await seed(page, { tasks: unsortedTasks(), stage: 3 });
  await page.goto('/');

  await expect(stageTitle(page)).toHaveText('Place them by priority:');
  await expect(panel(page).locator('.sort__bullets li')).toHaveText(['URGENT', 'NOT URGENT', 'IMPORTANT', 'NOT IMPORTANT']);
  await expect(panel(page).locator('.sort__axis-text')).toHaveText(['URGENT', 'NOT URGENT', 'IMPORTANT', 'NOT IMPORTANT']);
  await expect(panel(page).locator('.quadrant__label')).toHaveCount(0);
  for (const [q, fill, border] of [['do', RGB.redFill, RGB.red], ['plan', RGB.yellowFill, RGB.yellow], ['delegate', RGB.blueFill, RGB.blue], ['delete', RGB.grayFill, RGB.gray]]) {
    await expect(quadrant(page, q)).toHaveCSS('background-color', fill);
    await expect(quadrant(page, q)).toHaveCSS('border-top-color', border);
  }
  await expect(pileCards(page)).toHaveText(TITLES);
  const matrix = await panel(page).locator('.matrix').boundingBox();
  const list = await panel(page).locator('.sort__list-panel').boundingBox();
  expect(list.y).toBeGreaterThan(matrix.y + matrix.height - 1); // the task list sits below the matrix

  // Mouse drag into the red quadrant.
  await mouseDrag(page, await centre(pileCards(page).first()), await centre(quadrant(page, 'do')));
  await expect(page.locator('.sort-ghost')).toHaveCount(1);
  await expect(quadrant(page, 'do')).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect(quadrant(page, 'do').locator('.sort-card')).toHaveText([TITLES[0]]);
  await expect(page.locator('.sort-ghost')).toHaveCount(0);

  // Tap-to-place: select a card, then tap a quadrant.
  const second = pileCards(page).first();
  await second.locator('.sort-card__grab').click();
  await expect(second).toHaveClass(/task-card--selected/);
  await expect(second.locator('.sort-card__grab')).toHaveAttribute('aria-pressed', 'true');
  await tapQuadrant(page, 'delete');
  await expect(quadrant(page, 'delete').locator('.sort-card')).toHaveText([TITLES[1]]);

  // Keyboard: 1–4 from a focused card (also re-sorts an already placed card).
  await pileCards(page).first().locator('.sort-card__grab').focus();
  await page.keyboard.press('3');
  await expect(quadrant(page, 'delegate').locator('.sort-card')).toHaveText([TITLES[2]]);
  await expect(panel(page).locator('.sort__done')).toHaveText('All placed ✓');
  await quadrant(page, 'delete').locator('.sort-card__grab').focus();
  await page.keyboard.press('2');
  await expect(quadrant(page, 'plan').locator('.sort-card')).toHaveText([TITLES[1]]);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').quadrant === 'do' && taskById(doc, 't_2').quadrant === 'plan' && taskById(doc, 't_3').quadrant === 'delegate');
});

// ---------- 6–7: the board ----------

test('6. Stage 4 shows the four labels and the tasks in their quadrants with checkbox + clock', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await seed(page, { tasks: sortedTasks(), stage: 4 });
  await page.goto('/');
  await expect(stageTitle(page)).toHaveText('Ready to start');
  await expect(panel(page).locator('.quadrant__label')).toHaveText(['Do now', 'Schedule', 'Delegate', 'Drop']);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText([TITLES[0]]);
  await expect(quadrant(page, 'plan').locator('.task-card')).toHaveText([TITLES[2]]);
  await expect(quadrant(page, 'delegate').locator('.task-card')).toHaveText([TITLES[1]]);
  await expect(quadrant(page, 'delete').locator('.task-card')).toHaveCount(0);
  for (const title of TITLES) {
    await expect(card(page, title).locator('input[type="checkbox"]')).toBeVisible();
    await expect(card(page, title).locator('.task-card__clock--idle svg')).toBeVisible();
  }
  await expect(panel(page).locator('.quadrant__add')).toHaveCount(4);
});

test('7. ticking a task strikes it through and Stage 1 shows one green stripe per done task', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await seed(page, { tasks: sortedTasks('2026-03-12'), stage: 4, date: '2026-03-12' });
  await page.goto('/');
  await card(page, TITLES[0]).locator('.task-card__check').check();
  const done = card(page, TITLES[0]);
  await expect(done).toHaveClass(/task-card--done/);
  await expect(done.locator('.task-card__title')).toHaveCSS('text-decoration-line', 'line-through');
  await waitForSaved(page, (doc) => taskById(doc, 't_1').done === true);

  await goToStage(page, 1);
  const day = cell(page, '2026-03-12');
  await expect(day).toHaveClass(/calendar__day--planned/);
  await expect(day).toHaveClass(/calendar__day--selected/);
  await expect(day).toHaveCSS('border-top-color', RGB.green);
  await expect(day).toHaveAttribute('title', '1 of 3 done');
  expect(await fillRatio(day)).toBeCloseTo(0.1, 1);
  await expect(day.locator('.calendar__fill')).toHaveCSS('background-image', /linear-gradient/);
  await expect(cell(page, TODAY)).toHaveCSS('border-top-color', RGB.today);

  await day.click();
  await settled(page);
  await expect(stageTitle(page)).toHaveText('Ready to start');
  await done.locator('.task-card__check').uncheck();
  await expect(done).not.toHaveClass(/task-card--done/);
});

// ---------- 8–10: fast organize ----------

/** Fake WebAudio: counts oscillator starts so the countdown beep can be asserted without a sound device. */
function fakeAudio(page) {
  return page.addInitScript(() => {
    window.__beeps = 0;
    class FakeAudioContext {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      resume() { return Promise.resolve(); }
      createGain() { const gain = { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => gain }; return gain; }
      createOscillator() { return { type: '', frequency: { value: 0 }, connect: (node) => node, start: () => { window.__beeps += 1; }, stop() {} }; }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });
}

test('8. ▶ starts a countdown: timer bar + live clock icon, still running after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  const today = toKey(new Date()); // real time: the countdown has to tick
  await fakeAudio(page);
  await seed(page, { tasks: sortedTasks(today), stage: 4, date: today });
  await page.goto('/');
  await expect(stageTitle(page)).toHaveText('Ready to start');

  await card(page, TITLES[0]).locator('.task-card__clock').click(); // the clock opens the timer picker
  await expect(popover(page).locator('.task-popover__title')).toHaveText(TITLES[0]);
  await expect(popover(page).locator('.timer-picker__preset')).toHaveText(['5', '15', '25', '45', '60']);
  await popover(page).getByRole('button', { name: '5', exact: true }).click();
  await expect(popover(page)).toHaveCount(0);

  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.timer-bar__title')).toHaveText(TITLES[0]);
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Pause');
  const clock = card(page, TITLES[0]).locator('.task-card__clock');
  await expect(clock).toHaveClass(/task-card__clock--running/);
  await expect(clock).toHaveText(/^0[45]:\d\d$/);
  const shown = await bar(page).locator('.timer-bar__time').textContent();
  await expect.poll(() => bar(page).locator('.timer-bar__time').textContent(), { timeout: 4000 }).not.toBe(shown);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').timer?.running === true);

  await page.reload();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Pause');
  await expect(card(page, TITLES[0]).locator('.task-card__clock')).toHaveClass(/task-card__clock--running/);
  await goToStage(page, 1);
  await expect(bar(page)).toBeVisible(); // the bar is global, not a board widget
  await bar(page).locator('.timer-bar__pause').click();
  await expect(bar(page).locator('.timer-bar__pause')).toHaveAttribute('aria-label', 'Resume');
  await bar(page).locator('.timer-bar__stop').click();
  await expect(bar(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('8b. a countdown reaching 0 beeps (WebAudio), flashes the bar and says "Time\'s up!"', async ({ page }) => {
  const errors = collectErrors(page);
  const today = toKey(new Date());
  const timer = { mode: 'countdown', durationSec: 2, startedAt: new Date().toISOString(), elapsedSec: 0, running: true, stoppedAt: null };
  await fakeAudio(page);
  await seed(page, { tasks: [task('t_1', TITLES[0], today, 'do', { timer })], stage: 4, date: today });
  await page.goto('/');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveClass(/timer-bar--finished/, { timeout: 8000 });
  await expect(bar(page)).toHaveClass(/timer-bar--flash/);
  await expect(bar(page).locator('.timer-bar__status')).toHaveText("Time's up!");
  await expect(bar(page).locator('.timer-bar__time')).toHaveText('00:00');
  await expect(card(page, TITLES[0]).locator('.task-card__clock')).toHaveClass(/task-card__clock--finished/);
  await expect.poll(() => page.evaluate(() => window.__beeps)).toBe(3);
  await bar(page).locator('.timer-bar__done').click();
  await expect(card(page, TITLES[0])).toHaveClass(/task-card--done/);
  await expect(bar(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('9. 📅 moves the task to the chosen date (gone here, visible there) and Undo brings it back', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await seed(page, { tasks: sortedTasks(), stage: 4 });
  await page.goto('/');

  const postpone = async () => {
    await openSchedule(page, TITLES[2]);
    const input = popover(page).locator('.schedule-picker__date');
    await expect(input).toHaveAttribute('min', TODAY);
    await input.fill('2026-03-20');
    await popover(page).locator('.schedule-picker button[type="submit"]').click();
    await expect(popover(page)).toHaveCount(0);
    await expect(card(page, TITLES[2])).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Moved to Fri 20 Mar');
    await waitForSaved(page, (doc) => taskById(doc, 't_3').date === '2026-03-20');
  };

  await postpone();
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(card(page, TITLES[2])).toHaveCount(1);
  await waitForSaved(page, (doc) => taskById(doc, 't_3').date === TODAY);

  await postpone();
  await goToStage(page, 1);
  await expect(cell(page, '2026-03-20')).toHaveAttribute('title', '0 of 1 done');
  await cell(page, '2026-03-20').click();
  await settled(page);
  await expect(stageTitle(page)).toHaveText('Ready to start');
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY)).selectedDate).toBe('2026-03-20');
  await expect(quadrant(page, 'plan').locator('.task-card')).toHaveText([TITLES[2]]);
});

test('10. ⏩ sends a Friday task to Monday when weekends are hidden; Undo works', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const friday = '2026-03-13';
  await seed(page, { tasks: sortedTasks(friday), stage: 4, date: friday });
  await page.goto('/');

  await openSchedule(page, TITLES[0]);
  await popover(page).locator('.schedule-picker__nextday').click();
  await expect(card(page, TITLES[0])).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Moved to Mon 16 Mar');
  await waitForSaved(page, (doc) => taskById(doc, 't_1').date === '2026-03-16');

  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText([TITLES[0]]);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').date === friday);
});

// ---------- 11: quadrant menus ----------

test('11. each quadrant has a "+" that adds a task inline; the red ✕ deletes (no "…" menu)', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  const tasks = ['do', 'plan', 'delegate', 'delete'].flatMap((q, i) => [task(`t_${i * 2 + 1}`, `${q} one`, TODAY, q), task(`t_${i * 2 + 2}`, `${q} two`, TODAY, q)]);
  await seed(page, { tasks, stage: 4 });
  await page.goto('/');

  await expect(panel(page).locator('.quadrant__add')).toHaveCount(4);
  await expect(panel(page).locator('.quadrant__more')).toHaveCount(0);

  // "+" adds a task inline in that quadrant.
  await quadrant(page, 'do').locator('.quadrant__add').click();
  const input = quadrant(page, 'do').locator('.task-card--new input');
  await expect(input).toBeFocused();
  await input.fill('do three');
  await page.keyboard.press('Enter');
  await expect(quadrant(page, 'do').locator('.task-card:not(.task-card--new)')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(quadrant(page, 'do').locator('.task-card--new')).toHaveCount(0);

  // The red ✕ deletes at once (tombstoned so the deletion syncs), with an Undo toast.
  await card(page, 'delete one').locator('.task-card__delete').click();
  await expect(card(page, 'delete one')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Task deleted');
  await waitForSaved(page, (doc) => taskById(doc, 't_7')?.deleted === true);
});

test('12. every speech bubble appears verbatim on its stage the first time, closes, and ? re-opens it', async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await seed(page, { tasks: sortedTasks(), stage: 1, tipsSeen: false });
  await page.goto('/');
  await expect(bubble(page)).toHaveCount(1);
  await closeTip(page);

  const closeAll = async () => {
    while (await bubble(page).count()) await bubble(page).first().locator('.bubble__close').click();
  };
  const expectTip = async (n, check, count = 1) => {
    await goToStage(page, n);
    await expect(bubble(page)).toHaveCount(count);
    await check();
    await closeAll();
    await page.locator('#tip-button').click();
    await expect(bubble(page)).toHaveCount(count);
    await check();
    await closeAll();
  };
  await expectTip(2, async () => {
    await expect(bubble(page)).toHaveClass(/bubble--khaki/);
    await expect(bubble(page).locator('.bubble__body')).toHaveText('Write down everything you have for today — all of it!');
    await expect(bubble(page).locator('strong')).toHaveText('all of it!');
  });
  await expectTip(3, async () => {
    await expect(bubble(page)).toHaveClass(/bubble--khaki/);
    await expect(bubble(page).locator('.bubble__title')).toHaveText('Organize them by priority:');
    await expect(bubble(page).locator('li')).toHaveText(['Urgent & Important', 'Important but Not Urgent', 'Urgent but Not Important', 'Not Urgent & Not Important']);
  });
  await expectTip(4, async () => {
    const green = bubble(page).filter({ hasText: 'Done mark ✅' });
    const dark = bubble(page).filter({ hasText: 'start the timer or the clock down' });
    await expect(green).toHaveClass(/bubble--green/);
    await expect(green.locator('.bubble__body')).toHaveText('Done mark ✅');
    await expect(green).toHaveCSS('background-color', 'rgb(205, 244, 211)');
    await expect(dark).toHaveClass(/bubble--dark/);
    await expect(dark.locator('.bubble__title')).toHaveText('Organize them by priority:');
    await expect(dark.locator('li')).toHaveText(['start the timer or the clock down', 'postpone for another day', "send it to the next day's list"]);
    await expect(dark).toHaveCSS('color', 'rgb(255, 255, 255)');
  }, 2);

  // Seen once: no auto-show after a reload, on any stage.
  await waitForSaved(page, (doc) => Object.values(doc.settings.tipsSeen).every(Boolean));
  await page.reload();
  await expect(stageTitle(page)).toHaveText('Ready to start');
  await expect(bubble(page)).toHaveCount(0);
  await goToStage(page, 2);
  await expect(bubble(page)).toHaveCount(0);
});

/** Records every panel--enter/exit/ghost class seen under #stage from now on. */
function watchTransitions(page) {
  return page.evaluate(() => {
    window.__transitions = new Set();
    const note = (el) => { for (const c of el.classList ?? []) if (/^panel--(enter|exit|ghost)/.test(c)) window.__transitions.add(c); };
    new MutationObserver((records) => records.forEach((r) => { note(r.target); r.addedNodes.forEach(note); }))
      .observe(document.getElementById('stage'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}
const transitions = (page) => page.evaluate(() => [...window.__transitions].sort());

test('13. stepper and ←/→ keys navigate with animated transitions; reduced motion disables them', async ({ page }) => {
  await page.goto('/');
  await closeTip(page);
  await watchTransitions(page);

  await step(page, 3).click();
  await expect(panel(page)).toHaveAttribute('data-stage', '3');
  await expect(step(page, 3)).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 1)).toHaveClass(/is-done/);
  await settled(page);
  expect(await transitions(page)).toEqual(['panel--enter-forward', 'panel--exit-forward', 'panel--ghost']);

  await page.keyboard.press('ArrowLeft');
  await expect(stageTitle(page)).toHaveText('Write it all down');
  await settled(page);
  expect(await transitions(page)).toContain('panel--enter-back');

  // → mirrors "Next →": blocked on an empty day, ignored while typing, otherwise moves on.
  await page.keyboard.press('ArrowRight');
  await expect(panel(page)).toHaveAttribute('data-stage', '2');
  await typeTasks(page, ['A task']);
  await page.keyboard.press('ArrowRight'); // focus is still in the row
  await expect(panel(page)).toHaveAttribute('data-stage', '2');
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('ArrowRight');
  await expect(stageTitle(page)).toHaveText('Place them by priority:');
  await expect(page.locator('#announcer')).toHaveText('Stage 3 of 4: Prioritize');
  await page.keyboard.press('?');
  await expect(bubble(page)).toContainText('Organize them by priority:');
  await settled(page);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watchTransitions(page);
  await step(page, 4).click();
  await expect(panel(page)).toHaveAttribute('data-stage', '4');
  await expect(page.locator('#stage .panel')).toHaveCount(1);
  expect(await transitions(page)).toEqual([]);
});

// ---------- 14–15: banner and account ----------

test('14. the free-mode banner shows when signed out, dismisses, and stays dismissed', async ({ page }) => {
  await page.goto('/');
  const banner = page.locator('#banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("You're in free mode — tasks are saved only in this browser. Clearing cookies/site data erases them. Sign in with Google to keep them everywhere.");
  await banner.locator('button', { hasText: 'Dismiss' }).click();
  await expect(banner).toBeHidden();
  await waitForSaved(page, (doc) => doc.settings.bannerDismissed === true);
  await page.reload();
  await expect(stageTitle(page)).toBeVisible();
  await expect(banner).toBeHidden();
});

test('15. "Sign in with Google" is present; with firebaseConfig = null it opens the explanatory modal', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('#account button');
  await expect(button).toHaveText('Sign in with Google');
  await expect(button.locator('svg')).toBeVisible();
  await button.click();
  const dialog = page.locator('[role="dialog"].modal');
  await expect(dialog.locator('.modal__title')).toHaveText('Google sign-in is not connected yet');
  await expect(dialog).toContainText('Your tasks stay saved in this browser.');
  await expect(dialog.locator('a[href="https://github.com/a-papadopoulos90i/escape-the-matrix/blob/main/SETUP.md"]')).toBeVisible();
  await dialog.locator('button', { hasText: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
});

// ---------- 17: mobile ----------

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('17. 375px: no horizontal scroll on any stage (tips open), the matrix stacks, touch drag places a task', async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.setFixedTime(FIXED_NOW);
    await seed(page, { tasks: unsortedTasks(), stage: 1, tipsSeen: false, settings: { bannerDismissed: false } });
    await page.goto('/');
    for (const n of [1, 2, 3, 4]) {
      if (n > 1) await goToStage(page, n);
      await expect(bubble(page)).toHaveCount(n === 4 ? 2 : 1); // the board carries both of its comments
      expect(await overflow(page), `stage ${n}`).toBeLessThanOrEqual(0);
      await expect(panel(page).locator('.stage-nav__next')).toBeVisible();
      // On a phone the tips sit in the flow under the stage header: they hide neither the title
      // (nor stage 3's bullet list) nor the cards they explain.
      const boxes = await bubble(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      const tipTop = Math.min(...boxes.map((b) => b.y));
      const tipBottom = Math.max(...boxes.map((b) => b.bottom));
      const header = await panel(page).locator('.stage-header').boundingBox();
      expect(tipTop, `stage ${n} tip below the header`).toBeGreaterThanOrEqual(header.y + header.height - 1);
      const firstCard = panel(page).locator('.task-card, .dump-row').first();
      if (await firstCard.count()) expect((await firstCard.boundingBox()).y, `stage ${n} tip above the content`).toBeGreaterThanOrEqual(tipBottom - 1);
    }
    const matrix = panel(page).locator('.matrix');
    expect((await matrix.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' ')).toHaveLength(1);

    // Tips were seen on the first pass, so none re-open on the way back.
    await goToStage(page, 3);
    await expect(bubble(page)).toHaveCount(0);
    // The list is below the tall stacked matrix; bring the bottom quadrant ("Drop") into view so a
    // card and a quadrant share the screen, then drag the card up into it.
    const target = quadrant(page, 'delete');
    await target.scrollIntoViewIfNeeded();
    await touchDrag(page, await centre(pileCards(page).first()), await centre(target));
    await expect(target.locator('.sort-card')).toHaveText([TITLES[0]]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await goToStage(page, 4);
    await openPopover(page, TITLES[0]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const box = await popover(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(errors).toEqual([]);
  });
});

// ---------- 18–19: robustness and deployment ----------

test('18. no console errors on any stage and no network needed after the first load (free mode)', async ({ page, context }) => {
  const errors = collectErrors(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.clock.setFixedTime(FIXED_NOW);
  await seed(page, { tasks: sortedTasks(), stage: 1, tipsSeen: false });
  await page.goto('/');
  for (const n of [2, 3, 4]) await goToStage(page, n);
  await openPopover(page, TITLES[0]);
  await page.keyboard.press('Escape');
  const loaded = requests.length;

  await context.setOffline(true);
  await goToStage(page, 2);
  await typeTasks(page, ['Offline task']);
  await goToStage(page, 3);
  await pileCards(page).first().locator('.sort-card__grab').focus();
  await page.keyboard.press('1');
  await expect(quadrant(page, 'do').locator('.sort-card')).toHaveText([TITLES[0], 'Offline task']);
  await goToStage(page, 4);
  await card(page, 'Offline task').locator('.task-card__check').check();
  await goToStage(page, 1);
  await expect(cell(page, TODAY)).toHaveAttribute('title', '1 of 4 done');

  expect(errors).toEqual([]);
  expect(requests.length).toBe(loaded);
  expect(requests.every((url) => url.startsWith('http://localhost:4173/'))).toBe(true);
});

test('19. every asset URL is relative: the app boots unchanged under a /escape-the-matrix/ sub-path', async ({ page }) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const [, url] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) expect(url).toMatch(/^(\.\/|data:|#)/);
  for (const [, specifier] of fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').matchAll(/from '([^']+)'/g)) expect(specifier).toMatch(/^\.\//);

  const errors = collectErrors(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/escape-the-matrix/**', async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace('/escape-the-matrix', '');
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await page.goto('/escape-the-matrix/');
  await expect(page).toHaveTitle('Escape the Matrix');
  await expect(stageTitle(page)).toHaveText('Pick your day');
  await expect(page.locator('#stepper .step')).toHaveCount(4);
  await goToStage(page, 4);
  await expect(panel(page).locator('.quadrant__label')).toHaveCount(4);
  expect(requests.length).toBeGreaterThan(15);
  expect(requests.every((url) => url.startsWith('http://localhost:4173/escape-the-matrix/'))).toBe(true);
  expect(errors).toEqual([]);
});
