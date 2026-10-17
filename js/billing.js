// Levelix Pro for one signed-in account: watches billing/{uid} and redeems the codes the Stripe webhook
// emails to buyers who paid without signing in (functions/webhook.js makes them).
//
// The app cannot make itself Pro: firestore.rules only accept a billing document that names a voucher
// this account has claimed, with the end date written on it. A code works once.
import { setPlan } from './plan.js';

const VOUCHERS = 'vouchers';
const BILLING = 'billing';

/** Codes are typed by hand: case and dashes do not matter. */
export const normalizeCode = (code) => String(code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

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
