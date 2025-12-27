/* eslint-disable no-unused-vars, no-empty, no-undef */
const { setGlobalOptions } = require("firebase-functions/v2/options");
setGlobalOptions({ maxInstances: 10 });

const { onValueCreated, onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require("firebase-admin");
admin.initializeApp();

// Minimal class templates so the function can seed matches with class-specific stats
// (CLASS_STATS will be defined below with the actual player stats)
const CLASS_STATS = {
  warrior: { name: 'Warrior', hp: 210, maxHp: 210, baseAtk: 24, defense: 9, speed: 5, critChance: 0.04, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['warrior_rend', 'warrior_shout', 'warrior_whirlwind'] },
  mage:    { name: 'Mage',    hp: 120, maxHp: 120, baseAtk: 24, defense: 2, speed: 6, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['mage_fireball', 'mage_iceblast', 'mage_arcane_burst'], mana: 30 },
  archer:  { name: 'Archer',  hp: 143, maxHp: 143, baseAtk: 21, defense: 3, speed: 8, critChance: 0.12, evasion: 0.06, attackBoost: 0, fainted: false, abilities: ['archer_volley', 'archer_poison', 'archer_trap'] },
  cleric:  { name: 'Cleric',  hp: 135, maxHp: 135, baseAtk: 12, defense: 3, speed: 5, critChance: 0.03, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['cleric_heal', 'cleric_smite', 'cleric_shield'], mana: 30 },
  knight:  { name: 'Knight',  hp: 210, maxHp: 210, baseAtk: 20, defense: 9, speed: 4, critChance: 0.03, evasion: 0.01, attackBoost: 0, fainted: false, abilities: ['knight_guard', 'knight_charge', 'knight_bastion'], mana: 0 },
  rogue:   { name: 'Rogue',   hp: 128, maxHp: 128, baseAtk: 27, defense: 2, speed: 9, critChance: 0.15, evasion: 0.08, attackBoost: 0, fainted: false, abilities: ['rogue_backstab', 'rogue_poisoned_dagger', 'rogue_evade'], mana: 0 },
  paladin: { name: 'Paladin', hp: 195, maxHp: 195, baseAtk: 17, defense: 8, speed: 5, critChance: 0.04, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['paladin_aura', 'paladin_holy_strike', 'paladin_bless'], mana: 15 },
  dark_mage: { name: 'Dark Mage', hp: 113, maxHp: 113, baseAtk: 18, defense: 2, speed: 6, critChance: 0.05, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['necro_siphon', 'necro_raise', 'necro_curse'], mana: 35 },
  necromancer: { name: 'Necromancer', hp: 120, maxHp: 120, baseAtk: 15, defense: 3, speed: 6, critChance: 0.05, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['necro_summon_skeleton', 'necro_spirit_shackles', 'necro_dark_inversion'], mana: 40 },
  monk:    { name: 'Monk',    hp: 188, maxHp: 188, baseAtk: 30, defense: 6, speed: 8, critChance: 0.08, evasion: 0.05, attackBoost: 0, fainted: false, abilities: ['monk_flurry', 'monk_stunning_blow', 'monk_quivering_palm'], mana: 20 },
  wild_magic_sorcerer: { name: 'Wild Magic Sorcerer', hp: 128, maxHp: 128, baseAtk: 21, defense: 2, speed: 6, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['wild_attack', 'wild_buff', 'wild_arcanum'], mana: 40 },
  druid:   { name: 'Druid',   hp: 165, maxHp: 165, baseAtk: 21, defense: 5, speed: 6, critChance: 0.05, evasion: 0.04, attackBoost: 0, fainted: false, abilities: ['druid_entangle', 'druid_regrowth', 'druid_barkskin'], mana: 30 },
  artificer: { name: 'Artificer', hp: 140, maxHp: 140, baseAtk: 24, defense: 9, speed: 5, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['artificer_turret','artificer_shock','artificer_repair_field'], mana: 40 },
  valkyrie: { name: 'Valkyrie', hp: 195, maxHp: 195, baseAtk: 21, defense: 5, speed: 8, critChance: 0.06, evasion: 0.05, attackBoost: 0, fainted: false, abilities: ['valkyrie_spear','valkyrie_aerial_sweep','valkyrie_guard'], mana: 30 },
  barbarian: { name: 'Barbarian', hp: 210, maxHp: 210, baseAtk: 22, defense: 4, speed: 6, critChance: 0.05, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['barbarian_berserk_slam','barbarian_war_cry','barbarian_reckless_strike'], mana: 0 }
};

// Minimal ability metadata copied from client so server can enforce cooldowns/costs
const ABILITIES = {
  mage_fireball: { id: 'mage_fireball', cost: 10, cooldown: 3 },
  warrior_rend:  { id: 'warrior_rend',  cost: 0,  cooldown: 3 },
  archer_volley: { id: 'archer_volley', cost: 0,  cooldown: 3 },
  slime_splatter:{ id: 'slime_splatter',cost: 0,  cooldown: 4 },
  gladiator_charge:{id:'gladiator_charge', cost:0, cooldown:4},
  boss_earthquake:{id:'boss_earthquake', cost:0, cooldown:5},
  mage_iceblast:  { id: 'mage_iceblast', cost: 8, cooldown: 4 },
  warrior_shout:  { id: 'warrior_shout', cost: 0, cooldown: 5 },
  archer_poison:  { id: 'archer_poison', cost: 0, cooldown: 4 },
  cleric_heal: { id: 'cleric_heal', cost: 8, cooldown: 3 },
  cleric_smite: { id: 'cleric_smite', cost: 6, cooldown: 4 },
  warrior_whirlwind: { id: 'warrior_whirlwind', cost: 0, cooldown: 4 },
  mage_arcane_burst: { id: 'mage_arcane_burst', cost: 12, cooldown: 5 },
  archer_trap: { id: 'archer_trap', cost: 0, cooldown: 5 },
  cleric_shield: { id: 'cleric_shield', cost: 6, cooldown: 5 },
  knight_bastion: { id: 'knight_bastion', cost: 0, cooldown: 6 },
  rogue_evade: { id: 'rogue_evade', cost: 0, cooldown: 4 },
  paladin_bless: { id: 'paladin_bless', cost: 8, cooldown: 5 },
  art: { id: 'art', cost: 0, cooldown: 3 },
  // additional abilities from CLASS_STATS (defaults)
  knight_guard: { id: 'knight_guard', cost: 0, cooldown: 4 },
  knight_charge: { id: 'knight_charge', cost: 0, cooldown: 4 },
  rogue_backstab: { id: 'rogue_backstab', cost: 0, cooldown: 3 },
  rogue_poisoned_dagger: { id: 'rogue_poisoned_dagger', cost: 0, cooldown: 4 },
  paladin_aura: { id: 'paladin_aura', cost: 0, cooldown: 5 },
  paladin_holy_strike: { id: 'paladin_holy_strike', cost: 6, cooldown: 4 },
  necro_summon_skeleton: { id: 'necro_summon_skeleton', cost: 0, cooldown: 6 },
  necro_spirit_shackles: { id: 'necro_spirit_shackles', cost: 0, cooldown: 4 },
  necro_dark_inversion: { id: 'necro_dark_inversion', cost: 0, cooldown: 5 },
  monk_flurry: { id: 'monk_flurry', cost: 0, cooldown: 3 },
  monk_stunning_blow: { id: 'monk_stunning_blow', cost: 0, cooldown: 4 },
  monk_quivering_palm: { id: 'monk_quivering_palm', cost: 0, cooldown: 6 },
  wild_attack: { id: 'wild_attack', cost: 0, cooldown: 3 },
  wild_buff: { id: 'wild_buff', cost: 0, cooldown: 4 },
  wild_arcanum: { id: 'wild_arcanum', cost: 0, cooldown: 5 },
  druid_entangle: { id: 'druid_entangle', cost: 0, cooldown: 3 },
  druid_regrowth: { id: 'druid_regrowth', cost: 0, cooldown: 4 },
  druid_barkskin: { id: 'druid_barkskin', cost: 0, cooldown: 5 },
  artificer_turret: { id: 'artificer_turret', cost: 0, cooldown: 5 },
  artificer_shock: { id: 'artificer_shock', cost: 0, cooldown: 3 },
  artificer_repair_field: { id: 'artificer_repair_field', cost: 0, cooldown: 6 },
  valkyrie_spear: { id: 'valkyrie_spear', cost: 0, cooldown: 3 },
  valkyrie_aerial_sweep: { id: 'valkyrie_aerial_sweep', cost: 0, cooldown: 4 },
  valkyrie_guard: { id: 'valkyrie_guard', cost: 0, cooldown: 5 },
  barbarian_berserk_slam: { id: 'barbarian_berserk_slam', cost: 0, cooldown: 4 },
  barbarian_war_cry: { id: 'barbarian_war_cry', cost: 0, cooldown: 5 },
  barbarian_reckless_strike: { id: 'barbarian_reckless_strike', cost: 0, cooldown: 3 },
  necro_siphon: { id: 'necro_siphon', cost: 0, cooldown: 4 },
  necro_raise: { id: 'necro_raise', cost: 0, cooldown: 4 },
  necro_curse: { id: 'necro_curse', cost: 0, cooldown: 4 }
};

function abilityCostById(id) {
  try { return (ABILITIES && ABILITIES[id] && ABILITIES[id].cost) ? ABILITIES[id].cost : 0; } catch (err) { console.debug('abilityCostById error', err); return 0; }
}

// Simple gear slots (subset matching client slots) used to generate AI items
const GEAR_SLOTS = ['helmet','chestplate','bracers','pants','boots','ring1','ring2','necklace','left_weapon','right_weapon','ranged','shield'];
// Generation-time scaling constants: these are applied to the item at creation
// so displayed baseStatValue already reflects HP x4 / defense x1.4 as requested.
const GEN_HP_FACTOR = 4.0;
const GEN_DEFENSE_FACTOR = 1.4;

// Word pool used to generate nicer AI names. We'll produce names like
// "word_wordDDDD" (two words separated by '_' followed by 4 random digits).
const AI_WORDS = ['zyra','korr','thalen','nyx','riven','astra','morro','ilara','vex','galan','orin','sera','fen','liora','bram','silver','ember','shadow','crimson','lunar','storm','stone','iron','swift','frost','flame','gale','thorn','rune','oak','spry'];

function generateAiName() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const w1 = pick(AI_WORDS);
  const w2 = pick(AI_WORDS);
  const digits = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  // Capitalize first letters for readability
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  return `${cap(w1)}_${cap(w2)}${digits}`;
}

function randBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function simpleGearId() { return 'g_' + Math.random().toString(36).substr(2,8); }

function generateSimpleGear(slot) {
  if (!slot || GEAR_SLOTS.indexOf(slot) === -1) slot = GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)];
  const rarity = (Math.random() < 0.9) ? 'common' : ((Math.random() < 0.5) ? 'uncommon' : 'rare');
  // pick a base stat and small magnitude so effects are meaningful but not overpowering
  const baseChoices = { attack: [2,6], defense: [2,8], hp: [6,18], regen: [1,6] };
  const statNames = Object.keys(baseChoices);
  const pick = statNames[Math.floor(Math.random() * statNames.length)];
  const range = baseChoices[pick];
  const baseVal = randBetween(range[0], range[1]);
  // Apply generation-time scaling for HP/defense so the stored item value
  // represents the effective stat directly.
  let scaledBaseVal = baseVal;
  if (pick === 'hp') scaledBaseVal = Math.max(1, Math.round(baseVal * GEN_HP_FACTOR));
  else if (pick === 'defense') scaledBaseVal = Math.max(1, Math.round(baseVal * GEN_DEFENSE_FACTOR));
  const item = {
    id: simpleGearId(),
    name: `${rarity} ${slot}`,
    slot: slot,
    baseStatName: pick,
  baseStatValue: scaledBaseVal,
    // compact randStats choice indices to match client format (0..totalChoices-1)
    randStats: [],
    element: 'neutral',
    rarity,
    enchants: [],
    createdAt: Date.now()
  };
  // add 0..2 randStats choices for variety
  try {
    const totalChoices = 33; // approximate client compact choice space (11 types * 3 variants)
    const count = Math.floor(Math.random() * 3); // 0,1,2
    for (let i = 0; i < count; i++) {
      const choice = Math.floor(Math.random() * totalChoices);
      item.randStats.push({ choice });
    }
    // small chance to add an enchant
    if (Math.random() < 0.18) {
      const enchantPool = ['regen','lifesteal','critChance','evasion','maxHpPercent','speed','pierce','manaRegen'];
      const e = enchantPool[Math.floor(Math.random() * enchantPool.length)];
  item.enchants.push({ type: e, value: Math.max(1, Math.floor(scaledBaseVal * (0.2 + Math.random() * 0.8))) });
    }
  } catch (e) { void e; }
  return item;
}

