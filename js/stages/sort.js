// Stage 3 — set priorities. A single "Your tasks" list: the global backlog plus the tasks placed
// on this day. Each card carries the four colour-coded priority icons (Do now / Schedule /
// Delegate / Drop) and a red ✕. Tapping an icon TAGS the task with that priority — the active one is
// ringed green and the card stays in the list; tapping the active icon again untags it (back to the
// backlog). There is no matrix here — the board (Stage 4) shows the tagged tasks in their quadrants.
import { isRecord, QUADRANTS } from '../store.js';
import { attemptBadge, dayNav, priorityIcons, QUAD_ICON } from '../carry.js';

const HINT_ID = 'sort-key-hint';

let state = null; // { ctx, date, root, matrixEl, listEl, live, nextButton, unsubscribe }

export function mount(container, ctx) {
  const { ui, i18n } = ctx;
  const { t } = i18n;

  const header = ui.stageHeader({ stage: 3, title: t('stage.3.title'), kicker: false });
  const matrixEl = ui.h('div', { class: 'matrix sort__matrix' });
  const listEl = ui.h('div', { class: 'sort__list', role: 'list', 'aria-label': t('sort.pile') });
  const live = ui.h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const nav = ui.stageNav({ onBack: () => ctx.goTo(2), onNext: () => ctx.goTo(4), day: dayNav(ctx) });

  const root = ui.h(
    'div',
    { class: 'stage-body sort', onClick },
    nav,
    header,
    matrixEl,
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
    ui.stageKicker(3),
  );

  state = {
    ctx,
    date: ctx.getDate(), // fixed for this panel's lifetime (the shell re-mounts on a day change)
    root,
    matrixEl,
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

/** Tasks placed in a quadrant on the day being viewed — what the four boxes show. */
function placedToday() {
  return state.ctx.store.tasksForDate(state.date).filter((task) => task.quadrant !== null && !isRecord(task));
}

function render() {
  const { ctx, matrixEl, listEl, nextButton } = state;
  const { ui, i18n } = ctx;
  const focusedId = document.activeElement?.closest?.('.sort-card')?.dataset.id;
  const focusedQuadrant = document.activeElement?.closest?.('.priority-icon')?.dataset.quadrant;
  const today = placedToday();
  const all = ctx.store.allTasks(); // the fixed list: every open task, whatever its day

  matrixEl.replaceChildren(...QUADRANTS.map((quadrant) => quadrantBox(quadrant, today.filter((task) => task.quadrant === quadrant))));
  listEl.replaceChildren(...(all.length ? all.map(cardEl) : [ui.h('p', { class: 'sort__done' }, i18n.t('sort.empty'))]));
  nextButton.textContent = i18n.t('nav.next'); // same wording on every stage

  if (focusedId) {
    const card = listEl.querySelector(`.sort-card[data-id="${focusedId}"]`);
    const target = (focusedQuadrant && card?.querySelector(`.priority-icon--${focusedQuadrant}`)) || card?.querySelector('.priority-icon');
    target?.focus({ preventScroll: true });
  }
}

/** One of the four boxes: the same look as the board, listing what this day holds. */
function quadrantBox(quadrant, tasks) {
  const { ui, i18n } = state.ctx;
  const labelId = `sort-quadrant-${quadrant}-label`;
  return ui.h(
    'section',
    { class: `quadrant quadrant--${quadrant}`, 'aria-labelledby': labelId, dataset: { quadrant } },
    ui.h(
      'header',
      { class: 'quadrant__head' },
      ui.h('span', {
        class: `quadrant__icon quadrant__icon--${quadrant}`,
        'aria-hidden': 'true',
        html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">${QUAD_ICON[quadrant]}</svg>`,
      }),
      ui.h(
        'div',
        { class: 'quadrant__heading' },
        ui.h('h3', { class: 'quadrant__label', id: labelId }, i18n.quadrantLabel(quadrant)),
        ui.h('p', { class: 'quadrant__sub' }, i18n.quadrantName(quadrant)),
      ),
      ui.h('span', { class: 'quadrant__count', 'aria-hidden': 'true' }, String(tasks.length)),
    ),
    ui.h('div', { class: 'quadrant__body' }, tasks.map((task) => ui.h('p', { class: 'sort__placed-item' }, task.title))),
  );
}

function cardEl(task) {
  const { ui } = state.ctx;
  // The tag lights up only when this task is placed here on the day being viewed.
  const activeQuadrant = task.date === state.date ? task.quadrant : null;
  const classes = ['task-card', 'sort-card', task.done && 'task-card--done'].filter(Boolean).join(' ');
  return ui.h(
    'div',
    { class: classes, dataset: { id: task.id }, role: 'listitem' },
    ui.h('span', { class: 'sort-card__title' }, attemptBadge(state.ctx, task), ui.h('span', { class: 'task-card__title' }, task.title)),
    priorityIcons(state.ctx, task, activeQuadrant),
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

/** Tags a task with `quadrant` for the day being viewed, or untags it when that tag is already set
 *  on this day. Tagging also moves the task onto this day — that is how you choose *when*. */
function tag(id, quadrant) {
  const { store, i18n } = state.ctx;
  const task = findTask(id);
  if (!task) return;
  const taggedHere = task.date === state.date && task.quadrant === quadrant;
  const next = taggedHere ? null : quadrant;
  store.setQuadrant(id, next, state.date);
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
