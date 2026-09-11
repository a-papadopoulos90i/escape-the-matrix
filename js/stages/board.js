// Stages 4 & 5 — the working board (SPEC §2). One component for both stages: labelled coloured
// quadrants holding task cards (checkbox · title · clock), a "…" menu per quadrant, a strip for
// tasks still unsorted, and the fast-organize popover (timer / postpone / next day) opened from a
// task title. The stage only changes the header, the footer buttons and where the tip points.
import * as timer from '../timer.js';
import { QUADRANTS } from '../store.js';

const PRESET_MINUTES = [5, 15, 25, 45, 60];
const TIP_ROOM = 150; // px free beside the matrix needed to put the stage-4 bubble on the left
const narrowScreen = window.matchMedia('(max-width: 639px)');

let ctx = null;
let root = null; // .stage-body
let boardEl = null; // strip + matrix, re-rendered on every task change
let unsubscribe = null;
let adding = null; // quadrant with an open "add task" row
let popover = null; // open task popover

// ---------- Lifecycle ----------

export function mount(container, nextCtx) {
  ctx = nextCtx;
  const { ui, i18n, stage } = ctx;
  const nav =
    stage === 5
      ? ui.stageNav({ onBack: () => ctx.goTo(4), onNext: () => ctx.goTo(1), nextLabel: i18n.t('nav.backToCalendar') })
      : ui.stageNav({ onBack: () => ctx.goTo(3), onNext: () => ctx.goTo(5) });
  boardEl = ui.h('div', { class: 'board' });
  root = ui.h('div', { class: 'stage-body' }, ui.stageHeader({ stage, title: i18n.t(`stage.${stage}.title`) }), boardEl, nav);
  container.append(root);
  render();
  unsubscribe = ctx.store.subscribe(onStoreChange);
}

export function unmount() {
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
  return ctx.store.get().tasks.find((task) => task.id === id) ?? null;
}

