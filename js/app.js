// App shell: boots the store with the local adapter, renders header/stepper/day bar/banner,
// routes between the five stage panels (slide + fade), shows the per-stage tip bubbles and wires
// keyboard shortcuts. Stage modules only ever see the `ctx` object built in makeCtx().
import { createStore } from './store.js';
import { createLocalAdapter } from './storage/local.js';
import * as dates from './dates.js';
import * as ui from './ui.js';
import * as i18n from './i18n.js';
import * as calendar from './stages/calendar.js';
import * as dump from './stages/dump.js';
import * as sort from './stages/sort.js';
import * as board from './stages/board.js';
import { init as initTimer } from './timer.js';

const { t } = i18n;
const STAGE_COUNT = 5;
const STAGE_MODULES = { 1: calendar, 2: dump, 3: sort, 4: board, 5: board };
// Default bubble look per stage (SPEC §2); a stage may override via data-tip-tone / data-tip-tail
// on its [data-tip-anchor] element. Without an anchor the bubble sits under the stage header —
// which is also where every tip goes on narrow screens, where an anchored bubble would cover the
// title, the bullet list or the very cards it explains.
const TIP_STYLE = {
  1: { tone: 'khaki', tail: 'bottom' },
  2: { tone: 'khaki', tail: 'bottom' },
  3: { tone: 'khaki', tail: 'bottom' },
  4: { tone: 'green', tail: 'right' },
  5: { tone: 'dark', tail: 'bottom' },
};
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
  tip: null,
};

// ---------- UI state (per device) ----------

function restoreUiState() {
  const saved = local.loadUi();
  const stage = Number(saved.stage);
  if (Number.isInteger(stage) && stage >= 1 && stage <= STAGE_COUNT) state.stage = stage;
  if (dates.isValidKey(saved.selectedDate)) state.selectedDate = saved.selectedDate;
  state.calendarMonth = dates.isValidMonthKey(saved.calendarMonth) ? saved.calendarMonth : dates.monthOfKey(state.selectedDate);
}

function persistUiState() {
  local.saveUi({ selectedDate: state.selectedDate, stage: state.stage, calendarMonth: state.calendarMonth });
}

// ---------- Header ----------

function stageLabel(stage) {
  return t('app.stageLabel', { n: stage, label: i18n.stepperLabel(stage) });
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
          ui.h('span', { class: 'step__dot', 'aria-hidden': 'true' }, isDone ? ui.icon('check', { size: 16 }) : String(n)),
          ui.h('span', { class: 'step__label', 'aria-hidden': 'true' }, i18n.stepperLabel(n)),
        ),
      ),
    );
  }
  els.stepper.replaceChildren(...items);
}

function renderDayBar() {
  const key = state.selectedDate;
  const isToday = key === dates.todayKey();
  const { total, done } = store.statsForDate(key);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const status = total ? t('day.doneOf', { done, total }) : t('day.noTasks');
  const focusKey = document.activeElement?.dataset?.focusKey;

  els.daybar.replaceChildren(
    ui.h(
      'div',
      { class: 'daybar__inner' },
      ui.h('button', { class: 'btn-icon', type: 'button', 'aria-label': t('day.prev'), dataset: { focusKey: 'prev' }, onClick: () => shiftDay(-1) }, ui.icon('chevron-left')),
      ui.h(
        'div',
        { class: 'daybar__center' },
        ui.h('h2', { class: 'daybar__date' }, dates.formatLong(key)),
        isToday
          ? ui.h('span', { class: 'chip chip--today' }, t('day.today'))
          : ui.h(
              'button',
              { class: 'btn btn-ghost btn-sm daybar__today', type: 'button', 'aria-label': t('day.goToToday'), title: t('day.goToToday'), dataset: { focusKey: 'today' }, onClick: () => selectDay(dates.todayKey()) },
              ui.icon('calendar', { size: 16 }),
              ui.h('span', { class: 'daybar__today-label' }, t('day.goToToday')), // icon only on phones
            ),
      ),
      ui.h('button', { class: 'btn-icon', type: 'button', 'aria-label': t('day.next'), dataset: { focusKey: 'next' }, onClick: () => shiftDay(1) }, ui.icon('chevron-right')),
      ui.h(
        'div',
        { class: 'daybar__progress', title: status },
        ui.h(
          'div',
          { class: 'meter', role: 'progressbar', 'aria-label': status, 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done },
          ui.h('div', { class: 'meter__fill', style: { width: `${percent}%` } }),
        ),
        ui.h('span', null, total ? t('day.progress', { done, total }) : t('day.noTasks')),
      ),
    ),
  );
  if (focusKey) els.daybar.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
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
  renderDayBar();
}

