// Pure merge between Levelix tasks and the "Levelix" Reminders list — no I/O, unit-tested.
//
// `state[taskId]` is what both sides agreed on at the end of the previous sync:
//   { title, rDate, lDate, placed, done }  (rDate = the reminder's day or null, lDate = the task's day)
// With it every field is a three-way merge: a side that changed since then wins; when both changed,
// Levelix wins. Without it (links made before the state existed) the reminder wins only when it was
// edited after the task and after it was created.
//
// Dates: a task placed in a quadrant has its day in Reminders (so it shows in Calendar). A waiting
// task has no day in Reminders unless the reminder already had one. Removing the day in Reminders
// sends the task to today's waiting list; setting a day moves the task to that day.
export const TAG = /levelix:([A-Za-z0-9_-]+)/;
const EDITED_AFTER_CREATION_MS = 10_000;

// Reminders has three levels of priority; Levelix has four boxes. They line up like this, and a dated
// reminder with no priority lands in Schedule so it is actually visible on its day.
const PRIORITY_OF = { do: 1, plan: 5, delegate: 9, delete: 0 };
export const quadrantForPriority = (priority) => (priority >= 1 && priority <= 4 ? 'do' : priority === 5 ? 'plan' : priority >= 6 ? 'delegate' : null);
export const priorityForQuadrant = (quadrant) => PRIORITY_OF[quadrant] ?? 0;

/**
 * tasks:     [{ id, title, date, placed, quadrant, done, updatedAt }]  (what Levelix syncs)
 * deleted:   [taskId]                                        (Levelix tombstones)
 * relink:    [{ from, to }]                                  (a pulled task hands its reminder over)
 * reminders: [{ id, title, body, completed, date, priority, created, modified }] (dates as keys, times in ms)
 * Returns { ops, result, state }: ops for the Reminders app, result for the browser, the next state.
 */
