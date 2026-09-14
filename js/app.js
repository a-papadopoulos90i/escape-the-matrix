// App shell: boots the store with the local adapter, renders header/stepper/banner,
// routes between the four stage panels (slide + fade), shows the per-stage tip bubbles and wires
// keyboard shortcuts. Stage modules only ever see the `ctx` object built in makeCtx().
import { createStore } from './store.js';
import { createLocalAdapter } from './storage/local.js';
import * as dates from './dates.js';
import * as ui from './ui.js';
import * as i18n from './i18n.js';
import { openTimeReport } from './report.js';
import * as home from './stages/home.js';
import * as calendar from './stages/calendar.js';
import * as dump from './stages/dump.js';
import * as board from './stages/board.js';
import { init as initTimer } from './timer.js';

const { t } = i18n;
const STAGE_COUNT = 3;
// One themed icon per stage: calendar → note-keeping → organizing (the 2×2 matrix).
const STEP_ICONS = ['calendar', 'pencil', 'grid'];
// Stage 0 is Home, opened from the logo; it is not one of the stepper tabs.
const HOME = 0;
const STAGE_MODULES = { [HOME]: home, 1: calendar, 2: dump, 3: board };
const REPORT_STAGES = [2, 3]; // Write down + Prioritize show the fixed Time report button
// Each stage's bubbles come from i18n.tips with their default tone/tail; a stage may override
// those via data-tip-tone / data-tip-tail on its [data-tip-anchor] element. A bubble that is
// not anchored sits under the stage header — which is also where every tip goes on narrow
// screens, where an anchored bubble would cover the title, the bullet list or the very cards it
// explains.
const TRANSITION_FALLBACK_MS = 350;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const narrowScreen = window.matchMedia('(max-width: 639px)');
const local = createLocalAdapter();
let store;
const els = {};
const state = {
  stage: 1,
  selectedDate: dates.todayKey(),
  calendarMonth: dates.monthOfKey(dates.todayKey()),
  signedIn: false,
  mounted: null, // { stage, module, panel }
  tips: [], // open bubbles of the mounted stage
};

// ---------- UI state (per device) ----------

function restoreUiState() {
  const saved = local.loadUi();
  const stage = Number(saved.stage);
  if (Number.isInteger(stage) && stage >= HOME) state.stage = Math.min(stage, STAGE_COUNT); // older saves may point at a stage that no longer exists
  if (dates.isValidKey(saved.selectedDate)) state.selectedDate = saved.selectedDate;
  state.calendarMonth = dates.isValidMonthKey(saved.calendarMonth) ? saved.calendarMonth : dates.monthOfKey(state.selectedDate);
}

function persistUiState() {
  local.saveUi({ selectedDate: state.selectedDate, stage: state.stage, calendarMonth: state.calendarMonth });
}

// ---------- Header ----------

function stageLabel(stage) {
  return stage === HOME ? t('home.label') : t('app.stageLabel', { n: stage, label: i18n.stepperLabel(stage) });
}

function renderBrand() {
  els.brand?.setAttribute('aria-current', state.stage === HOME ? 'page' : 'false');
  // One app-level Time report button after the stage: always last, under every task, on both pages.
  els.reportButton.hidden = !REPORT_STAGES.includes(state.stage);
}

function renderStepper() {
  const items = [];
  for (let n = 1; n <= STAGE_COUNT; n += 1) {
    const isCurrent = n === state.stage;
    const isDone = n < state.stage;
    items.push(
      ui.h(
        'li',
        { class: `stepper__item ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`.trim() },
        ui.h(
          'button',
          {
            class: `step ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`.trim(),
            type: 'button',
            'aria-current': isCurrent ? 'step' : null,
            'aria-label': stageLabel(n),
            onClick: () => goTo(n),
          },
          ui.h('span', { class: 'step__dot', 'aria-hidden': 'true' }, ui.icon(STEP_ICONS[n - 1], { size: 18 })),
          ui.h('span', { class: 'step__label', 'aria-hidden': 'true' }, i18n.stepperLabel(n)),
        ),
      ),
    );
  }
  els.stepper.replaceChildren(...items);
}

function renderBanner() {
  const show = !state.signedIn && !store.get().settings.bannerDismissed;
  if (els.banner.hidden === !show) return;
  els.banner.hidden = !show;
  if (!show) return;
  els.banner.replaceChildren(
    ui.h(
      'div',
      { class: 'banner__inner' },
      ui.h('p', { class: 'banner__text' }, t('banner.text')),
      ui.h('button', { class: 'btn btn-sm', type: 'button', onClick: () => store.setSetting('bannerDismissed', true) }, t('banner.dismiss')),
    ),
  );
}

