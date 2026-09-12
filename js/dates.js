// Local-calendar date helpers. A "key" is a 'YYYY-MM-DD' string in the user's local time zone;
// a "month key" is 'YYYY-MM'. Months passed as numbers are 0-based (January = 0), like Date.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const GRID_ROWS = 6;

/** Short weekday labels, Sunday first (the owner's week starts on Sunday). */
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Column headers of the month grid: Sun–Sat with weekends, Mon–Fri without. */
export function weekdayLabels(showWeekends) {
  return showWeekends ? WEEKDAY_SHORT : WEEKDAY_SHORT.slice(1, 6);
}

const pad = (n) => String(n).padStart(2, '0');

export function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function todayKey(now = new Date()) {
  return toKey(now);
}

/** True for a well-formed key that names a real calendar day. */
export function isValidKey(key) {
  return typeof key === 'string' && KEY_RE.test(key) && toKey(fromKey(key)) === key;
}

export function addDays(key, n) {
  const date = fromKey(key);
  date.setDate(date.getDate() + n);
  return toKey(date);
}

export function isWeekend(key) {
  const day = fromKey(key).getDay();
  return day === 0 || day === 6;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key) {
  return (fromKey(key).getDay() + 6) % 7;
}

/**
 * Whether the calendar and day-bar arrows should show weekend days: the setting, or — so that
 * "today" is never a hidden day — whenever today itself falls on a weekend.
 */
export function weekendsVisible(showWeekends, now = new Date()) {
  return Boolean(showWeekends) || isWeekend(todayKey(now));
}

/** Weekday name of a key, e.g. "Saturday". */
export function weekdayName(key) {
  return WEEKDAYS[fromKey(key).getDay()];
}

export function nextVisibleDay(key, showWeekends) {
  return stepVisible(key, 1, showWeekends);
}

export function prevVisibleDay(key, showWeekends) {
  return stepVisible(key, -1, showWeekends);
}

function stepVisible(key, direction, showWeekends) {
  let next = addDays(key, direction);
  while (!showWeekends && isWeekend(next)) next = addDays(next, direction);
  return next;
}

/** "Wednesday, 11 March 2026" */
export function formatLong(key) {
  const date = fromKey(key);
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Tue 15 Sep" */
export function formatShort(key) {
  const date = fromKey(key);
  return `${WEEKDAYS[date.getDay()].slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}`;
}

export function monthName(month) {
  return MONTHS[month];
}

export function toMonthKey(year, month) {
  return `${year}-${pad(month + 1)}`;
}

export function fromMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month: month - 1 };
}

export function isValidMonthKey(monthKey) {
  if (typeof monthKey !== 'string' || !MONTH_KEY_RE.test(monthKey)) return false;
  const { month } = fromMonthKey(monthKey);
  return month >= 0 && month <= 11;
}

export function addMonths(monthKey, n) {
  const { year, month } = fromMonthKey(monthKey);
  const date = new Date(year, month + n, 1);
  return toMonthKey(date.getFullYear(), date.getMonth());
}

/** Month key of a day key: '2026-03-11' → '2026-03'. */
export function monthOfKey(key) {
  return key.slice(0, 7);
}

/**
 * Six rows of day keys for the month view. With weekends the week runs Sun–Sat and the first row
 * is the week containing the 1st. Without weekends rows hold Mon–Fri; the first row is the week
 * containing the 1st unless the 1st falls on a weekend, in which case the grid starts on the
 * following Monday (SPEC §2).
 */
export function monthGrid(year, month, showWeekends) {
  const first = new Date(year, month, 1);
  const sinceMonday = (first.getDay() + 6) % 7;
  const offset = showWeekends ? first.getDay() : sinceMonday; // days since the week's first column
  const start = new Date(year, month, 1 - offset);
  if (!showWeekends && sinceMonday > 4) start.setDate(start.getDate() + 7);

  const perRow = showWeekends ? 7 : 5;
  const rows = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const cells = [];
    for (let col = 0; col < perRow; col += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + row * 7 + col);
      cells.push(toKey(date));
    }
    rows.push(cells);
  }
  return rows;
}
