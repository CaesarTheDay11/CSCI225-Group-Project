import { auth, db, } from "./firebase.js";

/*
import {
  connectFunctionsEmulator,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";
*/

import {
  onValue,
  ref, set,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"

import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

// setup connection listener
const connectedRef = ref(db, ".info/connected");
onValue(connectedRef, (snap) => {
  console.log("connected:", snap.val());
});

var uid
var queueRef;

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById("user").textContent =
      `Signed in as ${user.displayName || user.email}`;
    document.getElementById("queueBtn").style = "display: inline;";
    writeUserData(user.uid, user.displayName);
    uid = user.uid;
    const matchRef = ref(db, "users/" + uid + "/currentMatch");
    queueRef = ref(db, 'queue/' + uid);
    onDisconnect(queueRef).remove();

    document.querySelectorAll('.not-logged-in-vis')
      .forEach(el => el.style.display = 'none');

    // Ensure battle UI is hidden initially when user logs in
    document.getElementById("battle").style.display = "none";

    console.log(user);


    onValue(matchRef, snap => {
      if (snap.exists()) {
        const matchId = snap.val();
        document.getElementById("queueBtn").style.display = "none"; // Hide match button when in match
        document.getElementById("battle").style.display = "block";
        console.log("Matched! Match ID:", matchId);
        // Initialize battle when match is found
        // Wait a bit for battle.js to load if it hasn't yet
        setTimeout(() => {
          if (typeof window.initializeBattle === 'function') {
            window.initializeBattle(matchId, uid);
          } else {
            console.error("initializeBattle function not found!");
          }
        }, 100);
      } else {
        document.getElementById("queueBtn").style.display = "inline"; // Show match button when not in match
        document.getElementById("battle").style.display = "none";
      }
    });


  } else {
    document.getElementById("user").textContent = "Not signed in";
    document.getElementById("battle").style.display = "none";
  }
});

function writeUserData(userId, name) {
  set(ref(db, 'users/' + userId), {
    displayName: name,
  });
}

function updateQueueData() {
  // TODO: store rank value later for skill based matchmaking
  document.getElementsByClassName("queueBtn")[0].textContent = "Finding a Match...";
  document.getElementById("battle").style.display = "none"; // Hide battle UI while searching
  set(queueRef, { "UserID:": uid });
}

document.getElementById("queueBtn").addEventListener("click", updateQueueData, false);