// ---------- Selected day ----------

function setDate(key) {
  if (!dates.isValidKey(key) || key === state.selectedDate) return;
  state.selectedDate = key;
  state.calendarMonth = dates.monthOfKey(key);
  persistUiState();
  // On the day-specific stages (write-down / prioritize / ready) the in-nav day switcher changes
  // the day in place, so re-mount the open stage for the new day. Stage 1 (calendar) manages itself.
  if (state.stage !== 1) mountStage(state.stage, null);
}

function setCalendarMonth(monthKey) {
  if (!dates.isValidMonthKey(monthKey)) return;
  state.calendarMonth = monthKey;
  persistUiState();
}

// ---------- Tips ----------

function tipContent(spec) {
  if (spec.items) {
    return ui.h(
      'div',
      null,
      ui.h('p', { class: 'bubble__title' }, spec.title),
      ui.h('ul', { class: 'bubble__list' }, spec.items.map((item) => ui.h('li', null, item))),
    );
  }
  if (spec.html) return ui.h('span', { html: spec.html });
  return ui.h('span', null, spec.text);
}

function closeTip() {
  for (const tip of state.tips) tip.close();
  state.tips = [];
}

/**
 * Shows the stage's bubbles (stage 4 has two). A bubble marked `anchored` — or the only bubble
 * of a stage — points at the stage's [data-tip-anchor] element when there is one and the screen
 * is wide; every other bubble sits in-flow under the stage header, in order. `focus` moves
 * keyboard focus into the first one (when the user asked for it).
 */
function showTip(stage = state.stage, { focus = false } = {}) {
  closeTip();
  const specs = i18n.tips[stage];
  const panel = state.mounted?.panel;
  if (!specs?.length || !panel || state.mounted.stage !== stage) return;
  const anchorEl = panel.querySelector('[data-tip-anchor]');
  const flow = [];
  for (const spec of specs) {
    const wantsAnchor = Boolean(anchorEl) && (spec.anchored === true || specs.length === 1);
    const anchor = wantsAnchor && !narrowScreen.matches ? anchorEl : null;
    const tip = ui.bubble({
      content: tipContent(spec),
      tone: (wantsAnchor && anchorEl.dataset.tipTone) || spec.tone,
      tail: anchor ? anchor.dataset.tipTail || spec.tail : 'bottom',
      anchor: anchor ?? undefined,
      within: panel,
      onClose: () => {
        state.tips = state.tips.filter((open) => open !== tip);
      },
    });
    if (!anchor) flow.push(tip.el);
    state.tips.push(tip);
  }
  if (flow.length) {
    const slot = panel.querySelector('[data-tip-slot]') ?? panel.querySelector('.stage-header') ?? panel;
    slot === panel ? panel.prepend(...flow) : slot.after(...flow);
  }
  if (focus) state.tips[0]?.el.focus({ preventScroll: true });
}

function autoShowTip(stage) {
  const { tipsSeen } = store.get().settings;
  if (tipsSeen[stage] || state.mounted?.stage !== stage) return;
  showTip(stage);
  store.setSetting('tipsSeen', { ...tipsSeen, [stage]: true });
}

// ---------- Stage routing ----------

function makeCtx(stage) {
  return {
    store,
    ui,
    dates,
    i18n,
    stage,
    getDate: () => state.selectedDate,
    setDate,
    getCalendarMonth: () => state.calendarMonth,
    setCalendarMonth,
    goTo,
    // A day opened from the flipped calendar's popup: Back / Back to calendar return to it, still flipped.
    markFlipReturn: () => {
      state.flipReturn = true;
    },
    returnsToFlippedCalendar: () => Boolean(state.flipReturn),
    takeFlipReturn: () => {
      const flip = Boolean(state.flipReturn);
      state.flipReturn = false;
      return flip;
    },
    showTip: () => showTip(state.stage, { focus: true }),
  };
}

/** Runs a CSS animation class on `el`, then `done()` (fallback timer covers lost events). */
function animate(el, className, done) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    el.classList.remove(className);
    done?.();
  };
  el.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, TRANSITION_FALLBACK_MS);
  el.classList.add(className);
}

