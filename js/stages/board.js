// Stage 4 — the working board (SPEC §2): labelled coloured quadrants holding task cards
// (checkbox · title · clock), a "…" menu per quadrant, the day's waiting list under the matrix,
// the strip that pulls unfinished tasks in from earlier days, and the fast-organize popover
// (timer / postpone / next day) opened from a task title or its clock.
import * as timer from '../timer.js';
import { QUADRANTS, isRecord } from '../store.js';
import { carryStrip, attemptBadge, recordLabel, dayNav, QUAD_ICON } from '../carry.js';

const PRESET_MINUTES = [5, 15, 25, 45, 60];
const TIP_ROOM = 150; // px free beside the matrix needed to put the "Done mark" bubble on the left
const narrowScreen = window.matchMedia('(max-width: 639px)');
const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag
const LONG_PRESS_MS = 250; // touch: hold this long (still) to lift a card
const SCROLL_EDGE = 56; // px from the viewport edge where a drag auto-scrolls
const SCROLL_STEP = 10;

function quadrantIcon(quadrant) {
  return ctx.ui.h('span', {
    class: `quadrant__icon quadrant__icon--${quadrant}`,
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">${QUAD_ICON[quadrant]}</svg>`,
  });
}

let ctx = null;
let root = null; // .stage-body
let boardEl = null; // strip + matrix + waiting list, re-rendered on every task change
let unsubscribe = null;
let adding = null; // quadrant with an open "add task" row
let popover = null; // open task popover
let drag = null; // active card drag
let suppressClick = false; // swallow the click that follows a completed drag

// ---------- Lifecycle ----------

export function mount(container, nextCtx) {
  ctx = nextCtx;
  const { ui, i18n } = ctx;
  const nav = ui.stageNav({ onBack: () => ctx.goTo(3), onNext: () => ctx.goTo(1), nextLabel: i18n.t('nav.backToCalendar'), day: dayNav(ctx) });
  boardEl = ui.h('div', {
    class: 'board',
    onPointerdown: onPointerDown,
    onPointermove: onPointerMove,
    onPointerup: onPointerUp,
    onPointercancel: onPointerCancel,
    onContextmenu: onContextMenu,
  });
  boardEl.addEventListener('touchmove', onTouchMove, { passive: false }); // must be cancelable
  boardEl.addEventListener('click', onClickCapture, true); // swallow the post-drag click
  root = ui.h('div', { class: 'stage-body' }, nav, ui.stageHeader({ stage: 4, title: i18n.t('stage.4.title') }), boardEl);
  container.append(root);
  render();
  unsubscribe = ctx.store.subscribe(onStoreChange);
}

export function unmount() {
  endDrag();
  closePopover();
  unsubscribe?.();
  unsubscribe = null;
  adding = null;
  boardEl = null;
  root = null;
  ctx = null;
}

function onStoreChange(doc, { reason }) {
  if (reason === 'setSetting') return; // tips seen / banner / weekends do not change the board
  if (timer.isTimerReason(reason)) refreshClocks();
  else render();
}

// ---------- Rendering ----------

function currentTasks() {
  return ctx.store.tasksForDate(ctx.getDate());
}

function findTask(id) {
  return ctx.store.findTask(id);
}

function render() {
  closePopover();
  endDrag(); // a remote change mid-drag would detach the dragged card
  const focusKey = focusedKey();
  const tasks = currentTasks();
  const waiting = ctx.store.waitingTasks(); // the global backlog, shared by every day
  boardEl.replaceChildren(
    ...[carryStrip(ctx, ctx.getDate()), matrix(tasks.filter((task) => task.quadrant !== null)), waiting.length ? waitingPanel(waiting) : null].filter(Boolean),
  );
  markTipAnchor();
  restoreFocus(focusKey);
}

/** Timer-only changes: update every clock in place so open popovers and the tip keep their anchors. */
function refreshClocks() {
  for (const el of boardEl.querySelectorAll('.task-card__clock')) {
    const task = findTask(el.dataset.timerId);
    if (task) timer.renderClock(el, task);
  }
}

function matrix(tasks) {
  return ctx.ui.h(
    'div',
    { class: 'matrix board__matrix' },
    QUADRANTS.map((quadrant) => quadrantPanel(quadrant, tasks.filter((task) => task.quadrant === quadrant))),
  );
}

