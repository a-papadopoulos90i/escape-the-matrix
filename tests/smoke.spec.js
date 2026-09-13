import { test, expect } from 'playwright/test';

const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';

const TITLES = {
  1: 'Pick your day',
  2: 'Write it all down',
  3: 'Place them by priority',
  4: 'Ready to start',
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
      if (ui) localStorage.setItem(uiKey, JSON.stringify(ui));
      if (doc) localStorage.setItem(docKey, JSON.stringify(doc));
    },
    { uiKey: UI_KEY, docKey: DOC_KEY, ui, doc },
  );
}

test('loads with the title, a 4-step stepper and no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Escape the Matrix');
  await expect(page.locator('#stepper .step')).toHaveCount(4);
  await expect(page.locator('#stepper .step').nth(0)).toHaveAttribute('aria-current', 'step');
  await expect(activeTitle(page)).toHaveText(TITLES[1]);
  await expect(page.locator('#banner')).toContainText("You're in free mode");
  await expect(page.locator('#account button')).toHaveText('Sign in with Google');
  expect(errors).toEqual([]);
});

test('clicking the logo returns to the calendar (Stage 1)', async ({ page }) => {
  await page.goto('/');
  await page.locator('#stepper .step').nth(2).click();
  await expect(activePanel(page)).toHaveAttribute('data-stage', '3');
  await page.locator('.brand').click();
  await expect(activePanel(page)).toHaveAttribute('data-stage', '1');
  await expect(activeTitle(page)).toHaveText(TITLES[1]);
});

test('clicking each stepper step shows the right stage title', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const steps = page.locator('#stepper .step');
  for (const n of [2, 3, 4, 1]) {
    await steps.nth(n - 1).click();
    await expect(activeTitle(page)).toHaveText(TITLES[n]);
    await expect(steps.nth(n - 1)).toHaveAttribute('aria-current', 'step');
    await expect(activePanel(page)).toHaveAttribute('data-stage', String(n));
  }
  await expect(page.locator('#stage .panel--ghost')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Back / Next buttons walk the stages; stage 4 returns to the calendar', async ({ page }) => {
  await page.goto('/');
  // Stage 1 has no nav buttons — you enter by picking a day.
  await expect(activePanel(page).locator('.stage-nav')).toHaveCount(0);
  await activePanel(page).locator('.calendar__day').first().click(); // an empty day → Stage 2
  await expect(activeTitle(page)).toHaveText(TITLES[2]);

  // Stage 2 only lets Next through once the day has a task (SPEC §2).
  await activePanel(page).locator('.dump__input').fill('Smoke task');
  await page.keyboard.press('Enter');
  for (const n of [3, 4]) {
    await activePanel(page).locator('.stage-nav__next').click();
    await expect(activeTitle(page)).toHaveText(TITLES[n]);
  }
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
  await page.keyboard.press('ArrowLeft');
  await expect(activeTitle(page)).toHaveText(TITLES[2]);
});

test('no speech-bubble tips and no "?" button (tips were removed)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bubble')).toHaveCount(0);
  await expect(page.locator('#tip-button')).toHaveCount(0);
  for (const n of [2, 3, 4]) {
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
  await page.locator('#stepper .step').nth(3).click();
  await expect(activePanel(page).locator('.task-card')).toContainText(['A']);
});

test('"Sign in with Google" opens the not-connected modal when firebaseConfig is null', async ({ page }) => {
  await page.goto('/');
  await page.locator('#account button').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toContainText('Google sign-in is not connected yet');
  await expect(dialog.locator('a[href="https://github.com/a-papadopoulos90i/escape-the-matrix/blob/main/SETUP.md"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('mobile viewport: no horizontal scroll and the shell stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('#stepper .step').nth(3).click();
  await expect(activeTitle(page)).toHaveText(TITLES[4]);
  await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
  const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowAfter).toBeLessThanOrEqual(0);
});
