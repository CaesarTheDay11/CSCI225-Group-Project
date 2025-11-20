// battlePVP.js — lightweight client integration for multiplayer lobby & game listening
// This file uses the project's `multiplayer.js` helpers and `firebase-config.js` to
// sign in, create/join lobbies and listen for game updates. It's intentionally small
// so you can expand the applyMove logic and UI integration later.

// Use RTDB queue and convert RTDB matches into Firestore game docs
import { app, addDoc, collection, serverTimestamp, db as fsDB, ensureSignedIn } from './firebase-config.js';
import { getDatabase, ref, set, remove, onDisconnect, onValue, get, runTransaction } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js';

(async function initPVP() {
  const debugEl = () => document.getElementById('debug');
  const setDebug = (txt) => { const d = debugEl(); if (d) d.textContent = (new Date()).toLocaleTimeString() + ' — ' + txt + '\n' + d.textContent; };

  const dbRT = getDatabase(app);

  try {
    const user = await ensureSignedIn();
    window.currentUid = user.uid;
    const status = document.getElementById('signin-status');
    if (status) status.textContent = `Signed in: ${user.uid}`;
    setDebug(`Signed in as ${user.uid}`);
  } catch (err) {
    setDebug('Sign-in failed: ' + (err && err.message));
    console.error(err);
  }

  // UI elements: class selection + queue controls
  const classSelect = document.getElementById("classSelect");
  const classSaveBtn = document.getElementById("selectClassBtn");
  const joinQueueBtn = document.getElementById("joinQueueBtn");
  const leaveQueueBtn = document.getElementById("leaveQueueBtn");

  // keep local selectedClass for UI convenience
  let selectedClass = null;

  // write selected class to RTDB when saved or when select changes
  async function saveSelectedClass(cls) {
    if (!window.currentUid) { setDebug("Not signed in"); return; }
    try {
      await set(ref(dbRT, `users/${window.currentUid}/selectedClass`), cls);
      selectedClass = cls;
      setDebug(`Selected class: ${cls}`);
    } catch (err) {
      setDebug("Failed to save selected class: " + (err && err.message));
    }
  }

  if (classSelect) {
    classSelect.addEventListener("change", (e) => {
      selectedClass = e.target.value;
    });
  }
  if (classSaveBtn) {
    classSaveBtn.addEventListener("click", () => {
      if (!selectedClass) { setDebug("Choose a class first"); return; }
      saveSelectedClass(selectedClass);
    });
  }

  // Queue join/leave
  async function joinQueue() {
    if (!window.currentUid) { setDebug("Not signed in"); return; }
    try {
      // ensure the player selected a class before queuing
      const selRef = ref(dbRT, `users/${window.currentUid}/selectedClass`);
      const selSnap = await get(selRef);
      const sel = selSnap && selSnap.exists() ? selSnap.val() : null;
      if (!sel) { setDebug("Select a class before joining the queue"); return; }

      const qRef = ref(dbRT, `queue/${window.currentUid}`);
      await set(qRef, { uid: window.currentUid, ts: Date.now() });
      // ensure removal on disconnect
      onDisconnect(qRef).remove().catch(() => {});
      setDebug("Enqueued in matchmaking queue");
    } catch (err) {
      setDebug("Failed to join queue: " + (err && err.message));
      console.error(err);
    }
  }

  async function leaveQueue() {
    if (!window.currentUid) return;
    try {
      const qRef = ref(dbRT, `queue/${window.currentUid}`);
      await remove(qRef).catch(() => {});
      setDebug('Left matchmaking queue');
    } catch (err) {
      setDebug('Failed to leave queue: ' + (err && err.message));
      console.error(err);
    }
  }

  if (joinQueueBtn) joinQueueBtn.addEventListener("click", joinQueue);
  if (leaveQueueBtn) leaveQueueBtn.addEventListener("click", leaveQueue);

  if (window.currentUid) {
    const myMatchRef = ref(dbRT, `users/${window.currentUid}/currentMatch`);
    onValue(myMatchRef, async (snap) => {
      if (!snap.exists()) return;
      const matchId = snap.val();
      if (!matchId) return;
      setDebug("Matched! matchId=" + matchId);
      try {
        // Listen to RTDB match node for game updates
        const gameRef = ref(dbRT, `matches/${matchId}`);
        onValue(gameRef, (gSnap) => {
          if (!gSnap.exists()) return;
          const data = gSnap.val();
          // Map RTDB match data to expected gameDoc shape
          const gameDoc = Object.assign({}, data);
          // If players stored as simple uids, normalize to objects
          if (Array.isArray(gameDoc.players) && typeof gameDoc.players[0] === "string") {
            gameDoc.players = gameDoc.players.map((uid) => ({ uid }));
          }
          setDebug("Game update (RTDB): " + matchId + " status=" + (gameDoc.status || "unknown"));
          const d = document.getElementById("debug");
          if (d) d.textContent = JSON.stringify(gameDoc.state || gameDoc, null, 2) + "\n\n" + d.textContent;
          // Apply to UI
          try { applyGameStateToUI(gameDoc); } catch (e) { console.error(e); }
        });
      } catch (err) {
        setDebug("Error handling assigned match: " + (err && err.message));
        console.error(err);
      }
    });
  }

  // manual gameId listen is still possible via developer console using
  // window.multiplayer.listenToGame(gameId, cb)

})();
// Call this when a Firestore game snapshot arrives
function applyGameStateToUI(gameDoc) {
  if (!gameDoc || !gameDoc.state) return;
  const s = gameDoc.state;
  // find index of local user in players array
  const myUid = window.currentUid;
  const players = Array.isArray(s.players) ? s.players : [];
  if (players.length < 2) return;

  // map local player vs opponent depending on position
  // assume players[0] is p1, players[1] is p2 (server created this order)
  const localIndex = players.findIndex(p => p.uid === myUid);
  const remoteIndex = (localIndex === 0) ? 1 : 0;

  // create objects compatible with your single-player battle code
  // -- adapt fields to match what your `battle.js` expects (hp, maxHp, baseAtk, defense, attackBoost, mana, classId, abilities)
  window.player = Object.assign({}, players[localIndex]);
  window.enemy = Object.assign({}, players[remoteIndex]);

  // Ensure ability cooldown containers etc exist:
  window.player.abilityCooldowns = window.player.abilityCooldowns || {};
  window.enemy.abilityCooldowns = window.enemy.abilityCooldowns || {};

  // Set turn state
  window.turnCounter = s.turn || window.turnCounter || 0;
  window.playerTurn = (s.turnUid === myUid);

  // Render UI
  if (typeof updateUI === 'function') updateUI();
  if (s.history && s.history.length) {
    // show last action text
    const last = s.history[s.history.length - 1];
    if (last && typeof logMessage === 'function') logMessage(last);
  }
}