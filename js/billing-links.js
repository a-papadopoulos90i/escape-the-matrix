// Where the Pro buttons lead. Filled in once the Stripe payment links exist; while a link is empty the
// button stays disabled and reads "Coming soon", so the page never promises a checkout that is not there.
export const payLinks = {
  monthly: '',
  yearly: '',
  portal: '', // Stripe's customer portal (change card, invoices, cancel)
};

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
