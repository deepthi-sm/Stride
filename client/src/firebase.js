// Firebase, frontend only. This is the one place the Firebase app and the Google
// auth provider are created. Sign-in happens on the client and hands back a
// Google OAuth access token; that token (the user's own) is what later calls the
// Google Calendar API. This has nothing to do with Gemini: the Gemini key still
// lives only on the server and is never touched here.
//
// The Firebase web config is read from local env vars (client/.env, names
// prefixed VITE_) and is never committed. Provide the values from the Firebase
// console; Vite injects them at build time. See client/.env.example for the keys.

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.authDomain) {
  console.warn(
    'Firebase config missing. Copy client/.env.example to client/.env, fill in the ' +
      'values, and restart the dev server.'
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// The Google provider, asking for permission to write events to the user's own
// calendar. This is the scope the acceptance test depends on.
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/calendar.events');
// Always show the account chooser so a tester can pick the right account.
googleProvider.setCustomParameters({ prompt: 'select_account' });
