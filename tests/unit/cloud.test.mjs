import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudAdapter, docSignature } from '../../js/storage/cloud.js';
import { createEmptyDoc, createStore } from '../../js/store.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const T = (day, hour = 0) => `2026-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const ids = (doc) => doc.tasks.map((task) => task.id).sort();

function task(id, updatedAt = T(1)) {
  return { id, title: id, date: '2026-03-11', quadrant: 'do', order: 1, done: false, doneAt: null, createdAt: T(1), updatedAt, timer: null };
}

function docWith(updatedAt, ...tasks) {
  return { ...createEmptyDoc(), updatedAt, tasks };
}

/** In-memory stand-in for the four Firestore functions cloud.js uses. */
function fakeFirestore(initial = null) {
  const state = { data: initial, writes: [], listeners: [], readError: null, writeError: null };
  const snapshot = (data, metadata = { hasPendingWrites: false, fromCache: false }) => ({
    exists: () => data !== null,
    data: () => data,
    metadata,
  });
  const firestore = {
    doc: (db, collection, id) => ({ path: `${collection}/${id}` }),
    async getDoc() {
      if (state.readError) throw state.readError;
      return snapshot(state.data);
    },
    async setDoc(ref, data) {
      if (state.writeError) throw state.writeError;
      state.data = data;
      state.writes.push(data);
    },
    onSnapshot(ref, next, error) {
      const listener = { next, error };
      state.listeners.push(listener);
      return () => state.listeners.splice(state.listeners.indexOf(listener), 1);
    },
  };
  const push = (data, metadata) => state.listeners.forEach((listener) => listener.next(snapshot(data, metadata)));
  return { firestore, state, push };
}

function adapterFor(fake, options = {}) {
  const statuses = [];
  const cloud = createCloudAdapter({
    db: {},
    uid: 'u1',
    email: 'a@example.com',
    firestore: fake.firestore,
    onStatus: (status) => statuses.push(status),
    saveDelayMs: 5,
    ...options,
  });
  return { cloud, statuses };
}

test('docSignature ignores task order and envelope timestamps', () => {
  const a = docWith(T(1), task('x'), task('y'));
  const b = docWith(T(9), task('y'), task('x'));
  assert.equal(docSignature(a), docSignature(b));
  assert.notEqual(docSignature(a), docSignature(docWith(T(1), task('x'))));
});

test('load() returns the remote doc, or null when the user has no document yet', async () => {
  const remote = docWith(T(2), task('r'));
  const fake = fakeFirestore({ doc: remote, updatedAt: T(2), email: 'a@example.com' });
  const { cloud, statuses } = adapterFor(fake);
  assert.deepEqual(ids(await cloud.load()), ['r']);
  assert.deepEqual(statuses, ['syncing', 'synced']);

  const empty = adapterFor(fakeFirestore(null));
  assert.equal(await empty.cloud.load(), null);
});

