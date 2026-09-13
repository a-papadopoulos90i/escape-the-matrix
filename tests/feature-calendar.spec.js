import { test, expect } from 'playwright/test';
import path from 'node:path';

// Stage 1 — month calendar. Seeds March 2026 (the design board's month) with tasks on several
// days and checks grid composition, cell states, toggle persistence, navigation and routing.
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const OUT = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'screenshots');

const GREEN = 'rgb(31, 143, 87)';
const GRAY = 'rgb(226, 222, 211)';
const TODAY_BLUE = 'rgb(61, 139, 255)';

/** { 'YYYY-MM-DD': [total, done] } → task list. */
function tasksFor(days) {
  return Object.entries(days).flatMap(([date, [total, done]]) =>
    Array.from({ length: total }, (_, i) => ({
      id: `t_${date}_${i}`,
      title: `Task ${i + 1}`,
      date,
      quadrant: 'do',
      order: i,
      done: i < done,
      doneAt: null,
      createdAt: '2026-03-01T08:00:00.000Z',
      updatedAt: '2026-03-01T08:00:00.000Z',
      timer: null,
    })),
  );
}

const DAYS = {
  '2026-03-02': [5, 3],
  '2026-03-03': [4, 2],
  '2026-03-04': [3, 2],
  '2026-03-05': [5, 5],
  '2026-03-06': [2, 1],
  '2026-03-09': [5, 2],
  '2026-03-10': [5, 3],
  '2026-03-20': [2, 0],
};

function makeDoc({ showWeekends = false, tipSeen = true } = {}) {
  return {
    version: 1,
    updatedAt: '2026-03-11T08:00:00.000Z',
    settings: { showWeekends, bannerDismissed: true, tipsSeen: { 1: tipSeen, 2: true, 3: true, 4: true, 5: true } },
    tasks: tasksFor(DAYS),
  };
}

