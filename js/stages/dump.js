// Stage 2 — brain dump (SPEC §2). A faded, empty matrix sits in the background; centred over it
// is a stack of task rows: one inline-editable input per existing task, two placeholder rows
// ("......") for new tasks and a large "+" that adds another placeholder. Enter commits and moves
// on, Escape/blur discards an empty extra row, ✕ deletes (with Undo). "Next →" needs ≥ 1 task.

const MIN_BLANK_ROWS = 2;
const QUADRANT_COUNT = 4; // decorative background only

let state = null; // { ctx, date, root, tasksEl, blankEl, hintEl, nextButton, unsubscribe }

export function mount(container, ctx) {
  const { ui, i18n, dates } = ctx;
  const { t } = i18n;

  const tasksEl = ui.h('div', { class: 'dump__tasks' });
  const blankEl = ui.h('div', { class: 'dump__blank' });
  const addButton = ui.h(
    'button',
    { class: 'btn-icon dump__add', type: 'button', 'aria-label': t('dump.addRow'), onMousedown: keepFocus, onClick: addBlankRow },
    ui.icon('plus', { size: 28 }),
  );
  const hintEl = ui.h('p', { class: 'dump__hint text-muted', hidden: true }, t('dump.needTask'));
  const nav = ui.stageNav({ onBack: () => ctx.goTo(1), onNext: () => ctx.goTo(3), nextDisabled: true });

  const root = ui.h(
    'div',
    { class: 'stage-body dump' },
    ui.stageHeader({
      stage: 2,
      title: [t('stage.2.title'), ui.h('span', { class: 'stage-title__accent' }, t('stage.2.titleAccent'))],
      subtitle: dates.formatLong(ctx.getDate()),
    }),
    ui.h(
      'div',
      { class: 'dump__board' },
      ui.h('div', { class: 'matrix matrix--faded', 'aria-hidden': 'true' }, Array.from({ length: QUADRANT_COUNT }, () => ui.h('div', { class: 'quadrant' }))),
      ui.h('div', { class: 'dump__stack', 'data-tip-anchor': '' }, tasksEl, blankEl, addButton),
    ),
    hintEl,
    nav,
  );

  // The mounted date is fixed for this panel's lifetime (the shell re-mounts on a day change).
  state = { ctx, date: ctx.getDate(), root, tasksEl, blankEl, hintEl, nextButton: nav.querySelector('.stage-nav__next'), unsubscribe: null };
  for (let i = 0; i < MIN_BLANK_ROWS; i += 1) blankEl.append(blankRow());
  state.unsubscribe = ctx.store.subscribe(sync);
  sync();
  container.append(root);
}

export function unmount() {
  if (!state) return;
  for (const input of state.blankEl.querySelectorAll('input')) commitBlank(input); // keep typed text
  state.unsubscribe();
  state.root.remove();
  state = null;
}

/**
 * Buttons inside the stack keep the focus where it is: blurring an empty extra row would discard
 * it and shift the (centred) stack under the pointer before the click lands.
 */
function keepFocus(event) {
  event.preventDefault();
}

// ---------- Rendering ----------

/** Re-syncs rows with the store; task rows are keyed by id so focus and pending edits survive. */
function sync() {
  const { ctx, date, blankEl, hintEl, nextButton } = state;
  const tasks = ctx.store.tasksForDate(date);
  reconcileTaskRows(tasks);
  let n = tasks.length;
  for (const input of blankEl.querySelectorAll('input')) input.setAttribute('aria-label', label(++n));
  hintEl.hidden = tasks.length > 0;
  nextButton.disabled = tasks.length === 0;
  if (tasks.length) nextButton.removeAttribute('title');
  else nextButton.title = ctx.i18n.t('dump.needTask');
}

function reconcileTaskRows(tasks) {
  const { tasksEl } = state;
  const rows = new Map([...tasksEl.children].map((row) => [row.dataset.id, row]));
  const ids = new Set(tasks.map((task) => task.id));
  for (const [id, row] of rows) if (!ids.has(id)) row.remove();
  tasks.forEach((task, index) => {
    const row = rows.get(task.id) ?? taskRow(task.id);
    const input = row.querySelector('input');
    if (document.activeElement !== input) input.value = task.title;
    input.setAttribute('aria-label', label(index + 1));
    if (tasksEl.children[index] !== row) tasksEl.insertBefore(row, tasksEl.children[index] ?? null);
  });
}

