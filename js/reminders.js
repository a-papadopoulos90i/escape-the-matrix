// Personal bridge to Apple Reminders on the owner's Mac (tools/reminders-bridge). Hidden unless this
// browser opted in by opening the site with ?reminders=on; nothing about it is shown to other users.
import { todayKey } from './dates.js';

const FLAG = 'levelix:remindersBridge';
const BRIDGE = 'http://127.0.0.1:47827';
const RECENT_DONE_MS = 14 * 24 * 60 * 60 * 1000; // finished tasks older than this stay out of Reminders

/** ?reminders=on / ?reminders=off switches the opt-in for this browser, then drops the parameter. */
export function captureRemindersFlag() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('reminders');
  if (value !== 'on' && value !== 'off') return;
  try {
    localStorage.setItem(FLAG, value);
  } catch {
    /* storage blocked — the opt-in simply does not stick */
  }
  params.delete('reminders');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

export function remindersEnabled() {
  try {
    return localStorage.getItem(FLAG) === 'on';
  } catch {
    return false;
  }
}

async function call(pathname, body) {
  // text/plain keeps it a simple request (the bridge parses the JSON itself).
  const response = await fetch(`${BRIDGE}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Reminders bridge answered ${response.status}`);
  return response.json();
}

/** One press: Levelix → the "Levelix" Reminders list, then completions and new reminders back in. */
export async function syncWithReminders({ store, ui, i18n }) {
  const { t } = i18n;
  const cutoff = Date.now() - RECENT_DONE_MS;
  const all = store.get().tasks;
  const tasks = all
    .filter((task) => !task.deleted && task.carriedTo === null && (!task.done || Date.parse(task.doneAt ?? '') >= cutoff))
    .map((task) => ({ id: task.id, title: task.title, date: task.date, placed: task.quadrant !== null, done: task.done, updatedAt: task.updatedAt }));
  const deleted = all.filter((task) => task.deleted).map((task) => task.id);

  let result;
  try {
    result = await call('/sync', { tasks, deleted, today: todayKey() });
  } catch {
    ui.toast(t('reminders.offline'), { duration: 10000 });
    return;
  }

  // A bridge started before an update answers without the newer lists: say so instead of pretending it synced.
  if (!['changedInReminders', 'deletedInReminders', 'reopenedInReminders'].every((key) => Array.isArray(result[key]))) {
    ui.toast(t('reminders.outdated'), { duration: 12000 });
    return;
  }
  const links = [];
  store.undoable(() => {
    for (const id of result.completedInReminders) store.toggleDone(id, true);
    for (const id of result.reopenedInReminders) store.toggleDone(id, false); // unticked in Reminders
    // Edited in Reminders since the last sync: a new title or day (no day = back to today's waiting list).
    for (const change of result.changedInReminders) {
      if (!store.findTask(change.id)) continue;
      if (change.title !== undefined) store.updateTask(change.id, { title: change.title });
      if (change.unplace) store.setQuadrant(change.id, null);
      if (change.date) store.moveTaskToDate(change.id, change.date);
    }
    for (const id of result.deletedInReminders) store.removeTask(id); // deleted in Reminders
    for (const item of result.imports) {
      const task = store.addTask({ title: item.title, date: item.date ?? todayKey() });
      links.push({ reminderId: item.reminderId, taskId: task.id, title: task.title, rDate: item.date, lDate: task.date });
    }
  });
  if (links.length) {
    try {
      await call('/link', { links });
    } catch {
      ui.toast(t('reminders.linkFailed'), { duration: 10000 });
      return;
    }
  }
  ui.toast(
    t('reminders.done', {
      sent: result.created + result.updated,
      imported: result.imports.length,
      changed: result.changedInReminders.length,
      completed: result.completedInReminders.length + result.reopenedInReminders.length,
      deleted: result.deleted + result.deletedInReminders.length,
    }),
    { duration: 6000 },
  );
}