// Compute simple equip mods from a user's gear and equipped map and write them
// into the match player's node so server-side combat uses gear effects.
async function applyEquipModsToMatchPlayer(db, matchId, uid) {
  try {
    const equippedSnap = await db.ref(`matches/${matchId}/players/${uid}/equipped`).get();
    if (!equippedSnap.exists()) return;
    const equipped = equippedSnap.val() || {};
    const gearKeys = Object.values(equipped).filter(Boolean);
    if (!gearKeys.length) return;

    const mods = { attack: 0, defense: 0, maxHp: 0, regen: 0 };
    const enchants = [];
  // Gear scaling constants applied equally to players and AI in match-time aggregation.
  // ATTACK_FACTOR reduces attack contributions from gear to avoid overpowering baseAtk.
  // HP_FACTOR increases HP contributions (user requested ~x3).
  // NOTE: attack scaling is disabled (1.0) to ensure players see the same
  // raw attack numbers on their gear. Set to <1 to reduce attack impact.
  const ATTACK_FACTOR = 1.0; // 1.0 == no scaling of attack contributions
  const DEFENSE_FACTOR = 1.0; // no modifier-time defense scaling (values baked into gear)
  const HP_FACTOR = 1.0; // no modifier-time HP scaling (values baked into gear)
    for (const gearId of gearKeys) {
      try {
        const gsnap = await db.ref(`users/${uid}/gear/${gearId}`).get();
        if (!gsnap.exists()) continue;
        const g = gsnap.val() || {};
        const stat = g.baseStatName;
        const val = Number(g.baseStatValue || 0);
  if (stat === 'attack') mods.attack += Math.round(val * ATTACK_FACTOR);
  else if (stat === 'defense') mods.defense += Math.round(val * DEFENSE_FACTOR);
  else if (stat === 'hp') mods.maxHp += Math.round(val * HP_FACTOR);
        else if (stat === 'regen') mods.regen += val;
        // collect enchants for potential later use
        if (Array.isArray(g.enchants)) {
          for (const e of g.enchants) enchants.push(e);
        }
  } catch (e) { void e; /* best-effort */ }
    }

    // Write equip mods and enchants into the match player node
    const updates = {};
    updates[`matches/${matchId}/players/${uid}/_equipMods`] = mods;
    if (enchants.length) updates[`matches/${matchId}/players/${uid}/_equipEnchants`] = enchants;

    // Adjust maxHp/hp locally in match player to reflect gear HP bonuses
    try {
      const playerSnap = await db.ref(`matches/${matchId}/players/${uid}`).get();
      if (playerSnap.exists()) {
        const p = playerSnap.val() || {};
        const curMax = Number(p.maxHp || 0);
        const curHp = Number(p.hp || 0);
        const newMax = Math.max(1, curMax + (mods.maxHp || 0));
        const newHp = Math.min(newMax, curHp + (mods.maxHp || 0));
        updates[`matches/${matchId}/players/${uid}/maxHp`] = newMax;
        updates[`matches/${matchId}/players/${uid}/hp`] = newHp;
      }
  } catch (e) { void e; }

    await db.ref().update(updates);
  } catch (e) {
    console.error('applyEquipModsToMatchPlayer failed', matchId, uid, e);
  }
}

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
    } catch (e) { void e; joiningPayload = null; opponentPayload = null; }

    // remove matched players from queue
    delete queue[opponentUid];
    delete queue[joiningUid];

    // return new queue
    return queue;
  });

  if (!opponentUid) {
    // no immediate human opponent was found
    // If the client requested an instant AI match (forceAi), create it now.
    try {
      // joiningPayload may be null when the transaction didn't find any waiting players.
      // Read the queue entry for the joining user to see if they requested forceAi.
      if (!joiningPayload) {
        try {
          const snap = await queueRef.child(joiningUid).get();
          joiningPayload = snap.exists() ? snap.val() : null;
        } catch (e) { void e; }
      }

      if (joiningPayload && joiningPayload.forceAi) {
  // best-effort: remove user from the queue entry we just created
  try { await queueRef.child(joiningUid).remove(); } catch (e) { void e; }

        // Create a match pairing this user with an AI (reuse scheduled watcher logic)
        const matchRef = db.ref('matches').push();
        const matchId = matchRef.key;
        const aiUid = `ai_${Math.random().toString(36).substr(2,8)}`;

        // Determine player's selected class (prefer payload.selectedClass)
        let playerClass = 'warrior';
        try {
          if (joiningPayload && joiningPayload.selectedClass) playerClass = joiningPayload.selectedClass;
          else {
            const s = await db.ref(`users/${joiningUid}/selectedClass`).get();
            if (s.exists()) playerClass = s.val();
          }
        } catch (e) { void e; }

        const t1 = CLASS_STATS[playerClass] || CLASS_STATS.warrior;
        const classKeys = Object.keys(CLASS_STATS || {});
        const aiClass = classKeys[Math.floor(Math.random() * classKeys.length)];
        const t2 = CLASS_STATS[aiClass] || CLASS_STATS.warrior;

        await matchRef.set({
          p1: joiningUid,
          p2: aiUid,
          createdAt: Date.now(),
          currentTurn: joiningUid,
          turnCounter: 0,
          status: 'active',
          lastMove: null,
          message: ''
        });

        await db.ref(`matches/${matchId}/players/${joiningUid}`).set({
          hp: t1.hp,
          maxHp: t1.maxHp,
          baseAtk: t1.baseAtk,
          defense: t1.defense,
          attackBoost: 0,
          fainted: false,
          name: null,
          classId: playerClass,
          abilities: t1.abilities,
          abilityCooldowns: {},
          status: {},
          mana: t1.mana || 0,
          maxMana: t1.mana || 0
        });

        await db.ref(`matches/${matchId}/players/${aiUid}`).set({
          hp: Math.max(1, (t2.hp || 0)),
          maxHp: Math.max(1, (t2.maxHp || t2.hp || 0)),
          baseAtk: t2.baseAtk,
          defense: t2.defense,
          attackBoost: 0,
          fainted: false,
          name: generateAiName(),
          classId: aiClass,
          abilities: t2.abilities,
          abilityCooldowns: {},
          status: {},
          mana: t2.mana || 0,
          maxMana: t2.mana || 0
        });

        await db.ref(`users/${joiningUid}/currentMatch`).set(matchId);

        try {
          const firstTurn = pickFirstTurn(joiningUid, aiUid, t1, t2);
          await db.ref(`matches/${matchId}/currentTurn`).set(firstTurn);
        } catch (e) { void e; }

        console.log(`Created Quick AI match ${matchId} for ${joiningUid} vs ${aiUid}`);

        // Seed AI gear asynchronously similar to scheduled watcher
        (async () => {
          try {
            // wait briefly for player to write equipped map (up to ~6s)
            const maxRetries = 12;
            let retry = 0;
            let playerEq = null;
            while (retry < maxRetries) {
              try {
                const snap = await db.ref(`matches/${matchId}/players/${joiningUid}/equipped`).get();
                if (snap.exists()) { playerEq = snap.val() || {}; break; }
              } catch (e) { void e; }
              await new Promise(r => setTimeout(r, 500));
              retry++;
            }

            const playerCount = playerEq ? Object.keys(playerEq || {}).filter(Boolean).length : 0;
            const gearCount = playerCount > 0 ? playerCount : 3;
            const equippedMap = {};
            const slotPool = GEAR_SLOTS.slice();
            for (let i = 0; i < gearCount; i++) {
              const slotIdx = Math.floor(Math.random() * slotPool.length);
              const slot = slotPool.splice(slotIdx, 1)[0] || GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)];
              const g = generateSimpleGear(slot);
              try {
                await db.ref(`users/${aiUid}/gear/${g.id}`).set(g);
                equippedMap[slot] = g.id;
              } catch (e) { void e; }
            }
            if (Object.keys(equippedMap || {}).length) {
              try { await db.ref(`matches/${matchId}/players/${aiUid}/equipped`).set(equippedMap); } catch (e) { void e; }
            }

            // apply equip mods to both players
            try { await applyEquipModsToMatchPlayer(db, matchId, aiUid); } catch (e) { void e; }
            try { await applyEquipModsToMatchPlayer(db, matchId, joiningUid); } catch (e) { void e; }
          } catch (e) { console.error('Quick match AI gear seed failed', e); }
        })();

        return;
      }
  } catch (e) { void e; /* best-effort */ }

    // no match was made — ensure we record when the player joined the queue
    try {
      const existing = await queueRef.child(joiningUid).get();
      if (!existing.exists() || !existing.val().queuedAt) {
        await queueRef.child(joiningUid).update({ queuedAt: Date.now() });
      }
  } catch (e) { void e; /* best-effort */ }

    // For local emulator convenience only: if running in the Functions emulator,
    // start an in-memory timer that will invoke the same watcher after ~2 minutes.
    // This is intentionally only for local dev — production scheduling should
    // rely on Cloud Scheduler / the exported scheduled watcher.
    try {
      if (typeof process !== 'undefined' && (process.env && (process.env.FUNCTIONS_EMULATOR || process.env.FIREBASE_EMULATOR_HOST))) {
        // Local dev timer: 1 minute (matches scheduler threshold for quicker local testing)
        const delayMs = 1 * 60 * 1000;
        setTimeout(() => {
          try { scheduledQueueWatcherImpl(); } catch (ee) { console.error('Local timer scheduledQueueWatcherImpl failed', ee); }
        }, delayMs);
      }
  } catch (e) { void e; /* ignore env check failures */ }

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

  // asynchronously apply equip mods for both players when they (or their clients)
  // write an 'equipped' map into the match node. This ensures server combat
  // calculations include gear bonuses for human-vs-human matches as well.
  (async () => {
    try {
      const maxRetries = 12; // ~6 seconds
      let retry = 0;
      let p1Eq = null; let p2Eq = null;
      while (retry < maxRetries) {
        try {
          const s1 = await db.ref(`matches/${matchId}/players/${joiningUid}/equipped`).get();
          const s2 = await db.ref(`matches/${matchId}/players/${opponentUid}/equipped`).get();
          if (s1.exists()) p1Eq = s1.val() || {};
          if (s2.exists()) p2Eq = s2.val() || {};
          if (p1Eq || p2Eq) break;
  } catch (e) { void e; /* ignore transient read errors */ }
        await new Promise(r => setTimeout(r, 500));
        retry++;
      }
      // Apply equip mods for both players (best-effort)
  try { await applyEquipModsToMatchPlayer(db, matchId, joiningUid); } catch (e) { void e; }
  try { await applyEquipModsToMatchPlayer(db, matchId, opponentUid); } catch (e) { void e; }
    } catch (e) { console.error('applyEquipMods background task failed for match', matchId, e); }
  })();
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

// ------------------------------------------------------------
// AI matchmaking and AI turn handler
// ------------------------------------------------------------

// Simple rule-based AI: attack if healthy, heal if low (if heal available), otherwise special when available.
function aiChooseAction(aiState = {}, humanState = {}, aiItems = {}) {
  // If AI has <30% HP and has a healing ability name containing 'heal' or 'repair', prefer heal
  const aiHp = Number(aiState.hp || 0);
  const aiMax = Number(aiState.maxHp || 1);
  const hpPct = aiHp / Math.max(1, aiMax);
  const abilities = Array.isArray(aiState.abilities) ? aiState.abilities : [];

  // Build list of available abilities (off-cooldown)
  const available = abilities.filter(a => {
    try { const cd = (aiState.abilityCooldowns && aiState.abilityCooldowns[a]) || 0; return cd <= 0; } catch (e) { void e; return false; }
  });

  // If low on HP and has consumable potions, prefer using one first
  try {
    const hasSmall = aiItems && aiItems.potion_small && Number(aiItems.potion_small.qty || 0) > 0;
    const hasLarge = aiItems && aiItems.potion_large && Number(aiItems.potion_large.qty || 0) > 0;
    if (hpPct < 0.40 && (hasSmall || hasLarge)) {
      // high chance to use potion when low
      if (Math.random() < 0.95) return { type: 'item', id: hasSmall ? 'potion_small' : 'potion_large' };
    }
  } catch (e) { void e; }

  if (available.length > 0) {
    // If low on HP and a heal is available, prefer it with high probability
    if (hpPct < 0.40) {
      const healAbility = available.find(a => /heal|repair|regrowth|siphon|bless/i.test(a));
      if (healAbility && Math.random() < 0.9) return { type: 'ability', id: healAbility };
    }

    // Otherwise, use any available ability with high probability (>=80%)
    if (Math.random() < 0.8) {
      // pick a random available ability
      const pick = available[Math.floor(Math.random() * available.length)];
      return { type: 'ability', id: pick };
    }
  }

  // fallback to basic attack
  return { type: 'attack' };
}

