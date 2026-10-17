// Where the Pro buttons lead: Stripe payment links (live). Each one sends the customer back to
// levelix.eu/?pro=thanks. An empty link would leave its button disabled, reading "Coming soon".
export const payLinks = {
  monthly: 'https://buy.stripe.com/6oUbJ17Qk0IZbERfmS6Zy01', // Levelix Pro — 1 month, €4.80 one-off
  yearly: 'https://buy.stripe.com/9B628r2w0gHX6kx5Mi6Zy00', // Levelix Pro — 1 year, €28 one-off
  portal: '', // Stripe's customer portal (change card, invoices, cancel)
};

let buyer = null;

/** Who is signed in (or null), so a checkout can turn that very account Pro the moment it is paid. */
export function setBuyer(user) {
  buyer = user?.uid ? user.uid : null;
}

/**
 * The payment link for `period`. Signed in, it carries the account's uid as Stripe's
 * client_reference_id — handed back to the webhook, which then needs no code at all. (Only the uid:
 * no email or name goes into the address.)
 */
export function checkoutUrl(period) {
  const base = payLinks[period];
  if (!base || !buyer) return base;
  const url = new URL(base);
  url.searchParams.set('client_reference_id', buyer);
  return url.toString();
}

/**
 * Stripe sends the customer back to levelix.eu/?pro=thanks when the payment goes through. The
 * parameter is read once and dropped from the address bar, so a reload does not say it all again.
 */
export function capturePayReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('pro') !== 'thanks') return false;
  params.delete('pro');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  return true;
}

/** Anything in the app can ask for the "I have a code" box; the account module opens it. */
export const REDEEM_EVENT = 'levelix:redeem';
export const askForCodeBox = () => document.dispatchEvent(new CustomEvent(REDEEM_EVENT));
