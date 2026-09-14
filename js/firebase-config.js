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
export const firebaseConfig = null;

// Sign-in options shown in the chooser. Add 'apple' once Apple is configured (SETUP.md, Part B3).
export const authProviders = ['google', 'email'];
