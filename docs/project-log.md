# Levelix — project log

The memory of the project: what was decided, when, and why. Newest entries at the bottom.
Every chat (and every fork) should read this before changing direction; `/memory-update` appends to it.
Public repository — no secrets, passwords, keys or customer data here.

---

## September 2026 — from idea to live app

- **2026-09-12/13** — First build of *Escape the Matrix*: Eisenhower-matrix daily planner, static site with ES
  modules, Playwright + node tests, warm "paper" visual theme (from a Lovable UI study). Board with inline rename,
  drag & drop between quadrants, ✕ delete with undo, carry-over of unfinished tasks, a waiting list.
- **2026-09-13/14** — Owner feedback rounds: three stages (Calendar → Write down → Prioritize) plus a Home page;
  layout alignment fixed by *measuring* (scrollbar gutter) after eyeballed tweaks failed — standing rule since.
- **2026-09-14** — Firebase connected (Google + email sign-in, Firestore `users/{uid}`). Domain **levelix.eu**
  bought at Papaki and pointed at Firebase Hosting. Brand: product name **Levelix**, "Escape the Matrix" as the idea.
- **2026-09-15** — SEO files, pricing on Home: Free up to 100 tasks, Pro €4,80/month (€1,20/week) or €28/year.
- **2026-09-29** — First Stripe code (subscriptions) prepared but not deployed; replaced later by one-off links.

## October 2026 — daily use, payments, accounts

- **Early Oct** — Personal **Apple Reminders bridge** for the owner's Mac (`tools/reminders-bridge`): one list
  "Levelix", two-way sync, priorities map both ways, conflicts ask which side wins, deleted tasks leave nothing.
- **Oct** — Many planner features at the owner's request: date pickers, quick add, waiting list newest-first and
  folding, **Repeat** section with green/red day counters, calendar as one continuous run of weeks, time report with
  editable timings, timer that adds to tracked time and can run two tasks in parallel, tab title shows the timer,
  pull to another day keeps priority and clock, pulled records lock once finished.
- **2026-10-12** — A deleted task leaves no "pulled to…" record behind.
- **2026-10-16** — Opening the app lands on **today** (a reload keeps the day). Done tasks dragged out of a box are
  reopened, not swallowed.
- **2026-10-16/17 — Payments.** Stripe account "Levelix" (descriptor `LEVELIX.EU`), two **one-off** payment links
  (€4,80 month, €28 year, tax inclusive, Terms required, redirect to `/?pro=thanks`). First manual codes, then a
  **webhook** (`stripeWebhook`): signed-in buyers become Pro at once (Go Pro carries the account as
  `client_reference_id`), others get an emailed code; a full refund ends Pro. Emails go from info@levelix.eu
  (Papaki SMTP, DKIM on). Codes carry their end date; Firestore rules accept only that date.
- **2026-10-17** — Legal pages **Support / Privacy / Terms** (seller, address, tax ID, 14-day no-questions refund).
- **2026-10-17 — Own Firebase project.** Everything moved from the old `katopsi-elite` to the new project
  **`levelix`** (site `levelix-app`): accounts kept their uids, Firestore copied 1:1, levelix.eu moved by Hosting
  live migration (Papaki TXT `hosting-site=levelix-app`, www CNAME) with no downtime. The owner deleted the old
  project afterwards.
- **2026-10-17** — Account menu: **Go Pro** chooser (both plans), Sign out with a **gear** for the destructive
  actions, sync status as a dot on the avatar. The owner's manual "Codes" screen removed.
- **2026-10-17/18 — Sign-in methods.** Email + password (sign up, forgot password, change password) next to Google;
  **Sign in with Apple** on the owner's existing Apple Developer team. Go Pro while signed out asks for sign-in
  first. Firebase email templates send as "Levelix", replies to info@levelix.eu (the action-URL domain can't be
  changed on a new project).
- **2026-10-18 — One browser, many accounts.** Found when an Apple sign-in with a hidden email received a copy of
  the Google account's tasks. Now: an account opens with only its own tasks; tasks written signed out wait for
  **Sync** (red blinking dot, Sync in the account card); accounts never mix; sign-out shows a guest board.
- **2026-10-18** — **Connect Apple / Google** and **Delete account** (with `cleanupAccount` removing the account's
  cloud data; sales records stay for tax). Tests moved to port 4317.
- **2026-10-18** (parallel chat) — **Refund from the app** within 14 days (`requestRefund`, v=109); dialogs centred;
  finished tasks stay visible on their day (v=110).
- **2026-10-18 — Verified with a real payment:** €4,80 paid → Pro on instantly → email sent → refund from the app
  → Stripe refunded → bank shows "Refunded, Levelix". Whole flow works live.
- **2026-10-18 — Free limit can't be gamed (v=110).** Idea from the owner: fill 1000 tasks while Pro, then reuse
  them by renaming after Pro ends. Now, on Free above the limit, tasks can only be finished or deleted; renaming,
  moving, re-filing, repeating and reopening wait until the account is back within 100 (store edit guard, one
  message per action). Gear menu: **Connect Google removed** (not needed); red items carry icons (broom = Clear
  account, trash = Delete account, exit arrow = Sign out & clear this device, which is last). The green focus ring
  shows only when moving with the keyboard, never after a click.
