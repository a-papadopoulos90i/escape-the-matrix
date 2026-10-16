// The owner's own screen for handing out Levelix Pro: it makes codes and shows what happened to them.
// Hidden unless this browser opened the site once with ?vouchers=on — and Firestore only lets an
// account listed in config/owners write them, so the switch alone grants nothing.
import * as dates from './dates.js';
import { untilFor } from './billing.js';

const FLAG = 'levelix:vouchers';

/** "11 March 2026" for an ISO stamp — what a code's last day reads like. */
const day = (iso) => (typeof iso === 'string' && !Number.isNaN(Date.parse(iso)) ? dates.formatLong(dates.todayKey(new Date(iso))).split(', ')[1] : '');

/** ?vouchers=on / ?vouchers=off switches the screen on for this browser, then drops the parameter. */
export function captureVoucherFlag() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('vouchers');
  if (value !== 'on' && value !== 'off') return null;
  try {
    localStorage.setItem(FLAG, value);
  } catch {
    /* storage blocked — the switch simply does not stick */
  }
  params.delete('vouchers');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  return value;
}

export function vouchersEnabled() {
  try {
    return localStorage.getItem(FLAG) === 'on';
  } catch {
    return false;
  }
}

/** Make codes, copy them, and see which ones have been used. */
export function openVoucherModal({ ui, i18n, session }) {
  const { t } = i18n;
  const { h } = ui;
  const list = h('div', { class: 'vouchers__list' });
  const fresh = h('div', { class: 'vouchers__fresh', hidden: true });
  const period = h(
    'select',
    { class: 'vouchers__period', 'aria-label': t('vouchers.period') },
    h('option', { value: 'yearly' }, t('vouchers.yearly')),
    h('option', { value: 'monthly' }, t('vouchers.monthly')),
  );
  const count = h(
    'select',
    { class: 'vouchers__count', 'aria-label': t('vouchers.howMany') },
    ...[1, 5, 10, 25].map((n) => h('option', { value: String(n) }, String(n))),
  );
  count.value = '1'; // one code per sale is the usual case

  const row = (voucher) =>
    h(
      'div',
      { class: `vouchers__row ${voucher.redeemedBy ? 'is-used' : ''}`.trim() },
      h('code', { class: 'vouchers__code' }, voucher.code),
      h('span', { class: 'vouchers__period-tag' }, voucher.period),
      h('span', { class: 'vouchers__state' }, t(voucher.redeemedBy ? 'vouchers.used' : 'vouchers.free')),
      voucher.until ? h('span', { class: 'vouchers__until' }, t('vouchers.until', { date: day(voucher.until) })) : null,
    );

  /** Copies `text`, or selects the box next to the button when the clipboard is barred. */
  async function copy(event, text, said) {
    try {
      await navigator.clipboard.writeText(text);
      ui.toast(t(said));
    } catch {
      event.currentTarget.parentElement?.querySelector('textarea')?.select();
    }
  }

  async function refresh() {
    list.replaceChildren(h('p', { class: 'text-muted' }, t('vouchers.loading')));
    try {
      const rows = await (await session()).listVouchers();
      list.replaceChildren(...(rows.length ? rows.map(row) : [h('p', { class: 'text-muted' }, t('vouchers.none'))]));
    } catch {
      list.replaceChildren(h('p', { class: 'text-muted' }, t('vouchers.listFailed')));
    }
  }

  async function make(button) {
    button.disabled = true;
    try {
      const codes = await (await session()).makeVouchers({ count: Number(count.value), period: period.value });
      const until = untilFor(period.value);
      // One code is one sale: the whole message to send is ready to copy, code and last day included.
      const message = codes.length === 1 ? t('vouchers.message', { code: codes[0], date: day(until) }) : null;
      fresh.hidden = false;
      fresh.replaceChildren(
        h('p', { class: 'vouchers__fresh-title' }, t(message ? 'vouchers.freshOne' : 'vouchers.freshTitle', { n: codes.length })),
        h('textarea', { class: 'vouchers__fresh-codes', readonly: '', rows: String(message ? 6 : Math.min(codes.length, 8)) }, message ?? codes.join('\n')),
        h(
          'button',
          { class: 'btn btn-sm', type: 'button', onClick: (event) => copy(event, message ?? codes.join('\n'), message ? 'vouchers.messageCopied' : 'vouchers.copied') },
          t(message ? 'vouchers.copyMessage' : 'vouchers.copy'),
        ),
        message ? h('button', { class: 'btn btn-sm', type: 'button', onClick: (event) => copy(event, codes[0], 'vouchers.copied') }, t('vouchers.copyCode')) : null,
      );
      await refresh();
    } catch {
      ui.toast(t('vouchers.makeFailed'), { duration: 9000 });
    } finally {
      button.disabled = false;
    }
  }

  const content = h(
    'div',
    { class: 'vouchers' },
    h('p', { class: 'text-muted' }, t('vouchers.hint')),
    h(
      'div',
      { class: 'vouchers__make' },
      count,
      period,
      h('button', { class: 'btn btn-primary', type: 'button', onClick: (event) => make(event.currentTarget) }, t('vouchers.make')),
    ),
    fresh,
    list,
  );
  refresh();
  return ui.modal({ title: t('vouchers.title'), content, actions: [{ label: t('common.close'), primary: true }] });
}
