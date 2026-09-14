// Apple Reminders side of the personal Levelix bridge (run by server.mjs through `osascript -l JavaScript`).
// It only ever touches one Reminders list, "Levelix". A reminder is linked to a Levelix task by a
// `levelix:<taskId>` line in its notes.
//   sync <file>  — file holds { tasks: [{ id, title, date|null, done }], deleted: [taskId] }
//   link <file>  — file holds { links: [{ reminderId, taskId }] }
ObjC.import('Foundation');

const LIST_NAME = 'Levelix';
const TAG = /levelix:([A-Za-z0-9_-]+)/;

function run(argv) {
  const command = argv[0];
  const input = JSON.parse(readFile(argv[1]));
  const app = Application('Reminders');
  const list = ensureList(app);
  if (command === 'sync') return JSON.stringify(sync(app, list, input));
  if (command === 'link') return JSON.stringify(link(list, input.links || []));
  throw new Error(`Unknown command: ${command}`);
}

function readFile(path) {
  return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null));
}

function ensureList(app) {
  const found = app.lists.whose({ name: LIST_NAME });
  if (found.length > 0) return found[0];
  app.lists.push(app.List({ name: LIST_NAME }));
  return app.lists.whose({ name: LIST_NAME })[0];
}

const pad = (n) => String(n).padStart(2, '0');
const toKey = (date) => (date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : null);
function toDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // midday, so no time zone moves it to another day
}

function sync(app, list, { tasks = [], deleted = [] }) {
  const reminders = list.reminders;
  const ids = reminders.id();
  const names = reminders.name();
  const bodies = reminders.body();
  const completed = reminders.completed();
  const dues = reminders.alldayDueDate();
  const byTask = new Map();
  ids.forEach((id, i) => {
    const match = TAG.exec(bodies[i] || '');
    if (match) byTask.set(match[1], i);
  });

  const result = { created: 0, updated: 0, deleted: 0, completedInReminders: [], imports: [] };

  for (const task of tasks) {
    const i = byTask.get(task.id);
    if (i === undefined) {
      if (task.done) continue; // history that was already finished stays out of Reminders
      const props = { name: task.title, body: `levelix:${task.id}` };
      if (task.date) props.alldayDueDate = toDate(task.date);
      reminders.push(app.Reminder(props));
      result.created += 1;
      continue;
    }
    const reminder = reminders.byId(ids[i]);
    let changed = false;
    if (names[i] !== task.title) {
      reminder.name = task.title;
      changed = true;
    }
    if (task.date && toKey(dues[i]) !== task.date) {
      reminder.alldayDueDate = toDate(task.date);
      changed = true;
    }
    if (task.done && !completed[i]) {
      reminder.completed = true;
      changed = true;
    } else if (!task.done && completed[i]) {
      result.completedInReminders.push(task.id); // ticked in Reminders → tick it in Levelix
    }
    if (changed) result.updated += 1;
  }

  const gone = new Set(deleted);
  for (const [taskId, i] of byTask) {
    if (!gone.has(taskId)) continue;
    app.delete(reminders.byId(ids[i]));
    result.deleted += 1;
  }

  ids.forEach((id, i) => {
    if (completed[i] || TAG.test(bodies[i] || '') || !String(names[i] || '').trim()) return;
    result.imports.push({ reminderId: id, title: String(names[i]).trim(), date: toKey(dues[i]) });
  });
  return result;
}

function link(list, links) {
  let linked = 0;
  for (const { reminderId, taskId } of links) {
    const reminder = list.reminders.byId(reminderId);
    const body = reminder.body() || '';
    if (TAG.test(body)) continue;
    reminder.body = body ? `${body}\nlevelix:${taskId}` : `levelix:${taskId}`;
    linked += 1;
  }
  return { linked };
}
