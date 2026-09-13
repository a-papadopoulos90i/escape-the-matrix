// Shared DOM toolkit: element builder, inline SVG icons, speech bubbles, toasts, modals,
// popovers, menus, confirm dialog and the common stage header / footer.
import { t } from './i18n.js';

const PROPERTY_ATTRS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'indeterminate', 'inert', 'textContent']);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const GAP = 12;
const EDGE = 8;
const TAIL_INSET = 36; // px from the bubble's left edge to its tail centre (top/bottom tails)
const TAIL_INSET_Y = 26; // px from the bubble's top edge to its tail centre (left/right tails)
const TOAST_LIMIT = 3;
const TOAST_DURATION = 5000;

// ---------- Element builder ----------

/** h('button', { class: 'btn', onClick }, 'Save') — attrs: class/className, style (object or string),
 *  dataset, html (innerHTML), on<Event> handlers, boolean props; null/false attrs are skipped. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [key, value] of Object.entries(attrs)) applyAttr(el, key, value);
  appendChildren(el, children);
  return el;
}

function applyAttr(el, key, value) {
  if (value == null || value === false) return;
  if (key === 'class' || key === 'className') el.className = value;
  else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
  else if (key === 'dataset') Object.assign(el.dataset, value);
  else if (key === 'html') el.innerHTML = value;
  else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
  else if (PROPERTY_ATTRS.has(key)) el[key] = value;
  else el.setAttribute(key, value === true ? '' : value);
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || typeof child === 'boolean') continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

function fromMarkup(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

// ---------- Icons ----------

const STROKE_ICONS = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 6v12M16 6v12" stroke-width="2.4"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  forward: '<path d="M4 6v12l8-6zM12 6v12l8-6z" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.4 2.4 0 114.1 1.7c-.9.8-1.7 1.3-1.7 2.6M12 17h.01"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h9.5a5.5 5.5 0 010 11H10"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  pencil: '<path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.2 3.6-7 8-7s8 2.8 8 7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>',
};

const BRAND_ICONS = {
  apple:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.87 2.35-4.25 2.46-4.32-1.34-1.96-3.43-2.23-4.17-2.26-1.78-.18-3.47 1.05-4.37 1.05-.9 0-2.29-1.03-3.77-1-1.94.03-3.73 1.13-4.73 2.87-2.02 3.5-.52 8.68 1.44 11.53.96 1.4 2.1 2.96 3.6 2.9 1.44-.06 1.99-.93 3.73-.93 1.74 0 2.23.93 3.76.9 1.55-.03 2.53-1.42 3.48-2.82 1.1-1.61 1.55-3.17 1.57-3.25-.03-.02-3.01-1.16-3.04-4.58zM14.6 4.6c.8-.97 1.33-2.32 1.18-3.66-1.15.05-2.53.77-3.35 1.73-.74.86-1.38 2.23-1.21 3.55 1.28.1 2.59-.65 3.38-1.62z"/></svg>',
  google:
    '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
};

/** Inline SVG icon. Decorative by default; pass `label` to expose it to assistive tech. */
export function icon(name, { size = 20, label } = {}) {
  const markup =
    BRAND_ICONS[name] ??
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${STROKE_ICONS[name] ?? ''}</svg>`;
  const svg = fromMarkup(markup);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', `icon icon--${name}`);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}

// ---------- Overlay bookkeeping (Escape closes the topmost only) ----------

const overlayStack = [];
let escapeBound = false;

function pushOverlay(close) {
  overlayStack.push(close);
  if (!escapeBound) {
    escapeBound = true;
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !overlayStack.length) return;
      event.preventDefault();
      overlayStack[overlayStack.length - 1]();
    });
  }
  return () => {
    const index = overlayStack.indexOf(close);
    if (index >= 0) overlayStack.splice(index, 1);
  };
}

/** True while a modal, popover or menu is open (app.js pauses shortcuts then). */
export function hasOpenOverlay() {
  return overlayStack.length > 0;
}

function focusFirst(container) {
  const target = container.querySelector('[autofocus]') ?? container.querySelector(FOCUSABLE) ?? container;
  target.focus({ preventScroll: true });
}

function restoreFocus(el) {
  if (el && typeof el.focus === 'function' && el.isConnected) el.focus({ preventScroll: true });
}

// ---------- Positioning ----------

function rectIn(el, within) {
  const rect = el.getBoundingClientRect();
  const base = within === document.body ? { left: -window.scrollX, top: -window.scrollY } : within.getBoundingClientRect();
  return {
    left: rect.left - base.left,
    top: rect.top - base.top,
    width: rect.width,
    height: rect.height,
    viewportTop: rect.top,
    viewportBottom: rect.bottom,
  };
}

/**
 * Places `el` (absolutely positioned inside `within`) next to `anchor` so a tail on side `tail`
 * points at it. Flips vertically when there is no room. Returns the tail side actually used.
 */
function placeNear(el, anchor, within, tail, align) {
  const a = rectIn(anchor, within);
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const maxLeft = (within === document.body ? document.documentElement.clientWidth : within.clientWidth) - width - EDGE;
  const centreX = a.left + a.width / 2;
  const centreY = a.top + a.height / 2;

  let side = tail;
  if (side === 'bottom' && a.top - height - GAP < 0 && within !== document.body) side = 'top';
  if (side === 'top' && a.viewportBottom + height + GAP > window.innerHeight && a.viewportTop - height - GAP > 0) side = 'bottom';
  if (side === 'right' && a.left - width - GAP < EDGE) side = 'left';
  if (side === 'left' && a.left + a.width + GAP > maxLeft) side = 'right';

  let left;
  let top;
  if (side === 'top' || side === 'bottom') {
    left = align === 'center' ? centreX - width / 2 : centreX - TAIL_INSET;
    left = Math.max(EDGE, Math.min(left, maxLeft));
    top = side === 'bottom' ? a.top - height - GAP : a.top + a.height + GAP;
    el.style.setProperty('--tail-x', `${Math.max(16, Math.min(centreX - left, width - 16))}px`);
  } else {
    left = side === 'right' ? a.left - width - GAP : a.left + a.width + GAP;
    left = Math.max(EDGE, Math.min(left, maxLeft));
    top = align === 'center' ? centreY - height / 2 : centreY - TAIL_INSET_Y;
    top = Math.max(EDGE, top);
    el.style.setProperty('--tail-y', `${Math.max(16, Math.min(centreY - top, height - 16))}px`);
  }
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  return side;
}

function swapClass(el, prefix, value, sides) {
  for (const side of sides) el.classList.toggle(`${prefix}${side}`, side === value);
}

const SIDES = ['top', 'bottom', 'left', 'right'];

// ---------- Speech bubble ----------

/**
 * Dismissible tip bubble. Content: `text`, `html`, or `content` (Node). With `anchor` the bubble is
 * absolutely positioned inside `within` (default document.body) with its tail pointing at the
 * anchor; without one the caller places the returned element. Escape closes it (unless a modal,
 * popover or menu is open — they own Escape), and closing it from inside (its ✕, or after being
 * focused) hands focus back to where it was. Returns { el, close }.
 */
export function bubble({ text, html, content, tone = 'khaki', tail = 'bottom', anchor, within = document.body, onClose, align = 'start' } = {}) {
  const previousFocus = document.activeElement;
  const body = h('div', { class: 'bubble__body' });
  if (content) body.append(content);
  else if (html) body.innerHTML = html;
  else body.textContent = text ?? '';

  const el = h(
    'div',
    { class: `bubble bubble--${tone} bubble--tail-${tail}`, role: 'note', tabindex: -1 },
    body,
    h('button', { class: 'btn-icon bubble__close', type: 'button', 'aria-label': t('common.close'), onClick: () => close() }, icon('close', { size: 16 })),
    h('span', { class: 'bubble__tail', 'aria-hidden': 'true' }),
  );

  let closed = false;
  let observer = null;
  const reposition = () => {
    if (!anchor) return;
    if (!anchor.isConnected) return close();
    swapClass(el, 'bubble--tail-', placeNear(el, anchor, within, tail, align), SIDES);
  };
  const onKeydown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || overlayStack.length) return;
    event.preventDefault();
    close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    observer?.disconnect();
    window.removeEventListener('resize', reposition);
    document.removeEventListener('keydown', onKeydown);
    const hadFocus = el.contains(document.activeElement);
    el.remove();
    if (hadFocus) restoreFocus(previousFocus);
    onClose?.();
  };
  document.addEventListener('keydown', onKeydown);

  if (anchor) {
    el.classList.add('bubble--positioned');
    within.append(el);
    reposition();
    window.addEventListener('resize', reposition);
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(reposition); // follow the anchor as rows are added / the panel reflows
      observer.observe(anchor);
      observer.observe(within);
    }
  }
  return { el, close, reposition };
}

// ---------- Toast ----------

/** Bottom-centre toast with optional action ({ label, onClick }). duration 0 = sticky. */
export function toast(message, { action, duration = TOAST_DURATION } = {}) {
  const root = document.getElementById('toast-root');
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', { class: 'toast__text' }, message),
    action &&
      h('button', { class: 'toast__action', type: 'button', onClick: () => { dismiss(); action.onClick?.(); } }, action.label),
    h('button', { class: 'btn-icon toast__close', type: 'button', 'aria-label': t('common.close'), onClick: () => dismiss() }, icon('close', { size: 16 })),
  );
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };
  root.append(el);
  while (root.children.length > TOAST_LIMIT) root.firstElementChild.remove();
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return { el, dismiss };
}

// ---------- Modal ----------

/**
 * Accessible dialog. actions: [{ label, onClick(api), primary, danger, autofocus }] — the modal
 * closes after onClick unless it returns false. Escape / backdrop click close it too.
 */
export function modal({ title, content, actions, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const previousFocus = document.activeElement;
  const titleId = `modal-title-${Date.now().toString(36)}`;
  const list = actions ?? [{ label: t('common.ok'), primary: true }];

  const body = h('div', { class: 'modal__body' });
  if (content instanceof Node) body.append(content);
  else if (typeof content === 'string') body.append(h('p', null, content));

  const api = { close: () => close() };
  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title ? titleId : null },
    title && h('h2', { class: 'modal__title', id: titleId }, title),
    body,
    list.length &&
      h(
        'div',
        { class: 'modal__actions' },
        list.map((action) =>
          h(
            'button',
            {
              class: `btn ${action.primary ? 'btn-primary' : ''} ${action.danger ? 'btn-danger' : ''}`.trim(),
              type: 'button',
              autofocus: action.autofocus || action.primary || null,
              onClick: () => {
                if (action.onClick?.(api) !== false) close();
              },
            },
            action.label,
          ),
        ),
      ),
  );
  const backdrop = h('div', { class: 'modal-backdrop', onPointerdown: (event) => event.target === backdrop && close() }, dialog);

  const onKeydown = (event) => trapTab(event, dialog);
  let closed = false;
  const popOverlay = pushOverlay(() => close());
  const close = () => {
    if (closed) return;
    closed = true;
    popOverlay();
    dialog.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    if (!root.children.length) document.body.classList.remove('has-modal');
    restoreFocus(previousFocus);
    onClose?.();
  };

  dialog.addEventListener('keydown', onKeydown);
  root.append(backdrop);
  document.body.classList.add('has-modal');
  focusFirst(dialog);
  return { el: dialog, close };
}

function trapTab(event, dialog) {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll(FOCUSABLE)];
  if (!focusable.length) return event.preventDefault();
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Promise<boolean> confirm dialog. */
export function confirm(message, { title, okLabel = t('common.confirm'), cancelLabel = t('common.cancel'), danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    modal({
      title,
      content: message,
      actions: [
        { label: cancelLabel },
        { label: okLabel, primary: !danger, danger, autofocus: true, onClick: () => { answer = true; } },
      ],
      onClose: () => resolve(answer),
    });
  });
}

// ---------- Popover & menu ----------

/**
 * White card with a tail, positioned under `anchor` (over it when there is no room). Closes on
 * Escape, outside click, or close(); clicks inside a nested popover (a menu opened from it) or a
 * modal do not count as outside. `label` names the dialog. Returns { el, close, reposition }.
 */
export function popover({ anchor, content, onClose, tail = 'top', className = '', role, label } = {}) {
  const root = document.getElementById('popover-root');
  const previousFocus = document.activeElement;
  const el = h(
    'div',
    { class: `popover popover--tail-${tail} ${className}`.trim(), role: role ?? 'dialog', 'aria-label': label },
    h('span', { class: 'popover__tail', 'aria-hidden': 'true' }),
  );
  if (content instanceof Node) el.append(content);
  else if (typeof content === 'string') el.append(h('p', null, content));

  const reposition = () => {
    if (!anchor.isConnected) return close();
    swapClass(el, 'popover--tail-', placeNear(el, anchor, document.body, tail, 'center'), SIDES);
  };
  const onOutside = (event) => {
    const layers = [root, anchor, document.getElementById('modal-root')];
    if (!layers.some((layer) => layer.contains(event.target))) close();
  };
  const onKeydown = (event) => trapTab(event, el); // Tab cycles inside while the popover is open

  let closed = false;
  const popOverlay = pushOverlay(() => close());
  const close = () => {
    if (closed) return;
    closed = true;
    popOverlay();
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', reposition);
    el.removeEventListener('keydown', onKeydown);
    el.remove();
    restoreFocus(previousFocus);
    onClose?.();
  };

  el.addEventListener('keydown', onKeydown);
  root.append(el);
  reposition();
  window.addEventListener('resize', reposition);
  setTimeout(() => !closed && document.addEventListener('pointerdown', onOutside, true), 0);
  focusFirst(el);
  return { el, close, reposition };
}

/**
 * Popover menu. items: [{ label, onSelect, icon?, danger?, disabled? }] or '-' for a separator.
 * Arrow keys move between items; Enter/Space select.
 */
export function menu({ anchor, items, onClose } = {}) {
  const list = h('div', { class: 'menu', role: 'menu' });
  let api = null;
  for (const item of items) {
    if (item === '-') {
      list.append(h('div', { class: 'menu__separator', role: 'separator' }));
      continue;
    }
    list.append(
      h(
        'button',
        {
          class: `menu__item ${item.danger ? 'menu__item--danger' : ''}`.trim(),
          type: 'button',
          role: 'menuitem',
          disabled: item.disabled || null,
          onClick: () => {
            api.close();
            item.onSelect?.();
          },
        },
        item.icon && icon(item.icon, { size: 16 }),
        item.label,
      ),
    );
  }
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...list.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const index = buttons.indexOf(document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  });
  api = popover({ anchor, content: list, onClose, className: 'popover--menu', role: 'presentation' });
  return api;
}

// ---------- Stage chrome ----------

/** "Stage N" kicker + large title (focusable: the shell moves focus there on a stage change). */
export function stageHeader({ stage, title, subtitle }) {
  return h(
    'header',
    { class: 'stage-header' },
    h('p', { class: 'stage-kicker' }, t('stage.heading', { n: stage })),
    h('h1', { class: 'stage-title', id: `stage-title-${stage}`, tabindex: -1 }, title),
    subtitle && h('p', { class: 'stage-subtitle' }, subtitle),
  );
}

/** Bottom navigation: omit onBack / onNext to hide that button. Query .stage-nav__next to update it. */
export function stageNav({ onBack, onNext, backLabel = t('nav.back'), nextLabel = t('nav.next'), nextDisabled = false, day = null } = {}) {
  return h(
    'nav',
    { class: 'stage-nav', 'aria-label': t('nav.label') },
    h('span', { class: 'stage-nav__side stage-nav__side--start' }, onBack ? h('button', { class: 'btn stage-nav__back', type: 'button', onClick: onBack }, backLabel) : null),
    day ? daySwitcher(day) : h('span'),
    h('span', { class: 'stage-nav__side stage-nav__side--end' }, onNext ? h('button', { class: 'btn btn-primary stage-nav__next', type: 'button', disabled: nextDisabled, onClick: onNext }, nextLabel) : null),
  );
}

/** Centred current-day display with discreet ‹ › arrows to step the day, shown on every stage. */
function daySwitcher({ label, onPrev, onNext }) {
  return h(
    'div',
    { class: 'stage-nav__day' },
    h('button', { class: 'btn-icon stage-nav__day-arrow', type: 'button', 'aria-label': t('day.prev'), onClick: onPrev }, icon('chevron-left', { size: 18 })),
    h('span', { class: 'stage-nav__day-label' }, label),
    h('button', { class: 'btn-icon stage-nav__day-arrow', type: 'button', 'aria-label': t('day.next'), onClick: onNext }, icon('chevron-right', { size: 18 })),
  );
}
