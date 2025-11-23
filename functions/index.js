const { setGlobalOptions } = require("firebase-functions/v2/options");
setGlobalOptions({ maxInstances: 10 });

const { onValueCreated } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
admin.initializeApp();

exports.onQueueJoin = onValueCreated("/queue/{uid}", async (event) => {
  const joiningUid = event.params.uid;
  const db = admin.database();
  const queueRef = db.ref("queue");

  let opponentUid = null;

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
  await db.ref(`matches/${matchId}/players/${joiningUid}`).set({
    hp: 100,
    maxHp: 100,
    defense: 0,
    attackBoost: 0,
    fainted: false,
    name: null // Will be set by client
  });

  await db.ref(`matches/${matchId}/players/${opponentUid}`).set({
    hp: 100,
    maxHp: 100,
    defense: 0,
    attackBoost: 0,
    fainted: false,
    name: null // Will be set by client
  });

  // set match on both users
  await db.ref(`users/${joiningUid}/currentMatch`).set(matchId);
  await db.ref(`users/${opponentUid}/currentMatch`).set(matchId);
});

