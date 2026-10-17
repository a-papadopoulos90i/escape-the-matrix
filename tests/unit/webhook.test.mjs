import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { emailFor, extendUntil, longDay, makeCode, periodFor, shortenUntil, verifySignature } from '../../functions/logic.js';
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
  assert.match(withCode.text, /“I have a code”/);
  assert.match(withCode.text, /until 20 November 2026/);
  assert.match(withCode.text, /full refund within 14 days/);

  const on = emailFor({ until: '2027-10-22T10:00:00.000Z', period: 'yearly' });
  assert.equal(on.subject, 'Levelix Pro is on');
  assert.match(on.text, /for one year/);
  assert.doesNotMatch(on.text, /code/i);
});

// ---------- The whole webhook, against an in-memory Firestore ----------

function fakeFirestore(seed = {}) {
  const data = structuredClone(seed); // { 'collection/id': {...} }
  const ref = (path) => ({
    path,
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
  await direct.call(refund());
  assert.equal(direct.db.data['billing/user_abc123'].currentPeriodEnd, NOW.toISOString());
  assert.equal(direct.db.data['sales/cs_1'].refundedAt, NOW.toISOString());
});

test('deleting an account removes its planner and Pro state, nothing else', async () => {
  const { createCleanup } = await import('../../functions/account.js');
  const deleted = [];
  const db = { collection: (name) => ({ doc: (id) => ({ delete: async () => deleted.push(`${name}/${id}`) }) }) };
  assert.deepEqual(await createCleanup({ db })('user_abc123'), ['users/user_abc123', 'billing/user_abc123']);
  assert.deepEqual(deleted, ['users/user_abc123', 'billing/user_abc123']); // sales and vouchers stay
  assert.deepEqual(await createCleanup({ db })(''), []);
});
