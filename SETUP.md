# Setting up accounts (Google, Apple, email) and cloud sync

Escape the Matrix works out of the box in **free mode**: everything is saved in the browser
(`localStorage`) and nothing leaves the device. This guide connects the optional **accounts**:
sign in with **Google**, **Apple** or a **passwordless email link**, plus live sync of your tasks
across devices through Firebase (Firestore).

You do this **once**, as the owner of the deployment, in your own Firebase (and Apple Developer)
account. Google and email take about 15 minutes. Apple takes another ~20 minutes and needs a paid
**Apple Developer Program** membership. You can switch providers on one at a time — any provider you
have not enabled yet simply fails with a "Sign-in failed" toast.

Until Part D is done, every sign-in option shows a note explaining that sign-in is not connected
yet — nothing else in the app changes.

---

## Part A — Create the Firebase project

1. Open <https://console.firebase.google.com/> and sign in with your Google account.
2. Click **Create a project** (or **Add project**).
3. Project name: `escape-the-matrix` (any name is fine). Click **Continue**.
4. When asked about **Google Analytics**, turn it **off** — the app does not use it. Click
   **Create project**, wait for "Your new project is ready", then click **Continue**.

## Part B — Turn on the sign-in providers

In the left sidebar open **Build → Authentication**, click **Get started**, then open the
**Sign-in method** tab.

### B1 — Google

1. Under **Additional providers** click **Google** and switch **Enable** on.
2. **Project support email**: pick your address from the dropdown.
3. Click **Save**.

### B2 — Email link (passwordless)

1. Click **Add new provider** → **Email/Password**.
2. Switch **Email/Password** on, then also switch **Email link (passwordless sign-in)** on.
3. Click **Save**.

The app sends a one-time link to the address the user types; opening it signs them in. No passwords
are created or stored. (Optional: **Authentication → Templates** lets you change the email's wording
and sender name.)

### B3 — Apple (needs an Apple Developer Program membership)

1. In Firebase: **Add new provider** → **Apple** → switch **Enable** on. Leave this page open and
   **copy the callback URL** shown at the bottom — it looks like
   `https://escape-the-matrix-xxxxx.firebaseapp.com/__/auth/handler`.
2. In another tab open <https://developer.apple.com/account/resources/identifiers/list> and sign in.
3. **App ID** — click **+** → **App IDs** → **App** → Continue. Description `Escape the Matrix`,
   Bundle ID (explicit) e.g. `io.github.apapadopoulos90i.escapethematrix`. Tick **Sign in with Apple**.
   Continue → Register.
4. **Services ID** — click **+** → **Services IDs** → Continue. Description `Escape the Matrix web`,
   Identifier e.g. `io.github.apapadopoulos90i.escapethematrix.web`. Register. Then open it, tick
   **Sign in with Apple** → **Configure**:
   - **Primary App ID**: the App ID from step 3.
   - **Domains and Subdomains**: `escape-the-matrix-xxxxx.firebaseapp.com` (your project's
     `authDomain`, without `https://`).
   - **Return URLs**: the callback URL you copied in step 1.
   - Next → Done → Continue → **Save**.
5. **Key** — open **Keys** → **+**. Name `Escape the Matrix Sign in with Apple`, tick **Sign in with
   Apple** → Configure → choose the App ID → Save → Continue → Register. **Download** the `.p8` file
   (Apple lets you download it only once) and note the **Key ID**.