function quadrantPanel(quadrant, tasks) {
  const { ui, i18n } = ctx;
  const labelId = `quadrant-${quadrant}-label`;
  // The footer is a single "+" that adds a task straight into this quadrant (owner request:
  // the old "…" menu is gone).
  const add = ui.h(
    'button',
    {
      class: 'btn-icon quadrant__add',
      type: 'button',
      'aria-label': i18n.t('board.addTask'),
      title: i18n.t('board.addTask'),
      dataset: { focusKey: `addbtn:${quadrant}` },
      onClick: () => startAdding(quadrant),
    },
    ui.icon('plus', { size: 22 }),
  );
  const active = tasks.filter((task) => !isRecord(task)).length;
  return ui.h(
    'section',
    { class: `quadrant quadrant--${quadrant}`, 'aria-labelledby': labelId, dataset: { quadrant } },
    ui.h(
      'header',
      { class: 'quadrant__head' },
      quadrantIcon(quadrant),
      ui.h(
        'div',
        { class: 'quadrant__heading' },
        ui.h('h3', { class: 'quadrant__label', id: labelId }, i18n.quadrantLabel(quadrant)),
        ui.h('p', { class: 'quadrant__sub' }, i18n.quadrantName(quadrant)),
      ),
      ui.h('span', { class: 'quadrant__count', 'aria-hidden': 'true' }, String(active)),
    ),
    ui.h('div', { class: 'quadrant__body' }, tasks.map(taskCard), adding === quadrant && addRow(quadrant)),
    ui.h('div', { class: 'quadrant__footer' }, add),
  );
}

/** The round "done mark" checkbox — shared by board cards and waiting cards (a task is completed
 *  the same way in any of the five categories). */
function doneControl(task) {
  const { ui, i18n } = ctx;
  const check = ui.h('input', {
    class: 'task-card__check',
    type: 'checkbox',
    checked: task.done,
    'aria-label': task.title,
    title: i18n.t(task.done ? 'board.markUndone' : 'board.markDone'),
    dataset: { focusKey: `check:${task.id}` },
    onChange: (event) => ctx.store.toggleDone(task.id, event.currentTarget.checked),
  });
  return ui.h('label', { class: 'task-card__done' }, check);
}

function taskCard(task) {
  if (isRecord(task)) return recordCard(task);
  const { ui } = ctx;
  // The clock opens the popover straight on the timer picker (stopwatch / countdown).
  const clock = ui.h('button', {
    class: 'task-card__clock',
    type: 'button',
    'aria-haspopup': 'dialog',
    dataset: { timerId: task.id, focusKey: `clock:${task.id}` },
    onClick: (event) => openTaskPopover(task.id, event.currentTarget, { view: 'timer' }),
  });
  timer.renderClock(clock, task);
  return ui.h(
    'div',
    { class: `task-card ${task.done ? 'task-card--done' : ''}`.trim(), dataset: { id: task.id } },
    doneControl(task),
    priorityButton(task),
    titleButton(task),
    ui.h('div', { class: 'task-card__actions' }, clock, scheduleButton(task), deleteButton(task)),
  );
}

/** The task's priority TAG, shown right after the done tick. It is the label set in Prioritize, not
 *  the box the card sits in — click it to change the label. Untagged tasks show no icon. */
