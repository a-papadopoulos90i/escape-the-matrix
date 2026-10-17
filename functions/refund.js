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

  /** Returns { status: 'refunded' | 'too-late' | 'none', … } for the account's latest purchase. */
  return async function refund(uid) {
    const open = (await purchasesOf(uid))
      .filter((sale) => !sale.refundedAt && sale.paymentIntent)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const latest = open[0];
    if (!latest) return { status: 'none' };
    if (now().getTime() > Date.parse(latest.createdAt) + REFUND_DAYS * DAY_MS) {
      return { status: 'too-late', paidAt: latest.createdAt };
    }
    await stripeRefund({ paymentIntent: latest.paymentIntent, idempotencyKey: `levelix-refund-${latest.id}`, metadata: { uid, sale: latest.id } });
    await sales.doc(latest.id).update({ refundRequestedAt: now().toISOString() });
    return { status: 'refunded', amount: latest.amount, currency: latest.currency, period: latest.period };
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