export function planSync({ tasks = [], deleted = [], relink = [], reminders = [], state = {}, today, resolve = {} }) {
  const byTask = new Map();
  for (const reminder of reminders) {
    const match = TAG.exec(reminder.body || '');
    if (match && !byTask.has(match[1])) byTask.set(match[1], reminder);
  }
  const ops = [];
  // Hand a reminder over to the task that took the work on, keeping everything already on it.
  for (const { from, to } of relink) {
    const reminder = byTask.get(from);
    if (!reminder || byTask.has(to)) continue;
    ops.push({ op: 'retag', id: reminder.id, taskId: to });
    reminder.body = `levelix:${to}`;
    byTask.delete(from);
    byTask.set(to, reminder);
    if (state[from] && !state[to]) state[to] = state[from];
  }
  const result = { created: 0, updated: 0, deleted: 0, completedInReminders: [], reopenedInReminders: [], changedInReminders: [], deletedInReminders: [], imports: [], conflicts: [] };
  const next = { ...state };
  for (const { from } of relink) delete next[from]; // the record is history in Levelix, not in Reminders
  const gone = new Set(deleted);

  for (const task of tasks) {
    if (gone.has(task.id)) continue;
    const reminder = byTask.get(task.id);
    const base = state[task.id];

    if (!reminder) {
      if (base) {
        // It was linked, so the reminder was deleted (or moved out of the list) in Reminders: delete the task too.
        delete next[task.id];
        result.deletedInReminders.push(task.id);
        continue;
      }
      // Finished before a sync ever saw it (a whole day's work done offline): it is still written onto
      // its day and ticked there, so the day in Reminders matches the day in Levelix.
      const date = task.placed ? task.date : null;
      const priority = priorityForQuadrant(task.quadrant);
      ops.push({ op: 'create', taskId: task.id, title: task.title, date, priority, ...(task.done ? { completed: true } : {}) });
      next[task.id] = { title: task.title, rDate: date, lDate: task.date, placed: task.placed, done: task.done, priority, quadrant: task.quadrant ?? null };
      result.created += 1;
      continue;
    }

    const reminderNewer =
      !base && reminder.modified - reminder.created > EDITED_AFTER_CREATION_MS && reminder.modified > Date.parse(task.updatedAt);
    const patch = {};
    const change = {};
    const clash = {}; // fields both sides changed: nothing is written until the user says which wins
    const answered = resolve[task.id]; // 'levelix' | 'reminders', once the user has answered

    /** Who decides this field: the only side that changed it, the user's answer, or nobody yet. */
    const decide = (reminderChanged, levelixChanged) => {
      if (!base) return reminderNewer ? 'reminders' : 'levelix'; // no record to compare against
      if (answered) return answered;
      if (reminderChanged && !levelixChanged) return 'reminders';
      if (levelixChanged && !reminderChanged) return 'levelix';
      return 'clash';
    };

    let title = task.title;
    if (reminder.title !== task.title) {
      const side = decide(base && reminder.title !== base.title, base && task.title !== base.title);
      if (side === 'reminders') title = change.title = reminder.title;
      else if (side === 'levelix') patch.title = task.title;
      else {
        clash.title = { levelix: task.title, reminders: reminder.title };
        title = base.title;
      }
    }

    let rDate = reminder.date;
    let lDate = task.date;
    let placed = task.placed;
    // A waiting task with no day in Reminders is in sync — unless the reminder HAD a day that was removed.
    const dayRemoved = rDate === null && (placed || lDate !== today) && (base ? base.rDate !== null : reminderNewer);
    const inSync = rDate === lDate || (!placed && rDate === null && !dayRemoved);
    if (!inSync) {
      const side = decide(base && rDate !== base.rDate, base && (lDate !== base.lDate || placed !== base.placed));
      if (side === 'reminders') {
        if (rDate === null) {
          change.date = today;
          if (placed) change.unplace = true;
          lDate = today;
          placed = false;
        } else {
          change.date = lDate = rDate;
        }
      } else if (side === 'levelix') {
        patch.date = rDate = lDate;
      } else {
        clash.date = { levelix: lDate, reminders: rDate };
        rDate = base.rDate;
        lDate = base.lDate;
        placed = base.placed;
      }
    }

    // Priority ↔ box: the side that changed it since the last sync decides where the task sits.
    let priority = reminder.priority ?? 0;
    let quadrant = task.quadrant ?? null;
    const wantedPriority = priorityForQuadrant(quadrant);
    if (priority !== wantedPriority) {
      const side =
        base?.priority === undefined
          ? reminderNewer
            ? 'reminders'
            : 'levelix'
          : decide(priority !== base.priority, quadrant !== (base.quadrant ?? null));
      if (side === 'reminders') {
        quadrant = quadrantForPriority(priority);
        change.quadrant = quadrant;
      } else if (side === 'levelix') {
        patch.priority = priority = wantedPriority;
      } else {
        clash.quadrant = { levelix: quadrant, reminders: quadrantForPriority(priority) };
        priority = base.priority;
        quadrant = base.quadrant ?? null;
      }
    }

    // Ticks: the side that changed it decides; when both did, the user is asked.
    let done = task.done;
    if (task.done !== reminder.completed) {
      const side =
        base?.done === undefined
          ? reminder.modified > Date.parse(task.updatedAt)
            ? 'reminders'
            : 'levelix'
          : decide(reminder.completed !== base.done, task.done !== base.done);
      if (side === 'reminders') {
        done = reminder.completed;
        (done ? result.completedInReminders : result.reopenedInReminders).push(task.id);
      } else if (side === 'levelix') {
        patch.completed = task.done;
      } else {
        clash.done = { levelix: task.done, reminders: reminder.completed };
        done = base.done;
      }
    }

    if (Object.keys(patch).length) {
      ops.push({ op: 'update', id: reminder.id, ...patch });
      result.updated += 1;
    }
    if (Object.keys(change).length) result.changedInReminders.push({ id: task.id, ...change });
    if (Object.keys(clash).length) result.conflicts.push({ id: task.id, title: task.title, fields: clash });
    next[task.id] = { title, rDate, lDate, placed, done, priority, quadrant };
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
    // A reminder that carries a day goes straight onto that day's board, in the box its priority names.
    const imported = quadrantForPriority(reminder.priority ?? 0) ?? (reminder.date ? 'plan' : null);
    result.imports.push({ reminderId: reminder.id, title: String(reminder.title).trim(), date: reminder.date, quadrant: imported });
  }
  return { ops, result, state: next };
}
