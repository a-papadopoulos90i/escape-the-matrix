// The pure half of the Stripe webhook: checking that a call really comes from Stripe, reading what was
// bought, and writing the email. No I/O here, so every rule is unit-tested (tests/unit/webhook.test.mjs).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Stripe signs each call; one older than this is refused, so a captured call cannot be replayed. */
export const SIGNATURE_TOLERANCE_SEC = 5 * 60;

/**
 * True when `header` (Stripe-Signature: "t=…,v1=…") is Stripe's signature of `payload` with `secret`.
 * Stripe's own scheme: v1 = HMAC-SHA256(secret, `${t}.${payload}`), hex.
 */
export function verifySignature(payload, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!payload || !header || !secret) return false;
  const parts = String(header).split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSec - timestamp) > SIGNATURE_TOLERANCE_SEC) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex'));
  return signatures.some((signature) => {
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// What each payment link sells, told apart by what was paid (cents, tax included).
const PLANS = { 480: 'monthly', 2800: 'yearly' };
// How long each lasts — the same as a code made by hand in the app (js/billing.js), days to spare included.
const PERIOD_DAYS = { monthly: 31 + 3, yearly: 365 + 5 };

/** 'monthly' | 'yearly' for a paid checkout, or null when it is neither (then nothing is granted). */
export function periodFor(session) {
  if (session?.currency !== 'eur') return null;
  return PLANS[session.amount_total] ?? null;
}

export const periodDays = (period) => PERIOD_DAYS[period] ?? 0;
const DAY_MS = 86_400_000; // whole days in milliseconds: a clock change in between moves nothing

/**
 * When Pro ends after buying `period`: counted from now, or from the end of the Pro time the account
 * still has, so buying again early never throws days away.
 */
export function extendUntil(period, currentEnd = null, now = new Date()) {
  const ends = typeof currentEnd === 'string' ? Date.parse(currentEnd) : NaN;
  const from = Number.isFinite(ends) && ends > now.getTime() ? ends : now.getTime();
  return new Date(from + periodDays(period) * DAY_MS).toISOString();
}

/** A refund takes back the days it paid for — never below now. */
export function shortenUntil(period, currentEnd, now = new Date()) {
  const ends = typeof currentEnd === 'string' ? Date.parse(currentEnd) : NaN;
  if (!Number.isFinite(ends)) return now.toISOString();
  return new Date(Math.max(ends - periodDays(period) * DAY_MS, now.getTime())).toISOString();
}

// The same codes the app's own "Codes" screen makes: LVX + 9 characters with no 0/O, 1/I or 5/S.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY2346789';
export function makeCode(random = randomBytes) {
  let code = 'LVX';
  for (const byte of random(9)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "16 November 2026", in Greek time — the day a customer here would call the last one. */
export function longDay(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(new Date(iso))
    .reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
}

const SIGN_OFF = [
  'Changed your mind? You can have a full refund within 14 days: signed in, open the account menu → Refund policy, or just reply to this email.',
  '',
  'Thank you for backing Levelix!',
  'Levelix · https://levelix.eu · info@levelix.eu',
];

/**
 * The email after a payment: with the code when the buyer was not signed in, or saying Pro is already
 * on when they were. Returns { subject, text }.
 */
export function emailFor({ code = null, until, period }) {
  const length = period === 'yearly' ? 'one year' : 'one month';
  if (code) {
    return {
      subject: `Your Levelix Pro code: ${code}`,
      text: [
        `Thank you for buying Levelix Pro for ${length}.`,
        '',
        `Your code: ${code}`,
        '',
        'To turn Pro on: open https://levelix.eu and sign in, then on Home (the logo, top left) under Pricing press “I have a code” next to “Already paid?” and paste it in.',
        `Pro then runs until ${longDay(until)}.`,
        '',
        ...SIGN_OFF,
      ].join('\n'),
    };
  }
  return {
    subject: 'Levelix Pro is on',
    text: [
      `Thank you for buying Levelix Pro for ${length}.`,
      '',
      `It is already on for the account you were signed in with, until ${longDay(until)}: unlimited tasks, the task timer and the time report.`,
      '',
      ...SIGN_OFF,
    ].join('\n'),
  };
}

/** The email after a refund: how much went back, and that Pro has ended (the tasks stay, on Free). */
export function refundEmailFor({ amount, currency, period }) {
  const length = period === 'yearly' ? 'one year' : 'one month';
  const money = currency === 'eur' || !currency ? `€${(Number(amount) / 100).toFixed(2).replace('.', ',')}` : `${(Number(amount) / 100).toFixed(2)} ${String(currency).toUpperCase()}`;
  return {
    subject: 'Your Levelix refund',
    text: [
      `We have refunded ${money} for Levelix Pro (${length}) to the card you paid with. Your bank may take 5–10 days to show it.`,
      '',
      'Pro has ended on your account. Your tasks stay where they are, on the Free plan.',
      '',
      'Sorry it was not for you — if you have a moment, reply and tell us what was missing.',
      'Levelix · https://levelix.eu · info@levelix.eu',
    ].join('\n'),
  };
}
