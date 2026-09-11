# Escape the Matrix — Product & Engineering Spec

Single source of truth for building the app. Derived from the owner's design board
("The Eisenhower Matrix Web App.pdf", one wide page with 5 stages) plus the owner's written
requirements. When in doubt, follow this document; if something is missing, choose the option a
careful product engineer would choose and note it in your report.

## 1. Product summary

**Escape the Matrix** is a daily-planning web app built on the Eisenhower Matrix
(Urgent / Not urgent × Important / Not important). Every day the user:

1. picks a day in a month calendar (Stage 1),
2. brain-dumps everything they have for that day (Stage 2),
3. drags each task into one of the 4 quadrants (Stage 3),
4. works the board: DO / PLAN / DELEGATE / DELETE, ticking tasks done (Stage 4),
5. fast-organizes each task with a timer, a postpone, or a "send to next day" action (Stage 5).

The 5 stages are shown as **panels ("little windows") that alternate** with a slide/fade
transition, driven by a 5-step stepper. Every explanatory **speech bubble from the design board
is reproduced verbatim** as a dismissible tip on its stage (re-openable with a "?" button).

Persistence:
- **Free mode (no login):** everything is saved in the browser (`localStorage`). If the user clears
  site data / cookies, the history is gone. A small dismissible banner explains this.
- **Google mode:** one-click "Sign in with Google" (Firebase Auth popup). Data is stored per user in
  Firestore and live-synced across devices. Signing in merges the local free-mode data into the
  account.

Deployment: static site, **no build step**, plain ES modules, served from GitHub Pages under a
sub-path (so all URLs must be relative: `./js/app.js`, `./css/base.css`).

UI language: English (the design board is in English). All strings live in `js/i18n.js`.
Product name is always written **Escape the Matrix**.

## 2. The five stages (from the design board — reproduce faithfully)