function priorityButton(task) {
  const { ui, i18n } = ctx;
  if (!task.tag) return null;
  return ui.h(
    'button',
    {
      class: `task-card__priority priority-icon--${task.tag}`,
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-label': i18n.t('board.changePriority'),
      title: i18n.t('board.changePriority'),
      dataset: { focusKey: `priority:${task.id}` },
      onClick: (event) => openPriorityMenu(task, event.currentTarget),
    },
    ui.h('span', {
      'aria-hidden': 'true',
      html: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${QUAD_ICON[task.tag]}</svg>`,
    }),
  );
}

function openPriorityMenu(task, anchor) {
  const { ui, i18n, store } = ctx;
  const items = QUADRANTS.map((quadrant) => ({
    label: i18n.quadrantLabel(quadrant),
    disabled: task.tag === quadrant,
    onSelect: () => store.setTag(task.id, quadrant),
  }));
  items.push('-', { label: i18n.t('quadrant.unsorted'), onSelect: () => store.setTag(task.id, null) });
  ui.menu({ anchor, items });
}

/** ⏩ between the clock and the ✕: opens the schedule picker (next day + postpone), the way the
 *  clock opens the timer picker. */
function scheduleButton(task) {
  return ctx.ui.h(
    'button',
    {
      class: 'task-card__forward',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-label': ctx.i18n.t('popover.nextDay'),
      title: ctx.i18n.t('schedule.title'),
      dataset: { focusKey: `fwd:${task.id}` },
      onClick: (event) => openTaskPopover(task.id, event.currentTarget, { view: 'schedule' }),
    },
    ctx.ui.icon('forward', { size: 16 }),
  );
}

/** Small red ✕ at the far right of a card: deletes the task at once (with an Undo toast). */
function deleteButton(task) {
  return ctx.ui.h(
    'button',
    {
      class: 'task-card__delete',
      type: 'button',
      'aria-label': `${ctx.i18n.t('board.deleteTask')}: ${task.title}`,
      title: ctx.i18n.t('board.deleteTask'),
      dataset: { focusKey: `del:${task.id}` },
      onClick: () => deleteTasks([task]),
    },
    ctx.ui.icon('close', { size: 15 }),
  );
}

/** The title opens the popover; a task on the plan for the n-th time carries a "×n" badge. */
function titleButton(task) {
  return ctx.ui.h(
    'button',
    {
      class: 'task-card__title',
      type: 'button',
      'aria-haspopup': 'dialog',
      dataset: { focusKey: `title:${task.id}` },
      onClick: (event) => openTaskPopover(task.id, event.currentTarget, { view: 'edit' }),
    },
    attemptBadge(ctx, task),
    task.title,
  );
}

/**
 * A task pulled to a later day stays here as a record: faded red, not counted, nothing to tick
 * or start — it only shows how the day went and where the task continued.
 */
function recordCard(task) {
  const { ui } = ctx;
  return ui.h(
    'div',
    { class: 'task-card task-card--record', dataset: { id: task.id } },
    ui.h('span', { class: 'task-card__title task-card__title--record' }, attemptBadge(ctx, task), task.title),
    recordLabel(ctx, task),
  );
}

/** Inline "add task" row: Enter or blur with text commits, Escape or an empty blur discards. */
function addRow(quadrant) {
  const { ui, i18n } = ctx;
  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    const title = input.value.trim();
    if (commit && title) {
      ctx.store.addTask({ title, date: ctx.getDate(), quadrant }); // the re-render opens a fresh row
      return;
    }
    adding = null;
    row.remove();
    if (!commit) boardEl.querySelector(`[data-focus-key="more:${quadrant}"]`)?.focus();
  };
  const input = ui.h('input', {
    class: 'task-card__input',
    type: 'text',
    maxlength: 200,
    placeholder: i18n.t('board.newTask'),
    'aria-label': i18n.t('board.newTask'),
    dataset: { focusKey: `add:${quadrant}` },
    onKeydown: (event) => {
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
      else return;
      event.preventDefault();
    },
    onBlur: () => finish(true),
  });
  const row = ui.h('div', { class: 'task-card task-card--new' }, input);
  return row;
}

// ---------- Waiting list ----------

/**
 * Tasks left unplaced on stage 3 wait here, on hold for the day (SPEC §2): the owner keeps the
 * day's essentials on the board and the rest in reserve. Each can be placed, or organised from
 * its popover, at any time. Records of tasks pulled forward from here are listed too.
 */
function waitingPanel(tasks) {
  const { ui, i18n } = ctx;
  const active = tasks.filter((task) => !isRecord(task));
  return ui.h(
    'section',
    { class: 'waiting', 'aria-labelledby': 'waiting-label' },
    ui.h(
      'div',
      { class: 'waiting__head' },
      ui.h('h3', { class: 'waiting__label', id: 'waiting-label' }, i18n.t('board.waiting', { n: active.length })),
      ui.h('p', { class: 'waiting__hint' }, i18n.t('board.waitingHint')),
    ),
    ui.h('div', { class: 'waiting__list' }, tasks.map(waitingCard)),
  );
}

function waitingCard(task) {
  if (isRecord(task)) return recordCard(task);
  const { ui } = ctx;
  // A waiting task is completed like any other (its own checkbox) and placed by clicking one of the
  // four small category glyphs (Do now / Schedule / Delegate / Drop) — no dropdown.
  return ui.h(
    'div',
    { class: `task-card waiting-card ${task.done ? 'task-card--done' : ''}`.trim(), dataset: { id: task.id } },
    doneControl(task),
    titleButton(task),
    ui.h('div', { class: 'waiting-card__places' }, QUADRANTS.map((quadrant) => placeIconButton(task, quadrant))),
    deleteButton(task),
  );
}

/** Small colour-coded glyph that files a waiting task straight into that quadrant. */
function placeIconButton(task, quadrant) {
  const { ui, i18n } = ctx;
  return ui.h(
    'button',
    {
      class: `waiting-place waiting-place--${quadrant}`,
      type: 'button',
      'aria-label': `${i18n.t('sort.placeIn')} — ${i18n.quadrantLabel(quadrant)}`,
      title: i18n.quadrantLabel(quadrant),
      dataset: { focusKey: `place:${task.id}:${quadrant}` },
      onClick: () => moveToQuadrant(task, quadrant),
    },
    ui.h('span', {
      'aria-hidden': 'true',
      html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${QUAD_ICON[quadrant]}</svg>`,
    }),
  );
}

