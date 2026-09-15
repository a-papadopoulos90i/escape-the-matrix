import { test, expect } from './fixtures.js';
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

function seed(page, { tasks, stage = 3, date = DAY, settings = {} }) {
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
  await expect(panel(page).locator('.stage-title')).toHaveText('Place them by priority');
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
  await expect(waiting.locator('.waiting-place')).toHaveCount(4); // one glyph per quadrant

  // The glyphs TAG the task — they never file it into a quadrant.
  await waiting.locator('.waiting-place--do').click();
  await expect(waiting.locator('.waiting-place--do')).toHaveClass(/is-active/);
  await expect(waiting.locator('.task-card__priority')).toHaveClass(/priority-icon--do/); // shown after the tick
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveText(['Marketing Order A5']); // not moved
  await expect(waiting.locator('.waiting-card')).toHaveText(/Loose end/);
  await waitForSaved(page, (doc) => taskById(doc, 't_4').tag === 'do' && taskById(doc, 't_4').quadrant === null);

  // Tapping the active glyph again clears the label.
  await waiting.locator('.waiting-place--do').click();
  await expect(waiting.locator('.waiting-place--do')).not.toHaveClass(/is-active/);
  expect(errors).toEqual([]);
});

test('a waiting task has its own checkbox: ticking it done removes it from the global backlog', async ({ page }) => {
  await seed(page, { tasks: [...SORTED(), task('t_9', 'Water the plants', null)] });
  await page.goto('/');
  const wcard = panel(page).locator('.waiting-card', { hasText: 'Water the plants' });
  await expect(wcard.locator('.task-card__check')).toHaveCount(1);
  await wcard.locator('.task-card__check').click(); // done → it leaves the backlog (kept until placed, done or deleted)
  await expect(panel(page).locator('.waiting-card', { hasText: 'Water the plants' })).toHaveCount(0);
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
  await seed(page, { tasks: SORTED(), stage: 3 });
  await page.goto('/');
  await expect(panel(page).locator('.stage-title')).toHaveText('Place them by priority');

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

test('on the board the tag menu files the card: a priority moves it there, "No priority" sends it back to the waiting list', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: SORTED() });
  await page.goto('/');
  const tagBtn = () => card(page, 'Marketing Order A5').locator('.task-card__priority');

  await tagBtn().click();
  await page.getByRole('menuitem', { name: 'Not Urgent / Important', exact: true }).click();
  await expect(quadrant(page, 'plan').locator('.task-card', { hasText: 'Marketing Order A5' })).toHaveCount(1);
  await expect(quadrant(page, 'do').locator('.task-card')).toHaveCount(0);
  await expect(tagBtn()).toHaveClass(/priority-icon--plan/);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').quadrant === 'plan' && taskById(doc, 't_1').tag === 'plan');

  await tagBtn().click();
  await page.getByRole('menuitem', { name: 'No priority' }).click();
  await expect(panel(page).locator('.waiting-card', { hasText: 'Marketing Order A5' })).toHaveCount(1);
  await expect(quadrant(page, 'plan').locator('.task-card', { hasText: 'Marketing Order A5' })).toHaveCount(0);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').quadrant === null && taskById(doc, 't_1').tag === null);
  expect(errors).toEqual([]);
});

