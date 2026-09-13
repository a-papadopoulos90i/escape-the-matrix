// Stage 1 — "Pick your day". A vertically scrolling month calendar: the current month shows, and
// "Show next month" appends the following month below so the user simply scrolls down (no popup, no
// resizing). Each day cell is a gray tray when empty, a green striped fill (one stripe per done
// task) when planned, a blue border for today and a soft ring on the selected day. Clicking a day
// opens Stage 2 (no tasks) or Stage 4 (has tasks).
//
// A "Manage" toggle flips the calendar over: each cell then previews the day's task titles, and
// tapping a day opens a popup to add / edit / tick / delete that day's tasks without leaving.
import { isRecord } from '../store.js';

let ctx = null;
let root = null;
let els = {};
let cols = 5;
let flipped = false; // Manage mode: cells preview task titles and a tap opens the day popup
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
    ui.h(
      'div',
      { class: 'calendar__footer' },
      legend(),
      ui.h('button', { class: 'calendar__demo', type: 'button', onClick: loadDemo }, ctx.i18n.t('calendar.demo')),
    ),
  );
  els.title = root.querySelector('.stage-title');

  monthsShown = 1;
  flipped = false;
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
      (els.flip = ui.h(
        'button',
        { class: 'btn btn-sm calendar__flip', type: 'button', 'aria-pressed': String(flipped), onClick: toggleFlip },
        ui.icon('refresh', { size: 15 }),
        t(flipped ? 'calendar.manageOff' : 'calendar.manage'),
      )),
    ),
  );
}

/** Flips the calendar between the normal view and Manage mode (task previews + day popup). */
function toggleFlip() {
  flipped = !flipped;
  root.classList.toggle('calendar--flipped', flipped);
  els.months.classList.remove('calendar__months--flipping');
  void els.months.offsetWidth; // restart the flip animation
  els.months.classList.add('calendar__months--flipping');
  els.flip.setAttribute('aria-pressed', String(flipped));
  els.flip.replaceChildren(ctx.ui.icon('refresh', { size: 15 }), ctx.i18n.t(flipped ? 'calendar.manageOff' : 'calendar.manage'));
  render();
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

  // Manage mode: show a trimmed preview of the day's task titles on the flipped cell.
  const preview = flipped
    ? ui.h(
        'span',
        { class: 'calendar__preview', 'aria-hidden': 'true' },
        store
          .tasksForDate(key)
          .filter((task) => !isRecord(task))
          .slice(0, 4)
          .map((task) => ui.h('span', { class: `calendar__preview-item ${task.done ? 'is-done' : ''}`.trim() }, task.title)),
      )
    : null;

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
      onClick: () => (flipped ? openDayPopup(key) : openDay(key)),
    },
    ui.h('span', { class: 'calendar__fill', 'aria-hidden': 'true' }),
    ui.h('span', { class: 'calendar__num' }, String(dates.fromKey(key).getDate())),
    preview,
  );
}

// ---------- Actions ----------

function openDay(key) {
  ctx.setDate(key);
  ctx.goTo(ctx.store.statsForDate(key).total ? 4 : 2);
}

/** Manage-mode popup: view / add / rename / tick / delete a single day's tasks, without leaving the
 *  calendar. Re-renders live while open. "Open day" jumps into that day's stage. */