// ---------- Tip anchor ----------

/**
 * The "Done mark ✅" bubble points at the first checkbox from the free space left of the matrix,
 * as on the design board. Without that space the shell shows it under the stage header instead,
 * where it hides nothing.
 */
function markTipAnchor() {
  if (narrowScreen.matches) return;
  const card = boardEl.querySelector('.board__matrix .task-card:not(.task-card--new):not(.task-card--record)');
  if (!card) return;
  const room = (root.clientWidth - boardEl.querySelector('.matrix').offsetWidth) / 2;
  if (room < TIP_ROOM) return;
  const anchor = card.querySelector('.task-card__check');
  anchor.dataset.tipAnchor = '';
  anchor.dataset.tipTail = 'right';
}

// ---------- Focus bookkeeping across re-renders ----------

function focusedKey() {
  const el = document.activeElement;
  return root?.contains(el) ? (el.dataset.focusKey ?? null) : null;
}

function restoreFocus(key) {
  if (key) boardEl.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

// ---------- Add a task straight into a quadrant (the footer "+") ----------

function startAdding(quadrant) {
  adding = quadrant;
  render();
  boardEl.querySelector(`[data-focus-key="add:${quadrant}"]`)?.focus();
}

// ---------- Undoable batch actions ----------

/** Each toast reverts its own step (`token` from store.undoable), even with several toasts open. */
function undoToast(message, token) {
  if (!token) return;
  ctx.ui.toast(message, { action: { label: ctx.i18n.t('toast.undo'), onClick: () => ctx.store.undo(token) } });
}

function nextVisibleDay(fromKey) {
  // ⏩ "next day" skips weekends: a Friday task jumps to Monday. (Weekends still show on the
  // calendar; this only affects where the one-tap "next day" action lands.)
  return ctx.dates.nextVisibleDay(fromKey, false);
}

/** Moves tasks to another day. Every day (weekends included) is shown on the calendar, so a moved
 *  task is always reachable. */
function moveTasks(tasks, dateKey) {
  const { store, dates, i18n } = ctx;
  const token = store.undoable(() => tasks.forEach((task) => store.moveTaskToDate(task.id, dateKey)));
  undoToast(i18n.t('toast.movedTo', { date: dates.formatShort(dateKey) }), token);
}


function deleteTasks(tasks) {
  const { store, i18n } = ctx;
  const token = store.undoable(() => tasks.forEach((task) => store.removeTask(task.id)));
  undoToast(tasks.length === 1 ? i18n.t('toast.deleted') : i18n.t('toast.deletedMany', { n: tasks.length }), token);
}

// ---------- Task popover ("fast organize": timer · postpone · next day, plus edit / move / delete) ----------

function closePopover() {
  popover?.close();
  popover = null;
}

// Every card action has its own control: the clock opens the timer, the ⏩ opens the schedule
// picker (next day + postpone), the ✕ deletes, and the title opens rename. So the popover simply
// shows whichever of those three panels was requested.
function openTaskPopover(id, anchor, { view = 'edit' } = {}) {
  closePopover();
  const task = findTask(id);
  if (!task) return;
  const body = ctx.ui.h('div', { class: 'task-popover' });
  popover = ctx.ui.popover({ anchor, content: body, className: 'popover--task', label: task.title, onClose: () => { popover = null; } });
  if (view === 'timer') showTimerPicker(task, body);
  else if (view === 'schedule') showSchedulePicker(task, body);
  else showEdit(task, body);
}

/** Swaps the popover content, re-positions it and focuses `focusEl`. */
function showView(body, children, focusEl) {
  body.replaceChildren(...children);
  popover?.reposition();
  focusEl?.focus();
  if (focusEl instanceof HTMLInputElement && focusEl.type === 'text') focusEl.select();
}

/** The picker title doubles as the rename control: click it to edit; `back` re-opens this picker
 *  after saving/cancelling. */
function editableTitle(task, body, back) {
  const { ui, i18n } = ctx;
  return ui.h(
    'button',
    { class: 'task-popover__title task-popover__title--edit', type: 'button', title: i18n.t('board.renameTask'), 'aria-label': i18n.t('board.renameTask'), onClick: () => showEdit(task, body, back) },
    ui.h('span', { class: 'task-popover__title-text' }, task.title),
    ui.h('span', {
      class: 'task-popover__pencil',
      'aria-hidden': 'true',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    }),
  );
}

function sendToNextDay(task) {
  closePopover();
  moveTasks([task], nextVisibleDay(task.date));
}

/** Moves the task to the end of another quadrant (or the waiting list when quadrant is null);
 *  one undo reverts both changes. */
function moveToQuadrant(task, quadrant) {
  const { store } = ctx;
  const last = currentTasks().reduce((max, item) => Math.max(max, item.order + 1), Date.now());
  store.undoable(() => {
    store.setQuadrant(task.id, quadrant, ctx.getDate()); // placing a backlog task assigns it to this day
    store.reorderTask(task.id, last);
  });
}

// ---------- Drag & drop (Pointer Events): grab a card and drop it in another quadrant ----------
// A plain click still opens the popover / toggles the checkbox; a press past the threshold (or a
// touch long-press) lifts the card. Controls (checkbox, clock, ✕, menus) never start a drag.

/** The click that immediately follows a completed drag is swallowed so it does not open a popover. */
function onClickCapture(event) {
  if (suppressClick) {
    event.stopPropagation();
    event.preventDefault();
  }
}

/** The card a pointer press should drag, or null (records, add-rows and controls are not draggable). */
function draggableCardAt(target) {
  const card = target.closest('.task-card');
  if (!card || card.classList.contains('task-card--new') || card.classList.contains('task-card--record')) return null;
  if (target.closest('.task-card__check, .task-card__priority, .task-card__clock, .task-card__forward, .task-card__delete, .quadrant__add, .waiting-place')) return null;
  return card;
}

function onPointerDown(event) {
  if (event.button !== 0 || !event.isPrimary || drag) return;
  const card = draggableCardAt(event.target);
  if (!card) return;
  const touch = event.pointerType === 'touch';
  drag = {
    card,
    id: card.dataset.id,
    pointerId: event.pointerId,
    touch,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    offsetX: 0,
    offsetY: 0,
    active: false,
    ghost: null,
    target: null,
    raf: 0,
    press: 0,
  };
  if (!touch) return; // capture is taken only once a drag actually starts (in liftCard), so a
  // plain click still lands on the title/checkbox and opens the popover / toggles.
  // Touch: lift after a still press so a plain swipe still scrolls the page.
  drag.press = setTimeout(() => {
    if (!drag || drag.active) return;
    liftCard(drag);
    positionGhost(drag);
  }, LONG_PRESS_MS);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  if (!drag.active) {
    if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) < DRAG_THRESHOLD) return;
    if (drag.touch) return endDrag(); // moved before the long press: a scroll, not a drag
    liftCard(drag);
  }
  positionGhost(drag);
  setDropTarget(drag, targetAt(drag.lastX, drag.lastY));
}

