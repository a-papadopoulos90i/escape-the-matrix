// Apple Reminders side of the personal Levelix bridge (run by server.mjs through `osascript -l JavaScript`).
// It only ever touches one Reminders list, "Levelix". All merge decisions live in plan.mjs; this script
// only reads the list and carries out the operations it is given.
//   read  <file>  — prints [{ id, title, body, completed, date, created, modified }]
//   apply <file>  — file holds { ops: [{ op: 'create', taskId, title, date } | { op: 'update', id, title?, date?, completed?: boolean } | { op: 'delete', id }] }
//   link  <file>  — file holds { links: [{ reminderId, taskId }] }
ObjC.import('Foundation');

const LIST_NAME = 'Levelix';
const TAG = /levelix:([A-Za-z0-9_-]+)/;

function run(argv) {
  const command = argv[0];
  const input = JSON.parse(readFile(argv[1]));
  const app = Application('Reminders');
  const list = ensureList(app);
  if (command === 'read') return JSON.stringify(read(list));
  if (command === 'apply') return JSON.stringify(apply(app, list, input.ops || []));
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

function read(list) {
  const r = list.reminders;
  const ids = r.id();
  const names = r.name();
  const bodies = r.body();
  const completed = r.completed();
  const allday = r.alldayDueDate();
  const due = r.dueDate();
  const created = r.creationDate();
  const modified = r.modificationDate();
  return ids.map((id, i) => ({
    id,
    title: names[i] || '',
    body: bodies[i] || '',
    completed: completed[i],
    date: toKey(allday[i] || due[i]),
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
      reminders.push(app.Reminder(props));
    } else if (op.op === 'update') {
      const reminder = reminders.byId(op.id);
      if (op.title !== undefined) reminder.name = op.title;
      if (op.date) reminder.alldayDueDate = toDate(op.date);
      if (op.completed !== undefined) reminder.completed = op.completed;
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