- **2026-10-18 — Done history; finished tasks count (v=111).** Owner's decision: on Free the **100 includes finished
  tasks** — they are the history the statistics come from, so making room means deleting them and losing that
  history (the reason to go Pro). New **Done** screen (ticked-list button under Calendar, Write down, Prioritize):
  finished tasks by day, counts for today / 7 / 30 days / all time, tracked time, Free usage bar; delete a task, a
  day or all finished (second press), each with Undo. Limit messages lead to Done and to the plans. Toasts now sit
  above dialogs so Undo works inside them. Terms and Support updated.
- **2026-10-18 — Refund policy page; no account linking (v=112).** The owner saw Refund in the gear of an
  account that got Pro from an unpaid code. Now Refund is a **Refund policy** page (last item of the account menu,
  and Home's footer): the rules, then the server is asked (`requestRefund` with `{ check: true }`) and the
  **Refund** button works only for a real payment within 14 days; otherwise it stays disabled with the reason.
  Connect Apple was removed here too (by mistake — restored in v=113). The webhook now **emails the buyer on a
  refund**; the code email points to Home → "I have a code" (the account menu no longer has it).
- **2026-10-18 — Connect back, plus Switch account (v=113).** The owner had removed Connect thinking it switched
  accounts. Clarified: **Connect** (gear → Connect Apple / Connect Google, whichever the account lacks) adds a second
  way into the *same* account; **Switch account** (main account menu) signs out and opens the sign-in at once, to
  another account whose tasks stay apart. Both kept; Switch account then moved into the gear, first item (v=114).
  Lesson: before removing a feature, explain what it does.
- **2026-10-18/19 — One Firestore document per month (v=115/116).** An account was one document, which tops out at
  1 MiB (~2,300 tasks). Now `users/{uid}` holds settings and `users/{uid}/months/{YYYY-MM|undated}` the tasks; a save
  writes only the months that changed, in one batch. Old accounts move over the first time they are opened (backup
  taken first, on the owner's Mac). Verified on the owner's account: 3 months, every task there.
- **2026-10-19 — Timer from the browser's own controls (v=117).** The owner asked for pause/continue "up in the
  tab". A tab title can't hold a button, so on computers the live timer sits in the browser's media controls
  (Chrome's ⏯ toolbar button, macOS Now Playing, the keyboard's play/pause key) through a silent looping clip. Not
  on phones: playing audio there would stop the user's music. The tab shows "⏸ 02:44 — task" while paused.
- **2026-10-20 — API key limited to our sites.** GitHub flagged the Firebase web API key (it is public by design;
  the September alert was the old, deleted project's key). The key, already limited to Firebase APIs, now works
  only from levelix.eu, www, levelix-app and levelix-b42f1 (web.app / firebaseapp.com); other sites get 403.

- **2026-10-21 — Basic Free and Pro (v=118).** The owner's decision: Free is "Basic Free" (calendar, write down,
  prioritize, up to 100 tasks). The task timer, moving a task to another day, the statistics in Done, the Time
  report and the calendar's All Tasks view are Pro; on Free they show blurred under a "Go Pro for unlimited
  access" card leading to Pricing (and unlock by themselves when Pro arrives). Deleting stays free (it is how room
  is made). Pricing: Basic Free | **Pro yearly in the middle** (ribbon "Save 51%", badge "Best value") | Pro monthly
  (ribbon "Only €1,20 / week"); "No card needed" dropped; a line says prices are final and include VAT (the owner
  confirmed €28 and €4,80 are VAT-inclusive). "Most popular" was not used: no sales data yet to back it (EU rules
  on misleading claims) — can be added once true. The carry strip (pulling unfinished tasks into today) stays Free.

- **2026-10-25 — Timer no longer touches audio (v=122).** The v=117 media controls played a silent clip so
  the browser would show ⏯; on the owner's Mac that pulled his AirPods away from his iPhone, and pressing play there
  paused the Levelix timer. Removed for good: the timer plays nothing (only the countdown chime). The tab title
  still shows the time, with ⏸ when paused. If pause/continue from outside the tab is wanted again, the safe way is
  a small always-on-top window (Document Picture-in-Picture), never audio.
- **2026-10-25 — Waiting list search (Pro, v=122).** A small search field in the waiting list heading, before the
  sort button: filters as you type, ignoring accents, capitals and ς/σ; Escape clears it. On Free it shows with a
  lock and opens the Go Pro card. The timer and move pickers on Free show their options under a "🔒 Pro" badge;
  pressing one brings up Go Pro (v=120).

## Open items

- The owner's main Google account can have **Apple connected**: sign in with Apple → gear → Delete account (the
  duplicate), then sign in with Google → gear → Connect Apple. Two Apple accounts exist (probably two Apple IDs).
- Check that Stripe's own customer emails (payment receipt, refund) are switched on in Stripe → Settings →
  Customer emails, if the owner wants Stripe receipts besides ours.
- VAT / invoices (myDATA) — for the owner's accountant; Stripe Tax monitors thresholds only.
- Ideas mentioned, not built: AI reports, adding tasks by voice (marked "coming soon" on Home).
- Since v=111, Free users who already had many finished tasks may be over 100 at once: nothing is lost, but they
  must delete in Done before adding. Watch for support mail about it.
