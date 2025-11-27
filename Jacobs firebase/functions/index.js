// Try to set global options (best-effort). Newer firebase-functions exposes v2/options
// but older versions may not — avoid hard crash in emulators by guarding the import.
let setGlobalOptions = null;
try {
  // prefer the v2/options entrypoint when available
  setGlobalOptions = require("firebase-functions/v2/options").setGlobalOptions;
} catch (e) {
  try {
    // fallback to top-level export if present
    const ff = require("firebase-functions");
    if (typeof ff.setGlobalOptions === 'function') setGlobalOptions = ff.setGlobalOptions;
  } catch (e2) {
    // no-op; we'll proceed without setting global options
  }
}
if (typeof setGlobalOptions === 'function') {
  try { setGlobalOptions({ maxInstances: 10 }); } catch (e) { console.warn('setGlobalOptions failed', e); }
}

const { onValueCreated } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
admin.initializeApp();

// Minimal class templates so the function can seed matches with class-specific stats
const CLASS_STATS = {
  warrior: { hp: 120, maxHp: 120, baseAtk: 12, defense: 4, abilities: ['warrior_rend', 'warrior_shout'], mana: 0 },
  mage:    { hp: 80,  maxHp: 80,  baseAtk: 16, defense: 1, abilities: ['mage_fireball', 'mage_iceblast'], mana: 30 },
  archer:  { hp: 95,  maxHp: 95,  baseAtk: 14, defense: 2, abilities: ['archer_volley', 'archer_poison'], mana: 0 }
};

exports.onQueueJoin = onValueCreated("/queue/{uid}", async (event) => {
  const joiningUid = event.params.uid;
  const db = admin.database();
  const queueRef = db.ref("queue");

  let opponentUid = null;
  let joiningPayload = null;
  let opponentPayload = null;

  await queueRef.transaction(queue => {
    // handle null queue
    if (!queue) queue = {};

    // get the waiting ids that aren't the onQueueJoin user
    const waiting = Object.keys(queue).filter(id => id !== joiningUid);

    if (waiting.length === 0) {
      // nothing to match
      return queue;
    }

    // just grab first waiting player for now
    // TODO: match based on time waiting, rank, etc
    opponentUid = waiting[0];

    // capture payloads from the queue entries (if present) so we can read selectedClass deterministically
    try {
      joiningPayload = queue[joiningUid] || null;
      opponentPayload = queue[opponentUid] || null;
    } catch (e) {
      joiningPayload = null;
      opponentPayload = null;
    }

    // remove matched players from queue
    delete queue[opponentUid];
    delete queue[joiningUid];

    // return new queue
    return queue;
  });

  if (!opponentUid) {
    // no match was made
    return;
  }

  // create match
  const matchRef = db.ref("matches").push();
  const matchId = matchRef.key;

  // Initialize match with game state
  await matchRef.set({
    p1: joiningUid,
    p2: opponentUid,
    createdAt: Date.now(),
    currentTurn: joiningUid, // First player to join goes first
    turnCounter: 0,
    status: "active",
    lastMove: null,
    message: ""
  });

  // Initialize player states
  // Prefer selectedClass from the queue payload (written by client when enqueueing).
  // Fall back to users/<uid>/selectedClass, then to 'warrior'.
  let class1 = 'warrior';
  let class2 = 'warrior';
  try {
    if (joiningPayload && joiningPayload.selectedClass) {
      class1 = joiningPayload.selectedClass;
    } else {
      const s1snap = await db.ref(`users/${joiningUid}/selectedClass`).once('value');
      if (s1snap.exists()) class1 = s1snap.val();
    }

    if (opponentPayload && opponentPayload.selectedClass) {
      class2 = opponentPayload.selectedClass;
    } else {
      const s2snap = await db.ref(`users/${opponentUid}/selectedClass`).once('value');
      if (s2snap.exists()) class2 = s2snap.val();
    }
  } catch (e) {
    console.error('Error determining selectedClass for players:', e);
  }

  console.log('Match seeding classes:', { joiningUid, class1, opponentUid, class2, joiningPayload, opponentPayload });

  const t1 = CLASS_STATS[class1] || CLASS_STATS.warrior;
  const t2 = CLASS_STATS[class2] || CLASS_STATS.warrior;

  await db.ref(`matches/${matchId}/players/${joiningUid}`).set({
    hp: t1.hp,
    maxHp: t1.maxHp,
    baseAtk: t1.baseAtk,
    defense: t1.defense,
    attackBoost: 0,
    fainted: false,
    name: null, // Will be set by client
    classId: class1,
    abilities: t1.abilities,
    abilityCooldowns: {},
    status: {},
    mana: t1.mana || 0,
    maxMana: t1.mana || 0
  });

  await db.ref(`matches/${matchId}/players/${opponentUid}`).set({
    hp: t2.hp,
    maxHp: t2.maxHp,
    baseAtk: t2.baseAtk,
    defense: t2.defense,
    attackBoost: 0,
    fainted: false,
    name: null, // Will be set by client
    classId: class2,
    abilities: t2.abilities,
    abilityCooldowns: {},
    status: {},
    mana: t2.mana || 0,
    maxMana: t2.mana || 0
  });

  // set match on both users
  await db.ref(`users/${joiningUid}/currentMatch`).set(matchId);
  await db.ref(`users/${opponentUid}/currentMatch`).set(matchId);
});

