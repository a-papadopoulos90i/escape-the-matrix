import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddTask, FREE_TASK_LIMIT, isPro, openTaskCount, setPlan } from '../../js/plan.js';
import { createBilling, normalizeCode, VoucherError } from '../../js/billing.js';

const fakeStore = (tasks) => ({ get: () => ({ tasks }) });
const task = (extra = {}) => ({ deleted: false, carriedTo: null, done: false, ...extra });
const ui = () => {
  const toasts = [];
  return { toasts, toast: (message, options) => toasts.push({ message, options }) };
};
const i18n = { t: (key, values) => `${key}:${JSON.stringify(values ?? {})}` };

test('the free limit counts open tasks only — finished work and records are free', () => {
  const store = fakeStore([task(), task({ done: true }), task({ deleted: true }), task({ carriedTo: '2026-03-12' })]);
  assert.equal(openTaskCount(store), 1);
});

test('Free stops at the limit and says so; Pro never does', () => {
  setPlan('free');
  const full = fakeStore(Array.from({ length: FREE_TASK_LIMIT }, () => task()));
  const room = fakeStore(Array.from({ length: FREE_TASK_LIMIT - 1 }, () => task()));
  const box = ui();

  assert.equal(canAddTask({ store: room, ui: box, i18n }), true);
  assert.equal(box.toasts.length, 0);

  assert.equal(canAddTask({ store: full, ui: box, i18n }), false);
  assert.match(box.toasts[0].message, /^plan.limitReached/);

  setPlan('pro');
  assert.equal(isPro(), true);
  assert.equal(canAddTask({ store: full, ui: box, i18n }), true);
  assert.equal(box.toasts.length, 1); // nothing more was said
  setPlan('free');
});

test('codes are read loosely: case, spaces and dashes do not matter', () => {
  assert.equal(normalizeCode(' lev-elix 12ab '), 'LEVELIX12AB');
});

/** A Firestore stand-in: the two collections redeeming touches, in the snapshot shape the SDK gives. */
function fakeFirestore({ vouchers = {}, billing = {} } = {}) {
  const store = { vouchers, billing };
  const snapshot = (value) => ({ exists: () => value !== undefined, data: () => value });
  return {
    store,
    doc: (_db, collection, id) => ({ collection, id }),
    getDoc: async (ref) => snapshot(store[ref.collection][ref.id]),
    setDoc: async (ref, data, options) => {
      store[ref.collection][ref.id] = options?.merge ? { ...store[ref.collection][ref.id], ...data } : data;
    },
    onSnapshot: (ref, next) => {
      next(snapshot(store[ref.collection][ref.id]));
      return () => {};
    },
  };
}

test('redeeming a fresh code claims it and turns the account Pro', async () => {
  const firestore = fakeFirestore({ vouchers: { LEVELIXABC123: { redeemedBy: null, period: 'yearly' } } });
  const seen = [];
  const billing = createBilling({ db: {}, uid: 'u1', firestore, onPlan: (plan) => seen.push(plan) });
  assert.deepEqual(seen, ['free']);

  await billing.redeem('levelix-abc123');
  assert.equal(firestore.store.vouchers.LEVELIXABC123.redeemedBy, 'u1');
  assert.equal(firestore.store.billing.u1.plan, 'pro');
  assert.equal(firestore.store.billing.u1.voucher, 'LEVELIXABC123');
  assert.equal(isPro(), true);
  billing.dispose();
  assert.equal(isPro(), false); // signing out drops back to Free until the next read
});

test('a code that is unknown, already used or too short is refused', async () => {
  const firestore = fakeFirestore({ vouchers: { USEDCODE1: { redeemedBy: 'someone-else' } } });
  const billing = createBilling({ db: {}, uid: 'u1', firestore });

  await assert.rejects(() => billing.redeem('abc'), (error) => error instanceof VoucherError && error.reason === 'invalid');
  await assert.rejects(() => billing.redeem('NOSUCHCODE'), (error) => error.reason === 'unknown');
  await assert.rejects(() => billing.redeem('used-code-1'), (error) => error.reason === 'used');
  assert.equal(isPro(), false);
  billing.dispose();
});

test('a code carries the period it buys: redeeming it writes exactly that end date', async () => {
  const until = new Date(Date.now() + 34 * 86_400_000).toISOString(); // what the webhook writes on a monthly code
  const firestore = fakeFirestore({ vouchers: { LVXMONTHLY234: { redeemedBy: null, period: 'monthly', until } } });
  const billing = createBilling({ db: {}, uid: 'u1', firestore });
  const redeemed = await billing.redeem('LVXMONTHLY234');
  assert.equal(redeemed.until, until);
  assert.equal(firestore.store.billing.u1.currentPeriodEnd, until);
  assert.equal(isPro(), true);
  billing.dispose();
});

test('a billing document whose paid period has passed is Free again; a code made too long ago is refused', async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const firestore = fakeFirestore({
    vouchers: { LVXOLDCODE1: { redeemedBy: null, period: 'monthly', until: past } },
    billing: { u1: { plan: 'pro', voucher: 'LVXGONE', period: 'monthly', currentPeriodEnd: past } },
  });
  const billing = createBilling({ db: {}, uid: 'u1', firestore });
  assert.equal(isPro(), false); // the document says pro, the period says otherwise

  await assert.rejects(() => billing.redeem('LVXOLDCODE1'), (error) => error.reason === 'expired');
  assert.equal(firestore.store.vouchers.LVXOLDCODE1.redeemedBy, null); // nothing was claimed
  billing.dispose();
});

test('Go Pro names the signed-in account to Stripe — by uid only — and nobody when signed out', async () => {
  const { checkoutUrl, payLinks, setBuyer } = await import('../../js/billing-links.js');
  setBuyer(null);
  assert.equal(checkoutUrl('yearly'), payLinks.yearly);

  setBuyer({ uid: 'u_abc123', email: 'maria@example.com' });
  const url = new URL(checkoutUrl('monthly'));
  assert.equal(`${url.origin}${url.pathname}`, payLinks.monthly);
  assert.equal(url.searchParams.get('client_reference_id'), 'u_abc123');
  assert.equal(url.search.includes('maria'), false); // no email in the address

  setBuyer(null);
  assert.equal(checkoutUrl('monthly'), payLinks.monthly);
});
