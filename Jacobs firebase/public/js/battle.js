import { auth, db } from "./firebase.js";
import {
  ref,
  onValue,
  set,
  update,
  get,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

let matchId = null;
let currentUserId = null;
let opponentId = null;
let matchRef = null;
let currentTurnRef = null;
let playerRef = null;
let opponentRef = null;
let isPlayer1 = false;
let lastProcessedMoveActor = null;
let lastProcessedMove = null;

// --- ABILITIES metadata (ported from single-player) ---
const ABILITIES = {
  mage_fireball: { id: 'mage_fireball', name: 'Fireball', cost: 10, cooldown: 3, desc: 'Deal strong magic damage and apply burn (DOT for 3 turns).' },
  warrior_rend:  { id: 'warrior_rend',  name: 'Rend',     cost: 0,  cooldown: 3, desc: 'Powerful physical strike that ignores some defense.' },
  archer_volley: { id: 'archer_volley', name: 'Volley',   cost: 0,  cooldown: 3, desc: 'Hits multiple shots; chance to reduce enemy attack.' },
  slime_splatter:{ id: 'slime_splatter',name: 'Splatter', cost: 0,  cooldown: 4, desc: 'Deals damage and applies slime (reduces healing/attack).' },
  gladiator_charge:{id:'gladiator_charge',name:'Charge',  cost: 0,  cooldown: 4, desc: 'Heavy single-target hit with chance to stun.' },
  boss_earthquake:{id:'boss_earthquake', name:'Earthquake', cost:0, cooldown:5, desc:'Massive damage and stuns the player for 1 turn.'},
  mage_iceblast:  { id: 'mage_iceblast', name: 'Ice Blast', cost: 8, cooldown: 4, desc: 'Deal magic damage and reduce enemy ATK for 2 turns.' },
  warrior_shout:  { id: 'warrior_shout', name: 'Battle Shout', cost: 0, cooldown: 5, desc: 'Increase allied attackBoost for 2 turns.' },
  archer_poison:  { id: 'archer_poison', name: 'Poison Arrow', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison (DOT).' }
};

// New classes abilities (added per-request)
ABILITIES.cleric_heal = { id: 'cleric_heal', name: 'Divine Heal', cost: 8, cooldown: 3, desc: 'Restore a moderate amount of HP to yourself.' };
ABILITIES.cleric_smite = { id: 'cleric_smite', name: 'Smite', cost: 6, cooldown: 4, desc: 'Holy damage that also dispels poison/burn.' };

ABILITIES.knight_guard = { id: 'knight_guard', name: 'Guard Stance', cost: 0, cooldown: 4, desc: 'Increase defense with a shield for 2 turns.' };
ABILITIES.knight_charge = { id: 'knight_charge', name: 'Mounted Charge', cost: 0, cooldown: 3, desc: 'Powerful charge that may stun.' };

ABILITIES.rogue_backstab = { id: 'rogue_backstab', name: 'Backstab', cost: 0, cooldown: 3, desc: 'High damage attack that ignores some defense.' };
ABILITIES.rogue_poisoned_dagger = { id: 'rogue_poisoned_dagger', name: 'Poisoned Dagger', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison.' };

ABILITIES.paladin_aura = { id: 'paladin_aura', name: 'Aura of Valor', cost: 0, cooldown: 5, desc: 'Boost your attack for a few turns.' };
ABILITIES.paladin_holy_strike = { id: 'paladin_holy_strike', name: 'Holy Strike', cost: 10, cooldown: 4, desc: 'Deal holy damage and heal yourself a bit.' };

ABILITIES.necro_siphon = { id: 'necro_siphon', name: 'Siphon Life', cost: 8, cooldown: 3, desc: 'Deal damage and heal the caster for part of it.' };
ABILITIES.necro_raise = { id: 'necro_raise', name: 'Raise Rot', cost: 12, cooldown: 5, desc: 'Inflict a necrotic poison that deals stronger damage over several turns.' };

// Druid abilities (replaced Ranger)
ABILITIES.druid_entangle = { id: 'druid_entangle', name: 'Entangle', cost: 0, cooldown: 3, desc: 'Conjure vines that weaken the target for a short time.' };
ABILITIES.druid_regrowth = { id: 'druid_regrowth', name: 'Regrowth', cost: 8, cooldown: 4, desc: 'Heal immediately and apply a small regeneration over time.' };

// --- CLASS stats & ability lists (used to seed player records in DB) ---
const CLASS_STATS = {
  warrior: { name: 'Warrior', hp: 120, maxHp: 120, baseAtk: 12, defense: 4, attackBoost: 0, fainted: false, abilities: ['warrior_rend', 'warrior_shout'] },
  mage:    { name: 'Mage',    hp: 80,  maxHp: 80,  baseAtk: 16, defense: 1, attackBoost: 0, fainted: false, abilities: ['mage_fireball', 'mage_iceblast'], mana: 30 },
  archer:  { name: 'Archer',  hp: 95,  maxHp: 95,  baseAtk: 14, defense: 2, attackBoost: 0, fainted: false, abilities: ['archer_volley', 'archer_poison'] }
};

// Added classes (6 new)
CLASS_STATS.cleric = { name: 'Cleric', hp: 90, maxHp: 90, baseAtk: 8, defense: 2, attackBoost: 0, fainted: false, abilities: ['cleric_heal', 'cleric_smite'], mana: 30 };
CLASS_STATS.knight = { name: 'Knight', hp: 140, maxHp: 140, baseAtk: 13, defense: 6, attackBoost: 0, fainted: false, abilities: ['knight_guard', 'knight_charge'], mana: 0 };
CLASS_STATS.rogue = { name: 'Rogue', hp: 85, maxHp: 85, baseAtk: 18, defense: 1, attackBoost: 0, fainted: false, abilities: ['rogue_backstab', 'rogue_poisoned_dagger'], mana: 0 };
CLASS_STATS.paladin = { name: 'Paladin', hp: 130, maxHp: 130, baseAtk: 11, defense: 5, attackBoost: 0, fainted: false, abilities: ['paladin_aura', 'paladin_holy_strike'], mana: 15 };
CLASS_STATS.necromancer = { name: 'Necromancer', hp: 75, maxHp: 75, baseAtk: 12, defense: 1, attackBoost: 0, fainted: false, abilities: ['necro_siphon', 'necro_raise'], mana: 35 };
CLASS_STATS.druid = { name: 'Druid', hp: 92, maxHp: 92, baseAtk: 12, defense: 2, attackBoost: 0, fainted: false, abilities: ['druid_entangle', 'druid_regrowth'], mana: 25 };

// --- Generic helpers used by abilities and turn processing ---
function applyDamageToObject(targetObj, rawDamage, opts = {}) {
  const ignoreDefense = !!opts.ignoreDefense;
  const defense = ignoreDefense ? 0 : (targetObj.defense || 0);
  const final = Math.max(0, Math.round(rawDamage - defense));
  const newHp = Math.max(0, (targetObj.hp || 0) - final);
  return { damage: final, newHp };
}

// Effective attack includes baseAtk plus any one-turn strength boosts
function getEffectiveBaseAtk(user, fallback = 10) {
  if (!user) return fallback;
  const base = Number(user.baseAtk ?? fallback);
  const temp = (user.status && user.status.strength_boost) ? Number(user.status.strength_boost.amount || 0) : 0;
  return base + temp;
}

function tickCooldownsObject(abilityCooldowns) {
  if (!abilityCooldowns) return {};
  const out = Object.assign({}, abilityCooldowns);
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'number' && out[k] > 0) out[k] = out[k] - 1;
  }
  return out;
}

function regenManaValue(actor, amount = 2) {
  const max = actor?.maxMana || 0;
  if (max <= 0) return actor?.mana || 0;
  return Math.min(max, (actor.mana || 0) + amount);
}

function canUseAbilityLocal(actorStats, abilityId) {
  const abil = ABILITIES[abilityId];
  if (!abil) return false;
  const cd = (actorStats.abilityCooldowns && actorStats.abilityCooldowns[abilityId]) || 0;
  if (cd > 0) return false;
  if (abil.cost && ((actorStats.mana || 0) < abil.cost)) return false;
  return true;
}

function startAbilityCooldownLocal(abilityCooldowns = {}, abilityId) {
  const out = Object.assign({}, abilityCooldowns || {});
  const abil = ABILITIES[abilityId];
  if (!abil) return out;
  out[abilityId] = abil.cooldown || 0;
  return out;
}

// --- Status processing that returns update objects to apply to DB ---
function processStatusEffectsLocal(actorStats) {
  if (!actorStats) return { updates: {}, messages: [] };

  const updates = {};
  const messages = [];
  const status = actorStats.status ? JSON.parse(JSON.stringify(actorStats.status)) : {};

  // Burn: DOT
  if (status.burn) {
    const effectiveAtk = getEffectiveBaseAtk(actorStats, actorStats.baseAtk || 10);
    const dmg = (status.burn.dmg || Math.max(1, Math.floor(effectiveAtk / 3)));
    const { damage, newHp } = applyDamageToObject({ hp: actorStats.hp, defense: 0 }, dmg, { ignoreDefense: true });
    updates.hp = newHp;
    messages.push(`${actorStats.name || 'Player'} suffers ${damage} burn damage.`);
    status.burn.turns = (status.burn.turns || 0) - 1;
    if (status.burn.turns <= 0) delete status.burn;
  }

  // Regeneration / healing-over-time (used by Druid regrowth)
  if (status.regen) {
    const healAmt = status.regen.amount || 3;
    const maxHpLocal = actorStats.maxHp || actorStats.maxHP || 100;
    const newHp = Math.min(maxHpLocal, (updates.hp ?? actorStats.hp) + healAmt);
    updates.hp = newHp;
    messages.push(`${actorStats.name || 'Player'} regenerates ${healAmt} HP.`);
    status.regen.turns = (status.regen.turns || 0) - 1;
    if (status.regen.turns <= 0) delete status.regen;
  }

  // Poison: DOT
  if (status.poison) {
    const pDmg = status.poison.dmg || 1;
    const { damage, newHp } = applyDamageToObject({ hp: (updates.hp ?? actorStats.hp) }, pDmg, { ignoreDefense: true });
    updates.hp = newHp;
    messages.push(`${actorStats.name || 'Player'} suffers ${damage} poison damage.`);
    status.poison.turns = (status.poison.turns || 0) - 1;
    if (status.poison.turns <= 0) delete status.poison;
  }

  // Slimed: reduce heal behavior: just decrement turns
  if (status.slimed) {
    status.slimed.turns = (status.slimed.turns || 0) - 1;
    if (status.slimed.turns <= 0) delete status.slimed;
  }

  // Weaken: restore previous boost when it ends
  if (status.weaken) {
    status.weaken.turns = (status.weaken.turns || 0) - 1;
    if (status.weaken.turns <= 0) {
      if (typeof status.weaken.prevBoost === 'number') {
        updates.attackBoost = status.weaken.prevBoost;
      } else {
        updates.attackBoost = 0;
      }
      delete status.weaken;
    }
  }

  // Shout: decrease turns and remove effect when expired
  if (status.shout) {
    status.shout.turns = (status.shout.turns || 0) - 1;
    if (status.shout.turns <= 0) {
      const amt = status.shout.amount || 0;
      updates.attackBoost = Math.max(0, (actorStats.attackBoost || 0) - amt);
      delete status.shout;
    }
  }

  // Prepare: temporary attack boost that lasts a fixed number of turns (handled like shout)
  if (status.prepare) {
    status.prepare.turns = (status.prepare.turns || 0) - 1;
    if (status.prepare.turns <= 0) {
      const amt = status.prepare.amount || 0;
      updates.attackBoost = Math.max(0, (actorStats.attackBoost || 0) - amt);
      delete status.prepare;
    }
  }

  // Shield: temporary defense buff that expires after its turns
  if (status.shield) {
    status.shield.turns = (status.shield.turns || 0) - 1;
    if (status.shield.turns <= 0) {
      const amt = status.shield.amount || 0;
      updates.defense = Math.max(0, (actorStats.defense || 0) - amt);
      delete status.shield;
    }
  }

  // Stun is handled by the move logic (we'll check actorStats.status.stun in chooseMove)

  updates.status = Object.keys(status).length ? status : null;
  if ((updates.hp ?? actorStats.hp) <= 0) {
    updates.hp = 0;
    updates.fainted = true;
  }

  return { updates, messages };
}

// --- Ability handlers (return DB-friendly update objects) ---
const abilityHandlers = {
  mage_fireball(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 8) + base + 8;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw, { ignoreDefense: true });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.burn = { turns: 3, dmg: Math.max(2, Math.floor(base / 3)) };
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_fireball'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.mage_fireball.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_fireball' }, message: `${user.name || 'You'} casts Fireball for ${damage} damage and inflicts burn!`, lastMoveDamage: damage };
  },

  warrior_rend(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 10) + base + 6;
    const effectiveDefense = (target.defense || 0) / 2;
    const final = Math.max(0, Math.round(raw - effectiveDefense));
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: effectiveDefense }, final, { ignoreDefense: true });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_rend') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_rend' }, message: `${user.name || 'You'} rends ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  archer_volley(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    let total = 0;
    for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 6) + Math.floor(base / 2);
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, total);
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
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_volley') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_volley' }, message: `${user.name || 'You'} fires a volley for ${damage} total damage!`, lastMoveDamage: damage };
  },

  slime_splatter(user, target) {
    const base = getEffectiveBaseAtk(user, 6);
    const raw = Math.floor(Math.random() * 6) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
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
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
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
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
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
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
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
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_iceblast'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.mage_iceblast.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_iceblast' }, message: `${user.name || 'You'} blasts ${target.name || 'the target'} with ice for ${damage} damage and lowers attack!`, lastMoveDamage: damage };
  },

  warrior_shout(user, target) {
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_shout') };
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 2, amount: 4 };
    playerUpdates.status = newStatus;
    playerUpdates.attackBoost = (user.attackBoost || 0) + 8;
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_warrior_shout' }, message: `${user.name || 'You'} shouts and increases their attack!` };
  },

  archer_poison(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 6) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: newHp };
    // merge poison with existing poison if present (refresh turns and keep higher dmg)
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) };
    if (newStatus.poison) {
      // refresh turns to max and use the larger dmg
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns);
    } else {
      newStatus.poison = incoming;
    }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_poison') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_poison' }, message: `${user.name || 'You'} hits ${target.name || 'the enemy'} for ${damage} and applies poison!`, lastMoveDamage: damage };
  }

  // New ability handlers for added classes
  ,
  cleric_heal(user, target) {
    const heal = Math.floor(Math.random() * 14) + 12; // 12-25
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + heal);
    const playerUpdates = { hp: newHp, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_heal'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.cleric_heal.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_cleric_heal' }, message: `${user.name || 'You'} channels divine energy and heals for ${heal} HP!`, lastMoveHeal: heal };
  },

  cleric_smite(user, target) {
    const base = getEffectiveBaseAtk(user, 8);
    const raw = Math.floor(Math.random() * 8) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw, { ignoreDefense: false });
    const opponentUpdates = { hp: newHp };
    // dispel damaging DOTs
    const newStatus = Object.assign({}, target.status || {});
    if (newStatus.poison) delete newStatus.poison;
    if (newStatus.burn) delete newStatus.burn;
    opponentUpdates.status = Object.keys(newStatus).length ? newStatus : null;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_smite'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.cleric_smite.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_cleric_smite' }, message: `${user.name || 'You'} smite the foe for ${damage} holy damage and dispels DOTs!`, lastMoveDamage: damage };
  },

  knight_guard(user, target) {
    const add = 8;
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 2, amount: add };
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_guard') };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_knight_guard' }, message: `${user.name || 'You'} takes a guarded stance, increasing defense by ${add}.` };
  },

  knight_charge(user, target) {
    const base = getEffectiveBaseAtk(user, 13);
    const raw = Math.floor(Math.random() * 14) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_charge') };
    let message = `${user.name || 'You'} charges for ${damage} damage!`;
    if (Math.random() < 0.35) {
      const s = Object.assign({}, target.status || {});
      s.stun = { turns: 1 };
      opponentUpdates.status = s;
      message = `${user.name || 'You'} charges with a crushing blow for ${damage} — ${target.name || 'the enemy'} is stunned!`;
    }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_knight_charge' }, message, lastMoveDamage: damage };
  },

  rogue_backstab(user, target) {
    const base = getEffectiveBaseAtk(user, 16);
    const raw = Math.floor(Math.random() * 12) + base + 8;
    // backstab ignores defense partially
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: Math.floor((target.defense || 0) / 3) }, raw);
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'rogue_backstab') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_rogue_backstab' }, message: `${user.name || 'You'} backstabs ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  rogue_poisoned_dagger(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 8) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: newHp };
    // merge poison with any existing poison
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
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 2, amount: amt };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_aura'), attackBoost: (user.attackBoost || 0) + amt, status: newStatus };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_paladin_aura' }, message: `${user.name || 'You'} radiates an Aura of Valor, increasing attack by ${amt} for a short time.` };
  },

  paladin_holy_strike(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 10) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const heal = Math.floor(damage * 0.4);
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_holy_strike'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.paladin_holy_strike.cost || 0)) };
    playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + heal);
    const opponentUpdates = { hp: newHp };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_paladin_holy_strike' }, message: `${user.name || 'You'} smites for ${damage} and is healed for ${heal} HP.`, lastMoveDamage: damage };
  },

  necro_siphon(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 10) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const healAmt = Math.floor(damage * 0.6);
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_siphon'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.necro_siphon.cost || 0)) };
    playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + healAmt);
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_siphon' }, message: `${user.name || 'You'} siphons ${damage} life and heals for ${healAmt}.`, lastMoveDamage: damage };
  },

  necro_raise(user, target) {
    const base = getEffectiveBaseAtk(user, 9);
    // Increase rot potency: stronger per-turn damage and longer duration
    const poisonDmg = Math.max(2, Math.floor(base / 2));
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 5, dmg: poisonDmg };
    // Merge with existing poison so Raise Rot refreshes/strengthens rather than silently overwrite
    if (newStatus.poison) {
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns);
    } else {
      newStatus.poison = incoming;
    }
    const opponentUpdates = { status: newStatus };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_raise'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.necro_raise.cost || 0)) };
    // Debug to help diagnose in-browser if users report it not applying
    try { console.debug('[ability] necro_raise applied', { caster: user?.name, target: target?.name, incoming, resultingStatus: newStatus }); } catch (e) {}
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_raise' }, message: `${user.name || 'You'} invokes rot; ${target.name || 'the enemy'} is cursed for ${poisonDmg} poison per turn for ${incoming.turns} turns.` };
  },

  druid_entangle(user, target) {
    // Uses weaken status to simulate entangle/root
    const amount = 4;
    const newStatus = Object.assign({}, target.status || {});
    if (!newStatus.weaken) {
      newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    } else {
      newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount;
      newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2);
    }
    const opponentUpdates = { status: newStatus };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_entangle') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_druid_entangle' }, message: `${user.name || 'You'} conjures grasping vines that entangle the foe and weaken their attacks.` };
  },

  druid_regrowth(user, target) {
    // Immediate heal + regen status for a few turns
    const immediate = Math.floor(Math.random() * 8) + 6; // 6-13
    const regenAmount = 4; // per turn
    const regenTurns = 3;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + immediate);
    const newStatus = Object.assign({}, user.status || {});
    newStatus.regen = { turns: regenTurns, amount: regenAmount };
    const playerUpdates = { hp: newHp, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_regrowth'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.druid_regrowth.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_druid_regrowth' }, message: `${user.name || 'You'} calls regrowth, healing ${immediate} HP and regenerating ${regenAmount} HP for ${regenTurns} turns.`, lastMoveHeal: immediate };
  }
};