/** While a card is lifted the page must not scroll under the finger. */
function onTouchMove(event) {
  if (drag?.active && event.cancelable) event.preventDefault();
}

/** A touch drag begins with a long press, so the browser's long-press menu must not open. */
function onContextMenu(event) {
  if (drag?.touch) event.preventDefault();
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { id, active, target } = drag;
  endDrag();
  if (!active) return; // a plain press: the click handler takes over
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  if (target) dropOnto(id, target);
}

function onPointerCancel(event) {
  if (drag && event.pointerId === drag.pointerId) endDrag();
}

function positionGhost(current) {
  current.ghost.style.transform = `translate(${current.lastX - current.offsetX}px, ${current.lastY - current.offsetY}px)`;
}

/** Turns the press into a drag: a fixed ghost follows the pointer, the original card dims. */
function liftCard(current) {
  const rect = current.card.getBoundingClientRect();
  current.offsetX = current.startX - rect.left;
  current.offsetY = current.startY - rect.top;
  const ghost = current.card.cloneNode(true);
  ghost.className = 'task-card board-ghost task-card--dragging';
  ghost.removeAttribute('data-id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.style.width = `${rect.width}px`;
  document.body.append(ghost);
  current.ghost = ghost;
  current.active = true;
  try {
    current.card.setPointerCapture(current.pointerId); // route moves/up here now the drag is live
  } catch {
    /* pointer already released */
  }
  current.card.classList.add('task-card--lifted');
  root.classList.add('board--dragging');
  current.raf = requestAnimationFrame(() => autoScroll(current));
}

/** The quadrant or waiting list under the pointer, or null. */
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.quadrant, .waiting');
  return el && root.contains(el) ? el : null;
}

