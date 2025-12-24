const { setGlobalOptions } = require("firebase-functions/v2/options");
setGlobalOptions({ maxInstances: 10 });

const { onValueCreated, onValueWritten } = require("firebase-functions/v2/database");
const admin = require("firebase-admin");
admin.initializeApp();

// Minimal class templates so the function can seed matches with class-specific stats
const CLASS_STATS = {
  warrior: { hp: 120, maxHp: 120, baseAtk: 12, defense: 4, speed: 5, critChance: 0.04, evasion: 0.02, abilities: ['warrior_rend', 'warrior_shout', 'warrior_whirlwind'], mana: 0 },
  mage:    { hp: 80,  maxHp: 80,  baseAtk: 16, defense: 1, speed: 6, critChance: 0.06, evasion: 0.03, abilities: ['mage_fireball', 'mage_iceblast', 'mage_arcane_burst'], mana: 30 },
  archer:  { hp: 95,  maxHp: 95,  baseAtk: 14, defense: 2, speed: 8, critChance: 0.12, evasion: 0.06, abilities: ['archer_volley', 'archer_poison', 'archer_trap'], mana: 0 },
  cleric:  { hp: 90,  maxHp: 90,  baseAtk: 8,  defense: 2, speed: 5, critChance: 0.03, evasion: 0.02, abilities: ['cleric_heal', 'cleric_smite', 'cleric_shield'], mana: 30 },
  knight:  { hp: 140, maxHp: 140, baseAtk: 13, defense: 6, speed: 4, critChance: 0.03, evasion: 0.01, abilities: ['knight_guard', 'knight_charge', 'knight_bastion'], mana: 0 },
  rogue:   { hp: 85,  maxHp: 85,  baseAtk: 18, defense: 1, speed: 9, critChance: 0.15, evasion: 0.08, abilities: ['rogue_backstab', 'rogue_poisoned_dagger', 'rogue_evade'], mana: 0 },
  paladin: { hp: 130, maxHp: 130, baseAtk: 11, defense: 5, speed: 5, critChance: 0.04, evasion: 0.02, abilities: ['paladin_aura', 'paladin_holy_strike', 'paladin_bless'], mana: 15 },
  necromancer: { hp: 80, maxHp: 80, baseAtk: 10, defense: 2, speed: 6, critChance: 0.05, evasion: 0.03, abilities: ['necro_summon_skeleton', 'necro_spirit_shackles', 'necro_dark_inversion'], mana: 40 },
  druid:   { hp: 100, maxHp: 100, baseAtk: 12, defense: 2, speed: 6, critChance: 0.05, evasion: 0.04, abilities: ['druid_entangle', 'druid_regrowth', 'druid_barkskin'], mana: 30 },
  dark_mage: { hp: 75, maxHp: 75, baseAtk: 12, defense: 1, speed: 6, critChance: 0.05, evasion: 0.03, abilities: ['necro_siphon', 'necro_raise', 'necro_curse'], mana: 35 },
  monk:    { hp: 105, maxHp: 105, baseAtk: 20, defense: 3, speed: 8, critChance: 0.07, evasion: 0.05, abilities: ['monk_flurry', 'monk_stunning_blow', 'monk_quivering_palm'], mana: 20 },
  wild_magic_sorcerer: { hp: 85, maxHp: 85, baseAtk: 14, defense: 1, speed: 6, critChance: 0.06, evasion: 0.03, abilities: ['wild_attack', 'wild_buff', 'wild_arcanum'], mana: 40 }
  
  ,valkyrie: { hp: 130, maxHp: 130, baseAtk: 14, defense: 3, speed: 8, critChance: 0.06, evasion: 0.05, abilities: ['valkyrie_spear', 'valkyrie_aerial_sweep', 'valkyrie_guard'], mana: 30 }
  ,artificer: { hp: 125, maxHp: 125, baseAtk: 16, defense: 6, speed: 5, critChance: 0.06, evasion: 0.03, abilities: ['artificer_turret', 'artificer_shock', 'artificer_repair_field'], mana: 40 }
  ,barbarian: { hp: 140, maxHp: 140, baseAtk: 12, defense: 1, speed: 6, critChance: 0.05, evasion: 0.02, abilities: ['barbarian_berserk_slam', 'barbarian_war_cry', 'barbarian_reckless_strike'], mana: 0 }
};

// Server no longer awards gameplay items automatically; client-side chooser
// handles item awarding so we keep ITEM_POOL empty here to avoid duplicate
// awards. If new server-side rewards are desired in future, add them here.
//const ITEM_POOL = [];

function pickFirstTurn(p1Id, p2Id, p1State = {}, p2State = {}) {
  const p1Speed = (p1State.speed || p1State.baseAtk || 0) || 0;
  const p2Speed = (p2State.speed || p2State.baseAtk || 0) || 0;
  if (p1Speed > p2Speed) return p1Id;
  if (p2Speed > p1Speed) return p2Id;
  return Math.random() < 0.5 ? p1Id : p2Id;
}

// (CLASS_STATS values are defined in the main object above)

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

    try {
      joiningPayload = queue[joiningUid] || null;
      opponentPayload = queue[opponentUid] || null;
    } catch {
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

  // Initialize match with game state. Set a safe default for currentTurn
  // (joining player) and then adjust it after seeding player stats so we can
  // decide first turn based on speeds without referencing undefined values.
  await matchRef.set({
    p1: joiningUid,
    p2: opponentUid,
    createdAt: Date.now(),
    currentTurn: joiningUid,
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

  // Now that we know class templates (and their speeds), pick who goes first and
  // update the match node accordingly.
  try {
    const firstTurn = pickFirstTurn(joiningUid, opponentUid, t1, t2);
    await db.ref(`matches/${matchId}/currentTurn`).set(firstTurn);
  } catch (e) {
    console.error('Could not pick first turn based on stats, keeping default:', e);
  }

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

// When a match status transitions to 'finished', record wins/losses and
// optionally award the winner with an item drawn from ITEM_POOL.
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

  // Note: item awarding is intentionally handled client-side to allow the
  // winner to choose a reward. Server will not award items here to avoid
  // duplicate awards.

  await db.ref(`matches/${matchId}/winRecorded`).set(true);
});