// Initialize battle when match is found
window.initializeBattle = async function(mId, userId) {
  matchId = mId;
  currentUserId = userId;
  matchRef = ref(db, `matches/${matchId}`);
  currentTurnRef = ref(db, `matches/${matchId}/currentTurn`);
  playerRef = ref(db, `matches/${matchId}/players/${userId}`);

  // Get match data to determine opponent
  const matchSnapshot = await get(matchRef);
  const matchData = matchSnapshot.val();
  
  if (!matchData) return;

  // Determine if this user is player 1 or player 2
  isPlayer1 = matchData.p1 === userId;
  opponentId = isPlayer1 ? matchData.p2 : matchData.p1;
  opponentRef = ref(db, `matches/${matchId}/players/${opponentId}`);

  // Set player names and seed player stats if not already present
  const userSnapshot = await get(ref(db, `users/${userId}`));
  const userName = userSnapshot.val()?.displayName || "Player";

  // Determine player's selected class: prefer DB stored selection, fallback to localStorage
  const dbSelected = userSnapshot.val()?.selectedClass;
  const selectedClass = dbSelected || ((typeof localStorage !== 'undefined') ? (localStorage.getItem('selectedClass') || 'warrior') : 'warrior');
  const classTemplate = CLASS_STATS[selectedClass] || CLASS_STATS.warrior;

  // Get existing player node to avoid overwriting any existing server values
  const existingPlayerSnap = await get(playerRef);
  const existing = existingPlayerSnap.exists() ? existingPlayerSnap.val() : {};

  const seed = {
    name: userName,
    classId: existing.classId || selectedClass,
    baseAtk: existing.baseAtk ?? classTemplate.baseAtk,
    hp: existing.hp ?? classTemplate.hp,
    maxHp: existing.maxHp ?? classTemplate.maxHp,
    defense: existing.defense ?? classTemplate.defense ?? 0,
    attackBoost: existing.attackBoost ?? classTemplate.attackBoost ?? 0,
    fainted: existing.fainted ?? false,
    abilityCooldowns: existing.abilityCooldowns ?? {},
    status: existing.status ?? {},
    abilities: existing.abilities ?? classTemplate.abilities ?? [],
    mana: existing.mana ?? (classTemplate.mana || 0),
    maxMana: existing.maxMana ?? (classTemplate.mana || 0)
  };

  await update(playerRef, seed);

  // Listen to match state changes
  setupMatchListeners();

    // In-match class chooser disabled: keep pre-match selector active but do not prompt a popup
    /*
    try {
      const checkSnap = await get(playerRef);
      const pStats = checkSnap.exists() ? checkSnap.val() : {};
      // classConfirmed is a flag we set after the player chooses in-match; if absent, show chooser
      if (!pStats.classConfirmed) {
        showClassChooseModal();
      }
    } catch (e) {
      console.error('Error checking player classConfirmed state', e);
    }
    */

  // Initial UI update
  updateUI();
  
  // Set initial turn indicator
  const turnSnapshot = await get(currentTurnRef);
  const currentTurn = turnSnapshot.exists() ? turnSnapshot.val() : null;
  showTurnIndicator(currentTurn === currentUserId);

  // Render specials now and attach listeners for updates (player node and turn changes)
  try { await renderSpecialButtons(); } catch (e) { /* ignore */ }
  onValue(playerRef, () => { renderSpecialButtons().catch(console.error); });
  onValue(currentTurnRef, () => { renderSpecialButtons().catch(console.error); });
  // Render inventory and re-render on player/opponent changes
  try { await renderInventory(); } catch (e) { /* ignore */ }
  onValue(playerRef, () => { renderInventory().catch(console.error); });
  onValue(opponentRef, () => { renderInventory().catch(console.error); });
  // Render inventory and re-render on player/opponent changes
  try { await renderInventory(); } catch (e) { /* ignore */ }
  onValue(playerRef, () => { renderInventory().catch(console.error); });
  onValue(opponentRef, () => { renderInventory().catch(console.error); });
  
  // Check if game is already over or players are dead
  const initialMatchSnapshot = await get(matchRef);
  const initialMatchData = initialMatchSnapshot.val();
  
  if (initialMatchData?.status === "finished") {
    // Game is already over, show end game
    const winnerId = initialMatchData?.winner;
    if (winnerId) {
      const isWinner = winnerId === currentUserId;
      const opponentSnapshot = await get(opponentRef);
      const opponentName = opponentSnapshot.val()?.name || "Opponent";
      
      await showEndGame(isWinner, isWinner ? 
        `You win!` : 
        `${opponentName} wins!`);
      disableButtons();
    }
  } else {
    // Check if any player is already dead
    const playerSnapshot = await get(playerRef);
    const opponentSnapshot = await get(opponentRef);
    const playerStats = playerSnapshot.val();
    const opponentStats = opponentSnapshot.val();
    
    if (playerStats?.hp <= 0 && !initialMatchData?.status) {
      await handlePlayerDeath(currentUserId);
    } else if (opponentStats?.hp <= 0 && !initialMatchData?.status) {
      await handlePlayerDeath(opponentId);
    }
  }
  
  logMessage(`Match started!`);
};

