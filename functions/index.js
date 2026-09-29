// Levelix Pro — Stripe checkout, billing portal and webhook.
//
// The app never decides who is Pro: it only READS billing/{uid}, which nothing but this webhook can
// write (see firestore.rules). Stripe knows the user by the `uid` it carries in the customer's
// metadata, so a subscription found by any event lands on the right account.
//
// Secrets (set once, they are never in the repo):
//   firebase functions:secrets:set STRIPE_SECRET_KEY
//   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
// Price ids live in .env (functions/.env, not committed): STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const PRICE_MONTHLY = defineString('STRIPE_PRICE_MONTHLY');
const PRICE_YEARLY = defineString('STRIPE_PRICE_YEARLY');
const SITE = defineString('SITE_URL', { default: 'https://levelix.eu' });
const REGION = 'europe-west1';

initializeApp();
const db = getFirestore();
const stripe = () => new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: '2024-09-30.acacia' });

const billingRef = (uid) => db.collection('billing').doc(uid);

/** The one Stripe customer for this account, created on first use and remembered both ways. */
async function customerFor(client, uid, email) {
  const snapshot = await billingRef(uid).get();
  const known = snapshot.get('stripeCustomerId');
  if (known) return known;
  const customer = await client.customers.create({ email: email ?? undefined, metadata: { uid } });
  await billingRef(uid).set({ stripeCustomerId: customer.id, plan: 'free', updatedAt: new Date().toISOString() }, { merge: true });
  return customer.id;
}

/** Opens Stripe's hosted checkout for the monthly or yearly plan. Returns { url }. */
export const createCheckout = onCall({ region: REGION, secrets: [STRIPE_SECRET_KEY], cors: [/levelix\.eu$/, /levelix\.web\.app$/] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const period = request.data?.period === 'yearly' ? 'yearly' : 'monthly';
  const price = period === 'yearly' ? PRICE_YEARLY.value() : PRICE_MONTHLY.value();
  if (!price) throw new HttpsError('failed-precondition', 'No price configured.');

  const client = stripe();
  const customer = await customerFor(client, uid, request.auth.token?.email ?? null);
  const session = await client.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: uid,
    subscription_data: { metadata: { uid } },
    allow_promotion_codes: true,
    automatic_tax: { enabled: true }, // Stripe Tax works out EU VAT
    customer_update: { address: 'auto', name: 'auto' },
    success_url: `${SITE.value()}/?checkout=done`,
    cancel_url: `${SITE.value()}/?checkout=cancelled`,
  });
  return { url: session.url };
});

/** Stripe's own page to change card, see invoices or cancel. Returns { url }. */
export const createPortal = onCall({ region: REGION, secrets: [STRIPE_SECRET_KEY], cors: [/levelix\.eu$/, /levelix\.web\.app$/] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const customer = (await billingRef(uid).get()).get('stripeCustomerId');
  if (!customer) throw new HttpsError('failed-precondition', 'No subscription yet.');
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${SITE.value()}/` });
  return { url: session.url };
});

/** What the app is allowed to see: the plan and when the paid period runs out. */
async function writePlan(uid, subscription) {
  const active = ['active', 'trialing', 'past_due'].includes(subscription.status);
  await billingRef(uid).set(
    {
      plan: active ? 'pro' : 'free',
      status: subscription.status,
      period: subscription.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly',
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
      subscriptionId: subscription.id,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/** The uid Stripe carries for a subscription — on the subscription, else on its customer. */
async function uidFor(client, subscription) {
  if (subscription.metadata?.uid) return subscription.metadata.uid;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!customerId) return null;
  const customer = await client.customers.retrieve(customerId);
  return customer?.metadata?.uid ?? null;
}

/** Stripe calls this on every subscription change; nothing else may write billing/{uid}. */
export const stripeWebhook = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
  const client = stripe();
  let event;
  try {
    event = client.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
  } catch (error) {
    res.status(400).send(`Signature check failed: ${error.message}`);
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const uid = session.client_reference_id ?? session.metadata?.uid;
      if (uid && session.subscription) await writePlan(uid, await client.subscriptions.retrieve(session.subscription));
    } else if (event.type.startsWith('customer.subscription.')) {
      const subscription = event.data.object;
      const uid = await uidFor(client, subscription);
      if (uid) await writePlan(uid, subscription);
    }
    res.json({ received: true });
  } catch (error) {
    console.error(event.type, error);
    res.status(500).send('Could not record the change');
  }
});
