import { test, expect } from 'playwright/test';
import path from 'node:path';

// Stage 2 (brain dump) and Stage 3 (place by priority) — behaviour, persistence, every placement
// path (mouse drag, touch drag, tap-to-place, keyboard, menu) and design screenshots.
const UI_KEY = 'escape-the-matrix:ui';
const DOC_KEY = 'escape-the-matrix:v1';
const DATE = '2026-03-11';
const OUT = process.env.SCREENSHOT_DIR ?? path.join(process.cwd(), 'test-results', 'screenshots');

const TITLES = ['Marketing Order A5', 'Invoice Send', 'Make - Excel Report', 'Call the bank'];

const panel = (page) => page.locator('#stage .panel:not(.panel--ghost)');
const pileCards = (page) => panel(page).locator('.sort__pile .sort-card');
const quadrantCards = (page, q) => panel(page).locator(`.quadrant--${q} .sort-card`);
const cardByTitle = (page, title) => panel(page).locator('.sort-card', { hasText: title });

function doc(tasks, { tipsSeen = true } = {}) {
  return {
    version: 1,
    updatedAt: '2026-03-11T08:00:00.000Z',
    settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: tipsSeen, 2: tipsSeen, 3: tipsSeen, 4: tipsSeen, 5: tipsSeen } },
    tasks: tasks.map((title, i) => ({ id: `t_${i}`, title, date: DATE, quadrant: null, order: i + 1, done: false, doneAt: null, createdAt: 'x', updatedAt: 'x', timer: null })),
  };
}

function seed(page, { stage, tasks = [], tipsSeen = true }) {
  return page.addInitScript(
    ({ uiKey, docKey, ui, doc }) => {
      if (sessionStorage.getItem('seeded')) return; // init scripts re-run on reload: seed once per tab
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(uiKey, JSON.stringify(ui));
      localStorage.setItem(docKey, JSON.stringify(doc));
    },
    { uiKey: UI_KEY, docKey: DOC_KEY, ui: { selectedDate: DATE, stage, calendarMonth: '2026-03' }, doc: doc(tasks, { tipsSeen }) },
  );
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
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

const storedTasks = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).tasks, DOC_KEY);
const inputValues = (locator) => locator.evaluateAll((inputs) => inputs.map((input) => input.value));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---------- Stage 2 ----------

