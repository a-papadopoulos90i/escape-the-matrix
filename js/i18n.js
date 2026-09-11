// Every user-facing string. Use t('key', { name: value }) — `{name}` placeholders are interpolated.
// Speech-bubble texts (tips) are reproduced verbatim from the design board (SPEC §2).

export const strings = {
  'app.name': 'Escape the Matrix',
  'app.skip': 'Skip to content',
  'app.tipButton': 'Show the tip for this stage',
  'app.stageAnnounce': 'Stage {n} of 5: {label}',
  'app.stageLabel': 'Stage {n}: {label}',

  'stepper.label': 'Stages',
  'stepper.1': 'Calendar',
  'stepper.2': 'Write down',
  'stepper.3': 'Prioritize',
  'stepper.4': 'Ready',
  'stepper.5': 'Organize',

  'stage.heading': 'Stage {n}',
  'stage.1.title': 'calendar of the month {month}',
  'stage.2.title': 'Write down everything you have for today — ',
  'stage.2.titleAccent': 'all of it!',
  'stage.3.title': 'Place them by priority:',
  'stage.4.title': 'Ready to start',
  'stage.5.title': 'fast organize',

  'nav.label': 'Stage navigation',
  'nav.back': '← Back',
  'nav.next': 'Next →',
  'nav.nextUnsorted': 'Next ({n} unsorted) →',
  'nav.backToCalendar': 'Back to calendar',

  'day.today': 'Today',
  'day.goToToday': 'Go to today',
  'day.prev': 'Previous day',
  'day.next': 'Next day',
  'day.progress': '{done}/{total} done',
  'day.doneOf': '{done} of {total} done',
  'day.noTasks': 'No tasks yet',

  'banner.text':
    "You're in free mode — tasks are saved only in this browser. Clearing cookies/site data erases them. Sign in with Google to keep them everywhere.",
  'banner.dismiss': 'Dismiss',

  'account.signIn': 'Sign in with Google',
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
  'account.syncError': 'Not synced — will retry',
  'account.clearConfirm': 'Sign out and delete the tasks saved in this browser? Your data stays in your Google account.',

  'axis.urgent': 'URGENT',
  'axis.notUrgent': 'NOT URGENT',
  'axis.important': 'IMPORTANT',
  'axis.notImportant': 'NOT IMPORTANT',

  'quadrant.do.label': 'DO immediately',
  'quadrant.plan.label': 'PLAN and prioritize',
  'quadrant.delegate.label': 'DELEGATE for completion',
  'quadrant.delete.label': 'DELETE these tasks',
  'quadrant.do.name': 'Urgent & Important',
  'quadrant.plan.name': 'Important but Not Urgent',
  'quadrant.delegate.name': 'Urgent but Not Important',
  'quadrant.delete.name': 'Not Urgent & Not Important',
  'quadrant.unsorted': 'Unsorted',

  'calendar.prevMonth': 'Previous month',
  'calendar.nextMonth': 'Next month',
  'calendar.today': 'Today',
  'calendar.showWeekends': 'Show weekends',
  'calendar.legend.done': 'green = done ratio',
  'calendar.legend.today': 'blue = today',
  'calendar.legend.empty': 'gray = empty',
  'calendar.cellLabel': '{date}: {status}',

  'dump.placeholder': '......',
  'dump.addRow': 'Add another task',
  'dump.deleteTask': 'Delete task',
  'dump.taskLabel': 'Task {n}',
  'dump.needTask': 'Add at least one task to continue',

  'sort.allPlaced': 'All placed ✓',
  'sort.placeIn': 'Place in ▾',
  'sort.pile': 'Unsorted tasks',
  'sort.keyHint': 'Press 1–4 to place: 1 do, 2 plan, 3 delegate, 4 delete',
  'sort.placed': 'Placed in {quadrant}',

  'board.unplaced': '{n} tasks not placed yet — ',
  'board.unplacedOne': '1 task not placed yet — ',
  'board.placeThem': 'Place them',
  'board.menu': 'More actions',
  'board.addHere': '+ Add task here',
  'board.markAllDone': 'Mark all done',
  'board.moveUnfinished': 'Move unfinished to next day',
  'board.clearDone': 'Clear done tasks',
  'board.deleteAll': 'Delete all tasks here',
  'board.newTask': 'New task',
  'board.markDone': 'Mark done',
  'board.markUndone': 'Mark not done',
  'board.timerIdle': 'No timer',
  'board.timerRunning': 'Timer running: {time}',
  'board.timerPaused': 'Timer paused: {time}',
  'board.timerDone': 'Time spent: {time}',
  'board.editTitle': 'Task title',

  'popover.start': 'Start the timer or the countdown',
  'popover.postpone': 'Postpone to another day',
  'popover.nextDay': "Send to the next day's list",
  'popover.edit': 'Edit',
  'popover.moveTo': 'Move to ▾',
  'popover.delete': 'Delete',
  'popover.move': 'Move',

  'timer.stopwatch': 'Stopwatch',
  'timer.countdown': 'Countdown',
  'timer.presets': 'Minutes',
  'timer.custom': 'Custom minutes',
  'timer.start': 'Start',
  'timer.pause': 'Pause',
  'timer.resume': 'Resume',
  'timer.stop': 'Stop',
  'timer.done': 'Done ✓',
  'timer.finished': "Time's up!",
  'timer.replace': 'Stop the current timer and start a new one?',
  'timer.notification': "Time's up: {title}",
  'timer.label': 'Task timer',

  'toast.movedTo': 'Moved to {date}',
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

/** Speech bubbles per stage — verbatim from the design board (stage 1 has none on the board). */
export const tips = {
  1: { text: 'Pick a day to plan. Green shows how much of that day is done, blue is today.' },
  2: { html: 'Write down everything you have for today — <strong>all of it!</strong>' },
  3: {
    title: 'Organize them by priority:',
    items: ['Urgent & Important', 'Important but Not Urgent', 'Urgent but Not Important', 'Not Urgent & Not Important'],
  },
  4: { text: 'Done mark ✅' },
  5: {
    title: 'Organize them by priority:',
    items: ['start the timer or the clock down', 'postpone for another day', "send it to the next day's list"],
  },
};

/** Stage 3 bullet list under the title. */
export const priorityBullets = ['axis.urgent', 'axis.notUrgent', 'axis.important', 'axis.notImportant'];

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