function setDropTarget(current, target) {
  if (current.target === target) return;
  current.target?.classList.remove('is-drop-target');
  target?.classList.add('is-drop-target');
  current.target = target;
}

/** Scrolls the page while the pointer rests near the top/bottom edge (stacked mobile layout). */
function autoScroll(current) {
  if (drag !== current) return;
  const dy = current.lastY < SCROLL_EDGE ? -SCROLL_STEP : current.lastY > window.innerHeight - SCROLL_EDGE ? SCROLL_STEP : 0;
  if (dy) {
    window.scrollBy(0, dy);
    setDropTarget(current, targetAt(current.lastX, current.lastY));
  }
  current.raf = requestAnimationFrame(() => autoScroll(current));
}

/** Drops the task into a quadrant (or back to the waiting list when dropped on the waiting panel). */
function dropOnto(id, target) {
  const task = findTask(id);
  if (!task) return;
  const quadrant = target.classList.contains('waiting') ? null : target.dataset.quadrant ?? null;
  if (task.quadrant === quadrant) return;
  moveToQuadrant(task, quadrant);
}

function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  clearTimeout(d.press);
  cancelAnimationFrame(d.raf);
  d.ghost?.remove();
  d.target?.classList.remove('is-drop-target');
  d.card.classList.remove('task-card--lifted');
  root?.classList.remove('board--dragging');
  if (d.card.hasPointerCapture?.(d.pointerId)) d.card.releasePointerCapture(d.pointerId);
}

// ----- ▶ Stopwatch / countdown picker -----

async function beginTimer(task, options) {
  if (await timer.start(task, options)) closePopover();
}

async function resumeFromPicker(task) {
  if (await timer.resume(task)) closePopover();
}

