const { setGlobalOptions } = require("firebase-functions/v2/options");
setGlobalOptions({ maxInstances: 10 });

const { onValueCreated, onValueWritten } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
admin.initializeApp();

const DEFAULT_CLASS = "warrior";
const CLASS_PRESETS = {
  warrior: {
    maxHp: 115,
    physicalAttack: 16,
    magicAttack: 6,
    physicalDefense: 12,
    magicDefense: 8,
    speed: 9,
    critChance: 0.1,
    evasion: 0.05,
    defense: 0,
    attackBoost: 0
  },
  mage: {
    maxHp: 95,
    physicalAttack: 7,
    magicAttack: 18,
    physicalDefense: 7,
    magicDefense: 12,
    speed: 11,
    critChance: 0.12,
    evasion: 0.08,
    defense: 0,
    attackBoost: 3
  },
  archer: {
    maxHp: 105,
    physicalAttack: 15,
    magicAttack: 10,
    physicalDefense: 8,
    magicDefense: 9,
    speed: 15,
    critChance: 0.18,
    evasion: 0.12,
    defense: 0,
    attackBoost: 1
  },
  cleric: {
    maxHp: 110,
    physicalAttack: 11,
    magicAttack: 15,
    physicalDefense: 10,
    magicDefense: 12,
    speed: 10,
    critChance: 0.1,
    evasion: 0.08,
    defense: 0,
    attackBoost: 0
  },
  thief: {
    maxHp: 100,
    physicalAttack: 16,
    magicAttack: 9,
    physicalDefense: 8,
    magicDefense: 8,
    speed: 17,
    critChance: 0.2,
    evasion: 0.15,
    defense: 0,
    attackBoost: 2
  },
  monk: {
    maxHp: 108,
    physicalAttack: 14,
    magicAttack: 12,
    physicalDefense: 10,
    magicDefense: 10,
    speed: 13,
    critChance: 0.12,
    evasion: 0.1,
    defense: 0,
    attackBoost: 1
  },
};

const ITEM_POOL = [
  { id: "healing_potion", label: "Healing Potion", type: "heal", amount: 25 },
  { id: "power_elixir", label: "Power Elixir", type: "buff", attackBoost: 6 },
  { id: "iron_skin", label: "Iron Skin", type: "guard", defense: 12 },
  { id: "swift_boots", label: "Swift Boots", type: "speed", speed: 4 },
  { id: "focus_charm", label: "Focus Charm", type: "crit", critChance: 0.08 },
];

function buildPlayerState(profile = {}) {
  const playerClass = profile.class || DEFAULT_CLASS;
  const preset = CLASS_PRESETS[playerClass] || CLASS_PRESETS[DEFAULT_CLASS];

  return {
    hp: preset.maxHp,
    maxHp: preset.maxHp,
    physicalAttack: preset.physicalAttack,
    magicAttack: preset.magicAttack,
    physicalDefense: preset.physicalDefense,
    magicDefense: preset.magicDefense,
    speed: preset.speed,
    critChance: preset.critChance,
    evasion: preset.evasion,
    defense: preset.defense,
    attackBoost: preset.attackBoost,
    fainted: false,
    name: null, // Set by clients
    class: playerClass,
  };
}

function pickFirstTurn(p1Id, p2Id, p1State, p2State) {
  const p1Speed = p1State.speed || 0;
  const p2Speed = p2State.speed || 0;
  if (p1Speed > p2Speed) return p1Id;
  if (p2Speed > p1Speed) return p2Id;
  return Math.random() < 0.5 ? p1Id : p2Id;
}

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

  // Grab player profiles for class-based stats
  const [joiningProfileSnap, opponentProfileSnap] = await Promise.all([
    db.ref(`users/${joiningUid}`).get(),
    db.ref(`users/${opponentUid}`).get(),
  ]);

  const joiningProfile = joiningProfileSnap.val() || {};
  const opponentProfile = opponentProfileSnap.val() || {};

  const joiningState = buildPlayerState(joiningProfile);
  const opponentState = buildPlayerState(opponentProfile);
  const firstTurn = pickFirstTurn(joiningUid, opponentUid, joiningState, opponentState);

  // Initialize match with game state
  await matchRef.set({
    p1: joiningUid,
    p2: opponentUid,
    createdAt: Date.now(),
    currentTurn: firstTurn,
    turnCounter: 0,
    status: "active",
    lastMove: null,
    message: ""
  });

  // Initialize player states
  await db.ref(`matches/${matchId}/players/${joiningUid}`).set(joiningState);

  await db.ref(`matches/${matchId}/players/${opponentUid}`).set(opponentState);

  // set match on both users
  await db.ref(`users/${joiningUid}/currentMatch`).set(matchId);
  await db.ref(`users/${opponentUid}/currentMatch`).set(matchId);
});

exports.onMatchFinished = onValueWritten("/matches/{matchId}/status", async (event) => {
  const prev = event.data?.before?.val();
  const next = event.data?.after?.val();
  if (prev === "finished" || next !== "finished") {
    return;
  }

  const matchId = event.params.matchId;
  const db = admin.database();
  const matchSnap = await db.ref(`matches/${matchId}`).get();
  const match = matchSnap.val() || {};

  if (match.winRecorded) return;

  const winner = match.winner;
  const p1 = match.p1;
  const p2 = match.p2;
  if (!winner || !p1 || !p2) return;

  const loser = winner === p1 ? p2 : p1;

  await Promise.all([
    db.ref(`users/${winner}/wins`).transaction((current) => {
      const value = typeof current === "number" ? current : 0;
      return value + 1;
    }),
    db.ref(`users/${loser}/losses`).transaction((current) => {
      const value = typeof current === "number" ? current : 0;
      return value + 1;
    }),
  ]);

  // Chance to award an item to the winner
  if (Math.random() < 0.6) {
    const item = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)];
    if (item) {
      await db.ref(`users/${winner}/items`).push({
        ...item,
        awardedAt: Date.now(),
      });
    }
  }

  await db.ref(`matches/${matchId}/winRecorded`).set(true);
});
