import { auth, db } from "./firebase.js";

/*
import {
  connectFunctionsEmulator,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";
*/

import {
  onValue,
  ref,
  set,
  onDisconnect,
  update,
  get,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"

import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

// Ensure login/signup handlers are loaded anywhere app.js runs
import("./login.js").catch((err) => {
  console.error("[app] failed to load login module", err);
});

const userDisplay = document.getElementById("user-display");
const battleElement = document.getElementById("battle");
const queueBtn = document.getElementById("queueBtn");
const signOutBtn = document.getElementById("signOutBtn");
const navAuthLinks = document.querySelectorAll(".nav-auth-link");
const navProtectedLinks = document.querySelectorAll(".nav-protected-link");

// setup connection listener
const connectedRef = ref(db, ".info/connected");
onValue(connectedRef, (snap) => {
  // no-op; listener keeps presence logic ready
});

let uid;
let queueRef;
let presenceRef;
let detachMatchListener = null;
let detachProfileListener = null;

onAuthStateChanged(auth, async (user) => {
  uid = user?.uid;

  if (detachMatchListener) {
    detachMatchListener();
    detachMatchListener = null;
  }
  if (detachProfileListener) {
    detachProfileListener();
    detachProfileListener = null;
  }

  if (user) {
    await writeUserData(user.uid, user.displayName || user.email);
    presenceRef = ref(db, `presence/${user.uid}`);
    onDisconnect(presenceRef).set({ online: false, lastSeen: Date.now() });
    set(presenceRef, { online: true, lastSeen: Date.now() });

    const userProfileRef = ref(db, `users/${uid}`);
    detachProfileListener = onValue(userProfileRef, (snap) => {
      const data = snap.val() || {};
      const name = data.displayName || user.displayName || user.email;
      const classLabel = data.class ? ` (${capitalize(data.class)})` : "";
      if (userDisplay) {
        userDisplay.textContent = `Signed in as ${name}${classLabel}`;
      }
    });
    if (signOutBtn) signOutBtn.style.display = "inline-flex";
    navAuthLinks.forEach((link) => (link.style.display = "none"));
    navProtectedLinks.forEach((link) => (link.style.display = ""));

    queueRef = ref(db, "queue/" + uid);
    onDisconnect(queueRef).remove();

    const matchRef = ref(db, "users/" + uid + "/currentMatch");

    document.querySelectorAll(".not-logged-in-vis")
      .forEach((el) => (el.style.display = "none"));

    if (battleElement) {
      battleElement.style.display = "none";
    }

    if (queueBtn) {
      queueBtn.style.display = "inline";
    }

    detachMatchListener = onValue(matchRef, (snap) => {
      if (snap.exists()) {
        const matchId = snap.val();
        (async () => {
          const matchSnap = await get(ref(db, `matches/${matchId}`));
          if (!matchSnap.exists()) {
            await set(matchRef, null);
            if (queueBtn) queueBtn.style.display = "inline";
            if (battleElement) battleElement.style.display = "none";
            return;
          }
          if (queueBtn) queueBtn.style.display = "none";
          if (battleElement) battleElement.style.display = "block";
          console.log("Matched! Match ID:", matchId);
          setTimeout(() => {
            if (typeof window.initializeBattle === "function") {
              window.initializeBattle(matchId, uid);
            } else {
              console.error("initializeBattle function not found!");
            }
          }, 100);
        })();
      } else {
        if (queueBtn) queueBtn.style.display = "inline";
        if (battleElement) battleElement.style.display = "none";
      }
    });
  } else {
    if (presenceRef) {
      set(presenceRef, { online: false, lastSeen: Date.now() }).catch(() => {});
      presenceRef = null;
    }
    if (userDisplay) userDisplay.textContent = "Not signed in";
    if (battleElement) battleElement.style.display = "none";
    if (signOutBtn) signOutBtn.style.display = "none";
    navAuthLinks.forEach((link) => (link.style.display = ""));
    navProtectedLinks.forEach((link) => (link.style.display = "none"));

    document.querySelectorAll(".not-logged-in-vis")
      .forEach((el) => (el.style.display = ""));
  }
});

async function writeUserData(userId, name) {
  if (!userId) return;

  const profile = {};
  if (name) profile.displayName = name;
  if (Object.keys(profile).length === 0) return;

  try {
    await update(ref(db, "users/" + userId), profile);
  } catch (err) {
    console.error("Failed to write user profile", err);
  }
}

function capitalize(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function updateQueueData() {
  // TODO: store rank value later for skill based matchmaking
  if (queueBtn) {
    queueBtn.textContent = "Finding a Match...";
  }
  if (battleElement) {
    battleElement.style.display = "none";
  }
  if (queueRef && uid) {
    set(queueRef, { "UserID:": uid });
  }
}

if (queueBtn) {
  queueBtn.addEventListener("click", updateQueueData, false);
}

if (signOutBtn) {
  signOutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Failed to sign out", err);
    } finally {
      window.location.replace("index.html");
    }
  });
}
