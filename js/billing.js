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
  const apply = (next) => {
    const plan = next === 'pro' ? 'pro' : 'free';
    setPlan(plan);
    if (plan === last) return; // say it once per change, so the menu is not rebuilt for nothing
    last = plan;
    onPlan?.(plan);
  };
  apply('free');
  const unsubscribe = firestore.onSnapshot(
    ref,
    (snapshot) => apply(snapshot.exists() ? (snapshot.data()?.plan ?? 'free') : 'free'),
    () => apply('free'), // unreadable (offline, rules) — stay on the safe side
  );

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
      try {
        if (!data.redeemedBy) await firestore.setDoc(voucherRef, { redeemedBy: uid, redeemedAt: now }, { merge: true });
        await firestore.setDoc(ref, {
          plan: 'pro',
          voucher: code,
          period: typeof data.period === 'string' ? data.period : 'voucher',
          currentPeriodEnd: typeof data.until === 'string' ? data.until : null,
          updatedAt: now,
        });
      } catch {
        throw new VoucherError('used'); // the rules refused: someone else claimed it first
      }
      apply('pro');
      return { code, period: data.period ?? 'voucher' };
    },
    dispose() {
      unsubscribe?.();
      apply('free');
    },
  };
}
