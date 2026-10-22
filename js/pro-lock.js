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
export function proVeil({ size = 'card', onGoPro, onDismiss } = {}) {
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
    onDismiss ? h('button', { class: 'link-button pro-lock__later', type: 'button', onClick: onDismiss }, t('pro.notNow')) : null,
  );
  return h('div', { class: 'pro-lock__veil' }, card);
}

const CONTROL = 'button, a, input, select, textarea, label';

/**
 * A Pro picker on a Free account (the task timer, moving a task to another day): its options show as they
 * are, under a small "Pro" lock badge, so they can be seen. Pressing any of them brings up the Go Pro card
 * instead of doing it; "Not now" puts the options back. `onUnlock` as for proLock.
 */
export function proGate({ content, onGoPro, onUnlock }) {
  const inner = h('div', { class: 'pro-lock__content' }, ...[content].flat());
  const badge = h('p', { class: 'pro-lock__badge' }, icon('lock', { size: 13 }), t('pro.badge'));
  const veil = proVeil({ onGoPro, onDismiss: () => show(false) });
  const el = h('div', { class: 'pro-lock pro-lock--gate' }, badge, inner, veil);
  function show(open) {
    el.classList.toggle('is-open', open);
    veil.hidden = !open;
    inner.inert = open;
    inner.setAttribute('aria-hidden', String(open));
    (open ? lockButton(el) : inner.querySelector(CONTROL))?.focus();
  }
  const ask = (event) => {
    event.preventDefault();
    event.stopPropagation();
    show(true);
  };
  show(false);
  inner.addEventListener('click', (event) => event.target.closest(CONTROL) && ask(event), true);
  inner.addEventListener('submit', ask, true);
  // A field is not focused or opened (the date field's own calendar): the click above asks instead.
  for (const type of ['pointerdown', 'mousedown']) {
    inner.addEventListener(type, (event) => event.target.closest('input, select, textarea') && event.preventDefault(), true);
  }
  if (onUnlock) {
    const stop = onPlanChange((plan) => {
      if (plan !== 'pro' && el.isConnected) return;
      stop();
      if (el.isConnected) onUnlock();
    });
  }
  return el;
}

/** The Go Pro button of a lock inside `root`, to put keyboard focus on. */
export const lockButton = (root) => root?.querySelector('.pro-lock__go') ?? null;