async function applyAiAttack(db, matchId, aiUid, humanUid, aiState, humanState, match) {
  // Default physical attack calculation
  const aiAtk = Number(aiState.baseAtk || 0) + Number(aiState.attackBoost || 0);
  const humanDef = Number(humanState.defense || 0);
  let damage = Math.max(1, Math.floor(aiAtk - humanDef));
  // keep damage similar to player attacks (random variance 0.9-1.1)
  damage = Math.max(1, Math.floor(damage * (0.9 + Math.random() * 0.2)));

  const updates = {};
  let newHumanHp = Math.max(0, Number(humanState.hp || 0) - damage);

  // If AI used an ability (encoded on aiState.lastDecision maybe) handle it elsewhere; for now support a simple heuristic
  // If the AI has a 'lastDecision' shaped object, support healing behavior
  if (aiState && aiState._plannedAction && aiState._plannedAction.type === 'ability') {
    const abilityId = aiState._plannedAction.id;
    const abil = ABILITIES[abilityId] || null;
    // mark cooldown for ability
    if (abil) {
      updates[`matches/${matchId}/players/${aiUid}/abilityCooldowns/${abilityId}`] = abil.cooldown || 0;
      if (abil.cost) updates[`matches/${matchId}/players/${aiUid}/mana`] = Math.max(0, (aiState.mana || 0) - (abil.cost || 0));
    }
    // healing abilities
    if (/heal|repair|regrowth|bless|siphon/i.test(abilityId)) {
      const healAmt = Math.max(1, Math.floor((Number(aiState.maxHp || 0) || 0) * 0.25) + 8);
      const newAiHp = Math.min(Number(aiState.maxHp || 0), (Number(aiState.hp || 0) + healAmt));
      updates[`matches/${matchId}/players/${aiUid}/hp`] = newAiHp;
      // persist heal metadata and a friendly message
      try {
        const actorName = (aiState && aiState.name) ? aiState.name : aiUid;
        updates[`matches/${matchId}/lastMoveHeal`] = healAmt;
        updates[`matches/${matchId}/lastMoveActor`] = aiUid;
        updates[`matches/${matchId}/message`] = `${actorName} healed for ${healAmt} HP`;
  } catch (e) { void e; /* best-effort */ }
      // do not damage human in this case
    } else {
  // special attack: use a stronger multiplier like client-side behavior
  const actual = Math.floor(damage * 1.5);
  newHumanHp = Math.max(0, Number(humanState.hp || 0) - actual);
      updates[`matches/${matchId}/players/${humanUid}/hp`] = newHumanHp;
      try {
        const actorName = (aiState && aiState.name) ? aiState.name : aiUid;
        const targetName = (humanState && humanState.name) ? humanState.name : humanUid;
        updates[`matches/${matchId}/lastMoveDamage`] = actual;
        updates[`matches/${matchId}/lastMoveActor`] = aiUid;
        updates[`matches/${matchId}/message`] = `${actorName} used ${abilityId} on ${targetName} for ${actual} damage`;
  } catch (e) { void e; /* best-effort */ }
    }
  } else {
    updates[`matches/${matchId}/players/${humanUid}/hp`] = newHumanHp;
    try {
      const actorName = (aiState && aiState.name) ? aiState.name : aiUid;
      const targetName = (humanState && humanState.name) ? humanState.name : humanUid;
      const actual = Math.max(1, Math.floor(aiAtk - humanDef));
      // account for random variance already applied to damage
      const dealt = Math.max(1, Math.floor(newHumanHp < (humanState.hp || 0) ? (humanState.hp || 0) - newHumanHp : actual));
      updates[`matches/${matchId}/lastMoveDamage`] = dealt;
      updates[`matches/${matchId}/lastMoveActor`] = aiUid;
      updates[`matches/${matchId}/message`] = `${actorName} attacked ${targetName} for ${dealt} damage`;
  } catch (e) { void e; /* best-effort */ }
  }

  if ((updates[`matches/${matchId}/players/${humanUid}/hp`] || 0) <= 0) {
    updates[`matches/${matchId}/players/${humanUid}/fainted`] = true;
    updates[`matches/${matchId}/status`] = 'finished';
    updates[`matches/${matchId}/winner`] = aiUid;
  }

  updates[`matches/${matchId}/turnCounter`] = (match.turnCounter || 0) + 1;
  // if human still alive, set next turn to human
  if (!updates[`matches/${matchId}/status`]) updates[`matches/${matchId}/currentTurn`] = humanUid;

  // clear planned action marker for AI
  updates[`matches/${matchId}/players/${aiUid}/_plannedAction`] = null;

  // decrement cooldowns for both actors (if present) so server-side state advances
  try {
    const tickCooldowns = (cdObj) => {
      const out = {};
      if (!cdObj) return out;
      for (const k of Object.keys(cdObj)) {
        const v = Number(cdObj[k] || 0);
        out[k] = Math.max(0, v - 1);
      }
      return out;
    };
    const aiCd = aiState && aiState.abilityCooldowns ? tickCooldowns(aiState.abilityCooldowns) : null;
    const huCd = humanState && humanState.abilityCooldowns ? tickCooldowns(humanState.abilityCooldowns) : null;
    if (aiCd) updates[`matches/${matchId}/players/${aiUid}/abilityCooldowns`] = aiCd;
    if (huCd) updates[`matches/${matchId}/players/${humanUid}/abilityCooldowns`] = huCd;
  } catch (e) { void e; /* best-effort */ }

  await db.ref().update(updates);
}

// Ported utility functions and ability handlers (adapted from client-side `public/js/battle.js`)
function applyDamageToObject(targetObj, rawDamage, opts = {}) {
  const ignoreDefense = !!opts.ignoreDefense;
  const attacker = opts.attacker || null;
  const considerHit = typeof opts.considerHit === 'boolean' ? opts.considerHit : !!attacker;
  const targetEvasion = Number(targetObj.evasion || 0);
  const attackerAccuracy = attacker ? Number(attacker.accuracy || 0) : 0;
  const effectiveEvasion = Math.max(0, targetEvasion - attackerAccuracy);
  let dodged = false;
  if (considerHit && effectiveEvasion > 0) {
    try { if (Math.random() < effectiveEvasion) { dodged = true; return { damage: 0, newHp: targetObj.hp || 0, dodged: true, isCrit: false }; } } catch(e) { void e; }
  }
  const defense = ignoreDefense ? 0 : (targetObj.defense || 0);
  let final = Math.max(0, Math.round(rawDamage - defense));
  let isCrit = false;
  const critChance = attacker ? Number(attacker.critChance || 0) : 0;
  if (considerHit && critChance > 0) {
    try { if (Math.random() < critChance) { isCrit = true; const critBonusPct = Number((attacker && (attacker._critDamageBonus || (attacker._equipEnchants && attacker._equipEnchants.critDamageBonus))) || 0) || 0; const baseMultiplier = 1.5; const multiplier = baseMultiplier + (critBonusPct / 100); final = Math.max(1, Math.round(final * multiplier)); } } catch(e) { void e; }
  }
  const newHp = Math.max(0, (targetObj.hp || 0) - final);
  const defenseAbsorbed = (Number(rawDamage || 0) > 0 && final === 0 && Number(defense || 0) > 0 && !isCrit && !dodged);
  return { damage: final, newHp, isCrit, dodged, defenseAbsorbed };
}

function getEffectiveBaseAtk(user, fallback = 10) {
  if (!user) return fallback;
  let base = null;
  if (typeof user.baseAtk !== 'undefined') base = Number(user.baseAtk);
  else if (typeof user.attack !== 'undefined') base = Number(user.attack);
  else base = Number(fallback || 10);
  try {
    if (user._equipMods && typeof user._equipMods.attack !== 'undefined' && typeof user._orig_baseAtk === 'undefined') {
      base = base + Number(user._equipMods.attack || 0);
    }
  } catch (e) { void e; }
  const temp = (user.status && user.status.strength_boost) ? Number(user.status.strength_boost.amount || 0) : 0;
  return base + temp;
}

function startAbilityCooldownLocal(abilityCooldowns = {}, abilityId) {
  const out = Object.assign({}, abilityCooldowns || {});
  const abil = ABILITIES[abilityId];
  if (!abil) return out;
  out[abilityId] = abil.cooldown || 0;
  return out;
}

function applyDarkInversionToUpdates(playerStats, opponentStats, playerUpdates = {}, opponentUpdates = {}, actingIsPlayer = true) {
  const p = Object.assign({}, playerUpdates);
  const o = Object.assign({}, opponentUpdates);
  try {
    const invertIfNeeded = (updatesObj, targetStats) => {
      if (!updatesObj || typeof updatesObj.hp === 'undefined' || !targetStats) return updatesObj;
      const cur = Number(targetStats.hp || 0);
      const newHp = Number(updatesObj.hp || 0);
      const hasInvert = !!(targetStats.status && targetStats.status.dark_inversion);
      if (!hasInvert) return updatesObj;
      if (newHp < cur) {
        const damage = cur - newHp;
        const maxHp = Number(targetStats.maxHp || targetStats.maxHP || cur || 100);
        updatesObj.hp = Math.min(maxHp, cur + damage);
        if (updatesObj.hp > 0 && updatesObj.fainted) updatesObj.fainted = false;
        return updatesObj;
      }
      if (newHp > cur) {
        const heal = newHp - cur;
        const dmg = heal;
        updatesObj.hp = Math.max(0, cur - dmg);
        if (updatesObj.hp <= 0) updatesObj.fainted = true;
        return updatesObj;
      }
      return updatesObj;
    };
    if (actingIsPlayer) invertIfNeeded(p, playerStats); else invertIfNeeded(o, opponentStats);
  } catch (e) { console.error('applyDarkInversionToUpdates failed', e); }
  return { playerUpdates: p, opponentUpdates: o };
}

// Minimal modern ability handlers (ported from client `modernAbilityHandlers`).
// Each returns { playerUpdates, opponentUpdates, matchUpdates?, message?, lastMoveDamage? }
const modernAbilityHandlers = {
  mage_fireball(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 8) + base + 8;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.burn = { turns: 3, dmg: Math.max(2, Math.floor(base / 3)) };
    opponentUpdates.status = newStatus;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_fireball'), mana: Math.max(0, (user.mana || 0) - abilityCostById('mage_fireball')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_fireball' }, message: `${user.name || 'You'} casts Fireball for ${damage} damage and inflicts burn!`, lastMoveDamage: damage };
  },

  warrior_rend(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 12) + base + 8;
    const effectiveDefense = (target.defense || 0) / 2;
    const final = Math.max(0, Math.round(raw - effectiveDefense));
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: effectiveDefense, evasion: target.evasion || 0 }, final, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_rend') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_rend' }, message: `${user.name || 'You'} rends ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  archer_volley(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    let total = 0;
    for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 6) + Math.floor(base / 2);
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, total, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const amount = 2;
    if (!newStatus.weaken) newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    else { newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount; newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2); }
    opponentUpdates.status = newStatus;
    opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_volley') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_volley' }, message: `${user.name || 'You'} fires a volley for ${damage} total damage!`, lastMoveDamage: damage };
  },

  slime_splatter(user, target) {
    const base = getEffectiveBaseAtk(user, 6);
    const raw = Math.floor(Math.random() * 6) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.slimed = { turns: 3, effect: 'reduce-heal' };
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'slime_splatter') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_slime_splatter' }, message: `Slime splatters for ${damage} and leaves a sticky slime!`, lastMoveDamage: damage };
  },

  gladiator_charge(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 12) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'gladiator_charge') };
    let didStun = false; let message = `${user.name || 'Enemy'} charges for ${damage} damage!`;
    if (Math.random() < 0.3) { const newStatus = Object.assign({}, target.status || {}); newStatus.stun = { turns: 1 }; opponentUpdates.status = newStatus; message = `${user.name || 'Enemy'} charges with a heavy blow for ${damage} — ${target.name || 'the target'} is stunned!`; didStun = true; }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_gladiator_charge' }, message, lastMoveDamage: damage };
  },

  boss_earthquake(user, target) {
    const base = getEffectiveBaseAtk(user, 18);
    const raw = Math.floor(Math.random() * 18) + base + 8;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.stun = { turns: 1 };
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'boss_earthquake') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_boss_earthquake' }, message: `${user.name || 'Enemy'} slams the ground for ${damage} — ${target.name || 'target'} is stunned!`, lastMoveDamage: damage };
  },

  mage_iceblast(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const amount = Math.max(1, Math.floor(base / 4));
    const newStatus = Object.assign({}, target.status || {});
    if (!newStatus.weaken) newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    else { newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount; newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2); }
    opponentUpdates.status = newStatus;
    opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_iceblast'), mana: Math.max(0, (user.mana || 0) - abilityCostById('mage_iceblast')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_iceblast' }, message: `${user.name || 'You'} blasts ${target.name || 'the target'} with ice for ${damage} damage and lowers attack!`, lastMoveDamage: damage };
  },

  warrior_shout(user, target) {
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_shout') };
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 4, amount: 10 };
    playerUpdates.status = newStatus;
    playerUpdates.attackBoost = (user.attackBoost || 0) + 10;
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_warrior_shout' }, message: `${user.name || 'You'} shouts and increases their attack!` };
  },

  cleric_heal(user, target) {
    const healAmt = Math.max(1, Math.floor((Number(user.maxHp || 0) || 0) * 0.20) + 6);
    const newHp = Math.min(Number(user.maxHp || 0), Number(user.hp || 0) + healAmt);
    const newStatus = Object.assign({}, user.status || {});
    if (newStatus.poison) delete newStatus.poison;
    if (newStatus.burn) delete newStatus.burn;
  const playerUpdates = { hp: newHp, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_heal'), mana: Math.max(0, (user.mana || 0) - abilityCostById('cleric_heal')), status: Object.keys(newStatus).length ? newStatus : null };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_cleric_heal' }, message: `${user.name || 'You'} heals for ${healAmt} HP.` };
  },

  cleric_smite(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 10) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const newStatus = Object.assign({}, target.status || {});
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_smite'), mana: Math.max(0, (user.mana || 0) - abilityCostById('cleric_smite')), status: Object.keys(newStatus).length ? newStatus : null };
    const opponentUpdates = { hp: newHp };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_cleric_smite' }, message: `${user.name || 'You'} smites ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  necro_siphon(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 8) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const dealt = damage;
    const healAmt = Math.min(Number(user.maxHp || 0), Number(user.hp || 0) + Math.floor(dealt * 0.5));
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_siphon'), mana: Math.max(0, (user.mana || 0) - abilityCostById('necro_siphon')), hp: healAmt };
    const opponentUpdates = { hp: newHp };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_siphon' }, message: `${user.name || 'You'} siphons ${dealt} life and heals for ${Math.floor(dealt * 0.5)}.`, lastMoveDamage: dealt };
  },

  necro_raise(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp, status: Object.assign({}, target.status || {}, { poison: { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) } }) };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_raise'), mana: Math.max(0, (user.mana || 0) - abilityCostById('necro_raise')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_raise' }, message: `${user.name || 'You'} raises necrotic rot for ${damage} damage and applies rot.`, lastMoveDamage: damage };
  },

  necro_dark_inversion(user, target) {
    const newStatus = Object.assign({}, target.status || {});
    newStatus.dark_inversion = { turns: 3 };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_dark_inversion'), mana: Math.max(0, (user.mana || 0) - abilityCostById('necro_dark_inversion')) };
    const opponentUpdates = { status: newStatus };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_dark_inversion' }, message: `${user.name || 'You'} casts Dark Inversion!` };
  }
};

