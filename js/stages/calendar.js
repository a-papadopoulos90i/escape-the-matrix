// Stage 1 — "Pick your day". A vertically scrolling month calendar: the current month shows, and
// "Show next month" appends the following month below so the user simply scrolls down (no popup, no
// resizing). Each day cell is a gray tray when empty, a green striped fill (one stripe per done
// task) when planned, a blue border for today and a soft ring on the selected day. Clicking a day
// opens Stage 2 (no tasks) or Stage 4 (has tasks).

let ctx = null;
let root = null;
let els = {};
let cols = 5;
let monthsShown = 1; // grows as the user reveals more months below
let unsubscribe = null;

export function mount(container, context) {
  ctx = context;
  const { ui, store } = ctx;

  els.months = ui.h('div', { class: 'calendar__months', role: 'group', onKeydown: onGridKeydown });
  els.month = ui.h('p', { class: 'calendar__month', 'aria-live': 'polite' });
  els.more = ui.h(
    'button',
    { class: 'btn btn-sm calendar__more', type: 'button', onClick: showNextMonth },
    ui.icon('chevron-down', { size: 16 }),
    ctx.i18n.t('calendar.showNext'),
  );

  root = ui.h(
    'div',
    { class: 'stage-body calendar' },
    ui.stageHeader({ stage: 1, title: '' }),
    toolbar(),
    els.months,
    els.more,
    legend(),
  );
  els.title = root.querySelector('.stage-title');

  monthsShown = 1;
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

/** Rebuilds the title, the toolbar label and every visible month. The calendar always shows the
 *  full week (Sun–Sat). */
function render() {
  const { dates, i18n: { t } } = ctx;
  const weekendsShown = true;
  const baseMonth = ctx.getCalendarMonth();
  const base = dates.fromMonthKey(baseMonth);

  els.title.textContent = t('stage.1.title');
  els.month.textContent = `${dates.monthName(base.month)} ${base.year}`;

  cols = 7;
  root.style.setProperty('--cols', cols);
  root.classList.add('calendar--weekends');

  // One tabbable cell across every visible month (the focused one on re-render, else selected,
  // else today, else the very first cell).
  const monthKeys = Array.from({ length: monthsShown }, (_, i) => dates.addMonths(baseMonth, i));
  const allKeys = monthKeys.flatMap((mk) => dates.monthGrid(dates.fromMonthKey(mk).year, dates.fromMonthKey(mk).month, weekendsShown).flat());
  const focusedKey = document.activeElement?.dataset?.key;
  const tabKey = [focusedKey, ctx.getDate(), dates.todayKey()].find((key) => allKeys.includes(key)) ?? allKeys[0];

  els.months.replaceChildren(...monthKeys.map((mk, i) => monthBlock(mk, weekendsShown, tabKey, i > 0)));
  if (focusedKey) els.months.querySelector(`[data-key="${focusedKey}"]`)?.focus();
}

/** One month: an optional title (shown on appended months) plus its weekday header + day grid. */
function monthBlock(monthKey, weekendsShown, tabKey, titled) {
  const { dates, ui } = ctx;
  const { year, month } = dates.fromMonthKey(monthKey);
  const label = `${dates.monthName(month)} ${year}`;
  const grid = ui.h(
    'div',
    { class: 'calendar__grid', role: 'group', 'aria-label': label },
    ...dates.weekdayLabels(weekendsShown).map((name) => ui.h('span', { class: 'calendar__weekday', 'aria-hidden': 'true' }, name)),
    ...dates.monthGrid(year, month, weekendsShown).flat().map((key) => dayCell(key, key === tabKey)),
  );
  return ui.h(
    'section',
    { class: 'calendar__month-block' },
    titled ? ui.h('h3', { class: 'calendar__month-title' }, label) : null,
    grid,
  );
}

function dayCell(key, tabbable) {
  const { store, dates, i18n: { t }, ui } = ctx;
  const { total, done } = store.statsForDate(key);
  const isToday = key === dates.todayKey();
  const status = total ? t('day.doneOf', { done, total }) : t('day.noTasks');
  const classes = [
    'calendar__day',
    done > 0 && 'calendar__day--planned', // green only when a task is actually done, not merely planned
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
      style: `--done:${Math.min(done, 10)}`, // one green stripe per done task, ten at most
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

/** Appends the next month below and scrolls it into view (SPEC §2 — no popup, just more to scroll). */
function showNextMonth() {
  monthsShown += 1;
  render();
  const blocks = els.months.querySelectorAll('.calendar__month-block');
  blocks[blocks.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function shiftMonth(delta) {
  monthsShown = 1;
  ctx.setCalendarMonth(ctx.dates.addMonths(ctx.getCalendarMonth(), delta));
  render();
}

function goToToday() {
  monthsShown = 1;
  ctx.setCalendarMonth(ctx.dates.monthOfKey(ctx.dates.todayKey()));
  render();
  els.months.querySelector('.calendar__day--today')?.focus();
}

/** Arrow keys walk the cells (Up/Down by a week), Home/End jump to the first/last cell. */
function onGridKeydown(event) {
  const cells = [...els.months.querySelectorAll('.calendar__day')];
  const index = cells.indexOf(event.target);
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -index, End: cells.length - 1 - index }[event.key];
  if (index < 0 || move === undefined) return;
  event.preventDefault();
  const target = cells[Math.max(0, Math.min(cells.length - 1, index + move))];
  cells[index].tabIndex = -1;
  target.tabIndex = 0;
  target.focus();
}
