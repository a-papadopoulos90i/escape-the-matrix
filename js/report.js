// Time report: how long each task took, summed across every day it appeared, most time first.
// Lives here (not in a stage) so the Settings menu in the header can open it from anywhere.

import { timerElapsed } from './store.js';
import { formatTime } from './timer.js';

export function openTimeReport({ ui, store, i18n }) {
  const byTask = new Map(); // title -> { seconds, count }
  for (const task of store.get().tasks) {
    if (task.deleted || !task.timer) continue;
    const seconds = timerElapsed(task.timer);
    if (seconds <= 0) continue;
    const row = byTask.get(task.title) ?? { seconds: 0, count: 0 };
    row.seconds += seconds;
    row.count += 1;
    byTask.set(task.title, row);
  }
  const rows = [...byTask.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
  const total = rows.reduce((sum, [, row]) => sum + row.seconds, 0);
  const content = ui.h(
    'div',
    { class: 'analysis' },
    rows.length
      ? ui.h(
          'div',
          { class: 'analysis__list' },
          rows.map(([title, row]) =>
            ui.h(
              'div',
              { class: 'analysis__row' },
              ui.h('span', { class: 'analysis__task' }, title, row.count > 1 ? ui.h('span', { class: 'analysis__count' }, ` ${i18n.t('analysis.times', { n: row.count })}`) : null),
              ui.h('span', { class: 'analysis__time' }, formatTime(row.seconds)),
            ),
          ),
        )
      : ui.h('p', { class: 'analysis__empty text-muted' }, i18n.t('analysis.empty')),
    rows.length ? ui.h('div', { class: 'analysis__total' }, ui.h('span', null, i18n.t('analysis.total')), ui.h('span', null, formatTime(total))) : null,
  );
  ui.modal({ title: i18n.t('analysis.title'), content, actions: [{ label: i18n.t('common.close'), primary: true }] });
}