Common: each stage panel has a heading "Stage N" (small, gray) and the stage title (large).
Bottom of each panel: `← Back` and `Next →` buttons (Stage 1 has no Back; Stage 5 has "Back to
calendar" instead of Next). The stepper at the top also allows direct jumps.

### Stage 1 — "calendar of the month March"

Title: `calendar of the month {Month}` (Month = the month currently displayed, e.g. "March").
Controls: `‹` previous month, `›` next month, `Today` button, and a `Show weekends` toggle (default
**off**, persisted in settings).

Grid: rows of weekdays, **Mon–Fri when weekends are hidden** (5 columns, like the design), Mon–Sun
when shown. Always **6 rows**. The first row is the week that contains the 1st of the month, except
when the 1st falls on a hidden weekend day, in which case start with the following Monday (this
exactly reproduces the design: March 2026 starts on Sunday, so the grid shows Mar 2–6, 9–13, 16–20,
23–27, 30–31 + Apr 1–3, Apr 6–10). Days from the next month show only their number, same styling.

Cell design (rounded square, ~1:1, number centred, bold):
- **No tasks:** gray border `#757575` (1.5px), white top, a light-gray "tray" `#d9d9d9` filling the
  bottom ~45%.
- **Has tasks:** green border `#3e9b4b`, and a **green striped fill rising from the bottom** whose
  height = done ÷ total (100% = fully green). Fill colour `#66d575` with horizontal stripes
  `#4eb25c` every ~8px (use `repeating-linear-gradient`). A day with tasks but 0 done shows the
  green border with a thin green base line so it is visibly "planned".
- **Today:** blue border `#4da3ff` (2px) regardless of tasks; if it has tasks, show the fill too.
- **Selected day** (the day currently open in stages 2–5): subtle blue glow/ring.
- Hover/focus: tooltip/`title` "3 of 5 done" (or "No tasks yet").
- Click/Enter on a cell → selects that date and goes to **Stage 2 if the day has no tasks**,
  otherwise **Stage 4**.

Legend under the grid (small): green = done ratio, blue = today, gray = empty.

### Stage 2 — "Write down everything you have for today — all of it!"

Title: `Write down everything you have for today — ` + **`all of it!` in red `#f24822`, bold**.
Sub-line (small, gray): the selected date, e.g. "Wednesday, 11 March 2026".

Layout: a faded, empty 4-quadrant matrix in the background (light gray `#e6e6e6` outlines, white
fill, no colours, no labels). Centred over it, a vertical stack of **task rows**: bordered white
boxes (`#333` 1.5px border, radius 6px, centred text), one per task. Below the last real task, two
placeholder rows showing `......` (empty inputs with that placeholder) and a large **`+`** button
that adds another row. Behaviour:
- Typing in a row and pressing **Enter** commits it and focuses the next (empty) row.
- **Escape**/blur on an empty new row discards it.
- Each row has a small `✕` (visible on hover/focus) to delete the task.
- Rows are editable inline (click to edit an existing task's title).
- Tasks created here have `quadrant: null` (unsorted) and `date = selectedDate`.
- `Next →` is enabled only when the day has ≥ 1 task.

Speech bubble (tip), verbatim: **"Write down everything you have for today — all of it!"**
(bubble style: rounded, khaki-gray `#b9b098` background, dark text, small tail pointing at the
task rows).

### Stage 3 — "Place them by priority:"

Title: `Place them by priority:` followed by a centred bullet list (large):
`URGENT`, `NOT URGENT`, `IMPORTANT`, `NOT IMPORTANT`.

Layout: the 2×2 matrix, now coloured, **no quadrant labels inside** (as in the design) but with
small axis captions around it: `URGENT` / `NOT URGENT` above the two columns, `IMPORTANT` /
`NOT IMPORTANT` beside the two rows (rotated or stacked).

Quadrant colours (fill / border):
- Top-left **Urgent & Important** (`do`): fill `#ffc7c2`, border `#f24822`
- Top-right **Important but Not Urgent** (`plan`): fill `#ffecbd`, border `#ffcd29`
- Bottom-left **Urgent but Not Important** (`delegate`): fill `#c2e5ff`, border `#3dadff`
- Bottom-right **Not Urgent & Not Important** (`delete`): fill `#d9d9d9`, border `#a5a5a5`

Unsorted tasks (`quadrant === null`) sit as a **stacked pile of white cards in the centre** of the
matrix (overlapping the 4 quadrants, like the design). Interaction, all must work:
- **Drag & drop** a card into a quadrant (Pointer Events; works with mouse *and* touch; the card
  follows the pointer, the hovered quadrant highlights).
- **Tap-to-place:** tap/click a card to select it (highlight), then tap a quadrant.
- **Keyboard:** focus a card, press `1` `2` `3` `4` (do/plan/delegate/delete), or use a small
  "Place in ▾" menu on the card.
- Sorted tasks appear inside their quadrant as small white cards and can be dragged again to
  another quadrant. Cards in quadrants are simple (title only) at this stage.
- When the pile is empty, show a small "All placed ✓" state. `Next →` is always enabled, but if
  tasks remain unsorted it says `Next (2 unsorted) →`.

Speech bubble, verbatim (khaki `#b9b098`, dark text):
**"Organize them by priority:"** then bullets
`Urgent & Important` · `Important but Not Urgent` · `Urgent but Not Important` ·
`Not Urgent & Not Important`.

### Stage 4 — "Ready to start"

Title: `Ready to start`. The same coloured matrix, now with **labels inside each quadrant**
(bold, top-centre):
- `DO immediately` (red quadrant)
- `PLAN and prioritize` (yellow)
- `DELEGATE for completion` (blue)
- `DELETE these tasks` (gray)

Task card (white, dark border, radius 6px): **checkbox on the left** ("done mark"), title centred,
**clock icon on the right** (gray outline when idle; running timer shows a live mm:ss in accent
colour; finished timer shows the elapsed time in gray). Done tasks: checkbox checked with ✅ feel,
title struck through and dimmed, moved to the bottom of the quadrant.

Bottom of each quadrant: a `…` button that opens a small menu:
`+ Add task here`, `Mark all done`, `Move unfinished to next day`, `Clear done tasks`, and in the
gray quadrant additionally `Delete all tasks here`.

Any unsorted tasks (still `quadrant: null`) are listed in a slim strip above the matrix:
"2 tasks not placed yet — Place them" (link to Stage 3).

Speech bubble, verbatim: **"Done mark ✅"** — light-green pill `#cdf4d3` with green border
`#4cd964`, with a curved arrow/tail pointing at the first task's checkbox.

### Stage 5 — "fast organize"

(The board spells it "fast organaze"; use the corrected `fast organize`.)
Title: `fast organize`. The **same board as Stage 4** (same component, same data). Clicking a
task's **title** opens a **popover** (white card with a tail, positioned under/over the card):
the task title on top, then three large icon buttons in a row:

1. ▶️ (green circle play) — **Start the timer or the countdown**
2. 📅 (calendar) — **Postpone to another day**
3. ⏩ (orange fast-forward) — **Send to the next day's list**

plus a secondary row of small text actions: `Edit`, `Move to ▾` (quadrant), `Delete`.

- **▶️ Start:** shows two choices: `Stopwatch` (count up) or `Countdown` with presets
  `5 · 15 · 25 · 45 · 60 min` and a custom minutes field. Starting sets the task's clock icon live and
  shows a **floating timer bar** at the bottom of the screen (task title, time, `Pause`/`Resume`,
  `Stop`, `Done ✓` which also ticks the task). Only one timer runs at a time — starting another asks
  to stop the current one. Timer state is persisted (`startedAt` + accumulated `elapsedSec`) so it
  survives reloads. A countdown reaching 0 plays a short beep (WebAudio, no asset files), flashes
  the bar, and, if Notification permission was granted, posts a browser notification.
- **📅 Postpone:** a native `<input type="date">` (min = today) → sets `task.date`; the task leaves
  this day's board. Toast: "Moved to Tue 15 Sep" with **Undo**.
- **⏩ Next day:** sets `task.date` to the **next visible day** (next weekday when weekends are hidden,
  otherwise tomorrow). Toast with **Undo**.

The popover also works in Stage 4 (same component); Stage 5 exists so the tip is explained.
Speech bubble, verbatim (dark gray `#5b5b5b`, white text): **"Organize them by priority:"** then
bullets `start the timer or the clock down` · `postpone for another day` ·
`send it to the next day's list`.

## 3. App shell

- **Header:** left — logo mark (a tiny 2×2 coloured matrix glyph) + "Escape the Matrix";
  centre — the **stepper**: 5 numbered dots with short labels `Calendar · Write down · Prioritize ·
  Ready · Organize`, current step highlighted, completed steps ticked, clickable; right — **account
  area**: `Sign in with Google` button (white, Google "G" glyph, "Sign in with Google") or, when
  signed in, avatar + first name + a menu (`Synced ✓ / Syncing… / Offline` status, `Sign out`,
  `Sign out & clear this device`). A `?` icon button re-opens the current stage's tip bubble.
- Under the header, a **day bar**: "Wednesday, 11 March 2026" with a `Today` chip when it is today,
  `‹ day` / `day ›` arrows to move the selected day, and the day's `3/5 done` mini-progress.
- **Free-mode banner** (only when not signed in, dismissible, remembered): "You're in free mode —
  tasks are saved only in this browser. Clearing cookies/site data erases them. Sign in with Google
  to keep them everywhere."
- Stage panels: alternate with a ~250ms slide + fade; respect `prefers-reduced-motion`.
- Toasts bottom-centre (with optional Undo). Modals/popovers close on Escape and outside click.
- Keyboard: `←`/`→` (when no input is focused) go Back/Next; `?` opens the tip.
- **Responsive:** desktop first-class; ≥ 768px the matrix is 2×2; < 640px the matrix stacks into
  one column (quadrant colours and labels preserved) and the calendar cells shrink; touch targets
  ≥ 44px. No horizontal page scroll ever.
- Visual style: clean, light, Figma-like (white background `#fff`, text `#1c1c1e`, gray `#6b6b6b`,
  borders `#333`/`#757575`, radius 8–12px, system font stack: -apple-system, Inter, Segoe UI,
  Roboto, sans-serif). Buttons: primary black-on-white outline with a filled black primary for
  `Next →`. Icons inline SVG (no icon fonts) except the three emoji-style action buttons which may
  be styled SVG/emoji.
- Favicon: inline SVG data-URI of the 2×2 matrix glyph. `<title>Escape the Matrix</title>`.
  Add `<meta name="viewport">`, `theme-color`, Open Graph title/description.

## 4. Data model

```js
// Persisted "document" (both localStorage and Firestore hold exactly this shape)
{
  version: 1,
  updatedAt: "2026-09-11T20:00:00.000Z",
  settings: {
    showWeekends: false,
    bannerDismissed: false,
    tipsSeen: { 1: false, 2: false, 3: false, 4: false, 5: false }   // tip auto-shows first time only
  },
  tasks: [
    {
      id: "t_k3j9x2",                 // random id, generated client-side
      title: "Marketing Order A5",
      date: "2026-03-11",             // YYYY-MM-DD, local calendar day the task belongs to
      quadrant: null,                 // null | 'do' | 'plan' | 'delegate' | 'delete'
      order: 1731350000000,           // number used for ordering within a day/quadrant
      done: false,
      doneAt: null,                   // ISO or null
      createdAt: "...", updatedAt: "...",
      timer: null                     // or { mode:'stopwatch'|'countdown', durationSec, startedAt: ISO|null, elapsedSec, running }
    }
  ]
}
// Per-device UI state (localStorage only, never synced): { selectedDate, stage, calendarMonth }
```

## 5. Core module contracts (everyone codes against these)

### `js/store.js`
```js
export function createStore(initialDoc?)            // returns store
store.get()                                          // current doc (treat as immutable)
store.subscribe(fn)  → unsubscribe                   // fn(doc, {reason})
store.replace(doc)                                   // used by adapters on remote change (no save echo)
store.addTask({ title, date, quadrant = null })      → task
store.updateTask(id, patch)
store.removeTask(id)
store.setQuadrant(id, quadrant)
store.toggleDone(id, done?)
store.moveTaskToDate(id, date)
store.reorderTask(id, order)
store.tasksForDate(date)  → array sorted by (quadrant order do,plan,delegate,delete,null) then done last then order
store.statsForDate(date)  → { total, done }
store.setSetting(key, value)
store.undo() / store.canUndo()                       // single-level undo for remove/move/setQuadrant
// timers
store.startTimer(id, { mode, durationSec })  store.pauseTimer(id)  store.resumeTimer(id)  store.stopTimer(id)
store.activeTimer() → task | null
// persistence
store.attach(adapter)   // adapter: { name, load(): Promise<doc|null>, save(doc): Promise<void>, onRemote?(cb) }
store.mergeDocs(a, b)   // pure: union tasks by id (newer updatedAt wins), settings newest wins → new doc
```
Every mutation stamps `updatedAt` on the task and on the doc, then notifies subscribers and asks the
adapter to save (debounced ~150ms). `replace()` notifies but does not save.

### `js/dates.js`
`todayKey()`, `toKey(date)`, `fromKey(key)`, `addDays(key, n)`, `isWeekend(key)`,
`nextVisibleDay(key, showWeekends)`, `formatLong(key)` → "Wednesday, 11 March 2026",
`formatShort(key)` → "Tue 15 Sep", `monthGrid(year, month, showWeekends)` → 6 rows of keys per §2,
`monthName(month)`.

### `js/ui.js`
`h(tag, attrs, ...children)` DOM builder; `icon(name)` inline SVGs (clock, play, calendar, forward,
check, plus, close, more, chevron-left/right, google, question); `bubble({ text|html, tone:
'khaki'|'green'|'dark', tail: 'top'|'bottom'|'left'|'right', anchor?, onClose })`;
`toast(message, { action?: { label, onClick }, duration })`; `modal({ title, content, actions })`;
`popover({ anchor, content, onClose })`; `confirm(message)`.

### Stage modules `js/stages/*.js`
```js
export function mount(container, ctx)   // ctx = { store, ui, dates, i18n, getDate(), setDate(key), goTo(stage), showTip() }
export function unmount()               // remove listeners/timers
```
`js/app.js` owns the shell, stepper, day bar, routing (`ui.stage` 1–5), tip logic (auto-show once
per stage, `?` re-shows), keyboard shortcuts, and instantiates the store with the local adapter,
then (if `firebaseConfig`) the auth module.

### `js/storage/local.js`
`createLocalAdapter()` — key `escape-the-matrix:v1` (doc) and `escape-the-matrix:ui` (UI state).
Must tolerate a missing/corrupt value and `localStorage` throwing (private mode) → in-memory.

### `js/storage/cloud.js` + `js/auth.js`
Firebase **v10 modular** SDK loaded lazily from
`https://www.gstatic.com/firebasejs/10.14.1/{firebase-app,firebase-auth,firebase-firestore}.js`
only when `firebaseConfig` is non-null. Firestore doc path `users/{uid}` holding `{ doc, updatedAt,
email }`. `onSnapshot` → `store.replace(mergeDocs(local, remote))` (ignore echoes of our own writes
via `hasPendingWrites`). On sign-in: `load()` remote, merge with local, save merged to both. While
signed in, saves go to Firestore **and** localStorage (offline cache). Auth: `GoogleAuthProvider`
with `prompt: 'select_account'`, `signInWithPopup`; if the popup is blocked (`auth/popup-blocked`)
fall back to `signInWithRedirect`. `browserLocalPersistence` so the session persists.

`js/firebase-config.js`: `export const firebaseConfig = null;` with a commented template of the
web-app config object. When null, the "Sign in with Google" button is still rendered; clicking it
opens a modal explaining that Google sign-in is not connected on this deployment yet and that tasks
stay saved in this browser, with a link to `SETUP.md`.

`firestore.rules` (ship it): only `request.auth.uid == uid` may read/write `users/{uid}`.

## 6. File layout & ownership

```
index.html                       core
css/tokens.css  css/base.css     core   (colours, type, shell, stepper, buttons, bubbles, modal, toast, popover)
css/calendar.css                 stage 1
css/dump.css                     stage 2
css/sort.css                     stage 3
css/board.css                    stages 4–5 + timer bar
css/account.css                  auth/account UI
js/app.js js/store.js js/dates.js js/ui.js js/i18n.js js/storage/local.js js/firebase-config.js   core
js/stages/calendar.js            stage 1
js/stages/dump.js                stage 2
js/stages/sort.js                stage 3
js/stages/board.js js/timer.js   stages 4–5
js/storage/cloud.js js/auth.js   cloud + account
firestore.rules  SETUP.md  README.md
tests/  package.json             Playwright e2e (dev only; not deployed)
```
Feature agents own only their files. Core files may receive **small additive edits** (targeted
`Edit`, never a rewrite) when strictly necessary; say so in your report.

## 7. Colours & tokens (from the design board)

```
--red-fill:#ffc7c2  --red:#f24822      --yellow-fill:#ffecbd --yellow:#ffcd29
--blue-fill:#c2e5ff --blue:#3dadff     --gray-fill:#d9d9d9   --gray:#a5a5a5
--green-fill:#66d575 --green-stripe:#4eb25c --green:#3e9b4b   --today:#4da3ff
--tray:#d9d9d9 --border:#757575 --ink:#1c1c1e --muted:#6b6b6b --card-border:#333
--bubble-khaki:#b9b098 --bubble-green:#cdf4d3 --bubble-green-border:#4cd964 --bubble-dark:#5b5b5b
--play:#3fa34d (green circle) --forward:#f28c1f (orange)
```

## 8. Acceptance checklist (verifiers test every line)

1. Fresh load shows Stage 1 with the current month; today is outlined blue; weekends hidden.
2. `Show weekends` toggle adds Sat/Sun columns and persists across reload.
3. Clicking an empty day opens Stage 2 with that date in the day bar.
4. Typing 3 tasks + Enter each creates 3 rows; `+` adds a row; `✕` deletes; reload keeps them.
5. Stage 3 shows the coloured matrix with the 3 tasks piled in the centre; drag (mouse) and tap-to-place both work; keyboard 1–4 works.
6. Stage 4 shows labels DO immediately / PLAN and prioritize / DELEGATE for completion / DELETE these tasks and the tasks in their quadrants with checkbox + clock.
7. Ticking a task strikes it through and Stage 1 shows the green fill at the right ratio.
8. Stage 5 popover: ▶️ starts a countdown (timer bar visible, clock icon live); reload → timer still running; countdown end beeps.
9. 📅 moves the task to the chosen date (visible on that day, gone from this one) with Undo working.
10. ⏩ moves to next weekday when weekends hidden (Fri → Mon), Undo works.
11. `…` menu actions work in each quadrant; "Delete all tasks here" only in gray quadrant.
12. Every speech bubble text from §2 appears on its stage the first time, can be closed, and `?` re-opens it.
13. Stepper and ←/→ keys navigate; transitions animate; reduced-motion disables animation.
14. Free-mode banner shows when signed out, dismisses and stays dismissed.
15. "Sign in with Google" button present; with `firebaseConfig = null` it opens the explanatory modal.
16. With a real config (code review): popup sign-in, merge, live sync, sign-out paths are correct and rules restrict access to the owner.
17. Mobile 375px: no horizontal scroll, matrix stacks, everything reachable; touch drag works.
18. No console errors on any stage; works offline after first load (no network needed in free mode).
19. All asset URLs are relative (works under `/escape-the-matrix/`).
20. Lighthouse-style basics: semantic buttons, focus rings visible, labels for inputs, aria-live for toasts.
