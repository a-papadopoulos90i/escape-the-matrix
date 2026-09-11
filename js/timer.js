// Timer engine for the board (SPEC §2 Stage 5). The persisted state lives in the store
// (task.timer: startedAt + elapsedSec, so it survives reloads); this module ticks once a second,
// keeps the task-card clocks and the floating bottom bar in sync, and raises the countdown alarm
// (WebAudio beep, bar flash, browser notification when permission was granted earlier).
// Mounted once at document level by app.js at boot, so the bar shows on every stage after a reload.
import { timerElapsed, timerRemaining } from './store.js';
import { h, icon, confirm } from './ui.js';
import { t } from './i18n.js';

const TICK_MS = 1000;
const FLASH_MS = 3000;
const BEEP_HZ = 880;
const BEEP_OFFSETS = [0, 0.25, 0.5]; // three short beeps
const TIMER_REASONS = new Set(['startTimer', 'pauseTimer', 'resumeTimer', 'stopTimer']);

let store = null;
let bar = null; // { el, title, status, time, pause }
let unsubscribe = null;
let interval = null;
let flashHandle = null;
let audio = null;
let watched = { id: null, remaining: 0 }; // last seen countdown remaining, to detect the 0 crossing

// ---------- Public API ----------

/** Mounts the bar and starts watching the store. Idempotent. */
export function init({ store: nextStore }) {
  if (bar) return;
  store = nextStore;
  bar = buildBar();
  document.body.append(bar.el);
  unsubscribe = store.subscribe(sync);
  document.addEventListener('visibilitychange', onVisibilityChange);
  sync();
}

export function destroy() {
  if (!bar) return;
  setTicking(false);
  clearTimeout(flashHandle);
  unsubscribe?.();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.body.classList.remove('has-timer-bar');
  bar.el.remove();
  bar = null;
  store = null;
  watched = { id: null, remaining: 0 };
}

/** True for store changes that only touch timers (the board refreshes clocks instead of re-rendering). */
export function isTimerReason(reason) {
  return TIMER_REASONS.has(reason);
}