/** Seeds localStorage once per tab (init scripts re-run on reload; the flag keeps persisted state). */
function seed(page, { doc = makeDoc(), ui = { selectedDate: '2026-03-11', stage: 1, calendarMonth: '2026-03' } } = {}) {
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(uiKey, JSON.stringify(ui));
      localStorage.setItem(docKey, JSON.stringify(doc));
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

/** Pins "today" to Wednesday 11 March 2026: on a real weekend the calendar shows Sat/Sun columns. */
const onAWeekday = (page) => page.clock.setFixedTime(new Date(2026, 2, 11, 9, 0, 0));

const panel = (page) => page.locator('#stage .panel:not(.panel--ghost)');
const cells = (page) => panel(page).locator('.calendar__day');
const cell = (page, key) => panel(page).locator(`.calendar__day[data-key="${key}"]`);
const weekdays = (page) => panel(page).locator('.calendar__weekday');
const title = (page) => panel(page).locator('.stage-title');
const cellKeys = (page) => cells(page).evaluateAll((nodes) => nodes.map((node) => node.dataset.key));

/** Geometry + colours of one cell as the browser painted it. */
const metrics = (page, key) =>
  cell(page, key).evaluate((node) => {
    const fill = node.querySelector('.calendar__fill');
    const style = getComputedStyle(node);
    return {
      ratio: fill.offsetHeight / node.clientHeight,
      fillHeight: fill.offsetHeight,
      fillShown: getComputedStyle(fill).display !== 'none',
      striped: getComputedStyle(fill).backgroundImage.includes('linear-gradient'),
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      width: node.getBoundingClientRect().width,
    };
  });

test('March 2026 renders Sun–Sat, six rows, starting on Mar 1 (the full week is always shown)', async ({ page }) => {
  const errors = collectErrors(page);
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');

  await expect(title(page)).toHaveText('Pick your day');
  await expect(panel(page).locator('.calendar__month')).toHaveText('March 2026');
  await expect(weekdays(page)).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  await expect(cells(page)).toHaveCount(42);

  const keys = await cellKeys(page);
  expect(keys.slice(0, 7)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']);
  expect(keys[31]).toBe('2026-04-01');
  expect(keys[41]).toBe('2026-04-11');
  await expect(cells(page).nth(31).locator('.calendar__num')).toHaveText('1');
  await expect(panel(page).locator('.calendar__legend-item')).toHaveText(['green = done tasks, one stripe each (up to 10)', 'blue = today', 'gray = empty']);
  // The weekends toggle and its note are gone; the week is always Sun–Sat.
  await expect(panel(page).locator('.switch__input')).toHaveCount(0);
  await expect(panel(page).locator('.calendar__note')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('cells show one green stripe per done task (a tenth of the cell each, ten at most); empty days show the gray tray', async ({ page }) => {
  await seed(page);
  await page.goto('/');

  const threeOfFive = await metrics(page, '2026-03-02');
  expect(threeOfFive.ratio).toBeCloseTo(0.3, 1); // 3 done → 3 stripes
  expect(threeOfFive.striped).toBe(true);
  expect(threeOfFive.borderColor).toBe(GREEN);
  await expect(cell(page, '2026-03-02')).toHaveAttribute('title', '3 of 5 done');
  await expect(cell(page, '2026-03-02')).toHaveAttribute('aria-label', 'Monday, 2 March 2026: 3 of 5 done');

  const allDone = await metrics(page, '2026-03-05');
  expect(allDone.ratio).toBeCloseTo(0.5, 1); // 5 of 5 done → 5 stripes, not a full cell

  const doneCount = async (key) => Number((await cell(page, key).getAttribute('title')).match(/^(\d+) of/)[1]);
  const half = await metrics(page, '2026-03-06');
  expect(half.ratio).toBeCloseTo(Math.min(await doneCount('2026-03-06'), 10) / 10, 1);

  // A day with tasks but nothing done shows no green — the plain gray tray, like an empty day.
  const planned = await metrics(page, '2026-03-20');
  expect(planned.borderColor).toBe(GRAY);
  expect(planned.striped).toBe(false);
  await expect(cell(page, '2026-03-20')).not.toHaveClass(/calendar__day--planned/);
  await expect(cell(page, '2026-03-20')).toHaveAttribute('title', '0 of 2 done');

  const empty = await metrics(page, '2026-03-16');
  expect(empty.borderColor).toBe(GRAY);
  expect(empty.striped).toBe(false);
  expect(empty.ratio).toBeCloseTo(0.45, 1);
  await expect(cell(page, '2026-03-16')).toHaveAttribute('title', 'No tasks yet');

  await expect(cell(page, '2026-03-11')).toHaveClass(/calendar__day--selected/);
  await expect(panel(page).locator('.calendar__day--selected')).toHaveCount(1);
});

test('today gets the 2px blue border and aria-current="date"', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  // The full week is always shown, so today is visible whatever weekday it is.
  await panel(page).locator('.calendar__today').click();

  const todayKey = await page.evaluate(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const today = panel(page).locator('.calendar__day--today');
  await expect(today).toHaveCount(1);
  await expect(today).toHaveAttribute('data-key', todayKey);
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today).toBeFocused();
  const m = await metrics(page, todayKey);
  expect(m.borderColor).toBe(TODAY_BLUE);
  expect(m.borderWidth).toBe('2px');
  expect(m.fillShown).toBe(false);

  const ui = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY);
  expect(ui.calendarMonth).toBe(todayKey.slice(0, 7));
});

test('the calendar always shows the full week (Sun–Sat), with no weekends toggle', async ({ page }) => {
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');
  await expect(weekdays(page)).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  await expect(cells(page)).toHaveCount(42);
  expect((await cellKeys(page))[0]).toBe('2026-03-01');
  await expect(panel(page).locator('.switch__input')).toHaveCount(0);

  await page.reload();
  await expect(weekdays(page)).toHaveCount(7);
  await expect(cells(page)).toHaveCount(42);
});

test('‹ › change the displayed month, update the title and persist the month', async ({ page }) => {
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');
  const next = panel(page).locator('[aria-label="Next month"]');
  const prev = panel(page).locator('[aria-label="Previous month"]');

  await next.click();
  await expect(panel(page).locator('.calendar__month')).toHaveText('April 2026');
  expect((await cellKeys(page))[0]).toBe('2026-03-29', 'the Sun–Sat week containing 1 Apr 2026 starts on Sun 29 Mar');
  await expect(panel(page).locator('.calendar__day--planned')).toHaveCount(0);

  await prev.click();
  await prev.click();
  await expect(panel(page).locator('.calendar__month')).toHaveText('February 2026');
  expect((await cellKeys(page))[0]).toBe('2026-02-01', '1 Feb 2026 is a Sunday, so the grid starts there');

  const ui = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY);
  expect(ui.calendarMonth).toBe('2026-02');
  await page.reload();
  await expect(panel(page).locator('.calendar__month')).toHaveText('February 2026');
});

test('clicking an empty day opens Stage 2, a day with tasks opens Stage 4', async ({ page }) => {
  await seed(page);
  await page.goto('/');

  await cell(page, '2026-03-12').click();
  await expect(panel(page)).toHaveAttribute('data-stage', '2');

  await page.locator('#stepper .step').nth(0).click();
  await expect(panel(page)).toHaveAttribute('data-stage', '1');
  await expect(panel(page).locator('.calendar__day--selected')).toHaveAttribute('data-key', '2026-03-12');

  await cell(page, '2026-03-02').click();
  await expect(panel(page)).toHaveAttribute('data-stage', '4');
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY)).selectedDate).toBe('2026-03-02');
  await expect(panel(page).locator('.task-card').first()).toBeVisible();
});