test('stage 2: rows are created by typing, edited inline, deleted with undo, and persist', async ({ page }) => {
  const errors = collectErrors(page);
  await seed(page, { stage: 2 });
  await page.goto('/');

  const title = panel(page).locator('.stage-title');
  await expect(title).toHaveText('Write down everything you have for today — all of it!');
  const accent = title.locator('.stage-title__accent');
  await expect(accent).toHaveCSS('color', 'rgb(209, 62, 56)');
  await expect(accent).toHaveCSS('font-weight', '700');
  await expect(panel(page).locator('.stage-subtitle')).toHaveText('Wednesday, 11 March 2026');
  await expect(panel(page).locator('.matrix--faded .quadrant')).toHaveCount(4);
  const blanks = panel(page).locator('.dump-row--blank input');
  await expect(blanks).toHaveCount(2);
  await expect(blanks.first()).toHaveAttribute('placeholder', '......');
  const next = panel(page).locator('.stage-nav__next');
  await expect(next).toBeDisabled();

  // Type three tasks, Enter after each: the row commits and stays focused for the next one.
  await blanks.first().click();
  for (const text of TITLES.slice(0, 3)) {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }
  const rows = panel(page).locator('.dump-row:not(.dump-row--blank)');
  await expect(rows).toHaveCount(3);
  await expect.poll(() => inputValues(rows.locator('input'))).toEqual(TITLES.slice(0, 3));
  await expect(blanks.first()).toBeFocused();
  await expect(blanks.first()).toHaveValue('');
  await expect(next).toBeEnabled();

  // "+" adds a third placeholder row and focuses it; Escape discards it again.
  await panel(page).locator('.dump__add').click();
  await expect(blanks).toHaveCount(3);
  await expect(blanks.nth(2)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(blanks).toHaveCount(2);

  // Inline edit of an existing row.
  await rows.nth(1).locator('input').fill('Invoice Send (edited)');
  await page.keyboard.press('Enter');
  await expect(rows.nth(2).locator('input')).toBeFocused();
  await expect.poll(async () => (await storedTasks(page)).map((task) => task.title)).toContain('Invoice Send (edited)');

  // ✕ deletes with an Undo toast.
  await rows.nth(0).hover();
  await rows.nth(0).locator('.dump-row__delete').click();
  await expect(rows).toHaveCount(2);
  await page.locator('.toast__action', { hasText: 'Undo' }).click();
  await expect(rows).toHaveCount(3);

  await page.reload();
  await expect.poll(() => inputValues(panel(page).locator('.dump-row:not(.dump-row--blank) input'))).toEqual([TITLES[0], 'Invoice Send (edited)', TITLES[2]]);
  await expect(panel(page).locator('.stage-nav__next')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('stage 2: unsaved text in a placeholder row is kept when leaving the stage', async ({ page }) => {
  await seed(page, { stage: 2 });
  await page.goto('/');
  await panel(page).locator('.dump-row--blank input').first().fill('Typed but not entered');
  await expect(panel(page).locator('.stage-nav__next')).toBeDisabled(); // nothing committed yet
  await page.locator('#stepper .step').nth(2).click();
  await expect(panel(page).locator('.stage-title')).toHaveText('Place them by priority:');
  await expect(pileCards(page)).toHaveText(['Typed but not entered']);
});

// ---------- Stage 3 ----------

test.describe('stage 3 (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test('stage 3: mouse drag into each quadrant, re-drag, "All placed" and the Next label', async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { stage: 3, tasks: TITLES });
    await page.goto('/');

    await expect(panel(page).locator('.sort__bullets li')).toHaveText(['URGENT', 'NOT URGENT', 'IMPORTANT', 'NOT IMPORTANT']);
    await expect(panel(page).locator('.sort__axis--x')).toHaveText(/URGENT.*NOT URGENT/);
    await expect(panel(page).locator('.sort__axis--y')).toHaveText(/IMPORTANT.*NOT IMPORTANT/);
    await expect(panel(page).locator('.quadrant__label')).toHaveCount(0);
    await expect(pileCards(page)).toHaveCount(4);
    const next = panel(page).locator('.stage-nav__next');
    await expect(next).toHaveText('Next (4 waiting) →');

    const quadrants = ['do', 'plan', 'delegate', 'delete'];
    for (const [i, q] of quadrants.entries()) {
      const card = pileCards(page).first();
      const target = panel(page).locator(`.quadrant--${q}`);
      await mouseDrag(page, await centre(card), await centre(target));
      await expect(page.locator('.sort-ghost')).toHaveCount(1);
      await expect(target).toHaveClass(/is-drop-target/);
      await page.mouse.up();
      await expect(page.locator('.sort-ghost')).toHaveCount(0);
      await expect(target).not.toHaveClass(/is-drop-target/);
      await expect(quadrantCards(page, q)).toHaveText([TITLES[i]]);
      await expect(pileCards(page)).toHaveCount(3 - i);
    }
    await expect(panel(page).locator('.sort__done')).toHaveText('All placed ✓');
    await expect(next).toHaveText('Next →');
    await expect(panel(page).locator('.task-card--selected')).toHaveCount(0);

    // A placed card can be dragged again.
    await mouseDrag(page, await centre(quadrantCards(page, 'do').first()), await centre(panel(page).locator('.quadrant--delete')));
    await page.mouse.up();
    await expect(quadrantCards(page, 'do')).toHaveCount(0);
    await expect(quadrantCards(page, 'delete')).toHaveText([TITLES[0], TITLES[3]]); // creation order

    // Dropping outside any quadrant leaves the card where it was.
    await mouseDrag(page, await centre(quadrantCards(page, 'plan').first()), { x: 5, y: 5 });
    await page.mouse.up();
    await expect(quadrantCards(page, 'plan')).toHaveText([TITLES[1]]);

    await expect
      .poll(async () => Object.fromEntries((await storedTasks(page)).map((task) => [task.title, task.quadrant])))
      .toEqual({ [TITLES[0]]: 'delete', [TITLES[1]]: 'plan', [TITLES[2]]: 'delegate', [TITLES[3]]: 'delete' });
    expect(errors).toEqual([]);
  });

  test('stage 3: tap-to-place, keyboard 1–4, the "Place in" menu and Escape', async ({ page }) => {
    await seed(page, { stage: 3, tasks: TITLES });
    await page.goto('/');

    // Tap-to-place: select, then click a quadrant.
    const first = cardByTitle(page, TITLES[0]);
    await first.locator('.sort-card__grab').click();
    await expect(first).toHaveClass(/task-card--selected/);
    await expect(first.locator('.sort-card__grab')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).locator('.sort')).toHaveClass(/sort--selecting/);
    await panel(page).locator('.quadrant--plan').click({ position: { x: 20, y: 20 } });
    await expect(quadrantCards(page, 'plan')).toHaveText([TITLES[0]]);
    await expect(panel(page).locator('.task-card--selected')).toHaveCount(0);
    await expect(panel(page).locator('[aria-live="polite"]').last()).toHaveText('Placed in Important but Not Urgent');

    // Clicking a quadrant with nothing selected does nothing; Escape clears a selection.
    await panel(page).locator('.quadrant--do').click({ position: { x: 20, y: 20 } });
    await expect(pileCards(page)).toHaveCount(3);
    await pileCards(page).first().locator('.sort-card__grab').click();
    await page.keyboard.press('Escape');
    await expect(panel(page).locator('.task-card--selected')).toHaveCount(0);

    // Keyboard: focus a pile card, press 3 → delegate, focus flows to the next pile card; 4 → delete.
    await pileCards(page).first().locator('.sort-card__grab').focus();
    await page.keyboard.press('3');
    await expect(quadrantCards(page, 'delegate')).toHaveText([TITLES[1]]);
    await expect(pileCards(page).first().locator('.sort-card__grab')).toBeFocused();
    await page.keyboard.press('4');
    await expect(quadrantCards(page, 'delete')).toHaveText([TITLES[2]]);
    await expect(pileCards(page)).toHaveText([TITLES[3]]);

    // "Place in ▾" menu on the last pile card.
    await pileCards(page).first().locator('.sort-card__menu').click();
    const menu = page.locator('[role="menu"]');
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['1. Urgent & Important', '2. Important but Not Urgent', '3. Urgent but Not Important', '4. Not Urgent & Not Important', 'Waiting list']);
    await expect(menu.locator('[role="menuitem"]', { hasText: 'Waiting list' })).toBeDisabled();
    await menu.locator('[role="menuitem"]', { hasText: 'Urgent & Important' }).first().click();
    await expect(quadrantCards(page, 'do')).toHaveText([TITLES[3]]);
    await expect(panel(page).locator('.sort__done')).toBeVisible();

    // Menu on a placed card can send it back to the pile.
    await quadrantCards(page, 'do').first().locator('.sort-card__menu').click();
    await page.locator('[role="menuitem"]', { hasText: 'Waiting list' }).click();
    await expect(pileCards(page)).toHaveText([TITLES[3]]);
    await expect(panel(page).locator('.stage-nav__next')).toHaveText('Next (1 waiting) →');
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1100 } });

  test('stage 3: a finger drag (touch pointer events) places a card', async ({ page }) => {
    await seed(page, { stage: 3, tasks: TITLES.slice(0, 2) });
    await page.goto('/');
    const card = pileCards(page).first();
    const target = panel(page).locator('.quadrant--delegate');
    const from = await centre(card);
    const to = await centre(target);
    const types = [];
    await page.exposeFunction('recordPointerType', (type) => types.push(type));
    await page.evaluate(() => document.addEventListener('pointerdown', (event) => window.recordPointerType(event.pointerType), true));

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await page.waitForTimeout(350); // a touch drag starts with a short press
    for (let step = 1; step <= 8; step += 1) {
      const x = from.x + ((to.x - from.x) * step) / 8;
      const y = from.y + ((to.y - from.y) * step) / 8;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await expect(page.locator('.sort-ghost')).toHaveCount(1);
    await expect(target).toHaveClass(/is-drop-target/);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(quadrantCards(page, 'delegate')).toHaveText([TITLES[0]]);
    await expect(page.locator('.sort-ghost')).toHaveCount(0);
    expect(types).toEqual(['touch']);
  });

  test('stage 3: tap-to-place with the touchscreen', async ({ page }) => {
    await seed(page, { stage: 3, tasks: TITLES.slice(0, 1) });
    await page.goto('/');
    const card = pileCards(page).first();
    const { x, y } = await centre(card.locator('.sort-card__grab'));
    await page.touchscreen.tap(x, y);
    await expect(card).toHaveClass(/task-card--selected/);
    const box = await panel(page).locator('.quadrant--do').boundingBox();
    await page.touchscreen.tap(box.x + 30, box.y + 30);
    await expect(quadrantCards(page, 'do')).toHaveText([TITLES[0]]);
  });
});