/** "mm:ss" (or "h:mm:ss"); `sec` is rounded down. */
export function formatTime(sec) {
  const total = Math.max(0, Math.floor(sec));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

/** What a task's clock should show: { state: idle | running | paused | finished | done, text }. */
export function clockState(task, now = Date.now()) {
  const { timer } = task;
  if (!timer) return { state: 'idle', text: '' };
  if (timer.stoppedAt) return { state: 'done', text: formatTime(timerElapsed(timer, now)) };
  const shown = timer.mode === 'countdown' ? Math.ceil(timerRemaining(timer, now)) : timerElapsed(timer, now);
  if (!timer.running) return { state: 'paused', text: formatTime(shown) };
  if (timer.mode === 'countdown' && shown <= 0) return { state: 'finished', text: formatTime(0) };
  return { state: 'running', text: formatTime(shown) };
}

const CLOCK_LABEL = {
  idle: () => t('board.timerIdle'),
  running: (time) => t('board.timerRunning', { time }),
  finished: () => t('timer.finished'),
  paused: (time) => t('board.timerPaused', { time }),
  done: (time) => t('board.timerDone', { time }),
};

/** Renders a task-card clock (gray icon when idle, live time otherwise) into `el`. */
export function renderClock(el, task, now = Date.now()) {
  const { state, text } = clockState(task, now);
  const label = CLOCK_LABEL[state](text);
  el.className = `task-card__clock task-card__clock--${state}`;
  el.setAttribute('title', label);
  el.setAttribute('aria-label', label);
  if (state === 'idle') el.replaceChildren(icon('clock', { size: 18 }));
  else el.textContent = text;
}

/**
 * Starts a stopwatch or countdown on `task`. When another task's timer is live the user is asked
 * to stop it first. Resolves to true when the timer was started.
 */
export async function start(task, { mode, durationSec = 0 }) {
  unlockAudio(); // must happen inside the user gesture, before any await
  const active = store.activeTimer();
  if (active && active.id !== task.id && !(await confirm(t('timer.replace')))) return false;
  store.startTimer(task.id, { mode, durationSec });
  return true;
}

// ---------- Store sync & ticking ----------

function sync() {
  const task = store.activeTimer();
  if (task?.id !== watched.id) watched = { id: task?.id ?? null, remaining: task ? timerRemaining(task.timer) : 0 };
  renderBar(task);
  tick();
  setTicking(task?.timer.running === true);
}

function setTicking(on) {
  if (on && !interval) interval = setInterval(tick, TICK_MS);
  if (!on && interval) {
    clearInterval(interval);
    interval = null;
  }
}

/** One clock update: every card clock of the live task, the bar time, and the countdown alarm. */
function tick() {
  const task = store?.activeTimer();
  if (!task) return;
  const now = Date.now();
  for (const el of document.querySelectorAll(`.task-card__clock[data-timer-id="${CSS.escape(task.id)}"]`)) {
    renderClock(el, task, now);
  }
  updateBarTime(task, now);
  if (task.timer.mode !== 'countdown' || !task.timer.running) return;
  const remaining = timerRemaining(task.timer, now);
  if (watched.remaining > 0 && remaining <= 0) raiseAlarm(task);
  watched.remaining = remaining;
}

function onVisibilityChange() {
  if (!document.hidden) tick(); // catch up after background throttling
}

// ---------- Floating bar ----------

function barButton(className, onClick) {
  return h('button', { class: `btn btn-sm ${className}`.trim(), type: 'button', onClick });
}

function fillButton(button, iconName, label) {
  button.replaceChildren(icon(iconName, { size: 16 }), h('span', { class: 'timer-bar__label' }, label));
  button.setAttribute('aria-label', label);
}

function buildBar() {
  const title = h('span', { class: 'timer-bar__title' });
  const status = h('span', { class: 'timer-bar__status' });
  const time = h('span', { class: 'timer-bar__time', role: 'timer' });
  const pause = barButton('timer-bar__pause', () => withActive((task) => (task.timer.running ? store.pauseTimer(task.id) : store.resumeTimer(task.id))));
  const stop = barButton('timer-bar__stop', () => withActive((task) => store.stopTimer(task.id)));
  const done = barButton('btn-primary timer-bar__done', () => withActive((task) => store.toggleDone(task.id, true)));
  fillButton(stop, 'stop', t('timer.stop'));
  fillButton(done, 'check', t('timer.done'));
  const el = h(
    'div',
    { class: 'timer-bar', role: 'region', 'aria-label': t('timer.label'), hidden: true },
    icon('clock', { size: 22 }),
    h('div', { class: 'timer-bar__info' }, title, status),
    time,
    h('div', { class: 'timer-bar__actions' }, pause, stop, done),
  );
  return { el, title, status, time, pause };
}

function withActive(action) {
  unlockAudio();
  const task = store.activeTimer();
  if (task) action(task);
}

function renderBar(task) {
  const visible = Boolean(task);
  bar.el.hidden = !visible;
  document.body.classList.toggle('has-timer-bar', visible);
  if (!visible) return;
  const running = task.timer.running;
  bar.title.textContent = task.title;
  bar.el.classList.toggle('timer-bar--paused', !running);
  fillButton(bar.pause, running ? 'pause' : 'play', t(running ? 'timer.pause' : 'timer.resume'));
}

function updateBarTime(task, now) {
  const { state, text } = clockState(task, now);
  const finished = state === 'finished';
  bar.time.textContent = text;
  bar.status.textContent = finished ? t('timer.finished') : '';
  bar.el.classList.toggle('timer-bar--finished', finished);
}

// ---------- Alarm ----------

function raiseAlarm(task) {
  beep();
  flashBar();
  notify(task);
}

function flashBar() {
  clearTimeout(flashHandle);
  bar.el.classList.remove('timer-bar--flash');
  void bar.el.offsetWidth; // restart the animation when it is already running
  bar.el.classList.add('timer-bar--flash');
  flashHandle = setTimeout(() => bar?.el.classList.remove('timer-bar--flash'), FLASH_MS);
}

function notify(task) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(t('app.name'), { body: t('timer.notification', { title: task.title }), tag: `timer-${task.id}` });
  } catch {
    /* notifications unavailable in this context */
  }
}

/** Creates (or resumes) the AudioContext during a user gesture so the later beep is allowed to play. */
function unlockAudio() {
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}

/** Three short sine beeps generated with an OscillatorNode — no audio files. */
function beep() {
  unlockAudio();
  if (!audio) return;
  try {
    const at = audio.currentTime;
    for (const offset of BEEP_OFFSETS) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = BEEP_HZ;
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, at + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.2);
    }
  } catch {
    /* audio blocked — the bar flash and notification still fire */
  }
}
