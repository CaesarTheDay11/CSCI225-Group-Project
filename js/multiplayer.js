/* Multiplayer helpers (Firestore client) — adapt if using compat vs. modular */
(async function initMultiplayer() {
// If using module version import ensureSignedIn and db; otherwise rely on window.currentUid and window.fbDb
try {
if (typeof ensureSignedIn === 'function') {
const user = await ensureSignedIn();
window.currentUid = user.uid;
console.log('ensureSignedIn ->', user.uid);
} else if (window.fbAuth) {
// use existing onAuthStateChanged handler defined earlier
}
} catch (err) {
console.error('Multiplayer init failed', err);
}
})();

// Create a lobby document (simple invite code)
async function createLobby(lobbyMeta = {}) {
const payload = {
hostUid: window.currentUid,
createdAt: serverTimestamp ? serverTimestamp() : new Date(),
players: [{ uid: window.currentUid, ready: false }],
maxPlayers: lobbyMeta.maxPlayers || 2,
status: 'open',
meta: lobbyMeta
};
if (typeof db !== 'undefined') {
const ref = await addDoc(collection(db, 'lobbies'), payload);
return ref.id;
} else if (window.fbDb) {
const ref = await window.fbDb.collection('lobbies').add(payload);
return ref.id;
} else throw new Error('Firestore not initialized');
}

// Join an existing lobby id
async function joinLobby(lobbyId) {
if (!lobbyId) throw new Error('Must pass lobbyId');
const lobbyRef = (db ? doc(db, 'lobbies', lobbyId) : window.fbDb.collection('lobbies').doc(lobbyId));
await runTransaction(db || window.fbDb, async (tx) => {
const snap = await (db ? tx.get(lobbyRef) : lobbyRef.get());
if (!snap.exists) throw new Error('Lobby not found');
const data = snap.data();
const players = data.players || [];
if (players.find(p => p.uid === window.currentUid)) return;
players.push({ uid: window.currentUid, ready: false });
await (db ? tx.update(lobbyRef, { players }) : lobbyRef.update({ players }));
});
return true;
}

// Create a game doc from a lobby (host calls when ready)
async function createGameFromLobby(lobbyId, initialGameState) {
// initialGameState: { players: [{uid, name, classId, etc}], state: {...} }
const gamePayload = {
players: initialGameState.players,
state: initialGameState.state,
history: [],
createdAt: serverTimestamp ? serverTimestamp() : new Date(),
status: 'active',
turnUid: initialGameState.state.turnUid || initialGameState.players[0].uid
};
if (typeof db !== 'undefined') {
const ref = await addDoc(collection(db, 'games'), gamePayload);
// close lobby
const lobbyRef = doc(db, 'lobbies', lobbyId);
await updateDoc(lobbyRef, { status: 'closed' });
return ref.id;
} else {
const ref = await window.fbDb.collection('games').add(gamePayload);
await window.fbDb.collection('lobbies').doc(lobbyId).update({ status: 'closed' });
return ref.id;
}
}

// Join existing game (subscribe to its doc)
function listenToGame(gameId, onUpdate) {
if (typeof onSnapshot === 'function' && db) {
const gameRef = doc(db, 'games', gameId);
return onSnapshot(gameRef, (snap) => {
if (!snap.exists()) return;
onUpdate(snap.data(), snap.id);
});
} else if (window.fbDb) {
const unsub = window.fbDb.collection('games').doc(gameId).onSnapshot((snap) => {
if (!snap.exists) return;
onUpdate(snap.data(), snap.id);
});
return unsub;
} else throw new Error('Firestore not available');
}

