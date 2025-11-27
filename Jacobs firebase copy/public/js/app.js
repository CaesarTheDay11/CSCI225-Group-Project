import { auth, db, } from "./firebase.js";

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
  update,
  get,
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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("user").textContent =
      `Signed in as ${user.displayName || user.email}`;
    document.getElementById("queueBtn").style = "display: inline;";
    writeUserData(user.uid, user.displayName);
    uid = user.uid;
    // sync any locally selected class into the user's DB record so functions can read it
    try {
      const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
      if (local) {
        // write selectedClass to user node
        await update(ref(db, `users/${uid}`), { selectedClass: local });
      }
    } catch (err) {
      console.error('Error syncing local selectedClass to DB on sign-in', err);
    }
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
          // hide class selector when in a match
          const cs = document.getElementById('class-select'); if (cs) cs.style.display = 'none';
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
        // show class selector when not in a match
        const cs2 = document.getElementById('class-select'); if (cs2) cs2.style.display = '';
      }
    });


  } else {
    document.getElementById("user").textContent = "Not signed in";
    document.getElementById("battle").style.display = "none";
  }
});

function writeUserData(userId, name) {
  // use update to avoid overwriting other fields (like selectedClass)
  update(ref(db, 'users/' + userId), {
    displayName: name,
  });
}

async function updateQueueData() {
  // TODO: store rank value later for skill based matchmaking
  document.getElementsByClassName("queueBtn")[0].textContent = "Finding a Match...";
  document.getElementById("battle").style.display = "none"; // Hide battle UI while searching
  // ensure selectedClass is written to DB before adding to queue (avoid race)
  try {
    const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
    if (local && uid) {
      await update(ref(db, `users/${uid}`), { selectedClass: local });
    }
  } catch (err) {
    console.error('Error writing selectedClass before queueing', err);
  }
  // write queue entry that includes selectedClass to avoid cross-node races
  try {
    const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
    const payload = { uid: uid };
    if (local) payload.selectedClass = local;
    if (queueRef) {
      await set(queueRef, payload);
    } else {
      await set(ref(db, `queue/${uid}`), payload);
    }
  } catch (err) {
    console.error('Error writing queue entry', err);
  }
}

document.getElementById("queueBtn").addEventListener("click", (e) => { updateQueueData().catch(console.error); }, false);

// Class selection UI wiring (visible before joining a match)
function initClassSelector() {
  const container = document.getElementById('class-select');
  if (!container) {
    console.debug('Class selector: container not found');
    return;
  }
  const label = document.getElementById('selected-class-label');

  function setSelectedClass(classId) {
    (async () => {
      try { localStorage.setItem('selectedClass', classId); } catch (e) {}
      if (label) label.textContent = `Selected: ${classId}`;
      console.debug('Class selector: selected', classId);
      // If signed in, write to DB and await to ensure persistence
      if (typeof uid !== 'undefined' && uid) {
        try {
          await update(ref(db, `users/${uid}`), { selectedClass: classId });
        } catch (err) {
          console.error('Error saving selectedClass to DB on selection', err);
        }
      }
      // update visible status
      updateClassStatusUI().catch(console.error);
    })();
  }

  // attach handlers to buttons
  Array.from(container.querySelectorAll('[data-class]')).forEach(btn => {
    btn.addEventListener('click', (ev) => {
      const cls = btn.getAttribute('data-class');
      // fire-and-forget async selection handler
      try { setSelectedClass(cls); } catch (e) { console.error(e); }
    });
  });

  // initialize label from localStorage
  const existing = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
  if (existing && label) label.textContent = `Selected: ${existing}`;
  console.debug('Class selector initialized, existing:', existing);
  // update visible status on init
  updateClassStatusUI().catch(console.error);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initClassSelector);
} else {
  // DOMContentLoaded already fired, initialize immediately
  initClassSelector();
}

// Update the visible class status element: local value and saved DB value
async function updateClassStatusUI() {
  const display = document.getElementById('selected-class-display');
  const saved = document.getElementById('selected-class-saved');
  const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
  if (display) display.textContent = local || '(none)';

  if (!saved) return;
  if (!uid) {
    saved.textContent = '(not signed in)';
    saved.style.color = 'gray';
    return;
  }

  try {
    const snap = await get(ref(db, `users/${uid}/selectedClass`));
    if (snap.exists()) {
      const dbVal = snap.val();
      if (dbVal === local) {
        saved.textContent = `(saved: ${dbVal})`;
        saved.style.color = 'green';
      } else {
        saved.textContent = `(saved: ${dbVal || 'none'})`;
        saved.style.color = 'orange';
      }
    } else {
      saved.textContent = '(not saved)';
      saved.style.color = 'gray';
    }
  } catch (err) {
    console.error('Error reading selectedClass from DB', err);
    saved.textContent = '(db error)';
    saved.style.color = 'red';
  }
}