function showTimerPicker(task, body) {
  const { ui, i18n } = ctx;
  const custom = ui.h('input', {
    class: 'timer-picker__custom',
    type: 'number',
    min: 1,
    max: 999,
    step: 1,
    inputmode: 'numeric',
    placeholder: i18n.t('timer.custom'),
    'aria-label': i18n.t('timer.custom'),
  });
  const startCustom = (event) => {
    event.preventDefault();
    const minutes = Number(custom.value);
    if (!Number.isInteger(minutes) || minutes < 1) return custom.reportValidity();
    beginTimer(task, { mode: 'countdown', durationSec: minutes * 60 });
  };
  const stopwatch = ui.h(
    'button',
    { class: 'btn timer-picker__stopwatch', type: 'button', onClick: () => beginTimer(task, { mode: 'stopwatch' }) },
    ui.icon('play', { size: 16 }),
    i18n.t('timer.stopwatch'),
  );
  // If this task already has time on the clock (paused or stopped), offer to CONTINUE it from where
  // it left off — so the time is never lost — before the options that start a fresh timer.
  const status = timer.clockState(task);
  const continueBtn =
    status.state === 'paused' || status.state === 'done'
      ? ui.h(
          'button',
          { class: 'btn btn-primary timer-picker__continue', type: 'button', onClick: () => resumeFromPicker(task) },
          ui.icon('play', { size: 16 }),
          i18n.t('timer.continue', { time: status.text }),
        )
      : null;
  showView(
    body,
    [
      editableTitle(task, body, () => showTimerPicker(task, body)),
      continueBtn,
      stopwatch,
      ui.h(
        'fieldset',
        { class: 'timer-picker' },
        ui.h('legend', { class: 'timer-picker__legend' }, i18n.t('timer.countdown')),
        ui.h(
          'div',
          { class: 'timer-picker__presets', role: 'group', 'aria-label': i18n.t('timer.presets') },
          PRESET_MINUTES.map((minutes) =>
            ui.h(
              'button',
              { class: 'btn btn-sm timer-picker__preset', type: 'button', onClick: () => beginTimer(task, { mode: 'countdown', durationSec: minutes * 60 }) },
              String(minutes),
            ),
          ),
          ui.h('span', { class: 'timer-picker__unit', 'aria-hidden': 'true' }, i18n.t('timer.unit')), // "5 · 15 · 25 · 45 · 60 min"
        ),
        ui.h(
          'form',
          { class: 'timer-picker__custom-row', onSubmit: startCustom },
          custom,
          ui.h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, i18n.t('timer.start')),
        ),
      ),
    ].filter(Boolean),
    continueBtn ?? stopwatch,
  );
}

// ----- Edit title (opened by the card title) -----

function showEdit(task, body, back) {
  const { ui, i18n, store } = ctx;
  const input = ui.h('input', { class: 'task-popover__input', type: 'text', value: task.title, maxlength: 200, required: true, 'aria-label': i18n.t('board.editTitle') });
  const save = (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return input.focus();
    store.updateTask(task.id, { title });
    back ? back() : closePopover();
  };
  const cancel = () => (back ? back() : closePopover());
  showView(body, [formView(save, cancel, input, i18n.t('common.save'))], input);
}

// ----- ⏩ Schedule picker (opened by the card ⏩): "Next day" + a calendar to postpone ------
// Mirrors the timer picker: a primary button on top, then a bordered section below.
function showSchedulePicker(task, body) {
  const { ui, i18n, dates } = ctx;
  const today = dates.todayKey();
  const suggested = nextVisibleDay(task.date);
  const date = ui.h('input', {
    class: 'schedule-picker__date',
    type: 'date',
    min: today,
    required: true,
    value: suggested > today ? suggested : today,
    'aria-label': i18n.t('popover.postpone'),
  });
  const postpone = (event) => {
    event.preventDefault();
    const key = date.value;
    if (!dates.isValidKey(key) || key < today) return date.reportValidity();
    closePopover();
    moveTasks([task], key);
  };
  const nextDay = ui.h(
    'button',
    { class: 'btn schedule-picker__nextday', type: 'button', onClick: () => sendToNextDay(task) },
    ui.icon('forward', { size: 16 }),
    i18n.t('schedule.nextDay'),
  );
  showView(
    body,
    [
      editableTitle(task, body, () => showSchedulePicker(task, body)),
      nextDay,
      ui.h(
        'fieldset',
        { class: 'schedule-picker' },
        ui.h('legend', { class: 'schedule-picker__legend' }, i18n.t('schedule.postpone')),
        ui.h(
          'form',
          { class: 'schedule-picker__row', onSubmit: postpone },
          date,
          ui.h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, i18n.t('schedule.set')),
        ),
      ),
    ],
    nextDay,
  );
}

/** Small form: `input` + Cancel / submit buttons. */
function formView(onSubmit, onCancel, input, submitLabel) {
  const { ui, i18n } = ctx;
  return ui.h(
    'form',
    { class: 'task-popover__form', onSubmit },
    input,
    ui.h(
      'div',
      { class: 'task-popover__buttons' },
      ui.h('button', { class: 'btn btn-sm', type: 'button', onClick: onCancel }, i18n.t('common.cancel')),
      ui.h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, submitLabel),
    ),
  );
}