function render() {
  closePopover();
  const focusKey = focusedKey();
  const tasks = currentTasks();
  const unplaced = tasks.filter((task) => task.quadrant === null).length;
  boardEl.replaceChildren(...[unplaced ? unplacedStrip(unplaced) : null, matrix(tasks)].filter(Boolean));
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

function unplacedStrip(count) {
  const { ui, i18n } = ctx;
  return ui.h(
    'div',
    { class: 'board__unplaced', role: 'status' },
    ui.h('span', null, count === 1 ? i18n.t('board.unplacedOne') : i18n.t('board.unplaced', { n: count })),
    ui.h('button', { class: 'board__place', type: 'button', onClick: () => ctx.goTo(3) }, i18n.t('board.placeThem')),
  );
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
  const more = ui.h(
    'button',
    {
      class: 'btn-icon quadrant__more',
      type: 'button',
      'aria-label': i18n.t('board.menu'),
      'aria-haspopup': 'menu',
      dataset: { focusKey: `more:${quadrant}` },
      onClick: (event) => openQuadrantMenu(quadrant, tasks, event.currentTarget),
    },
    ui.icon('more'),
  );
  return ui.h(
    'section',
    { class: `quadrant quadrant--${quadrant}`, 'aria-labelledby': labelId, dataset: { quadrant } },
    ui.h('h3', { class: 'quadrant__label', id: labelId }, i18n.quadrantLabel(quadrant)),
    ui.h('div', { class: 'quadrant__body' }, tasks.map(taskCard), adding === quadrant && addRow(quadrant)),
    ui.h('div', { class: 'quadrant__footer' }, more),
  );
}

function taskCard(task) {
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
  const title = ui.h(
    'button',
    {
      class: 'task-card__title',
      type: 'button',
      'aria-haspopup': 'dialog',
      dataset: { focusKey: `title:${task.id}` },
      onClick: (event) => openTaskPopover(task.id, event.currentTarget),
    },
    task.title,
  );
  const clock = ui.h('span', { class: 'task-card__clock', dataset: { timerId: task.id } });
  timer.renderClock(clock, task);
  return ui.h(
    'div',
    { class: `task-card ${task.done ? 'task-card--done' : ''}`.trim(), dataset: { id: task.id } },
    ui.h('label', { class: 'task-card__done' }, check),
    title,
    clock,
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

// ---------- Tip anchor ----------

/** Stage 4 points at the first checkbox, stage 5 at the first title; the tail side depends on room. */
function markTipAnchor() {
  const card = boardEl.querySelector('.task-card:not(.task-card--new)');
  if (!card) return;
  const narrow = narrowScreen.matches;
  if (ctx.stage === 5) {
    const anchor = card.querySelector('.task-card__title');
    anchor.dataset.tipAnchor = '';
    anchor.dataset.tipTail = narrow ? 'top' : 'left';
    return;
  }
  const anchor = card.querySelector('.task-card__check');
  const room = (root.clientWidth - boardEl.querySelector('.matrix').offsetWidth) / 2;
  anchor.dataset.tipAnchor = '';
  anchor.dataset.tipTail = room >= TIP_ROOM ? 'right' : 'top';
}

// ---------- Focus bookkeeping across re-renders ----------

function focusedKey() {
  const el = document.activeElement;
  return root?.contains(el) ? (el.dataset.focusKey ?? null) : null;
}

function restoreFocus(key) {
  if (key) boardEl.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

// ---------- Quadrant "…" menu ----------

function openQuadrantMenu(quadrant, tasks, anchor) {
  const { ui, i18n } = ctx;
  const unfinished = tasks.filter((task) => !task.done);
  const finished = tasks.filter((task) => task.done);
  const items = [
    { label: i18n.t('board.addHere'), onSelect: () => startAdding(quadrant) },
    { label: i18n.t('board.markAllDone'), disabled: !unfinished.length, onSelect: () => markAllDone(unfinished) },
    { label: i18n.t('board.moveUnfinished'), disabled: !unfinished.length, onSelect: () => moveToNextDay(unfinished) },
    { label: i18n.t('board.clearDone'), disabled: !finished.length, onSelect: () => deleteTasks(finished) },
  ];
  if (quadrant === 'delete') {
    items.push('-', { label: i18n.t('board.deleteAll'), danger: true, disabled: !tasks.length, onSelect: () => deleteAll(tasks) });
  }
  ui.menu({ anchor, items });
}

function startAdding(quadrant) {
  adding = quadrant;
  render();
  boardEl.querySelector(`[data-focus-key="add:${quadrant}"]`)?.focus();
}

function markAllDone(tasks) {
  for (const task of tasks) ctx.store.toggleDone(task.id, true);
}

async function deleteAll(tasks) {
  const { ui, i18n } = ctx;
  if (await ui.confirm(i18n.t('confirm.deleteAll'), { okLabel: i18n.t('common.delete'), danger: true })) deleteTasks(tasks);
}

// ---------- Undoable batch actions ----------

function undoToast(message) {
  ctx.ui.toast(message, { action: { label: ctx.i18n.t('toast.undo'), onClick: () => ctx.store.undo() } });
}

function nextVisibleDay(fromKey) {
  return ctx.dates.nextVisibleDay(fromKey, ctx.store.get().settings.showWeekends);
}

function moveTasks(tasks, dateKey) {
  const { store, dates, i18n } = ctx;
  store.undoable(() => tasks.forEach((task) => store.moveTaskToDate(task.id, dateKey)));
  undoToast(i18n.t('toast.movedTo', { date: dates.formatShort(dateKey) }));
}

function moveToNextDay(tasks) {
  moveTasks(tasks, nextVisibleDay(ctx.getDate()));
}

function deleteTasks(tasks) {
  const { store, i18n } = ctx;
  store.undoable(() => tasks.forEach((task) => store.removeTask(task.id)));
  undoToast(tasks.length === 1 ? i18n.t('toast.deleted') : i18n.t('toast.deletedMany', { n: tasks.length }));
}

// ---------- Task popover (stage 5 "fast organize"; also works on stage 4) ----------

function closePopover() {
  popover?.close();
  popover = null;
}

function openTaskPopover(id, anchor) {
  closePopover();
  const task = findTask(id);
  if (!task) return;
  const body = ctx.ui.h('div', { class: 'task-popover' });
  popover = ctx.ui.popover({ anchor, content: body, className: 'popover--task', label: task.title, onClose: () => { popover = null; } });
  showActions(task, body);
}

/** Swaps the popover content, re-positions it and focuses `focusEl`. */
function showView(body, children, focusEl) {
  body.replaceChildren(...children);
  popover?.reposition();
  focusEl?.focus();
  if (focusEl instanceof HTMLInputElement && focusEl.type === 'text') focusEl.select();
}

function actionButton(kind, label, onClick) {
  return ctx.ui.h(
    'button',
    { class: `action-btn action-btn--${kind}`, type: 'button', 'aria-label': label, title: label, onClick },
    ctx.ui.icon(kind, { size: 26 }),
  );
}

function textAction(label, onClick, extra = {}) {
  return ctx.ui.h('button', { class: 'task-popover__link', type: 'button', onClick, ...extra }, label);
}

function showActions(task, body) {
  const { ui, i18n } = ctx;
  const play = actionButton('play', i18n.t('popover.start'), () => showTimerPicker(task, body));
  const moveTo = textAction(i18n.t('popover.moveTo'), (event) => openMoveMenu(task, event.currentTarget), { 'aria-haspopup': 'menu' });
  showView(
    body,
    [
      ui.h('p', { class: 'task-popover__title' }, task.title),
      ui.h(
        'div',
        { class: 'task-popover__actions' },
        play,
        actionButton('calendar', i18n.t('popover.postpone'), () => showPostpone(task, body)),
        actionButton('forward', i18n.t('popover.nextDay'), () => sendToNextDay(task)),
      ),
      ui.h(
        'div',
        { class: 'task-popover__secondary' },
        textAction(i18n.t('popover.edit'), () => showEdit(task, body)),
        moveTo,
        textAction(i18n.t('popover.delete'), () => deleteTask(task), { class: 'task-popover__link task-popover__link--danger' }),
      ),
    ],
    play,
  );
}

function sendToNextDay(task) {
  closePopover();
  moveTasks([task], nextVisibleDay(task.date));
}

async function deleteTask(task) {
  const { ui, i18n } = ctx;
  if (await ui.confirm(i18n.t('confirm.deleteTask'), { okLabel: i18n.t('common.delete'), danger: true })) deleteTasks([task]);
}

function openMoveMenu(task, anchor) {
  const { ui, i18n } = ctx;
  ui.menu({
    anchor,
    items: QUADRANTS.filter((quadrant) => quadrant !== task.quadrant).map((quadrant) => ({
      label: i18n.quadrantLabel(quadrant),
      onSelect: () => moveToQuadrant(task, quadrant),
    })),
  });
}

/** Moves the task to the end of another quadrant; one undo reverts both changes. */
function moveToQuadrant(task, quadrant) {
  const { store } = ctx;
  const last = currentTasks().reduce((max, item) => Math.max(max, item.order + 1), Date.now());
  store.undoable(() => {
    store.setQuadrant(task.id, quadrant);
    store.reorderTask(task.id, last);
  });
}

// ----- ▶ Stopwatch / countdown picker -----

async function beginTimer(task, options) {
  if (await timer.start(task, options)) closePopover();
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
  showView(
    body,
    [
      ui.h('p', { class: 'task-popover__title' }, task.title),
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
        ),
        ui.h(
          'form',
          { class: 'timer-picker__custom-row', onSubmit: startCustom },
          custom,
          ui.h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, i18n.t('timer.start')),
        ),
      ),
    ],
    stopwatch,
  );
}

// ----- Edit title -----

function showEdit(task, body) {
  const { ui, i18n, store } = ctx;
  const input = ui.h('input', { class: 'task-popover__input', type: 'text', value: task.title, maxlength: 200, required: true, 'aria-label': i18n.t('board.editTitle') });
  const save = (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return input.focus();
    store.updateTask(task.id, { title });
    closePopover();
  };
  showView(body, [formView(save, () => showActions(task, body), input, i18n.t('common.save'))], input);
}

// ----- 📅 Postpone -----

function showPostpone(task, body) {
  const { ui, i18n, dates } = ctx;
  const today = dates.todayKey();
  const suggested = nextVisibleDay(task.date);
  const input = ui.h('input', {
    class: 'task-popover__input',
    type: 'date',
    min: today,
    required: true,
    value: suggested > today ? suggested : today,
    'aria-label': i18n.t('popover.postpone'),
  });
  const move = (event) => {
    event.preventDefault();
    const key = input.value;
    if (!dates.isValidKey(key) || key < today) return input.reportValidity();
    closePopover();
    moveTasks([task], key);
  };
  showView(body, [ui.h('p', { class: 'task-popover__hint' }, i18n.t('popover.postpone')), formView(move, () => showActions(task, body), input, i18n.t('popover.move'))], input);
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
