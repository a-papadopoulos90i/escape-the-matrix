// What happens when Stripe says a payment went through or was refunded. Firestore, Auth and the mailer
// are handed in (index.js gives the real ones, tests give fakes), so the whole flow is tested end to end.
//
// A sale is recorded once, under the Checkout Session id — Stripe may send the same event more than
// once, and a retry after a failed email only sends the email.
import { emailFor, extendUntil, makeCode, periodFor, shortenUntil, verifySignature } from './logic.js';

const UID = /^[A-Za-z0-9_-]{6,128}$/; // what a Firebase uid looks like (and all client_reference_id allows)

export function createWebhook({ db, auth, sendMail, secret, log = console, now = () => new Date() }) {
  const sales = db.collection('sales');
  const vouchers = db.collection('vouchers');
  const billing = db.collection('billing');

  /** The account to make Pro straight away, if the buyer was signed in when they clicked Go Pro. */
  async function accountOf(session) {
    const uid = session.client_reference_id;
    if (!UID.test(uid ?? '')) return null;
    try {
      await auth.getUser(uid);
      return uid;
    } catch {
      return null; // not a real account: the buyer gets a code instead, so nothing is lost
    }
  }

  async function recordSale(session) {
    if (session.payment_status !== 'paid') return 'unpaid'; // a slower method arrives later as async_payment_succeeded
    const period = periodFor(session);
    if (!period) {
      log.warn?.('A payment that matches no plan', session.id, session.amount_total, session.currency);
      return 'unknown-plan';
    }
    const uid = await accountOf(session);
    const saleRef = sales.doc(session.id);

    const sale = await db.runTransaction(async (tx) => {
      const known = await tx.get(saleRef);
      if (known.exists) return known.data(); // seen before: at most the email is still owed
      const at = now();
      const record = {
        email: session.customer_details?.email ?? session.customer_email ?? null,
        period,
        amount: session.amount_total,
        currency: session.currency,
        paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
        livemode: session.livemode === true,
        uid,
        code: null,
        until: null,
        createdAt: at.toISOString(),
        emailedAt: null,
        refundedAt: null,
      };
      if (uid) {
        const billingRef = billing.doc(uid);
        const current = (await tx.get(billingRef)).data();
        record.until = extendUntil(period, current?.plan === 'pro' ? current.currentPeriodEnd : null, at);
        tx.set(billingRef, { plan: 'pro', period, currentPeriodEnd: record.until, source: 'stripe', sale: session.id, updatedAt: at.toISOString() });
      } else {
        record.code = makeCode();
        record.until = extendUntil(period, null, at);
        tx.create(vouchers.doc(record.code), { redeemedBy: null, period, until: record.until, createdAt: at.toISOString(), sale: session.id });
      }
      tx.set(saleRef, record);
      return record;
    });

    if (!sale.emailedAt && sale.email) {
      const { subject, text } = emailFor({ code: sale.code, until: sale.until, period: sale.period });
      await sendMail({ to: sale.email, subject, text });
      await saleRef.update({ emailedAt: now().toISOString() });
    }
    return sale.code ? 'code' : 'pro';
  }

  /** A full refund ends what it paid for: the code stops working, and the account loses those days. */
  async function recordRefund(charge) {
    if (!charge.refunded) return 'partial'; // a partial refund leaves Pro alone
    const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentIntent) return 'no-sale';
    const found = await sales.where('paymentIntent', '==', paymentIntent).limit(1).get();
    if (found.empty) return 'no-sale';
    const saleRef = found.docs[0].ref;

    return db.runTransaction(async (tx) => {
      const sale = (await tx.get(saleRef)).data();
      if (sale.refundedAt) return 'already';
      const at = now();
      const voucherRef = sale.code ? vouchers.doc(sale.code) : null;
      const voucher = voucherRef ? (await tx.get(voucherRef)).data() : null;
      const uid = sale.uid ?? voucher?.redeemedBy ?? null;
      const billingRef = uid ? billing.doc(uid) : null;
      const current = billingRef ? (await tx.get(billingRef)).data() : null;

      if (voucherRef && voucher) tx.update(voucherRef, { until: at.toISOString() }); // a refunded code unlocks nothing any more
      if (billingRef && current?.plan === 'pro') {
        tx.update(billingRef, { currentPeriodEnd: shortenUntil(sale.period, current.currentPeriodEnd, at), updatedAt: at.toISOString() });
      }
      tx.update(saleRef, { refundedAt: at.toISOString() });
      return 'refunded';
    });
  }

  /** The HTTP side: only a call Stripe signed is read at all. */
  return async function handle(req, res) {
    if (req.method !== 'POST') return void res.status(405).send('POST only');
    const payload = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (!verifySignature(payload, req.headers['stripe-signature'], secret())) return void res.status(400).send('Bad signature');
    const event = JSON.parse(payload);
    try {
      let outcome = 'ignored';
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        outcome = await recordSale(event.data.object);
      } else if (event.type === 'charge.refunded') {
        outcome = await recordRefund(event.data.object);
      }
      log.info?.(event.type, event.id, outcome);
      res.status(200).json({ received: true, outcome });
    } catch (error) {
      log.error?.(event.type, event.id, error);
      res.status(500).send('Could not record it'); // Stripe tries again, and a sale is never recorded twice
    }
  };
}
