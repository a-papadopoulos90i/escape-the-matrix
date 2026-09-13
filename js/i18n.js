// Every user-facing string. Use t('key', { name: value }) — `{name}` placeholders are interpolated.
// Speech-bubble texts (tips) are reproduced verbatim from the design board (SPEC §2).

export const strings = {
  'app.name': 'Escape the Matrix',
  'app.skip': 'Skip to content',
  'app.tipButton': 'Show the tip for this stage',
  'app.stageAnnounce': 'Stage {n} of 4: {label}',
  'app.stageLabel': 'Stage {n}: {label}',

  'stepper.label': 'Stages',
  'stepper.1': 'Calendar',
  'stepper.2': 'Write down',
  'stepper.3': 'Prioritize',
  'stepper.4': 'Ready',

  'stage.heading': 'Stage {n}',
  'stage.1.title': 'Pick your day',
  'stage.2.title': 'Write it all down',
  'stage.2.subtitle': "Don't judge, don't sort. Just get everything out of your head.",
  'stage.2.titleAccent': 'all of it!',
  'stage.3.title': 'Place them by priority',
  'stage.4.title': 'Ready to start',

  'nav.label': 'Stage navigation',
  'nav.back': '← Back',
  'nav.next': 'Next →',
  'nav.nextWaiting': 'Next ({n} waiting) →',
  'nav.backToCalendar': 'Back to calendar',

  'day.today': 'Today',
  'day.goToToday': 'Go to today',
  'day.prev': 'Previous day',
  'day.next': 'Next day',
  'day.progress': '{done}/{total} done',
  'day.doneOf': '{done} of {total} done',
  'day.waiting': '{n} waiting',
  'day.noTasks': 'No tasks yet',

  'banner.text':
    "You're in free mode — tasks are saved only in this browser. Clearing cookies/site data erases them. Sign in with Google to keep them everywhere.",
  'banner.dismiss': 'Dismiss',

  'account.signIn': 'Sign in',
  'account.signInTitle': 'Sign in',
  'account.signInSubtitle': 'Choose how you want to continue.',
  'account.continueGoogle': 'Continue with Google',
  'account.continueApple': 'Continue with Apple',
  'account.continueEmail': 'Continue with email',
  'account.emailPlaceholder': 'you@example.com',
  'account.or': 'or',
  'account.soon': 'Apple and email sign-in are coming soon.',
  'account.menu': 'Account menu',
  'account.synced': 'Synced ✓',
  'account.syncing': 'Syncing…',
  'account.offline': 'Offline',
  'account.signOut': 'Sign out',
  'account.signOutClear': 'Sign out & clear this device',
  'account.signInError': 'Sign-in failed. Please try again.',
  'account.notConnected.title': 'Google sign-in is not connected yet',
  'account.notConnected.body':
    'This deployment has no Firebase configuration, so Google sign-in is not available. Your tasks stay saved in this browser.',
  'account.notConnected.link': 'How to connect it (SETUP.md)',
  'account.notConnected.url': 'https://github.com/a-papadopoulos90i/escape-the-matrix/blob/main/SETUP.md',
  'account.syncError': 'Not synced — will retry',
  'account.tooLarge': 'Your account holds too many tasks to sync. Delete old tasks to resume syncing; this browser keeps saving.',
  'account.clearConfirm': 'Sign out and delete the tasks saved in this browser? Your data stays in your Google account.',

  'axis.urgent': 'URGENT',
  'axis.notUrgent': 'NOT URGENT',
  'axis.important': 'IMPORTANT',
  'axis.notImportant': 'NOT IMPORTANT',

  'quadrant.do.label': 'Do now',
  'quadrant.plan.label': 'Schedule',
  'quadrant.delegate.label': 'Delegate',
  'quadrant.delete.label': 'Drop',
  'quadrant.do.name': 'Urgent & Important',
  'quadrant.plan.name': 'Important but Not Urgent',
  'quadrant.delegate.name': 'Urgent but Not Important',
  'quadrant.delete.name': 'Not Urgent & Not Important',
  'quadrant.unsorted': 'Waiting list',

  'calendar.prevMonth': 'Previous month',
  'calendar.nextMonth': 'Next month',
  'calendar.today': 'Today',
  'calendar.showNext': 'Show next month',
  'calendar.showWeekends': 'Show weekends',
  'calendar.demo': 'Demo Version',
  'calendar.manage': 'All Tasks',
  'calendar.manageOff': 'Back to calendar',
  'calendar.openDay': 'Open day →',
  'calendar.dayEmpty': 'No tasks on this day yet.',
  'settings.title': 'Settings',
  'settings.timeReport': 'Time report',
  'analysis.title': 'Time spent per task',
  'analysis.total': 'Total tracked',
  'analysis.times': '×{n}',
  'analysis.empty': 'No time tracked yet. Start a task timer on the board and it shows up here.',
  'calendar.demoConfirm': 'Load a two-month demo? This replaces the tasks saved in this browser (only here — nothing is uploaded).',
  'calendar.legend.done': 'green = done tasks, one stripe each (up to 10)',
  'calendar.legend.today': 'blue = today',
  'calendar.legend.empty': 'gray = empty',
  'calendar.cellLabel': '{date}: {status}',
  'calendar.weekendNote': 'Today is {weekday}, so weekends are shown.',

  'dump.placeholder': '......',
  'dump.whatsOnYourMind': "What's on your mind?",
  'dump.add': 'Add',
  'dump.addRow': 'Add another task',
  'dump.deleteTask': 'Delete task',
  'dump.taskLabel': 'Task {n}',
  'dump.needTask': 'Add at least one task to continue',

  'sort.allPlaced': 'All placed ✓',
  'sort.placeIn': 'Place in ▾',
  'sort.pile': 'Your tasks',
  'sort.listTitle': 'Your tasks',
  'sort.listHint': 'Tap a priority for each task — Do now, Schedule, Delegate or Drop. Anything you leave untagged stays on the waiting list.',
  'sort.empty': 'No tasks yet — add some in “Write it all down”.',
  'sort.pileHint': 'Waiting list — what you leave here stays on hold for this day',
  'sort.keyHint': 'Press 1–4 to place: 1 do, 2 plan, 3 delegate, 4 delete',
  'sort.placed': 'Placed in {quadrant}',

  'board.waiting': 'Waiting list ({n})',
  'board.waitingHint': 'On hold for this day — place a task when you decide to work on it.',
  'board.menu': 'More actions',
  'board.addHere': '+ Add task here',
  'board.addTask': 'Add a task here',
  'board.markAllDone': 'Mark all done',
  'board.moveUnfinished': 'Move unfinished to next day',
  'board.clearDone': 'Clear done tasks',
  'board.deleteAll': 'Delete all tasks here',
  'board.newTask': 'New task',
  'board.markDone': 'Mark done',
  'board.markUndone': 'Mark not done',
  'board.deleteTask': 'Delete task',
  'board.renameTask': 'Rename — click to edit',
  'board.changePriority': 'Change priority',
  'board.dragHint': 'Drag a card to another quadrant to move it.',
  'board.timerIdle': 'No timer — start one',
  'board.timerRunning': 'Timer running: {time}',
  'board.timerPaused': 'Timer paused: {time}',
  'board.timerDone': 'Time spent: {time}',
  'board.editTitle': 'Task title',

  'carry.strip': '{n} unfinished tasks left on {days}',
  'carry.stripOne': '1 unfinished task left on {days}',
  'carry.pull': 'Pull them here',
  'carry.pullOne': 'Pull it here',
  'carry.toast': '{n} tasks pulled here — the old days keep a record',
  'carry.toastOne': '1 task pulled here — the old day keeps a record',
  'carry.record': 'Pulled to {date}',
  'carry.attempt': '×{n}',
  'carry.attemptTitle': '{n}th time on the plan',
  'carry.attemptTitle2': '2nd time on the plan',
  'carry.attemptTitle3': '3rd time on the plan',

  'schedule.title': 'Reschedule',
  'schedule.nextDay': 'Next day',
  'schedule.postpone': 'Postpone',
  'schedule.set': 'Set',

  'popover.start': 'Start the timer or the countdown',
  'popover.postpone': 'Postpone to another day',
  'popover.nextDay': "Send to the next day's list",
  'popover.edit': 'Edit',
  'popover.moveTo': 'Move to ▾',
  'popover.delete': 'Delete',
  'popover.move': 'Move',

  'timer.stopwatch': 'Count up',
  'timer.continue': 'Continue {time}',
  'timer.countdown': 'Countdown',
  'timer.presets': 'Minutes',
  'timer.unit': 'min',
  'timer.custom': 'Custom minutes',
  'timer.start': 'Start',
  'timer.pause': 'Pause',
  'timer.resume': 'Resume',
  'timer.stop': 'Stop',
  'timer.done': 'Done',
  'timer.finished': "Time's up!",
  'timer.replace': 'Stop the current timer and start a new one?',
  'timer.notification': "Time's up: {title}",
  'timer.label': 'Task timer',

  'toast.movedTo': 'Moved to {date}',
  'toast.movedToWeekend': 'Moved to {date} — weekends are now shown',
  'toast.deleted': 'Task deleted',
  'toast.deletedMany': '{n} tasks deleted',
  'toast.undo': 'Undo',
  'toast.saveFailed': 'Could not save your changes in this browser.',

  'confirm.deleteTask': 'Delete this task?',
  'confirm.deleteAll': 'Delete all tasks in this quadrant?',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.ok': 'OK',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.delete': 'Delete',
};

/** Speech-bubble tips were removed at the owner's request — no stage shows one, and the header has
 *  no "?" button. Kept as an empty map so the tip machinery stays inert rather than erroring. */
export const tips = {};

export function t(key, params) {
  const template = strings[key];
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export function stepperLabel(stage) {
  return t(`stepper.${stage}`);
}

export function quadrantLabel(quadrant) {
  return t(`quadrant.${quadrant}.label`);
}

export function quadrantName(quadrant) {
  return t(`quadrant.${quadrant}.name`);
}

/** "2nd time on the plan", "3rd…", "4th…" — for the ×n badge of a task pulled forward. */
export function attemptTitle(n) {
  if (n === 2 || n === 3) return t(`carry.attemptTitle${n}`);
  return t('carry.attemptTitle', { n });
}
