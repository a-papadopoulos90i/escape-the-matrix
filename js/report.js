// Time report: how long each task took, summed across every day it appeared, most time first.
// Each row opens to the single entries behind it (one per day the task was timed), where the time can
// be corrected by hand or removed. Lives here (not in a stage) so the header can open it from anywhere.

import { timerElapsed } from './store.js';
import { formatTime } from './timer.js';

/** "1:30:00" / "90:00" / "45" (a bare number is minutes) → seconds, or null when it makes no sense. */
export function parseTime(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 60;
  if (!/^\d{1,3}(:[0-5]?\d){1,2}$/.test(value)) return null;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

export function openTimeReport({ ui, store, i18n, dates }) {
  const { t } = i18n;
  const open = new Set(); // titles whose entries are unfolded
  let editing = null; // id of the entry being corrected
  const content = ui.h('div', { class: 'analysis' });

  /** [{ title, seconds, entries: [{ id, date, seconds }] }], most time first. */
  function groups() {
    const byTitle = new Map();
    for (const task of store.get().tasks) {
      if (task.deleted || !task.timer) continue;
      const seconds = timerElapsed(task.timer);
      if (seconds <= 0) continue;
      const group = byTitle.get(task.title) ?? { title: task.title, seconds: 0, entries: [] };
      group.seconds += seconds;
      group.entries.push({ id: task.id, date: task.date, seconds });
      byTitle.set(task.title, group);
    }
    for (const group of byTitle.values()) group.entries.sort((a, b) => b.seconds - a.seconds);
    return [...byTitle.values()].sort((a, b) => b.seconds - a.seconds);
  }

  function saveEdit(entry, input) {
    const seconds = parseTime(input.value);
    if (seconds === null) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    editing = null;
    store.setTrackedTime(entry.id, seconds);
    render();
  }

  function removeEntry(entry) {
    const token = store.setTrackedTime(entry.id, 0);
    render();
    ui.toast(t('analysis.removed'), { action: { label: t('toast.undo'), onClick: () => (store.undo(token), render()) } });
  }

  function entryRow(entry) {
    const isEditing = editing === entry.id;
    const input =
      isEditing &&
      ui.h('input', {
        class: 'analysis__input',
        type: 'text',
        value: formatTime(entry.seconds),
        'aria-label': t('analysis.edit'),
        title: t('analysis.timeHint'),
        onKeydown: (event) => {
          if (event.key === 'Enter') saveEdit(entry, event.currentTarget);
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation(); // Escape leaves the field, it does not close the report
          editing = null;
          render();
        },
      });
    return ui.h(
      'div',
      { class: 'analysis__entry' },
      ui.h('span', { class: 'analysis__date' }, dates.formatShort(entry.date)),
      isEditing ? input : ui.h('span', { class: 'analysis__time' }, formatTime(entry.seconds)),
      isEditing
        ? ui.h('button', { class: 'btn-icon analysis__act', type: 'button', 'aria-label': t('common.save'), title: t('common.save'), onClick: () => saveEdit(entry, input) }, ui.icon('check', { size: 16 }))
        : ui.h(
            'button',
            {
              class: 'btn-icon analysis__act',
              type: 'button',
              'aria-label': t('analysis.edit'),
              title: t('analysis.edit'),
              onClick: () => ((editing = entry.id), render()),
            },
            ui.icon('pencil', { size: 16 }),
          ),
      ui.h(
        'button',
        { class: 'btn-icon analysis__act', type: 'button', 'aria-label': t('analysis.remove'), title: t('analysis.remove'), onClick: () => removeEntry(entry) },
        ui.icon('close', { size: 16 }),
      ),
    );
  }

  function groupRow(group) {
    const unfolded = open.has(group.title);
    return ui.h(
      'div',
      { class: `analysis__group ${unfolded ? 'is-open' : ''}`.trim() },
      ui.h(
        'div',
        { class: 'analysis__row' },
        ui.h(
          'button',
          {
            class: 'analysis__task fold-toggle',
            type: 'button',
            'aria-expanded': String(unfolded),
            onClick: () => {
              unfolded ? open.delete(group.title) : open.add(group.title);
              editing = null;
              render();
            },
          },
          ui.icon('chevron-down', { size: 14 }),
          group.title,
          group.entries.length > 1 ? ui.h('span', { class: 'analysis__count' }, ` ${t('analysis.times', { n: group.entries.length })}`) : null,
        ),
        ui.h('span', { class: 'analysis__time' }, formatTime(group.seconds)),
      ),
      unfolded ? ui.h('div', { class: 'analysis__entries' }, group.entries.map(entryRow)) : null,
    );
  }

  function render() {
    const rows = groups();
    const total = rows.reduce((sum, group) => sum + group.seconds, 0);
    content.replaceChildren(
      ...[
        rows.length
          ? ui.h('div', { class: 'analysis__list' }, rows.map(groupRow))
          : ui.h('p', { class: 'analysis__empty text-muted' }, t('analysis.empty')),
        rows.length ? ui.h('p', { class: 'analysis__hint text-muted' }, t('analysis.editHint')) : null,
        rows.length ? ui.h('div', { class: 'analysis__total' }, ui.h('span', null, t('analysis.total')), ui.h('span', null, formatTime(total))) : null,
      ].filter(Boolean),
    );
    content.querySelector('.analysis__input')?.focus();
  }

  render();
  ui.modal({ title: t('analysis.title'), content, actions: [{ label: t('common.close'), primary: true }] });
}