function setupMatchListeners() {
  // Listen to current turn changes
  onValue(currentTurnRef, (snap) => {
    const currentTurn = snap.exists() ? snap.val() : null;
    const isMyTurn = currentTurn === currentUserId;
    
    if (isMyTurn) {
      enableButtons();
      showTurnIndicator(true);
    } else {
      disableButtons();
      showTurnIndicator(false);
    }
  });

  // Listen to player stats changes
  onValue(playerRef, (snap) => {
    if (snap.exists()) {
      const stats = snap.val();
      updatePlayerUI(stats, true);
      // Check if player died
      if (stats.hp <= 0 || stats.fainted) {
        handlePlayerDeath(currentUserId);
      }
    }
  });

  // Listen to opponent stats changes
  onValue(opponentRef, (snap) => {
    if (snap.exists()) {
      const stats = snap.val();
      updatePlayerUI(stats, false);
      // Check if opponent died
      if (stats.hp <= 0 || stats.fainted) {
        handlePlayerDeath(opponentId);
      }
    }
  });

  // Listen to match state changes to generate appropriate messages
  onValue(ref(db, `matches/${matchId}`), async (snap) => {
    if (!snap.exists()) return;
    
    const matchData = snap.val();
    
    // Don't process messages if game is finished (end game overlay handles that)
    if (matchData?.status === "finished") {
      return;
    }
    
    const lastMoveActor = matchData?.lastMoveActor;
    const lastMove = matchData?.lastMove;
    
    if (!lastMoveActor || !lastMove) return;
    
    // Only process if this is a new move
    if (lastMoveActor === lastProcessedMoveActor && lastMove === lastProcessedMove) {
      return;
    }
    
    lastProcessedMoveActor = lastMoveActor;
    lastProcessedMove = lastMove;
    
    // Generate message based on who made the move
    const wasMyMove = lastMoveActor === currentUserId;
    
    const playerSnapshot = await get(playerRef);
    const opponentSnapshot = await get(opponentRef);
    const playerStats = playerSnapshot.val();
    const opponentStats = opponentSnapshot.val();
    
    let message = "";
    
    if (wasMyMove) {
      // My move - use first person
      if (lastMove === "attack") {
        const damage = matchData.lastMoveDamage || 0;
        message = `You hit ${opponentStats?.name || "your opponent"} for ${damage} damage!`;
      } else if (lastMove === "heal") {
        const heal = matchData.lastMoveHeal || 0;
        message = `You healed yourself for ${heal} HP!`;
      } else if (lastMove === "defend") {
        message = "You brace yourself for the next attack!";
      } else if (lastMove === "prepare") {
        message = "You prepare for your next move.";
      }
    } else {
      // Opponent's move - use third person
      const opponentName = opponentStats?.name || "Your opponent";
      if (lastMove === "attack") {
        const damage = matchData.lastMoveDamage || 0;
        message = `${opponentName} attacks you for ${damage} damage!`;
      } else if (lastMove === "heal") {
        const heal = matchData.lastMoveHeal || 0;
        message = `${opponentName} healed for ${heal} HP!`;
      } else if (lastMove === "defend") {
        message = `${opponentName} braces for your next attack!`;
      } else if (lastMove === "prepare") {
        message = `${opponentName} prepares for their next move.`;
      }
    }
    
    if (message) {
      logMessage(message);
    }
  });

  // Listen to match status changes (for game over)
  onValue(ref(db, `matches/${matchId}/status`), (snap) => {
    if (snap.exists() && snap.val() === "finished") {
      disableButtons();
      const winnerRef = ref(db, `matches/${matchId}/winner`);
      onValue(winnerRef, async (winnerSnap) => {
        if (winnerSnap.exists()) {
          const winnerId = winnerSnap.val();
          const isWinner = winnerId === currentUserId;
          
          // Get opponent name for message
          const opponentSnapshot = await get(opponentRef);
          const opponentName = opponentSnapshot.val()?.name || "Opponent";
          
          await showEndGame(isWinner, isWinner ? 
            `You win!` : 
            `${opponentName} wins!`);
        }
      }, { once: true });
    }
  });
}

  // In-match class chooser UI helpers
  function showClassChooseModal() {
    // Disabled: in-match class chooser is intentionally turned off.
    // Keep function as a no-op so calls are harmless.
    console.log('[class-choose] showClassChooseModal called but disabled');
  }

  function hideClassChooseModal() {
    // Disabled no-op
    console.log('[class-choose] hideClassChooseModal called but disabled');
  }

  // Apply chosen class into the match's player node and optionally save to users/<uid>/selectedClass
  async function chooseClassInMatch(classId) {
    if (!playerRef || !currentUserId) return;
    const template = CLASS_STATS[classId] || CLASS_STATS.warrior;
    const updates = {
      classId: classId,
      abilities: template.abilities || [],
      baseAtk: template.baseAtk || 10,
      hp: template.hp || 100,
      maxHp: template.maxHp || (template.hp || 100),
      defense: template.defense || 0,
      attackBoost: 0,
      abilityCooldowns: {},
      status: {},
      mana: template.mana || 0,
      maxMana: template.mana || 0,
      classConfirmed: true
    };

    try {
      await update(playerRef, updates);
      // Also save to users/<uid>/selectedClass so future matches remember it
      try { await update(ref(db, `users/${currentUserId}`), { selectedClass: classId }); } catch (e) { console.error('Could not save selectedClass to users node', e); }
      hideClassChooseModal();
      // Refresh UI
      try { await renderSpecialButtons(); } catch (e) { /* ignore */ }
      const snap = await get(playerRef);
      if (snap.exists()) updatePlayerUI(snap.val(), true);
      logMessage(`Class set to ${classId}`);
    } catch (err) {
      console.error('Error applying class in-match:', err);
      logMessage('Could not apply class selection; try again.');
    }
  }

