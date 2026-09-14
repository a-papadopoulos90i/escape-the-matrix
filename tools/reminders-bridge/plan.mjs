// Pure merge between Levelix tasks and the "Levelix" Reminders list — no I/O, unit-tested.
//
// `state[taskId]` is what both sides agreed on at the end of the previous sync:
//   { title, rDate, lDate, placed }  (rDate = the reminder's day or null, lDate = the task's day)
// With it every field is a three-way merge: a side that changed since then wins; when both changed,
// Levelix wins. Without it (links made before the state existed) the reminder wins only when it was
// edited after the task and after it was created.
//
// Dates: a task placed in a quadrant has its day in Reminders (so it shows in Calendar). A waiting
// task has no day in Reminders unless the reminder already had one. Removing the day in Reminders
// sends the task to today's waiting list; setting a day moves the task to that day.
export const TAG = /levelix:([A-Za-z0-9_-]+)/;
const EDITED_AFTER_CREATION_MS = 10_000;

/**
 * tasks:     [{ id, title, date, placed, done, updatedAt }]  (what Levelix syncs)
 * deleted:   [taskId]                                        (Levelix tombstones)
 * reminders: [{ id, title, body, completed, date, created, modified }] (dates as keys, times in ms)
 * Returns { ops, result, state }: ops for the Reminders app, result for the browser, the next state.
 */
export function planSync({ tasks = [], deleted = [], reminders = [], state = {}, today }) {
  const byTask = new Map();
  for (const reminder of reminders) {
    const match = TAG.exec(reminder.body || '');
    if (match && !byTask.has(match[1])) byTask.set(match[1], reminder);
  }
  const ops = [];
  const result = { created: 0, updated: 0, deleted: 0, completedInReminders: [], changedInReminders: [], deletedInReminders: [], imports: [] };
  const next = { ...state };
  const gone = new Set(deleted);

  for (const task of tasks) {
    if (gone.has(task.id)) continue;
    const reminder = byTask.get(task.id);
    const base = state[task.id];

    if (!reminder) {
      if (base) {
        // It was linked, so the reminder was deleted (or moved out of the list) in Reminders.
        delete next[task.id];
        if (!task.done) result.deletedInReminders.push(task.id); // finished history stays in Levelix
        continue;
      }
      if (task.done) continue;
      const date = task.placed ? task.date : null;
      ops.push({ op: 'create', taskId: task.id, title: task.title, date });
      next[task.id] = { title: task.title, rDate: date, lDate: task.date, placed: task.placed };
      result.created += 1;
      continue;
    }

    const reminderNewer =
      !base && reminder.modified - reminder.created > EDITED_AFTER_CREATION_MS && reminder.modified > Date.parse(task.updatedAt);
    const patch = {};
    const change = {};

    let title = task.title;
    if (reminder.title !== task.title) {
      const reminderWins = base ? reminder.title !== base.title && task.title === base.title : reminderNewer;
      if (reminderWins) title = change.title = reminder.title;
      else patch.title = task.title;
    }

    let rDate = reminder.date;
    let lDate = task.date;
    let placed = task.placed;
    // A waiting task with no day in Reminders is in sync — unless the reminder HAD a day that was removed.
    const dayRemoved = rDate === null && (placed || lDate !== today) && (base ? base.rDate !== null : reminderNewer);
    const inSync = rDate === lDate || (!placed && rDate === null && !dayRemoved);
    if (!inSync) {
      const reminderChanged = base ? rDate !== base.rDate : reminderNewer;
      const levelixChanged = base ? lDate !== base.lDate || placed !== base.placed : !reminderNewer;
      if (reminderChanged && !levelixChanged) {
        if (rDate === null) {
          change.date = today;
          if (placed) change.unplace = true;
          lDate = today;
          placed = false;
        } else {
          change.date = lDate = rDate;
        }
      } else {
        patch.date = rDate = lDate;
      }
    }

    if (task.done && !reminder.completed) patch.completed = true;
    else if (!task.done && reminder.completed) result.completedInReminders.push(task.id);

    if (Object.keys(patch).length) {
      ops.push({ op: 'update', id: reminder.id, ...patch });
      result.updated += 1;
    }
    if (Object.keys(change).length) result.changedInReminders.push({ id: task.id, ...change });
    next[task.id] = { title, rDate, lDate, placed };
  }

  for (const id of gone) {
    const reminder = byTask.get(id);
    if (reminder) {
      ops.push({ op: 'delete', id: reminder.id });
      result.deleted += 1;
    }
    delete next[id];
  }

  for (const reminder of reminders) {
    if (reminder.completed || TAG.test(reminder.body || '') || !String(reminder.title || '').trim()) continue;
    result.imports.push({ reminderId: reminder.id, title: String(reminder.title).trim(), date: reminder.date });
  }
  return { ops, result, state: next };
}