// Legacy handlers (preferred) copied verbatim from client `public/js/battle.js` LEGACY_ABILITY_HANDLERS
const LEGACY_ABILITY_HANDLERS = {
  mage_fireball(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 8) + base + 8;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
  void isCrit; void dodged;
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.burn = { turns: 3, dmg: Math.max(2, Math.floor(base / 3)) };
    opponentUpdates.status = newStatus;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_fireball'), mana: Math.max(0, (user.mana || 0) - abilityCostById('mage_fireball')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_fireball' }, message: `${user.name || 'You'} casts Fireball for ${damage} damage and inflicts burn!`, lastMoveDamage: damage };
  },

  warrior_rend(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 10) + base + 6;
    const effectiveDefense = (target.defense || 0) / 2;
    const final = Math.max(0, Math.round(raw - effectiveDefense));
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: effectiveDefense, evasion: target.evasion || 0 }, final, { ignoreDefense: true, attacker: user });
  void isCrit; void dodged;
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_rend') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_rend' }, message: `${user.name || 'You'} rends ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  archer_volley(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    let total = 0;
    for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 6) + Math.floor(base / 2);
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, total, { attacker: user });
  void isCrit; void dodged;
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const amount = 2;
    if (!newStatus.weaken) {
      newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    } else {
      newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount;
      newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2);
    }
    opponentUpdates.status = newStatus;
    opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_volley') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_volley' }, message: `${user.name || 'You'} fires a volley for ${damage} total damage!`, lastMoveDamage: damage };
  },

  slime_splatter(user, target) {
    const base = getEffectiveBaseAtk(user, 6);
    const raw = Math.floor(Math.random() * 6) + base;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
  void isCrit; void dodged;
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.slimed = { turns: 3, effect: 'reduce-heal' };
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'slime_splatter') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_slime_splatter' }, message: `Slime splatters for ${damage} and leaves a sticky slime!`, lastMoveDamage: damage };
  },

  gladiator_charge(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 12) + base + 4;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
  void isCrit; void dodged;
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'gladiator_charge') };
    let message = `${user.name || 'Enemy'} charges for ${damage} damage!`;
    if (Math.random() < 0.3) {
      const newStatus = Object.assign({}, target.status || {});
      newStatus.stun = { turns: 1 };
      opponentUpdates.status = newStatus;
      message = `${user.name || 'Enemy'} charges with a heavy blow for ${damage} — ${target.name || 'the target'} is stunned!`;
    }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_gladiator_charge' }, message, lastMoveDamage: damage };
  },

  boss_earthquake(user, target) {
    const base = getEffectiveBaseAtk(user, 18);
    const raw = Math.floor(Math.random() * 18) + base + 8;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
  void isCrit; void dodged;
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.stun = { turns: 1 };
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'boss_earthquake') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_boss_earthquake' }, message: `${user.name || 'Enemy'} slams the ground for ${damage} — ${target.name || 'target'} is stunned!`, lastMoveDamage: damage };
  },

  mage_iceblast(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + base + 6;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
  void isCrit; void dodged;
    const opponentUpdates = { hp: newHp };
    const amount = Math.max(1, Math.floor(base / 4));
    const newStatus = Object.assign({}, target.status || {});
    if (!newStatus.weaken) {
      newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    } else {
      newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount;
      newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2);
    }
    opponentUpdates.status = newStatus;
    opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_iceblast'), mana: Math.max(0, (user.mana || 0) - abilityCostById('mage_iceblast')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_iceblast' }, message: `${user.name || 'You'} blasts ${target.name || 'the target'} with ice for ${damage} damage and lowers attack!`, lastMoveDamage: damage };
  },

  warrior_shout(user, target) {
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_shout') };
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 3, amount: 8 };
    playerUpdates.status = newStatus;
    playerUpdates.attackBoost = (user.attackBoost || 0) + 8;
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_warrior_shout' }, message: `${user.name || 'You'} shouts and increases their attack!` };
  },

  archer_poison(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 6) + base;
    const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) };
    if (newStatus.poison) {
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns);
    } else {
      newStatus.poison = incoming;
    }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_poison') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_poison' }, message: `${user.name || 'You'} hits ${target.name || 'the enemy'} for ${damage} and applies poison!`, lastMoveDamage: damage };
  }
  ,
  cleric_heal(user, target) {
    const healAmt = Math.max(1, Math.floor((Number(user.maxHp || 0) || 0) * 0.20) + 6);
    const newHp = Math.min(Number(user.maxHp || 0), Number(user.hp || 0) + healAmt);
    const newStatus = Object.assign({}, user.status || {});
    if (newStatus.poison) delete newStatus.poison;
    if (newStatus.burn) delete newStatus.burn;
  const playerUpdates = { hp: newHp, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_heal'), mana: Math.max(0, (user.mana || 0) - abilityCostById('cleric_heal')), status: Object.keys(newStatus).length ? newStatus : null };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_cleric_heal' }, message: `${user.name || 'You'} heals for ${healAmt} HP.` };
  },

  cleric_smite(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 10) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const newStatus = Object.assign({}, target.status || {});
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_smite'), mana: Math.max(0, (user.mana || 0) - abilityCostById('cleric_smite')), status: Object.keys(newStatus).length ? newStatus : null };
    const opponentUpdates = { hp: newHp };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_cleric_smite' }, message: `${user.name || 'You'} smites ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  knight_guard(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const add = 5;
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 1, amount: add };
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_guard') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_knight_guard' }, message: `${user.name || 'You'} strikes and assumes a guarded stance, dealing ${damage} damage and increasing defense by ${add} for a short time.`, lastMoveDamage: damage };
  },

  knight_charge(user, target) {
    const base = getEffectiveBaseAtk(user, 13);
    const raw = Math.floor(Math.random() * 14) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_charge') };
    let didStun = false;
    let message = `${user.name || 'You'} charges for ${damage} damage!`;
    if (Math.random() < 0.35) {
      const s = Object.assign({}, target.status || {});
      s.stun = { turns: 1 };
      opponentUpdates.status = s;
      message = `${user.name || 'You'} charges with a crushing blow for ${damage} — ${target.name || 'the enemy'} is stunned!`;
      didStun = true;
    }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_knight_charge' }, message, lastMoveDamage: damage };
  },

  rogue_backstab(user, target) {
    const base = getEffectiveBaseAtk(user, 16);
    const raw = Math.floor(Math.random() * 12) + base + 8;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: Math.floor((target.defense || 0) / 3), evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'rogue_backstab') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_rogue_backstab' }, message: `${user.name || 'You'} backstabs ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  rogue_poisoned_dagger(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 8) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) };
    if (newStatus.poison) {
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns);
    } else {
      newStatus.poison = incoming;
    }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'rogue_poisoned_dagger') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_rogue_poisoned_dagger' }, message: `${user.name || 'You'} plunges a poisoned dagger for ${damage} damage and applies poison!`, lastMoveDamage: damage };
  },

  paladin_aura(user, target) {
    const amt = 6;
    const defAdd = 5;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 3, amount: amt };
    newStatus.shield = { turns: 3, amount: defAdd };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_aura'), attackBoost: (user.attackBoost || 0) + amt, defense: (user.defense || 0) + defAdd, status: newStatus };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_paladin_aura' }, message: `${user.name || 'You'} radiates an Aura of Valor, increasing attack by ${amt} and defense by ${defAdd} for several turns.` };
  },

  paladin_holy_strike(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 10) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const heal = Math.floor(damage * 0.4);
    const actualHeal = (user.status && user.status.slimed) ? Math.floor(heal / 2) : heal;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_holy_strike'), mana: Math.max(0, (user.mana || 0) - abilityCostById('paladin_holy_strike')) };
    playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
    const opponentUpdates = { hp: newHp };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_paladin_holy_strike' }, message: `${user.name || 'You'} smites for ${damage} and is healed for ${actualHeal} HP.`, lastMoveDamage: damage };
  },

  necro_siphon(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    let raw = Math.floor(Math.random() * 14) + base + 8;
    const hasHealingReduction = !!(target.status && target.status.slimed);
    if (hasHealingReduction) raw = raw * 2;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    let healAmt = Math.floor(damage * 0.75);
    if (user.status && user.status.slimed) healAmt = Math.floor(healAmt / 2);
    const opponentUpdates = { hp: newHp };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_siphon'), mana: Math.max(0, (user.mana || 0) - abilityCostById('necro_siphon')) };
    playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + healAmt);
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_siphon' }, message: `${user.name || 'You'} siphons ${damage} life and heals for ${healAmt}.`, lastMoveDamage: damage };
  },

  necro_raise(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const poisonDmg = Math.max(3, Math.floor(base * 0.6));
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 6, dmg: poisonDmg };
    if (newStatus.poison) {
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns);
    } else {
      newStatus.poison = incoming;
    }
    const opponentUpdates = { status: newStatus };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_raise'), mana: Math.max(0, (user.mana || 0) - abilityCostById('necro_raise')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_raise' }, message: `${user.name || 'You'} invokes rot; ${target.name || 'the enemy'} is cursed for ${poisonDmg} poison per turn for ${incoming.turns} turns.` };
  },

  druid_entangle(user, target) {
    const amount = 4;
    const newStatus = Object.assign({}, target.status || {});
    if (!newStatus.weaken) {
      newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    } else {
      newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount;
      newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2);
    }
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 10) + Math.floor(base / 2);
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { status: newStatus, hp: newHp };
    opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
    if (Math.random() < 0.15) {
      const s = Object.assign({}, newStatus || {});
      s.stun = { turns: 1 };
      opponentUpdates.status = s;
    }
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_entangle') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_druid_entangle' }, message: `${user.name || 'You'} conjures grasping vines that entangle the foe, dealing ${damage} damage and weakening their attacks.`, lastMoveDamage: damage };
  },

  druid_regrowth(user, target) {
    const immediate = Math.floor(Math.random() * 12) + 12;
    const regenAmount = 8;
    const regenTurns = 5;
    const actualImmediate = (user.status && user.status.slimed) ? Math.floor(immediate / 2) : immediate;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + actualImmediate);
    const newStatus = Object.assign({}, user.status || {});
    newStatus.regen = { turns: regenTurns, amount: regenAmount };
  const playerUpdates = { hp: newHp, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_regrowth'), mana: Math.max(0, (user.mana || 0) - abilityCostById('druid_regrowth')) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_druid_regrowth' }, message: `${user.name || 'You'} calls regrowth, healing ${actualImmediate} HP and regenerating ${regenAmount} HP for ${regenTurns} turns.`, lastMoveHeal: actualImmediate };
  },

  artificer_turret(user, target) {
    const newStatus = Object.assign({}, user.status || {});
    const turretTurns = 3;
    const buffAmount = 8;
    const prevBoost = user.attackBoost || 0;
    const baseAtk = getEffectiveBaseAtk(user, 12);
    newStatus.turret = { turns: turretTurns, dmg: Math.max(16, Math.floor(baseAtk * 1.6)), ignoreDefense: true, stunChance: 0.25 };
    newStatus.turret_buff = { turns: turretTurns, amount: buffAmount, prevBoost: prevBoost };
  const playerUpdates = { status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'artificer_turret'), mana: Math.max(0, (user.mana || 0) - abilityCostById('artificer_turret')), attackBoost: prevBoost + buffAmount };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_artificer_turret' }, message: `${user.name || 'You'} deploys a Turret and gains +${buffAmount} ATK while it's active.` };
  },

  artificer_shock(user, target) {
    const base = getEffectiveBaseAtk(user, 20);
    const raw = Math.floor(Math.random() * 12) + Math.floor(base * 1.0) + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'artificer_shock'), mana: Math.max(0, (user.mana || 0) - abilityCostById('artificer_shock')) };
    const s = Object.assign({}, target.status || {});
    s.stun = { turns: 1 };
    opponentUpdates.status = s;
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_artificer_shock' }, message: `${user.name || 'You'} fires Arc Shock for ${damage} damage and stuns the target!`, lastMoveDamage: damage };
  },

  artificer_repair_field(user, target) {
    const immediate = Math.floor(Math.random() * 12) + 18;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + immediate);
    const newStatus = Object.assign({}, user.status || {});
    newStatus.regen = { turns: 4, amount: 6 };
    const defAdd = 12;
    newStatus.shield = { turns: 4, amount: defAdd };
  const playerUpdates = { hp: newHp, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'artificer_repair_field'), mana: Math.max(0, (user.mana || 0) - abilityCostById('artificer_repair_field')), defense: (user.defense || 0) + defAdd };
    if (Math.random() < 0.5 && target) {
      const oppStatus = Object.assign({}, target.status || {});
      oppStatus.stun = { turns: 1 };
      return { playerUpdates, opponentUpdates: { status: oppStatus }, matchUpdates: { lastMove: 'special_artificer_repair_field' }, message: `${user.name || 'You'} activates Repair Field, healing ${immediate} HP, granting regen and defense, and stuns the target.` };
    }
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_artificer_repair_field' }, message: `${user.name || 'You'} activates Repair Field, healing ${immediate} HP and granting regeneration and defense.` };
  },

  valkyrie_spear(user, target) {
    const base = getEffectiveBaseAtk(user, 15);
    const raw = Math.floor(Math.random() * 12) + base + 6;
    const final = Math.max(0, Math.round(raw - Math.floor((target.defense || 0) * 0.4)));
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, final, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'valkyrie_spear'), mana: Math.max(0, (user.mana || 0) - abilityCostById('valkyrie_spear')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_valkyrie_spear' }, message: `${user.name || 'You'} pierces the foe with Spear Strike for ${damage} damage!`, lastMoveDamage: damage };
  },

  valkyrie_aerial_sweep(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 10) + base + 2;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const newStatus = Object.assign({}, target.status || {});
    const burnDmg = Math.max(1, Math.floor(base / 4));
    const burnIncoming = { turns: 3, dmg: burnDmg };
    if (newStatus.burn) { newStatus.burn.dmg = Math.max(newStatus.burn.dmg || 0, burnIncoming.dmg); newStatus.burn.turns = Math.max(newStatus.burn.turns || 0, burnIncoming.turns); } else { newStatus.burn = burnIncoming; }
    const poisonDmg = Math.max(1, Math.floor(base / 6));
    const poisonIncoming = { turns: 3, dmg: poisonDmg };
    if (newStatus.poison) { newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, poisonIncoming.dmg); newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, poisonIncoming.turns); } else { newStatus.poison = poisonIncoming; }
    const opponentUpdates = { hp: newHp, status: newStatus };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'valkyrie_aerial_sweep'), mana: Math.max(0, (user.mana || 0) - abilityCostById('valkyrie_aerial_sweep')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_valkyrie_aerial_sweep' }, message: `${user.name || 'You'} performs Aerial Sweep for ${damage} damage and inflicts burn and poison!`, lastMoveDamage: damage };
  },

  valkyrie_guard(user, target) {
    const add = 6;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 2, amount: add };
  const playerUpdates = { defense: (user.defense || 0) + add, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'valkyrie_guard'), mana: Math.max(0, (user.mana || 0) - abilityCostById('valkyrie_guard')) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_valkyrie_guard' }, message: `${user.name || 'You'} gains Valkyrie Guard (+${add} DEF) for several turns.` };
  },

  barbarian_berserk_slam(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 10) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const buff = 2;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'barbarian_berserk_slam'), attackBoost: (user.attackBoost || 0) + buff };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_barbarian_berserk_slam' }, message: `${user.name || 'You'} slams in berserk fury for ${damage} damage and gains +${buff} ATK.`, lastMoveDamage: damage };
  },

  barbarian_war_cry(user, target) {
    const buff = 6;
    const regenAmount = 4;
    const regenTurns = 3;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'barbarian_war_cry'), attackBoost: (user.attackBoost || 0) + buff };
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 3, amount: buff };
    newStatus.regen = { turns: regenTurns, amount: regenAmount };
    playerUpdates.status = newStatus;
    const opponentUpdates = {};
  try { const oppStatus = Object.assign({}, (target.status || {})); oppStatus.silence = { turns: 2 }; opponentUpdates.status = oppStatus; } catch (e) { void e; }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_barbarian_war_cry' }, message: `${user.name || 'You'} bellows a War Cry, boosting attack by ${buff}, regenerating ${regenAmount} HP for ${regenTurns} turns, and silencing the opponent.` };
  },

  barbarian_reckless_strike(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 18) + base + 6;
    let usedRaw = raw;
    let boosted = false;
    if (Math.random() < 0.5) { usedRaw = Math.floor(raw * 1.5); boosted = true; }
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, usedRaw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const selfDmg = Math.max(4, Math.floor(damage * 0.20));
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'barbarian_reckless_strike') };
    playerUpdates.hp = Math.max(0, (user.hp || 0) - selfDmg);
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_barbarian_reckless_strike' }, message: `${user.name || 'You'} deals ${damage} with Reckless Strike${boosted ? ' (empowered)' : ''} and takes ${selfDmg} recoil.`, lastMoveDamage: damage };
  },

  warrior_whirlwind(user, target) {
    const base = getEffectiveBaseAtk(user, 16);
    const raw = Math.floor(Math.random() * 18) + base + 10;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const amount = 6;
    if (!newStatus.weaken) { newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) }; }
    else { newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount; newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2); }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_whirlwind') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_whirlwind' }, message: `${user.name || 'You'} spins a Whirlwind for ${damage} damage and weakens the foe!`, lastMoveDamage: damage };
  },

  mage_arcane_burst(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 14) + base + 8;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.burn = { turns: 3, dmg: Math.max(2, Math.floor(base / 3)) };
    opponentUpdates.status = newStatus;
    const playerStatus = Object.assign({}, user.status || {});
    const boost = 9;
    playerStatus.shout = { turns: 2, amount: boost };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_arcane_burst'), mana: Math.max(0, (user.mana || 0) - abilityCostById('mage_arcane_burst')), status: playerStatus, attackBoost: (user.attackBoost || 0) + boost };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_arcane_burst' }, message: `${user.name || 'You'} unleashes Arcane Burst for ${damage} magic damage and is empowered with +${boost} attack!`, lastMoveDamage: damage };
  },

  archer_trap(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 8) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 3, pct: 0.05 };
    if (newStatus.bleed) { newStatus.bleed.pct = Math.max(newStatus.bleed.pct || 0, incoming.pct); newStatus.bleed.turns = Math.max(newStatus.bleed.turns || 0, incoming.turns); } else { newStatus.bleed = incoming; }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_trap') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_trap' }, message: `${user.name || 'You'} sets a trap and deals ${damage} damage, inflicting bleeding for several turns.`, lastMoveDamage: damage };
  },

  cleric_shield(user, target) {
    const add = 10;
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 3, amount: add };
  const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_shield'), mana: Math.max(0, (user.mana || 0) - abilityCostById('cleric_shield')) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_cleric_shield' }, message: `${user.name || 'You'} raises a Sanctuary Shield, increasing defense by ${add} for several turns.` };
  },

  knight_bastion(user, target) {
    const add = 12;
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 3, amount: add };
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_bastion') };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_knight_bastion' }, message: `${user.name || 'You'} assumes Bastion stance, greatly increasing defense for several turns.` };
  },

  rogue_evade(user, target) {
    const newStatus = Object.assign({}, user.status || {});
    newStatus.extraTurns = (newStatus.extraTurns || 0) + 2;
    const playerUpdates = { status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'rogue_evade') };
    const matchUpdates = { lastMove: 'special_rogue_evade', currentTurn: '__KEEP_ACTOR__' };
    return { playerUpdates, opponentUpdates: {}, matchUpdates, message: `${user.name || 'You'} performs an evasive roll and gains multiple rapid actions!` };
  },

  paladin_bless(user, target) {
    const baseHeal = 20;
    const actualHeal = (user.status && user.status.slimed) ? Math.floor(baseHeal / 2) : baseHeal;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
    const amt = 8;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 3, amount: amt };
  const playerUpdates = { hp: newHp, attackBoost: (user.attackBoost || 0) + amt, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_bless'), mana: Math.max(0, (user.mana || 0) - abilityCostById('paladin_bless')) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_paladin_bless' }, message: `${user.name || 'You'} calls a Blessing, healing ${actualHeal} HP and gaining +${amt} attack for a short time.`, lastMoveHeal: actualHeal };
  },

  necro_curse(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const newStatus = Object.assign({}, target.status || {});
    newStatus.slimed = { turns: 7, effect: 'reduce-heal' };
    const incoming = { turns: 6, dmg: Math.max(3, Math.floor(base * 0.6)) };
    if (newStatus.poison) { newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg); newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns); } else { newStatus.poison = incoming; }
    newStatus.burn = { turns: 3, dmg: 4 };
    if (Math.random() < 0.8) { newStatus.stun = { turns: 1 }; }
    const opponentUpdates = { status: newStatus };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_curse'), mana: Math.max(0, (user.mana || 0) - abilityCostById('necro_curse')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_curse' }, message: `${user.name || 'You'} curses ${target.name || 'the enemy'}, reducing their healing and afflicting rot and flame.` };
  },

  druid_barkskin(user, target) {
    const immediate = 6;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + immediate);
    const shieldAmount = 8;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 3, amount: shieldAmount };
  const playerUpdates = { hp: newHp, status: newStatus, defense: (user.defense || 0) + shieldAmount, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_barkskin'), mana: Math.max(0, (user.mana || 0) - abilityCostById('druid_barkskin')) };
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + Math.floor(base / 2);
    const { damage, newHp: oppNewHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: oppNewHp };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_druid_barkskin' }, message: `${user.name || 'You'} hardens skin and lashes out, healing ${immediate} HP, gaining +${shieldAmount} defense and dealing ${damage} damage to the foe.`, lastMoveHeal: immediate, lastMoveDamage: damage };
  },

  monk_flurry(user, target) {
    const base = getEffectiveBaseAtk(user, 16);
    let total = 0;
    for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 8) + Math.floor(base / 2);
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, total, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const weakenAmt = 8;
    if (!newStatus.weaken) { newStatus.weaken = { turns: 2, amount: weakenAmt, prevBoost: (target.attackBoost || 0) }; }
    else { newStatus.weaken.amount = (newStatus.weaken.amount || 0) + weakenAmt; newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2); }
    opponentUpdates.status = newStatus;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_flurry'), mana: Math.max(0, (user.mana || 0) - abilityCostById('monk_flurry')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_flurry' }, message: `${user.name || 'You'} strikes in a flurry for ${damage} total damage and weakens the enemy!`, lastMoveDamage: damage };
  },

  monk_stunning_blow(user, target) {
    const base = getEffectiveBaseAtk(user, 18);
    const raw = Math.floor(Math.random() * 16) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    if (Math.random() < 0.75) { const s = Object.assign({}, target.status || {}); s.stun = { turns: 1 }; opponentUpdates.status = s; }
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_stunning_blow') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_stunning_blow' }, message: `${user.name || 'You'} delivers a Stunning Blow for ${damage} damage${opponentUpdates.status && opponentUpdates.status.stun ? ' and stuns the foe!' : '!'}`, lastMoveDamage: damage };
  },

  monk_quivering_palm(user, target) {
    const maxHpT = target.maxHp || target.maxHP || 100;
    const threshold = Math.floor(maxHpT * 0.2);
    if ((target.hp || 0) <= threshold) {
      const opponentUpdates = { hp: 0, fainted: true };
      const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_quivering_palm') };
      return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_quivering_palm' }, message: `${user.name || 'You'} strikes a Quivering Palm and collapses the enemy instantly!` };
    }
    const base = getEffectiveBaseAtk(user, 16);
    const raw = Math.floor(Math.random() * 14) + Math.floor(base / 2) + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 4, pct: 0.05 };
    if (newStatus.bleed) { newStatus.bleed.pct = Math.max(newStatus.bleed.pct || 0, incoming.pct); newStatus.bleed.turns = Math.max(newStatus.bleed.turns || 0, incoming.turns); } else { newStatus.bleed = incoming; }
    opponentUpdates.status = newStatus;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_quivering_palm'), mana: Math.max(0, (user.mana || 0) - abilityCostById('monk_quivering_palm')) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_quivering_palm' }, message: `${user.name || 'You'} uses Quivering Palm dealing ${damage} damage and inflicting deep bleeding!`, lastMoveDamage: damage };
  },

  necro_summon_skeleton(user, target) {
    const playerUpdates = {};
    const newStatus = Object.assign({}, user.status || {});
    const atkAdd = 5;
    const defAdd = 5;
    newStatus.shout = { turns: 3, amount: atkAdd };
    newStatus.shield = { turns: 3, amount: defAdd };
    playerUpdates.attackBoost = (user.attackBoost || 0) + atkAdd;
    playerUpdates.defense = (user.defense || 0) + defAdd;
    playerUpdates.status = newStatus;
    const oppStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 3, dmg: Math.max(1, Math.floor((user.baseAtk * 2 || 8) / 3)) };
    if (oppStatus.poison) { oppStatus.poison.dmg = Math.max(oppStatus.poison.dmg || 0, incoming.dmg); oppStatus.poison.turns = Math.max(oppStatus.poison.turns || 0, incoming.turns); } else { oppStatus.poison = incoming; }
    const opponentUpdates = { status: oppStatus };
    playerUpdates.abilityCooldowns = startAbilityCooldownLocal(user.abilityCooldowns, 'necro_summon_skeleton');
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_summon_skeleton' }, message: `${user.name || 'You'} summons a skeleton, gaining +${atkAdd} ATK and +${defAdd} DEF while poisoning the foe.` };
  },

  necro_spirit_shackles(user, target) {
    const oppStatus = Object.assign({}, target.status || {});
    const weakenAmt = 5;
    if (!oppStatus.weaken) { oppStatus.weaken = { turns: 4, amount: weakenAmt, prevBoost: (target.attackBoost || 0) }; }
    else { oppStatus.weaken.amount = (oppStatus.weaken.amount || 0) + weakenAmt; oppStatus.weaken.turns = Math.max(oppStatus.weaken.turns || 0, 4); }
    const reducedDef = Math.floor((target.defense || 0) * 0.25);
    const opponentUpdates = { status: oppStatus, defense: reducedDef };
    oppStatus.no_items = { turns: 4 };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_spirit_shackles') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_spirit_shackles' }, message: `${user.name || 'You'} binds the enemy with Spirit Shackles: -${weakenAmt} ATK, defense heavily reduced and items disabled.` };
  },

  necro_dark_inversion(user, target) {
    const playerStatus = Object.assign({}, user.status || {});
    playerStatus.dark_inversion = { turns: 3 };
      const playerUpdates = { status: playerStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_dark_inversion'), mana: Math.max(0, (user.mana || 0) - abilityCostById('necro_dark_inversion')) };
    const opponentUpdates = {};
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_dark_inversion' }, message: `${user.name || 'You'} twists life into unlife: for 3 turns, healing becomes harmful and damage becomes restorative.` };
  },

  wild_attack(user, target) {
    const roll = Math.floor(Math.random() * 20) + 1;
    const base = getEffectiveBaseAtk(user, 16);
    let damage = Math.floor(Math.random() * 16) + base + 4;
    const opponentUpdates = { hp: Math.max(0, (target.hp || 0) - Math.max(0, damage - (target.defense || 0))) };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'wild_attack'), mana: Math.max(0, (user.mana || 0) - abilityCostById('wild_attack')) };
    let message = `${user.name || 'You'} triggers Wild Attack (d20=${roll})`;
    if (roll <= 3) {
      const backlash = Math.floor(damage * 0.4);
      const pHp = Math.max(0, (user.hp || 0) - backlash);
      playerUpdates.hp = pHp;
      message += ` — chaotic backlash! You suffer ${backlash} damage.`;
    } else if (roll <= 8) {
      const s = Object.assign({}, target.status || {});
      s.weaken = { turns: 2, amount: 4, prevBoost: (target.attackBoost || 0) };
      opponentUpdates.status = s;
      message += ` — the enemy is weakened.`;
    } else if (roll <= 15) {
      const s = Object.assign({}, target.status || {});
      s.burn = { turns: 3, dmg: Math.max(3, Math.floor(base / 3)) };
      opponentUpdates.status = s;
      message += ` — the enemy is scorched.`;
    } else if (roll <= 19) {
      const extra = Math.floor(Math.random() * 14) + 10;
      const newHp = Math.max(0, (opponentUpdates.hp || target.hp) - extra);
      opponentUpdates.hp = newHp;
      const s = Object.assign({}, opponentUpdates.status || target.status || {});
      s.stun = { turns: 1 };
      opponentUpdates.status = s;
      message += ` — a powerful surge stuns the opponent!`;
    } else {
      const extra = Math.floor(Math.random() * 26) + 18;
      const newHp = Math.max(0, (opponentUpdates.hp || target.hp) - extra);
      opponentUpdates.hp = newHp;
      const pS = Object.assign({}, user.status || {});
      pS.shout = { turns: 3, amount: 12 };
      playerUpdates.status = pS;
      playerUpdates.attackBoost = (user.attackBoost || 0) + 12;
      message += ` — critical wild surge! Massive damage and you're empowered.`;
    }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_wild_attack' }, message, lastMoveDamage: damage };
  },

  wild_buff(user, target) {
    const roll = Math.floor(Math.random() * 20) + 1;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'wild_buff'), mana: Math.max(0, (user.mana || 0) - abilityCostById('wild_buff')) };
    const pS = Object.assign({}, user.status || {});
    let message = `${user.name || 'You'} invoke Wild Buff (d20=${roll})`;
    if (roll <= 4) { pS.weaken = { turns: 3, amount: 4, prevBoost: (user.attackBoost || 0) }; message += ` — misfired and you feel weaker.`; }
    else if (roll <= 10) { const heal = 10; playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + heal); message += ` — minor regenerative pulse heals ${heal} HP.`; }
    else if (roll <= 16) { pS.shout = { turns: 2, amount: 6 }; playerUpdates.attackBoost = (user.attackBoost || 0) + 6; message += ` — arcane winds bolster your strength.`; }
    else if (roll <= 19) { playerUpdates.mana = Math.min(user.maxMana || (user.mana || 0), (user.mana || 0) + 12); message += ` — mana surges through you.`; }
    else { playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + 25); pS.shout = { turns: 3, amount: 12 }; playerUpdates.attackBoost = (user.attackBoost || 0) + 12; message += ` — incredible boon: large heal and huge strength.`; }
    playerUpdates.status = Object.keys(pS).length ? pS : null;
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_wild_buff' }, message };
  },

  wild_arcanum(user, target) {
    const roll = Math.floor(Math.random() * 20) + 1;
    const base = getEffectiveBaseAtk(user, 18);
    let raw = Math.floor(Math.random() * 24) + base + 12;
    const opponentUpdates = { hp: Math.max(0, (target.hp || 0) - Math.max(0, raw - (target.defense || 0))) };
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'wild_arcanum'), mana: Math.max(0, (user.mana || 0) - abilityCostById('wild_arcanum')) };
    let message = `${user.name || 'You'} cast Wild Arcanum (d20=${roll})`;
    if (roll <= 4) { const back = Math.floor(raw * 0.5); playerUpdates.hp = Math.max(0, (user.hp || 0) - back); message += ` — chaotic backlash! You suffer ${back} damage.`; }
    else if (roll <= 12) { const extra = Math.floor(Math.random() * 12) + 8; opponentUpdates.hp = Math.max(0, (opponentUpdates.hp || target.hp) - extra); message += ` — arcane surge deals extra damage.`; }
    else if (roll <= 19) { const extra = Math.floor(Math.random() * 20) + 12; opponentUpdates.hp = Math.max(0, (opponentUpdates.hp || target.hp) - extra); playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + Math.floor(extra * 0.4)); message += ` — wild arcanum hits hard and you siphon some life.`; }
    if (roll === 20) { const nuke = Math.floor(Math.random() * 36) + 36; opponentUpdates.hp = Math.max(0, (opponentUpdates.hp || target.hp) - nuke); const pS = Object.assign({}, user.status || {}); pS.shout = { turns: 3, amount: 14 }; playerUpdates.status = pS; playerUpdates.attackBoost = (user.attackBoost || 0) + 14; message += ` Critical wild arcanum! Massive surge and you are empowered.`; }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_wild_arcanum' }, message, lastMoveDamage: raw };
  }
};