async function handlePlayerDeath(deadPlayerId) {
  // Check if game is already finished
  const matchSnapshot = await get(matchRef);
  const matchData = matchSnapshot.val();
  
  if (matchData?.status === "finished") {
    return; // Already handled
  }
  
  const isMe = deadPlayerId === currentUserId;
  const winnerId = isMe ? opponentId : currentUserId;
  
  // Check for revive flag on the player's match node (one-time revive)
  const deadPlayerRef = ref(db, `matches/${matchId}/players/${deadPlayerId}`);
  try {
    const deadSnap = await get(deadPlayerRef);
    const deadStats = deadSnap.exists() ? deadSnap.val() : {};
    if (deadStats?.has_revive) {
      // consume revive and restore to 30% HP
      const newHp = Math.max(1, Math.ceil((deadStats.maxHp || 100) * 0.3));
        // remove dangerous DOT status effects so revive isn't immediately countered by poison/burn
        const newStatus = Object.assign({}, deadStats.status || {});
        if (newStatus.poison) delete newStatus.poison;
        if (newStatus.burn) delete newStatus.burn;
        await update(deadPlayerRef, { has_revive: null, hp: newHp, fainted: false, status: Object.keys(newStatus).length ? newStatus : null });
      logMessage('A Revive Scroll saved the player from defeat!');
      return; // do not finish match
    }
  } catch (e) {
    console.error('Error checking revive', e);
  }

  // Update match status
  await update(matchRef, {
    status: "finished",
    winner: winnerId
  });
  
  // Mark player as fainted if not already
  await update(deadPlayerRef, {
    fainted: true,
    hp: 0
  });

  // Give rewards: increment wins/losses and award consolation items
  // Initiate reward phase: winner chooses an item, loser gets a random item.
  try {
    const winnerUid = winnerId;
    const loserUid = deadPlayerId;
    // show chooser UI for the winner, and waiting text for the loser
    initiateRewardPhase(winnerUid, loserUid).catch(console.error);
  } catch (e) {
    console.error('Reward initiation failed', e);
  }
  
  // Disable buttons
  disableButtons();
  
  // Show end game UI
  const opponentSnapshot = await get(opponentRef);
  const opponentName = opponentSnapshot.val()?.name || "Opponent";
  
  if (isMe) {
    await showEndGame(false, `${opponentName} wins! You have been defeated!`);
  } else {
    await showEndGame(true, `You win! ${opponentName} has been defeated!`);
  }
}