function openDayPopup(key) {
  const { ui, store, dates, i18n } = ctx;
  const list = ui.h('div', { class: 'day-pop__list' });

  const rowEl = (task) => {
    const check = ui.h('input', {
      class: 'task-card__check',
      type: 'checkbox',
      checked: task.done,
      'aria-label': task.title,
      onChange: (event) => store.toggleDone(task.id, event.currentTarget.checked),
    });
    const title = ui.h('input', {
      class: 'day-pop__title',
      type: 'text',
      value: task.title,
      maxlength: 200,
      'aria-label': i18n.t('board.editTitle'),
      onChange: (event) => {
        const value = event.currentTarget.value.trim();
        value ? store.updateTask(task.id, { title: value }) : store.removeTask(task.id);
      },
    });
    const del = ui.h(
      'button',
      { class: 'btn-icon day-pop__del', type: 'button', 'aria-label': i18n.t('board.deleteTask'), onClick: () => store.removeTask(task.id) },
      ui.icon('close', { size: 14 }),
    );
    return ui.h('div', { class: `day-pop__row ${task.done ? 'task-card--done' : ''}`.trim(), dataset: { id: task.id } }, ui.h('label', { class: 'task-card__done' }, check), title, del);
  };

  const renderRows = () => {
    const tasks = store.tasksForDate(key).filter((task) => !isRecord(task));
    list.replaceChildren(...(tasks.length ? tasks.map(rowEl) : [ui.h('p', { class: 'day-pop__empty text-muted' }, i18n.t('calendar.dayEmpty'))]));
  };

  const input = ui.h('input', { class: 'day-pop__add-input', type: 'text', maxlength: 200, placeholder: i18n.t('dump.whatsOnYourMind'), 'aria-label': i18n.t('dump.whatsOnYourMind') });
  const addForm = ui.h(
    'form',
    {
      class: 'day-pop__add',
      onSubmit: (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        store.addTask({ title: value, date: key });
        input.value = '';
        input.focus();
      },
    },
    input,
    ui.h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, i18n.t('dump.add')),
  );

  renderRows();
  const unsubscribeRows = store.subscribe(renderRows);
  ui.modal({
    title: dates.formatLong(key),
    content: ui.h('div', { class: 'day-pop' }, addForm, list),
    actions: [
      { label: i18n.t('calendar.openDay'), primary: true, onClick: () => openDay(key) },
      { label: i18n.t('common.close') },
    ],
    onClose: () => unsubscribeRows(),
  });
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

/** Fills this browser with a two-month demo (local only) so the app can be seen populated. */
async function loadDemo() {
  if (!(await ctx.ui.confirm(ctx.i18n.t('calendar.demoConfirm')))) return;
  ctx.store.importDoc(buildDemoDoc(ctx));
}

const DEMO_TITLES = ['Email the client', 'Invoice #A5', 'Excel report', 'Call the bank', 'Book flights', 'Renew the domain', 'Water the plants', 'Read 20 pages', 'Gym session', 'Groceries', 'Plan Q2', 'Fix the login bug', 'Back up the laptop', 'Dentist appointment', 'Team standup', 'Review the PR', 'Pay the rent', 'Tidy the inbox'];
const DEMO_QUADRANTS = ['do', 'plan', 'delegate', 'delete'];
const DEMO_COUNTS = [2, 0, 3, 1, 4, 2, 1, 3, 0, 2]; // per-day task counts, repeating — a lively history

/** A doc spanning ~45 days back to ~12 forward: placed tasks (many past ones done → a green
 *  calendar) plus a few global backlog items. */
function buildDemoDoc(ctx) {
  const { dates } = ctx;
  const today = dates.todayKey();
  const iso = (key) => `${key}T12:00:00.000Z`;
  const tasks = [];
  let order = 1;
  for (let offset = -45; offset <= 12; offset += 1) {
    const date = dates.addDays(today, offset);
    const count = DEMO_COUNTS[((offset % DEMO_COUNTS.length) + DEMO_COUNTS.length) % DEMO_COUNTS.length];
    for (let i = 0; i < count; i += 1) {
      const done = offset < 0 && (offset + i) % 3 !== 0; // most past tasks completed
      tasks.push({
        id: `demo_${date}_${i}`,
        title: DEMO_TITLES[(Math.abs(offset) * 2 + i) % DEMO_TITLES.length],
        date,
        quadrant: DEMO_QUADRANTS[(i + Math.abs(offset)) % DEMO_QUADRANTS.length],
        order: order++,
        done,
        doneAt: done ? iso(date) : null,
        createdAt: iso(date),
        updatedAt: iso(date),
        timer: null,
        attempt: 1,
        carriedTo: null,
      });
    }
  }
  for (const [i, title] of ['Idea: start a newsletter', 'Someday: learn Rust', 'Maybe: repaint the office'].entries()) {
    tasks.push({ id: `demo_backlog_${i}`, title, date: today, quadrant: null, order: order++, done: false, doneAt: null, createdAt: iso(today), updatedAt: iso(today), timer: null, attempt: 1, carriedTo: null });
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: { showWeekends: false, bannerDismissed: true, tipsSeen: { 1: true, 2: true, 3: true, 4: true } },
    tasks,
  };
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
