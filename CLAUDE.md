# Levelix — working notes for Claude

Read this first in every chat. The history behind it — every decision, with dates — is in
[`docs/project-log.md`](docs/project-log.md); read it when a question touches past decisions.
When the owner types `/memory-update`, record what the chat decided there (see `.claude/commands/memory-update.md`).

This repository is **public**. Never write secrets, passwords, keys, customer emails or other personal data
into it — in code, docs, commits or logs.

## How to work with the owner

- **Andreas Papadopoulos** (studio PanTik), not a developer by trade. **Reply in Greek**, plainly.
- He wants autonomous delivery: build it, test it, commit, deploy live, then report. Ask only when a choice
  is genuinely his (money, accounts, deleting things, what the product should do).
- **Measure, don't eyeball** layout: probe `getBoundingClientRect()` in the real browser, fix the one cause,
  report before/after numbers. Keep small fixes small.
- Before removing a feature he asks to drop, say in one line what it does — he once removed Connect thinking it
  switched accounts.
- Things only he does: payments with his card, entering passwords/keys/secrets (`firebase functions:secrets:set`,
  the Apple `.p8`), deleting accounts or projects, DNS edits at Papaki (the auto-mode classifier blocks them).
- Reading his Gmail through the connector is blocked by the auto-mode classifier; to check what Levelix emailed,
  read the function logs (`$FB functions:log`) instead.
- Don't touch his other projects (another Vite preview often holds port 4173).

## The product

**Levelix** — https://levelix.eu — a daily planner on the Eisenhower matrix. "Escape the Matrix" is the idea,
not the name. Three stages: **Calendar → Write down → Prioritize**, plus **Home** (logo) with pricing.
Pages: `support.html`, `privacy.html`, `terms.html` (clean URLs `/support` etc.). `SPEC.md` is the product spec.

- **Free**: up to 100 tasks, **finished ones included** (they are the history; room is made by deleting, e.g. in
  the **Done** screen). Above 100 (Pro ended) tasks can only be finished or deleted until back within the limit. **Pro**: €4,80 / month or €28 / year, **one-off** (no auto-renewal),
  14-day full refund. Codes exist only as a fallback the webhook emails to buyers who paid signed out.

## Code

- Static site, **no build step**: plain HTML/CSS/ES modules, an import map in `index.html`.
- Every release bumps `?v=N` everywhere in `index.html`: `sed -i '' 's/?v=OLD/?v=NEW/g' index.html`
  (and keep the import map valid JSON — no trailing comma).
- Key modules: `js/store.js` (immutable doc, tombstones, `mergeDocs`, undo), `js/stages/*.js`, `js/auth.js`
  (accounts, account menu, sign-in dialog), `js/billing.js` + `js/billing-links.js` + `js/plan.js` (Pro),
  `js/storage/local.js` (browser copy, owner + stashes), `js/storage/cloud.js` (Firestore `users/{uid}`),
  `js/history.js` (Done screen), `js/report.js` (Time report).
- Focus rings show only after keyboard navigation (`kbd-nav` class on `<html>`, set in `js/app.js`).
- Cloud Functions in `functions/` (Node 22, europe-west1): `stripeWebhook`, `cleanupAccount`, `requestRefund`.
  Pure logic is split out (`logic.js`, `webhook.js`, `account.js`, `refund.js`) and unit-tested. The webhook emails
  the buyer on a purchase ("Levelix Pro is on" or the code) and on a refund, with a copy to info@levelix.eu.
- Personal Apple Reminders bridge for the owner's Mac: `tools/reminders-bridge/` (opt-in `?reminders=on`).

## Tests and release

```
cd tests && npm run unit && npx playwright test     # Playwright serves on port 4317
```

Then commit (end messages with the attribution line the harness gives), `git push origin main`, and deploy:

```
FB=/Users/traveller/.npm/_npx/7750544ccf494d8b/node_modules/.bin/firebase   # no firebase on PATH
$FB deploy --only hosting            # site
$FB deploy --only functions          # when functions/ changed
$FB deploy --only firestore:rules    # when firestore.rules changed
```

GitHub Pages also builds from `main`, but **levelix.eu is Firebase Hosting** — pushing alone changes nothing live.
Check: `curl -s https://levelix.eu/ | grep -o 'v=[0-9]*' | head -1`.

## Infrastructure (names only — no secrets)

- **Firebase project `levelix`** (Blaze, 5 € spend caps), hosting site **`levelix-app`** behind levelix.eu and www
  (redirect). Firestore eur3. Auth: Google, Apple, email/password. Default auth domain `levelix-b42f1.firebaseapp.com`
  (the site name `levelix` was taken by the old project); `authDomain` follows the visitor's host.
  The web API key in `js/firebase-config.js` is public by design (GitHub's secret alerts about it are expected);
  it is limited to Firebase APIs and to the sites levelix.eu, www, levelix-app.web.app/.firebaseapp.com and
  levelix-b42f1.web.app/.firebaseapp.com — **a new domain must be added to the key** (Cloud console → Credentials).
- **DNS at Papaki**: A `199.36.158.100`, TXT `hosting-site=levelix-app`, www CNAME `levelix-app.web.app.`, mail
  `securemail.pro` (info@levelix.eu, DKIM on).
- **Stripe** account "Levelix", descriptor `LEVELIX.EU`; payment links in `js/billing-links.js`; event destination
  `levelix-pro` → `https://europe-west1-levelix.cloudfunctions.net/stripeWebhook`. Secrets in Secret Manager:
  `STRIPE_WEBHOOK_SECRET`, `SMTP_PASSWORD` (set by the owner). Plain settings in `functions/.env` (gitignored).
- **Apple**: Services ID `eu.levelix.signin` (App ID `eu.levelix.app`); private-relay email sources registered.

## Account behaviour (decided with the owner)

- An account opens with **only its own** tasks. Tasks written signed out wait in the browser: the avatar dot turns
  red and blinks, and **Sync** in the account card moves them in after a confirmation.
- Two accounts on one browser never mix (the browser copy has an owner; others are set aside). Sign out shows a
  guest board; "Sign out & clear this device" removes everything local.
- Main account menu: Go Pro, Sign out + gear. Gear: **Switch account** (signs out, opens the sign-in: another account,
  tasks apart), **Connect Apple / Connect Google** (whichever the account lacks — a second way into the *same*
  account), Change password (email accounts), then red items with icons: Clear account (broom), Delete account
  (trash), Sign out & clear this device (last). **Refund policy** is the last item of the account menu (and Home's footer):
  its Refund button works only for a real payment within 14 days (server check first).