// Merge function: prefer legacy handlers but fall back to modern ones on missing/throw
function createMergedHandlers(legacy, modern) {
  const merged = {};
  const keys = Array.from(new Set([...(Object.keys(legacy || {})), ...(Object.keys(modern || {}))]));
  keys.forEach((k) => {
    const l = legacy && legacy[k];
    const m = modern && modern[k];
    if (typeof l === 'function') {
      merged[k] = function(user, target) {
        try {
          return l(user, target);
        } catch (e) {
          console.warn('Legacy handler failed for', k, e);
          if (typeof m === 'function') {
            try { return m(user, target); } catch (e2) { console.warn('Modern fallback also failed for', k, e2); }
          }
          return {};
        }
      };
    } else if (typeof m === 'function') {
      merged[k] = m;
    }
  });
  return merged;
}

// Final runtime handlers map used by AI
const abilityHandlers = createMergedHandlers(LEGACY_ABILITY_HANDLERS, modernAbilityHandlers);

function computeAbilityUpdates(matchId, actorUid, targetUid, actorState, targetState, abilityId) {
  // Build simplified actor/target snapshots for handlers
  const actor = Object.assign({}, actorState || {});
  const target = Object.assign({}, targetState || {});
  // Prefer merged handlers (legacy preferred, modern fallback)
  const handler = (abilityHandlers && abilityHandlers[abilityId]) ? abilityHandlers[abilityId] : (modernAbilityHandlers[abilityId] || null);
  if (handler) {
    try {
      const result = handler(actor, target) || {};
      const out = {};
      // apply playerUpdates -> matches/.../players/actorUid/*
      let pu = result.playerUpdates || {};
      let ou = result.opponentUpdates || {};

      // Apply dark_inversion semantics for both actor and target where applicable.
      // If a stats object has status.dark_inversion, any HP changes applied to that
      // stats object should be inverted: heals become damage and damage becomes heals.
      const tryApplyDarkInvert = (updatesObj, targetStats) => {
        try {
          if (!updatesObj || typeof updatesObj.hp === 'undefined' || !targetStats) return updatesObj;
          const cur = Number(targetStats.hp || 0);
          const newHp = Number(updatesObj.hp || 0);
          const hasInvert = !!(targetStats.status && targetStats.status.dark_inversion);
          if (!hasInvert) return updatesObj;
          if (newHp < cur) {
            const damage = cur - newHp;
            const maxHp = Number(targetStats.maxHp || targetStats.maxHP || cur || 100);
            updatesObj.hp = Math.min(maxHp, cur + damage);
            if (updatesObj.hp > 0 && updatesObj.fainted) updatesObj.fainted = false;
            return updatesObj;
          }
          if (newHp > cur) {
            const heal = newHp - cur;
            const dmg = heal;
            updatesObj.hp = Math.max(0, cur - dmg);
            if (updatesObj.hp <= 0) updatesObj.fainted = true;
            return updatesObj;
          }
  } catch (e) { void e; /* best-effort */ }
        return updatesObj;
      };

      // Apply inversion to player (actor) updates if actor has dark_inversion
      pu = Object.assign({}, pu);
      pu = tryApplyDarkInvert(pu, actorState) || pu;
      // Apply inversion to opponent (target) updates if target has dark_inversion
      ou = Object.assign({}, ou);
      ou = tryApplyDarkInvert(ou, targetState) || ou;

      // Revive consumption helper (ported from client PVE helper)
      const buildConsumeReviveUpdates = (stats) => {
        try {
          const rawMax = Number(stats.maxHp || stats.maxHP || 100) || 100;
          const intended = Math.max(1, Math.ceil(rawMax * 0.3));
          const newHp = Math.min(rawMax, intended);
          const newStatus = Object.assign({}, stats.status || {});
          if (newStatus.poison) delete newStatus.poison;
          if (newStatus.burn) delete newStatus.burn;
          const out = { hp: newHp, fainted: false, status: Object.keys(newStatus).length ? newStatus : null, has_revive: false };
          return out;
        } catch (e) { void e; return {}; }
      };

      // If the handler would reduce the target to 0 HP but the target has a revive,
      // consume the revive instead of marking fainted/winner. Return the revive updates
      // for the opponent slot and keep the actor's turn (via special marker).
      if ((ou.hp !== undefined && Number(ou.hp) <= 0) || (ou.fainted !== undefined && ou.fainted)) {
        const hasRevive = !!(targetState && (targetState.has_revive || (targetState.status && targetState.status.has_revive)));
        if (hasRevive) {
          const reviveUpd = buildConsumeReviveUpdates(targetState);
          // Replace opponent updates with revive update object
          ou = Object.assign({}, ou, reviveUpd);
          // Ensure match keeps actor's turn (consumer will map '__KEEP_ACTOR__' to actorUid)
          result.matchUpdates = Object.assign({}, result.matchUpdates || {}, { currentTurn: '__KEEP_ACTOR__' });
        }
      }
      // Normalize: if the handler didn't include a full abilityCooldowns object
      // or explicit mana change, fill them using local helpers so the server
      // writes the same shape that the client expects.
      try {
        if ((!pu || typeof pu.abilityCooldowns === 'undefined') && ABILITIES[abilityId]) {
          pu = Object.assign({}, pu || {});
          pu.abilityCooldowns = startAbilityCooldownLocal(actorState && actorState.abilityCooldowns ? actorState.abilityCooldowns : {}, abilityId);
        }
        if ((pu && typeof pu.mana === 'undefined') && ABILITIES[abilityId] && abilityCostById(abilityId)) {
          pu.mana = Math.max(0, (actorState && (actorState.mana || 0)) - abilityCostById(abilityId));
        }
  } catch (e) { void e; /* best-effort */ }

      // Ensure cooldown and mana updates are present server-side
      if (pu.abilityCooldowns && typeof pu.abilityCooldowns === 'object') {
        out[`matches/${matchId}/players/${actorUid}/abilityCooldowns`] = pu.abilityCooldowns;
      } else if (ABILITIES[abilityId]) {
        // set specific ability cooldown entry
        out[`matches/${matchId}/players/${actorUid}/abilityCooldowns/${abilityId}`] = ABILITIES[abilityId].cooldown || 0;
      }
      if (pu.mana !== undefined) out[`matches/${matchId}/players/${actorUid}/mana`] = pu.mana;
      if (pu.hp !== undefined) out[`matches/${matchId}/players/${actorUid}/hp`] = Math.max(0, pu.hp);
      if (pu.status !== undefined) out[`matches/${matchId}/players/${actorUid}/status`] = pu.status;
      if (pu.attackBoost !== undefined) out[`matches/${matchId}/players/${actorUid}/attackBoost`] = pu.attackBoost;
      if (pu.defense !== undefined) out[`matches/${matchId}/players/${actorUid}/defense`] = pu.defense;

      if (ou.hp !== undefined) out[`matches/${matchId}/players/${targetUid}/hp`] = Math.max(0, ou.hp);
      if (ou.status !== undefined) out[`matches/${matchId}/players/${targetUid}/status`] = ou.status;
      if (ou.attackBoost !== undefined) out[`matches/${matchId}/players/${targetUid}/attackBoost`] = ou.attackBoost;
      if (ou.fainted !== undefined) out[`matches/${matchId}/players/${targetUid}/fainted`] = !!ou.fainted;
      if (result.matchUpdates && typeof result.matchUpdates === 'object') {
        for (const k of Object.keys(result.matchUpdates)) {
          let val = result.matchUpdates[k];
          if (k === 'currentTurn' && val === '__KEEP_ACTOR__') val = actorUid;
          out[`matches/${matchId}/${k}`] = val;
        }
        // Persist any friendly message the handler returned so clients can
        // prefer that text instead of falling back to parsing the special id
        // (which incorrectly extracts the class name: split('_')[1]).
        if (result.message) out[`matches/${matchId}/message`] = result.message;
        if (result.lastMoveDamage !== undefined) out[`matches/${matchId}/lastMoveDamage`] = result.lastMoveDamage;
        if (result.lastMoveHeal !== undefined) out[`matches/${matchId}/lastMoveHeal`] = result.lastMoveHeal;
      }
      return out;
    } catch (e) {
      console.error('Ability handler threw', abilityId, e);
      // fall through to fallback behaviour
    }
  }

  // Fallback: moderate immediate damage (special)
  const updates = {};
  const abil = ABILITIES[abilityId] || {};
  updates[`matches/${matchId}/players/${actorUid}/abilityCooldowns/${abilityId}`] = abil.cooldown || 0;
  if (abil.cost) updates[`matches/${matchId}/players/${actorUid}/mana`] = Math.max(0, (actorState.mana || 0) - (abil.cost || 0));
  const baseAtk = Number(actorState.baseAtk || 0) + Number(actorState.attackBoost || 0);
  const def = Number(targetState.defense || 0);
  const basicDamage = Math.max(1, Math.floor(baseAtk - def));
  const fallbackDmg = Math.max(1, Math.floor(basicDamage * 1.5));
  updates[`matches/${matchId}/players/${targetUid}/hp`] = Math.max(0, Number(targetState.hp || 0) - fallbackDmg);
  return updates;
}

