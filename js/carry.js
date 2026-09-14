// Carry-over of unfinished tasks from earlier days (SPEC §2 Stage 4). A task pulled forward gets
// a fresh copy on the open day (attempt + 1, in the waiting list) while the original stays on its
// day as a faded red record that no longer counts. Shared by stages 2 and 4.

const MAX_DAYS_LISTED = 3;

// The four priority glyphs (exact Lovable Lucide icons: flame / star / users / trash).
export const QUAD_ICON = {
  do: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  plan: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  delegate: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  delete: '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};

/** The "N unfinished tasks left on … — Pull them here" strip, or null when there is nothing to pull. */
export function carryStrip(ctx, date) {
  const { store, ui, i18n, dates } = ctx;
  const pending = store.unfinishedBefore(date);
  if (!pending.length) return null;
  const n = pending.length;
  const days = [...new Set(pending.map((task) => task.date))];
  const listed = days.slice(0, MAX_DAYS_LISTED).map(dates.formatShort).join(', ');
  const extra = days.length > MAX_DAYS_LISTED ? ` +${days.length - MAX_DAYS_LISTED}` : '';
  const pull = () => {
    const token = store.carryOver(pending.map((task) => task.id), date);
    ui.toast(n === 1 ? i18n.t('carry.toastOne') : i18n.t('carry.toast', { n }), {
      action: { label: i18n.t('toast.undo'), onClick: () => store.undo(token) },
    });
  };
  return ui.h(
    'div',
    { class: 'carry-strip', role: 'status' },
    ui.h('span', { class: 'carry-strip__text' }, n === 1 ? i18n.t('carry.stripOne', { days: listed + extra }) : i18n.t('carry.strip', { n, days: listed + extra })),
    ui.h('button', { class: 'btn btn-sm carry-strip__pull', type: 'button', onClick: pull }, n === 1 ? i18n.t('carry.pullOne') : i18n.t('carry.pull')),
  );
}

/** The centred day switcher for the stage nav: the open day plus ‹ › to step to the previous / next
 *  day. Shared by stages 2, 3 and 4 so you can change day without going back to the calendar. */
export function dayNav(ctx) {
  return {
    label: ctx.dates.formatShort(ctx.getDate()),
    onPrev: () => ctx.setDate(ctx.dates.addDays(ctx.getDate(), -1)),
    onNext: () => ctx.setDate(ctx.dates.addDays(ctx.getDate(), 1)),
  };
}

/** "×3" badge for a task that is on the plan for the 3rd time; null for a first attempt. */
export function attemptBadge(ctx, task) {
  if (task.attempt < 2) return null;
  const title = ctx.i18n.attemptTitle(task.attempt);
  return ctx.ui.h('span', { class: 'attempt-badge', title, 'aria-label': title }, ctx.i18n.t('carry.attempt', { n: task.attempt }));
}

/** The quadrant's glyph in its own colour — for menu rows and tag buttons. `filled` paints it in. */
export function quadrantGlyph(ctx, quadrant, { size = 16, filled = true } = {}) {
  return ctx.ui.h('span', {
    class: `menu__glyph priority-icon--${quadrant}`,
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}">${QUAD_ICON[quadrant]}</svg>`,
  });
}

// Each quadrant as its two axes, urgency first: Do now = Urgent / Important, and so on.
const QUAD_AXES = {
  do: ['urgent', 'important'],
  plan: ['notUrgent', 'important'],
  delegate: ['urgent', 'notImportant'],
  delete: ['notUrgent', 'notImportant'],
};

/** "Urgent / Important" as three aligned columns, so the slashes line up down a menu. */
export function quadrantAxes(ctx, quadrant) {
  const [urgency, importance] = QUAD_AXES[quadrant];
  const { h } = ctx.ui;
  const { t } = ctx.i18n;
  return h(
    'span',
    { class: 'menu__axes' },
    h('span', null, t(`axis.word.${urgency}`)),
    h('span', { class: 'menu__axes-slash' }, ' / '),
    h('span', null, t(`axis.word.${importance}`)),
  );
}

/** "Pulled to Thu 17 Sep" label for a record left behind. */
export function recordLabel(ctx, task) {
  return ctx.ui.h('span', { class: 'record-label' }, ctx.i18n.t('carry.record', { date: ctx.dates.formatShort(task.carriedTo) }));
}
