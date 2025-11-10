import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js'
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"
// auth
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";

const firebaseConfig = {
	apiKey: "AIzaSyCAZCdpLSNAHhJMbX6XO7kM6OGEq1Wlp_g",
	authDomain: "arena-battlegrounds-2724e.firebaseapp.com",
	projectId: "arena-battlegrounds-2724e",
	storageBucket: "arena-battlegrounds-2724e.firebasestorage.app",
	messagingSenderId: "772072071103",
	appId: "1:772072071103:web:0ecb0d98cdbe1d39708b0a",
	measurementId: "G-G1Q86QFQBP"
};

// Initialize Firebase and services
export const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const auth = getAuth(app);
export const google_auth = GoogleAuthProvider(app);
export const signInWithPopup = signInWithPopup;
export const onAuthStateChanged = onAuthStateChanged;