// Prototype: client-authoritative move submission using a transaction (fast to implement; NOT secure)
async function submitMove_ClientTransaction(gameId, applyMoveFn) {
// applyMoveFn(currentState, uid) => { newState, moveSummary, winnerUid? }
if (!gameId) throw new Error('gameId required');
if (typeof db === 'undefined' && !window.fbDb) throw new Error('Firestore not initialized');

const gameRef = db ? doc(db, 'games', gameId) : window.fbDb.collection('games').doc(gameId);
if (db) {
await runTransaction(db, async (tx) => {
const snap = await tx.get(gameRef);
if (!snap.exists()) throw new Error('Game missing');
const data = snap.data();
if (data.turnUid !== window.currentUid) throw new Error('Not your turn');
const res = applyMoveFn(data.state, window.currentUid);
const newHistory = (data.history || []).concat([res.moveSummary]);
tx.update(gameRef, { state: res.newState, history: newHistory, turnUid: res.newState.turnUid || res.nextTurnUid });
if (res.winnerUid) tx.update(gameRef, { status: 'finished', winnerUid: res.winnerUid, finishedAt: serverTimestamp ? serverTimestamp() : new Date() });
});
} else {
// compat version
await window.fbDb.runTransaction(async (tx) => {
const snap = await tx.get(gameRef);
if (!snap.exists) throw new Error('Game missing');
const data = snap.data();
if (data.turnUid !== window.currentUid) throw new Error('Not your turn');
const res = applyMoveFn(data.state, window.currentUid);
const newHistory = (data.history || []).concat([res.moveSummary]);
tx.update(gameRef, { state: res.newState, history: newHistory, turnUid: res.newState.turnUid || res.nextTurnUid });
if (res.winnerUid) tx.update(gameRef, { status: 'finished', winnerUid: res.winnerUid, finishedAt: new Date() });
});
}
}

// Preferred: call a callable Cloud Function (server-side authoritative move application).
// Client stub (requires Firebase Functions setup)
async function submitMove_Callable(functionsInstance, gameId, movePayload) {
// functionsInstance = getFunctions(app) or window.firebase.functions()
// movePayload: { gameId, move: { type, abilityId, targetId, extra } }
// Example using modular SDK:
// import { getFunctions, httpsCallable } from "firebase/functions";
// const applyMove = httpsCallable(functionsInstance, 'applyMove');
// const res = await applyMove({ gameId, move: movePayload });
// handle res.data
throw new Error('Add Cloud Functions and replace this stub with httpsCallable call.');
}

/* Export or attach to window so your UI code can call them */
window.multiplayer = {
createLobby, joinLobby, createGameFromLobby, listenToGame, submitMove_ClientTransaction, submitMove_Callable
};

// RTDB helpers (client-side) — minimal implementations to support RTDB-based games
if (typeof window.app !== 'undefined' || typeof window.firebase !== 'undefined') {
	try {
		// lazy-load modular RTDB methods only when used by client pages
		import('https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js').then((rtdb) => {
			const { getDatabase, ref, runTransaction, onValue } = rtdb;
			const dbRT = getDatabase(window.app);

			// listen to RTDB match node
			const listenToGameRTDB = (matchId, onUpdate) => {
				const gameRef = ref(dbRT, `matches/${matchId}`);
				return onValue(gameRef, (snap) => {
					if (!snap.exists()) return;
					onUpdate(snap.val(), matchId);
				});
			};

			// submit move using RTDB transaction
			const submitMoveRTDB = async (matchId, applyMoveFn) => {
				const gameRef = ref(dbRT, `matches/${matchId}`);
				await runTransaction(gameRef, (cur) => {
					if (!cur) throw new Error('Game missing');
					const state = cur.state || {};
					if (state.turnUid !== window.currentUid) throw new Error('Not your turn');
					const res = applyMoveFn(state, window.currentUid);
					cur.state = res.newState;
					cur.history = (cur.history || []).concat([res.moveSummary]);
					if (res.winnerUid) {
						cur.status = 'finished';
						cur.winnerUid = res.winnerUid;
						cur.finishedAt = Date.now();
					}
					return cur;
				});
			};

			window.multiplayer.listenToGameRTDB = listenToGameRTDB;
			window.multiplayer.submitMoveRTDB = submitMoveRTDB;
		}).catch(() => {});
	} catch (e) {
		// ignore dynamic import failure
	}
}