test('in the waiting list, the insert arrow puts a card on the day in its tag\'s quadrant; untagged ones ask which', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { tasks: [...SORTED(), task('t_wait', 'Book the venue', null, { tag: 'delegate' }), task('t_bare', 'Loose idea', null, { tag: null })] });
  await page.goto('/');
  const waiting = (title) => panel(page).locator('.waiting-card', { hasText: title });

  // The arrow sits right after the tick, before the tag icon and the title.
  const order = await waiting('Book the venue').evaluate((card) => [...card.children].map((el) => el.className.split(' ')[0]));
  expect(order.slice(0, 4)).toEqual(['task-card__done', 'task-card__insert', 'task-card__priority', 'task-card__title']);

  await expect(waiting('Book the venue').locator('.task-card__insert')).toHaveAttribute('aria-label', 'Put on this day in Delegate');
  await waiting('Book the venue').locator('.task-card__insert').click();
  await expect(quadrant(page, 'delegate').locator('.task-card', { hasText: 'Book the venue' })).toHaveCount(1);
  await expect(waiting('Book the venue')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0); // no menu — it moved at once
  await waitForSaved(page, (doc) => taskById(doc, 't_wait').quadrant === 'delegate' && taskById(doc, 't_wait').tag === 'delegate');

  // The tag icon only opens the menu, and nothing in it is disabled: picking the current label just closes it.
  await waiting('Loose idea').locator('.task-card__priority').click();
  await expect(page.getByRole('menuitem', { name: 'No priority' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'No priority' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(waiting('Loose idea')).toHaveCount(1);

  // An untagged card's arrow asks for a priority, then puts the task there.
  await waiting('Loose idea').locator('.task-card__insert').click();
  await page.getByRole('menuitem', { name: 'Urgent / Important', exact: true }).click();
  await expect(quadrant(page, 'do').locator('.task-card', { hasText: 'Loose idea' })).toHaveCount(1);
  await waitForSaved(page, (doc) => taskById(doc, 't_bare').quadrant === 'do' && taskById(doc, 't_bare').tag === 'do');
  expect(errors).toEqual([]);
});

test('the waiting list starts folded behind its heading and opens on click (remembered per browser)', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('levelix:keepWaitingDefault')) return;
    sessionStorage.setItem('levelix:keepWaitingDefault', '1');
    localStorage.removeItem('levelix:waitingOpen');
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await seed(page, { tasks: [...SORTED(), task('t_wait', 'Book the venue', null, { tag: 'delegate' })] });
  await page.goto('/');
  const toggle = () => panel(page).locator('.waiting__toggle');

  await expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle()).toHaveText('Waiting list (1)');
  await expect(panel(page).locator('.waiting-card')).toHaveCount(0);
  await expect(panel(page).locator('.waiting__sort')).toHaveCount(0);
  await panel(page).locator('.waiting').screenshot({ path: path.join(SHOTS, 'waiting-folded.png') });

  await toggle().click();
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page).locator('.waiting-card', { hasText: 'Book the venue' })).toHaveCount(1);
  await panel(page).locator('.waiting').screenshot({ path: path.join(SHOTS, 'waiting-open.png') });

  await page.reload();
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  await toggle().click();
  await expect(panel(page).locator('.waiting-card')).toHaveCount(0);
});

test('"Pull them here" is offered only on the real today, for unfinished work from the days before it', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0)); // today = Wed 11 Mar 2026 (= DAY)
  await seed(page, { tasks: [...SORTED(), task('t_old', 'Old report', 'do', { date: '2026-03-09' })] });
  await page.goto('/');
  const strip = () => panel(page).locator('.carry-strip');
  const dayLabel = () => panel(page).locator('.stage-nav__day-label');

  await expect(strip()).toHaveCount(1); // today: offers the 9 Mar leftover
  await expect(strip()).toContainText('Mon 9 Mar');

  await panel(page).locator('.stage-nav__day-arrow').last().click(); // Thu 12 Mar — not today yet
  await expect(dayLabel()).toHaveText('Thu 12 Mar');
  await expect(strip()).toHaveCount(0);
  await page.locator('#stepper .step').nth(1).click(); // Write down for that future day: no pull list either
  await expect(panel(page).locator('.dump__carry .carry-strip__pull')).toHaveCount(0);
  await expect(panel(page).locator('.stage-nav__day-label')).toHaveText('Thu 12 Mar'); // Write down only names the day…
  await expect(panel(page).locator('.stage-nav__day-arrow')).toHaveCount(0); // …no arrows to change it there
  await page.locator('#stepper .step').nth(2).click();

  await panel(page).locator('.stage-nav__day-arrow').first().click();
  await panel(page).locator('.stage-nav__day-arrow').first().click(); // Tue 10 Mar — a past day
  await expect(dayLabel()).toHaveText('Tue 10 Mar');
  await expect(strip()).toHaveCount(0);

  await panel(page).locator('.stage-nav__day-arrow').last().click(); // back on today
  await expect(strip()).toHaveCount(1);
});

test('clicking the day label opens a month picker: flip months, pick a day, jump back to today, use the keyboard', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0)); // today = Wed 11 Mar 2026 (= DAY)
  await seed(page, { tasks: SORTED() });
  await page.goto('/');
  const dayLabel = () => panel(page).locator('.stage-nav__day-label');
  const picker = page.getByRole('dialog', { name: 'Choose a date' });

  await dayLabel().click();
  await expect(picker).toBeVisible();
  await expect(picker.locator('.day-picker__title')).toHaveText('March 2026');
  await expect(picker.getByRole('button', { name: 'Wednesday, 11 March 2026' })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('button', { name: 'Wednesday, 11 March 2026' })).toBeFocused();
  await picker.screenshot({ path: path.join(SHOTS, 'day-picker.png') });

  await picker.getByRole('button', { name: 'Next month' }).click();
  await expect(picker.locator('.day-picker__title')).toHaveText('April 2026');
  await picker.getByRole('button', { name: 'Friday, 17 April 2026' }).click();
  await expect(picker).toHaveCount(0);
  await expect(dayLabel()).toHaveText('Fri 17 Apr');

  await dayLabel().click();
  await expect(picker.locator('.day-picker__title')).toHaveText('April 2026');
  await picker.getByRole('button', { name: 'Today' }).click();
  await expect(dayLabel()).toHaveText('Wed 11 Mar');

  await dayLabel().click();
  await page.keyboard.press('ArrowDown'); // a week later
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(dayLabel()).toHaveText('Thu 19 Mar');

  await dayLabel().click();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(dayLabel()).toHaveText('Thu 19 Mar');
});

