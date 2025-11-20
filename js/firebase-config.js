// firebase-config.js (ES module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, collection, onSnapshot, updateDoc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
apiKey: "AIzaSyCAZCdpLSNAHhJMbX6XO7kM6OGEq1Wlp_g",
authDomain: "arena-battlegrounds-2724e.firebaseapp.com",
databaseURL: "https://arena-battlegrounds-2724e-default-rtdb.firebaseio.com",
projectId: "arena-battlegrounds-2724e",
storageBucket: "arena-battlegrounds-2724e.firebasestorage.app",
messagingSenderId: "772072071103",
appId: "1:772072071103:web:0ecb0d98cdbe1d39708b0a",
measurementId: "G-G1Q86QFQBP"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export async function ensureSignedIn() {
return new Promise((resolve, reject) => {
const unsub = onAuthStateChanged(auth, (user) => {
unsub();
if (user) return resolve(user);
signInAnonymously(auth).then(u => resolve(u)).catch(reject);
});
});
}

export { doc, getDoc, setDoc, addDoc, collection, onSnapshot, updateDoc, runTransaction, serverTimestamp };

// Export app so other modules can reuse the initialized Firebase App (e.g., RTDB access)
export { app };