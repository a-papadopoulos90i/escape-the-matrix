import { test, expect } from 'playwright/test';

const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';

const TITLES = {
  1: /^calendar of the month [A-Z][a-z]+$/,
  2: 'Write down everything you have for today — all of it!',
  3: 'Place them by priority:',
  4: 'Ready to start',
  5: 'fast organize',
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

test('loads with the title, a 5-step stepper and no console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Escape the Matrix');
  await expect(page.locator('#stepper .step')).toHaveCount(5);
  await expect(page.locator('#stepper .step').nth(0)).toHaveAttribute('aria-current', 'step');
  await expect(activeTitle(page)).toHaveText(TITLES[1]);
  await expect(page.locator('#daybar .chip--today')).toHaveText('Today');
  await expect(page.locator('#banner')).toContainText("You're in free mode");
  await expect(page.locator('#account button')).toHaveText('Sign in with Google');
  expect(errors).toEqual([]);
});

test('clicking each stepper step shows the right stage title', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const steps = page.locator('#stepper .step');
  for (const n of [2, 3, 4, 5, 1]) {
    await steps.nth(n - 1).click();
    await expect(activeTitle(page)).toHaveText(TITLES[n]);
    await expect(steps.nth(n - 1)).toHaveAttribute('aria-current', 'step');
    await expect(activePanel(page)).toHaveAttribute('data-stage', String(n));
  }
  await expect(page.locator('#stage .panel--ghost')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Back / Next buttons walk the stages; stage 5 returns to the calendar', async ({ page }) => {
  await page.goto('/');
  await expect(activePanel(page).locator('.stage-nav__back')).toHaveCount(0);
  for (const n of [2, 3, 4, 5]) {
    await activePanel(page).locator('.stage-nav__next').click();
    await expect(activeTitle(page)).toHaveText(TITLES[n]);
    if (n === 2) {
      // Stage 2 only lets Next through once the day has a task (SPEC §2).
      await activePanel(page).locator('.dump-row--blank input').first().fill('Smoke task');
      await page.keyboard.press('Enter');
    }
  }
  await expect(activePanel(page).locator('.stage-nav__next')).toHaveText('Back to calendar');
  await activePanel(page).locator('.stage-nav__next').click();
  await expect(activeTitle(page)).toHaveText(TITLES[1]);
});

test('keyboard arrows and ? drive the shell', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bubble__close').click();
  await page.keyboard.press('ArrowRight');
  await expect(activeTitle(page)).toHaveText(TITLES[2]);
  // → mirrors "Next →", which Stage 2 disables until the day has a task (SPEC §2).
  await page.keyboard.press('ArrowRight');
  await expect(activeTitle(page)).toHaveText(TITLES[2]);
  await activePanel(page).locator('.dump-row--blank input').first().fill('Smoke task');
  await page.keyboard.press('Enter');
  await activeTitle(page).click(); // leave the input so the shortcut is live again
  await page.keyboard.press('ArrowRight');
  await expect(activeTitle(page)).toHaveText(TITLES[3]);
  await page.keyboard.press('ArrowLeft');
  await expect(activeTitle(page)).toHaveText(TITLES[2]);
  await expect(page.locator('.bubble')).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(page.locator('.bubble')).toContainText('Write down everything you have for today — all of it!');
});

test('tips auto-show once per stage, close, and reopen with the ? button', async ({ page }) => {
  await page.goto('/');
  const bubble = page.locator('.bubble');
  await expect(bubble).toHaveCount(1);
  await bubble.locator('.bubble__close').click();
  await expect(bubble).toHaveCount(0);

  await page.locator('#tip-button').click();
  await expect(bubble).toHaveCount(1);

  await page.locator('#stepper .step').nth(1).click();
  await expect(bubble).toHaveText(/Write down everything you have for today — all of it!/);
  await page.locator('#stepper .step').nth(2).click();
  await expect(bubble).toContainText('Organize them by priority:');
  await expect(bubble).toContainText('Not Urgent & Not Important');
  await page.locator('#stepper .step').nth(3).click();
  await expect(bubble).toContainText('Done mark ✅');
  await page.locator('#stepper .step').nth(4).click();
  await expect(bubble).toContainText("send it to the next day's list");

  await page.reload();
  await expect(activeTitle(page)).toHaveText(TITLES[5]);
  await expect(bubble).toHaveCount(0);
});

test('free-mode banner dismissal is remembered', async ({ page }) => {
  await page.goto('/');
  await page.locator('#banner button').click();
  await expect(page.locator('#banner')).toBeHidden();
  await page.reload();
  await expect(activeTitle(page)).toBeVisible();
  await expect(page.locator('#banner')).toBeHidden();
});

test('per-device UI state (stage + selected day) is restored and day arrows move the day', async ({ page }) => {
  await seed(page, {
    ui: { selectedDate: '2026-03-11', stage: 3, calendarMonth: '2026-03' },
    doc: {
      version: 1,
      updatedAt: '2026-03-11T08:00:00.000Z',
      settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: true, 2: true, 3: true, 4: true, 5: true } },
      tasks: [
        { id: 't_a', title: 'A', date: '2026-03-11', quadrant: 'do', order: 1, done: true, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null },
        { id: 't_b', title: 'B', date: '2026-03-11', quadrant: null, order: 2, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null },
      ],
    },
  });
  await page.goto('/');
  await expect(activeTitle(page)).toHaveText(TITLES[3]);
  await expect(page.locator('.daybar__date')).toHaveText('Wednesday, 11 March 2026');
  await expect(page.locator('.daybar__progress')).toContainText('1/2 done');
  await expect(page.locator('.bubble')).toHaveCount(0);

  await page.locator('#daybar [aria-label="Next day"]').click();
  await expect(page.locator('.daybar__date')).toHaveText('Thursday, 12 March 2026');
  await expect(page.locator('.daybar__progress')).toContainText('No tasks yet');
  await page.locator('#daybar [aria-label="Next day"]').click();
  await page.locator('#daybar [aria-label="Next day"]').click();
  await expect(page.locator('.daybar__date')).toHaveText('Monday, 16 March 2026', 'weekends are skipped');

  const ui = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), UI_KEY);
  expect(ui).toEqual({ selectedDate: '2026-03-16', stage: 3, calendarMonth: '2026-03' });
});

test('"Sign in with Google" opens the not-connected modal when firebaseConfig is null', async ({ page }) => {
  await page.goto('/');
  await page.locator('#account button').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toContainText('Google sign-in is not connected yet');
  await expect(dialog.locator('a[href="./SETUP.md"]')).toBeVisible();
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