test('save() debounces and coalesces into one { doc, updatedAt, email } envelope', async () => {
  const fake = fakeFirestore(null);
  const { cloud, statuses } = adapterFor(fake);
  await cloud.load();
  const first = cloud.save(docWith(T(3), task('a')));
  const second = cloud.save(docWith(T(3), task('a'), task('b')));
  await Promise.all([first, second]);
  assert.equal(fake.state.writes.length, 1);
  const [envelope] = fake.state.writes;
  assert.deepEqual(Object.keys(envelope).sort(), ['doc', 'email', 'updatedAt']);
  assert.deepEqual(ids(envelope.doc), ['a', 'b']);
  assert.equal(envelope.email, 'a@example.com');
  assert.match(envelope.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(statuses, ['syncing', 'synced', 'syncing', 'synced']);
});

test('nothing is written before the server state is known; the first server snapshot releases it', async () => {
  const fake = fakeFirestore(null);
  const { cloud } = adapterFor(fake);
  cloud.onRemote(() => {});
  cloud.save(docWith(T(3), task('a')));
  await sleep(25);
  assert.equal(fake.state.writes.length, 0, 'held back: server never read');

  fake.push(null, { hasPendingWrites: false, fromCache: true });
  await sleep(25);
  assert.equal(fake.state.writes.length, 0, 'a cache-only snapshot is not the server');

  fake.push(null, { hasPendingWrites: false, fromCache: false });
  await sleep(25);
  assert.equal(fake.state.writes.length, 1);
});

test('a newer remote version replaces a doc queued before it arrived (no stale overwrite)', async () => {
  const fake = fakeFirestore(null);
  fake.state.readError = new Error('offline');
  const { cloud } = adapterFor(fake);
  assert.equal(await cloud.load(), null);

  // Mimic auth.js: whatever the remote merge produces is reconciled straight back.
  const store = createStore(docWith(T(1), task('local')));
  store.attach(cloud);
  store.subscribe((doc, meta) => meta.reason === 'replace' && cloud.reconcile(doc));
  cloud.reconcile(store.get()); // queued, but held (server unknown)

  fake.push({ doc: docWith(T(5), task('remote')), updatedAt: T(5), email: null });
  await sleep(25);
  assert.deepEqual(ids(store.get()), ['local', 'remote']);
  assert.equal(fake.state.writes.length, 1);
  assert.deepEqual(ids(fake.state.writes[0].doc), ['local', 'remote'], 'the merged doc was written, not the stale one');
});

test('a device that started offline does not overwrite a newer server doc it merely subsets', async () => {
  const fake = fakeFirestore(null);
  fake.state.readError = new Error('client is offline');
  const { cloud } = adapterFor(fake);
  assert.equal(await cloud.load(), null);

  const store = createStore(docWith(T(1), task('old')));
  store.attach(cloud);
  store.subscribe((doc, meta) => meta.reason === 'replace' && cloud.reconcile(doc));
  cloud.reconcile(store.get()); // the stale local doc is queued, held until the server is known

  fake.push({ doc: docWith(T(5), task('old'), task('fromPhone')), updatedAt: T(5), email: null });
  await sleep(25);
  assert.deepEqual(ids(store.get()), ['fromPhone', 'old']);
  assert.equal(fake.state.writes.length, 0, 'nothing to add: the pre-merge doc was dropped, not written');

  // A local edit made meanwhile is still pushed, merged on top of the server version.
  store.addTask({ title: 'typed here', date: '2026-03-11' });
  await store.flush();
  await sleep(25);
  assert.equal(fake.state.writes.length, 1);
  assert.equal(fake.state.writes[0].doc.tasks.length, 3);
});

test('reconcile() never pushes an empty doc over an account that has tasks (cleared device, other tab)', async () => {
  const fake = fakeFirestore({ doc: docWith(T(2), task('r')), updatedAt: T(2), email: null });
  const { cloud } = adapterFor(fake);
  await cloud.load();
  cloud.reconcile(createEmptyDoc());
  await sleep(25);
  assert.equal(fake.state.writes.length, 0);

  const fresh = fakeFirestore(null);
  const empty = adapterFor(fresh);
  await empty.cloud.load();
  empty.cloud.reconcile(docWith(T(3), task('a')));
  await sleep(25);
  assert.equal(fresh.state.writes.length, 1, 'a first document for a new account is still written');
});

test('onRemote applies only versions newer than the last one written or applied', async () => {
  const fake = fakeFirestore({ doc: docWith(T(2), task('r')), updatedAt: T(2), email: null });
  const { cloud } = adapterFor(fake);
  await cloud.load();
  const applied = [];
  cloud.onRemote((doc) => applied.push(ids(doc)));

  fake.push({ doc: docWith(T(2), task('same')), updatedAt: T(2), email: null });
  fake.push({ doc: docWith(T(1), task('older')), updatedAt: T(1), email: null });
  assert.deepEqual(applied, [], 'same or older versions are ignored');

  fake.push({ doc: docWith(T(4), task('newer')), updatedAt: T(4), email: null });
  assert.deepEqual(applied, [['newer']]);

  fake.push({ doc: docWith(T(6), task('mine')), updatedAt: T(6), email: null }, { hasPendingWrites: true, fromCache: true });
  assert.deepEqual(applied, [['newer']], 'echoes of our own pending writes are ignored');

  fake.push({ doc: docWith(T(6), task('mine')), updatedAt: T(6), email: null }, { hasPendingWrites: false, fromCache: true });
  assert.deepEqual(applied, [['newer'], ['mine']], 'a newer cached copy is still news to us');
});

test('the server-acknowledged echo of our own write is not applied again', async () => {
  const fake = fakeFirestore(null);
  const { cloud } = adapterFor(fake);
  await cloud.load();
  const applied = [];
  cloud.onRemote((doc) => applied.push(ids(doc)));
  await cloud.save(docWith(T(3), task('a')));
  fake.push(fake.state.writes[0]);
  assert.deepEqual(applied, []);
});

test('reconcile() writes only when the content differs from the server copy', async () => {
  const remote = docWith(T(2), task('r'), task('s'));
  const fake = fakeFirestore({ doc: remote, updatedAt: T(2), email: null });
  const { cloud } = adapterFor(fake);
  await cloud.load();

  cloud.reconcile(docWith(T(9), task('s'), task('r'))); // same tasks, other order/timestamp
  await sleep(25);
  assert.equal(fake.state.writes.length, 0);

  cloud.reconcile(docWith(T(9), task('r'), task('s'), task('local')));
  await sleep(25);
  assert.equal(fake.state.writes.length, 1);
  assert.deepEqual(ids(fake.state.writes[0].doc), ['local', 'r', 's']);

  cloud.reconcile(docWith(T(9), task('r'), task('s'), task('local')));
  await sleep(25);
  assert.equal(fake.state.writes.length, 1, 'now identical to what we wrote');
});

test('write stamps stay strictly newer than the remote version even with a slow clock', async () => {
  const fake = fakeFirestore({ doc: docWith(T(20), task('r')), updatedAt: T(20), email: null });
  const { cloud } = adapterFor(fake, { now: () => Date.parse(T(10)) });
  await cloud.load();
  await cloud.save(docWith(T(10), task('r'), task('x')));
  assert.ok(fake.state.writes[0].updatedAt > T(20));
});

test('status reports offline, syncing, synced and error (writes keep the error until one succeeds)', async () => {
  const fake = fakeFirestore(null);
  let online = false;
  const { cloud, statuses } = adapterFor(fake, { isOnline: () => online });
  cloud.refreshStatus();
  assert.deepEqual(statuses, ['offline']);

  online = true;
  cloud.refreshStatus();
  await cloud.load();
  assert.deepEqual(statuses, ['offline', 'synced', 'syncing', 'synced']);

  fake.state.writeError = new Error('permission-denied');
  await cloud.save(docWith(T(3), task('a')));
  assert.equal(statuses.at(-1), 'error');

  fake.state.writeError = null;
  await cloud.save(docWith(T(3), task('a'), task('b')));
  assert.equal(statuses.at(-1), 'synced');
  assert.equal(fake.state.writes.length, 1);
});

test('store integration: a remote snapshot is merged (union) into the store', async () => {
  const fake = fakeFirestore(null);
  const { cloud } = adapterFor(fake);
  await cloud.load();
  const store = createStore(docWith(T(1), task('local')));
  store.attach(cloud);
  fake.push({ doc: docWith(T(5), task('remote')), updatedAt: T(5), email: null });
  assert.deepEqual(ids(store.get()), ['local', 'remote']);
});

test('dispose() stops listening, drops queued writes and resolves pending saves', async () => {
  const fake = fakeFirestore(null);
  const { cloud } = adapterFor(fake);
  await cloud.load();
  const applied = [];
  cloud.onRemote((doc) => applied.push(ids(doc)));
  const pending = cloud.save(docWith(T(3), task('a')));
  cloud.dispose();
  await pending;
  await sleep(25);
  assert.equal(fake.state.writes.length, 0);
  assert.equal(fake.state.listeners.length, 0);
  fake.push({ doc: docWith(T(5), task('r')), updatedAt: T(5), email: null });
  assert.deepEqual(applied, []);
  await cloud.save(docWith(T(3), task('b')));
  assert.equal(fake.state.writes.length, 0, 'saves after dispose are no-ops');
});
