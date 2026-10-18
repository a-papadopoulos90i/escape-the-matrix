import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { emailFor, extendUntil, longDay, makeCode, periodFor, refundEmailFor, shortenUntil, verifySignature } from '../../functions/logic.js';
import { createWebhook } from '../../functions/webhook.js';

const SECRET = 'whsec_test';
const NOW = new Date('2026-10-17T10:00:00.000Z');
const sign = (payload, t = Math.floor(NOW.getTime() / 1000), secret = SECRET) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

test('only a call Stripe signed, recently, with our secret passes', () => {
  const body = '{"id":"evt_1"}';
  const t = Math.floor(NOW.getTime() / 1000);
  assert.equal(verifySignature(body, sign(body), SECRET, t), true);
  assert.equal(verifySignature(body, sign(body, t, 'whsec_other'), SECRET, t), false); // someone else's secret
  assert.equal(verifySignature('{"id":"evt_2"}', sign(body), SECRET, t), false); // the body was changed
  assert.equal(verifySignature(body, sign(body, t - 600), SECRET, t), false); // an old call, replayed
  assert.equal(verifySignature(body, '', SECRET, t), false);
  assert.equal(verifySignature(body, `t=${t},v1=nothex`, SECRET, t), false);
});

test('what was paid says which plan it was; anything else grants nothing', () => {
  assert.equal(periodFor({ amount_total: 480, currency: 'eur' }), 'monthly');
  assert.equal(periodFor({ amount_total: 2800, currency: 'eur' }), 'yearly');
  assert.equal(periodFor({ amount_total: 2800, currency: 'usd' }), null);
  assert.equal(periodFor({ amount_total: 100, currency: 'eur' }), null);
});

test('buying again early adds to the Pro time left; a refund takes those days back, never below now', () => {
  const fresh = extendUntil('monthly', null, NOW);
  assert.equal(fresh, '2026-11-20T10:00:00.000Z'); // 31 days and 3 over
  const stacked = extendUntil('yearly', fresh, NOW);
  assert.equal(stacked, new Date(Date.parse(fresh) + 370 * 86_400_000).toISOString());
  assert.equal(extendUntil('monthly', '2026-01-01T00:00:00.000Z', NOW), fresh); // a past end counts from now

  assert.equal(shortenUntil('yearly', stacked, NOW), fresh);
  assert.equal(shortenUntil('monthly', fresh, NOW), NOW.toISOString());
});

test('codes look like the ones the Codes screen makes, and the email says what to do with them', () => {
  assert.match(makeCode(), /^LVX[ABCDEFGHJKLMNPQRTUVWXY2346789]{9}$/);
  assert.equal(longDay('2026-11-20T10:00:00.000Z'), '20 November 2026');
  assert.equal(longDay('2026-11-20T23:30:00.000Z'), '21 November 2026'); // Greek time, not UTC

  const withCode = emailFor({ code: 'LVXABCDEFGHJ', until: '2026-11-20T10:00:00.000Z', period: 'monthly' });
  assert.equal(withCode.subject, 'Your Levelix Pro code: LVXABCDEFGHJ');
  assert.match(withCode.text, /Your code: LVXABCDEFGHJ/);
  assert.match(withCode.text, /under Pricing press “I have a code”/); // where the code box is now
  assert.match(withCode.text, /until 20 November 2026/);
  assert.match(withCode.text, /full refund within 14 days/);

  const on = emailFor({ until: '2027-10-22T10:00:00.000Z', period: 'yearly' });
  assert.equal(on.subject, 'Levelix Pro is on');
  assert.match(on.text, /for one year/);
  assert.doesNotMatch(on.text, /code/i);
  assert.match(on.text, /Refund policy/);

  const back = refundEmailFor({ amount: 480, currency: 'eur', period: 'monthly' });
  assert.equal(back.subject, 'Your Levelix refund');
  assert.match(back.text, /refunded €4,80 for Levelix Pro \(one month\)/);
  assert.match(back.text, /Pro has ended/);
});

// ---------- The whole webhook, against an in-memory Firestore ----------

