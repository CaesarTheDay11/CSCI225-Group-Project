import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js'

import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";

import {
  getDatabase,
  onValue,
  connectDatabaseEmulator,
  ref, set,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  connectAuthEmulator
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

connectFunctionsEmulator(functions, "localhost", 5001);
connectAuthEmulator(auth, "http://127.0.0.1:9199");
connectDatabaseEmulator(db, "127.0.0.1", 9009);

const connectedRef = ref(db, ".info/connected");
onValue(connectedRef, (snap) => {
  console.log("connected:", snap.val());
});

// auth setup
const provider = new GoogleAuthProvider();

document.getElementById("googleBtn").onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
  }
};

var uid

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById("user").textContent =
      `Signed in as ${user.displayName || user.email}`;
    document.getElementById("queueBtn").style = "display: inline;";
    writeUserData(user.uid, user.displayName);
    uid = user.uid;
    const matchRef = ref(db, "users/" + uid + "/currentMatch");

    onValue(matchRef, snap => {
      if (snap.exists()) {
        console.log("Matched! Match ID:", snap.val());
        // TODO: load match screen
      }
    });
  } else {
    document.getElementById("user").textContent = "Not signed in";
  }
});

function writeUserData(userId, name) {
  set(ref(db, 'users/' + userId), {
    displayName: name,
  });
}

function updateQueueData() {
  // TODO: store rank value later for skill based matchmaking
  set(ref(db, 'queue/' + uid), { "UserID:": uid });
}

document.getElementById("queueBtn").addEventListener("click", updateQueueData, false);

