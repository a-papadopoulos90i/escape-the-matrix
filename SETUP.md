# Setting up Google sign-in and cloud sync

Escape the Matrix works out of the box in **free mode**: everything is saved in the browser
(`localStorage`) and nothing leaves the device. This guide connects the optional **Google mode**:
"Sign in with Google" plus live sync of your tasks across devices through Firebase (Firestore).

You do this **once**, as the owner of the deployment. It takes about 15 minutes, needs a Google
account, and stays inside Firebase's free tier (one small document per user).

Until it is done, the "Sign in with Google" button shows a note explaining that sign-in is not
connected yet — nothing else in the app changes.

---

## Part A — Create the Firebase project

1. Open <https://console.firebase.google.com/> and sign in with your Google account.
2. Click **Create a project** (or **Add project**).
3. Project name: `escape-the-matrix` (any name is fine). Click **Continue**.
4. When asked about **Google Analytics**, turn it **off** — the app does not use it. Click
   **Create project**, wait for "Your new project is ready", then click **Continue**.

## Part B — Enable the Google sign-in provider

1. In the left sidebar open **Build → Authentication** and click **Get started**.
2. Open the **Sign-in method** tab.
3. Under **Additional providers** click **Google**.
4. Switch **Enable** on.
5. **Project support email**: pick your address from the dropdown (required by Google).
6. Click **Save**.

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
     storageBucket: "escape-the-matrix-xxxxx.appspot.com",
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
     storageBucket: 'escape-the-matrix-xxxxx.appspot.com',
     messagingSenderId: '123456789012',
     appId: '1:123456789012:web:abcdef0123456789',
   };
   ```

3. Save the file. It is **safe to commit** this file: these values only identify the project. What
   protects your data is the security rules (Part F) and the authorized domains (Part E).

## Part E — Allow the GitHub Pages domain

Google sign-in only works from domains you approve.

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
2. Open the site, click **Sign in with Google**, pick your account. The header shows your avatar,
   first name and a green dot ("Synced ✓" in the account menu). Any tasks you already had in free
   mode are merged into your account.
3. Open the site on another device or browser and sign in with the same account: the same tasks
   appear, and changes made on one device show up on the other within a second or two.

In the Firebase console you can see the data under **Firestore Database → Data → users → (your uid)**.

---

## Running the app locally

The app is plain HTML/CSS/JS modules — no build step — but browsers refuse to load ES modules from
`file://`, so serve the folder with any static server:

```bash
cd "/path/to/Escape The Matrix"
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. `localhost` is already an authorized domain, so Google sign-in
works locally too once Parts A–F are done. Stop the server with `Ctrl+C`.

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
| Clicking **Sign in with Google** shows "Google sign-in is not connected yet" | `firebaseConfig` is still `null` in `js/firebase-config.js` (Part D), or the deployed site does not have your change yet. |
| Popup says **`auth/unauthorized-domain`** | The site's domain is not in **Authentication → Settings → Authorized domains** (Part E). |
| Popup opens and closes, toast "Sign-in failed" | Google provider not enabled (Part B), or the browser blocked third-party cookies for the popup. Try again or allow popups for the site. |
| The popup is blocked | The app falls back to a full-page redirect sign-in. Current browsers (Chrome 115+, Safari, Firefox) block the storage that redirect needs when the site (`github.io`) and the `authDomain` (`*.firebaseapp.com`) differ, so the redirect may bring you back signed out. In that case allow pop-ups for the site and click **Sign in with Google** again. |
| Signed in, but the dot is red and the menu says "Not synced — will retry" | Firestore rejects the write: rules not published (Part F) or the database was not created. Check **Firestore Database → Rules**. |
| Dot is gray / "Offline" | The browser reports no network. Changes are kept locally and sent when you are back online. |
| Tasks from another device do not appear | Make sure both devices are signed in with the **same** Google account and both show "Synced ✓". |