async function applyAbility(db, matchId, actorUid, targetUid, abilityId, actorState, targetState, match) {
  const updates = computeAbilityUpdates(matchId, actorUid, targetUid, actorState, targetState, abilityId);
  // advanced behavior: if target dies, mark fainted/winner
  const targetHpPath = `matches/${matchId}/players/${targetUid}/hp`;
  const targetHp = updates[targetHpPath] !== undefined ? updates[targetHpPath] : (targetState.hp || 0);
  if (targetHp <= 0) {
    updates[`matches/${matchId}/players/${targetUid}/fainted`] = true;
    updates[`matches/${matchId}/status`] = 'finished';
    updates[`matches/${matchId}/winner`] = actorUid;
  }

  // advance turn and set next turn to opponent if alive
  updates[`matches/${matchId}/turnCounter`] = (match.turnCounter || 0) + 1;
  if (!updates[`matches/${matchId}/status`]) updates[`matches/${matchId}/currentTurn`] = targetUid;

  // clear planned action marker for actor
  updates[`matches/${matchId}/players/${actorUid}/_plannedAction`] = null;

  // tick cooldowns down (best-effort)
  try {
    const tickCooldowns = (cdObj) => {
      const out = {};
      if (!cdObj) return out;
      for (const k of Object.keys(cdObj)) out[k] = Math.max(0, Number(cdObj[k] || 0) - 1);
      return out;
    };
    const actorCd = actorState && actorState.abilityCooldowns ? tickCooldowns(actorState.abilityCooldowns) : null;
    const targetCd = targetState && targetState.abilityCooldowns ? tickCooldowns(targetState.abilityCooldowns) : null;
    if (actorCd) updates[`matches/${matchId}/players/${actorUid}/abilityCooldowns`] = actorCd;
    if (targetCd) updates[`matches/${matchId}/players/${targetUid}/abilityCooldowns`] = targetCd;
  } catch (e) { void e; }

  await db.ref().update(updates);
}