// Reward flow helpers
async function initiateRewardPhase(winnerUid, loserUid) {
  // If current user is the winner, show the chooser and let them pick.
  const chooser = document.getElementById('reward-chooser');
  const status = document.getElementById('reward-status');
  if (!chooser || !status) return;
  chooser.style.display = 'none';
  status.textContent = '';

  // get catalog
  const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
  const itemKeys = Object.keys(catalog || {});

  if (currentUserId === winnerUid) {
    // render choices
    chooser.innerHTML = '<div style="margin-bottom:8px;">Pick your reward:</div>';
    const grid = document.createElement('div'); grid.style.display = 'flex'; grid.style.flexWrap = 'wrap'; grid.style.justifyContent = 'center'; grid.style.gap = '8px';
    itemKeys.forEach(k => {
      const meta = catalog[k];
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = meta.name;
      if (meta && meta.desc) {
        b.classList.add('has-tooltip');
        b.setAttribute('data-tooltip', meta.desc);
      }
      b.addEventListener('click', async () => {
        try {
          await finalizeRewards(winnerUid, loserUid, k);
          chooser.style.display = 'none';
          status.textContent = `You received: ${meta.name}. Loser assigned a random reward.`;
        } catch (e) {
          console.error('finalizeRewards error', e);
          status.textContent = '(error assigning rewards)';
        }
      });
      grid.appendChild(b);
    });
    chooser.appendChild(grid);
    chooser.style.display = '';
  } else if (currentUserId === loserUid) {
    // loser: show waiting text until DB updated
    chooser.style.display = 'none';
    status.textContent = 'Match finished — waiting for winner to pick a reward...';
  } else {
    // spectator or other, just hide
    chooser.style.display = 'none';
    status.textContent = '';
  }
}

async function finalizeRewards(winnerUid, loserUid, chosenItemId) {
  // Award chosen item to winner and random to loser; increment wins/losses.
  // Attempt to use window.addItemToUser fallback to manual update.
  try {
    // increment wins/losses
    try {
      const wSnap = await get(ref(db, `users/${winnerUid}/wins`));
      const lSnap = await get(ref(db, `users/${loserUid}/losses`));
      const wVal = (wSnap.exists() ? Number(wSnap.val()) : 0) + 1;
      const lVal = (lSnap.exists() ? Number(lSnap.val()) : 0) + 1;
      await Promise.all([
        update(ref(db, `users/${winnerUid}`), { wins: wVal }),
        update(ref(db, `users/${loserUid}`), { losses: lVal })
      ]);
    } catch (e) { console.error('Could not increment wins/losses', e); }

    // award chosen to winner
    const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
    const chosenMeta = catalog[chosenItemId] || { id: chosenItemId, name: chosenItemId };
    if (window && window.addItemToUser) {
      await window.addItemToUser(winnerUid, { id: chosenMeta.id, name: chosenMeta.name, qty: 1 });
    } else {
      const wItemRef = ref(db, `users/${winnerUid}/items/${chosenMeta.id}`);
      const s = await get(wItemRef);
      const qty = (s.exists() && s.val().qty) ? Number(s.val().qty) + 1 : 1;
      await update(wItemRef, { id: chosenMeta.id, name: chosenMeta.name, qty });
    }

    // award random item to loser (choose from catalog randomly)
    const keys = Object.keys(catalog || {});
    let randId = 'potion_small';
    if (keys.length) {
      randId = keys[Math.floor(Math.random() * keys.length)];
    }
    const randMeta = catalog[randId] || { id: randId, name: randId };
    if (window && window.addItemToUser) {
      await window.addItemToUser(loserUid, { id: randMeta.id, name: randMeta.name, qty: 1 });
    } else {
      const lItemRef = ref(db, `users/${loserUid}/items/${randMeta.id}`);
      const s2 = await get(lItemRef);
      const qty2 = (s2.exists() && s2.val().qty) ? Number(s2.val().qty) + 1 : 1;
      await update(lItemRef, { id: randMeta.id, name: randMeta.name, qty: qty2 });
    }

    // Optionally: write a match-level record of rewards for auditing
    try {
      await update(ref(db, `matches/${matchId}/rewards`), { winner: chosenItemId, loser: randId });
    } catch (e) { /* ignore */ }

  } catch (e) {
    console.error('awardItems error', e);
    throw e;
  }
}

async function showEndGame(isWinner, message) {
  const overlay = document.getElementById("end-game-overlay");
  const content = overlay?.querySelector(".end-game-content");
  const title = document.getElementById("end-game-title");
  const messageEl = document.getElementById("end-game-message");
  
  if (!overlay || !title || !messageEl || !content) return;
  
  // Update title and message
  title.textContent = isWinner ? "Victory!" : "Defeat";
  title.className = isWinner ? "victory" : "defeat";
  messageEl.textContent = message;
  
  // Update content border class
  content.className = isWinner ? "end-game-content victory" : "end-game-content defeat";
  
  // Update return button class
  const returnBtn = document.getElementById("return-to-queue-btn");
  if (returnBtn) {
    returnBtn.className = isWinner ? "return-btn victory" : "return-btn defeat";
  }
  
  // Show overlay
  overlay.style.display = "flex";
  
  // Remove turn indicators
  showTurnIndicator(false);
  
  // Mark fainted players
  markFaintedPlayers();
}

async function markFaintedPlayers() {
  if (!matchId || !currentUserId) return;
  
  const playerCard = document.getElementById("player");
  const enemyCard = document.getElementById("enemy");
  
  const playerSnapshot = await get(playerRef);
  const opponentSnapshot = await get(opponentRef);
  const playerStats = playerSnapshot.val();
  const opponentStats = opponentSnapshot.val();
  
  if (playerStats?.hp <= 0 || playerStats?.fainted) {
    playerCard?.classList.add("fainted");
  } else {
    playerCard?.classList.remove("fainted");
  }
  
  if (opponentStats?.hp <= 0 || opponentStats?.fainted) {
    enemyCard?.classList.add("fainted");
  } else {
    enemyCard?.classList.remove("fainted");
  }
}

// Return to queue button handler
window.returnToQueue = async function() {
  if (!matchId || !currentUserId) return;
  
  // Clear current match reference
  await set(ref(db, `users/${currentUserId}/currentMatch`), null);
  
  // Hide end game overlay
  const overlay = document.getElementById("end-game-overlay");
  if (overlay) {
    overlay.style.display = "none";
  }
  
  // Hide battle UI
  document.getElementById("battle").style.display = "none";
  
  // Show queue button
  document.getElementById("queueBtn").style.display = "inline";
  document.getElementById("queueBtn").textContent = "Find a Match";
  
  // Reset battle state
  matchId = null;
  currentUserId = null;
  opponentId = null;
  lastProcessedMoveActor = null;
  lastProcessedMove = null;
};