test.describe('mobile', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 740 } });

  test('375px: stages 2 and 3 have no horizontal scroll; a touch drag still places a card', async ({ page }) => {
    await seed(page, { stage: 2, tasks: TITLES.slice(0, 3) });
    await page.goto('/');
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await expect(panel(page).locator('.dump-row:not(.dump-row--blank)')).toHaveCount(3);

    await page.locator('#stepper .step').nth(2).click();
    await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await expect(panel(page).locator('.quadrant__caption').first()).toBeVisible();

    const target = panel(page).locator('.quadrant--do');
    await target.scrollIntoViewIfNeeded();
    const from = await centre(pileCards(page).first());
    const to = await centre(target);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await page.waitForTimeout(350); // a touch drag starts with a short press
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * step) / 8, y: from.y + ((to.y - from.y) * step) / 8 }] });
    }
    await expect(target).toHaveClass(/is-drop-target/);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(quadrantCards(page, 'do')).toHaveText([TITLES[0]]);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('375px: a plain swipe over a full pile scrolls the page instead of lifting a card', async ({ page }) => {
    const many = Array.from({ length: 25 }, (_, i) => `Task number ${i + 1}`);
    await seed(page, { stage: 3, tasks: many });
    await page.goto('/');
    await expect(pileCards(page)).toHaveCount(25);
    const pile = panel(page).locator('.sort__pile');
    await pile.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    const from = await centre(pileCards(page).nth(8));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let step = 1; step <= 8; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y - step * 30 }] });
    }
    await expect(page.locator('.sort-ghost')).toHaveCount(0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    await expect(pileCards(page)).toHaveCount(25);
  });
});

