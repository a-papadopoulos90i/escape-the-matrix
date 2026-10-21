// Pro features on a Free account: the real thing stays in view, blurred and out of reach, under a small
// card — "Go Pro for unlimited access" — that leads to the plans on Home. Used by the task timer, moving a
// task to another day, the statistics in Done, the Time report and the calendar's All Tasks view.
import { isPro, onPlanChange } from './plan.js';
import { h, icon } from './ui.js';
import { t } from './i18n.js';

let showPlans = () => {};

/** app.js hands in how to reach the plans (Home, scrolled to Pricing). */
export function setPlansOpener(open) {
  showPlans = open;
}

export { isPro, onPlanChange };

/**
 * Wraps `content` (an element or a list of them) so it shows blurred and inert under the Go Pro card.
 * `onGoPro` runs first (to close the popover or dialog it sits in). `onUnlock` runs once if the account
 * turns Pro while the lock is on screen — the plan arrives a moment after the page loads.
 * `size`: 'card' (default), 'compact' (a single line, for short content) or 'tall' (the card stays in view
 * while long content scrolls under it).
 */
export function proLock({ content, size = 'card', onGoPro, onUnlock }) {
  const inner = h('div', { class: 'pro-lock__content', 'aria-hidden': 'true' }, ...[content].flat());
  inner.inert = true;
  const el = h('div', { class: `pro-lock pro-lock--${size}` }, inner, proVeil({ size, onGoPro }));
  if (onUnlock) {
    const stop = onPlanChange((plan) => {
      if (plan !== 'pro' && el.isConnected) return;
      stop();
      if (el.isConnected) onUnlock();
    });
  }
  return el;
}

/** Just the card layer, for content that locks in place (the calendar): put it inside a `.pro-lock`
 *  next to the content, which takes the `pro-lock__content` class and `inert`. */
export function proVeil({ size = 'card', onGoPro } = {}) {
  const go = h(
    'button',
    {
      class: `btn btn-primary pro-lock__go${size === 'compact' ? ' btn-sm' : ''}`,
      type: 'button',
      onClick: () => {
        onGoPro?.();
        showPlans();
      },
    },
    t('plan.goPro'),
  );
  const card = h(
    'div',
    { class: 'pro-lock__card' },
    h('span', { class: 'pro-lock__icon', 'aria-hidden': 'true' }, icon('lock', { size: size === 'compact' ? 16 : 20 })),
    h('p', { class: 'pro-lock__text' }, t('pro.locked')),
    go,
  );
  return h('div', { class: 'pro-lock__veil' }, card);
}

/** The Go Pro button of a lock inside `root`, to put keyboard focus on. */
export const lockButton = (root) => root?.querySelector('.pro-lock__go') ?? null;
