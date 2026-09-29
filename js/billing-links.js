// Where the Pro buttons lead. Filled in once the Stripe payment links exist; while a link is empty the
// button stays disabled and reads "Coming soon", so the page never promises a checkout that is not there.
export const payLinks = {
  monthly: '',
  yearly: '',
  portal: '', // Stripe's customer portal (change card, invoices, cancel)
};
