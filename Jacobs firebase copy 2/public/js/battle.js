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
  warrior_shout:  { id: 'warrior_shout', name: 'Battle Shout', cost: 0, cooldown: 5, desc: 'Increase your attack boost for 2 turns.' },
  archer_poison:  { id: 'archer_poison', name: 'Poison Arrow', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison (DOT).' }
};

ABILITIES.cleric_heal = { id: 'cleric_heal', name: 'Divine Heal', cost: 8, cooldown: 3, desc: 'Restore a moderate amount of HP to yourself and dispel poison/burn from yourself.' };
ABILITIES.cleric_smite = { id: 'cleric_smite', name: 'Smite', cost: 6, cooldown: 4, desc: 'Holy damage that also dispels poison/burn from yourself.' };

// Third abilities added for each class
ABILITIES.warrior_whirlwind = { id: 'warrior_whirlwind', name: 'Whirlwind', cost: 0, cooldown: 4, desc: 'Spin and strike hard, dealing physical damage and reducing the enemy attack for a short time.' };
ABILITIES.mage_arcane_burst = { id: 'mage_arcane_burst', name: 'Arcane Burst', cost: 12, cooldown: 5, desc: 'A focused magical blast that deals strong magic damage and empowers the caster with a temporary +9 attack instead of burning the foe.' };
ABILITIES.archer_trap = { id: 'archer_trap', name: 'Trap', cost: 0, cooldown: 5, desc: 'Set a wound-trap on the enemy (applies bleeding over time).' };
ABILITIES.cleric_shield = { id: 'cleric_shield', name: 'Sanctuary Shield', cost: 6, cooldown: 5, desc: 'Create a holy shield around yourself that raises defense for a few turns.' };
ABILITIES.knight_bastion = { id: 'knight_bastion', name: 'Bastion', cost: 0, cooldown: 6, desc: 'Enter a bastion state: large temporary defense increase for several turns.' };
ABILITIES.rogue_evade = { id: 'rogue_evade', name: 'Evasive Roll', cost: 0, cooldown: 4, desc: 'Delay your action and unleash three rapid, consecutive turns.' };
ABILITIES.paladin_bless = { id: 'paladin_bless', name: 'Blessing', cost: 8, cooldown: 5, desc: 'A small heal and an inspirational attack boost to yourself.' };
ABILITIES.necro_curse = { id: 'necro_curse', name: 'Curse of Decay', cost: 10, cooldown: 5, desc: 'Afflict the target so they suffer reduced healing (slimed) and ongoing rot.' };
ABILITIES.druid_barkskin = { id: 'druid_barkskin', name: 'Barkskin', cost: 8, cooldown: 5, desc: 'Harden your skin: heal a small amount, gain +8 defense for several turns, and lash the enemy for minor damage.' };

ABILITIES.knight_guard = { id: 'knight_guard', name: 'Guard Stance', cost: 0, cooldown: 4, desc: 'Increase defense with a shield for 2 turns.' };
ABILITIES.knight_charge = { id: 'knight_charge', name: 'Mounted Charge', cost: 0, cooldown: 3, desc: 'Powerful charge that may stun.' };