function fakeFirestore(seed = {}) {
  const data = structuredClone(seed); // { 'collection/id': {...} }
  const ref = (path) => ({
    path,
    get: async () => snapshot(path),
    update: async (patch) => void (data[path] = { ...data[path], ...patch }),
  });
  const snapshot = (path) => ({ exists: path in data, data: () => (path in data ? structuredClone(data[path]) : undefined) });
  const collection = (name) => ({
    doc: (id) => ref(`${name}/${id}`),
    where: (field, _op, value) => ({
      limit: () => ({
        get: async () => {
          const docs = Object.keys(data)
            .filter((path) => path.startsWith(`${name}/`) && data[path][field] === value)
            .map((path) => ({ ref: ref(path), data: () => structuredClone(data[path]) }));
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
  });
  return {
    data,
    collection,
    runTransaction: async (work) => {
      const writes = [];
      const tx = {
        get: async (r) => snapshot(r.path),
        set: (r, value) => writes.push(() => void (data[r.path] = structuredClone(value))),
        update: (r, patch) => writes.push(() => void (data[r.path] = { ...data[r.path], ...patch })),
        create: (r, value) =>
          writes.push(() => {
            if (r.path in data) throw new Error('already exists');
            data[r.path] = structuredClone(value);
          }),
      };
      const result = await work(tx);
      writes.forEach((write) => write());
      return result;
    },
  };
}

function harness({ seed, users = ['user_abc123'], failMail = 0 } = {}) {
  const db = fakeFirestore(seed);
  const mails = [];
  let failures = failMail;
  const webhook = createWebhook({
    db,
    auth: { getUser: async (uid) => (users.includes(uid) ? { uid } : Promise.reject(new Error('no user'))) },
    sendMail: async (mail) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('SMTP down');
      }
      mails.push(mail);
    },
    secret: () => SECRET,
    log: {},
    now: () => NOW,
  });
  const call = async (event, { signature } = {}) => {
    const body = JSON.stringify(event);
    const res = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, send(b) { this.body = b; return this; }, json(b) { this.body = b; return this; } };
    // Stripe's signature is checked against real time; sign "now" for the handler's own clock.
    const t = Math.floor(Date.now() / 1000);
    await webhook({ method: 'POST', rawBody: Buffer.from(body), headers: { 'stripe-signature': signature ?? sign(body, t) } }, res);
    return res;
  };
  return { db, mails, call };
}

const paid = (extra = {}) => ({
  id: 'evt_paid',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_1',
      payment_status: 'paid',
      amount_total: 480,
      currency: 'eur',
      payment_intent: 'pi_1',
      livemode: true,
      customer_details: { email: 'maria@example.com' },
      client_reference_id: null,
      ...extra,
    },
  },
});

test('a buyer who was not signed in gets a code by email, once — even when Stripe sends the event twice', async () => {
  const { db, mails, call } = harness();
  const first = await call(paid());
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.outcome, 'code');

  const sale = db.data['sales/cs_1'];
  assert.match(sale.code, /^LVX/);
  assert.equal(sale.until, '2026-11-20T10:00:00.000Z');
  assert.equal(sale.emailedAt, NOW.toISOString());
  assert.deepEqual(db.data[`vouchers/${sale.code}`], { redeemedBy: null, period: 'monthly', until: sale.until, createdAt: NOW.toISOString(), sale: 'cs_1' });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'maria@example.com');
  assert.match(mails[0].text, new RegExp(sale.code));

  await call(paid()); // Stripe retries happen
  assert.equal(Object.keys(db.data).filter((path) => path.startsWith('vouchers/')).length, 1);
  assert.equal(mails.length, 1);
});

test('a buyer who was signed in is Pro at once, and buying again early stacks the time', async () => {
  const { db, mails, call } = harness();
  const res = await call(paid({ client_reference_id: 'user_abc123', amount_total: 2800 }));
  assert.equal(res.body.outcome, 'pro');
  assert.deepEqual(db.data['billing/user_abc123'], {
    plan: 'pro',
    period: 'yearly',
    currentPeriodEnd: '2027-10-22T10:00:00.000Z',
    source: 'stripe',
    sale: 'cs_1',
    updatedAt: NOW.toISOString(),
  });
  assert.equal(Object.keys(db.data).some((path) => path.startsWith('vouchers/')), false); // no code needed
  assert.equal(mails[0].subject, 'Levelix Pro is on');

  await call(paid({ id: 'cs_2', client_reference_id: 'user_abc123', payment_intent: 'pi_2' }));
  assert.equal(db.data['billing/user_abc123'].currentPeriodEnd, '2027-11-25T10:00:00.000Z'); // a month on top of the year
});

test('a reference that is no real account falls back to a code, so the buyer is never left with nothing', async () => {
  const { db, call } = harness();
  const res = await call(paid({ client_reference_id: 'someone_else_99' }));
  assert.equal(res.body.outcome, 'code');
  assert.equal(db.data['billing/someone_else_99'], undefined);
});

test('unsigned calls, unpaid sessions and unknown amounts change nothing', async () => {
  const { db, mails, call } = harness();
  assert.equal((await call(paid(), { signature: 't=1,v1=00' })).statusCode, 400);
  assert.equal((await call(paid({ payment_status: 'unpaid' }))).body.outcome, 'unpaid');
  assert.equal((await call(paid({ amount_total: 999 }))).body.outcome, 'unknown-plan');
  assert.equal((await call({ id: 'evt_x', type: 'customer.created', data: { object: {} } })).body.outcome, 'ignored');
  assert.deepEqual(db.data, {});
  assert.equal(mails.length, 0);
});