test('quick add between the matrix and the waiting list: typed tasks land in the waiting list and the field keeps focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0));
  await seed(page, { tasks: SORTED() });
  await page.goto('/');
  const form = panel(page).locator('.quick-add');
  await expect(form).toContainText('Don’t let anything interrupt you');

  const input = form.getByRole('textbox', { name: "What's on your mind?" });
  await input.fill('Call the plumber');
  await input.press('Enter');
  await expect(panel(page).locator('.waiting .task-card', { hasText: 'Call the plumber' })).toHaveCount(1);
  await expect(input).toHaveValue('');
  // It sits after the matrix and before the waiting list.
  const order = await panel(page).locator('.board').evaluate((board) => [...board.children].map((el) => el.className.split(' ')[0]));
  expect(order.indexOf('matrix')).toBeLessThan(order.indexOf('quick-add'));
  expect(order.indexOf('quick-add')).toBeLessThan(order.indexOf('waiting'));
  await expect(input).toBeFocused();
  await input.pressSequentially('Buy stamps');
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(panel(page).locator('.waiting .task-card', { hasText: 'Buy stamps' })).toHaveCount(1);
  await expect(panel(page).locator('.waiting .task-card__title')).toHaveText(['Buy stamps', 'Call the plumber']); // latest entry on top
  await expect(page.locator('#stepper .step.is-current')).toHaveAttribute('aria-label', /Prioritize/); // typing arrows did not switch tabs
  await panel(page).locator('.board').screenshot({ path: path.join(SHOTS, 'quick-add.png') });
});

test('the waiting list sorts newest first, oldest first or by priority, and remembers the choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const waitingTask = (id, title, tag, createdAt) => task(id, title, null, { tag, createdAt, updatedAt: createdAt });
  await seed(page, {
    tasks: [
      waitingTask('w_old', 'Old idea', null, '2026-03-01T08:00:00.000Z'),
      waitingTask('w_mid', 'Book dentist', 'plan', '2026-03-05T08:00:00.000Z'),
      waitingTask('w_new', 'Pay the bill', 'do', '2026-03-10T08:00:00.000Z'),
      waitingTask('w_drop', 'Sort old mail', 'delete', '2026-03-08T08:00:00.000Z'),
    ],
  });
  await page.goto('/');
  const titles = () => panel(page).locator('.waiting .task-card__title');
  const sortButton = panel(page).locator('.waiting__sort');

  await expect(sortButton).toHaveText('Newest first');
  await expect(titles()).toHaveText(['Pay the bill', 'Sort old mail', 'Book dentist', 'Old idea']);

  await sortButton.click();
  await page.getByRole('menuitem', { name: 'Oldest first' }).click();
  await expect(titles()).toHaveText(['Old idea', 'Book dentist', 'Sort old mail', 'Pay the bill']);

  await sortButton.click();
  await page.getByRole('menuitem', { name: 'By priority' }).click();
  await expect(sortButton).toHaveText('By priority');
  await expect(titles()).toHaveText(['Pay the bill', 'Book dentist', 'Sort old mail', 'Old idea']); // Do now, Schedule, Drop, no label
  await panel(page).locator('.waiting__head').screenshot({ path: path.join(SHOTS, 'waiting-sort.png') });

  await page.reload();
  await expect(panel(page).locator('.waiting__sort')).toHaveText('By priority');
});

test('dragging a waiting-list card shrinks it to the size of a card inside a quadrant', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await seed(page, { tasks: [...SORTED(), task('t_wait', 'Book the venue', null, { tag: 'delegate' })] });
  await page.goto('/');
  const waitingCard = panel(page).locator('.waiting-card', { hasText: 'Book the venue' });
  const placedWidth = (await quadrant(page, 'do').locator('.task-card').first().boundingBox()).width;
  const waitingWidth = (await waitingCard.boundingBox()).width;
  expect(waitingWidth).toBeGreaterThan(placedWidth + 100); // the waiting list is much wider

  const from = await centre(waitingCard.locator('.task-card__title'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y - 40, { steps: 4 });
  const ghost = await page.locator('.board-ghost').boundingBox();
  expect(Math.abs(ghost.width - placedWidth)).toBeLessThanOrEqual(2);
  // The grabbed point stays under the pointer.
  expect(from.x + 20).toBeGreaterThanOrEqual(ghost.x);
  expect(from.x + 20).toBeLessThanOrEqual(ghost.x + ghost.width);
  await page.mouse.up();
});

