// Levelix Pro — the Stripe webhook. Stripe calls it when a payment link is paid or refunded; it turns
// Pro on (or emails a code) and takes it back on a refund. The flow itself lives in webhook.js.
//
// Secrets (set once from a terminal, never in the repo):
//   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET   — the "signing secret" of the webhook in Stripe
//   firebase functions:secrets:set SMTP_PASSWORD           — the info@levelix.eu mailbox password
// Plain settings live in functions/.env: SMTP_HOST, SMTP_PORT, MAIL_FROM, OWNER_COPY.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import nodemailer from 'nodemailer';
import { createWebhook } from './webhook.js';

const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const SMTP_PASSWORD = defineSecret('SMTP_PASSWORD');
const SMTP_HOST = defineString('SMTP_HOST');
const SMTP_PORT = defineInt('SMTP_PORT', { default: 465 });
const MAIL_FROM = defineString('MAIL_FROM', { default: 'info@levelix.eu' });
const OWNER_COPY = defineString('OWNER_COPY', { default: 'info@levelix.eu' }); // a copy of every email, to the owner

initializeApp();

let transport = null;
function sendMail({ to, subject, text }) {
  transport ??= nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port: SMTP_PORT.value(),
    secure: SMTP_PORT.value() === 465, // 465 speaks TLS from the start; 587 upgrades with STARTTLS
    auth: { user: MAIL_FROM.value(), pass: SMTP_PASSWORD.value() },
  });
  return transport.sendMail({ from: `Levelix <${MAIL_FROM.value()}>`, replyTo: MAIL_FROM.value(), to, bcc: OWNER_COPY.value(), subject, text });
}

let handle = null;
export const stripeWebhook = onRequest({ region: 'europe-west1', secrets: [STRIPE_WEBHOOK_SECRET, SMTP_PASSWORD], maxInstances: 5 }, (req, res) => {
  handle ??= createWebhook({ db: getFirestore(), auth: getAuth(), sendMail, secret: () => STRIPE_WEBHOOK_SECRET.value(), log: logger });
  return handle(req, res);
});
