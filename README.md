# Escape the Matrix

A daily planner built on the **Eisenhower Matrix** (Urgent / Not urgent × Important / Not
important). Every day you write everything down, sort it into four quadrants, then work the board —
tick things off, start a timer, postpone, or push a task to tomorrow.

It is a static web app: plain HTML, CSS and ES modules, no build step, no frameworks. It runs from
GitHub Pages and works offline in the browser.

**Live app:** <https://a-papadopoulos90i.github.io/escape-the-matrix/>

## The four stages

1. **Calendar** — pick a day in the month view. Each day cell shows one green stripe per task done
   (ten stripes fill the cell); hover a day to see how many there are and how many are done. Today is
   outlined blue. Weekends can be shown or hidden; the week starts on Sunday.
2. **Write down** — brain-dump everything you have for that day, one task per row.
3. **Prioritize** — drag (mouse or touch), tap-to-place, or press `1`–`4` to put each task into a
   quadrant: *Urgent & Important*, *Important but Not Urgent*, *Urgent but Not Important*,
   *Not Urgent & Not Important*. Whatever you leave in the pile stays on the day's **waiting list** —
   with forty things to do you pick the ten that matter today.
4. **Ready** — the board: **DO immediately**, **PLAN and prioritize**, **DELEGATE for completion**,
   **DELETE these tasks**. Tick tasks done; each quadrant has a `…` menu (add here, mark all done,
   move unfinished to next day, clear done, delete all). Click a task title (or its clock) for the
   quick actions: start a stopwatch or countdown, postpone to another day, or send it to the next
   day's list. The waiting list sits under the matrix, and when earlier days still hold unfinished
   tasks a strip offers to **pull them here**: each gets a fresh copy on this day (with a `×3`-style
   badge counting how many times it has been on the plan) while the old day keeps a faded red record
   that no longer counts.

Stages 2–4 reproduce the speech bubbles from the original design word for word (the board carries
two); stage 1 shows a short hint instead. Close a bubble and reopen it any time with the `?` button.

## Free mode vs Google mode

| | Free mode (default) | Google mode |
| --- | --- | --- |
| Sign-in | none | one click, "Sign in with Google" |
| Where tasks live | this browser only (`localStorage`) | your account in Firestore, plus this browser |
| Other devices | no | yes — live sync |
| Clearing cookies / site data | erases your tasks | nothing lost; sign in again |

Google mode needs a one-time Firebase setup by the site owner — see **[SETUP.md](./SETUP.md)**.
Until then the button explains that sign-in is not connected yet. Signing in merges the tasks you
already had in free mode into your account.

## Run it locally

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000/>. (ES modules do not load from `file://`, so a static server is
required; any other one works too.)

## Deploy

Push to `main`. GitHub Pages serves the repository root as-is at
<https://a-papadopoulos90i.github.io/escape-the-matrix/> — all asset URLs are relative, so the
sub-path just works.

## Tests (development only)

```bash
cd tests
npm install                     # once; then: npx playwright install chromium
npm run unit                    # node:test unit tests (store, dates, cloud adapter)
npx playwright test             # end-to-end tests in headless Chromium
npx playwright test e2e.spec.js # just the SPEC §8 acceptance walk (desktop + 375px mobile)
```

## Project layout

```
index.html                 app shell
css/                       tokens, base styles, one file per stage, account UI
js/app.js                  routing, stepper, day bar, tips, keyboard shortcuts
js/store.js                document store (tasks, settings, timers, undo, persistence)
js/stages/                 calendar, dump, sort, board (stages 1–4)
js/carry.js                pulling unfinished tasks forward: strip, ×n badge, records
js/storage/local.js        localStorage adapter (free mode + offline copy)
js/storage/cloud.js        Firestore adapter (Google mode)
js/auth.js                 Google sign-in and the account menu
js/firebase-config.js      Firebase web-app config (null = free mode)
firestore.rules            Firestore security rules (each user reads/writes only their own document)
```

## Credits

Design by **Andreas Papadopoulos**.
