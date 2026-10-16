// Levelix Pro for one signed-in account: watches billing/{uid} and redeems voucher codes.
//
// The app cannot make itself Pro: firestore.rules only accept a billing document that names a voucher
// this account has claimed. A code works once. (When the Stripe webhook runs, it writes the same
// document as admin and this code keeps working unchanged.)
import { setPlan } from './plan.js';

const VOUCHERS = 'vouchers';
const BILLING = 'billing';

/** Codes are typed by hand: case and dashes do not matter. */
export const normalizeCode = (code) => String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Codes are read out loud and typed by hand: no 0/O, 1/I or 5/S to confuse.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY2346789';
const CODE_BODY = 9;
const CODE_PREFIX = 'LVX';

/** A fresh, hard-to-guess code — LVX + 9 characters out of an unambiguous alphabet. */
export function makeCode(random = crypto.getRandomValues.bind(crypto)) {
  const bytes = random(new Uint8Array(CODE_BODY));
  let code = CODE_PREFIX;
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

// How long a code buys. A code is made the moment the payment lands and sent straight away, so the
// paid period runs from the day it was made — with a few days over, so nobody is cut short.
const PERIOD_DAYS = { monthly: 31 + 3, yearly: 365 + 5 };

/** The day a code of this period runs out, as an ISO stamp (null: a code that never expires). */
export function untilFor(period, from = new Date()) {
  const days = PERIOD_DAYS[period];
  if (!days) return null;
  const end = new Date(from.getTime());
  end.setDate(end.getDate() + days);
  return end.toISOString();
}

/** Writes `count` unused codes (owners only — the rules check who is asking). Returns the codes. */
export async function makeVouchers({ db, firestore, count = 10, period = 'yearly' }) {
  const codes = [];
  const until = untilFor(period);
  for (let i = 0; i < Math.max(1, Math.min(50, count)); i += 1) {
    const code = makeCode();
    await firestore.setDoc(firestore.doc(db, VOUCHERS, code), { redeemedBy: null, period, until, createdAt: new Date().toISOString() });
    codes.push(code);
  }
  return codes;
}

/** The most recent codes with their state, newest first (owners only). */
export async function listVouchers({ db, firestore, max = 30 }) {
  const snapshot = await firestore.getDocs(
    firestore.query(firestore.collection(db, VOUCHERS), firestore.orderBy('createdAt', 'desc'), firestore.limit(max)),
  );
  const rows = [];
  snapshot.forEach((item) => {
    const data = item.data() ?? {};
    rows.push({ code: item.id, period: data.period ?? '', redeemedBy: data.redeemedBy ?? null, createdAt: data.createdAt ?? '', until: data.until ?? null });
  });
  return rows;
}

export class VoucherError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason; // 'invalid' | 'unknown' | 'used' | 'failed'
  }
}

/**
 * @param {{ db, uid, firestore: { doc, getDoc, setDoc, onSnapshot }, onPlan?: (plan: string) => void }} options
 * @returns {{ redeem(code: string): Promise<object>, dispose(): void }}
 */
export function createBilling({ db, uid, firestore, onPlan }) {
  const ref = firestore.doc(db, BILLING, uid);
  let last = null;
  let billed = null; // the document as it was last read, so the plan can be weighed again later
  const apply = (next) => {
    const plan = next === 'pro' ? 'pro' : 'free';
    setPlan(plan);
    if (plan === last) return; // say it once per change, so the menu is not rebuilt for nothing
    last = plan;
    onPlan?.(plan);
  };
  /** Pro while the paid period lasts: a document with no end never runs out. */
  const planOf = (data) => {
    if (data?.plan !== 'pro') return 'free';
    const ends = typeof data.currentPeriodEnd === 'string' ? Date.parse(data.currentPeriodEnd) : NaN;
    return Number.isFinite(ends) && ends <= Date.now() ? 'free' : 'pro';
  };
  const read = (data) => {
    billed = data ?? null;
    apply(planOf(billed));
  };
  apply('free');
  const unsubscribe = firestore.onSnapshot(
    ref,
    (snapshot) => read(snapshot.exists() ? snapshot.data() : null),
    () => read(null), // unreadable (offline, rules) — stay on the safe side
  );
  // A tab can be left open for weeks: weigh the paid period again whenever it is looked at.
  const recheck = () => !document.hidden && apply(planOf(billed));
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', recheck);

  return {
    async redeem(rawCode) {
      const code = normalizeCode(rawCode);
      if (code.length < 6) throw new VoucherError('invalid');
      const voucherRef = firestore.doc(db, VOUCHERS, code);
      let voucher;
      try {
        voucher = await firestore.getDoc(voucherRef);
      } catch {
        throw new VoucherError('failed');
      }
      if (!voucher.exists()) throw new VoucherError('unknown');
      const data = voucher.data() ?? {};
      if (data.redeemedBy && data.redeemedBy !== uid) throw new VoucherError('used');

      const now = new Date().toISOString();
      const paid = {
        plan: 'pro',
        voucher: code,
        period: typeof data.period === 'string' ? data.period : 'voucher',
        currentPeriodEnd: typeof data.until === 'string' ? data.until : null,
        updatedAt: now,
      };
      if (planOf(paid) !== 'pro') throw new VoucherError('expired'); // made too long ago to be worth anything
      try {
        if (!data.redeemedBy) await firestore.setDoc(voucherRef, { redeemedBy: uid, redeemedAt: now }, { merge: true });
        await firestore.setDoc(ref, paid);
      } catch {
        throw new VoucherError('used'); // the rules refused: someone else claimed it first
      }
      read(paid);
      return { code, period: data.period ?? 'voucher', until: paid.currentPeriodEnd };
    },
    dispose() {
      unsubscribe?.();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', recheck);
      apply('free');
    },
  };
}