test('keyboard: arrows move between cells without leaving the stage; Enter opens the day', async ({ page }) => {
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');

  await cell(page, '2026-03-11').focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, '2026-03-12')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, '2026-03-19')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cell(page, '2026-03-18')).toBeFocused();
  await page.keyboard.press('End');
  await expect(cell(page, '2026-04-11')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, '2026-04-11')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cell(page, '2026-03-01')).toBeFocused();
  await expect(panel(page)).toHaveAttribute('data-stage', '1');

  await page.keyboard.press('ArrowRight'); // Mar 2 has tasks
  await expect(cell(page, '2026-03-02')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toHaveAttribute('data-stage', '4');
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY)).selectedDate).toBe('2026-03-02');
});

test('re-renders when the document changes underneath (cross-tab storage event)', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  expect((await metrics(page, '2026-03-02')).ratio).toBeCloseTo(0.3, 1);

  await page.evaluate(
    ({ docKey, doc }) => {
      localStorage.setItem(docKey, JSON.stringify(doc));
      window.dispatchEvent(new StorageEvent('storage', { key: docKey, storageArea: localStorage }));
    },
    { docKey: DOC_KEY, doc: { ...makeDoc(), tasks: tasksFor({ '2026-03-02': [5, 5], '2026-03-16': [1, 1] }) } },
  );
  await expect(cell(page, '2026-03-02')).toHaveAttribute('title', '5 of 5 done');
  expect((await metrics(page, '2026-03-02')).ratio).toBeCloseTo(0.5, 1);
  await expect(cell(page, '2026-03-16')).toHaveClass(/calendar__day--planned/); // now 1 of 1 done → green
  await expect(cell(page, '2026-03-05')).toHaveAttribute('title', 'No tasks yet');
});

test('a weekend day sits on the grid, outlined as today and reachable', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 2, 14, 9, 0, 0)); // Saturday 14 March 2026
  await seed(page, { ui: { selectedDate: '2026-03-14', stage: 1, calendarMonth: '2026-03' } });
  await page.goto('/');
  await expect(weekdays(page)).toHaveCount(7);
  const today = panel(page).locator('.calendar__day--today');
  await expect(today).toHaveAttribute('data-key', '2026-03-14');
  expect((await metrics(page, '2026-03-14')).borderColor).toBe(TODAY_BLUE);
  await panel(page).locator('.calendar__today').click();
  await expect(today).toBeFocused();

  // A written task goes to the global backlog (not tied to a day), so the weekend cell still reads
  // "No tasks yet" until something is actually placed on it.
  await cell(page, '2026-03-14').click();
  await expect(panel(page)).toHaveAttribute('data-stage', '2');
  await panel(page).locator('.dump__input').fill('Weekend chore');
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('.dump-row__input').first()).toHaveValue('Weekend chore');
  await page.locator('#stepper .step').nth(0).click();
  await expect(cell(page, '2026-03-14')).toHaveAttribute('title', 'No tasks yet');
});

test('another tab clearing the saved document empties this one too (cross-tab "clear this device")', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(cell(page, '2026-03-02')).toHaveAttribute('title', '3 of 5 done');
  await page.evaluate((docKey) => {
    localStorage.removeItem(docKey);
    window.dispatchEvent(new StorageEvent('storage', { key: docKey, oldValue: '{}', newValue: null, storageArea: localStorage }));
  }, DOC_KEY);
  await expect(cell(page, '2026-03-02')).toHaveAttribute('title', 'No tasks yet');
  await expect(panel(page).locator('.calendar__day--planned')).toHaveCount(0);
});