test('a card drags into another quadrant; the red ✕ deletes it with undo', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await seed(page, { tasks: SORTED(), stage: 3 });
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
  // The dropped card takes the new quadrant's priority as its tag.
  await expect(card(page, 'Marketing Order A5').locator('.task-card__priority')).toHaveClass(/priority-icon--plan/);
  await waitForSaved(page, (doc) => taskById(doc, 't_1').quadrant === 'plan' && taskById(doc, 't_1').tag === 'plan');

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
  await seed(page, { tasks: SORTED(), stage: 3 });
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
  await page.locator('#stepper .step').nth(2).click();

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
  await seed(page, { tasks: SORTED(), stage: 3 });
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
  await seed(page, { tasks: [task('t_1', 'Marketing Order A5', 'do', { timer })], stage: 3 });
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
  await seed(page, { tasks: SORTED(), stage: 3 });
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
  await seed(page, { tasks: fridayTasks(friday), stage: 3, date: toKey(friday) });
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
  await seed(page, { tasks: [...SORTED(), task('t_5', 'Call supplier', 'do')], stage: 3 });
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
  await seed(page, { tasks: SORTED(), stage: 3 });
  await page.goto('/');
  await openSchedule(page, 'Invoice Send');
  await popover(page).locator('.schedule-picker__date').fill(toKey(saturday));
  await popover(page).locator('.schedule-picker button[type="submit"]').click();
  await expect(card(page, 'Invoice Send')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText(`Moved to ${formatShort(saturday)}`);
  await waitForSaved(page, (doc) => taskById(doc, 't_2').date === toKey(saturday));
  await page.locator('#stepper .step').nth(0).click();
  // The calendar opens on the seeded month; step forward to the postponed Saturday's month (the
  // "Today" jump button was removed, so navigate with the month arrow).
  const satCell = panel(page).locator(`.calendar__day[data-key="${toKey(saturday)}"]`);
  for (let i = 0; i < 24 && (await satCell.count()) === 0; i += 1) {
    await panel(page).locator('[aria-label="Next month"]').click();
  }
  await expect(satCell).toHaveAttribute('title', '0 of 1 done');
});

test('the clock icon opens the timer picker directly; presets carry the "min" unit', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 3 });
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
  await seed(page, { tasks: [task('t_1', 'Marketing Order A5', 'do', { timer })], stage: 3 });
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
  // A long backlog on Write down, so the page scrolls and Next is enabled.
  const many = Array.from({ length: 8 }, (_, i) => task(`t_${i + 1}`, `Task ${i + 1}`, null));
  await seed(page, { tasks: many, stage: 2, settings: { tipsSeen: { 1: true, 2: true, 3: true, 4: false } } });
  await page.goto('/');
  // Scroll well down the list first (Back / Next now sit at the top, beside the date).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const next = panel(page).locator('.stage-nav__next');
  await next.click();
  await expect(panel(page).locator('.stage-title')).toHaveText('Place them by priority');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(panel(page).locator('.stage-title')).toBeFocused();
  await expect(page.locator('.bubble')).toHaveCount(0); // tips were removed
});

test('keyboard: Tab stays inside the task popover, Escape closes it', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 3 });
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
  await seed(page, { tasks: [...many, task('t_2', 'Invoice Send', 'delegate'), task('t_3', 'Make - Excel Report', 'plan')], stage: 3 });
  await page.goto('/');
  const heights = {};
  for (const q of ['do', 'plan', 'delegate', 'delete']) heights[q] = (await quadrant(page, q).boundingBox()).height;
  expect(heights.do).toBeGreaterThan(900);
  expect(heights.plan).toBeLessThan(400);
  expect(heights.delegate).toBeLessThan(400);
  expect(heights.delete).toBeLessThan(400);
});

test('no speech-bubble tips and no "?" button on the board (tips were removed)', async ({ page }) => {
  await seed(page, { tasks: SORTED(), stage: 3, settings: { tipsSeen: { 1: false, 2: false, 3: false, 4: false } } });
  await page.goto('/');
  await expect(page.locator('.bubble')).toHaveCount(0);
  await expect(page.locator('#tip-button')).toHaveCount(0);
});

test('mobile: no horizontal scroll with the popover and the timer bar open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await seed(page, { tasks: SORTED(), stage: 3 });
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
    await seed(page, { tasks: SORTED(), stage: 3 });
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
