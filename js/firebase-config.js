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
  authDomain: 'levelix.eu', // the site's own domain, so Google's sign-in window names levelix.eu
  projectId: 'katopsi-elite',
  storageBucket: 'katopsi-elite.firebasestorage.app',
  messagingSenderId: '542908804568',
  appId: '1:542908804568:web:3a01f898440b84c1da56ad',
};

// Sign-in options shown in the chooser. Add 'apple' once Apple is configured (SETUP.md, Part B3).
export const authProviders = ['google', 'email'];
