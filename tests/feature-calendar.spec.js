import { test, expect } from 'playwright/test';
import path from 'node:path';

// Stage 1 — month calendar. Seeds March 2026 (the design board's month) with tasks on several
// days and checks grid composition, cell states, toggle persistence, navigation and routing.
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const OUT = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'screenshots');

const GREEN = 'rgb(62, 155, 75)';
const GRAY = 'rgb(117, 117, 117)';
const TODAY_BLUE = 'rgb(77, 163, 255)';

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
const weekendSwitch = (page) => panel(page).locator('.switch__input');
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

test('March 2026 renders Mon–Fri, six rows, starting on Mar 2 (SPEC §2 grid rule)', async ({ page }) => {
  const errors = collectErrors(page);
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');

  await expect(title(page)).toHaveText('calendar of the month March');
  await expect(panel(page).locator('.calendar__month')).toHaveText('March 2026');
  await expect(weekdays(page)).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  await expect(cells(page)).toHaveCount(30);

  const keys = await cellKeys(page);
  expect(keys.slice(0, 5)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']);
  expect(keys.slice(20, 25)).toEqual(['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03']);
  expect(keys[29]).toBe('2026-04-10');
  await expect(cells(page).nth(22).locator('.calendar__num')).toHaveText('1');
  await expect(panel(page).locator('.calendar__legend-item')).toHaveText(['green = done tasks, one stripe each (up to 10)', 'blue = today', 'gray = empty']);
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

  const planned = await metrics(page, '2026-03-20');
  expect(planned.borderColor).toBe(GREEN);
  expect(planned.fillHeight).toBeGreaterThanOrEqual(3);
  expect(planned.fillHeight).toBeLessThanOrEqual(6);
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
  // Weekends on so today is visible whatever weekday it is.
  await weekendSwitch(page).check();
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

test('"Show weekends" adds Sat/Sun columns and persists across reload', async ({ page }) => {
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');
  const toggle = weekendSwitch(page);
  await expect(toggle).toHaveAttribute('role', 'switch');
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect(weekdays(page)).toHaveText(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  await expect(cells(page)).toHaveCount(42);
  expect((await cellKeys(page))[0]).toBe('2026-03-01');

  await expect
    .poll(async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DOC_KEY)).settings.showWeekends)
    .toBe(true);
  await page.reload();
  await expect(weekendSwitch(page)).toBeChecked();
  await expect(cells(page)).toHaveCount(42);

  await weekendSwitch(page).uncheck();
  await expect(cells(page)).toHaveCount(30);
  expect((await cellKeys(page))[0]).toBe('2026-03-02');
});

test('‹ › change the displayed month, update the title and persist the month', async ({ page }) => {
  await onAWeekday(page);
  await seed(page);
  await page.goto('/');
  const next = panel(page).locator('[aria-label="Next month"]');
  const prev = panel(page).locator('[aria-label="Previous month"]');

  await next.click();
  await expect(title(page)).toHaveText('calendar of the month April');
  await expect(panel(page).locator('.calendar__month')).toHaveText('April 2026');
  expect((await cellKeys(page))[0]).toBe('2026-03-30');
  await expect(panel(page).locator('.calendar__day--planned')).toHaveCount(0);

  await prev.click();
  await prev.click();
  await expect(title(page)).toHaveText('calendar of the month February');
  expect((await cellKeys(page))[0]).toBe('2026-02-02', '1 Feb 2026 is a hidden Sunday → start on Monday the 2nd');

  const ui = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY);
  expect(ui.calendarMonth).toBe('2026-02');
  await page.reload();
  await expect(title(page)).toHaveText('calendar of the month February');
});

test('clicking an empty day opens Stage 2, a day with tasks opens Stage 4', async ({ page }) => {
  await seed(page);
  await page.goto('/');

  await cell(page, '2026-03-12').click();
  await expect(panel(page)).toHaveAttribute('data-stage', '2');
  await expect(page.locator('.daybar__date')).toHaveText('Thursday, 12 March 2026');

  await page.locator('#stepper .step').nth(0).click();
  await expect(panel(page)).toHaveAttribute('data-stage', '1');
  await expect(panel(page).locator('.calendar__day--selected')).toHaveAttribute('data-key', '2026-03-12');

  await cell(page, '2026-03-02').click();
  await expect(panel(page)).toHaveAttribute('data-stage', '4');
  await expect(page.locator('.daybar__date')).toHaveText('Monday, 2 March 2026');
  await expect(page.locator('.daybar__progress')).toContainText('3/5 done');
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
  await expect(cell(page, '2026-04-10')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, '2026-04-10')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cell(page, '2026-03-02')).toBeFocused();
  await expect(panel(page)).toHaveAttribute('data-stage', '1');

  await page.keyboard.press('Enter');
  await expect(panel(page)).toHaveAttribute('data-stage', '4');
  await expect(page.locator('.daybar__date')).toHaveText('Monday, 2 March 2026');
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
    { docKey: DOC_KEY, doc: { ...makeDoc(), tasks: tasksFor({ '2026-03-02': [5, 5], '2026-03-16': [1, 0] }) } },
  );
  await expect(cell(page, '2026-03-02')).toHaveAttribute('title', '5 of 5 done');
  expect((await metrics(page, '2026-03-02')).ratio).toBeCloseTo(0.5, 1);
  await expect(cell(page, '2026-03-16')).toHaveClass(/calendar__day--planned/);
  await expect(cell(page, '2026-03-05')).toHaveAttribute('title', 'No tasks yet');
});

