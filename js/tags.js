// Priority tag controls, shared by Prioritize (placed cards and the waiting list) and the Write down
// list, so they look and behave the same everywhere: the priority button next to the title, the row
// of four tag glyphs, and the five-option priority menu.
import { QUADRANTS } from './store.js';
import { QUAD_ICON, quadrantGlyph, quadrantAxes } from './carry.js';

const TAG_OUTLINE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M3.5 11.6V4.6a1 1 0 0 1 1-1h7l8.4 8.4-8 8z"/><circle cx="7.6" cy="7.6" r="1.3"/></svg>';

/** The task's priority TAG, shown right before the title. It always opens the priority menu (placing a
 *  waiting task on the day is the separate insert icon on Prioritize). Untagged tasks show a muted tag glyph. */
export function priorityButton(ctx, task) {
  const { ui, i18n } = ctx;
  const glyph = task.tag
    ? `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${QUAD_ICON[task.tag]}</svg>`
    : TAG_OUTLINE;
  const label = i18n.t('board.changePriority');
  return ui.h(
    'button',
    {
      class: `task-card__priority ${task.tag ? `priority-icon--${task.tag}` : 'task-card__priority--none'}`,
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-label': label,
      title: label,
      dataset: { focusKey: `priority:${task.id}` },
      onClick: (event) => openPriorityMenu(ctx, task, event.currentTarget),
    },
    ui.h('span', { 'aria-hidden': 'true', html: glyph }),
  );
}

/** The four colour-coded glyphs that TAG an unplaced task (tap the active one again to clear it). */
export function tagPlaces(ctx, task) {
  return ctx.ui.h('div', { class: 'waiting-card__places' }, QUADRANTS.map((quadrant) => tagIconButton(ctx, task, quadrant)));
}

function tagIconButton(ctx, task, quadrant) {
  const { ui, i18n, store } = ctx;
  const active = task.tag === quadrant;
  return ui.h(
    'button',
    {
      class: `waiting-place waiting-place--${quadrant} ${active ? 'is-active' : ''}`.trim(),
      type: 'button',
      'aria-pressed': String(active),
      'aria-label': i18n.quadrantLabel(quadrant),
      title: i18n.quadrantLabel(quadrant),
      dataset: { focusKey: `tag:${task.id}:${quadrant}` },
      onClick: () => store.setTag(task.id, active ? null : quadrant),
    },
    ui.h('span', {
      'aria-hidden': 'true',
      html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${QUAD_ICON[quadrant]}</svg>`,
    }),
  );
}

/** The five-option priority menu. On a placed card it FILES the card: another priority moves it there
 *  (labelled to match), "No priority" sends it back to the waiting list. On an unplaced task it only
 *  sets the label, like the glyphs. No option is disabled: picking the current one simply closes the menu. */
export function openPriorityMenu(ctx, task, anchor) {
  const { ui, i18n, store } = ctx;
  const placed = task.quadrant !== null;
  const items = QUADRANTS.map((quadrant) => ({
    label: quadrantAxes(ctx, quadrant),
    iconEl: quadrantGlyph(ctx, quadrant),
    onSelect: () => (placed ? fileWithTag(ctx, task, quadrant) : store.setTag(task.id, quadrant)),
  }));
  items.push('-', {
    label: i18n.t('board.noTag'),
    icon: 'tag',
    onSelect: () => (placed ? fileWithTag(ctx, task, null) : store.setTag(task.id, null)),
  });
  ui.menu({ anchor, items });
}

/** Moves a task into `quadrant` of the open day with the matching label, or — with null — back to the
 *  waiting list with no label. One undo step. */
export function fileWithTag(ctx, task, quadrant) {
  const { store } = ctx;
  store.undoable(() => {
    if (quadrant) {
      const last = store.tasksForDate(ctx.getDate()).reduce((max, item) => Math.max(max, item.order + 1), Date.now());
      store.setQuadrant(task.id, quadrant, ctx.getDate());
      store.reorderTask(task.id, last);
    } else {
      store.setQuadrant(task.id, null);
    }
    store.setTag(task.id, quadrant);
  });
}