test('when the email fails, Stripe is asked to try again — and the retry only sends the email', async () => {
  const { db, mails, call } = harness({ failMail: 1 });
  assert.equal((await call(paid())).statusCode, 500);
  const code = db.data['sales/cs_1'].code;
  assert.equal(db.data['sales/cs_1'].emailedAt, null);

  assert.equal((await call(paid())).statusCode, 200);
  assert.equal(db.data['sales/cs_1'].code, code); // the same code, not a second one
  assert.equal(mails.length, 1);
  assert.equal(db.data['sales/cs_1'].emailedAt, NOW.toISOString());
});

test('a full refund ends what it paid for: an unused code stops working, a redeemed one takes the account back', async () => {
  const refund = (extra = {}) => ({ id: 'evt_refund', type: 'charge.refunded', data: { object: { refunded: true, payment_intent: 'pi_1', ...extra } } });

  // Code never used: it simply stops working.
  const unused = harness();
  await unused.call(paid());
  const code = unused.db.data['sales/cs_1'].code;
  assert.equal((await unused.call(refund({ refunded: false }))).body.outcome, 'partial'); // partial refunds leave it alone
  assert.equal((await unused.call(refund())).body.outcome, 'refunded');
  assert.equal(unused.db.data[`vouchers/${code}`].until, NOW.toISOString());
  assert.equal((await unused.call(refund())).body.outcome, 'already');

  // Code already redeemed: the account's Pro time shrinks by what was refunded.
  const redeemed = harness();
  await redeemed.call(paid());
  const used = redeemed.db.data['sales/cs_1'].code;
  redeemed.db.data[`vouchers/${used}`].redeemedBy = 'user_abc123';
  redeemed.db.data['billing/user_abc123'] = { plan: 'pro', voucher: used, period: 'monthly', currentPeriodEnd: '2026-11-20T10:00:00.000Z' };
  await redeemed.call(refund());
  assert.equal(redeemed.db.data['billing/user_abc123'].currentPeriodEnd, NOW.toISOString());

  // Signed-in purchase: same, straight from the sale.
  const direct = harness();
  await direct.call(paid({ client_reference_id: 'user_abc123' }));
  const before = direct.mails.length;
  await direct.call(refund());
  assert.equal(direct.db.data['billing/user_abc123'].currentPeriodEnd, NOW.toISOString());
  assert.equal(direct.db.data['sales/cs_1'].refundedAt, NOW.toISOString());
  // The buyer hears about it once: the money is on its way and Pro has ended.
  assert.equal(direct.mails.length, before + 1);
  assert.equal(direct.mails.at(-1).subject, 'Your Levelix refund');
  await direct.call(refund());
  assert.equal(direct.mails.length, before + 1);
});

test('deleting an account removes its planner and Pro state, nothing else', async () => {
  const { createCleanup } = await import('../../functions/account.js');
  const deleted = [];
  const db = { collection: (name) => ({ doc: (id) => ({ delete: async () => deleted.push(`${name}/${id}`) }) }) };
  assert.deepEqual(await createCleanup({ db })('user_abc123'), ['users/user_abc123', 'billing/user_abc123']);
  assert.deepEqual(deleted, ['users/user_abc123', 'billing/user_abc123']); // sales and vouchers stay
  assert.deepEqual(await createCleanup({ db })(''), []);
});

// ---------- Refund from the app ----------

function refundHarness({ sales = {}, vouchers = {}, now = new Date('2026-10-20T10:00:00.000Z') } = {}) {
  const data = { sales: structuredClone(sales), vouchers: structuredClone(vouchers) };
  const snapshot = (id, value) => ({ id, exists: value !== undefined, data: () => structuredClone(value) });
  const db = {
    collection: (name) => ({
      where: (field, _op, value) => ({
        get: async () => ({ docs: Object.entries(data[name]).filter(([, doc]) => doc[field] === value).map(([id, doc]) => snapshot(id, doc)) }),
      }),
      doc: (id) => ({
        get: async () => snapshot(id, data[name][id]),
        update: async (patch) => void (data[name][id] = { ...data[name][id], ...patch }),
      }),
    }),
  };
  const calls = [];
  return { data, calls, refund: createRefunds({ db, stripeRefund: async (args) => calls.push(args), now: () => now }) };
}

const { createRefunds, stripeRefunder, REFUND_DAYS } = await import('../../functions/refund.js');