function setCalendarMonth(monthKey) {
  if (!dates.isValidMonthKey(monthKey)) return;
  state.calendarMonth = monthKey;
  persistUiState();
}

/** Day-bar navigation: change the day and re-render the current stage for it. */
function selectDay(key) {
  setDate(key);
  mountStage(state.stage, null);
}

/** The arrows walk the days the calendar shows (weekends are also shown while today is one). */
function shiftDay(direction) {
  const visible = dates.weekendsVisible(store.get().settings.showWeekends);
  const step = direction > 0 ? dates.nextVisibleDay : dates.prevVisibleDay;
  selectDay(step(state.selectedDate, visible));
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
  state.tip?.close();
  state.tip = null;
}

/** Shows the stage's tip; `focus` moves keyboard focus into it (when the user asked for it). */
function showTip(stage = state.stage, { focus = false } = {}) {
  closeTip();
  const spec = i18n.tips[stage];
  const panel = state.mounted?.panel;
  if (!spec || !panel || state.mounted.stage !== stage) return;
  const anchor = narrowScreen.matches ? null : panel.querySelector('[data-tip-anchor]');
  const style = TIP_STYLE[stage];
  const tip = ui.bubble({
    content: tipContent(spec),
    tone: anchor?.dataset.tipTone || panel.querySelector('[data-tip-anchor]')?.dataset.tipTone || style.tone,
    tail: anchor ? anchor.dataset.tipTail || style.tail : 'bottom',
    anchor: anchor ?? undefined,
    within: panel,
    onClose: () => {
      if (state.tip === tip) state.tip = null;
    },
  });
  if (!anchor) {
    const slot = panel.querySelector('[data-tip-slot]') ?? panel.querySelector('.stage-header') ?? panel;
    slot === panel ? panel.prepend(tip.el) : slot.after(tip.el);
  }
  if (focus) tip.el.focus({ preventScroll: true });
  state.tip = tip;
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
  if (!Number.isInteger(next) || next < 1 || next > STAGE_COUNT || next === state.stage) return;
  const direction = next > state.stage ? 'forward' : 'back';
  state.stage = next;
  persistUiState();
  renderStepper();
  mountStage(next, direction);
  // The user was at the bottom of the previous stage ("Next →"): start the new one at its top,
  // and move keyboard focus to its title so Tab continues inside the stage, not from the header.
  window.scrollTo({ top: 0, behavior: 'auto' });
  state.mounted.panel.querySelector('.stage-title')?.focus({ preventScroll: true });
  els.announcer.textContent = t('app.stageAnnounce', { n: next, label: i18n.stepperLabel(next) });
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
    else if (event.key === '?') showTip(state.stage, { focus: true });
    else return;
    event.preventDefault();
  });
}

// ---------- Auth (optional module) ----------

function setSignedIn(signedIn) {
  state.signedIn = Boolean(signedIn);
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
    daybar: document.getElementById('daybar'),
    banner: document.getElementById('banner'),
    stage: document.getElementById('stage'),
    account: document.getElementById('account'),
    tipButton: document.getElementById('tip-button'),
    announcer: document.getElementById('announcer'),
    skipLink: document.getElementById('skip-link'),
  });

  store = createStore(await local.load());
  store.attach(local);
  initTimer({ store }); // the floating timer bar lives at document level, whatever stage is open
  store.onError(() => ui.toast(t('toast.saveFailed')));
  store.subscribe(() => {
    renderDayBar();
    renderBanner();
  });
  window.addEventListener('pagehide', () => store.flush({ immediate: true })); // no timer fires after this

  restoreUiState();
  els.stepperNav.setAttribute('aria-label', t('stepper.label'));
  els.skipLink.textContent = t('app.skip');
  els.tipButton.setAttribute('aria-label', t('app.tipButton'));
  els.tipButton.replaceChildren(ui.icon('question'));
  els.tipButton.addEventListener('click', () => showTip(state.stage, { focus: true }));

  renderStepper();
  renderDayBar();
  renderBanner();
  mountStage(state.stage, null);
  bindKeyboard();
  initAuth();
}

boot();
