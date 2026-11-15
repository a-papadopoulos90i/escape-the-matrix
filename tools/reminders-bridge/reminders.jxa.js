// Apple Reminders side of the personal Levelix bridge (run by server.mjs through `osascript -l JavaScript`).
// It only ever touches one Reminders list, "Levelix". All merge decisions live in plan.mjs; this script
// only reads the list and carries out the operations it is given.
//   read  <file>  — prints [{ id, title, body, completed, date, priority, created, modified }]
//   apply <file>  — file holds { ops: [{ op: 'create', taskId, title, date, priority, completed? } | { op: 'update', id, title?, date?, completed?, priority? } | { op: 'retag', id, taskId } | { op: 'delete', id }] }
//                   (update with `date: null` takes the day off: see withoutDay)
//   link  <file>  — file holds { links: [{ reminderId, taskId }] }
ObjC.import('Foundation');

const LIST_NAME = 'Levelix';
const TAG = /levelix:([A-Za-z0-9_-]+)/;

function run(argv) {
  const command = argv[0];
  const input = JSON.parse(readFile(argv[1]));
  const app = Application('Reminders');
  // Only the bridge's own tests name another list, and only a throwaway one.
  const list = ensureList(app, typeof input.list === 'string' && input.list.startsWith('Levelix bridge test') ? input.list : LIST_NAME);
  if (command === 'read') return JSON.stringify(read(list));
  if (command === 'apply') return JSON.stringify(apply(app, list, input.ops || []));
  if (command === 'link') return JSON.stringify(link(list, input.links || []));
  throw new Error(`Unknown command: ${command}`);
}

function readFile(path) {
  return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null));
}

function ensureList(app, name) {
  const found = app.lists.whose({ name });
  if (found.length > 0) return found[0];
  app.lists.push(app.List({ name }));
  return app.lists.whose({ name })[0];
}

/**
 * Takes the day off a reminder (its task went back to Levelix's waiting list). Reminders gives scripts no
 * way to clear a due date (JXA and AppleScript both refuse), so the reminder is made again without one:
 * same title, notes (with the levelix: tag), priority and tick. Returns the new reminder.
 */
function withoutDay(app, list, reminder) {
  const props = { name: reminder.name(), body: reminder.body() || '' };
  const priority = reminder.priority();
  if (priority) props.priority = priority;
  if (reminder.completed()) props.completed = true;
  const fresh = app.Reminder(props);
  list.reminders.push(fresh);
  app.delete(reminder);
  return fresh;
}

const pad = (n) => String(n).padStart(2, '0');
const toKey = (date) => (date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : null);
function toDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // midday, so no time zone moves it to another day
}

function read(list) {
  const r = list.reminders;
  const ids = r.id();
  const names = r.name();
  const bodies = r.body();
  const completed = r.completed();
  const allday = r.alldayDueDate();
  const due = r.dueDate();
  const priority = r.priority();
  const created = r.creationDate();
  const modified = r.modificationDate();
  return ids.map((id, i) => ({
    id,
    title: names[i] || '',
    body: bodies[i] || '',
    completed: completed[i],
    date: toKey(allday[i] || due[i]),
    priority: Number.isFinite(priority[i]) ? priority[i] : 0,
    created: created[i] ? created[i].getTime() : 0,
    modified: modified[i] ? modified[i].getTime() : 0,
  }));
}

function apply(app, list, ops) {
  const reminders = list.reminders;
  for (const op of ops) {
    if (op.op === 'create') {
      const props = { name: op.title, body: `levelix:${op.taskId}` };
      if (op.date) props.alldayDueDate = toDate(op.date);
      if (op.priority) props.priority = op.priority;
      if (op.completed) props.completed = true; // work finished before the first sync still lands on its day
      reminders.push(app.Reminder(props));
    } else if (op.op === 'update') {
      let reminder = reminders.byId(op.id);
      if (op.date === null) reminder = withoutDay(app, list, reminder);
      if (op.title !== undefined) reminder.name = op.title;
      if (op.date) reminder.alldayDueDate = toDate(op.date);
      if (op.completed !== undefined) reminder.completed = op.completed;
      if (op.priority !== undefined) reminder.priority = op.priority;
    } else if (op.op === 'retag') {
      // The same reminder now belongs to another task (a pulled task keeps its reminder).
      const reminder = reminders.byId(op.id);
      reminder.body = String(reminder.body() || '').replace(TAG, `levelix:${op.taskId}`);
    } else if (op.op === 'delete') {
      app.delete(reminders.byId(op.id));
    }
  }
  return { applied: ops.length };
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