function updatePlayerUI(stats, isPlayer) {
  // Elements depending on whether we're updating player or enemy
  const hpBar = isPlayer ? document.getElementById("player-hp") : document.getElementById("enemy-hp");
  const nameElement = isPlayer ? document.getElementById("player-name") : document.getElementById("enemy-name");
  const hpText = isPlayer ? document.getElementById("player-hp-text") : document.getElementById("enemy-hp-text");
  const manaFill = isPlayer ? document.getElementById("player-mana-fill") : document.getElementById("enemy-mana-fill");
  const manaText = isPlayer ? document.getElementById("player-mana-text") : document.getElementById("enemy-mana-text");
  const statsText = isPlayer ? document.getElementById("player-stats") : document.getElementById("enemy-stats");
  const imgEl = isPlayer ? document.getElementById("player-img") : document.getElementById("enemy-img");
  const card = isPlayer ? document.getElementById("player") : document.getElementById("enemy");

  // Defensive defaults
  const hp = Number(stats?.hp ?? 0);
  const rawMaxHp = (stats && (typeof stats.maxHp !== 'undefined' ? stats.maxHp : (typeof stats.maxHP !== 'undefined' ? stats.maxHP : undefined)));
  const maxHp = Number(typeof rawMaxHp !== 'undefined' ? rawMaxHp : (hp || 100)) || 100;
  const mana = Number(stats?.mana ?? 0);
  const rawMaxMana = (stats && (typeof stats.maxMana !== 'undefined' ? stats.maxMana : (typeof stats.maxMP !== 'undefined' ? stats.maxMP : undefined)));
  const maxMana = Number(typeof rawMaxMana !== 'undefined' ? rawMaxMana : 0) || 0;
  // displayMaxMana will be used for rendering (may be inferred)
  let displayMaxMana = maxMana;
  // If maxMana is missing but the class template specifies mana, write it back to the match node
  if (displayMaxMana <= 0) {
    try {
      const cls = stats?.classId || stats?.class;
      if (cls && CLASS_STATS[cls] && CLASS_STATS[cls].mana && matchId) {
        const inferred = CLASS_STATS[cls].mana;
        // write back inferred maxMana and set mana if absent
        const targetUid = isPlayer ? currentUserId : opponentId;
        if (targetUid) {
          const pRef = ref(db, `matches/${matchId}/players/${targetUid}`);
          const toWrite = {};
          if (!stats.hasOwnProperty('maxMana') || !stats.maxMana) toWrite.maxMana = inferred;
          if (!stats.hasOwnProperty('mana') || stats.mana === undefined || stats.mana === null) toWrite.mana = inferred;
          if (Object.keys(toWrite).length) {
            update(pRef, toWrite).catch(() => {});
          }
          // use inferred for rendering immediately
          displayMaxMana = inferred;
        }
      }
    } catch (e) { /* ignore */ }
  }
  const atk = Number(stats?.baseAtk ?? stats?.attack ?? 0);
  const def = Number(stats?.defense ?? stats?.def ?? 0);

  // HP bar and text
  if (hpBar) {
    const hpPercent = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
    hpBar.style.width = hpPercent + "%";
  }
  if (hpText) {
    hpText.textContent = `HP: ${hp}/${maxHp}`;
  }

  // Mana bar and text
  if (manaFill) {
    const manaPercent = displayMaxMana > 0 ? Math.max(0, Math.min(100, (mana / displayMaxMana) * 100)) : 0;
    manaFill.style.width = manaPercent + "%";
  }
  if (manaText) {
    if (displayMaxMana > 0) {
      manaText.textContent = `Mana: ${mana}/${displayMaxMana}`;
    } else {
      manaText.textContent = '';
    }
  }

  // ATK / DEF text
  if (statsText) {
    // Display attack boost (ATK) primarily, with base attack shown in parentheses
    const atkBoost = Number(stats?.attackBoost ?? 0);
    const baseAtk = Number(stats?.baseAtk ?? 0);
    statsText.innerHTML = `ATK: ${atkBoost} (base ${baseAtk}) &nbsp; DEF: ${def}`;
    // Replace native title with styled tooltip
    try {
      statsText.classList.add('has-tooltip');
      statsText.setAttribute('data-tooltip', `Base ATK: ${baseAtk}. Current attack boost: ${atkBoost}.`);
    } catch (e) { /* ignore DOM issues */ }
  }

  // Name
  if (nameElement && stats.name) {
    nameElement.textContent = stats.name;
  }

  // Set character image based on classId (best-effort)
  try {
    const classId = stats?.classId || stats?.class || 'warrior';
    const jpg = `img/${classId}.jpg`;
    const svg = `img/${classId}.svg`;
    if (imgEl) {
      // attempt JPG -> SVG -> inline SVG fallback
      imgEl._triedSvg = false;
      imgEl.onerror = function() {
        try {
          if (!imgEl._triedSvg) {
            imgEl._triedSvg = true;
            imgEl.src = svg; // try svg next
            return;
          }
        } catch (ee) { /* ignore */ }
        // last resort: inline SVG showing the initial
        const initial = (classId && classId[0]) ? classId[0].toUpperCase() : '?';
        const inline = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='100%' height='100%' fill='%23ddd'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='40' fill='%23666' font-family='Arial,Helvetica,sans-serif'>${initial}</text></svg>`;
        imgEl.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(inline);
        imgEl.onerror = null;
      };
      // start with JPG
      imgEl.src = jpg;
    }
  } catch (e) {
    /* ignore image setting errors */
  }

  // Fainted visual state
  if (card) {
    if (hp <= 0 || stats.fainted) {
      card.classList.add("fainted");
    } else {
      card.classList.remove("fainted");
    }
  }
}
// Renders the player's special ability buttons and updates their disabled state
async function renderSpecialButtons() {
  const specials = document.getElementById('specials');
  if (!specials) return;
  // concurrency guard: increment token and only let the latest invocation mutate the DOM
  if (typeof renderSpecialButtons._callId === 'undefined') renderSpecialButtons._callId = 0;
  const callId = ++renderSpecialButtons._callId;

  // read current player node from DB
  if (!playerRef) return; // not initialized yet
  const pSnap = await get(playerRef);
  const playerStats = pSnap.exists() ? pSnap.val() : null;
  if (!playerStats || !Array.isArray(playerStats.abilities)) return;

  // whether it's our turn (reads match.currentTurn)
  const turnSnap = await get(currentTurnRef);
  const isMyTurn = turnSnap.exists() && turnSnap.val() === currentUserId;

  // If another newer call started, abort to avoid duplicate rendering
  if (callId !== renderSpecialButtons._callId) {
    console.log('[renderSpecialButtons] aborted stale call', callId);
    return;
  }

  specials.innerHTML = '';

    playerStats.abilities.forEach((abilityId) => {
    const abil = ABILITIES[abilityId] || { name: abilityId, cooldown: 0, cost: 0 };
    const cd = (playerStats.abilityCooldowns && (playerStats.abilityCooldowns[abilityId] || 0)) || 0;
    const cost = abil.cost || 0;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${abil.name}${cd > 0 ? ` (CD:${cd})` : (cost ? ` (${cost}M)` : '')}`;
    btn.disabled = !isMyTurn || cd > 0 || (cost && ((playerStats.mana || 0) < cost));
    // use custom styled tooltip instead of native title
    if (abil.desc) {
      btn.classList.add('has-tooltip');
      btn.setAttribute('data-tooltip', abil.desc);
    }
    btn.addEventListener('click', () => chooseSpecial(abilityId));
    specials.appendChild(btn);
  });
}

// NOTE: specials listeners are attached when a match is initialized (initializeBattle)
function updateUI() {
  // UI is updated via listeners
}

function showTurnIndicator(isMyTurn) {
  const playerIndicator = document.getElementById("player-turn-indicator");
  const enemyIndicator = document.getElementById("enemy-turn-indicator");
  const playerCard = document.getElementById("player");
  const enemyCard = document.getElementById("enemy");
  
  if (isMyTurn) {
    playerIndicator?.classList.add("active");
    enemyIndicator?.classList.remove("active");
    playerCard?.classList.add("active-turn");
    enemyCard?.classList.remove("active-turn");
  } else {
    playerIndicator?.classList.remove("active");
    enemyIndicator?.classList.add("active");
    playerCard?.classList.remove("active-turn");
    enemyCard?.classList.add("active-turn");
  }
}

function logMessage(msg) {
  const messageEl = document.getElementById("message");
  if (messageEl) {
    messageEl.textContent = msg;
  }
  console.log(msg);
}

function enableButtons() {
  const buttons = document.querySelectorAll("#menu button");
  buttons.forEach(btn => {
    btn.disabled = false;
    btn.style.opacity = "1";
  });
}

function disableButtons() {
  const buttons = document.querySelectorAll("#menu button");
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  });
}