ABILITIES.rogue_backstab = { id: 'rogue_backstab', name: 'Backstab', cost: 0, cooldown: 3, desc: 'High damage attack that ignores some defense.' };
ABILITIES.rogue_poisoned_dagger = { id: 'rogue_poisoned_dagger', name: 'Poisoned Dagger', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison.' };

ABILITIES.paladin_aura = { id: 'paladin_aura', name: 'Aura of Valor', cost: 0, cooldown: 5, desc: 'Boost your attack for a few turns.' };
ABILITIES.paladin_holy_strike = { id: 'paladin_holy_strike', name: 'Holy Strike', cost: 10, cooldown: 4, desc: 'Deal holy damage and heal yourself a bit.' };

ABILITIES.necro_siphon = { id: 'necro_siphon', name: 'Siphon Life', cost: 8, cooldown: 3, desc: 'Deal damage and heal the caster for part of it. Deals double damage against targets suffering reduced healing (slimed).' };
ABILITIES.necro_raise = { id: 'necro_raise', name: 'Raise Rot', cost: 12, cooldown: 5, desc: 'Inflict a necrotic poison that deals stronger damage over several turns.' };

ABILITIES.druid_entangle = { id: 'druid_entangle', name: 'Entangle', cost: 0, cooldown: 3, desc: "Conjure grasping vines that deal increased immediate damage, have a 10% chance to stun, and weaken the target's attack for a short time." };
ABILITIES.druid_regrowth = { id: 'druid_regrowth', name: 'Regrowth', cost: 8, cooldown: 4, desc: 'A larger immediate heal and a stronger regeneration-over-time to restore allies.' };

const CLASS_STATS = {
  warrior: { name: 'Warrior', hp: 120, maxHp: 120, baseAtk: 12, defense: 4, attackBoost: 0, fainted: false, abilities: ['warrior_rend', 'warrior_shout', 'warrior_whirlwind'] },
  mage:    { name: 'Mage',    hp: 80,  maxHp: 80,  baseAtk: 16, defense: 1, attackBoost: 0, fainted: false, abilities: ['mage_fireball', 'mage_iceblast', 'mage_arcane_burst'], mana: 30 },
  archer:  { name: 'Archer',  hp: 95,  maxHp: 95,  baseAtk: 14, defense: 2, attackBoost: 0, fainted: false, abilities: ['archer_volley', 'archer_poison', 'archer_trap'] }
};

CLASS_STATS.cleric = { name: 'Cleric', hp: 90, maxHp: 90, baseAtk: 8, defense: 2, attackBoost: 0, fainted: false, abilities: ['cleric_heal', 'cleric_smite', 'cleric_shield'], mana: 30 };
CLASS_STATS.knight = { name: 'Knight', hp: 140, maxHp: 140, baseAtk: 13, defense: 6, attackBoost: 0, fainted: false, abilities: ['knight_guard', 'knight_charge', 'knight_bastion'], mana: 0 };
CLASS_STATS.rogue = { name: 'Rogue', hp: 85, maxHp: 85, baseAtk: 18, defense: 1, attackBoost: 0, fainted: false, abilities: ['rogue_backstab', 'rogue_poisoned_dagger', 'rogue_evade'], mana: 0 };
CLASS_STATS.paladin = { name: 'Paladin', hp: 130, maxHp: 130, baseAtk: 11, defense: 5, attackBoost: 0, fainted: false, abilities: ['paladin_aura', 'paladin_holy_strike', 'paladin_bless'], mana: 15 };
CLASS_STATS.necromancer = { name: 'Necromancer', hp: 75, maxHp: 75, baseAtk: 12, defense: 1, attackBoost: 0, fainted: false, abilities: ['necro_siphon', 'necro_raise', 'necro_curse'], mana: 35 };
// Increased Druid health per balance request
CLASS_STATS.druid = { name: 'Druid', hp: 100, maxHp: 100, baseAtk: 12, defense: 2, attackBoost: 0, fainted: false, abilities: ['druid_entangle', 'druid_regrowth', 'druid_barkskin'], mana: 30 };

// Mapping for item image filenames in this project's public/img directory.
// Prefer these filenames (they exist under Jacobs firebase/public/img). Fall back to img/items/<id>.jpg/svg when missing.
const ITEM_IMAGE_MAP = {
  potion_small: 'small potion.jpg',
  potion_large: 'large potion.jpg',
  bomb: 'bomb.jpg',
  elixir: 'elixir.jpg',
  shield_token: 'shield scroll.jpg',
  speed_scroll: 'speed scroll.jpg',
  strength_tonic: 'strength tonic.jpg',
  revive_scroll: 'revive scroll.jpg',
  // (removed legacy 'jps' stray token mapping per request)
};

function getItemImagePaths(itemId) {
  const mapped = ITEM_IMAGE_MAP[itemId];
  // Use the project's root public/img path first
  if (mapped) {
    const jpg = `img/${mapped}`;
    // try svg with same base name (replace .jpg with .svg) if available
    const svg = mapped.endsWith('.jpg') ? `img/${mapped.slice(0, -4)}.svg` : `img/${mapped}.svg`;
    return { jpg, svg };
  }
  // fallback to legacy per-item folder
  return { jpg: `img/items/${itemId}.jpg`, svg: `img/items/${itemId}.svg` };
}

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

  // Bleed: percent-based DOT (e.g., 5% max HP per turn)
  if (status.bleed) {
    try {
      const pct = Number(status.bleed.pct || 0);
      const maxHpLocal = actorStats.maxHp || actorStats.maxHP || 100;
      const pDmg = Math.max(1, Math.floor(maxHpLocal * pct));
      const { damage, newHp } = applyDamageToObject({ hp: (updates.hp ?? actorStats.hp) }, pDmg, { ignoreDefense: true });
      updates.hp = newHp;
      messages.push(`${actorStats.name || 'Player'} bleeds for ${damage} damage.`);
      status.bleed.turns = (status.bleed.turns || 0) - 1;
      if (status.bleed.turns <= 0) delete status.bleed;
    } catch (e) { /* ignore bleed processing errors */ }
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
  // also reduce opponent attackBoost immediately so weaken has effect right away
  opponentUpdates.status = newStatus;
  opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
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
  // decrease target's attack immediately to reflect weaken
  opponentUpdates.status = newStatus;
  opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_iceblast'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.mage_iceblast.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_iceblast' }, message: `${user.name || 'You'} blasts ${target.name || 'the target'} with ice for ${damage} damage and lowers attack!`, lastMoveDamage: damage };
  },

  warrior_shout(user, target) {
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_shout') };
    const newStatus = Object.assign({}, user.status || {});
  newStatus.shout = { turns: 2, amount: 8 };
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
    // Immediately reduce target attack when applying weaken (for display and effect)
    if (!newStatus.weakenAppliedByPoison) {
      // Use the weaken mechanic separately if you want to stack; avoid touching attackBoost if not present
      // We'll not modify attackBoost here to preserve previous behavior, but display will reflect weaken if set elsewhere.
    }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_poison') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_poison' }, message: `${user.name || 'You'} hits ${target.name || 'the enemy'} for ${damage} and applies poison!`, lastMoveDamage: damage };
  }

  // New ability handlers for added classes
  ,
  cleric_heal(user, target) {
    const heal = Math.floor(Math.random() * 14) + 12; // 12-25
    // If caster is slimed (healing reduction), reduce heal amount
    const isSlimed = !!(user.status && user.status.slimed);
    const actualHeal = isSlimed ? Math.floor(heal / 2) : heal;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
    // Also dispel harmful DOTs (poison / burn) on self
    const newStatus = Object.assign({}, user.status || {});
    let dispelled = false;
    if (newStatus.poison) { delete newStatus.poison; dispelled = true; }
    if (newStatus.burn) { delete newStatus.burn; dispelled = true; }
    const playerUpdates = { hp: newHp, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_heal'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.cleric_heal.cost || 0)), status: Object.keys(newStatus).length ? newStatus : null };
    const msg = `${user.name || 'You'} channels divine energy and heals for ${actualHeal} HP${dispelled ? ' and dispels harmful effects!' : '!'}`;
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_cleric_heal' }, message: msg, lastMoveHeal: actualHeal };
  },

  cleric_smite(user, target) {
    const base = getEffectiveBaseAtk(user, 8);
    const raw = Math.floor(Math.random() * 8) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw, { ignoreDefense: false });
    const opponentUpdates = { hp: newHp };
    // inflict burn on the enemy
    const oppStatus = Object.assign({}, target.status || {});
    oppStatus.burn = { turns: 3, dmg: 4 };
    opponentUpdates.status = oppStatus;
    // dispel damaging DOTs from self (caster)
    const newStatus = Object.assign({}, user.status || {});
    let dispelled = false;
    if (newStatus.poison) { delete newStatus.poison; dispelled = true; }
    if (newStatus.burn) { delete newStatus.burn; dispelled = true; }
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_smite'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.cleric_smite.cost || 0)), status: Object.keys(newStatus).length ? newStatus : null };
    const msg = `${user.name || 'You'} smite the foe for ${damage} holy damage${dispelled ? ' and dispels DOTs on yourself!' : '!'}`;
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_cleric_smite' }, message: msg, lastMoveDamage: damage };
  },

  knight_guard(user, target) {
    // Make Guard distinct from Bastion: small immediate strike + a short defensive buff
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: newHp };

    const add = 5; // smaller, short-lived defense increase
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 1, amount: add };
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_guard') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_knight_guard' }, message: `${user.name || 'You'} strikes and assumes a guarded stance, dealing ${damage} damage and increasing defense by ${add} for a short time.`, lastMoveDamage: damage };
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
    const defAdd = 5;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 2, amount: amt };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_aura'), attackBoost: (user.attackBoost || 0) + amt, defense: (user.defense || 0) + defAdd, status: newStatus };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_paladin_aura' }, message: `${user.name || 'You'} radiates an Aura of Valor, increasing attack by ${amt} and defense by ${defAdd} for a short time.` };
  },

  paladin_holy_strike(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 10) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
  const heal = Math.floor(damage * 0.4);
  const actualHeal = (user.status && user.status.slimed) ? Math.floor(heal / 2) : heal;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_holy_strike'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.paladin_holy_strike.cost || 0)) };
  playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
  const opponentUpdates = { hp: newHp };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_paladin_holy_strike' }, message: `${user.name || 'You'} smites for ${damage} and is healed for ${actualHeal} HP.`, lastMoveDamage: damage };
  },

  necro_siphon(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    let raw = Math.floor(Math.random() * 10) + base + 6;
    // If target has healing reduction (slimed), siphon does double damage
    const hasHealingReduction = !!(target.status && target.status.slimed);
    if (hasHealingReduction) raw = raw * 2;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
  let healAmt = Math.floor(damage * 0.6);
  // If caster is slimed (healing reduction), reduce siphon heal
  if (user.status && user.status.slimed) healAmt = Math.floor(healAmt / 2);
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
    // Uses weaken status to simulate entangle/root, also deals increased immediate damage and may stun
  const amount = 4;
    const newStatus = Object.assign({}, target.status || {});
    if (!newStatus.weaken) {
      newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    } else {
      newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount;
      newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2);
    }
    // increased immediate damage
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 10) + Math.floor(base / 2);
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { status: newStatus, hp: newHp };
    opponentUpdates.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
    // 15% chance to stun
    if (Math.random() < 0.15) {
      const s = Object.assign({}, newStatus || {});
      s.stun = { turns: 1 };
      opponentUpdates.status = s;
    }
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_entangle') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_druid_entangle' }, message: `${user.name || 'You'} conjures grasping vines that entangle the foe, dealing ${damage} damage and weakening their attacks.`, lastMoveDamage: damage };
  },

  druid_regrowth(user, target) {
    // Larger immediate heal + stronger regen status for more sustained healing
    const immediate = Math.floor(Math.random() * 10) + 10; // 10-19
    const regenAmount = 6; // per turn (increased)
    const regenTurns = 4; // lasts longer
    const actualImmediate = (user.status && user.status.slimed) ? Math.floor(immediate / 2) : immediate;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + actualImmediate);
    const newStatus = Object.assign({}, user.status || {});
    newStatus.regen = { turns: regenTurns, amount: regenAmount };
    const playerUpdates = { hp: newHp, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_regrowth'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.druid_regrowth.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_druid_regrowth' }, message: `${user.name || 'You'} calls regrowth, healing ${actualImmediate} HP and regenerating ${regenAmount} HP for ${regenTurns} turns.`, lastMoveHeal: actualImmediate };
  }

  ,
  // Third-ability handlers
  warrior_whirlwind(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 12) + base + 6;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: newHp };
    // apply a weaken to reduce enemy attack for 2 turns
    const newStatus = Object.assign({}, target.status || {});
    const amount = 3;
    if (!newStatus.weaken) {
      newStatus.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
    } else {
      newStatus.weaken.amount = (newStatus.weaken.amount || 0) + amount;
      newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2);
    }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_whirlwind') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_whirlwind' }, message: `${user.name || 'You'} spins a Whirlwind for ${damage} damage and weakens the foe!`, lastMoveDamage: damage };
  },

  mage_arcane_burst(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 14) + base + 8;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw, { ignoreDefense: true });
    const opponentUpdates = { hp: newHp };
    // Instead of burning the target, empower the caster with a temporary attack boost
    const playerStatus = Object.assign({}, user.status || {});
    const boost = 9;
    playerStatus.shout = { turns: 2, amount: boost };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_arcane_burst'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.mage_arcane_burst.cost || 0)), status: playerStatus, attackBoost: (user.attackBoost || 0) + boost };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_arcane_burst' }, message: `${user.name || 'You'} unleashes Arcane Burst for ${damage} magic damage and is empowered with +${boost} attack!`, lastMoveDamage: damage };
  },

  archer_trap(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 8) + base + 4;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: newHp };
    // Apply bleeding as the trap effect (3 turns, 5% of target max HP per turn)
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 3, pct: 0.05 };
    if (newStatus.bleed) {
      newStatus.bleed.pct = Math.max(newStatus.bleed.pct || 0, incoming.pct);
      newStatus.bleed.turns = Math.max(newStatus.bleed.turns || 0, incoming.turns);
    } else {
      newStatus.bleed = incoming;
    }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_trap') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_trap' }, message: `${user.name || 'You'} sets a trap and deals ${damage} damage, inflicting bleeding for several turns.`, lastMoveDamage: damage };
  },

  cleric_shield(user, target) {
    const add = 10;
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 3, amount: add };
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_shield'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.cleric_shield.cost || 0)) };
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
    // Grant multiple immediate actions: give two extraTurns so the player gets 3 consecutive turns total.
    const newStatus = Object.assign({}, user.status || {});
    newStatus.extraTurns = (newStatus.extraTurns || 0) + 2; // two extra turns (current action + 2 = 3 total)
    const playerUpdates = { status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'rogue_evade') };
    // Keep the current turn with the acting player so they can act immediately
    const matchUpdates = { lastMove: 'special_rogue_evade', currentTurn: currentUserId };
    return { playerUpdates, opponentUpdates: {}, matchUpdates, message: `${user.name || 'You'} performs an evasive roll and gains multiple rapid actions!` };
  },

  paladin_bless(user, target) {
    const baseHeal = 20; // stronger heal as requested
    const actualHeal = (user.status && user.status.slimed) ? Math.floor(baseHeal / 2) : baseHeal;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
    const amt = 8; // stronger attack boost
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 2, amount: amt };
    const playerUpdates = { hp: newHp, attackBoost: (user.attackBoost || 0) + amt, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_bless'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.paladin_bless.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_paladin_bless' }, message: `${user.name || 'You'} calls a Blessing, healing ${actualHeal} HP and gaining +${amt} attack for a short time.`, lastMoveHeal: actualHeal };
  },

  necro_curse(user, target) {
    const base = getEffectiveBaseAtk(user, 9);
    const newStatus = Object.assign({}, target.status || {});
    // apply slimed to reduce healing
    newStatus.slimed = { turns: 4, effect: 'reduce-heal' };
    // apply stronger poison/rot
    const incoming = { turns: 5, dmg: Math.max(2, Math.floor(base / 2)) };
    if (newStatus.poison) {
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns);
    } else {
      newStatus.poison = incoming;
    }
    // also apply a burn
    newStatus.burn = { turns: 3, dmg: 3 };
    // 70% chance to stun
    if (Math.random() < 0.7) {
      newStatus.stun = { turns: 1 };
      try { console.debug('[ability] necro_curse applied stun to target', { caster: user?.name, target: target?.name, status: newStatus }); } catch (e) {}
    }
    const opponentUpdates = { status: newStatus };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_curse'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.necro_curse.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_curse' }, message: `${user.name || 'You'} curses ${target.name || 'the enemy'}, reducing their healing and afflicting rot and flame.` };
  },

  druid_barkskin(user, target) {
    // Barkskin: grant a short defensive shield, heal a bit, and also deal a small lash of damage
    // Fix: when applying a shield we must also increase the actor's defense property so that
    // the shield expiration can safely subtract it without resulting in net negative defense.
    const immediate = 6;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + immediate);
  const shieldAmount = 8; // increased defense boost per request
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 3, amount: shieldAmount };
    // increase defense immediately so the shield has an effect and expires cleanly later
    const playerUpdates = { hp: newHp, status: newStatus, defense: (user.defense || 0) + shieldAmount, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_barkskin'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.druid_barkskin.cost || 0)) };

    // small damaging lash to the target
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + Math.floor(base / 2);
    const { damage, newHp: oppNewHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: oppNewHp };

    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_druid_barkskin' }, message: `${user.name || 'You'} hardens skin and lashes out, healing ${immediate} HP, gaining +${shieldAmount} defense and dealing ${damage} damage to the foe.`, lastMoveHeal: immediate, lastMoveDamage: damage };
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
  // Merge abilities: preserve existing customizations but ensure any newly added class-template
  // abilities are included (so players see the 3rd ability added in code updates).
  const templateAbilities = Array.isArray(classTemplate.abilities) ? classTemplate.abilities : [];
  let resolvedAbilities = templateAbilities.slice();
  if (existing && Array.isArray(existing.abilities) && existing.abilities.length) {
    // Merge unique entries, keeping existing ones first
    const set = new Set([...(existing.abilities || []), ...templateAbilities]);
    resolvedAbilities = Array.from(set);
  }

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
    abilities: resolvedAbilities,
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

  // Listen for rewards being assigned (winner chosen / loser random)
  onValue(ref(db, `matches/${matchId}/rewards`), async (snap) => {
    if (!snap.exists()) return;
    const rewards = snap.val();
    try {
      const matchSnap = await get(matchRef);
      const matchData = matchSnap.exists() ? matchSnap.val() : {};
      const winnerId = matchData?.winner;
      const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
      const rewardStatusEl = document.getElementById('reward-status');
      const chooser = document.getElementById('reward-chooser');
      if (!rewardStatusEl) return;

      // Backwards-compatible shapes: rewards.loser/winner may be a string id or an object { id, uid }
      const loserInfoRaw = rewards?.loser;
      const winnerInfoRaw = rewards?.winner;
      const loserInfo = (typeof loserInfoRaw === 'string' || typeof loserInfoRaw === 'number') ? { id: loserInfoRaw } : (loserInfoRaw || null);
      const winnerInfo = (typeof winnerInfoRaw === 'string' || typeof winnerInfoRaw === 'number') ? { id: winnerInfoRaw } : (winnerInfoRaw || null);

      // If loserInfo is present and has a uid, show to that user; otherwise if only id present and no winner yet, try to infer
      if (loserInfo && loserInfo.id) {
        const ownerUid = loserInfo.uid;
        if (ownerUid) {
          if (currentUserId === ownerUid) {
            const meta = catalog[loserInfo.id] || { id: loserInfo.id, name: loserInfo.id };
            rewardStatusEl.textContent = `You received: ${meta.name}`;
            if (chooser) chooser.style.display = 'none';
          }
        } else {
          // no owner UID written: infer by checking match players if winner set
          if (winnerId) {
            const loserUid = (matchData?.p1 === winnerId) ? matchData?.p2 : matchData?.p1;
            if (currentUserId === loserUid) {
              const meta = catalog[loserInfo.id] || { id: loserInfo.id, name: loserInfo.id };
              rewardStatusEl.textContent = `You received: ${meta.name}`;
              if (chooser) chooser.style.display = 'none';
            }
          }
        }
      }

      // If winnerInfo is present and has uid (preferred), show to that user; otherwise compare to match winner id
      if (winnerInfo && winnerInfo.id) {
        const ownerUid = winnerInfo.uid;
        if (ownerUid) {
          if (currentUserId === ownerUid) {
            const meta = catalog[winnerInfo.id] || { id: winnerInfo.id, name: winnerInfo.id };
            rewardStatusEl.textContent = `You received: ${meta.name}`;
            if (chooser) chooser.style.display = 'none';
          }
        } else if (winnerId && currentUserId === winnerId) {
          const meta = catalog[winnerInfo.id] || { id: winnerInfo.id, name: winnerInfo.id };
          rewardStatusEl.textContent = `You received: ${meta.name}`;
          if (chooser) chooser.style.display = 'none';
        }
      }
    } catch (e) {
      console.error('Error handling rewards listener', e);
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
  // filter out any legacy/removed tokens (e.g., 'jps') so they don't surface in the chooser
  let itemKeys = Object.keys(catalog || {}).filter(k => k !== 'jps');

  // Immediately assign a random reward to the loser so they don't have to wait
  try {
    const rewardsRef = ref(db, `matches/${matchId}/rewards`);
    const rewardsSnap = await get(rewardsRef);
    const existingRewards = rewardsSnap.exists() ? rewardsSnap.val() : {};
    if (!existingRewards || !existingRewards.loser) {
      // choose random item for loser
  const keys = Object.keys(catalog || {}).filter(k => k !== 'jps');
  let randId = 'potion_small';
  if (keys.length) randId = keys[Math.floor(Math.random() * keys.length)];
      const randMeta = catalog[randId] || { id: randId, name: randId };
      // award to loser user record
      if (window && window.addItemToUser) {
        try { await window.addItemToUser(loserUid, { id: randMeta.id, name: randMeta.name, qty: 1 }); } catch (e) { console.error('addItemToUser failed for loser', e); }
      } else {
        try {
          const lItemRef = ref(db, `users/${loserUid}/items/${randMeta.id}`);
          const s2 = await get(lItemRef);
          const qty2 = (s2.exists() && s2.val().qty) ? Number(s2.val().qty) + 1 : 1;
          await update(lItemRef, { id: randMeta.id, name: randMeta.name, qty: qty2 });
        } catch (e) { console.error('Direct DB loser item award failed', e); }
      }
      // write the loser assignment into the match rewards so client UIs update
      try {
        // store as an object with id and uid so clients can unambiguously show the correct owner
        await update(rewardsRef, { loser: { id: randId, uid: loserUid } });
      } catch (e) { console.error('Could not write loser reward to match', e); }
    }
  } catch (e) {
    console.error('Error assigning random loser reward', e);
  }

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

    // write winner choice into match rewards (loser was assigned earlier)
    try {
      await update(ref(db, `matches/${matchId}/rewards`), { winner: { id: chosenItemId, uid: winnerUid } });
    } catch (e) { console.error('Could not write winner reward to match', e); }

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
    const weakenAmt = Number((stats?.status && stats.status.weaken && stats.status.weaken.amount) || 0);
    const displayAtkBoost = atkBoost - weakenAmt;
    statsText.innerHTML = `ATK: ${displayAtkBoost} (base ${baseAtk}) &nbsp; DEF: ${def}`;
    // Replace native title with styled tooltip
    try {
      statsText.classList.add('has-tooltip');
      statsText.setAttribute('data-tooltip', `Base ATK: ${baseAtk}. Current attack boost: ${displayAtkBoost}${weakenAmt ? ` (weakened by ${weakenAmt})` : ''}.`);
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

// This section does: Inventory UI and item usage (rendering, image, qty, and use actions)
async function renderInventory() {
  const invEl = document.getElementById('inventory-list');
  if (!invEl) return;
  invEl.textContent = '(loading...)';

  try {
    if (!currentUserId) {
      invEl.textContent = '(not signed in)';
      return;
    }

    // fetch user's items from DB
    const itemsSnap = await get(ref(db, `users/${currentUserId}/items`));
    const items = itemsSnap.exists() ? itemsSnap.val() : {};
    invEl.innerHTML = '';

    const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};

    const keys = Object.keys(items || {});
    if (!keys.length) {
      invEl.textContent = '(no items)';
      return;
    }

    for (const key of keys) {
      // Skip legacy/removed item ids (e.g. 'jps') so they do not appear in the inventory UI
      if (key === 'jps') continue;
      const it = items[key] || {};
      const row = document.createElement('div');
      row.className = 'inventory-item';
      row.tabIndex = 0; // keyboard focus

      const left = document.createElement('div');
      left.className = 'inv-item-left';

      const img = document.createElement('img');
      img.className = 'inv-item-img';
      const paths = getItemImagePaths(key);
      img.src = paths.jpg;
      img.alt = (catalog[key]?.name) ? catalog[key].name : key;
      img.onerror = function() {
        try {
          // try svg fallback in the preferred location
          if (paths.svg && this.src !== paths.svg) {
            this.onerror = null;
            this.src = paths.svg;
            return;
          }
        } catch (e) {}
        // final fallback to legacy path without spaces
        try { this.onerror = null; this.src = `img/items/${key}.jpg`; } catch (ee) { this.onerror = null; }
      };

      const nameWrap = document.createElement('div');
      nameWrap.innerHTML = `<div class="inv-item-name">${catalog[key]?.name || it.name || key}</div><div class="inv-item-qty">x${it.qty || 1}</div>`;

      left.appendChild(img);
      left.appendChild(nameWrap);

      const right = document.createElement('div');
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'inv-use-btn';
      useBtn.textContent = 'Use';
      useBtn.disabled = !(it.qty > 0);
      if (catalog[key] && catalog[key].desc) {
        useBtn.classList.add('has-tooltip');
        useBtn.setAttribute('data-tooltip', catalog[key].desc);
      }
      useBtn.addEventListener('click', () => { useItem(key).catch(console.error); });

      right.appendChild(useBtn);

      row.appendChild(left);
      row.appendChild(right);
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
      const actualHeal = (playerStats.status && playerStats.status.slimed) ? Math.floor(heal / 2) : heal;
      const newHp = Math.min(playerStats.maxHp || 100, (playerStats.hp || 0) + actualHeal);
      updates.push(update(playerRef, { hp: newHp }));
      matchUpdates.lastMove = 'use_item_potion_small';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveHeal = actualHeal;
    } else if (itemId === 'potion_large') {
      const heal = 50;
      const actualHeal = (playerStats.status && playerStats.status.slimed) ? Math.floor(heal / 2) : heal;
      const newHp = Math.min(playerStats.maxHp || 100, (playerStats.hp || 0) + actualHeal);
      updates.push(update(playerRef, { hp: newHp }));
      matchUpdates.lastMove = 'use_item_potion_large';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveHeal = actualHeal;
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

// This line does: expose renderInventory and useItem for debugging
window.renderInventory = renderInventory;
window.useItem = useItem;

// This section does: wire the Items toggle button to show/hide the inventory panel
try {
  const toggleBtn = document.getElementById('toggle-inventory-btn');
  const invPanel = document.getElementById('inventory');
  if (toggleBtn && invPanel) {
    toggleBtn.addEventListener('click', async () => {
      const hidden = invPanel.classList.toggle('hidden');
      toggleBtn.textContent = hidden ? 'Items' : 'Close Items';
      if (!hidden) {
        try {
          // ensure the user has at least one of each item for testing if inventory is empty
          if (typeof ensureTestItemsForUser === 'function') await ensureTestItemsForUser();
          await renderInventory();
        } catch (e) { console.error('Could not render inventory on open', e); }
      }
    });
  }
} catch (e) { /* ignore DOM timing issues */ }

// This function does: ensure test items exist for the current user (seed one of each catalog item if user has no items)
async function ensureTestItemsForUser() {
  if (!currentUserId) return;
  try {
    const userItemsSnap = await get(ref(db, `users/${currentUserId}/items`));
    if (userItemsSnap.exists() && Object.keys(userItemsSnap.val() || {}).length) return; // already has items

    const catalog = (window.getItemCatalog) ? window.getItemCatalog() : (typeof ITEM_CATALOG !== 'undefined' ? ITEM_CATALOG : {});
    const keys = Object.keys(catalog || {});
    if (!keys.length) return;

    const promises = [];
    for (const k of keys) {
      const meta = catalog[k] || { id: k, name: k };
      const itemRef = ref(db, `users/${currentUserId}/items/${k}`);
      // set qty:1
      promises.push(update(itemRef, { id: meta.id || k, name: meta.name || k, qty: 1 }));
    }
    await Promise.all(promises);
    console.debug('[seed] seeded test items for', currentUserId);
  } catch (e) {
    console.error('ensureTestItemsForUser error', e);
  }
}

// This line does: expose ensureTestItemsForUser for manual testing
window.ensureTestItemsForUser = ensureTestItemsForUser;