6. Your **Team ID** is shown at the top right of the Apple Developer site (10 characters).
7. Back in the Firebase Apple provider page fill in **Services ID** (step 4's identifier), **Apple
   team ID**, **Key ID** and the **Private key** (open the `.p8` file in a text editor and paste all of
   it). Click **Save**.

## Part C — Register the web app and copy its config

1. Click the gear icon next to **Project Overview** (top-left) → **Project settings**.
2. Scroll down to **Your apps** and click the web icon **`</>`**.
3. App nickname: `Escape the Matrix`. Leave **Firebase Hosting** unticked (GitHub Pages hosts the
   site). Click **Register app**.
4. The page now shows a code snippet containing an object that starts with
   `const firebaseConfig = {` and ends with `};`. **Copy only that object** — it looks like:

   ```js
   {
     apiKey: "AIzaSy...",
     authDomain: "escape-the-matrix-xxxxx.firebaseapp.com",
     projectId: "escape-the-matrix-xxxxx",
     storageBucket: "escape-the-matrix-xxxxx.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef0123456789"
   }
   ```

   Click **Continue to console**. (You can always find this object again under
   **Project settings → Your apps → SDK setup and configuration → Config**.)

## Part D — Paste the config into the app

1. Open the file `js/firebase-config.js` in the project.
2. Replace the last line

   ```js
   export const firebaseConfig = null;
   ```

   with the object you copied:

   ```js
   export const firebaseConfig = {
     apiKey: 'AIzaSy...',
     authDomain: 'escape-the-matrix-xxxxx.firebaseapp.com',
     projectId: 'escape-the-matrix-xxxxx',
     storageBucket: 'escape-the-matrix-xxxxx.firebasestorage.app',
     messagingSenderId: '123456789012',
     appId: '1:123456789012:web:abcdef0123456789',
   };
   ```

3. Save the file. It is **safe to commit** this file: these values only identify the project. What
   protects your data is the security rules (Part F) and the authorized domains (Part E).

## Part E — Allow the GitHub Pages domain

Sign-in popups and email links only work from domains you approve.

1. Go to **Build → Authentication → Settings** tab → **Authorized domains**.
2. `localhost` and your `*.firebaseapp.com` domain are already listed. Click **Add domain**.
3. Enter **`a-papadopoulos90i.github.io`** and click **Add**.

   (If you ever host the app somewhere else, add that domain here too.)

## Part F — Create the Firestore database and apply the rules

1. In the sidebar open **Build → Firestore Database** and click **Create database**.
2. **Location**: choose one close to you, e.g. `eur3 (europe-west)`. It cannot be changed later.
   Click **Next**.
3. **Security rules**: choose **Start in production mode** (everything denied by default). Click
   **Create** and wait for the database to appear.
4. Open the **Rules** tab. Delete everything in the editor and paste the full contents of the
   project file **`firestore.rules`** (it allows each signed-in user to read and write only their
   own document, `users/{their uid}`, and nothing else).
5. Click **Publish**.

## Part G — Deploy and try it

1. Commit and push the change to `js/firebase-config.js` to the `main` branch. GitHub Pages
   redeploys within a minute or two.
2. Open the site, click the account icon (top right) and try each option:
   - **Continue with Google** / **Continue with Apple** — a popup asks you to choose the account.
   - **Email** — type your address, press **Continue with email**, then open the link from the email
     **in the same browser** (on another device the site first asks you to confirm the address).
3. Signed in, the header shows your avatar (or initial) and a green dot ("Synced ✓" in the account
   menu). Any tasks you already had in free mode are merged into your account.
4. Open the site on another device or browser and sign in with the same account: the same tasks
   appear, and changes made on one device show up on the other within a second or two.

In the Firebase console you can see the data under **Firestore Database → Data → users → (uid)**.

> **Note on accounts:** Firebase treats each sign-in method as its own account unless the email
> matches. Signing in with Google as `you@gmail.com` and later with an email link to the same address
> reaches the same account; Apple's "Hide My Email" relay address does not, so pick one method and
> stay with it.

---

## Running the app locally

The app is plain HTML/CSS/JS modules — no build step — but browsers refuse to load ES modules from
`file://`, so serve the folder with any static server:

```bash
cd "/path/to/Escape The Matrix"
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. `localhost` is already an authorized domain, so sign-in works
locally too once Parts A–F are done (Apple needs the deployed site: its return URL is the Firebase
handler, which is fine from localhost too). Stop the server with `Ctrl+C`.

## How deployment works

- The site is served by **GitHub Pages** straight from the repository: **Settings → Pages →
  Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)`**.
- Every push to `main` republishes the site at <https://a-papadopoulos90i.github.io/escape-the-matrix/>.
- Nothing is compiled or bundled: `index.html`, `css/` and `js/` are served as-is. All URLs inside
  the app are relative (`./js/app.js`, `./css/base.css`), which is what makes the sub-path work.
- The `tests/` folder is development-only and is never referenced by the site.

## How sync works (for the curious)

- Each user has **one** Firestore document, `users/{uid}`, holding `{ doc, updatedAt, email }` —
  `doc` is exactly the same JSON the app keeps in `localStorage`.
- **Signing in** loads that document, merges it with the local free-mode data (union of tasks; the
  newer copy of a task wins) and writes the result back to both places. A deleted task is kept for
  30 days as a hidden "deleted" marker so the deletion reaches your other devices too.
- While signed in, every change is written to **localStorage and Firestore** (saves are debounced
  and coalesced). Firestore pushes other devices' changes back live; echoes of the device's own
  writes are ignored.
- **Sign out** keeps the local copy on the device. **Sign out & clear this device** wipes the local
  copy; the account data in Firestore stays untouched.
- The Firebase SDK (v10.14.1) is downloaded from Google's CDN only when a config exists — free mode
  never loads it and works fully offline.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Any sign-in option shows "Sign-in is not connected yet" | `firebaseConfig` is still `null` in `js/firebase-config.js` (Part D), or the deployed site does not have your change yet. |
| Popup says **`auth/unauthorized-domain`** | The site's domain is not in **Authentication → Settings → Authorized domains** (Part E). |
| Toast "Sign-in failed" right after choosing a method | That provider is not enabled yet (Part B), or (Google/Apple) the browser blocked the popup's third-party cookies. Try again or allow popups for the site. |
| Apple popup shows **invalid_client** or a redirect error | The Services ID, domain or return URL in Apple's configuration (B3 step 4) does not match the Firebase `authDomain` / callback URL exactly. |
| No email arrives | Check the spam folder; confirm **Email link (passwordless sign-in)** is on (B2). Firebase's free plan limits how many sign-in emails a project can send per day. |
| The email link opens but you stay signed out | The link is single-use and expires; request a new one. Open it in a browser that allows the site's storage. |
| The popup is blocked | The app falls back to a full-page redirect sign-in. Current browsers (Chrome 115+, Safari, Firefox) block the storage that redirect needs when the site (`github.io`) and the `authDomain` (`*.firebaseapp.com`) differ, so the redirect may bring you back signed out. In that case allow pop-ups for the site and try again. |
| Signed in, but the dot is red and the menu says "Not synced — will retry" | Firestore rejects the write: rules not published (Part F) or the database was not created. Check **Firestore Database → Rules**. |
| Dot is gray / "Offline" | The browser reports no network. Changes are kept locally and sent when you are back online. |
| Tasks from another device do not appear | Make sure both devices are signed in with the **same** account and both show "Synced ✓". |
