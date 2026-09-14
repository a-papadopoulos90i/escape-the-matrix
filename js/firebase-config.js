// Firebase web-app configuration. Leave `null` to run in free mode (localStorage only).
// To enable accounts (Google, Apple, email link) + Firestore sync, paste the config object from
// Firebase console → Project settings → Your apps → Web app, e.g.:
//
// export const firebaseConfig = {
//   apiKey: 'AIza...',
//   authDomain: 'your-project.firebaseapp.com',
//   projectId: 'your-project',
//   storageBucket: 'your-project.appspot.com',
//   messagingSenderId: '1234567890',
//   appId: '1:1234567890:web:abcdef123456',
// };
//
// See SETUP.md for the full walkthrough (providers, authorized domains, Firestore rules).
// Firebase project "Escape the Matrix" (project ID katopsi-elite — the ID is permanent).
export const firebaseConfig = {
  apiKey: 'AIzaSyBohjbgd-ehrSxRDZi-GaalzhNxNBa2bkQ',
  // Sign in through the domain the visitor is already on (its /__/auth/handler is served by Firebase
  // Hosting there too), so sign-in never depends on another domain resolving and Google's window names
  // our own address. Anywhere else (e.g. GitHub Pages) it falls back to the project's firebaseapp.com.
  authDomain: ['levelix.eu', 'www.levelix.eu', 'levelix.web.app'].includes(globalThis.location?.hostname)
    ? globalThis.location.hostname
    : 'katopsi-elite.firebaseapp.com',
  projectId: 'katopsi-elite',
  storageBucket: 'katopsi-elite.firebasestorage.app',
  messagingSenderId: '542908804568',
  appId: '1:542908804568:web:3a01f898440b84c1da56ad',
};

// Sign-in options shown in the chooser. Add 'apple' once Apple is configured (SETUP.md, Part B3).
export const authProviders = ['google', 'email'];
