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
4. works the board: DO / PLAN / DELEGATE / DELETE, ticking tasks done, and fast-organizes each
   task with a timer, a postpone, or a "send to next day" action (Stage 4).

The 4 stages are shown as **panels ("little windows") that alternate** with a slide/fade
transition, driven by a 4-step stepper (the board's original stages 4 and 5 were identical, so the
owner merged them). Every explanatory **speech bubble from the design board
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

## 2. The four stages (from the design board — reproduce faithfully)

Common: each stage panel has a heading "Stage N" (small, gray) and the stage title (large).
Bottom of each panel: `← Back` and `Next →` buttons (Stage 1 has no Back; Stage 4 has "Back to
calendar" instead of Next). The stepper at the top also allows direct jumps.

### Stage 1 — "calendar of the month March"

Title: `calendar of the month {Month}` (Month = the month currently displayed, e.g. "March").
Controls: `‹` previous month, `›` next month, `Today` button, and a `Show weekends` toggle (default
**off**, persisted in settings).

Grid: rows of weekdays, **Mon–Fri when weekends are hidden** (5 columns, like the design), **Sun–Sat
when shown** (the owner's week starts on Sunday). Always **6 rows**. The first row is the week that contains the 1st of the month, except
when the 1st falls on a hidden weekend day, in which case start with the following Monday (this
exactly reproduces the design: March 2026 starts on Sunday, so the grid shows Mar 2–6, 9–13, 16–20,
23–27, 30–31 + Apr 1–3, Apr 6–10). Days from the next month show only their number, same styling.

Cell design (rounded square, ~1:1, number centred, bold):
- **No tasks:** gray border `#757575` (1.5px), white top, a light-gray "tray" `#d9d9d9` filling the
  bottom ~45%.
- **Has tasks:** green border `#3e9b4b`, and **one green stripe per done task rising from the
  bottom** — the cell has ten stripe slots, so ten done tasks fill it completely and more than ten
  still show ten (the tooltip keeps the real counts). Each stripe is a tenth of the cell, colour
  `#66d575` with a `#4eb25c` line between stripes. A day with tasks but 0 done shows the green
  border with a thin green base line so it is visibly "planned".
- **Today:** blue border `#4da3ff` (2px) regardless of tasks; if it has tasks, show the fill too.
- **Selected day** (the day currently open in stages 2–4): subtle blue glow/ring.
- Hover/focus: tooltip/`title` "3 of 5 done" (or "No tasks yet").
- Click/Enter on a cell → selects that date and goes to **Stage 2 if the day has no tasks**,
  otherwise **Stage 4**.

Legend under the grid (small): green = done tasks (one stripe each, up to 10), blue = today,
gray = empty.

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
- The pile is the day's **waiting list** (captioned so): whatever the user leaves there stays on
  hold for the day — with forty things to do they pick the ten that matter. When the pile is empty,
  show a small "All placed ✓" state. `Next →` is always enabled; with tasks still waiting it says
  `Next (2 waiting) →`.

Speech bubble, verbatim (khaki `#b9b098`, dark text):
**"Organize them by priority:"** then bullets
`Urgent & Important` · `Important but Not Urgent` · `Urgent but Not Important` ·
`Not Urgent & Not Important`.

### Stage 4 — "Ready to start"

Title: `Ready to start`. The coloured quadrant cards, each with an **icon tile** (the exact Lovable
Lucide glyphs: flame / star / users / trash), a bold **label** and a small **subtitle**, plus a
live **count badge** (owner adopted the Lovable names):
- `Do now` — *Urgent & Important* (red, flame)
- `Schedule` — *Important but Not Urgent* (yellow, star)
- `Delegate` — *Urgent but Not Important* (blue, users)
- `Drop` — *Not Urgent & Not Important* (gray, trash)

Task card, controls left→right: **circular checkbox** ("done mark"), the title (click → rename in
place), a **clock** (opens the timer picker), a **⏩** (opens the schedule picker), and a **red ✕**
(deletes at once, with an Undo toast). Done tasks: checkbox checked, title struck through and
dimmed, moved to the bottom. The count badge in each quadrant header is a plain number (no pill).

Bottom of each quadrant: a single **`+`** button that adds a task straight into that quadrant
(inline row). The old `…` menu (mark all done / move unfinished / clear done / delete all) was
removed at the owner's request.

Any unsorted tasks (still `quadrant: null`) are listed in a slim strip above the matrix:
"2 tasks not placed yet — Place them" (link to Stage 3).

Speech bubble, verbatim: **"Done mark ✅"** — light-green pill `#cdf4d3` with green border
`#4cd964`, with a curved arrow/tail pointing at the first task's checkbox.

### Stage 4, continued — fast organize, the waiting list and pulling tasks forward

(The board's stage 5 "fast organaze" was identical to stage 4, so the owner merged them; its
actions live on stage 4.) Every action is its own card control, each opening a small popover panel:

- **Clock → timer picker:** `Stopwatch` (count up) or `Countdown` with presets `5 · 15 · 25 · 45 ·
  60 min` + a custom-minutes field.
- **⏩ → schedule picker:** a **`Next day`** button on top (sends to the next visible day) and a
  **`Postpone`** section below with a calendar (`<input type="date">`, min = today) + `Set` — laid
  out like the timer picker.
- **Title → rename in place:** the title turns into an input (Enter/blur saves, Escape cancels).
- **Red ✕ → delete** (with Undo). **Move** is **drag & drop** between quadrants.

Each picker shows the editable title at the top. Cards are **draggable between quadrants** with
Pointer Events (mouse and touch; a plain click still opens a picker, a press-and-drag — or a touch
long-press — lifts the card; dropping on a quadrant re-files it, dropping on the waiting list
unplaces it).

- **Timer start:** two choices: `Stopwatch` (count up) or `Countdown` with presets
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

**Waiting list (the 5th category).** Tasks left unplaced on stage 3 (`quadrant: null`) are listed
under the matrix in a "Waiting list (N)" panel. Each waiting card has its own **checkbox** (so it
can be completed in place — a done waiting task stays here, struck through, and still counts in the
day total), the title (rename), a row of **four small colour-coded glyphs** (Do now / Schedule /
Delegate / Drop) that file it straight into that quadrant, and the **red ✕**. They are on hold: the
day bar shows "· N waiting" next to the done count.

**Pulling unfinished tasks forward.** When earlier days still hold unfinished tasks (not done, not
in DELETE, not already pulled), stages 2 and 4 show a strip "N unfinished tasks left on Mon 9 Mar,
Tue 10 Mar — Pull them here". Pulling gives each task a **fresh copy on this day** (in the waiting
list) and leaves the original on its day as a **record**: faded red, "Pulled to Thu 12 Mar",
nothing to tick or start, and **not counted** anywhere. Each task carries `attempt`, the number of
times it has been on a plan; a copy shows a red `×3` badge ("3rd time on the plan") so the owner
sees how often a task has been carried. One toast with Undo reverts the whole pull.

Second speech bubble of the stage, verbatim (dark gray `#5b5b5b`, white text, in the flow under
the header): **"Organize them by priority:"** then bullets `start the timer or the clock down` ·
`postpone for another day` · `send it to the next day's list`.

## 3. App shell

- **Header:** left — logo mark (a tiny 2×2 coloured matrix glyph) + "Escape the Matrix";
  centre — the **stepper**: 4 numbered dots with short labels `Calendar · Write down · Prioritize ·
  Ready`, current step highlighted, completed steps ticked, clickable; right — **account
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
      timer: null,                    // or { mode:'stopwatch'|'countdown', durationSec, startedAt: ISO|null, elapsedSec, running }
      attempt: 1,                     // how many times the task has been on a day's plan (copies pulled forward get +1)
      carriedTo: null,                // date the task was pulled to → this copy is a record (faded red, not counted)
      carriedFrom: null               // id of the record this copy was pulled from
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
store.statsForDate(date)  → { total, done, waiting }   // records (carriedTo set) are left out
store.unfinishedBefore(date) → unfinished, un-pulled, non-DELETE tasks on earlier days
store.carryOver(ids, date) → undo token; copies to `date` (attempt + 1) and marks originals as records
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
`js/app.js` owns the shell, stepper, day bar, routing (`ui.stage` 1–4), tip logic (auto-show once
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

## 7. Colours & tokens (warm "paper" palette — the Lovable UI study)

The visual system was refreshed from the owner's Lovable design (warm cream ground, deep-green
primary, soft tinted quadrant cards with icon tiles, rounded corners, soft layered shadows). The
board's original saturated fills were softened to tints. Type: **Outfit** (display headings) +
**Figtree** (body), self-hosted as variable woff2 under `fonts/` (so the app stays offline-capable
and works under a sub-path — no external font requests). Full source in `css/tokens.css`.

```
--red-fill:#ffe6e1  --red:#d13e38      --yellow-fill:#ffefd1 --yellow:#e1901f
--blue-fill:#ddf2ff --blue:#2382ba     --gray-fill:#f0eee9   --gray:#877f73
--green-fill:#79d3a1 --green-stripe:#2ba162 --green:#1f8f57  --today:#3d8bff
--tray:#eceae1 --border:#e2ded3 --ink:#241e16 --muted:#6f685c --card-border:#d9d4c8
--bg:#f8f7f1 --surface:#fefdfa --surface-2:#f2f0e7 --primary:#005c44 --primary-fg:#fbfaf6
--bubble-khaki:#b9b098 --bubble-green:#cdf4d3 --bubble-green-border:#4cd964 --bubble-dark:#33302a
--play:#2ba162 (green circle) --forward:#e1901f (orange)
--font: "Figtree" (body)   --font-display: "Outfit" (headings)
```

Quadrant cards (stage 4) carry an icon tile (flame / star / people / trash), the quadrant name as
a subtitle and a live count badge. Calendar cells: number top-left, one green stripe per done task
rising from the bottom (ten fill the cell). Buttons are pill-shaped; the primary is deep green.

## 8. Acceptance checklist (verifiers test every line)

1. Fresh load shows Stage 1 with the current month; today is outlined blue; weekends hidden.
2. `Show weekends` toggle adds Sat/Sun columns and persists across reload.
3. Clicking an empty day opens Stage 2 with that date in the day bar.
4. Typing 3 tasks + Enter each creates 3 rows; `+` adds a row; `✕` deletes; reload keeps them.
5. Stage 3 shows the coloured matrix with the 3 tasks piled in the centre; drag (mouse) and tap-to-place both work; keyboard 1–4 works.
6. Stage 4 shows labels Do now / Schedule / Delegate / Drop (with icon tiles + count badges) and the tasks in their quadrants with checkbox + clock + red ✕.
7. Ticking a task strikes it through and Stage 1 shows one green stripe per done task (ten fill the cell).
8. Stage 4 popover: ▶️ starts a countdown (timer bar visible, clock icon live); reload → timer still running; countdown end beeps.
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
