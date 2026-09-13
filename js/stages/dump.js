// Stage 2 — "Write it all down". A single "What's on your mind?" field with an Add button, then the
// global backlog: a numbered list of every unplaced task (the same list on every day; each editable,
// with a ✕), kept until an item is placed in a quadrant, ticked done, or deleted. At the bottom,
// when earlier days still hold unfinished placed tasks, a "Pull them here" button and their list.
import { attemptBadge, dayNav } from '../carry.js';

const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

let state = null; // { ctx, date, root, listEl, addInput, carryEl, hintEl, nextButton, unsubscribe }

export function mount(container, ctx) {
  const { ui, i18n } = ctx;
  const { t } = i18n;

  const addInput = ui.h('input', {
    class: 'dump__input',
    type: 'text',
    maxlength: 200,
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder: t('dump.whatsOnYourMind'),
    'aria-label': t('dump.whatsOnYourMind'),
  });
  const addForm = ui.h(
    'form',
    { class: 'dump__add', onSubmit: onAdd },
    ui.h('span', { class: 'dump__add-icon', 'aria-hidden': 'true', html: PENCIL }),
    addInput,
    ui.h('button', { class: 'btn btn-primary dump__add-btn', type: 'submit' }, ui.icon('plus', { size: 16 }), t('dump.add')),
  );

  const listEl = ui.h('div', { class: 'dump__list' });
  const hintEl = ui.h('p', { class: 'dump__hint text-muted', hidden: true }, t('dump.needTask'));
  const carryEl = ui.h('div', { class: 'dump__carry' });
  const nav = ui.stageNav({ onBack: () => ctx.goTo(1), onNext: () => ctx.goTo(3), nextDisabled: true });

  const root = ui.h(
    'div',
    { class: 'stage-body dump' },
    ui.stageDayBar(dayNav(ctx)),
    ui.stageHeader({ stage: 2, title: t('stage.2.title'), subtitle: t('stage.2.subtitle') }),
    addForm,
    listEl,
    hintEl,
    carryEl,
    nav,
  );

  // The mounted date is fixed for this panel's lifetime (the shell re-mounts on a day change).
  state = { ctx, date: ctx.getDate(), root, listEl, addInput, carryEl, hintEl, nextButton: nav.querySelector('.stage-nav__next'), unsubscribe: null };
  sync();
  state.unsubscribe = ctx.store.subscribe(sync);
  container.append(root);
  addInput.focus();
}

export function unmount() {
  if (!state) return;
  state.unsubscribe();
  state.root.remove();
  state = null;
}

/** Keeps focus where it is when a mouse-only button (✕) is pressed. */
function keepFocus(event) {
  event.preventDefault();
}

// ---------- Add ----------

function onAdd(event) {
  event.preventDefault();
  const title = state.addInput.value.trim();
  if (!title) return;
  state.ctx.store.addTask({ title, date: state.date });
  state.addInput.value = '';
  state.addInput.focus();
}

// ---------- Rendering ----------

function sync() {
  const { ctx, hintEl, nextButton } = state;
  const tasks = ctx.store.waitingTasks(); // the global backlog — the same list on every day
  reconcileRows(tasks);
  hintEl.hidden = tasks.length > 0;
  nextButton.disabled = tasks.length === 0;
  nextButton.title = tasks.length ? '' : ctx.i18n.t('dump.needTask');
  renderCarry();
}

/** Rebuilds the numbered list, keyed by id so focus and pending edits survive re-renders. */
function reconcileRows(tasks) {
  const { listEl } = state;
  const rows = new Map([...listEl.children].map((row) => [row.dataset.id, row]));
  const ids = new Set(tasks.map((task) => task.id));
  for (const [id, row] of rows) if (!ids.has(id)) row.remove();
  tasks.forEach((task, index) => {
    const row = rows.get(task.id) ?? taskRow(task);
    row.querySelector('.dump-row__num').textContent = String(index + 1);
    const input = row.querySelector('input');
    if (document.activeElement !== input) input.value = task.title;
    input.setAttribute('aria-label', state.ctx.i18n.t('dump.taskLabel', { n: index + 1 }));
    if (listEl.children[index] !== row) listEl.insertBefore(row, listEl.children[index] ?? null);
  });
}

