// Stage 3 — place by priority (SPEC §2). The coloured 2×2 matrix (axis captions around it, no
// labels inside) with the day's unsorted tasks piled in the centre. A card is placed by dragging
// it with a mouse or finger (Pointer Events), by tap-to-place (select it, then tap a quadrant),
// with the keys 1–4, or through its "Place in ▾" menu. Placed cards can be moved again.
//
// Touch: a drag starts after a short press (LONG_PRESS_MS) so that a plain swipe over the cards
// still scrolls the page. Cards allow vertical panning (touch-action: pan-y in sort.css); once a
// card is lifted the touchmove events are cancelled so the page stays put under the finger.
import { QUADRANTS } from '../store.js';

const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag
const LONG_PRESS_MS = 250; // touch: hold this long (without moving) to lift a card
const SCROLL_EDGE = 56; // px from the viewport edge where a drag auto-scrolls the page
const SCROLL_STEP = 10;
const HINT_ID = 'sort-key-hint';

let state = null; // { ctx, date, root, bodies, pile, live, nextButton, selectedId, drag, suppressClick, unsubscribe }

export function mount(container, ctx) {
  const { ui, i18n } = ctx;
  const { t } = i18n;

  const header = ui.stageHeader({ stage: 3, title: t('stage.3.title') });
  header.append(ui.h('ul', { class: 'sort__bullets' }, i18n.priorityBullets.map((key) => ui.h('li', null, t(key)))));

  const bodies = {};
  const quadrants = QUADRANTS.map((quadrant) => {
    bodies[quadrant] = ui.h('div', { class: 'quadrant__body' });
    return ui.h(
      'div',
      { class: `quadrant quadrant--${quadrant}`, role: 'group', 'aria-label': i18n.quadrantName(quadrant), dataset: { quadrant } },
      ui.h('span', { class: 'quadrant__caption', 'aria-hidden': 'true' }, i18n.quadrantName(quadrant)),
      bodies[quadrant],
    );
  });
  const pile = ui.h('div', { class: 'sort__pile', role: 'group', 'aria-label': t('sort.pile'), 'data-tip-anchor': '' });
  const live = ui.h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const nav = ui.stageNav({ onBack: () => ctx.goTo(2), onNext: () => ctx.goTo(4) });

  const root = ui.h(
    'div',
    {
      class: 'stage-body sort',
      onPointerdown: onPointerDown,
      onPointermove: onPointerMove,
      onPointerup: onPointerUp,
      onPointercancel: onPointerCancel,
      onContextmenu: onContextMenu,
      onClick: onClick,
      onKeydown: onKeydown,
    },
    header,
    ui.h(
      'div',
      { class: 'sort__board' },
      axis(ui, 'x', [t('axis.urgent'), t('axis.notUrgent')]),
      axis(ui, 'y', [t('axis.important'), t('axis.notImportant')]),
      ui.h('div', { class: 'sort__stage' }, ui.h('div', { class: 'matrix' }, quadrants), pile),
    ),
    ui.h('p', { class: 'sort__hint text-muted', id: HINT_ID }, t('sort.keyHint')),
    live,
    nav,
  );

  state = {
    ctx,
    date: ctx.getDate(), // fixed for this panel's lifetime (the shell re-mounts on a day change)
    root,
    bodies,
    pile,
    live,
    nextButton: nav.querySelector('.stage-nav__next'),
    selectedId: null,
    drag: null,
    suppressClick: false,
    unsubscribe: null,
  };
  root.addEventListener('touchmove', onTouchMove, { passive: false }); // must be cancelable
  state.unsubscribe = ctx.store.subscribe(() => render());
  render();
  container.append(root);
}

export function unmount() {
  if (!state) return;
  endDrag();
  state.unsubscribe();
  state.root.remove();
  state = null;
}

// ---------- Rendering ----------

/** Axis captions: two cells over the columns (x) or beside the rows (y), rotated by CSS. */
function axis(ui, direction, labels) {
  return ui.h(
    'div',
    { class: `sort__axis sort__axis--${direction}`, 'aria-hidden': 'true' },
    labels.map((label) => ui.h('span', { class: 'sort__axis-cell' }, ui.h('span', { class: 'sort__axis-text' }, label))),
  );
}

