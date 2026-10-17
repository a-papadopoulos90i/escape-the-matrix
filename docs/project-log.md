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

## Open items

- The owner's main Google account still needs **Apple connected**: sign in with Apple → gear → Delete account
  (the duplicate), then *without* pressing "Continue with Apple" again, sign in with Google → gear → Connect Apple.
  Two Apple accounts exist (probably two Apple IDs).
- VAT / invoices (myDATA) — for the owner's accountant; Stripe Tax monitors thresholds only.
- One Firestore document per user tops out around 2,700 tasks (1 MiB).
- Ideas mentioned, not built: AI reports, adding tasks by voice (marked "coming soon" on Home).