// Apply an item use initiated by a player or AI. Mirrors client logic in public/js/battle.js
async function applyItem(db, matchId, actorUid, itemId, actorState, targetState, match) {
  const updates = {};
  const matchUpdates = {};
  try {
    if (itemId === 'potion_small') {
      const heal = 20;
      const actualHeal = (actorState && actorState.status && actorState.status.slimed) ? Math.floor(heal / 2) : heal;
      const newHp = Math.min(actorState.maxHp || actorState.maxHP || 100, (actorState.hp || 0) + actualHeal);
      updates[`matches/${matchId}/players/${actorUid}/hp`] = newHp;
      matchUpdates.lastMove = 'use_item_potion_small';
      matchUpdates.lastMoveActor = actorUid;
      matchUpdates.lastMoveHeal = actualHeal;
  try { matchUpdates.message = `${(actorState && actorState.name) ? actorState.name : actorUid} used a Small Potion and restored ${actualHeal} HP`; } catch (e) { void e; }
    } else if (itemId === 'potion_large') {
      const heal = 50;
      const actualHeal = (actorState && actorState.status && actorState.status.slimed) ? Math.floor(heal / 2) : heal;
      const newHp = Math.min(actorState.maxHp || actorState.maxHP || 100, (actorState.hp || 0) + actualHeal);
      updates[`matches/${matchId}/players/${actorUid}/hp`] = newHp;
      matchUpdates.lastMove = 'use_item_potion_large';
      matchUpdates.lastMoveActor = actorUid;
      matchUpdates.lastMoveHeal = actualHeal;
  try { matchUpdates.message = `${(actorState && actorState.name) ? actorState.name : actorUid} used a Large Potion and restored ${actualHeal} HP`; } catch (e) { void e; }
    } else if (itemId === 'bomb') {
      const dmg = 20;
      const actual = Math.max(0, dmg - (targetState.defense || 0));
      const newOppHp = Math.max(0, (targetState.hp || 0) - actual);
      updates[`matches/${matchId}/players/${match.p1 === actorUid ? match.p2 : match.p1}/hp`] = newOppHp;
      matchUpdates.lastMove = 'use_item_bomb';
      matchUpdates.lastMoveActor = actorUid;
      matchUpdates.lastMoveDamage = actual;
  try { matchUpdates.message = `${(actorState && actorState.name) ? actorState.name : actorUid} used a Bomb and dealt ${actual} damage`; } catch (e) { void e; }
      if (newOppHp <= 0) {
        updates[`matches/${matchId}/players/${match.p1 === actorUid ? match.p2 : match.p1}/fainted`] = true;
        updates[`matches/${matchId}/status`] = 'finished';
        updates[`matches/${matchId}/winner`] = actorUid;
      }
    } else if (itemId === 'elixir') {
      const newMana = actorState.maxMana || actorState.mana || 0;
      updates[`matches/${matchId}/players/${actorUid}/mana`] = newMana;
      matchUpdates.lastMove = 'use_item_elixir';
      matchUpdates.lastMoveActor = actorUid;
  try { matchUpdates.message = `${(actorState && actorState.name) ? actorState.name : actorUid} used an Elixir and restored mana`; } catch (e) { void e; }
    }

    // decrement the item in users/{actorUid}/items
    try {
      const itemRef = db.ref(`users/${actorUid}/items/${itemId}`);
      const snap = await itemRef.get();
      if (snap.exists()) {
        const it = snap.val() || {};
        const qty = Number(it.qty || 0) - 1;
        if (qty > 0) await itemRef.update({ qty }); else await itemRef.set(null);
      }
  } catch (e) { void e; /* best-effort */ }

    // advance turn
    updates[`matches/${matchId}/turnCounter`] = (match.turnCounter || 0) + 1;
    // set next turn to opponent (if match still active)
    if (!updates[`matches/${matchId}/status`]) {
      const opp = (match.p1 === actorUid) ? match.p2 : match.p1;
      updates[`matches/${matchId}/currentTurn`] = opp;
    }
    updates[`matches/${matchId}/players/${actorUid}/_plannedAction`] = null;

    // attach any matchUpdates
    if (matchUpdates.lastMove) updates[`matches/${matchId}/lastMove`] = matchUpdates.lastMove;
    if (matchUpdates.lastMoveActor) updates[`matches/${matchId}/lastMoveActor`] = matchUpdates.lastMoveActor;
    if (matchUpdates.lastMoveHeal !== undefined) updates[`matches/${matchId}/lastMoveHeal`] = matchUpdates.lastMoveHeal;
    if (matchUpdates.lastMoveDamage !== undefined) updates[`matches/${matchId}/lastMoveDamage`] = matchUpdates.lastMoveDamage;

    await db.ref().update(updates);
  } catch (e) {
    console.error('applyItem error', e);
  }
}

// Expose internal helpers for local testing/harnessing. This does not affect
// Cloud Functions registration but makes computeAbilityUpdates callable from
// a test script under the functions folder.
try {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign(module.exports || {}, {
      _test: {
        computeAbilityUpdates: computeAbilityUpdates,
        abilityHandlers: abilityHandlers,
        modernAbilityHandlers: modernAbilityHandlers,
        LEGACY_ABILITY_HANDLERS: LEGACY_ABILITY_HANDLERS
      }
    });
  }
} catch (e) { void e; /* ignore export failures in restricted environments */ }