/** Rebuilds every card from the store, keeping focus on the card that had it. */
function render(focusId) {
  const { ctx, bodies, pile, nextButton } = state;
  const { ui, i18n } = ctx;
  endDrag(); // a remote change mid-drag would detach the dragged card
  const focused = focusId ?? document.activeElement?.closest?.('.sort-card')?.dataset.id;
  const tasks = ctx.store.tasksForDate(state.date);
  const unsorted = tasks.filter((task) => task.quadrant === null);

  for (const quadrant of QUADRANTS) bodies[quadrant].replaceChildren(...tasks.filter((task) => task.quadrant === quadrant).map(cardEl));
  pile.replaceChildren(...(unsorted.length ? unsorted.map(cardEl) : [ui.h('p', { class: 'sort__done' }, i18n.t('sort.allPlaced'))]));
  nextButton.textContent = unsorted.length ? i18n.t('nav.nextUnsorted', { n: unsorted.length }) : i18n.t('nav.next');
  if (focused) focusCard(focused);
}

function cardEl(task) {
  const { ui, i18n } = state.ctx;
  const selected = task.id === state.selectedId;
  const classes = ['task-card', 'sort-card', task.done && 'task-card--done', selected && 'task-card--selected'].filter(Boolean).join(' ');
  return ui.h(
    'div',
    { class: classes, dataset: { id: task.id } },
    ui.h(
      'button',
      { class: 'sort-card__grab', type: 'button', 'aria-pressed': String(selected), 'aria-describedby': HINT_ID },
      ui.h('span', { class: 'task-card__title' }, task.title),
    ),
    ui.h(
      'button',
      { class: 'btn-icon sort-card__menu', type: 'button', 'aria-label': i18n.t('sort.placeIn'), 'aria-haspopup': 'menu' },
      ui.icon('chevron-down', { size: 16 }),
    ),
  );
}

function focusCard(id) {
  state.root.querySelector(`.sort-card[data-id="${id}"] .sort-card__grab`)?.focus({ preventScroll: true });
}

// ---------- Placing ----------

function findTask(id) {
  return state.ctx.store.findTask(id);
}

/** Moves a task into `quadrant` (null = back to the pile) and announces it. */
function place(id, quadrant, { focusNext = false } = {}) {
  const { store, i18n } = state.ctx;
  const task = findTask(id);
  if (!task || task.quadrant === quadrant) return;
  const nextFocus = focusNext ? (nextPileId(id) ?? id) : null;
  select(null);
  store.setQuadrant(id, quadrant);
  if (nextFocus) focusCard(nextFocus);
  state.live.textContent = quadrant ? i18n.t('sort.placed', { quadrant: i18n.quadrantName(quadrant) }) : i18n.t('quadrant.unsorted');
}

/** Id of the pile card after `id` (or the first one), so keyboard placing flows down the pile. */
function nextPileId(id) {
  const ids = [...state.pile.querySelectorAll('.sort-card')].map((card) => card.dataset.id);
  const rest = ids.filter((other) => other !== id);
  return rest[Math.min(Math.max(ids.indexOf(id), 0), rest.length - 1)] ?? null;
}

/** Tap-to-place selection: one card at a time; quadrants become tap targets while set. */
function select(id) {
  state.selectedId = id;
  for (const card of state.root.querySelectorAll('.sort-card')) {
    const on = card.dataset.id === id;
    card.classList.toggle('task-card--selected', on);
    card.querySelector('.sort-card__grab').setAttribute('aria-pressed', String(on));
  }
  state.root.classList.toggle('sort--selecting', id !== null);
}

function openMenu(id, anchor) {
  const { ui, i18n } = state.ctx;
  const task = findTask(id);
  if (!task) return;
  const items = QUADRANTS.map((quadrant, index) => ({
    label: `${index + 1}. ${i18n.quadrantName(quadrant)}`,
    disabled: task.quadrant === quadrant,
    onSelect: () => place(id, quadrant, { focusNext: true }),
  }));
  items.push('-', { label: i18n.t('quadrant.unsorted'), disabled: task.quadrant === null, onSelect: () => place(id, null, { focusNext: true }) });
  ui.menu({ anchor, items });
}

// ---------- Click & keyboard (delegated on the stage root) ----------
// Every handler tolerates `state === null`: a click on "Next →" unmounts the stage while the
// event is still bubbling up to the (now detached) root.

function onClick(event) {
  if (!state || state.suppressClick) return; // the click that follows a completed drag
  const menuButton = event.target.closest('.sort-card__menu');
  if (menuButton) return openMenu(menuButton.closest('.sort-card').dataset.id, menuButton);
  const card = event.target.closest('.sort-card');
  if (card) return select(state.selectedId === card.dataset.id ? null : card.dataset.id);
  const quadrant = event.target.closest('.quadrant');
  if (quadrant && state.selectedId) place(state.selectedId, quadrant.dataset.quadrant);
}

