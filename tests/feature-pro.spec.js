import { test, expect, asPro } from './fixtures.js';

// Free and Pro (Home → Pricing): on Free the Pro features stay in view, blurred under a "Go Pro" card —
// the task timer, moving a task to another day, the statistics in Done, the Time report and the calendar's
// All Tasks view. Free keeps writing, sorting, finishing and deleting.
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const DAY = '2026-03-11';

const task = (id, title, quadrant, extra = {}) => ({
  id, title, date: DAY, quadrant, order: Number(id.slice(2)), done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null, ...extra,
});
const TASKS = () => [
  task('t_1', 'Marketing Order A5', 'do'),
  task('t_2', 'Invoice Send', 'delegate'),
  task('t_3', 'Old report', 'plan', { done: true, doneAt: '2026-03-11T09:00:00.000Z' }),
];

function seed(page, { stage = 3 } = {}) {
  const doc = {
    version: 1,
    updatedAt: '2026-03-11T08:00:00.000Z',
    settings: { bannerDismissed: true, tipsSeen: { 1: true, 2: true, 3: true, 4: true, 5: true } },
    tasks: TASKS(),
  };
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(uiKey, JSON.stringify({ savedAt: Date.now(), ...ui }));
      localStorage.setItem(docKey, JSON.stringify(doc));
    },
    { uiKey: UI_KEY, docKey: DOC_KEY, ui: { selectedDate: DAY, stage, calendarMonth: DAY.slice(0, 7) }, doc },
  );
}

const panel = (page) => page.locator('#stage .panel:not(.panel--ghost)');
const card = (page, title) => panel(page).locator('.task-card', { hasText: title });
const popover = (page) => page.locator('.popover--task');
const lockCard = (scope) => scope.locator('.pro-lock__card');
/** The plan, switched the way the account's billing switches it when Pro arrives. */
const setPlan = (page, plan) => page.evaluate(async (next) => (await import('/js/plan.js')).setPlan(next), plan);

test('Free: the timer and moving to another day show their options with a Pro lock; pressing one asks to go Pro', async ({ page }) => {
  await seed(page);
  await page.goto('/');

  await card(page, 'Marketing Order A5').locator('.task-card__clock').click();
  const picker = popover(page);
  await expect(picker.locator('.pro-lock__badge')).toHaveText('Pro');
  await expect(picker.locator('.timer-picker__stopwatch')).toBeVisible(); // the options can be seen
  await expect(lockCard(picker)).toBeHidden();
  await picker.locator('.timer-picker__stopwatch').click();
  await expect(lockCard(picker)).toContainText('Go Pro for unlimited access');
  await expect(picker.getByRole('button', { name: 'Go Pro' })).toBeFocused();
  await expect(page.locator('.timer-bar')).toBeHidden(); // nothing started
  await picker.getByRole('button', { name: 'Not now' }).click();
  await expect(lockCard(picker)).toBeHidden();
  await expect(picker.locator('.timer-picker__stopwatch')).toBeVisible();
  await page.keyboard.press('Escape');

  await card(page, 'Marketing Order A5').locator('.task-card__forward').click();
  await expect(picker.locator('.schedule-picker__nextday')).toBeVisible();
  await picker.locator('.schedule-picker__nextday').click();
  await expect(lockCard(picker)).toBeVisible();
  await expect(card(page, 'Marketing Order A5')).toHaveCount(1); // still on this day
  await picker.getByRole('button', { name: 'Go Pro' }).click();
  await expect(popover(page)).toHaveCount(0);
  await expect(panel(page).locator('.home-pricing')).toBeInViewport();

  await page.getByRole('button', { name: /Prioritize/ }).first().click();
  await card(page, 'Invoice Send').locator('.task-card__delete').click();
  await expect(card(page, 'Invoice Send')).toHaveCount(0);
});

test('Free: when Pro arrives, an open locked picker opens for real', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await card(page, 'Marketing Order A5').locator('.task-card__clock').click();
  await expect(popover(page).locator('.pro-lock__badge')).toBeVisible();
  await setPlan(page, 'pro');
  await expect(popover(page).locator('.pro-lock')).toHaveCount(0);
  await popover(page).locator('.timer-picker__stopwatch').click();
  await expect(page.locator('.timer-bar')).toBeVisible();
});