test('Refund: the latest purchase within 14 days is refunded at Stripe, once, and marked', async () => {
  const { data, calls, refund } = refundHarness({
    sales: {
      cs_old: { uid: 'u1', paymentIntent: 'pi_old', createdAt: '2026-09-01T10:00:00.000Z', amount: 480, currency: 'eur', refundedAt: null },
      cs_new: { uid: 'u1', paymentIntent: 'pi_new', createdAt: '2026-10-17T22:56:55.605Z', amount: 480, currency: 'eur', period: 'monthly', refundedAt: null },
      cs_other: { uid: 'u2', paymentIntent: 'pi_other', createdAt: '2026-10-19T10:00:00.000Z', amount: 2800, currency: 'eur', refundedAt: null },
    },
  });
  assert.equal(REFUND_DAYS, 14);
  const about = { amount: 480, currency: 'eur', period: 'monthly', paidAt: '2026-10-17T22:56:55.605Z', until: '2026-10-31T22:56:55.605Z' };
  // The Refund policy page asks first: nothing happens at Stripe.
  assert.deepEqual(await refund('u1', { check: true }), { status: 'eligible', ...about });
  assert.equal(calls.length, 0);
  assert.deepEqual(await refund('u1'), { status: 'refunded', ...about });
  assert.deepEqual(await refund('u1', { check: true }), { status: 'already', paidAt: about.paidAt, amount: 480, currency: 'eur' }); // asked once already
  assert.deepEqual(calls, [{ paymentIntent: 'pi_new', idempotencyKey: 'levelix-refund-cs_new', metadata: { uid: 'u1', sale: 'cs_new' } }]);
  assert.equal(data.sales.cs_new.refundRequestedAt, '2026-10-20T10:00:00.000Z');
  assert.equal(data.sales.cs_other.refundRequestedAt, undefined); // another account's purchase is never touched
});

test('Refund: a purchase older than 14 days, or none at all, is not refunded', async () => {
  const late = refundHarness({ sales: { cs_1: { uid: 'u1', paymentIntent: 'pi_1', createdAt: '2026-10-01T10:00:00.000Z', refundedAt: null } } });
  assert.deepEqual(await late.refund('u1'), { status: 'too-late', paidAt: '2026-10-01T10:00:00.000Z', until: '2026-10-15T10:00:00.000Z' });
  assert.equal(late.calls.length, 0);

  const done = refundHarness({ sales: { cs_1: { uid: 'u1', paymentIntent: 'pi_1', createdAt: '2026-10-19T10:00:00.000Z', refundedAt: '2026-10-19T12:00:00.000Z' } } });
  assert.deepEqual(await done.refund('u1'), { status: 'already', paidAt: '2026-10-19T10:00:00.000Z', amount: undefined, currency: undefined });
  assert.equal(done.calls.length, 0);
  assert.deepEqual(await refundHarness().refund('u1', { check: true }), { status: 'none' }); // Pro from a code nobody paid for
});

test('Refund: a purchase made with a code counts for the account that redeemed it', async () => {
  const { calls, refund } = refundHarness({
    sales: { cs_code: { uid: null, code: 'LVXAAAA22222', paymentIntent: 'pi_code', createdAt: '2026-10-18T10:00:00.000Z', amount: 2800, currency: 'eur', refundedAt: null } },
    vouchers: { LVXAAAA22222: { redeemedBy: 'u1', sale: 'cs_code' } },
  });
  assert.equal((await refund('u1')).status, 'refunded');
  assert.equal(calls[0].paymentIntent, 'pi_code');
});

test('the Stripe call: one form POST with an idempotency key; an already refunded charge is fine', async () => {
  const seen = [];
  const ok = stripeRefunder('rk_test', async (url, init) => (seen.push({ url, init }), { ok: true }));
  await ok({ paymentIntent: 'pi_1', idempotencyKey: 'levelix-refund-cs_1', metadata: { uid: 'u1' } });
  assert.equal(seen[0].url, 'https://api.stripe.com/v1/refunds');
  assert.equal(seen[0].init.headers['Idempotency-Key'], 'levelix-refund-cs_1');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer rk_test');
  assert.equal(seen[0].init.body.get('payment_intent'), 'pi_1');
  assert.equal(seen[0].init.body.get('metadata[uid]'), 'u1');

  const already = stripeRefunder('rk_test', async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 'charge_already_refunded' } }) }));
  await already({ paymentIntent: 'pi_1', idempotencyKey: 'k' });
  const broken = stripeRefunder('rk_test', async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key' } }) }));
  await assert.rejects(() => broken({ paymentIntent: 'pi_1', idempotencyKey: 'k' }), /Invalid API Key/);
});
