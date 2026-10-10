// Personal bridge to Apple Reminders on the owner's Mac (tools/reminders-bridge). Hidden unless this
// browser opted in by opening the site with ?reminders=on; nothing about it is shown to other users.
import { todayKey } from './dates.js';

const FLAG = 'levelix:remindersBridge';
const LAST_SYNC = 'levelix:remindersLastSync';
const BRIDGE = 'http://127.0.0.1:47827';
const RECENT_DONE_MS = 30 * 24 * 60 * 60 * 1000; // a month back: enough to fill in days that were worked offline
// Sync runs by itself: shortly after the app opens, every few minutes, when the tab comes back, and a
// little after each local change — so a tick in either app reaches the other without pressing anything.
const FIRST_RUN_MS = 5_000;
const EVERY_MS = 2 * 60_000;
const AFTER_EDIT_MS = 20_000;
const OFFLINE_BACKOFF_MS = 5 * 60_000; // the bridge is not running: stop trying for a while

/** ?reminders=on / ?reminders=off switches the opt-in for this browser, then drops the parameter.
 *  Returns the value it applied, so the shell can confirm it on screen. */
export function captureRemindersFlag() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('reminders');
  if (value !== 'on' && value !== 'off') return null;
  try {
    localStorage.setItem(FLAG, value);
  } catch {
    /* storage blocked — the opt-in simply does not stick */
  }
  params.delete('reminders');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  return value;
}

/** When the last sync went through, as a short "4m" / "2h" / "3d" — or null when there has been none. */
export function lastSyncAgo(now = Date.now()) {
  let at = 0;
  try {
    at = Number(localStorage.getItem(LAST_SYNC)) || 0;
  } catch {
    return null;
  }
  if (!at) return null;
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

function recordSync(now = Date.now()) {
  try {
    localStorage.setItem(LAST_SYNC, String(now));
  } catch {
    /* storage blocked — the menu simply shows no time */
  }
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

/**
 * What the bridge is told about: the tasks that belong in Reminders, and everything that should not be
 * there any more. A record (the "pulled to …" copy left on the old day) is Levelix's own history — it
 * stays here and its reminder is removed, so Calendar shows the task once, on the day it is on now.
 */
export function syncPayload(store, now = Date.now()) {
  const cutoff = now - RECENT_DONE_MS;
  const all = store.get().tasks;
  const tasks = all
    .filter((task) => !task.deleted && task.carriedTo === null && (!task.done || Date.parse(task.doneAt ?? '') >= cutoff))
    .map((task) => ({ id: task.id, title: task.title, date: task.date, placed: task.quadrant !== null, quadrant: task.quadrant, done: task.done, updatedAt: task.updatedAt }));
  // A pulled task keeps its reminder: the record left behind hands it over to the copy on the new day,
  // so the reminder (and anything ticked or edited on it) follows instead of being deleted and remade.
  const live = all.filter((task) => !task.deleted);
  const relink = [];
  const handed = new Set();
  for (const record of live) {
    if (record.carriedTo === null) continue;
    const copy = live.find((task) => task.carriedFrom === record.id && task.carriedTo === null);
    if (!copy) continue;
    relink.push({ from: record.id, to: copy.id });
    handed.add(record.id);
  }
  const deleted = all.filter((task) => (task.deleted || task.carriedTo !== null) && !handed.has(task.id)).map((task) => task.id);
  return { tasks, deleted, relink };
}

/**
 * One sync: Levelix → the "Levelix" Reminders list, then whatever changed in Reminders back in.
 * `silent` (the automatic runs) keeps quiet unless something actually came in from Reminders.
 * Returns { offline } / { outdated } / the bridge's result.
 */
export async function syncWithReminders({ store, ui, i18n, silent = false }) {
  const { t } = i18n;
  const { tasks, deleted, relink } = syncPayload(store);

  let result;
  try {
    result = await call('/sync', { tasks, deleted, relink, today: todayKey() });
  } catch {
    if (!silent) ui.toast(t('reminders.offline'), { duration: 10000 });
    return { offline: true };
  }

  // A bridge started before an update answers without the newer lists: say so instead of pretending it synced.
  if (!['changedInReminders', 'deletedInReminders', 'reopenedInReminders'].every((key) => Array.isArray(result[key]))) {
    if (!silent) ui.toast(t('reminders.outdated'), { duration: 12000 });
    return { outdated: true };
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
      // The reminder's priority says which box it belongs in (no priority = back to the waiting list).
      if (change.quadrant !== undefined) store.setQuadrant(change.id, change.quadrant, store.findTask(change.id)?.date);
    }
    for (const id of result.deletedInReminders) store.removeTask(id); // deleted in Reminders
    for (const item of result.imports) {
      const task = store.addTask({ title: item.title, date: item.date ?? todayKey(), quadrant: item.quadrant ?? null, tag: item.quadrant ?? null });
      links.push({ reminderId: item.reminderId, taskId: task.id, title: task.title, rDate: item.date, lDate: task.date, quadrant: task.quadrant });
    }
  });
  if (links.length) {
    try {
      await call('/link', { links });
    } catch {
      if (!silent) ui.toast(t('reminders.linkFailed'), { duration: 10000 });
      return { linkFailed: true };
    }
  }
  recordSync();
  const fromReminders =
    result.imports.length + result.changedInReminders.length + result.deletedInReminders.length + result.completedInReminders.length + result.reopenedInReminders.length;
  if (!silent || fromReminders > 0) {
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
  return result;
}

/** Keeps both sides in step on their own. Started once at boot when this browser opted in. */
export function startRemindersAutoSync({ store, ui, i18n }) {
  let running = false;
  let quietUntil = 0;
  let lastRun = 0;
  let timer = null;

  // It keeps syncing while the tab sits in the background — that is where a working day is spent.
  const run = async () => {
    if (running || Date.now() < quietUntil) return;
    running = true;
    try {
      const result = await syncWithReminders({ store, ui, i18n, silent: true });
      quietUntil = result?.offline ? Date.now() + OFFLINE_BACKOFF_MS : 0;
    } finally {
      running = false;
      lastRun = Date.now();
    }
  };
  const soon = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  };

  soon(FIRST_RUN_MS);
  setInterval(run, EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return void run(); // leaving the tab: push what was just done
    if (Date.now() - lastRun > 60_000) soon(1000);
  });
  window.addEventListener('pagehide', () => void run()); // closing the tab or the laptop lid
  store.subscribe((doc, meta) => {
    if (meta?.reason !== 'setSetting' && !running) soon(AFTER_EDIT_MS); // let a burst of edits settle first
  });
}
