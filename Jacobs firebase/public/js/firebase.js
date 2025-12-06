import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js'

import {
  getFunctions,
  connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";

import {
  getDatabase,
  connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"

import {
  getAuth,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCAZCdpLSNAHhJMbX6XO7kM6OGEq1Wlp_g",
  authDomain: "arena-battlegrounds-2724e.firebaseapp.com",
  projectId: "arena-battlegrounds-2724e",
  storageBucket: "arena-battlegrounds-2724e.firebasestorage.app",
  messagingSenderId: "772072071103",
  appId: "1:772072071103:web:0ecb0d98cdbe1d39708b0a",
  measurementId: "G-G1Q86QFQBP",
  databaseURL: "https://arena-battlegrounds-2724e-default-rtdb.firebaseio.com/"
};

// Initialize Firebase and services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions();

// Only connect to local emulators when running on localhost (developer machines).
// This prevents accidental use of emulators when the site is deployed to Firebase Hosting.
try {
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
  if (host === 'localhost' || host === '127.0.0.1') {
    connectFunctionsEmulator(functions, "localhost", 5001);
    connectAuthEmulator(auth, "http://127.0.0.1:9199");
    connectDatabaseEmulator(db, "127.0.0.1", 9009);
    console.debug('[firebase] connected to local emulators');
  } else {
    // production — don't connect to emulators
    console.debug('[firebase] running in non-localhost environment; emulator connections skipped');
  }
} catch (e) {
  // If anything goes wrong, avoid blocking app initialization; log a warning.
  console.warn('[firebase] emulator-connection check failed', e);
}

export { app, auth, db, functions };