async function chooseMove(move) {
  if (!matchId || !currentUserId) {
    logMessage("Not in a match!");
    return;
  }

  // Check if it's the player's turn
  const turnSnapshot = await get(currentTurnRef);
  if (!turnSnapshot.exists() || turnSnapshot.val() !== currentUserId) {
    logMessage("It's not your turn!");
    return;
  }

  // Get current player stats
  const playerSnapshot = await get(playerRef);
  const playerStats = playerSnapshot.val();

  if (!playerStats || playerStats.fainted) {
    logMessage("You cannot move, you have fainted!");
    return;
  }

  // Get opponent stats
  const opponentSnapshot = await get(opponentRef);
  const opponentStats = opponentSnapshot.val();

  if (!opponentStats || opponentStats.fainted) {
    logMessage("Opponent has fainted! You win!");
    return;
  }

  // --- process status effects for the acting player before their action ---
  try {
    const statusRes = processStatusEffectsLocal(playerStats);
    if (statusRes.messages && statusRes.messages.length) statusRes.messages.forEach(m => logMessage(m));
    if (statusRes.updates && Object.keys(statusRes.updates).length) {
      await update(playerRef, statusRes.updates);
      const refreshed = await get(playerRef);
      Object.assign(playerStats, refreshed.val());
    }
  } catch (err) {
    console.error('Error while processing statuses:', err);
  }

  // Re-check faint after status effects
  if (!playerStats || playerStats.fainted || playerStats.hp <= 0) {
    logMessage("You cannot move, you have fainted!");
    return;
  }

  // Handle stun: if stunned, decrement and end turn
  if (playerStats.status && playerStats.status.stun) {
    logMessage("You are stunned and cannot act!");
    const newStatus = Object.assign({}, playerStats.status || {});
    newStatus.stun.turns = (newStatus.stun.turns || 1) - 1;
    const pUpdates = { status: Object.keys(newStatus).length ? newStatus : null };
    if (newStatus.stun.turns <= 0) {
      delete newStatus.stun;
      pUpdates.status = Object.keys(newStatus).length ? newStatus : null;
    }
    await update(playerRef, pUpdates);
    // switch turn to opponent
    await update(matchRef, { currentTurn: opponentId, lastMoveActor: currentUserId, lastMove: 'stunned' });
    disableButtons();
    return;
  }

  // Tick player's ability cooldowns and write back if changed
  const newPlayerCd = tickCooldownsObject(playerStats.abilityCooldowns || {});
  if (JSON.stringify(newPlayerCd) !== JSON.stringify(playerStats.abilityCooldowns || {})) {
    await update(playerRef, { abilityCooldowns: newPlayerCd });
    playerStats.abilityCooldowns = newPlayerCd;
  }

  // Regen small mana amount each turn (if applicable)
  if (playerStats.maxMana > 0) {
    const newMana = regenManaValue(playerStats, 2);
    if (newMana !== playerStats.mana) {
      await update(playerRef, { mana: newMana });
      playerStats.mana = newMana;
    }
  }

  let message = "";
  let updates = {};

  let matchUpdates = {};
  let opponentUpdates = {};
  let playerUpdates = {};
  let gameOver = false;

  let moveDamage = 0;
  let moveHeal = 0;

  // Apply move
  if (move === "attack") {
  const tempBoost = (playerStats.status && playerStats.status.strength_boost) ? Number(playerStats.status.strength_boost.amount || 0) : 0;
  const damage = Math.floor(Math.random() * 10) + 10 + (playerStats.attackBoost || 0) + tempBoost;
    const opponentDefense = opponentStats.defense || 0;
    const actualDamage = Math.max(0, damage - opponentDefense);
    moveDamage = actualDamage;
    const newOpponentHp = Math.max(0, (opponentStats.hp || 100) - actualDamage);
    
    opponentUpdates.hp = newOpponentHp;
    if (newOpponentHp <= 0) {
      opponentUpdates.fainted = true;
      matchUpdates.status = "finished";
      matchUpdates.winner = currentUserId;
      matchUpdates.message = `You defeated ${opponentStats.name || "your opponent"}!`;
      gameOver = true;
    }
  } else if (move === "heal") {
    moveHeal = Math.floor(Math.random() * 15) + 5;
    const currentHp = playerStats.hp || 100;
    const maxHp = playerStats.maxHp || 100;
    const newHp = Math.min(maxHp, currentHp + moveHeal);
    
    playerUpdates.hp = newHp;
  } else if (move === "defend") {
    const currentDefense = playerStats.defense || 0;
    playerUpdates.defense = currentDefense + 5;
  } else if (move === "prepare") {
    // Give a temporary attack boost that lasts for 2 turns (handled in processStatusEffectsLocal)
    const add = 5;
    const newStatus = Object.assign({}, playerStats.status || {});
    newStatus.prepare = { turns: 2, amount: add };
    playerUpdates.status = newStatus;
    playerUpdates.attackBoost = (playerStats.attackBoost || 0) + add;
  }

  // Check for turn counter - reset boosts every 3 turns
  const matchSnapshot = await get(matchRef);
  const matchData = matchSnapshot.val();
  let turnCounter = (matchData?.turnCounter || 0) + 1;
  
  if (turnCounter % 3 === 0 && turnCounter > 0) {
    playerUpdates.attackBoost = 0;
    opponentUpdates.attackBoost = 0;
  }

  // Reset player's defense at the start of their turn (defense from previous turn expires)
  // Unless they're defending again this turn
  if (move !== "defend") {
    playerUpdates.defense = 0;
  }
  
  // Reset opponent's defense (their turn has ended, so their defense expires)
  opponentUpdates.defense = 0;

  // Update turn counter and switch turns (unless game over)
  if (!gameOver) {
    matchUpdates.turnCounter = turnCounter;
    // If player has an extraTurns buffer, consume one and keep the turn
    const extra = (playerStats.status && playerStats.status.extraTurns) ? Number(playerStats.status.extraTurns) : 0;
    if (extra > 0) {
      // decrement extraTurns and persist it
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.extraTurns = Math.max(0, extra - 1);
      if (newStatus.extraTurns <= 0) delete newStatus.extraTurns;
      matchUpdates.currentTurn = currentUserId;
      // also write back updated status for player
      playerUpdates.status = Object.keys(newStatus).length ? newStatus : null;
    } else {
      matchUpdates.currentTurn = opponentId;
    }
  }
  matchUpdates.lastMove = move;
  matchUpdates.lastMoveActor = currentUserId;
  if (moveDamage > 0) {
    matchUpdates.lastMoveDamage = moveDamage;
  }
  if (moveHeal > 0) {
    matchUpdates.lastMoveHeal = moveHeal;
  }

  // Apply all updates atomically using Promise.all
  const updatePromises = [];
  
  if (Object.keys(playerUpdates).length > 0) {
    updatePromises.push(update(playerRef, playerUpdates));
  }
  
  if (Object.keys(opponentUpdates).length > 0) {
    updatePromises.push(update(opponentRef, opponentUpdates));
  }
  
  if (Object.keys(matchUpdates).length > 0) {
    updatePromises.push(update(matchRef, matchUpdates));
  }

  await Promise.all(updatePromises);

  // Check for game over
  if (gameOver) {
    disableButtons();
    return;
  }
}

// Make chooseMove available globally
window.chooseMove = chooseMove;

// --- Firebase-aware chooser for special abilities ---
async function chooseSpecial(abilityId) {
  if (!matchId || !currentUserId) {
    logMessage("Not in a match!");
    return;
  }

  // Validate it's player's turn
  const turnSnapshot = await get(currentTurnRef);
  if (!turnSnapshot.exists() || turnSnapshot.val() !== currentUserId) {
    logMessage("It's not your turn!");
    return;
  }

  // Fetch latest player and opponent states
  const [pSnap, oSnap] = await Promise.all([ get(playerRef), get(opponentRef) ]);
  const playerStats = pSnap.val();
  const opponentStats = oSnap.val();

  if (!playerStats || playerStats.fainted) {
    logMessage("You cannot move, you have fainted!");
    return;
  }
  if (!opponentStats || opponentStats.fainted) {
    logMessage("Opponent has fainted! You win!");
    return;
  }

  // Check stun
  if (playerStats.status && playerStats.status.stun) {
    logMessage("You are stunned and cannot act!");
    const newStatus = Object.assign({}, playerStats.status || {});
    newStatus.stun.turns = (newStatus.stun.turns || 1) - 1;
    const pUpdates = { status: Object.keys(newStatus).length ? newStatus : null };
    if (newStatus.stun.turns <= 0) { delete newStatus.stun; pUpdates.status = Object.keys(newStatus).length ? newStatus : null; }
    await update(playerRef, pUpdates);
    await update(matchRef, { currentTurn: opponentId, lastMoveActor: currentUserId, lastMove: 'stunned' });
    disableButtons();
    return;
  }

  // Ability availability
  if (!canUseAbilityLocal(playerStats, abilityId)) {
    logMessage("Special unavailable (cooldown or not enough mana)." );
    return;
  }

  const handler = abilityHandlers[abilityId];
  if (!handler) { logMessage('Unknown ability.'); return; }

  const result = handler(playerStats, opponentStats) || {};
  const playerUpdates = result.playerUpdates || {};
  const opponentUpdates = result.opponentUpdates || {};
  const matchUpdates = Object.assign({}, result.matchUpdates || {});
  const message = result.message || `${playerStats.name || 'You'} used ${abilityId}`;

  matchUpdates.lastMove = matchUpdates.lastMove || `special_${abilityId}`;
  matchUpdates.lastMoveActor = currentUserId;
  if (result.lastMoveDamage) matchUpdates.lastMoveDamage = result.lastMoveDamage;
  // determine next turn, consuming extraTurns if present
  const currentMatchSnap = await get(matchRef);
  matchUpdates.turnCounter = (currentMatchSnap.val()?.turnCounter || 0) + 1;
  const extra = (playerStats.status && playerStats.status.extraTurns) ? Number(playerStats.status.extraTurns) : 0;
  if (extra > 0) {
    // consume one extra turn and keep turn with current player
    const newStatus = Object.assign({}, playerStats.status || {});
    newStatus.extraTurns = Math.max(0, extra - 1);
    if (newStatus.extraTurns <= 0) delete newStatus.extraTurns;
    // merge into playerUpdates so it gets written
    playerUpdates.status = Object.keys(newStatus).length ? newStatus : null;
    matchUpdates.currentTurn = currentUserId;
  } else {
    matchUpdates.currentTurn = opponentId;
  }

  const updatePromises = [];
  if (Object.keys(playerUpdates).length) updatePromises.push(update(playerRef, playerUpdates));
  if (Object.keys(opponentUpdates).length) updatePromises.push(update(opponentRef, opponentUpdates));
  if (Object.keys(matchUpdates).length) updatePromises.push(update(matchRef, matchUpdates));

  await Promise.all(updatePromises);

  logMessage(message);
}
window.chooseSpecial = chooseSpecial;

