// Stage 1 — month calendar (SPEC §2). Six rows of weekday cells: a gray tray for empty days, a
// green striped fill rising with the done ratio, a blue border for today and a soft ring on the
// selected day. Clicking a day selects it and opens Stage 2 (no tasks) or Stage 4 (has tasks).

let ctx = null;
let root = null;
let els = {};
let cols = 5;
let unsubscribe = null;

export function mount(container, context) {
  ctx = context;
  const { ui, store } = ctx;

  els.grid = ui.h('div', { class: 'calendar__grid', role: 'group', onKeydown: onGridKeydown });
  els.month = ui.h('p', { class: 'calendar__month', 'aria-live': 'polite' });
  els.toggle = ui.h('input', {
    class: 'switch__input',
    type: 'checkbox',
    role: 'switch',
    onChange: (event) => store.setSetting('showWeekends', event.target.checked),
  });

  root = ui.h(
    'div',
    { class: 'stage-body calendar' },
    ui.stageHeader({ stage: 1, title: '' }),
    toolbar(),
    els.grid,
    legend(),
    ui.stageNav({ onNext: () => ctx.goTo(2) }),
  );
  els.title = root.querySelector('.stage-title');

  render();
  unsubscribe = store.subscribe(render);
  container.append(root);
}

export function unmount() {
  unsubscribe?.();
  unsubscribe = null;
  root = null;
  els = {};
  ctx = null;
}

// ---------- Static chrome ----------

function toolbar() {
  const { ui, i18n: { t } } = ctx;
  return ui.h(
    'div',
    { class: 'calendar__toolbar' },
    ui.h(
      'div',
      { class: 'calendar__nav' },
      ui.h('button', { class: 'btn-icon', type: 'button', 'aria-label': t('calendar.prevMonth'), onClick: () => shiftMonth(-1) }, ui.icon('chevron-left')),
      els.month,
      ui.h('button', { class: 'btn-icon', type: 'button', 'aria-label': t('calendar.nextMonth'), onClick: () => shiftMonth(1) }, ui.icon('chevron-right')),
    ),
    ui.h(
      'div',
      { class: 'calendar__tools' },
      ui.h('button', { class: 'btn btn-sm calendar__today', type: 'button', onClick: goToToday }, t('calendar.today')),
      ui.h(
        'label',
        { class: 'switch' },
        els.toggle,
        ui.h('span', { class: 'switch__track', 'aria-hidden': 'true' }),
        ui.h('span', null, t('calendar.showWeekends')),
      ),
    ),
  );
}

/** Legend under the grid (the stage tip has no anchor here: app.js places it under the header). */
function legend() {
  const { ui, i18n: { t } } = ctx;
  const item = (kind) =>
    ui.h(
      'li',
      { class: 'calendar__legend-item' },
      ui.h('span', { class: `calendar__swatch calendar__swatch--${kind}`, 'aria-hidden': 'true' }),
      t(`calendar.legend.${kind}`),
    );
  return ui.h('ul', { class: 'calendar__legend' }, item('done'), item('today'), item('empty'));
}

// ---------- Rendering ----------

/** Rebuilds the title, month label and every day cell for the displayed month. */
function render() {
  const { store, dates, i18n: { t }, ui } = ctx;
  const { showWeekends } = store.get().settings;
  const { year, month } = dates.fromMonthKey(ctx.getCalendarMonth());
  const monthLabel = `${dates.monthName(month)} ${year}`;

  els.title.textContent = t('stage.1.title', { month: dates.monthName(month) });
  els.month.textContent = monthLabel;
  els.grid.setAttribute('aria-label', monthLabel);
  els.toggle.checked = showWeekends;

  const rows = dates.monthGrid(year, month, showWeekends);
  const keys = rows.flat();
  cols = rows[0].length;
  root.style.setProperty('--cols', cols);
  root.classList.toggle('calendar--weekends', showWeekends);

  // Roving tabindex: one cell is tabbable — the focused one (re-render), else selected, today, first.
  const focusedKey = document.activeElement?.dataset?.key;
  const tabKey = [focusedKey, ctx.getDate(), dates.todayKey()].find((key) => keys.includes(key)) ?? keys[0];

  els.grid.replaceChildren(
    ...dates.WEEKDAY_SHORT.slice(0, cols).map((name) => ui.h('span', { class: 'calendar__weekday', 'aria-hidden': 'true' }, name)),
    ...keys.map((key) => dayCell(key, key === tabKey)),
  );
  if (focusedKey) els.grid.querySelector(`[data-key="${focusedKey}"]`)?.focus();
}

function dayCell(key, tabbable) {
  const { store, dates, i18n: { t }, ui } = ctx;
  const { total, done } = store.statsForDate(key);
  const isToday = key === dates.todayKey();
  const status = total ? t('day.doneOf', { done, total }) : t('day.noTasks');
  const classes = [
    'calendar__day',
    total && 'calendar__day--planned',
    isToday && 'calendar__day--today',
    key === ctx.getDate() && 'calendar__day--selected',
  ];

  return ui.h(
    'button',
    {
      class: classes.filter(Boolean).join(' '),
      type: 'button',
      dataset: { key },
      title: status,
      'aria-label': t('calendar.cellLabel', { date: dates.formatLong(key), status }),
      'aria-current': isToday ? 'date' : null,
      tabindex: tabbable ? 0 : -1,
      style: `--ratio:${total ? done / total : 0}`,
      onClick: () => openDay(key),
    },
    ui.h('span', { class: 'calendar__fill', 'aria-hidden': 'true' }),
    ui.h('span', { class: 'calendar__num' }, String(dates.fromKey(key).getDate())),
  );
}

// ---------- Actions ----------

function openDay(key) {
  ctx.setDate(key);
  ctx.goTo(ctx.store.statsForDate(key).total ? 4 : 2);
}

function shiftMonth(delta) {
  ctx.setCalendarMonth(ctx.dates.addMonths(ctx.getCalendarMonth(), delta));
  render();
}

function goToToday() {
  ctx.setCalendarMonth(ctx.dates.monthOfKey(ctx.dates.todayKey()));
  render();
  els.grid.querySelector('.calendar__day--today')?.focus();
}

/** Arrow keys walk the cells (Up/Down by a week), Home/End jump to the first/last cell. */
function onGridKeydown(event) {
  const cells = [...els.grid.querySelectorAll('.calendar__day')];
  const index = cells.indexOf(event.target);
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -index, End: cells.length - 1 - index }[event.key];
  if (index < 0 || move === undefined) return;
  event.preventDefault();
  const target = cells[Math.max(0, Math.min(cells.length - 1, index + move))];
  cells[index].tabIndex = -1;
  target.tabIndex = 0;
  target.focus();
}