test.describe('tips over the board (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test('stage 3: the tip does not block a drop or a tap under it', async ({ page }) => {
    await seed(page, { stage: 3, tasks: TITLES.slice(0, 2), tipsSeen: false });
    await page.goto('/');
    const tip = page.locator('.bubble');
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    const under = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const targetQuadrant = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.quadrant')?.dataset.quadrant ?? null, under);
    expect(targetQuadrant).not.toBeNull(); // the bubble lets pointer input through

    await mouseDrag(page, await centre(pileCards(page).first()), under);
    await expect(panel(page).locator(`.quadrant--${targetQuadrant}`)).toHaveClass(/is-drop-target/);
    await page.mouse.up();
    await expect(quadrantCards(page, targetQuadrant)).toHaveText([TITLES[0]]);

    await pileCards(page).first().locator('.sort-card__grab').click();
    await page.mouse.click(under.x, under.y);
    await expect(quadrantCards(page, targetQuadrant)).toHaveText([TITLES[0], TITLES[1]]);
    await expect(tip).toBeVisible();
    await tip.locator('.bubble__close').click();
    await expect(tip).toHaveCount(0);
  });
});

// ---------- Screenshots (with the tip bubbles, like the design board) ----------

for (const [label, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 375, height: 760 } })) {
  test(`screenshots (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, { stage: 2, tasks: TITLES.slice(0, 3), tipsSeen: false });
    await page.goto('/');
    await page.locator('.bubble').waitFor({ state: 'attached' });
    await page.screenshot({ path: path.join(OUT, `${label}-stage2.png`), fullPage: true });
    await page.locator('#stepper .step').nth(2).click();
    await page.locator('#stage .panel--ghost').waitFor({ state: 'detached' });
    await page.locator('.bubble').waitFor({ state: 'attached' });
    await page.screenshot({ path: path.join(OUT, `${label}-stage3.png`), fullPage: true });
    await page.locator('.bubble__close').click();
    await mouseDrag(page, await centre(pileCards(page).first()), await centre(panel(page).locator('.quadrant--do')));
    await page.mouse.up();
    await mouseDrag(page, await centre(pileCards(page).first()), await centre(panel(page).locator('.quadrant--delegate')));
    await page.mouse.up();
    await pileCards(page).first().locator('.sort-card__grab').click();
    await page.screenshot({ path: path.join(OUT, `${label}-stage3-placed.png`), fullPage: true });
  });
}