function taskRow(task) {
  const { ui, i18n } = state.ctx;
  const { id } = task;
  const input = ui.h('input', {
    class: 'dump-row__input',
    type: 'text',
    maxlength: 200,
    autocomplete: 'off',
    onKeydown: (event) => onRowKeydown(event, id),
    onBlur: () => state && commitRow(id, input),
  });
  const remove = ui.h(
    'button',
    { class: 'dump-row__delete', type: 'button', tabindex: -1, 'aria-label': i18n.t('dump.deleteTask'), onMousedown: keepFocus, onClick: () => deleteTask(id) },
    ui.icon('close', { size: 16 }),
  );
  return ui.h(
    'div',
    { class: 'dump-row', dataset: { id } },
    ui.h('span', { class: 'dump-row__num', 'aria-hidden': 'true' }),
    attemptBadge(state.ctx, task),
    input,
    remove,
  );
}

function findTask(id) {
  return state.ctx.store.findTask(id);
}

/** Saves an edited title; an emptied row deletes the task (undoable via the toast). */
function commitRow(id, input) {
  const task = findTask(id);
  if (!task) return;
  const title = input.value.trim();
  if (!title) deleteTask(id);
  else if (title !== task.title) state.ctx.store.updateTask(id, { title });
  else input.value = title;
}

function onRowKeydown(event, id) {
  if (event.isComposing) return;
  const input = event.currentTarget;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitRow(id, input);
    state.addInput.focus(); // back to the "what's on your mind?" field to keep going
  } else if (event.key === 'Escape') {
    event.preventDefault();
    input.value = findTask(id)?.title ?? '';
    input.blur();
  }
}

function deleteTask(id) {
  const { store, ui, i18n } = state.ctx;
  if (!findTask(id)) return;
  const token = store.removeTask(id);
  ui.toast(i18n.t('toast.deleted'), { action: { label: i18n.t('toast.undo'), onClick: () => store.undo(token) } });
}

// ---------- Carry-over (bottom): pull unfinished tasks from earlier days ----------

function renderCarry() {
  const { ctx, date, carryEl } = state;
  const { ui, i18n, dates } = ctx;
  const pending = ctx.store.unfinishedBefore(date);
  if (!pending.length) return carryEl.replaceChildren();

  const n = pending.length;
  const days = [...new Set(pending.map((task) => task.date))].slice(0, 3).map(dates.formatShort).join(', ');
  const pull = ui.h(
    'button',
    { class: 'btn btn-sm carry-strip__pull', type: 'button', onClick: () => pullAll(pending) },
    n === 1 ? i18n.t('carry.pullOne') : i18n.t('carry.pull'),
  );
  const list = ui.h(
    'div',
    { class: 'dump__carry-list' },
    pending.map((task) =>
      ui.h(
        'div',
        { class: 'dump__carry-item' },
        attemptBadge(ctx, task),
        ui.h('span', { class: 'dump__carry-title' }, task.title),
        ui.h('span', { class: 'dump__carry-date' }, dates.formatShort(task.date)),
      ),
    ),
  );
  carryEl.replaceChildren(
    ui.h(
      'div',
      { class: 'dump__carry-head' },
      ui.h('span', { class: 'dump__carry-text' }, n === 1 ? i18n.t('carry.stripOne', { days }) : i18n.t('carry.strip', { n, days })),
      pull,
    ),
    list,
  );
}

function pullAll(pending) {
  const { store, ui, i18n } = state.ctx;
  const token = store.carryOver(pending.map((task) => task.id), state.date);
  ui.toast(pending.length === 1 ? i18n.t('carry.toastOne') : i18n.t('carry.toast', { n: pending.length }), {
    action: { label: i18n.t('toast.undo'), onClick: () => store.undo(token) },
  });
}
