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
3. works the board — Prioritize: files tasks into DO / PLAN / DELEGATE / DELETE, ticks them done,
   and fast-organizes each with a timer, a postpone, or a "send to next day" action (Stage 3).

A task can also carry a **tag** — a priority label. On a waiting card the tag glyphs only label the
task, and tapping its filled priority icon (next to the done circle) **activates the tag**: the card
goes straight into that quadrant (an untagged waiting card's muted tag icon opens the menu instead). On a card already placed in a quadrant, the tag menu files it: another priority moves it
there, and "No priority" returns it to the waiting list.

The 3 stages are shown as **panels ("little windows") that alternate** with a slide/fade
transition, driven by a 3-tab stepper (the board's original stages 4 and 5 were identical, so the
owner merged them). The design board's explanatory **speech-bubble tips were removed at the owner's
request** — no stage shows one, and the header has no "?" button. (The board's texts are kept below
for reference only; they are not rendered.)

Persistence:
- **Free mode (no login):** everything is saved in the browser (`localStorage`). If the user clears
  site data / cookies, the history is gone. A small dismissible banner explains this.
- **Google mode:** one-click "Sign in with Google" (Firebase Auth popup). Data is stored per user in
  Firestore and live-synced across devices. Signing in merges the local free-mode data into the
  account.

Deployment: static site, **no build step**, plain ES modules, served from GitHub Pages under a
sub-path (so all URLs must be relative: `./js/app.js`, `./css/base.css`). Every release bumps `?v=N` on the stylesheets, `app.js` and an **import map** listing every module, so no browser runs a new `app.js` against stale cached modules.

UI language: English (the design board is in English). All strings live in `js/i18n.js`.
Product name is always written **Escape the Matrix**.

## 2. The four stages (from the design board — reproduce faithfully)

Common: each stage panel shows just its title (large) — the small "Stage N" kicker was removed at
the owner's request; the tabs at the top are the only stage indicator.
Bottom of each panel: `← Back` and `Next →` buttons (Stage 1 has no nav; Stage 3 has "Back to
calendar" instead of Next), and **between them, centred, a day switcher** — the open day (e.g.
"Wed 11 Mar") with discreet `‹` `›` arrows that step to the previous / next day in place (the shell
re-mounts the stage for the new day). It shows on Stages 2, 3 and 4. The stepper at the top also
allows direct jumps. On a narrow screen the day switcher sits on its own centred row above
Back / Next.

### Stage 1 — "Pick your day"

Title: `Pick your day` (the displayed month shows in the toolbar label, e.g. "March 2026").
Controls: `‹` previous month, `›` next month, and the **"All Tasks"** flip toggle (see Manage mode).
There is no separate "Today" button (removed at the owner's request), **no "Show weekends" toggle** and
**no Back/Next nav** on this stage (removed at the owner's request): you advance simply by picking a
day. The calendar **scrolls vertically**: a **`Show next month`** button appends the following month
below (no popup, no resizing — the page just scrolls).

Grid: the **full week is always shown, Sun–Sat** (7 columns; the owner's week starts on Sunday).
Always **6 rows**. The first row is the week that contains the 1st of the month (e.g. March 2026
starts on Sunday 1 March, so the grid runs Mar 1–7, 8–14, …, 29–31 + Apr 1–4, Apr 5–11). Days from
the next month show only their number, same styling.

Cell design (rounded square, ~1:1, number centred, bold):
- **No tasks:** gray border `#757575` (1.5px), white top, a light-gray "tray" `#d9d9d9` filling the
  bottom ~45%.
- **Has tasks:** green border `#3e9b4b`, and **one green stripe per done task rising from the
  bottom** — the cell has ten stripe slots, so ten done tasks fill it completely and more than ten
  still show ten (the tooltip keeps the real counts). Each stripe is a tenth of the cell, colour
  `#66d575` with a `#4eb25c` line between stripes. **Green means done:** a day turns green only once
  at least one task on it is completed. A day with tasks but nothing done yet shows the plain gray
  tray (like an empty day); the tooltip still reports "0 of N done".
- **Today:** blue border `#4da3ff` (2px) regardless of tasks; if it has tasks, show the fill too.
- **Selected day** (the day currently open in stages 2–3): subtle blue glow/ring.
- Hover/focus: tooltip/`title` "3 of 5 done" (or "No tasks yet").
- Click/Enter on a cell → selects that date, then: **today opens Stage 2 (Write down)** — you
  brain-dump the day first — and **every other day (past or future) opens Stage 3 (Prioritize)**
  straight away, whether or not it has tasks. The tabs reach any stage from there.

The colour key (green = done tasks, one stripe each up to 10 · blue = today · gray = empty) is not
printed under the grid: a discreet **ⓘ** in the toolbar opens it in a small popover. Beside the legend, a subtle **"demo version"** link fills this browser with a
two-month sample (mostly-done past days → a green calendar, plus a few backlog items) after a
confirm — local only, nothing uploaded; it replaces what's saved in this browser. The **"See an
example"** label (small, muted, no underline) sits on its own line low on the page. The first time
the calendar shows after the site opens, the logo's four colours (red, yellow, blue, grey) sweep
across its letters one after another for 15s (off with reduced motion). **Signed-in users never see
the link.**

The **Time report** is a round clock button on **Write down and Prioritize**, always the **last
thing on the page, centred under every task** (one app-level button after the stage; on a short page
it rests at the bottom, and it moves down as tasks are added, so it never covers one; hidden on Home
and the calendar). It opens a modal that sums each
task's tracked timer time across every day it appeared and lists them most-time-first with a running
total. Tasks carried forward under the same title are aggregated (each day's copy keeps its own
elapsed seconds) and badged **×N** for the number of days tracked. Tasks with no timer, or zero
tracked time, are omitted; when nothing has been tracked the modal explains where time comes from.

**Manage mode (flip).** An **"All Tasks"** toggle in the toolbar flips the calendar over — each day
cell turns over on its own in a quick staggered wave (not the whole board as one sheet). Flipped,
each cell previews the day's task titles (trimmed, done ones struck) instead of the green fill, and
tapping a day opens a **day popup** — add a task, rename, tick done, delete — plus an **"Open day →"**
button that jumps into that day's stage. Toggling back ("Back to calendar") returns to the normal
view where a tap opens the day directly.

### Stage 2 — "Write it all down"

Title: `Write it all down`. Subtitle: "Don't judge, don't sort. Just get everything out of your head."

Layout (Lovable-style): a single rounded **"What's on your mind?"** field with a pencil glyph and a
green **Add** button; Enter or Add commits, the field clears and keeps focus. Below, the **global
backlog** — a **numbered list** of every unplaced task, each row a rounded card with a number circle,
the (inline-editable) title and a red **✕** (delete, with Undo). At the bottom, when earlier days
hold unfinished **placed** tasks, a **"Pull them here"** button and a **scrollable list** of those
tasks — pulling carries them into the backlog. `Next →` needs ≥ 1 backlog item.

**The waiting list is one global backlog** (see Stage 3). Writing a task adds it there
(`quadrant: null`); the same list shows on Stage 2 and Stage 3, on **every** day, and each
item stays until it is placed in a quadrant, ticked done, or deleted.

Speech bubble (tip), verbatim: **"Write down everything you have for today — all of it!"**
(bubble style: rounded, khaki-gray `#b9b098` background, dark text, small tail pointing at the
task rows).

### Stage 3 — "Place them by priority"

Title: `Place them by priority`. (The old separate "Prioritize" tag-list stage was removed at the
owner's request: this board *is* Prioritize, and there are three stages in all.) The coloured quadrant cards, each with an **icon tile** (the exact Lovable
Lucide glyphs: flame / star / users / trash), a bold **label** and a small **subtitle**, plus a
live **count badge** (owner adopted the Lovable names):
- `Do now` — *Urgent & Important* (red, flame)
- `Schedule` — *Important but Not Urgent* (yellow, star)
- `Delegate` — *Urgent but Not Important* (blue, users)
- `Drop` — *Not Urgent & Not Important* (gray, trash)

Task card, controls left→right: **circular checkbox** ("done mark"), a **priority icon** (the
quadrant's coloured glyph before the title — click it to change the task's priority via a small
menu), the title (click → rename in place), a **clock** (opens the timer picker), a **⏩** (opens the
schedule picker), and a **red ✕** (deletes at once, with an Undo toast). Done tasks: checkbox checked, title struck through and
dimmed, moved to the bottom. The count badge in each quadrant header is a plain number (no pill).

Bottom of each quadrant: a single **`+`** button that adds a task straight into that quadrant
(inline row). The old `…` menu (mark all done / move unfinished / clear done / delete all) was
removed at the owner's request.

Any unsorted tasks (still `quadrant: null`) are listed in a slim strip above the matrix:
"2 tasks not placed yet — Place them" (link to Stage 3).

Speech bubble, verbatim: **"Done mark ✅"** — light-green pill `#cdf4d3` with green border
`#4cd964`, with a curved arrow/tail pointing at the first task's checkbox.

### Stage 3, continued — fast organize, the waiting list and pulling tasks forward

(The board's last two design-board stages were identical, so the owner merged them; their actions
live on this stage.) Every action is its own card control, each opening a small popover panel:

- **Clock → timer picker:** `Count up` (a stopwatch) or `Countdown` with presets `5 · 15 · 25 · 45 ·
  60 min` + a custom-minutes field. If the task already has time on the clock (paused or stopped), a
  green **`Continue mm:ss`** button appears on top and resumes from the accumulated time, so a
  stopped timer's time is never lost (only one timer runs at a time; continuing another asks first).
- **⏩ → schedule picker:** a **`Next day`** button on top (sends to the next visible day) and a
  **`Postpone`** section below with a calendar (`<input type="date">`, min = today) + `Set` — laid
  out like the timer picker.
- **Title → rename in place:** the title turns into an input (Enter/blur saves, Escape cancels).
- **Red ✕ → delete** (with Undo). **Move** is **drag & drop** between quadrants.

Each picker shows the editable title at the top. Cards are **draggable between quadrants** with
Pointer Events (mouse and touch; a plain click still opens a picker, a press-and-drag — or a touch
long-press — lifts the card; dropping on a quadrant re-files it, dropping on the waiting list
unplaces it). A wide waiting-list card shrinks, while dragged, to the width of a card inside a quadrant.

- **Timer start:** two choices: `Stopwatch` (count up) or `Countdown` with presets
  `5 · 15 · 25 · 45 · 60 min` and a custom minutes field. Starting sets the task's clock icon live and
  shows a **floating timer bar** at the bottom of the screen (task title, time, `Pause`/`Resume`,
  `Stop`, `Done ✓` which also ticks the task). Only one timer runs at a time — starting another asks
  to stop the current one. Timer state is persisted (`startedAt` + accumulated `elapsedSec`) so it
  survives reloads. A countdown reaching 0 plays a short beep (WebAudio, no asset files), flashes
  the bar, and, if Notification permission was granted, posts a browser notification.
- **📅 Postpone:** a native `<input type="date">` (min = today) → sets `task.date`; the task leaves
  this day's board. Toast: "Moved to Tue 15 Sep" with **Undo**.
- **⏩ Next day:** sets `task.date` to the **next weekday**, skipping weekends (a Friday task goes to
  Monday). Weekends still show on the calendar; this only affects where the one-tap action lands.
  Toast with **Undo**.

On a card **placed in a quadrant**, the tag button opens a 5-option menu that also files the card:
picking another priority moves it into that quadrant (labelled to match), and **No priority** sends
it back to the waiting list with no label.

Each waiting card shows, left to right: the done tick, its **priority tag** (the label, filled in the
quadrant's colour), the title, the four tag glyphs, and the red ✕. **The glyphs only tag** — tap one
to label the task, tap the active one again to clear it. They never file the task into a quadrant:
that is done by dragging the card onto one (or by a quadrant's `+`, which creates a task there
already carrying that quadrant's tag).

**Waiting list — one global backlog.** Every unplaced task (`quadrant: null`) lives in a single
backlog shared across **all** days and shown on Stages 2, 3 and 4 (under the matrix in a
"Waiting list (N)" panel, the **same width as the matrix**). An item stays in the backlog until it is
**placed** in a quadrant (which assigns it to the day you place it on), **ticked done**, or
**deleted** — done or deleted removes it from the list. Because the backlog belongs to no single day,
the **calendar counts only placed tasks**. Each waiting card has its own **checkbox** (tick it to
complete and drop it from the backlog), the title (rename), a row of **four small colour-coded
glyphs** (Do now / Schedule / Delegate / Drop) that place it into that quadrant on the open day, and
the **red ✕**. On a device with a pointer the glyph row and the ✕ stay hidden until the card is
hovered or focused (touch devices always show them). They are on hold: the `Next →` button on Stage 3
carries the "· N waiting" count.

**Pulling unfinished tasks forward.** Pull carries forward only **committed, unfinished work** —
tasks that were **placed in a quadrant** (`do` / `plan` / `delegate`) on an earlier day and are not
done. It never pulls a task still sitting in a **waiting list** (`quadrant === null`), nor one in
**DELETE** (Drop), nor a record already pulled. So a task you merely wrote and left unsorted stays on
its own day, and — because a pulled copy lands in the waiting list — once something is in a waiting
list it is never pulled again. When such tasks exist on earlier days, stages 2 and 4 show a strip
"N unfinished tasks left on Mon 9 Mar, Tue 10 Mar — Pull them here"; you can go days without pulling
and then pull everything at once. Pulling gives each task a **fresh copy on this day** (in the
waiting list) and leaves the original on its day as a **record**: faded red, "Pulled to Thu 12 Mar",
nothing to tick or start, and **not counted** anywhere. Each task carries `attempt`, the number of
times it has been on a plan; a copy shows a red `×3` badge ("3rd time on the plan") so the owner
sees how often a task has been carried. One toast with Undo reverts the whole pull.

Second speech bubble of the stage, verbatim (dark gray `#5b5b5b`, white text, in the flow under
the header): **"Organize them by priority:"** then bullets `start the timer or the clock down` ·
`postpone for another day` · `send it to the next day's list`.

## 3. App shell

- **Header:** left — logo mark (a tiny 2×2 coloured matrix glyph) + "Escape the Matrix";
  centre — the **stepper**: 4 icon dots with short labels `Calendar · Write down · Prioritize ·
  Ready` — one themed icon per stage (calendar, pencil/note-keeping, 2×2 grid/organizing,
  play/executing), current step highlighted, clickable; right — a **gear (Settings)** button (opens
  the Time report menu) and the **account area**: `Sign in with Google` button (white, Google "G" glyph, "Sign in with Google") or, when
  signed in, avatar + first name + a menu (`Synced ✓ / Syncing… / Offline` status, `Sign out`,
  `Sign out & clear this device`). A `?` icon button re-opens the current stage's tip bubble.
- There is **no day bar** (removed at the owner's request): the day is chosen on the calendar.
  Stage panels show no date line.
- **Home** (the logo; not a stepper tab, no tab highlighted, remembered like a tab): a short hero
  ("A minimal daily planner…", `Open the calendar`), **How it works** — the three
  steps, each a title + one sentence beside a real screenshot (`assets/home/*.webp`), sides
  alternating, stacked on phones; clicking a screenshot opens that step — then **Our purpose** as a four-panel illustrated mini story (A full head → Write it down → Focus on the few → Room for life),
  **Free, for everyone** (non-profit upkeep for now, future revenue funds it; a studio quote — one short phrase, what it means in practice, signed PanTik.io with an account-style avatar; `QUOTES` in home.js takes more) and a small as-is / no-professional-advice disclaimer. Wording stays neutral.
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
      quadrant: null,                 // null | 'do' | 'plan' | 'delegate' | 'delete' — WHERE it sits on a day's board
      tag: null,                      // null | 'do' | 'plan' | 'delegate' | 'delete' — the priority LABEL (Stage 3)
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
`js/app.js` owns the shell, stepper, routing (`ui.stage` 1–4), tip logic (auto-show once
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
--red-fill:#fdede8  --red:#d13e38      --yellow-fill:#fef2de --yellow:#e1901f
--blue-fill:#e8f4fb --blue:#2382ba     --gray-fill:#f5f3ed   --gray:#877f73
--green-fill:#79d3a1 --green-stripe:#2ba162 --green:#1f8f57  --today:#3d8bff
--tray:#eceae1 --border:#e2ded3 --ink:#241e16 --muted:#6f685c --card-border:#d9d4c8
--bg:#f8f7f1 --surface:#fefdfa --surface-2:#f2f0e7 --primary:#005c44 --primary-fg:#fbfaf6
--bubble-khaki:#b9b098 --bubble-green:#cdf4d3 --bubble-green-border:#4cd964 --bubble-dark:#33302a
--play:#2ba162 (green circle) --forward:#e1901f (orange)
--font: "Figtree" (body)   --font-display: "Outfit" (headings)
```

Quadrant cards (stage 3) carry an icon tile (flame / star / people / trash), the quadrant name as
a subtitle and a live count badge. Calendar cells: number top-left, one green stripe per done task
rising from the bottom (ten fill the cell). Buttons are pill-shaped; the primary is deep green.

## 8. Acceptance checklist (verifiers test every line)

1. Fresh load shows Stage 1 with the current month; today is outlined blue; the full week (Sun–Sat) is shown; no weekends toggle and no Back/Next on this stage.
2. The calendar always shows all seven columns; a weekend day is on the grid and reachable.
3. Clicking today opens Stage 2; clicking any other day opens Stage 3 for that date.
4. Typing 3 tasks + Enter each creates 3 rows; `+` adds a row; `✕` deletes; reload keeps them.
5. A card's tag button labels the task (the glyph fills with the quadrant colour); the label never moves the card or changes its date.
6. Stage 3 shows labels Do now / Schedule / Delegate / Drop (with icon tiles + count badges) and the tasks in their quadrants with checkbox + clock + red ✕.
7. Ticking a task strikes it through and Stage 1 shows one green stripe per done task (ten fill the cell).
8. Stage 3 popover: ▶️ starts a countdown (timer bar visible, clock icon live); reload → timer still running; countdown end beeps.
9. 📅 moves the task to the chosen date (visible on that day, gone from this one) with Undo working.
10. ⏩ moves the task to the next weekday, skipping weekends (Fri → Mon), Undo works.
11. `…` menu actions work in each quadrant; "Delete all tasks here" only in gray quadrant.
12. No speech-bubble tips appear on any stage, and there is no "?" button (tips were removed).
13. Stepper and ←/→ keys navigate; transitions animate; reduced-motion disables animation.
14. Free-mode banner shows when signed out, dismisses and stays dismissed.
15. "Sign in with Google" button present; with `firebaseConfig = null` it opens the explanatory modal.
16. With a real config (code review): popup sign-in, merge, live sync, sign-out paths are correct and rules restrict access to the owner.
17. Mobile 375px: no horizontal scroll, matrix stacks, everything reachable; touch drag works.
18. No console errors on any stage; works offline after first load (no network needed in free mode).
19. All asset URLs are relative (works under `/escape-the-matrix/`).
20. Lighthouse-style basics: semantic buttons, focus rings visible, labels for inputs, aria-live for toasts.
