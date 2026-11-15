// Deleted: the tasks deleted in the last 30 days, by the day they were deleted, newest first, each with
// Restore. They are kept that long anyway (so the deletion reaches every device), then they are gone for
// good. Opened from the round button beside Done and the Time report.

import { canAddTask } from './plan.js';

const DOT = { do: 'var(--red)', plan: 'var(--yellow)', delegate: 'var(--blue)', delete: 'var(--gray)' };
const pad = (n) => String(n).padStart(2, '0');
const localDay = (iso) => {
  const at = new Date(iso);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/** Deleted tasks, grouped by the day they were deleted, newest first. The "pulled to…" records that went
 *  with a task are not listed: they come back with it. */
export function deletedDays(tasks) {
  const byDay = new Map();
  const deleted = tasks.filter((task) => task.deleted && task.carriedTo === null && task.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  for (const task of deleted) {
    const day = localDay(task.deletedAt);
    byDay.set(day, [...(byDay.get(day) ?? []), task]);
  }
  return [...byDay].map(([date, list]) => ({ date, tasks: list }));
}

export function openDeleted({ ui, store, i18n, dates, onSeePlans }) {
  const { t } = i18n;
  const content = ui.h('div', { class: 'history trash' });
  const today = dates.todayKey();
  const dayLabel = (key) => (key === today ? t('trash.today') : key === dates.addDays(today, -1) ? t('trash.yesterday') : dates.formatShort(key));
  const whereLabel = (task) => (task.quadrant === null ? t('trash.wasWaiting') : t('trash.wasOn', { date: dates.formatShort(task.date) }));

  function restore(task) {
    if (!canAddTask({ store, ui, i18n, onSeePlans: onSeePlans && (() => (api.close(), onSeePlans())) })) return; // Free at 100
    const token = store.restoreTask(task.id);
    render();
    ui.toast(task.quadrant === null ? t('trash.restoredWaiting') : t('trash.restoredTo', { date: dates.formatShort(task.date) }), {
      action: { label: t('toast.undo'), onClick: () => (store.undo(token), content.isConnected && render()) },
    });
  }

  function taskRow(task) {
    const colour = DOT[task.quadrant ?? task.tag];
    return ui.h(
      'li',
      { class: `history__task trash__task ${task.done ? 'is-done' : ''}`.trim() },
      ui.h('span', { class: 'history__dot', style: colour ? `background: ${colour}` : null, 'aria-hidden': 'true' }),
      ui.h('span', { class: 'history__title' }, task.title),
      ui.h('span', { class: 'trash__where' }, whereLabel(task)),
      ui.h(
        'button',
        { class: 'btn btn-sm trash__restore', type: 'button', 'aria-label': `${t('trash.restore')}: ${task.title}`, onClick: () => restore(task) },
        ui.icon('undo', { size: 14 }),
        t('trash.restore'),
      ),
    );
  }

  function render() {
    const days = deletedDays(store.get().tasks);
    content.replaceChildren(
      ui.h('p', { class: 'trash__lead text-muted' }, t('trash.lead')),
      days.length
        ? ui.h(
            'div',
            { class: 'history__list' },
            days.map((day) =>
              ui.h(
                'section',
                { class: 'history__day' },
                ui.h('div', { class: 'history__day-head' }, ui.h('h3', null, dayLabel(day.date)), ui.h('span', { class: 'history__count' }, t('trash.dayCount', { n: day.tasks.length }))),
                ui.h('ul', { class: 'history__tasks' }, day.tasks.map(taskRow)),
              ),
            ),
          )
        : ui.h('p', { class: 'history__empty text-muted' }, t('trash.empty')),
    );
  }

  render();
  const api = ui.modal({ title: t('trash.title'), content, className: 'modal--history', actions: [{ label: t('common.close'), primary: true }] });
  return api;
}
