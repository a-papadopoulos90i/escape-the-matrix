// Carry-over of unfinished tasks from earlier days (SPEC §2 Stage 4). A task pulled forward gets
// a fresh copy on the open day (attempt + 1, in the waiting list) while the original stays on its
// day as a faded red record that no longer counts. Shared by stages 2 and 4.

const MAX_DAYS_LISTED = 3;

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

/** "×3" badge for a task that is on the plan for the 3rd time; null for a first attempt. */
export function attemptBadge(ctx, task) {
  if (task.attempt < 2) return null;
  const title = ctx.i18n.attemptTitle(task.attempt);
  return ctx.ui.h('span', { class: 'attempt-badge', title, 'aria-label': title }, ctx.i18n.t('carry.attempt', { n: task.attempt }));
}

/** "Pulled to Thu 17 Sep" label for a record left behind. */
export function recordLabel(ctx, task) {
  return ctx.ui.h('span', { class: 'record-label' }, ctx.i18n.t('carry.record', { date: ctx.dates.formatShort(task.carriedTo) }));
}