test('Free: Done keeps its list and delete, the counts are locked; the Time report is locked', async ({ page }) => {
  await seed(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Done — your finished tasks' }).click();
  const done = page.getByRole('dialog', { name: 'Done' });
  await expect(done.locator('.pro-lock--compact')).toContainText('Go Pro for unlimited access');
  await expect(done.locator('.pro-lock__content .history__stats')).toHaveCount(1);
  await expect(done.locator('.history__usage')).toBeVisible(); // how much of the 100 is used: Free sees it
  await done.getByRole('button', { name: 'Delete this task: Old report' }).click();
  await expect(done.locator('.history__task')).toHaveCount(0);
  await done.getByRole('button', { name: 'Close' }).last().click();

  await page.getByRole('button', { name: 'Time report' }).click();
  const report = page.getByRole('dialog', { name: 'Time spent per task' });
  await expect(lockCard(report)).toBeVisible();
  await expect(report.locator('.pro-lock__content .analysis__group')).toHaveCount(3); // an example, behind the blur
});

test('Pro: Done shows its counts and the Time report opens', async ({ page }) => {
  await asPro(page);
  await seed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Done — your finished tasks' }).click();
  const done = page.getByRole('dialog', { name: 'Done' });
  await expect(done.locator('.history__stats')).toBeVisible();
  await expect(done.locator('.pro-lock')).toHaveCount(0);
});

test('Free: the calendar turns to All Tasks locked, and the same button turns it back', async ({ page }) => {
  await seed(page, { stage: 1 });
  await page.goto('/');
  const calendar = panel(page).locator('.calendar');
  await calendar.locator('.calendar__flip').click();
  await expect(lockCard(calendar)).toBeVisible();
  await expect(calendar.locator('.calendar__months')).toHaveAttribute('inert', '');
  const box = await lockCard(calendar).boundingBox();
  expect(box.y).toBeLessThan(page.viewportSize().height); // the card is in view, not far down the weeks

  await calendar.locator('.calendar__flip').click();
  await expect(lockCard(calendar)).toHaveCount(0);
  await expect(calendar.locator('.calendar__months')).not.toHaveAttribute('inert', '');
});

test('Pricing: Basic Free, Pro yearly in the middle with its ribbon, Pro monthly with "only €1,20"', async ({ page }) => {
  await page.goto('/');
  await page.locator('.brand').click();
  const plans = panel(page).locator('.home-plan');
  await expect(plans).toHaveCount(3);
  await expect(plans.nth(0).locator('.home-plan__name')).toHaveText('Basic Free');
  await expect(plans.nth(0).locator('.home-plan__features li')).toHaveText(['Up to 100 tasks', 'Calendar, Write down & Prioritize']);
  await expect(plans.nth(1)).toHaveClass(/home-plan--yearly/);
  await expect(plans.nth(1)).toHaveClass(/home-plan--featured/);
  await expect(plans.nth(1).locator('.home-plan__ribbon')).toHaveText('Save 51%');
  await expect(plans.nth(1).locator('.home-plan__badge')).toHaveText('Best value');
  await expect(plans.nth(2)).toHaveClass(/home-plan--monthly/);
  await expect(plans.nth(2).locator('.home-plan__ribbon')).toHaveText('Only €1,20 / week');
  await expect(plans.nth(1).locator('.home-plan__features li')).toContainText(['Unlimited tasks', 'Task timer & time report', 'Move tasks to another day']);
  await expect(panel(page).locator('.home-pricing__vat')).toContainText('include VAT');

  // The ribbon stays inside its card and clear of the plan's name.
  const geometry = await plans.nth(1).evaluate((el) => {
    const cardBox = el.getBoundingClientRect();
    const name = el.querySelector('.home-plan__badge').getBoundingClientRect();
    const ribbon = el.querySelector('.home-plan__ribbon').getBoundingClientRect();
    return { cardRight: cardBox.right, nameRight: name.right, ribbonLeft: ribbon.left };
  });
  expect(geometry.nameRight).toBeLessThan(geometry.ribbonLeft + 30); // the band runs diagonally: its far-left corner is low
});

test('Home says the iPhone and Android apps are coming, under the hero button', async ({ page }) => {
  await page.goto('/');
  await page.locator('.brand').click();
  const apps = panel(page).locator('.home-hero__apps');
  await expect(apps).toHaveText('Coming soon as an app for iPhone and Android');
  await expect(apps).toBeVisible();
});