test('the "demo version" link loads a local two-month demo', async ({ page }) => {
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');
  await panel(page).locator('.calendar__demo').click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  // The doc is replaced with a rich demo, and past days with completed tasks turn green.
  await expect
    .poll(async () => (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).tasks.length, DOC_KEY)))
    .toBeGreaterThan(20);
  await expect(panel(page).locator('.calendar__day--planned').first()).toBeVisible();
  // Past demo tasks carry tracked time so the Time report has data to show.
  await expect
    .poll(async () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).tasks.filter((t) => t.timer && t.timer.elapsedSec > 0).length, DOC_KEY))
    .toBeGreaterThan(10);
  await panel(page).locator('.calendar__analysis').click();
  await expect(page.locator('[role="dialog"] .analysis__row').first()).toBeVisible();
  await expect(page.locator('[role="dialog"] .analysis__total')).toContainText(':');
});

test('the time report sums tracked time per task, most first', async ({ page }) => {
  const stopwatch = (elapsedSec, stoppedAt) => ({ mode: 'stopwatch', durationSec: 0, startedAt: null, elapsedSec, running: false, stoppedAt });
  const doc = makeDoc();
  doc.tasks = [
    { ...doc.tasks[0], id: 't_a', title: 'Deep work', timer: stopwatch(3600, '2026-03-02T10:00:00.000Z') },
    { ...doc.tasks[0], id: 't_b', title: 'Deep work', date: '2026-03-03', timer: stopwatch(1800, '2026-03-03T10:00:00.000Z') },
    { ...doc.tasks[0], id: 't_c', title: 'Email', timer: stopwatch(600, '2026-03-02T11:00:00.000Z') },
  ];
  await seed(page, { doc });
  await page.goto('/');
  await panel(page).locator('.calendar__analysis').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.locator('.analysis__row')).toHaveCount(2); // "Deep work" aggregated across two days, "Email"
  await expect(dialog.locator('.analysis__row').first()).toContainText('Deep work');
  await expect(dialog.locator('.analysis__row').first()).toContainText('1:30:00'); // 3600 + 1800 s
  await expect(dialog.locator('.analysis__total')).toContainText('1:40:00'); // + 600 s
});

test('Manage mode: flip the calendar, then a day popup adds and deletes tasks', async ({ page }) => {
  await onAWeekday(page);
  await seed(page); // DAYS puts 5 tasks on 2026-03-02
  await page.goto('/');
  await panel(page).locator('.calendar__flip').click();
  await expect(panel(page).locator('.calendar')).toHaveClass(/calendar--flipped/);
  await expect(cell(page, '2026-03-02').locator('.calendar__preview-item').first()).toBeVisible();

  await cell(page, '2026-03-02').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.day-pop__row')).toHaveCount(5);

  await dialog.locator('.day-pop__add-input').fill('New from the popup');
  await dialog.locator('.day-pop__add button[type="submit"]').click();
  await expect(dialog.locator('.day-pop__row')).toHaveCount(6);

  await dialog.locator('.day-pop__row').first().locator('.day-pop__del').click();
  await expect(dialog.locator('.day-pop__row')).toHaveCount(5);
});

test('no stage tip and no "?" button (tips were removed)', async ({ page }) => {
  await seed(page, { doc: makeDoc({ tipSeen: false }) });
  await page.goto('/');
  await expect(panel(page).locator('.bubble')).toHaveCount(0);
  await expect(page.locator('#tip-button')).toHaveCount(0);
});

test('mobile 375px: no horizontal scroll and cells stay ≥ 44px with the full week shown', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 375, height: 760 });
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await expect(cells(page)).toHaveCount(42);
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect((await metrics(page, '2026-03-02')).width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: path.join(OUT, 'calendar-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('desktop screenshot for visual comparison with design/stage1.png', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page, { doc: makeDoc({ tipSeen: false }) });
  await page.goto('/');
  await expect(cells(page)).toHaveCount(42);
  await page.screenshot({ path: path.join(OUT, 'calendar-desktop.png'), fullPage: true });
});
