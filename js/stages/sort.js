// Stage 3 — set priorities. A single "Your tasks" list: the global backlog plus the tasks placed
// on this day. Each card carries the four colour-coded priority icons (Do now / Schedule /
// Delegate / Drop) and a red ✕. Tapping an icon TAGS the task with that priority — the active one is
// ringed green and the card stays in the list; tapping the active icon again untags it (back to the
// backlog). There is no matrix here — the board (Stage 4) shows the tagged tasks in their quadrants.
import { isRecord } from '../store.js';
import { attemptBadge, dayNav, priorityIcons } from '../carry.js';

const HINT_ID = 'sort-key-hint';

let state = null; // { ctx, date, root, listEl, live, nextButton, unsubscribe }

export function mount(container, ctx) {
  const { ui, i18n } = ctx;
  const { t } = i18n;

  const header = ui.stageHeader({ stage: 3, title: t('stage.3.title') });
  const listEl = ui.h('div', { class: 'sort__list', role: 'list', 'aria-label': t('sort.pile') });
  const live = ui.h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const nav = ui.stageNav({ onBack: () => ctx.goTo(2), onNext: () => ctx.goTo(4) });

  const root = ui.h(
    'div',
    { class: 'stage-body sort', onClick },
    ui.stageDayBar(dayNav(ctx)),
    header,
    ui.h(
      'section',
      { class: 'sort__list-panel' },
      ui.h(
        'div',
        { class: 'sort__list-head' },
        ui.h('h3', { class: 'sort__list-title' }, t('sort.listTitle')),
        ui.h('p', { class: 'sort__list-hint text-muted', id: HINT_ID }, t('sort.listHint')),
      ),
      listEl,
    ),
    live,
    nav,
  );

  state = {
    ctx,
    date: ctx.getDate(), // fixed for this panel's lifetime (the shell re-mounts on a day change)
    root,
    listEl,
    live,
    nextButton: nav.querySelector('.stage-nav__next'),
    unsubscribe: null,
  };
  state.unsubscribe = ctx.store.subscribe(() => render());
  render();
  container.append(root);
}

export function unmount() {
  if (!state) return;
  state.unsubscribe();
  state.root.remove();
  state = null;
}

// ---------- Rendering ----------

/** The stage-3 list: the global backlog plus this day's placed tasks, oldest first. */
function cards() {
  const backlog = state.ctx.store.waitingTasks();
  const placed = state.ctx.store.tasksForDate(state.date).filter((task) => task.quadrant !== null && !isRecord(task));
  return { backlog, all: [...backlog, ...placed].sort((a, b) => a.order - b.order) };
}

function render() {
  const { ctx, listEl, nextButton } = state;
  const { ui, i18n } = ctx;
  const focusedId = document.activeElement?.closest?.('.sort-card')?.dataset.id;
  const focusedQuadrant = document.activeElement?.closest?.('.priority-icon')?.dataset.quadrant;
  const { backlog, all } = cards();

  listEl.replaceChildren(...(all.length ? all.map(cardEl) : [ui.h('p', { class: 'sort__done' }, i18n.t('sort.empty'))]));
  nextButton.textContent = backlog.length ? i18n.t('nav.nextWaiting', { n: backlog.length }) : i18n.t('nav.next');

  if (focusedId) {
    const card = listEl.querySelector(`.sort-card[data-id="${focusedId}"]`);
    const target = (focusedQuadrant && card?.querySelector(`.priority-icon--${focusedQuadrant}`)) || card?.querySelector('.priority-icon');
    target?.focus({ preventScroll: true });
  }
}

function cardEl(task) {
  const { ui } = state.ctx;
  const classes = ['task-card', 'sort-card', task.done && 'task-card--done'].filter(Boolean).join(' ');
  return ui.h(
    'div',
    { class: classes, dataset: { id: task.id }, role: 'listitem' },
    ui.h('span', { class: 'sort-card__title' }, attemptBadge(state.ctx, task), ui.h('span', { class: 'task-card__title' }, task.title)),
    priorityIcons(state.ctx, task),
    deleteButton(task),
  );
}

function deleteButton(task) {
  const { ui, i18n } = state.ctx;
  return ui.h(
    'button',
    {
      class: 'btn-icon sort-card__delete',
      type: 'button',
      'aria-label': `${i18n.t('board.deleteTask')}: ${task.title}`,
      title: i18n.t('board.deleteTask'),
      dataset: { del: task.id },
    },
    ui.icon('close', { size: 15 }),
  );
}

// ---------- Tagging & deleting (delegated on the stage root) ----------

function findTask(id) {
  return state.ctx.store.findTask(id);
}

/** Tags a task with `quadrant`, or untags it (back to the backlog) when that priority is already set. */
function tag(id, quadrant) {
  const { store, i18n } = state.ctx;
  const task = findTask(id);
  if (!task) return;
  const next = task.quadrant === quadrant ? null : quadrant;
  store.setQuadrant(id, next, state.date); // placing assigns the task to this day; untagging leaves the date
  state.live.textContent = next ? i18n.t('sort.placed', { quadrant: i18n.quadrantName(next) }) : i18n.t('quadrant.unsorted');
}

function del(id) {
  const { store, ui, i18n } = state.ctx;
  const token = store.removeTask(id);
  if (token) ui.toast(i18n.t('toast.deleted'), { action: { label: i18n.t('toast.undo'), onClick: () => store.undo(token) } });
}

function onClick(event) {
  if (!state) return; // a click on "Next →" unmounts the stage while the event still bubbles
  const remove = event.target.closest('.sort-card__delete');
  if (remove) return del(remove.dataset.del);
  const icon = event.target.closest('.priority-icon');
  if (icon) return tag(icon.closest('.sort-card').dataset.id, icon.dataset.quadrant);
}
