import { test } from 'playwright/test';
import path from 'node:path';

// Visual check helper: writes one screenshot per stage (desktop + mobile) so agents can LOOK at
// the result. Output dir: $SCREENSHOT_DIR or tests/test-results/screenshots.
const OUT = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'screenshots');

const SEED = {
  version: 1,
  updatedAt: '2026-03-11T08:00:00.000Z',
  settings: { showWeekends: false, bannerDismissed: false, tipsSeen: { 1: false, 2: false, 3: false, 4: false, 5: false } },
  tasks: [
    { id: 't_1', title: 'Marketing Order A5', date: '2026-03-11', quadrant: 'do', order: 1, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null },
    { id: 't_2', title: 'Invoice Send', date: '2026-03-11', quadrant: 'delegate', order: 2, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null },
    { id: 't_3', title: 'Make - Excel Report', date: '2026-03-11', quadrant: 'plan', order: 3, done: true, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null },
  ],
};

for (const [label, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 375, height: 812 } })) {
  test(`screenshots (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((doc) => localStorage.setItem('escape-the-matrix:v1', JSON.stringify(doc)), SEED);
    await page.addInitScript(() => localStorage.setItem('escape-the-matrix:ui', JSON.stringify({ selectedDate: '2026-03-11', stage: 1, calendarMonth: '2026-03' })));
    await page.goto('/');
    for (let stage = 1; stage <= 5; stage += 1) {
      if (stage > 1) await page.locator('#stepper .step').nth(stage - 1).click();
      await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
      await page.locator('.bubble').first().waitFor({ state: 'attached' });
      await page.screenshot({ path: path.join(OUT, `${label}-stage${stage}.png`), fullPage: true });
    }
  });
}