function onKeydown(event) {
  if (!state || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Escape' && state.selectedId !== null && !state.ctx.ui.hasOpenOverlay()) {
    event.preventDefault();
    return select(null);
  }
  const card = event.target.closest('.sort-card');
  const index = ['1', '2', '3', '4'].indexOf(event.key);
  if (!card || index < 0) return;
  event.preventDefault();
  place(card.dataset.id, QUADRANTS[index], { focusNext: true });
}

// ---------- Drag & drop (Pointer Events: mouse, pen and touch alike) ----------

function onPointerDown(event) {
  if (!state || event.button !== 0 || !event.isPrimary || state.drag) return;
  const card = event.target.closest('.sort-card');
  if (!card || event.target.closest('.sort-card__menu')) return;
  const touch = event.pointerType === 'touch';
  state.drag = {
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
  if (!touch) return card.setPointerCapture(event.pointerId);
  // Touch: lift after a still press; the pointer is captured then (a swipe before that scrolls).
  state.drag.press = setTimeout(() => {
    const drag = state?.drag;
    if (!drag || drag.active) return;
    drag.card.setPointerCapture(drag.pointerId);
    liftCard(drag);
    drag.ghost.style.transform = `translate(${drag.lastX - drag.offsetX}px, ${drag.lastY - drag.offsetY}px)`;
  }, LONG_PRESS_MS);
}

function onPointerMove(event) {
  const drag = state?.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  if (!drag.active) {
    if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) < DRAG_THRESHOLD) return;
    if (drag.touch) return endDrag(); // moved before the press completed: a scroll, not a drag
    liftCard(drag);
  }
  drag.ghost.style.transform = `translate(${drag.lastX - drag.offsetX}px, ${drag.lastY - drag.offsetY}px)`;
  setDropTarget(drag, quadrantAt(drag.lastX, drag.lastY));
}

/** While a card is lifted the page must not scroll under the finger (touch-action allows pan-y). */
function onTouchMove(event) {
  if (state?.drag?.active && event.cancelable) event.preventDefault();
}

/** A long press is how a touch drag starts, so the browser's long-press menu must not open. */
function onContextMenu(event) {
  if (state?.drag?.touch) event.preventDefault();
}

function onPointerUp(event) {
  const drag = state?.drag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { id, active, target } = drag;
  endDrag();
  if (!active) return; // a plain press: the click handler takes over
  state.suppressClick = true;
  setTimeout(() => state && (state.suppressClick = false), 0);
  if (target) place(id, target.dataset.quadrant);
}

function onPointerCancel(event) {
  if (state?.drag && event.pointerId === state.drag.pointerId) endDrag();
}

/** Turns the press into a drag: a fixed ghost follows the pointer, the original card dims. */
function liftCard(drag) {
  const rect = drag.card.getBoundingClientRect();
  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;
  const ghost = drag.card.cloneNode(true);
  ghost.className = 'task-card sort-card sort-ghost task-card--dragging';
  ghost.removeAttribute('data-id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.style.width = `${rect.width}px`;
  document.body.append(ghost);
  drag.ghost = ghost;
  drag.active = true;
  drag.card.classList.add('sort-card--lifted');
  state.root.classList.add('sort--dragging');
  select(null);
  drag.raf = requestAnimationFrame(() => autoScroll(drag));
}

function quadrantAt(x, y) {
  const quadrant = document.elementFromPoint(x, y)?.closest('.quadrant');
  return quadrant && state.root.contains(quadrant) ? quadrant : null;
}

function setDropTarget(drag, quadrant) {
  if (drag.target === quadrant) return;
  drag.target?.classList.remove('is-drop-target');
  quadrant?.classList.add('is-drop-target');
  drag.target = quadrant;
}

/** Scrolls the page while the pointer rests near the top/bottom edge (stacked mobile layout). */
function autoScroll(drag) {
  if (state?.drag !== drag) return;
  const dy = drag.lastY < SCROLL_EDGE ? -SCROLL_STEP : drag.lastY > window.innerHeight - SCROLL_EDGE ? SCROLL_STEP : 0;
  if (dy) {
    window.scrollBy(0, dy);
    setDropTarget(drag, quadrantAt(drag.lastX, drag.lastY));
  }
  drag.raf = requestAnimationFrame(() => autoScroll(drag));
}

function endDrag() {
  const drag = state?.drag;
  if (!drag) return;
  state.drag = null;
  clearTimeout(drag.press);
  cancelAnimationFrame(drag.raf);
  drag.ghost?.remove();
  drag.target?.classList.remove('is-drop-target');
  drag.card.classList.remove('sort-card--lifted');
  state.root.classList.remove('sort--dragging');
  if (drag.card.hasPointerCapture(drag.pointerId)) drag.card.releasePointerCapture(drag.pointerId);
}
