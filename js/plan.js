// Which plan this account is on, and the one rule that follows from it: Free holds 100 tasks, finished
// ones included.
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

/**
 * Tasks that count against the free limit: open and finished alike — finished work is the history the
 * statistics are made of, so on Free it is kept by making room for it. Deleted tasks and the records
 * left on a day when a task is pulled on do not count.
 */
export function taskCount(store) {
  return store.get().tasks.filter((task) => !task.deleted && task.carriedTo === null).length;
}

// Where the "Done" history opens from a limit message (app.js sets it): it is where room is made.
let openHistory = null;
export function setHistoryOpener(open) {
  openHistory = open;
}

function sayLimit({ ui, i18n, onSeePlans }, message) {
  const actions = [];
  if (openHistory) actions.push({ label: i18n.t('history.open'), onClick: openHistory });
  if (onSeePlans) actions.push({ label: i18n.t('plan.seePlans'), onClick: onSeePlans });
  ui.toast(message, { duration: 12000, actions });
}

/**
 * True when a new task may be added. On Free, at the limit it says so (with a way to the history and to
 * the plans) and returns false — deleting tasks, finished or not, frees room again.
 */
export function canAddTask({ store, ui, i18n, onSeePlans }) {
  if (isPro() || taskCount(store) < LIMIT) return true;
  sayLimit({ ui, i18n, onSeePlans }, i18n.t('plan.limitReached', { n: LIMIT }));
  return false;
}

/**
 * Free above the limit (Pro ran out): what was made while Pro stays, but it is not reshaped into new
 * work. Finishing and deleting always work; renaming, re-filing, moving to another day and reopening
 * wait until the account is back within the limit. Wires the store's edit guard and says why when an
 * action is refused.
 */
export function guardFreeLimit({ store, ui, i18n, onSeePlans }) {
  store.setEditGuard(() => isPro() || taskCount(store) <= LIMIT);
  store.onEditBlocked(() => {
    const count = taskCount(store);
    sayLimit({ ui, i18n, onSeePlans }, i18n.t('plan.overLimit', { n: LIMIT, count, over: count - LIMIT }));
  });
}