test('on a weekend, weekends are shown (with a note) so today is outlined and reachable; the setting stays off', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 2, 14, 9, 0, 0)); // Saturday 14 March 2026
  await seed(page, { ui: { selectedDate: '2026-03-14', stage: 1, calendarMonth: '2026-03' } });
  await page.goto('/');
  await expect(weekdays(page)).toHaveCount(7);
  await expect(weekendSwitch(page)).not.toBeChecked();
  await expect(panel(page).locator('.calendar__note')).toHaveText('Today is Saturday, so weekends are shown.');
  const today = panel(page).locator('.calendar__day--today');
  await expect(today).toHaveAttribute('data-key', '2026-03-14');
  expect((await metrics(page, '2026-03-14')).borderColor).toBe(TODAY_BLUE);
  await panel(page).locator('.calendar__today').click();
  await expect(today).toBeFocused();
  await expect(page.locator('#daybar .chip--today')).toHaveText('Today');

  // The day-bar arrows walk through the weekend too.
  await page.locator('#daybar [aria-label="Previous day"]').click();
  await expect(page.locator('.daybar__date')).toHaveText('Friday, 13 March 2026');
  await page.locator('#daybar [aria-label="Next day"]').click();
  await expect(page.locator('.daybar__date')).toHaveText('Saturday, 14 March 2026');

  // Tasks written for Saturday show up on its cell.
  await cell(page, '2026-03-14').click();
  await expect(panel(page)).toHaveAttribute('data-stage', '2');
  await panel(page).locator('.dump-row--blank input').first().fill('Weekend chore');
  await page.keyboard.press('Enter');
  await page.locator('#stepper .step').nth(0).click();
  await expect(cell(page, '2026-03-14')).toHaveClass(/calendar__day--planned/);
  await expect(panel(page).locator('.calendar__note')).toBeVisible();
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

test('stage tip shows on first visit, anchored inside the panel', async ({ page }) => {
  await seed(page, { doc: makeDoc({ tipSeen: false }) });
  await page.goto('/');
  const bubble = panel(page).locator('.bubble');
  await expect(bubble).toContainText('Pick a day to plan');
  await bubble.locator('.bubble__close').click();
  await expect(bubble).toHaveCount(0);
});

test('mobile 375px: no horizontal scroll and cells stay ≥ 44px, with and without weekends', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 375, height: 760 });
  await seed(page);
  await page.goto('/');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  expect(await overflow()).toBeLessThanOrEqual(0);
  expect((await metrics(page, '2026-03-02')).width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: path.join(OUT, 'calendar-mobile.png'), fullPage: true });

  await weekendSwitch(page).check();
  await expect(cells(page)).toHaveCount(42);
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect((await metrics(page, '2026-03-02')).width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: path.join(OUT, 'calendar-mobile-weekends.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('desktop screenshots for visual comparison with design/stage1.png', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page, { doc: makeDoc({ tipSeen: false }) });
  await page.goto('/');
  await expect(panel(page).locator('.bubble')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'calendar-desktop-tip.png'), fullPage: true });
  await panel(page).locator('.bubble__close').click();
  await page.screenshot({ path: path.join(OUT, 'calendar-desktop.png'), fullPage: true });
  await weekendSwitch(page).check();
  await expect(cells(page)).toHaveCount(42);
  await page.screenshot({ path: path.join(OUT, 'calendar-desktop-weekends.png'), fullPage: true });
});
