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
// Firebase project "Levelix" (project ID levelix; its hosting site is levelix-app, behind levelix.eu).
export const firebaseConfig = {
  apiKey: 'AIzaSyCy40N3IG7oE9R70f3pqIe81cAmNmh7vxo',
  // Sign in through the domain the visitor is already on (its /__/auth/handler is served by Firebase
  // Hosting there too), so sign-in never depends on another domain resolving and Google's window names
  // our own address. Anywhere else (e.g. GitHub Pages) it falls back to the project's firebaseapp.com.
  authDomain: ['levelix.eu', 'www.levelix.eu', 'levelix-app.web.app'].includes(globalThis.location?.hostname)
    ? globalThis.location.hostname
    : 'levelix-b42f1.firebaseapp.com',
  projectId: 'levelix',
  storageBucket: 'levelix.firebasestorage.app',
  messagingSenderId: '658479226766',
  appId: '1:658479226766:web:a3fdffbddf59f5cb1acedf',
};

// Sign-in options shown in the chooser. Add 'apple' once Apple is configured (SETUP.md, Part B3).
export const authProviders = ['google', 'email'];
