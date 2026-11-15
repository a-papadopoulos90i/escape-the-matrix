// Pure merge between Levelix tasks and the "Levelix" Reminders list — no I/O, unit-tested.
//
// `state[taskId]` is what both sides agreed on at the end of the previous sync:
//   { title, rDate, lDate, placed, done }  (rDate = the reminder's day or null, lDate = the task's day)
// With it every field is a three-way merge: a side that changed since then wins; when both changed,
// Levelix wins. Without it (links made before the state existed) the reminder wins only when it was
// edited after the task and after it was created.
//
// Dates: a task placed in a quadrant has its day in Reminders (so it shows in Calendar); a waiting-list
// task has none. Taking the day off in Reminders sends the task to today's waiting list; giving a day
// there moves the task to that day (a waiting task lands on that day's board).
export const TAG = /levelix:([A-Za-z0-9_-]+)/;
const EDITED_AFTER_CREATION_MS = 10_000;

// Reminders has three levels of priority; Levelix has four boxes. They line up like this, and a dated
// reminder with no priority lands in Schedule so it is actually visible on its day.
const PRIORITY_OF = { do: 1, plan: 5, delegate: 9, delete: 0 };
export const quadrantForPriority = (priority) => (priority >= 1 && priority <= 4 ? 'do' : priority === 5 ? 'plan' : priority >= 6 ? 'delegate' : null);
export const priorityForQuadrant = (quadrant) => PRIORITY_OF[quadrant] ?? 0;

/** What a /sync request carries into planSync. Every field is passed on: until 2026-10-26 the server
 *  dropped relink, known and resolve, so a pulled task got a new reminder and the old one stayed behind. */
export function syncRequest({ tasks = [], deleted = [], relink = [], known = null, resolve = {}, today } = {}) {
  return { tasks, deleted, relink, known, resolve, today };
}

/**
 * tasks:     [{ id, title, date, placed, quadrant, done, updatedAt }]  (what Levelix syncs)
 * known:     [taskId] | null                                 (every id Levelix has; others are leftovers)
 * deleted:   [taskId]                                        (Levelix tombstones)
 * relink:    [{ from, to }]                                  (a pulled task hands its reminder over)
 * reminders: [{ id, title, body, completed, date, priority, created, modified }] (dates as keys, times in ms)
 * Returns { ops, result, state }: ops for the Reminders app, result for the browser, the next state.
 */
export function planSync({ tasks = [], deleted = [], relink = [], known = null, reminders = [], state = {}, today, resolve = {} }) {
  const byTask = new Map();
  for (const reminder of reminders) {
    const match = TAG.exec(reminder.body || '');
    if (match && !byTask.has(match[1])) byTask.set(match[1], reminder);
  }
  const ops = [];
  const result = { created: 0, updated: 0, deleted: 0, completedInReminders: [], reopenedInReminders: [], changedInReminders: [], deletedInReminders: [], imports: [], conflicts: [] };
  // Hand a reminder over to the task that took the work on, keeping everything already on it. The
  // record itself is Levelix's own history and never stays in Reminders — so if the copy already has
  // a reminder of its own, the record's is a leftover of the same work and goes.
  for (const { from, to } of relink) {
    const reminder = byTask.get(from);
    if (!reminder) continue;
    byTask.delete(from);
    if (byTask.has(to)) {
      ops.push({ op: 'delete', id: reminder.id });
      result.deleted += 1;
      continue;
    }
    ops.push({ op: 'retag', id: reminder.id, taskId: to });
    reminder.body = `levelix:${to}`;
    byTask.set(to, reminder);
    if (state[from] && !state[to]) state[to] = state[from];
  }
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
    let quadrant = task.quadrant ?? null;
    let settledHere = false; // this sync put the task on a board, or took it off one, because of the reminder's day
    // A reminder has a day exactly when its task sits on a day's board (placed in a box). A waiting-list
    // task follows every day in Levelix and belongs to none, so it has no day in Reminders either, and
    // Calendar shows what the boards show. (Until 2026-11-15 a task sent back to the waiting list kept
    // its day in Reminders, so Calendar listed work the day's board no longer had.)
    const wanted = placed ? lDate : null;
    if (rDate !== wanted) {
      const reminderChanged = base && rDate !== base.rDate;
      const levelixChanged = base && (placed !== base.placed || (placed && lDate !== base.lDate));
      // Neither side moved since the last sync and still they differ: a waiting task that kept its day
      // under the older rule. Levelix decides.
      const side = base && !answered && !reminderChanged && !levelixChanged ? 'levelix' : decide(reminderChanged, levelixChanged);
      if (side === 'reminders') {
        if (rDate === null) {
          // The day was taken off in Reminders: off the board, into today's waiting list.
          change.date = lDate = today;
          change.unplace = true;
          placed = false;
          quadrant = null;
          settledHere = true;
        } else if (!placed) {
          // A day given in Reminders to a waiting task: onto that day's board, in the box its priority
          // names (Schedule when it has none), exactly like a new dated reminder.
          quadrant = quadrantForPriority(reminder.priority ?? 0) ?? 'plan';
          change.date = lDate = rDate;
          change.quadrant = quadrant;
          placed = true;
          settledHere = true;
        } else {
          change.date = lDate = rDate;
        }
      } else if (side === 'levelix') {
        patch.date = rDate = wanted;
      } else {
        clash.date = { levelix: wanted, reminders: rDate };
        rDate = base.rDate;
        lDate = base.lDate;
        placed = base.placed;
      }
    }

    // Priority ↔ box: the side that changed it since the last sync decides where the task sits.
    let priority = reminder.priority ?? 0;
    const wantedPriority = priorityForQuadrant(quadrant);
    if (clash.date) {
      // The day is still being asked about: the box waits for the answer too.
      priority = base.priority;
      quadrant = base.quadrant ?? null;
    } else if (priority !== wantedPriority) {
      const side = settledHere
        ? 'levelix' // where the task sits was just settled by the reminder's day: only tidy its priority to match
        : base?.priority === undefined
          ? reminderNewer
            ? 'reminders'
            : 'levelix'
          : decide(priority !== base.priority, quadrant !== (base.quadrant ?? null));
      if (side === 'reminders') {
        quadrant = quadrantForPriority(priority);
        change.quadrant = quadrant;
        // The box and the day go together, in the same sync: a priority given to a waiting task puts it
        // on today's board; a priority taken off sends the task to the waiting list, without a day.
        if (quadrant !== null && !placed) {
          change.date = lDate = today;
          patch.date = rDate = today;
          placed = true;
        } else if (quadrant === null && placed) {
          patch.date = rDate = null;
          placed = false;
        }
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

  // A reminder this bridge made for a task Levelix no longer has anywhere: the work is gone, so is it.
  if (Array.isArray(known)) {
    const alive = new Set(known);
    for (const [taskId, reminder] of byTask) {
      if (alive.has(taskId) || !state[taskId]) continue;
      ops.push({ op: 'delete', id: reminder.id });
      result.deleted += 1;
      delete next[taskId];
    }
  }

  for (const reminder of reminders) {
    if (reminder.completed || TAG.test(reminder.body || '') || !String(reminder.title || '').trim()) continue;
    // A reminder that carries a day goes straight onto that day's board, in the box its priority names.
    const imported = quadrantForPriority(reminder.priority ?? 0) ?? (reminder.date ? 'plan' : null);
    result.imports.push({ reminderId: reminder.id, title: String(reminder.title).trim(), date: reminder.date, quadrant: imported });
  }
  return { ops, result, state: next };
}
