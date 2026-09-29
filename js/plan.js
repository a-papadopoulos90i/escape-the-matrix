// Which plan this account is on, and the one rule that follows from it: Free stops at 100 open tasks.
// The plan itself comes from Firestore (js/billing.js) and is never decided here.
const LIMIT = 100;

let current = 'free';
const listeners = new Set();

export const FREE_TASK_LIMIT = LIMIT;

export const plan = () => current;
export const isPro = () => current === 'pro';

export function setPlan(next) {
  const value = next === 'pro' ? 'pro' : 'free';
  if (value === current) return;
  current = value;
  for (const listener of listeners) listener(current);
}

export function onPlanChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Open tasks that count against the free limit: finished work and carried-forward records are free. */
export function openTaskCount(store) {
  return store.get().tasks.filter((task) => !task.deleted && task.carriedTo === null && !task.done).length;
}

/**
 * True when a new task may be added. On Free, at the limit it says so (with a way to the plans) and
 * returns false — deleting or finishing tasks frees room again.
 */
export function canAddTask({ store, ui, i18n, onSeePlans }) {
  if (isPro() || openTaskCount(store) < LIMIT) return true;
  ui.toast(i18n.t('plan.limitReached', { n: LIMIT }), {
    duration: 12000,
    action: onSeePlans ? { label: i18n.t('plan.seePlans'), onClick: onSeePlans } : undefined,
  });
  return false;
}
