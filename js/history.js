// Done: every finished task, by the day it was on, newest first — with how many were done today, this
// week, this month and ever. Finished work counts against Free's 100 tasks (it is the history the
// numbers come from), so this is also where room is made: a task, a day or everything at once, each
// with Undo. Lives here (not in a stage) so the header and the limit messages can open it from anywhere.

import { isPro, FREE_TASK_LIMIT, taskCount } from './plan.js';
import { proLock } from './pro-lock.js';
import { timerElapsed } from './store.js';
import { formatTime } from './timer.js';

const DAYS_PER_PAGE = 14;
const DOT = { do: 'var(--red)', plan: 'var(--yellow)', delegate: 'var(--blue)', delete: 'var(--gray)' };

/** Finished tasks grouped by day, newest day first; each day's tasks latest-finished first. */
export function doneDays(tasks) {
  const byDay = new Map();
  for (const task of tasks) {
    if (task.deleted || !task.done || task.carriedTo !== null) continue;
    const day = byDay.get(task.date) ?? [];
    day.push(task);
    byDay.set(task.date, day);
  }
  for (const list of byDay.values()) list.sort((a, b) => String(b.doneAt ?? '').localeCompare(String(a.doneAt ?? '')));
  return [...byDay].sort(([a], [b]) => b.localeCompare(a)).map(([date, list]) => ({ date, tasks: list }));
}

export function openDoneHistory({ ui, store, i18n, dates, onSeePlans }) {
  const { t } = i18n;
  const content = ui.h('div', { class: 'history' });
  let shown = DAYS_PER_PAGE;
  let armed = false; // "Delete all" asks for a second press
  let disarm = null;

  const thisYear = dates.todayKey().slice(0, 4);
  const dayLabel = (key) => (key.slice(0, 4) === thisYear ? dates.formatShort(key) : `${dates.formatShort(key)} ${key.slice(0, 4)}`);

  function remove(ids) {
    const token = ids.length === 1 ? store.removeTask(ids[0]) : store.removeTasks(ids);
    render();
    ui.toast(ids.length === 1 ? t('history.deletedOne') : t('history.deletedMany', { n: ids.length }), {
      action: { label: t('toast.undo'), onClick: () => (store.undo(token), content.isConnected && render()) },
    });
  }

  function stats(days) {
    const today = dates.todayKey();
    const since = (n) => dates.addDays(today, -(n - 1));
    const count = (from) => days.filter((day) => day.date >= from && day.date <= today).reduce((sum, day) => sum + day.tasks.length, 0);
    const all = days.reduce((sum, day) => sum + day.tasks.length, 0);
    const tile = (label, n) => ui.h('div', { class: 'history__stat' }, ui.h('strong', null, String(n)), ui.h('span', null, label));
    return ui.h(
      'div',
      { class: 'history__stats' },
      tile(t('history.today'), count(today)),
      tile(t('history.week'), count(since(7))),
      tile(t('history.month'), count(since(30))),
      tile(t('history.all'), all),
    );
  }

  function usage() {
    if (isPro()) return null;
    const count = taskCount(store);
    const share = Math.min(1, count / FREE_TASK_LIMIT);
    return ui.h(
      'div',
      { class: `history__usage ${count >= FREE_TASK_LIMIT ? 'is-full' : ''}`.trim() },
      ui.h('div', { class: 'history__bar', role: 'presentation' }, ui.h('span', { style: `width: ${Math.round(share * 100)}%` })),
      ui.h('p', null, t('history.usage', { count, n: FREE_TASK_LIMIT })),
      onSeePlans ? ui.h('button', { class: 'link-button', type: 'button', onClick: () => (api.close(), onSeePlans()) }, t('plan.seePlans')) : null,
    );
  }

  function taskRow(task) {
    const seconds = task.timer ? timerElapsed(task.timer) : 0;
    const colour = DOT[task.quadrant ?? task.tag];
    return ui.h(
      'li',
      { class: 'history__task' },
      ui.h('span', { class: 'history__dot', style: colour ? `background: ${colour}` : null, 'aria-hidden': 'true' }),
      ui.h('span', { class: 'history__title' }, task.title),
      seconds > 0 ? ui.h('span', { class: 'history__time' }, formatTime(seconds)) : null,
      ui.h(
        'button',
        { class: 'btn-icon history__act', type: 'button', 'aria-label': `${t('history.deleteTask')}: ${task.title}`, title: t('history.deleteTask'), onClick: () => remove([task.id]) },
        ui.icon('trash', { size: 15 }),
      ),
    );
  }

  function dayBlock(day) {
    return ui.h(
      'section',
      { class: 'history__day' },
      ui.h(
        'div',
        { class: 'history__day-head' },
        ui.h('h3', null, dayLabel(day.date)),
        ui.h('span', { class: 'history__count' }, t('history.dayCount', { n: day.tasks.length })),
        ui.h(
          'button',
          {
            class: 'btn-icon history__act',
            type: 'button',
            'aria-label': `${t('history.deleteDay')}: ${dayLabel(day.date)}`,
            title: t('history.deleteDay'),
            onClick: () => remove(day.tasks.map((task) => task.id)),
          },
          ui.icon('trash', { size: 15 }),
        ),
      ),
      ui.h('ul', { class: 'history__tasks' }, day.tasks.map(taskRow)),
    );
  }

  function deleteAllButton(days) {
    const ids = days.flatMap((day) => day.tasks.map((task) => task.id));
    return ui.h(
      'button',
      {
        class: `history__clear ${armed ? 'is-armed' : ''}`.trim(),
        type: 'button',
        onClick: () => {
          clearTimeout(disarm);
          if (!armed) {
            armed = true;
            disarm = setTimeout(() => ((armed = false), content.isConnected && render()), 4000);
            render();
            content.querySelector('.history__clear')?.focus();
            return;
          }
          armed = false;
          remove(ids);
        },
      },
      ui.icon('trash', { size: 15 }),
      armed ? t('history.deleteAllAgain', { n: ids.length }) : t('history.deleteAll'),
    );
  }

  function render() {
    const days = doneDays(store.get().tasks);
    const visible = days.slice(0, shown);
    content.replaceChildren(
      ...[
        // The counts are Pro; on Free they show blurred. The list stays usable: it is where room is made.
        isPro() ? stats(days) : proLock({ content: stats(days), size: 'compact', onGoPro: () => api.close(), onUnlock: render }),
        usage(),
        days.length
          ? ui.h('div', { class: 'history__list' }, visible.map(dayBlock), days.length > shown
              ? ui.h('button', { class: 'btn history__more', type: 'button', onClick: () => ((shown += DAYS_PER_PAGE), render()) }, t('history.more'))
              : null)
          : ui.h('p', { class: 'history__empty text-muted' }, t('history.empty')),
        days.length ? deleteAllButton(days) : null,
      ].filter(Boolean),
    );
  }

  render();
  const api = ui.modal({ title: t('history.title'), content, className: 'modal--history', actions: [{ label: t('common.close'), primary: true }], onClose: () => clearTimeout(disarm) });
  return api;
}
