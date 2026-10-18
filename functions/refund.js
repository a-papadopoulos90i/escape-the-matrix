// Refund from the app: within 14 days of paying, the account's latest purchase is refunded in full at
// Stripe. Nothing else changes here — Stripe then sends charge.refunded, and the webhook ends the Pro
// time it paid for, exactly as for a refund made in the Stripe dashboard. Firestore and the Stripe
// call are handed in, so this is unit-tested.
export const REFUND_DAYS = 14;
const DAY_MS = 86_400_000;

export function createRefunds({ db, stripeRefund, now = () => new Date() }) {
  const sales = db.collection('sales');

  /** Every purchase that made this account Pro: bought signed in, or through a code it redeemed. */
  async function purchasesOf(uid) {
    const found = new Map();
    for (const doc of (await sales.where('uid', '==', uid).get()).docs) found.set(doc.id, doc.data());
    for (const voucher of (await db.collection('vouchers').where('redeemedBy', '==', uid).get()).docs) {
      const saleId = voucher.data().sale;
      if (!saleId || found.has(saleId)) continue;
      const sale = await sales.doc(saleId).get();
      if (sale.exists) found.set(saleId, sale.data());
    }
    return [...found].map(([id, data]) => ({ id, ...data }));
  }

  /**
   * The account's latest purchase: { status: 'eligible' | 'refunded' | 'too-late' | 'already' | 'none', … }.
   * With `check`, it only says whether a refund is possible (the Refund policy page asks this first).
   */
  return async function refund(uid, { check = false } = {}) {
    const purchases = (await purchasesOf(uid))
      .filter((sale) => sale.paymentIntent)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (!purchases.length) return { status: 'none' };
    const untilOf = (sale) => new Date(Date.parse(sale.createdAt) + REFUND_DAYS * DAY_MS).toISOString();
    const open = (sale) => !sale.refundedAt && !sale.refundRequestedAt;
    // The newest purchase still inside its 14 days and not refunded; else say why not, about the newest one.
    const latest = purchases.find((sale) => open(sale) && now().getTime() <= Date.parse(untilOf(sale)));
    if (!latest) {
      const newest = purchases[0];
      return open(newest)
        ? { status: 'too-late', paidAt: newest.createdAt, until: untilOf(newest) }
        : { status: 'already', paidAt: newest.createdAt, amount: newest.amount, currency: newest.currency };
    }
    const paidAt = latest.createdAt;
    const until = untilOf(latest);
    const about = { amount: latest.amount, currency: latest.currency, period: latest.period, paidAt, until };
    if (check) return { status: 'eligible', ...about };
    await stripeRefund({ paymentIntent: latest.paymentIntent, idempotencyKey: `levelix-refund-${latest.id}`, metadata: { uid, sale: latest.id } });
    await sales.doc(latest.id).update({ refundRequestedAt: now().toISOString() });
    return { status: 'refunded', ...about };
  };
}

/** Stripe's refund call, over its REST API (one call is not worth a whole SDK). Asking twice is safe. */
export function stripeRefunder(secretKey, fetchImpl = fetch) {
  return async function stripeRefund({ paymentIntent, idempotencyKey, metadata = {} }) {
    const body = new URLSearchParams({ payment_intent: paymentIntent, reason: 'requested_by_customer' });
    for (const [key, value] of Object.entries(metadata)) body.set(`metadata[${key}]`, value);
    const response = await fetchImpl('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey },
      body,
    });
    if (response.ok) return;
    const error = await response.json().catch(() => ({}));
    if (error?.error?.code === 'charge_already_refunded') return; // already done: nothing more to do
    throw new Error(`Stripe refund failed: ${error?.error?.message ?? response.status}`);
  };
}