/** Unmounts the current stage; with a direction its panel is snapshotted and slid out. */
function retireCurrentPanel(direction) {
  const current = state.mounted;
  if (!current) return;
  closeTip();
  state.mounted = null;
  const animated = direction && !reduceMotion.matches;
  const ghost = animated ? current.panel.cloneNode(true) : null;
  current.module.unmount();
  if (!ghost) return current.panel.remove();
  ghost.classList.remove('panel--enter-forward', 'panel--enter-back'); // may still be entering
  ghost.classList.add('panel--ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  current.panel.replaceWith(ghost);
  animate(ghost, `panel--exit-${direction}`, () => ghost.remove());
}

function mountStage(stage, direction) {
  retireCurrentPanel(direction);
  const panel = ui.h('section', { class: 'panel', 'aria-label': stageLabel(stage), dataset: { stage } });
  els.stage.append(panel);
  const module = STAGE_MODULES[stage];
  state.mounted = { stage, module, panel };
  module.mount(panel, makeCtx(stage));
  if (direction && !reduceMotion.matches) animate(panel, `panel--enter-${direction}`, () => autoShowTip(stage));
  else autoShowTip(stage);
}

function goTo(stage) {
  const next = Number(stage);
  if (!Number.isInteger(next) || next < HOME || next > STAGE_COUNT || next === state.stage) return;
  if (next !== 1) state.flipReturn = false; // going anywhere but the calendar ends the "back to the flipped calendar" route
  const direction = next > state.stage ? 'forward' : 'back';
  state.stage = next;
  persistUiState();
  renderStepper();
  renderBrand();
  mountStage(next, direction);
  // The user was at the bottom of the previous stage ("Next →"): start the new one at its top,
  // and move keyboard focus to its title so Tab continues inside the stage, not from the header.
  window.scrollTo({ top: 0, behavior: 'auto' });
  state.mounted.panel.querySelector('.stage-title')?.focus({ preventScroll: true });
  els.announcer.textContent = next === HOME ? t('home.label') : t('app.stageAnnounce', { n: next, label: i18n.stepperLabel(next) });
}

// ---------- Keyboard ----------

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** The → key mirrors the panel's "Next →" button, so it is ignored while that button is disabled. */
function nextBlocked() {
  return state.mounted?.panel.querySelector('.stage-nav__next')?.disabled === true;
}

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTyping(event.target) || ui.hasOpenOverlay()) return;
    if (event.key === 'ArrowLeft' && state.stage > 1) goTo(state.stage - 1);
    else if (event.key === 'ArrowRight' && !nextBlocked()) goTo(state.stage < STAGE_COUNT ? state.stage + 1 : 1);
    else return;
    event.preventDefault();
  });
}

// ---------- Auth (optional module) ----------

function setSignedIn(signedIn) {
  state.signedIn = Boolean(signedIn);
  document.body.classList.toggle('is-signed-in', state.signedIn); // e.g. hides the calendar's example link
  renderBanner();
}

async function initAuth() {
  try {
    const module = await import('./auth.js');
    if (typeof module.initAuth === 'function') {
      await module.initAuth({ store, ui, i18n, slot: els.account, setSignedIn });
    }
  } catch (error) {
    console.error('Account module failed to load; continuing in free mode.', error);
  }
}

// ---------- Boot ----------

async function boot() {
  Object.assign(els, {
    stepper: document.getElementById('stepper'),
    stepperNav: document.getElementById('stepper-nav'),
    banner: document.getElementById('banner'),
    stage: document.getElementById('stage'),
    account: document.getElementById('account'),
    headerActions: document.querySelector('.header-actions'),
    announcer: document.getElementById('announcer'),
    skipLink: document.getElementById('skip-link'),
    brand: document.querySelector('.brand'),
  });

  store = createStore(await local.load());
  store.attach(local);
  initTimer({ store }); // the floating timer bar lives at document level, whatever stage is open
  store.onError(() => ui.toast(t('toast.saveFailed')));
  store.subscribe(() => renderBanner());
  window.addEventListener('pagehide', () => store.flush({ immediate: true })); // no timer fires after this

  restoreUiState();
  els.stepperNav.setAttribute('aria-label', t('stepper.label'));
  els.skipLink.textContent = t('app.skip');
  // The logo opens Home (what the planner is, its steps, and the Time report) in place.
  els.brand?.addEventListener('click', (event) => {
    event.preventDefault();
    goTo(HOME);
  });
  els.reportButton = ui.h(
    'button',
    { class: 'report-fab', type: 'button', hidden: true, 'aria-label': t('settings.timeReport'), title: t('settings.timeReport'), onClick: () => openTimeReport({ ui, store, i18n }) },
    ui.icon('clock', { size: 22 }),
  );
  document.querySelector('.app').append(els.reportButton);

  renderStepper();
  renderBrand();
  renderBanner();
  mountStage(state.stage, null);
  bindKeyboard();
  initAuth();
}

boot();