// ------------------
// Inventory UI + item usage
// ------------------
async function renderInventory() {
  const invEl = document.getElementById('inventory-list');
  if (!invEl) return;
  invEl.textContent = '(loading...)';

  if (!currentUserId) {
    invEl.textContent = '(not signed in)';
    return;
  }

  try {
    // use the helper exposed by app.js
    const items = (window.getUserItems) ? await window.getUserItems(currentUserId) : {};
    if (!items || Object.keys(items).length === 0) {
      invEl.innerHTML = '<div class="inv-empty">(no items)</div>';
      return;
    }

    invEl.innerHTML = '';
    const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
    for (const key of Object.keys(items)) {
      const it = items[key];
      const row = document.createElement('div');
      row.className = 'inventory-item';
      row.tabIndex = 0; // make focusable for keyboard users
      const name = document.createElement('span');
      name.textContent = `${it.name} x${it.qty}`;
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.textContent = 'Use';
      useBtn.className = 'inv-use-btn';
      useBtn.disabled = !(it.qty > 0);
      // add tooltip describing the item when available on the Use button (no hidden text)
      const meta = catalog[key];
      if (meta && meta.desc) {
        useBtn.classList.add('has-tooltip');
        useBtn.setAttribute('data-tooltip', meta.desc);
      }
      useBtn.addEventListener('click', () => { useItem(key).catch(console.error); });
      row.appendChild(name);
      row.appendChild(useBtn);
      invEl.appendChild(row);
    }
  } catch (e) {
    console.error('renderInventory error', e);
    invEl.textContent = '(error)';
  }
}

async function useItem(itemId) {
  if (!matchId || !currentUserId) {
    logMessage('Not in a match or not signed in.');
    return;
  }

  // Require it to be the player's turn (same rule as abilities)
  const turnSnapshot = await get(currentTurnRef);
  if (!turnSnapshot.exists() || turnSnapshot.val() !== currentUserId) {
    logMessage("It's not your turn to use an item.");
    return;
  }

  // Fetch latest states
  const [pSnap, oSnap] = await Promise.all([ get(playerRef), get(opponentRef) ]);
  const playerStats = pSnap.val();
  const opponentStats = oSnap.val();
  if (!playerStats || playerStats.fainted) { logMessage('You cannot use items; you have fainted'); return; }
  if (!opponentStats || opponentStats.fainted) { logMessage('Opponent has fainted'); return; }

  // Consume item in user's profile (window.useItemForUser was added in app.js)
  try {
    if (!window.useItemForUser) throw new Error('useItemForUser helper not available');
    const item = await window.useItemForUser(currentUserId, itemId);
    // Apply effects based on item id
    const updates = [];
    const matchUpdates = {};

    if (itemId === 'potion_small') {
      const heal = 20;
      const newHp = Math.min(playerStats.maxHp || 100, (playerStats.hp || 0) + heal);
      updates.push(update(playerRef, { hp: newHp }));
      matchUpdates.lastMove = 'use_item_potion_small';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveHeal = heal;
    } else if (itemId === 'potion_large') {
      const heal = 50;
      const newHp = Math.min(playerStats.maxHp || 100, (playerStats.hp || 0) + heal);
      updates.push(update(playerRef, { hp: newHp }));
      matchUpdates.lastMove = 'use_item_potion_large';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveHeal = heal;
    } else if (itemId === 'bomb') {
      const dmg = 20;
      const actual = Math.max(0, dmg - (opponentStats.defense || 0));
      const newOppHp = Math.max(0, (opponentStats.hp || 0) - actual);
      updates.push(update(opponentRef, { hp: newOppHp }));
      matchUpdates.lastMove = 'use_item_bomb';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveDamage = actual;
      if (newOppHp <= 0) { matchUpdates.status = 'finished'; matchUpdates.winner = currentUserId; }
    } else if (itemId === 'elixir') {
      // restore mana to max and grant a short attack boost
      const newMana = playerStats.maxMana || playerStats.mana || 0;
      const newStatus = Object.assign({}, playerStats.status || {});
      // temporary attack buff for 2 turns
      newStatus.strength = { turns: 2, amount: 4 };
      updates.push(update(playerRef, { mana: newMana, status: newStatus }));
      matchUpdates.lastMove = 'use_item_elixir';
      matchUpdates.lastMoveActor = currentUserId;
    } else if (itemId === 'shield_token') {
      // grant +10 defense for 1 turn via status
      const add = 10;
      const newDefense = (playerStats.defense || 0) + add;
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.shield = { turns: 1, amount: add };
      updates.push(update(playerRef, { defense: newDefense, status: newStatus }));
      matchUpdates.lastMove = 'use_item_shield_token';
      matchUpdates.lastMoveActor = currentUserId;
    } else if (itemId === 'speed_scroll') {
      // grant an extra action: increment player's extraTurns status and keep current turn
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.extraTurns = (newStatus.extraTurns || 0) + 1;
      updates.push(update(playerRef, { status: newStatus }));
      matchUpdates.lastMove = 'use_item_speed_scroll';
      matchUpdates.lastMoveActor = currentUserId;
      // keep currentTurn with the player so they can act again immediately
      matchUpdates.currentTurn = currentUserId;
    } else if (itemId === 'strength_tonic') {
        // temporary improvement only: +10 strength for 1 turn (no permanent baseAtk increase)
        const newStatus = Object.assign({}, playerStats.status || {});
        newStatus.strength_boost = { turns: 1, amount: 10 };
        updates.push(update(playerRef, { status: newStatus }));
      matchUpdates.lastMove = 'use_item_strength_tonic';
      matchUpdates.lastMoveActor = currentUserId;
    } else if (itemId === 'revive_scroll') {
      // set a one-time revive flag on the player's match node so death handler consumes it
      updates.push(update(playerRef, { has_revive: true }));
      matchUpdates.lastMove = 'use_item_revive_scroll';
      matchUpdates.lastMoveActor = currentUserId;
      logMessage('Revive Scroll prepared: you will be revived automatically if you fall.');
    } else {
      logMessage('Used unknown item: ' + itemId);
    }

    // advance turn and increment counter (unless match ended)
    const curMatchSnap = await get(matchRef);
    const turnCounter = (curMatchSnap.val()?.turnCounter || 0) + 1;
    if (!matchUpdates.status) {
      // If current item explicitly set currentTurn (e.g., speed_scroll), preserve it.
      if (typeof matchUpdates.currentTurn === 'undefined') {
        matchUpdates.currentTurn = opponentId;
      }
      matchUpdates.turnCounter = turnCounter;
    }

    updates.push(update(matchRef, matchUpdates));
    await Promise.all(updates);

    logMessage(`Used ${item.name || itemId}`);
    // re-render inventory
    try { await renderInventory(); } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('useItem error', e);
    logMessage('Could not use item: ' + (e && e.message));
  }
}

// expose for debugging
window.renderInventory = renderInventory;
window.useItem = useItem;