function label(n) {
  return state.ctx.i18n.t('dump.taskLabel', { n });
}

function taskRow(id) {
  const { ui, i18n } = state.ctx;
  const input = ui.h('input', {
    class: 'dump-row__input',
    type: 'text',
    autocomplete: 'off',
    enterkeyhint: 'next',
    onKeydown: (event) => onTaskKeydown(event, id),
    onBlur: () => state && commitTask(id, input),
  });
  const remove = ui.h(
    'button',
    { class: 'btn-icon dump-row__delete', type: 'button', 'aria-label': i18n.t('dump.deleteTask'), onMousedown: keepFocus, onClick: () => deleteTask(id) },
    ui.icon('close', { size: 16 }),
  );
  return ui.h('div', { class: 'dump-row', dataset: { id } }, input, remove);
}

/** Placeholder row; `extra` marks rows added with "+" (the only ones that get discarded when empty). */
function blankRow({ extra = false } = {}) {
  const { ui, i18n } = state.ctx;
  const input = ui.h('input', {
    class: 'dump-row__input',
    type: 'text',
    placeholder: i18n.t('dump.placeholder'),
    autocomplete: 'off',
    enterkeyhint: 'next',
    onKeydown: onBlankKeydown,
    onBlur: onBlankBlur,
  });
  return ui.h('div', { class: 'dump-row dump-row--blank', dataset: extra ? { extra: '' } : null }, input);
}

// ---------- Existing task rows ----------

function findTask(id) {
  return state.ctx.store.findTask(id);
}

/** Saves an edited title; an emptied row deletes the task (undoable via the toast). */
function commitTask(id, input) {
  const task = findTask(id);
  if (!task) return;
  const title = input.value.trim();
  if (!title) deleteTask(id);
  else if (title !== task.title) state.ctx.store.updateTask(id, { title });
  else input.value = title;
}

function onTaskKeydown(event, id) {
  if (event.isComposing) return;
  const input = event.currentTarget;
  if (event.key === 'Enter') {
    event.preventDefault();
    const next = inputAfter(input.parentElement);
    commitTask(id, input);
    next?.focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    input.value = findTask(id)?.title ?? '';
  }
}

function deleteTask(id) {
  const { store, ui, i18n } = state.ctx;
  if (!findTask(id)) return;
  const row = state.tasksEl.querySelector(`[data-id="${id}"]`);
  const next = row?.contains(document.activeElement) ? inputAfter(row) : null;
  const token = store.removeTask(id);
  next?.focus();
  ui.toast(i18n.t('toast.deleted'), { action: { label: i18n.t('toast.undo'), onClick: () => store.undo(token) } }); // this toast reverts this delete only
}

/** The input of the row below `row` (falls back to the first placeholder). */
function inputAfter(row) {
  const next = row.nextElementSibling ?? state.blankEl.firstElementChild;
  return next?.querySelector('input') ?? null;
}

// ---------- Placeholder rows ----------

function commitBlank(input) {
  const title = input.value.trim();
  if (!title) return;
  input.value = '';
  state.ctx.store.addTask({ title, date: state.date });
}

function onBlankKeydown(event) {
  if (event.isComposing) return;
  const input = event.currentTarget;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitBlank(input); // the row empties again and stays focused, right under the new task
  } else if (event.key === 'Escape') {
    event.preventDefault();
    input.value = '';
    discardExtraRow(input.parentElement, true);
  }
}

function onBlankBlur(event) {
  if (!state || !document.hasFocus()) return; // window blur: keep the row for when the user returns
  const input = event.currentTarget;
  if (input.value.trim()) commitBlank(input);
  else discardExtraRow(input.parentElement, false);
}

function addBlankRow() {
  const row = blankRow({ extra: true });
  state.blankEl.append(row);
  sync();
  row.querySelector('input').focus();
}

/** Removes an empty placeholder row added with "+" (the two default rows always stay). */
function discardExtraRow(row, refocus) {
  if (!('extra' in row.dataset)) return;
  if (refocus) (row.previousElementSibling?.querySelector('input') ?? state.tasksEl.lastElementChild?.querySelector('input'))?.focus();
  row.remove();
  sync();
}