// Scheduled watcher: matches players waiting > 2 minutes with an AI
async function scheduledQueueWatcherImpl(event) {
  const db = admin.database();
  const qsnap = await db.ref('queue').get();
  if (!qsnap.exists()) return;

  const now = Date.now();
  const threshold = now - (1 * 60 * 1000); // 1 minute

  const queue = qsnap.val() || {};
  for (const [uid, payload] of Object.entries(queue)) {
    try {
      const queuedAt = payload && payload.queuedAt ? Number(payload.queuedAt) : 0;
      if (queuedAt === 0 || queuedAt > threshold) continue;

  // Attempt to remove the user from the queue; if absent skip
  try { await db.ref(`queue/${uid}`).remove(); } catch (e) { void e; }

      // Create a match pairing this user with an AI
      const matchRef = db.ref('matches').push();
      const matchId = matchRef.key;

      // AI uid: ephemeral per-match id
      const aiUid = `ai_${Math.random().toString(36).substr(2,8)}`;

      // Determine player's selected class (prefer payload.selectedClass)
      let playerClass = 'warrior';
      try {
        if (payload && payload.selectedClass) playerClass = payload.selectedClass;
        else {
          const s = await db.ref(`users/${uid}/selectedClass`).get();
          if (s.exists()) playerClass = s.val();
        }
      } catch (e) { void e; }

      // Mirror player class for AI for balanced match
      const t1 = CLASS_STATS[playerClass] || CLASS_STATS.warrior;
      // Choose a random class for the AI (user requested random class each match)
      const classKeys = Object.keys(CLASS_STATS || {});
      const aiClass = classKeys[Math.floor(Math.random() * classKeys.length)];
      const t2 = CLASS_STATS[aiClass] || CLASS_STATS.warrior;

      await matchRef.set({
        p1: uid,
        p2: aiUid,
        createdAt: Date.now(),
        currentTurn: uid,
        turnCounter: 0,
        status: 'active',
        lastMove: null,
        message: ''
      });

      // seed players
      await db.ref(`matches/${matchId}/players/${uid}`).set({
        hp: t1.hp,
        maxHp: t1.maxHp,
        baseAtk: t1.baseAtk,
        defense: t1.defense,
        attackBoost: 0,
        fainted: false,
        name: null,
        classId: playerClass,
        abilities: t1.abilities,
        abilityCooldowns: {},
        status: {},
        mana: t1.mana || 0,
        maxMana: t1.mana || 0
      });

      // Give AI the same base stats/abilities as players and a random name
      await db.ref(`matches/${matchId}/players/${aiUid}`).set({
        hp: Math.max(1, (t2.hp || 0)),
        maxHp: Math.max(1, (t2.maxHp || t2.hp || 0)),
        baseAtk: t2.baseAtk,
        defense: t2.defense,
        attackBoost: 0,
        fainted: false,
        name: generateAiName(),
        classId: aiClass,
        abilities: t2.abilities,
        abilityCooldowns: {},
        status: {},
        mana: t2.mana || 0,
        maxMana: t2.mana || 0,
  // do not include an isBot flag so clients cannot detect AI vs human
      });

      // set match on user
      await db.ref(`users/${uid}/currentMatch`).set(matchId);

      // pick first turn based on speeds
      try {
        const firstTurn = pickFirstTurn(uid, aiUid, t1, t2);
        await db.ref(`matches/${matchId}/currentTurn`).set(firstTurn);
      } catch (e) { void e; /* ignore */ }

      console.log(`Created AI match ${matchId} for ${uid} vs ${aiUid}`);
      // After creating the match, wait for the human player to write their equipped map
      (async () => {
        try {
          const maxRetries = 12; // ~6 seconds
          let retry = 0;
          let playerEq = null;
          while (retry < maxRetries) {
            try {
              const snap = await db.ref(`matches/${matchId}/players/${uid}/equipped`).get();
              if (snap.exists()) { playerEq = snap.val() || {}; break; }
            } catch (e) { void e; }
            await new Promise(r => setTimeout(r, 500));
            retry++;
          }

          const playerCount = playerEq ? Object.keys(playerEq || {}).filter(Boolean).length : 0;
          const gearCount = playerCount > 0 ? playerCount : 3; // fallback to 3 if player didn't write equip map

          // generate gear for AI and write under users/{aiUid}/gear and set AI equipped map in match node
          const equippedMap = {};
          const slotPool = GEAR_SLOTS.slice();
          for (let i = 0; i < gearCount; i++) {
            const slotIdx = Math.floor(Math.random() * slotPool.length);
            const slot = slotPool.splice(slotIdx, 1)[0] || GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)];
            const g = generateSimpleGear(slot);
            try {
              await db.ref(`users/${aiUid}/gear/${g.id}`).set(g);
              equippedMap[slot] = g.id;
            } catch (e) { void e; /* best-effort */ }
          }

          // write AI equipped map to the match node so client seeder can fetch gear
          try { await db.ref(`matches/${matchId}/players/${aiUid}/equipped`).set(equippedMap); } catch (e) { void e; /* ignore */ }
          // Apply equip mods for both the human player (if any) and the AI so
          // server-side combat calculations include gear effects.
          try { await applyEquipModsToMatchPlayer(db, matchId, aiUid); } catch (e) { void e; }
          try { await applyEquipModsToMatchPlayer(db, matchId, uid); } catch (e) { void e; }
          // Give AI some starter items (three small potions) so it can use them
          // during combat; write to users/{aiUid}/items as client inventory helpers expect.
          try {
            await db.ref(`users/${aiUid}/items/potion_small`).set({ id: 'potion_small', name: 'Small Potion', qty: 3 });
          } catch (e) { void e; /* ignore */ }
          // Optionally adjust AI class based on how much the player has equipped.
          try {
            const pc = playerCount || 0;
            // Weighted pick: preferred pools get higher weight but every class still has a chance
            const classKeys = Object.keys(CLASS_STATS || {});
            const tanks = new Set(['barbarian','knight','paladin','warrior']);
            const glass = new Set(['rogue','mage','archer','wild_magic_sorcerer']);
            const weights = classKeys.map(k => {
              let w = 1;
              if (pc >= 8 && tanks.has(k)) w += 6; // strong bias toward tanks
              if (pc <= 2 && glass.has(k)) w += 6; // strong bias toward glassy classes
              // small bias to original random aiClass as well
              if (k === aiClass) w += 2;
              return w;
            });
            const totalW = weights.reduce((s,v)=>s+v,0);
            let r = Math.random() * totalW;
            let chosen = aiClass;
            for (let i=0;i<classKeys.length;i++) {
              r -= weights[i];
              if (r <= 0) { chosen = classKeys[i]; break; }
            }
            if (chosen && chosen !== aiClass) {
              const tNew = CLASS_STATS[chosen] || CLASS_STATS.warrior;
              // update AI player template in match node
              try {
                await db.ref(`matches/${matchId}/players/${aiUid}`).update({
                  classId: chosen,
                  abilities: tNew.abilities,
                  hp: tNew.hp,
                  maxHp: tNew.maxHp,
                  baseAtk: tNew.baseAtk,
                  defense: tNew.defense,
                  mana: tNew.mana || 0,
                  maxMana: tNew.mana || 0
                });
              } catch (e) { void e; }
            }
          } catch (e) { console.error('Error adjusting AI class based on gear count', e); }
        } catch (e) {
          console.error('Error generating AI gear for match', matchId, e);
        }
      })();
    } catch (e) {
      console.error('Error creating AI match for queued user', uid, e);
    }
  }
}

// Register scheduled function and expose implementation for test harnesses
exports.scheduledQueueWatcher = onSchedule('every 1 minutes', scheduledQueueWatcherImpl);

try { if (typeof module !== 'undefined' && module.exports && module.exports._test) module.exports._test.runScheduledQueueWatcher = scheduledQueueWatcherImpl; } catch (e) { void e; }

// HTTP trigger to run the queue watcher manually (useful during local emulation).
exports.triggerQueueWatcher = onRequest(async (req, res) => {
  try {
    await scheduledQueueWatcherImpl();
    res.status(200).send('scheduledQueueWatcher invoked');
  } catch (e) {
    console.error('triggerQueueWatcher error', e);
    res.status(500).send('error invoking scheduledQueueWatcher');
  }
});

// AI turn handler: when currentTurn changes to an AI uid, compute and apply a move
exports.onAiTurn = onValueWritten('/matches/{matchId}/currentTurn', async (event) => {
  const newVal = event.data?.after?.val();
  if (!newVal) return;
  // ignore non-AI turns
  if (typeof newVal !== 'string' || !newVal.startsWith('ai_')) return;

  const matchId = event.params.matchId;
  const db = admin.database();

  try {
    const matchSnap = await db.ref(`matches/${matchId}`).get();
    if (!matchSnap.exists()) return;
    const match = matchSnap.val();

    const aiUid = newVal;
    const p1 = match.p1;
    const p2 = match.p2;
    const humanUid = (p1 === aiUid) ? p2 : p1;

    const playersSnap = await db.ref(`matches/${matchId}/players`).get();
    const players = playersSnap.val() || {};
    const aiState = players[aiUid];
    const humanState = players[humanUid];
    if (!aiState || !humanState) return;

    // fetch AI user's inventory to allow item use decisions
    let aiItems = {};
    try {
      const itemsSnap = await db.ref(`users/${aiUid}/items`).get();
      aiItems = itemsSnap.exists() ? (itemsSnap.val() || {}) : {};
    } catch (e) { aiItems = {}; }

    const decision = aiChooseAction(aiState, humanState, aiItems);

    // If AI is silenced, it cannot use abilities — honor silence server-side
    try {
      if (aiState && aiState.status && aiState.status.silence) {
        const newStatus = Object.assign({}, aiState.status || {});
        newStatus.silence.turns = (newStatus.silence.turns || 1) - 1;
        if (newStatus.silence.turns <= 0) delete newStatus.silence;
        const updates = {};
        updates[`matches/${matchId}/players/${aiUid}/status`] = Object.keys(newStatus).length ? newStatus : null;
        updates[`matches/${matchId}/turnCounter`] = (match.turnCounter || 0) + 1;
        updates[`matches/${matchId}/currentTurn`] = humanUid;
        updates[`matches/${matchId}/lastMoveActor`] = aiUid;
        updates[`matches/${matchId}/lastMove`] = 'silenced';
        // Persist a simple message so clients have consistent text (clients also fallback to canned text)
        updates[`matches/${matchId}/message`] = `${aiState.name || 'The enemy'} is silenced and cannot use specials!`;
  try { await db.ref().update(updates); } catch (e) { void e; }
        console.log(`AI ${aiUid} was silenced and skipped their action in match ${matchId}`);
        return;
      }
  } catch (e) { void e; /* ignore silence-check failures */ }

    // attach planned action locally so applyAiAttack can inspect it and perform ability-specific logic
    aiState._plannedAction = decision;
    // Persist planned action (debug/visibility) - best-effort
  try { await db.ref(`matches/${matchId}/players/${aiUid}/_plannedAction`).set(decision); } catch(e) { void e; }

    // Small randomized delay so the AI doesn't act instantly and so the
    // client can show animations / choice windows similar to a human player.
    // Re-check the match after the delay to avoid racing if the human acted.
    try {
  // Use a human-like thinking pause so AI actions aren't instant.
  // Reduced to ~2 seconds for snappier AI responses per request.
  const delayMs = 2000; // 2000ms == 2s
      await new Promise(r => setTimeout(r, delayMs));
      const freshMatchSnap = await db.ref(`matches/${matchId}`).get();
      if (!freshMatchSnap.exists()) return;
      const freshMatch = freshMatchSnap.val() || {};
      if (freshMatch.status === 'finished') return;
      if (freshMatch.currentTurn !== aiUid) {
        // Turn changed while AI was "thinking"; skip executing an action.
        console.log(`AI ${aiUid} skipping action: turn changed to ${freshMatch.currentTurn}`);
        return;
      }
    } catch (e) {
      // Non-fatal; proceed to execute action
    }

    // Execute action: ability, item, or attack
    if (decision.type === 'ability') {
      // use the more-accurate ability handler when AI picks an ability
      await applyAbility(db, matchId, aiUid, humanUid, decision.id, aiState, humanState, match);
    } else if (decision.type === 'item') {
      await applyItem(db, matchId, aiUid, decision.id, aiState, humanState, match);
    } else if (decision.type === 'attack') {
      await applyAiAttack(db, matchId, aiUid, humanUid, aiState, humanState, match);
    }
  } catch (e) {
    console.error('Error handling AI turn for match', matchId, e);
  }
});

