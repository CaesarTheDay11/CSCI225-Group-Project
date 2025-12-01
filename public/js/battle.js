import { auth, db } from "./firebase.js";
import {
  ref,
  onValue,
  set,
  update,
  get,
  onDisconnect,
  off
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

const DEFAULT_CLASS = "warrior";
const AFK_LIMIT_MS = 45000;
const OFFLINE_LIMIT_MS = 15000;
const TURN_DURATION_MS = 20000;
const MAX_DEADLINE_DRIFT_MS = 60000;
const ITEM_DEFS = {
  healing_potion: {
    label: "Healing Potion",
    description: "Restore 25 HP.",
    effect: (stats) => {
      const maxHp = stats.maxHp || 100;
      const current = stats.hp ?? maxHp;
      const newHp = clampHp(current + 25, maxHp);
      return { playerUpdates: { hp: newHp }, heal: newHp - current, note: "You feel rejuvenated." };
    },
  },
  power_elixir: {
    label: "Power Elixir",
    description: "Gain +6 Attack Boost for this battle.",
    effect: (stats) => ({
      playerUpdates: { attackBoost: (stats.attackBoost || 0) + 6 },
      note: "Power surges through you."
    }),
  },
  iron_skin: {
    label: "Iron Skin",
    description: "Gain +12 guard.",
    effect: (stats) => ({
      playerUpdates: { defense: (stats.defense || 0) + 12 },
      note: "Your skin hardens like steel."
    }),
  },
  swift_boots: {
    label: "Swift Boots",
    description: "Gain +4 Speed.",
    effect: (stats) => ({
      playerUpdates: { speed: (stats.speed || 0) + 4 },
      note: "You feel light on your feet."
    }),
  },
  focus_charm: {
    label: "Focus Charm",
    description: "Gain +8% crit chance.",
    effect: (stats) => ({
      playerUpdates: { critChance: (stats.critChance || 0) + 0.08 },
      note: "Your focus sharpens."
    }),
  },
};
const CLASS_BASE_STATS = {
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
    attackBoost: 0,
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
    attackBoost: 3,
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
    attackBoost: 1,
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
    attackBoost: 0,
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
    attackBoost: 2,
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
    attackBoost: 1,
  },
};

const CLASS_MOVES = {
  warrior: [
    {
      id: "crushing_blow",
      label: "Crushing Blow",
      type: "attack",
      description: "Heavy swing that punishes high-defense foes.",
      execute: (ctx) => {
        const base = roll(14, 20);
        const bonus = getDefenseTotal(ctx.opponentStats, "physical") > 16 ? 5 : 0;
        const { damage, opponentUpdates, crit, missed } = dealDamage(ctx, base + bonus, {
          type: "physical",
          pierce: 3,
          critBonus: 0.05,
        });
        return { damage, opponentUpdates, crit, missed, note: "Armor cracks under the hit." };
      }
    },
    {
      id: "bulwark",
      label: "Bulwark",
      type: "defense",
      description: "Brace hard, restore a bit of HP, and hold the line.",
      execute: (ctx) => {
        const maxHp = ctx.playerStats.maxHp || 100;
        const currentHp = ctx.playerStats.hp ?? maxHp;
        const playerUpdates = {
          defense: (ctx.playerStats.defense || 0) + 12,
          evasion: (ctx.playerStats.evasion || 0) + 0.05,
          hp: clampHp(currentHp + 6, maxHp),
        };
        return {
          playerUpdates,
          heal: playerUpdates.hp - currentHp,
          keepDefense: true,
          note: "You dig in behind your shield."
        };
      }
    },
    {
      id: "execute",
      label: "Execute",
      type: "buff",
      description: "Finish off a weakened foe with brutal force.",
      execute: (ctx) => {
        const threshold = (ctx.opponentStats.maxHp || 100) * 0.35;
        const base = roll(12, 18);
        const boosted = ctx.opponentStats.hp <= threshold ? base + 12 : base;
        const { damage, opponentUpdates, crit, missed } = dealDamage(ctx, boosted, {
          type: "physical",
          pierce: 1,
          critBonus: 0.08,
        });
        return { damage, opponentUpdates, crit, missed, note: "A decisive strike lands." };
      }
    },
    {
      id: "battle_cry",
      label: "Battle Cry",
      type: "buff",
      description: "Rally yourself and rattle their guard.",
      execute: (ctx) => {
        const playerUpdates = {
          attackBoost: (ctx.playerStats.attackBoost || 0) + 6,
          speed: (ctx.playerStats.speed || 0) + 2,
        };
        const opponentUpdates = {
          defense: Math.max(0, (ctx.opponentStats.defense || 0) - 2),
          evasion: Math.max(0, (ctx.opponentStats.evasion || 0) - 0.03),
        };
        return { playerUpdates, opponentUpdates, note: "Your roar shakes their stance." };
      }
    },
  ],
  mage: [
    {
      id: "fireball",
      label: "Fireball",
      type: "attack",
      description: "Blazing orb that ignores most armor.",
      execute: (ctx) => {
        const base = roll(16, 22);
        const { damage, opponentUpdates, crit, missed } = dealDamage(ctx, base, {
          type: "magic",
          pierce: 3,
          critBonus: 0.12,
        });
        return { damage, opponentUpdates, crit, missed, note: "Flames sear through defenses." };
      }
    },
    {
      id: "frost_barrier",
      label: "Frost Barrier",
      type: "defense",
      description: "Ice shield that heals and chills your foe.",
      execute: (ctx) => {
        const heal = roll(6, 12);
        const { healAmount, playerUpdates } = healPlayer(ctx, heal);
        playerUpdates.defense = (playerUpdates.defense || ctx.playerStats.defense || 0) + 7;
        playerUpdates.magicDefense = (ctx.playerStats.magicDefense || 0) + 5;
        const opponentUpdates = {
          defense: Math.max(0, (ctx.opponentStats.defense || 0) - 1),
          speed: Math.max(0, (ctx.opponentStats.speed || 0) - 2),
        };
        return { heal: healAmount, playerUpdates, opponentUpdates, keepDefense: true, note: "A chill guard surrounds you." };
      }
    },
    {
      id: "arcane_surge",
      label: "Arcane Surge",
      type: "buff",
      description: "Channel power, striking now and supercharging next hit.",
      execute: (ctx) => {
        const base = roll(8, 12);
        const { damage, opponentUpdates, crit, missed } = dealDamage(ctx, base, { type: "magic", critBonus: 0.05 });
        const playerUpdates = {
          attackBoost: (ctx.playerStats.attackBoost || 0) + 9,
          critChance: (ctx.playerStats.critChance || 0) + 0.06,
        };
        return {
          damage,
          opponentUpdates,
          crit,
          missed,
          playerUpdates,
          preventBoostReset: true,
          note: "Energy crackles through you."
        };
      }
    },
    {
      id: "chain_lightning",
      label: "Chain Lightning",
      type: "attack",
      description: "Bolt that jumps, dealing reduced follow-up damage.",
      execute: (ctx) => {
        const first = roll(14, 20);
        const { damage: firstHit, opponentUpdates, missed } = dealDamage(ctx, first, {
          type: "magic",
          pierce: 2,
          critBonus: 0.08,
        });
        const follow = Math.max(0, Math.round(firstHit * 0.4));
        const newCtx = { ...ctx, opponentStats: { ...ctx.opponentStats, ...opponentUpdates } };
        const chainedOutcome = chainedDamage(ctx.playerStats, newCtx.opponentStats, follow, {
          type: "magic",
          pierce: 1,
          critBonus: 0.05,
        });
        const { damage: secondHit, opponentUpdates: chained } = chainedOutcome;
        const mergedUpdates = {
          ...opponentUpdates,
          ...chained,
          speed: Math.max(0, ((opponentUpdates.speed ?? ctx.opponentStats.speed) || 0) - 1),
        };
        return {
          damage: firstHit + secondHit,
          opponentUpdates: mergedUpdates,
          missed,
          note: "Lightning arcs twice."
        };
      }
    },
  ],
  archer: [
    {
      id: "aimed_shot",
      label: "Aimed Shot",
      type: "attack",
      description: "Carefully placed arrow with crit chance.",
      execute: (ctx) => {
        const base = roll(12, 18);
        const speedEdge = (ctx.playerStats.speed || 0) > (ctx.opponentStats.speed || 0) ? 0.06 : 0;
        const { damage, opponentUpdates, crit, missed } = dealDamage(ctx, base, {
          type: "physical",
          pierce: 1,
          critBonus: 0.12 + speedEdge,
          accuracyBonus: speedEdge,
        });
        const note = missed ? "The shot sails wide." : (crit ? "Critical hit!" : "Arrow lands true.");
        return { damage, opponentUpdates, crit, missed, note };
      }
    },
    {
      id: "volley",
      label: "Volley",
      type: "attack",
      description: "Loose several arrows to wear them down.",
      execute: (ctx) => {
        let totalDamage = 0;
        let runningOpponent = { ...ctx.opponentStats };
        for (let i = 0; i < 3; i++) {
          const base = roll(6, 9);
          const { damage, nextOpponent } = chainedDamage(ctx.playerStats, runningOpponent, base, {
            type: "physical",
            pierce: 1,
          });
          totalDamage += damage;
          runningOpponent = nextOpponent;
        }
        const opponentUpdates = { hp: runningOpponent.hp, fainted: runningOpponent.hp <= 0 };
        return { damage: totalDamage, opponentUpdates, note: "Arrows keep them busy." };
      }
    },
    {
      id: "evasive_roll",
      label: "Evasive Roll",
      type: "defense",
      description: "Slip aside, ready to counter.",
      execute: (ctx) => {
        const playerUpdates = {
          defense: (ctx.playerStats.defense || 0) + 9,
          evasion: (ctx.playerStats.evasion || 0) + 0.1,
          speed: (ctx.playerStats.speed || 0) + 3,
        };
        return { playerUpdates, keepDefense: true, note: "You reposition quickly." };
      }
    },
    {
      id: "pinning_shot",
      label: "Pinning Shot",
      type: "attack",
      description: "Hamper your foe's offense and lower their guard.",
      execute: (ctx) => {
        const base = roll(10, 16);
        const { damage, opponentUpdates, missed } = dealDamage(ctx, base, {
          type: "physical",
          pierce: 1,
        });
        opponentUpdates.attackBoost = Math.max(0, (ctx.opponentStats.attackBoost || 0) - 4);
        opponentUpdates.defense = Math.max(0, (ctx.opponentStats.defense || 0) - 1);
        opponentUpdates.speed = Math.max(0, (ctx.opponentStats.speed || 0) - 3);
        opponentUpdates.evasion = Math.max(0, (ctx.opponentStats.evasion || 0) - 0.05);
        return { damage, opponentUpdates, missed, note: "Their footing falters." };
      }
    },
  ],
  cleric: [
    {
      id: "smite",
      label: "Smite",
      type: "attack",
      description: "Radiant strike that restores your spirit.",
      execute: (ctx) => {
        const base = roll(12, 18);
        const { damage, opponentUpdates, missed } = dealDamage(ctx, base, {
          type: "magic",
          pierce: 1,
          critBonus: 0.05,
        });
        const heal = Math.ceil(damage * 0.3);
        const healing = healPlayer(ctx, heal);
        return {
          damage,
          opponentUpdates,
          heal: healing.healAmount,
          playerUpdates: healing.playerUpdates,
          missed,
          note: "Light punishes the foe."
        };
      }
    },
    {
      id: "greater_heal",
      label: "Greater Heal",
      type: "heal",
      description: "Restore a large portion of your health.",
      execute: (ctx) => {
        const heal = roll(16, 26);
        const { healAmount, playerUpdates } = healPlayer(ctx, heal);
        return { heal: healAmount, playerUpdates, note: "Wounds knit closed." };
      }
    },
    {
      id: "sanctuary",
      label: "Sanctuary",
      type: "buff",
      description: "Bless yourself, bolster defense, and hush enemy buffs.",
      execute: (ctx) => {
        const playerUpdates = {
          attackBoost: (ctx.playerStats.attackBoost || 0) + 5,
          defense: (ctx.playerStats.defense || 0) + 5,
          magicDefense: (ctx.playerStats.magicDefense || 0) + 4,
          critChance: Math.max(0, (ctx.playerStats.critChance || 0) - 0.02),
        };
        const opponentUpdates = {
          attackBoost: 0,
          critChance: Math.max(0, (ctx.opponentStats.critChance || 0) - 0.05),
        };
        return { playerUpdates, opponentUpdates, keepDefense: true, note: "Divine favor surrounds you." };
      }
    },
    {
      id: "consecrate",
      label: "Consecrate",
      type: "attack",
      description: "Holy ground harms foes and restores you slightly.",
      execute: (ctx) => {
        const base = roll(10, 16);
        const { damage, opponentUpdates, missed } = dealDamage(ctx, base, {
          type: "magic",
          pierce: 1,
        });
        const healing = healPlayer(ctx, Math.ceil(damage * 0.25));
        return {
          damage,
          opponentUpdates,
          heal: healing.healAmount,
          playerUpdates: healing.playerUpdates,
          missed,
          note: "Radiance scorches the wicked."
        };
      }
    },
  ],
  thief: [
    {
      id: "backstab",
      label: "Backstab",
      type: "attack",
      description: "Slip past their guard for a brutal strike.",
      execute: (ctx) => {
        const base = roll(12, 18);
        const { damage, opponentUpdates, crit, missed } = dealDamage(ctx, base, {
          type: "physical",
          pierce: 5,
          accuracyBonus: 0.05,
          critBonus: 0.1,
        });
        return { damage, opponentUpdates, crit, missed, note: "You find a weak spot." };
      }
    },
    {
      id: "smoke_bomb",
      label: "Smoke Bomb",
      type: "defense",
      description: "Vanish briefly to reset the battlefield.",
      execute: (ctx) => {
        const playerUpdates = {
          defense: (ctx.playerStats.defense || 0) + 8,
          evasion: (ctx.playerStats.evasion || 0) + 0.12,
          speed: (ctx.playerStats.speed || 0) + 4,
        };
        const opponentUpdates = {
          attackBoost: 0,
          defense: 0,
        };
        return {
          playerUpdates,
          opponentUpdates,
          keepDefense: true,
          note: "Their vision is clouded."
        };
      }
    },
    {
      id: "drain_strike",
      label: "Drain Strike",
      type: "attack",
      description: "Steal vitality while dealing damage.",
      execute: (ctx) => {
        const base = roll(10, 16);
        const { damage, opponentUpdates, missed } = dealDamage(ctx, base, {
          type: "physical",
          pierce: 2,
        });
        const healing = healPlayer(ctx, Math.ceil(damage * 0.4));
        return {
          damage,
          opponentUpdates,
          heal: healing.healAmount,
          playerUpdates: healing.playerUpdates,
          missed,
          note: "Energy flows back to you."
        };
      }
    },
    {
      id: "poisoned_dart",
      label: "Poisoned Dart",
      type: "attack",
      description: "Light hit that saps their strength.",
      execute: (ctx) => {
        const base = roll(8, 12);
        const { damage, opponentUpdates, missed } = dealDamage(ctx, base, {
          type: "physical",
          pierce: 3,
        });
        opponentUpdates.attackBoost = Math.max(0, (ctx.opponentStats.attackBoost || 0) - 3);
        opponentUpdates.speed = Math.max(0, (ctx.opponentStats.speed || 0) - 3);
        opponentUpdates.evasion = Math.max(0, (ctx.opponentStats.evasion || 0) - 0.04);
        return { damage, opponentUpdates, missed, note: "Toxin weakens your foe." };
      }
    },
  ],
  monk: [
    {
      id: "flurry_strikes",
      label: "Flurry Strikes",
      type: "attack",
      description: "Rapid blows that overwhelm defenses.",
      execute: (ctx) => {
        let totalDamage = 0;
        let runningOpponent = { ...ctx.opponentStats };
        for (let i = 0; i < 3; i++) {
          const base = roll(5, 9);
          const { damage, nextOpponent } = chainedDamage(ctx.playerStats, runningOpponent, base, {
            type: "physical",
            pierce: 1,
          });
          totalDamage += damage;
          runningOpponent = nextOpponent;
        }
        const opponentUpdates = { hp: runningOpponent.hp, fainted: runningOpponent.hp <= 0 };
        return { damage: totalDamage, opponentUpdates, note: "A blur of motion batters your foe." };
      }
    },
    {
      id: "meditate",
      label: "Meditate",
      type: "heal",
      description: "Recover health and focus your chi.",
      execute: (ctx) => {
        const heal = roll(12, 18);
        const { healAmount, playerUpdates } = healPlayer(ctx, heal);
        playerUpdates.attackBoost = (ctx.playerStats.attackBoost || 0) + 5;
        playerUpdates.critChance = (ctx.playerStats.critChance || 0) + 0.05;
        playerUpdates.evasion = (ctx.playerStats.evasion || 0) + 0.04;
        return { heal: healAmount, playerUpdates, note: "Calm power builds." };
      }
    },
    {
      id: "iron_palm",
      label: "Iron Palm",
      type: "attack",
      description: "Strike pressure points to weaken defenses.",
      execute: (ctx) => {
        const base = roll(15, 20);
        const { damage, opponentUpdates } = dealDamage(ctx, base, { type: "physical" });
        opponentUpdates.defense = Math.max(0, (ctx.opponentStats.defense || 0) - 3);
        return { damage, opponentUpdates, note: "Their guard falters." };
      }
    },
    {
      id: "inner_fire",
      label: "Inner Fire",
      type: "buff",
      description: "Convert focus into both offense and resilience.",
      execute: (ctx) => {
        const playerUpdates = {
          attackBoost: (ctx.playerStats.attackBoost || 0) + 4,
          defense: (ctx.playerStats.defense || 0) + 4,
          speed: (ctx.playerStats.speed || 0) + 2,
        };
        const heal = Math.ceil((ctx.playerStats.maxHp || 100) * 0.08);
        const healing = healPlayer(ctx, heal);
        playerUpdates.hp = healing.playerUpdates.hp;
        return { heal: healing.healAmount, playerUpdates, keepDefense: true, note: "You center your spirit." };
      }
    },
  ],
};

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
let playerClass = DEFAULT_CLASS;
let opponentClass = DEFAULT_CLASS;
let prevPlayerStats = null;
let prevOpponentStats = null;
let classSelectEl = null;
let classApplyBtn = null;
let moveInfoOverlay = null;
let moveInfoTitle = null;
let moveInfoBody = null;
let moveInfoType = null;
let opponentLastActive = null;
let matchCreatedAt = null;
let currentTurnId = null;
let opponentPresenceTimeout = null;
let opponentOfflineSince = null;
let opponentPresenceRef = null;
let detachPresenceListener = null;
let latestMatchData = null;
let forceResetting = false;
let turnTimerInterval = null;
let turnTimerDeadline = null;
let skipCounts = {};
let lastTimerTurnId = null;
let disconnectRef = null;
let itemsRef = null;
let itemsListener = null;
let cachedItems = [];

function resetLocalBattleState() {
  stopTurnTimer(true);
  matchId = null;
  currentUserId = null;
  opponentId = null;
  matchRef = null;
  currentTurnRef = null;
  playerRef = null;
  opponentRef = null;
  isPlayer1 = false;
  lastProcessedMoveActor = null;
  lastProcessedMove = null;
  playerClass = DEFAULT_CLASS;
  opponentClass = DEFAULT_CLASS;
  prevPlayerStats = null;
  prevOpponentStats = null;
  classSelectEl = null;
  classApplyBtn = null;
  moveInfoOverlay = null;
  moveInfoTitle = null;
  moveInfoBody = null;
  moveInfoType = null;
  opponentLastActive = null;
  matchCreatedAt = null;
  currentTurnId = null;
  opponentPresenceTimeout = null;
  opponentOfflineSince = null;
  opponentPresenceRef = null;
  detachPresenceListener = null;
  latestMatchData = null;
  forceResetting = false;
  turnTimerInterval = null;
  turnTimerDeadline = null;
  skipCounts = {};
  lastTimerTurnId = null;
  if (disconnectRef) {
    onDisconnect(disconnectRef).cancel().catch(() => {});
    disconnectRef = null;
  }
  if (itemsRef && itemsListener) {
    off(itemsRef, "value", itemsListener);
    itemsListener = null;
  }
  itemsRef = null;
  cachedItems = [];
}

function roll(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampHp(value, maxHp = 100) {
  return Math.max(0, Math.min(maxHp, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPercent(value = 0) {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function formatClassLabel(classKey = DEFAULT_CLASS) {
  if (!classKey) return "Adventurer";
  return classKey.charAt(0).toUpperCase() + classKey.slice(1);
}

function getClassPreset(classKey = DEFAULT_CLASS) {
  return CLASS_BASE_STATS[classKey] || CLASS_BASE_STATS[DEFAULT_CLASS];
}

function mergeWithClassDefaults(stats = {}, classOverride = null) {
  const classKey = classOverride || stats.class || DEFAULT_CLASS;
  const preset = getClassPreset(classKey);
  const merged = { ...preset, ...stats };
  merged.class = classKey;
  merged.maxHp = stats.maxHp ?? preset.maxHp;
  merged.hp = clampHp(stats.hp ?? merged.maxHp, merged.maxHp);
  merged.attackBoost = stats.attackBoost ?? preset.attackBoost ?? 0;
  merged.defense = stats.defense ?? 0;
  merged.critChance = stats.critChance ?? preset.critChance ?? 0;
  merged.evasion = stats.evasion ?? preset.evasion ?? 0;
  return merged;
}

function makeDefaultStats(classKey = DEFAULT_CLASS) {
  const preset = getClassPreset(classKey);
  return {
    ...preset,
    hp: preset.maxHp,
    maxHp: preset.maxHp,
    attackBoost: preset.attackBoost || 0,
    defense: preset.defense || 0,
    fainted: false,
    class: classKey,
    lastActionAt: Date.now(),
  };
}

async function backfillMissingStats(refToUpdate, stats = {}) {
  const merged = mergeWithClassDefaults(stats);
  const keysToBackfill = [
    "maxHp",
    "physicalAttack",
    "magicAttack",
    "physicalDefense",
    "magicDefense",
    "speed",
    "critChance",
    "evasion",
    "attackBoost",
    "defense",
  ];
  const updates = {};
  keysToBackfill.forEach((key) => {
    if (stats[key] === undefined) {
      updates[key] = merged[key];
    }
  });
  if (stats.hp === undefined) {
    updates.hp = merged.hp;
  }
  if (Object.keys(updates).length > 0) {
    await update(refToUpdate, updates);
  }
  return merged;
}

function renderItems(items = []) {
  const list = document.getElementById("items-list");
  if (!list) return;
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = `<p class="muted">No items. Win matches for a chance to earn some!</p>`;
    return;
  }
  items.forEach((item) => {
    const def = ITEM_DEFS[item.id] || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item-button";
    btn.dataset.key = item.key;
    btn.innerHTML = `<div><strong>${def.label || item.label || item.id}</strong><p>${def.description || item.description || ""}</p></div><span>Use</span>`;
    btn.onclick = () => useItem(item);
    list.appendChild(btn);
  });
}

function applyItemEffect(item, stats) {
  const def = ITEM_DEFS[item.id];
  if (!def || !def.effect) return null;
  return def.effect(stats);
}

async function waitForPlayerStates(pRef, oRef, retries = 8, delayMs = 250) {
  for (let i = 0; i < retries; i++) {
    const [pSnap, oSnap] = await Promise.all([get(pRef), get(oRef)]);
    if (pSnap.exists() && oSnap.exists()) {
      return { player: pSnap.val(), opponent: oSnap.val() };
    }
    await sleep(delayMs);
  }
  return { player: null, opponent: null };
}

function getDefenseTotal(stats = {}, type = "physical") {
  const baseDefense = type === "magic" ? (stats.magicDefense || 0) : (stats.physicalDefense || 0);
  return baseDefense + (stats.defense || 0);
}

function getExtraTurnChance(attackerStats = {}, defenderStats = {}) {
  const attackerSpeed = attackerStats.speed || 0;
  const defenderSpeed = defenderStats.speed || 0;
  if (attackerSpeed <= defenderSpeed) return 0;
  const diff = attackerSpeed - defenderSpeed;
  const base = 0.05;
  const scaled = diff * 0.01;
  return Math.min(0.35, base + scaled);
}

function calculateOffense(stats = {}, type = "physical") {
  const baseAttack = type === "magic" ? (stats.magicAttack || 0) : (stats.physicalAttack || 0);
  return baseAttack + (stats.attackBoost || 0);
}

function dealDamage(ctx, baseDamage, opts = {}) {
  const pierce = opts.pierce || 0;
  const type = opts.type || "physical";
  const attacker = mergeWithClassDefaults(ctx.playerStats || {});
  const defender = mergeWithClassDefaults(ctx.opponentStats || {});

  const dodgeChance = Math.min(0.45, Math.max(0, (defender.evasion || 0) - (opts.accuracyBonus || 0)));
  const missed = Math.random() < dodgeChance;
  if (missed) {
    return { damage: 0, opponentUpdates: {}, missed: true };
  }

  const offense = baseDamage + calculateOffense(attacker, type);
  const effectiveDefense = Math.max(0, getDefenseTotal(defender, type) - pierce);
  let damage = Math.max(0, Math.round(offense - effectiveDefense));

  const critChance = Math.min(0.6, Math.max(0, (attacker.critChance || 0) + (opts.critBonus || 0)));
  const crit = Math.random() < critChance;
  if (crit) {
    damage = Math.round(damage * (opts.critMultiplier || 1.5));
  }

  const maxHp = defender.maxHp || 100;
  const newHp = clampHp((defender.hp ?? maxHp) - damage, maxHp);
  const opponentUpdates = { hp: newHp };
  if (newHp <= 0) {
    opponentUpdates.fainted = true;
  }
  return { damage, opponentUpdates, crit, missed: false };
}

function chainedDamage(attackerState, opponentState, baseDamage, opts = {}) {
  const ctx = { playerStats: attackerState, opponentStats: opponentState };
  const result = dealDamage(ctx, baseDamage, opts);
  const nextOpponent = { ...opponentState, ...result.opponentUpdates };
  return { ...result, nextOpponent };
}

function healPlayer(ctx, amount) {
  const merged = mergeWithClassDefaults(ctx.playerStats || {});
  const maxHp = merged.maxHp || 100;
  const startingHp = merged.hp ?? maxHp;
  const newHp = clampHp(startingHp + amount, maxHp);
  const healAmount = newHp - startingHp;
  const playerUpdates = { hp: newHp };
  return { healAmount, playerUpdates };
}

function getMovesForClass(classKey = DEFAULT_CLASS) {
  return CLASS_MOVES[classKey] || CLASS_MOVES[DEFAULT_CLASS];
}

function findMove(moveId, classKey = DEFAULT_CLASS) {
  return getMovesForClass(classKey).find((m) => m.id === moveId) ||
    getMovesForClass(DEFAULT_CLASS).find((m) => m.id === moveId);
}

function describeMove(matchData, wasMyMove, actorStats, targetStats) {
  const moveId = matchData.lastMove;
  if (!moveId) return "";

  const actorName = wasMyMove ? "You" : (actorStats?.name || "Your opponent");
  const targetName = wasMyMove ? (targetStats?.name || "your opponent") : "you";
  const actorClass = actorStats?.class || (wasMyMove ? playerClass : opponentClass);
  const move = findMove(moveId, actorClass);
  const moveLabel = matchData.lastMoveLabel || move?.label || moveId;
  const damage = matchData.lastMoveDamage || 0;
  const heal = matchData.lastMoveHeal || 0;
  const note = matchData.lastMoveNote;
  const cleanNote = note ? note.toString().replace(/[.!]+$/, "") : "";

  const details = [];
  if (damage > 0) {
    details.push(`hit ${targetName} for ${damage}`);
  }
  if (heal > 0) {
    details.push(`restored ${heal} HP`);
  }
  if (cleanNote) {
    details.push(cleanNote);
  }

  if (details.length === 0) return `${actorName} used ${moveLabel}.`;
  return `${actorName} used ${moveLabel}: ${details.join(", ")}.`;
}

function buildStatusChips(stats = {}) {
  const chips = [];
  const preset = getClassPreset(stats.class);
  const attackBoost = stats.attackBoost || 0;
  const defense = stats.defense || 0;
  const speedDiff = (stats.speed || 0) - (preset.speed || 0);
  const critDiff = (stats.critChance || 0) - (preset.critChance || 0);
  const evasionDiff = (stats.evasion || 0) - (preset.evasion || 0);

  if (attackBoost !== 0) {
    chips.push({
      label: `Attack ${attackBoost > 0 ? "+" : ""}${attackBoost}`,
      type: attackBoost > 0 ? "positive" : "negative"
    });
  }

  if (defense !== 0) {
    chips.push({
      label: `Guard ${defense > 0 ? "+" : ""}${defense}`,
      type: defense > 0 ? "positive" : "negative"
    });
  }

  if (speedDiff !== 0) {
    chips.push({
      label: `Speed ${speedDiff > 0 ? "+" : ""}${Math.round(speedDiff)}`,
      type: speedDiff > 0 ? "positive" : "negative"
    });
  }

  if (critDiff !== 0) {
    chips.push({
      label: `Crit ${critDiff > 0 ? "+" : ""}${formatPercent(Math.abs(critDiff))}`,
      type: critDiff > 0 ? "positive" : "negative"
    });
  }

  if (evasionDiff !== 0) {
    chips.push({
      label: `Evade ${evasionDiff > 0 ? "+" : ""}${formatPercent(Math.abs(evasionDiff))}`,
      type: evasionDiff > 0 ? "positive" : "negative"
    });
  }

  if (stats.fainted) {
    chips.push({ label: "Fainted", type: "negative" });
  }

  return chips;
}

function describeStatChanges(current = {}, previous = null) {
  if (!previous) return [];
  const changes = [];

  const hpDiff = (current.hp ?? current.maxHp ?? 0) - (previous.hp ?? previous.maxHp ?? 0);
  if (hpDiff !== 0) {
    changes.push(`HP ${hpDiff > 0 ? "+" : ""}${hpDiff}`);
  }

  const atkDiff = (current.attackBoost || 0) - (previous.attackBoost || 0);
  if (atkDiff !== 0) {
    changes.push(`Attack ${atkDiff > 0 ? "+" : ""}${atkDiff}`);
  }

  const defDiff = (current.defense || 0) - (previous.defense || 0);
  if (defDiff !== 0) {
    changes.push(`Guard ${defDiff > 0 ? "+" : ""}${defDiff}`);
  }

  const speedDiff = (current.speed || 0) - (previous.speed || 0);
  if (speedDiff !== 0) {
    changes.push(`Speed ${speedDiff > 0 ? "+" : ""}${Math.round(speedDiff)}`);
  }

  const critDiff = (current.critChance || 0) - (previous.critChance || 0);
  if (critDiff !== 0) {
    changes.push(`Crit ${critDiff > 0 ? "+" : ""}${formatPercent(Math.abs(critDiff))}`);
  }

  const evasionDiff = (current.evasion || 0) - (previous.evasion || 0);
  if (evasionDiff !== 0) {
    changes.push(`Evasion ${evasionDiff > 0 ? "+" : ""}${formatPercent(Math.abs(evasionDiff))}`);
  }

  if (!previous.fainted && current.fainted) {
    changes.push("Fainted");
  }

  return changes;
}

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
  
  if (!matchData) {
    await forceResetBattle("Match expired or missing, returning to queue.");
    return;
  }
  latestMatchData = matchData;

  // Determine if this user is player 1 or player 2
  isPlayer1 = matchData.p1 === userId;
  opponentId = isPlayer1 ? matchData.p2 : matchData.p1;
  opponentRef = ref(db, `matches/${matchId}/players/${opponentId}`);

  // Set player names if not already set
  const userSnapshot = await get(ref(db, `users/${userId}`));
  const userProfile = userSnapshot.val() || {};
  const userName = userProfile.displayName || "Player";
  
  await update(ref(db, `matches/${matchId}/players/${userId}`), {
    name: userName
  });

  // Load combatant stats (including classes) and render the move menu
  const [playerSnapshot, opponentSnapshot] = await Promise.all([
    get(playerRef),
    get(opponentRef),
  ]);
  let playerStats = playerSnapshot.val() || {};
  let opponentStats = opponentSnapshot.val() || {};

  if (!playerSnapshot.exists()) {
    const fallbackClass = playerStats.class || userProfile.class || DEFAULT_CLASS;
    playerStats = makeDefaultStats(fallbackClass);
    await update(playerRef, playerStats);
  }

  if (!opponentSnapshot.exists()) {
    const waited = await waitForPlayerStates(playerRef, opponentRef);
    playerStats = waited.player || {};
    opponentStats = waited.opponent || {};
  }

  if (!opponentStats || Object.keys(opponentStats).length === 0) {
    await forceResetBattle("Opponent not ready; returning to queue.");
    return;
  }

  if (!playerStats || Object.keys(playerStats).length === 0) {
    playerStats = makeDefaultStats(userProfile.class || DEFAULT_CLASS);
    await update(playerRef, playerStats);
  }

  if (!playerStats || !opponentStats) {
    await forceResetBattle("Match data missing; returning to queue.");
    return;
  }

  // Backfill missing class info from the user profile if needed
  if (!playerStats.class && userProfile.class) {
    playerStats.class = userProfile.class;
    await update(playerRef, { class: userProfile.class });
  }

  if (!opponentStats.class) {
    const opponentProfileSnap = await get(ref(db, `users/${opponentId}`));
    const opponentProfile = opponentProfileSnap.val() || {};
    opponentStats.class = opponentProfile.class || opponentStats.class;
  }

  const mergedPlayerStats = await backfillMissingStats(playerRef, playerStats);
  const mergedOpponentStats = await backfillMissingStats(opponentRef, opponentStats);

  playerClass = mergedPlayerStats.class || DEFAULT_CLASS;
  opponentClass = mergedOpponentStats.class || DEFAULT_CLASS;
  opponentLastActive = mergedOpponentStats.lastActionAt || null;
  matchCreatedAt = matchData?.createdAt || Date.now();

  renderMoveMenu(playerClass);
  updatePlayerUI(mergedPlayerStats, true);
  updatePlayerUI(mergedOpponentStats, false);
  setupClassTestUI();
  setupMoveInfoUI();
  itemsRef = ref(db, `users/${currentUserId}/items`);
  itemsListener = onValue(itemsRef, (snap) => {
    const val = snap.val() || {};
    cachedItems = Object.entries(val).map(([key, itm]) => ({ key, ...itm }));
    renderItems(cachedItems);
  });
  const forfeitBtn = document.getElementById("forfeit-btn");
  if (forfeitBtn) {
    forfeitBtn.onclick = () => forfeitPlayer(currentUserId, "You forfeited the match.");
  }
  startPresenceMonitor();
  await update(playerRef, { lastActionAt: Date.now() });
  startTurnTimer(matchData);

  // Listen to match state changes
  setupMatchListeners();

  // Initial UI update
  updateUI();
  
  // Set initial turn indicator
  const turnSnapshot = await get(currentTurnRef);
  let currentTurn = turnSnapshot.exists() ? turnSnapshot.val() : null;
  if (!currentTurn) {
    const fallbackTurn = isPlayer1 ? currentUserId : opponentId;
    await update(currentTurnRef, fallbackTurn);
    currentTurn = fallbackTurn;
  }
  currentTurnId = currentTurn;
  showTurnIndicator(currentTurn === currentUserId);
  
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
    currentTurnId = currentTurn;
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
    if (!snap.exists()) {
      forceResetBattle("Player data missing; returning to queue.");
      return;
    }
    const stats = mergeWithClassDefaults(snap.val() || {});
    updatePlayerUI(stats, true);
    const newClass = stats.class || DEFAULT_CLASS;
    if (newClass !== playerClass) {
      playerClass = newClass;
      renderMoveMenu(playerClass);
    }
    // Check if player died
    if (stats.hp <= 0 || stats.fainted) {
      handlePlayerDeath(currentUserId);
    }
  });

  // Listen to opponent stats changes
  onValue(opponentRef, (snap) => {
    if (!snap.exists()) {
      forceResetBattle("Opponent data missing; returning to queue.");
      return;
    }
    const stats = mergeWithClassDefaults(snap.val() || {});
    updatePlayerUI(stats, false);
    opponentLastActive = stats.lastActionAt || opponentLastActive;
    opponentClass = stats.class || opponentClass || DEFAULT_CLASS;
    // Check if opponent died
    if (stats.hp <= 0 || stats.fainted) {
      handlePlayerDeath(opponentId);
    }
  });

  // Listen to match state changes to generate appropriate messages
  onValue(ref(db, `matches/${matchId}`), async (snap) => {
    if (!snap.exists()) {
      await forceResetBattle("Match ended or was cleaned up. Returning to queue.");
      return;
    }
    
    const matchData = snap.val();
    latestMatchData = matchData;
    if (!matchCreatedAt && matchData?.createdAt) {
      matchCreatedAt = matchData.createdAt;
    }
    
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
    const playerStats = mergeWithClassDefaults(playerSnapshot.val() || {});
    const opponentStats = mergeWithClassDefaults(opponentSnapshot.val() || {});
    
    const message = describeMove(matchData, wasMyMove, wasMyMove ? playerStats : opponentStats, wasMyMove ? opponentStats : playerStats);
    if (message) {
      logMessage(message);
    }

    startTurnTimer(matchData);
  });

  // Listen to match status changes (for game over)
  onValue(ref(db, `matches/${matchId}/status`), (snap) => {
    if (snap.exists() && snap.val() === "finished") {
      stopTurnTimer();
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

async function handlePlayerDeath(deadPlayerId) {
  // Check if game is already finished
  const matchSnapshot = await get(matchRef);
  const matchData = matchSnapshot.val();
  
  if (matchData?.status === "finished") {
    return; // Already handled
  }
  
  const isMe = deadPlayerId === currentUserId;
  const winnerId = isMe ? opponentId : currentUserId;
  
  // Update match status
  await update(matchRef, {
    status: "finished",
    winner: winnerId
  });
  
  // Mark player as fainted if not already
  const deadPlayerRef = ref(db, `matches/${matchId}/players/${deadPlayerId}`);
  await update(deadPlayerRef, {
    fainted: true,
    hp: 0
  });
  
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
  stopTurnTimer(true);
  
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
  playerClass = DEFAULT_CLASS;
  opponentClass = DEFAULT_CLASS;
  prevPlayerStats = null;
  prevOpponentStats = null;
  if (detachPresenceListener) {
    detachPresenceListener();
    detachPresenceListener = null;
  }
  if (disconnectRef) {
    onDisconnect(disconnectRef).cancel().catch(() => {});
    disconnectRef = null;
  }
  opponentPresenceRef = null;
  opponentOfflineSince = null;
};

function updatePlayerUI(stats = {}, isPlayer) {
  const normalizedStats = mergeWithClassDefaults(
    stats,
    stats.class || (isPlayer ? playerClass : opponentClass)
  );
  const hpBar = isPlayer ?
    document.getElementById("player-hp") :
    document.getElementById("enemy-hp");
  const nameElement = isPlayer ?
    document.getElementById("player-name") :
    document.getElementById("enemy-name");
  const classElement = isPlayer ?
    document.getElementById("player-class") :
    document.getElementById("enemy-class");
  const hpValueEl = isPlayer ?
    document.getElementById("player-hp-value") :
    document.getElementById("enemy-hp-value");
  const atkEl = isPlayer ?
    document.getElementById("player-atk") :
    document.getElementById("enemy-atk");
  const guardEl = isPlayer ?
    document.getElementById("player-guard") :
    document.getElementById("enemy-guard");
  const physAtkEl = isPlayer ?
    document.getElementById("player-phys-atk") :
    document.getElementById("enemy-phys-atk");
  const magAtkEl = isPlayer ?
    document.getElementById("player-mag-atk") :
    document.getElementById("enemy-mag-atk");
  const physDefEl = isPlayer ?
    document.getElementById("player-phys-def") :
    document.getElementById("enemy-phys-def");
  const magDefEl = isPlayer ?
    document.getElementById("player-mag-def") :
    document.getElementById("enemy-mag-def");
  const critEl = isPlayer ?
    document.getElementById("player-crit") :
    document.getElementById("enemy-crit");
  const evasionEl = isPlayer ?
    document.getElementById("player-evasion") :
    document.getElementById("enemy-evasion");
  const speedEl = isPlayer ?
    document.getElementById("player-speed") :
    document.getElementById("enemy-speed");
  const statusEl = isPlayer ?
    document.getElementById("player-status") :
    document.getElementById("enemy-status");
  const changesEl = isPlayer ?
    document.getElementById("player-changes") :
    document.getElementById("enemy-changes");

  const previousStats = isPlayer ? prevPlayerStats : prevOpponentStats;

  const maxHp = normalizedStats.maxHp || 100;
  const currentHp = normalizedStats.hp ?? maxHp;
  const guard = normalizedStats.defense || 0;
  const physAtk = normalizedStats.physicalAttack || 0;
  const magAtk = normalizedStats.magicAttack || 0;
  const physDefenseBase = normalizedStats.physicalDefense || 0;
  const magDefenseBase = normalizedStats.magicDefense || 0;

  if (hpBar) {
    const hpPercent = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
    hpBar.style.width = hpPercent + "%";
  }

  if (hpValueEl) {
    hpValueEl.textContent = `${Math.max(0, Math.round(currentHp))} / ${Math.round(maxHp)}`;
  }

  if (nameElement && normalizedStats.name) {
    nameElement.textContent = normalizedStats.name;
  }

  if (classElement) {
    const classLabel = normalizedStats.class || (isPlayer ? playerClass : opponentClass);
    classElement.textContent = formatClassLabel(classLabel);
  }

  if (atkEl) {
    const atk = normalizedStats.attackBoost || 0;
    atkEl.textContent = `${atk > 0 ? "+" : ""}${atk}`;
  }

  if (guardEl) {
    const guardVal = guard || 0;
    guardEl.textContent = `${guardVal > 0 ? "+" : ""}${guardVal}`;
  }

  if (physAtkEl) {
    physAtkEl.textContent = `${Math.round(physAtk)}`;
  }

  if (magAtkEl) {
    magAtkEl.textContent = `${Math.round(magAtk)}`;
  }

  if (physDefEl) {
    const totalPhys = physDefenseBase + guard;
    physDefEl.textContent = `${Math.round(totalPhys)}`;
    physDefEl.title = guard ? `Base ${physDefenseBase} + Guard ${guard}` : "Physical defense";
  }

  if (magDefEl) {
    const totalMag = magDefenseBase + guard;
    magDefEl.textContent = `${Math.round(totalMag)}`;
    magDefEl.title = guard ? `Base ${magDefenseBase} + Guard ${guard}` : "Magical defense";
  }

  if (critEl) {
    critEl.textContent = formatPercent(normalizedStats.critChance || 0);
  }

  if (evasionEl) {
    evasionEl.textContent = formatPercent(normalizedStats.evasion || 0);
  }

  if (speedEl) {
    speedEl.textContent = `${Math.round(normalizedStats.speed || 0)}`;
  }

  if (statusEl) {
    statusEl.innerHTML = "";
    const chips = buildStatusChips(normalizedStats);
    chips.forEach((chip) => {
      const span = document.createElement("span");
      span.className = `status-chip ${chip.type || ""}`.trim();
      span.textContent = chip.label;
      statusEl.appendChild(span);
    });
  }

  if (changesEl) {
    const changes = describeStatChanges(normalizedStats, previousStats);
    changesEl.innerHTML = changes.length
      ? changes.map((c) => `<span>${c}</span>`).join("")
      : "";
  }
  
  // Update fainted state visually
  const card = isPlayer ?
    document.getElementById("player") :
    document.getElementById("enemy");
  
  if (card) {
    if (currentHp <= 0 || normalizedStats.fainted) {
      card.classList.add("fainted");
    } else {
      card.classList.remove("fainted");
    }
  }

  if (isPlayer) {
    prevPlayerStats = { ...normalizedStats };
  } else {
    prevOpponentStats = { ...normalizedStats };
  }
}

function updateUI() {
  // UI is updated via listeners
}

function renderMoveMenu(classKey = DEFAULT_CLASS) {
  const container = document.getElementById("move-buttons");
  if (!container) return;

  container.innerHTML = "";
  const moves = getMovesForClass(classKey);

  moves.forEach((move) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "move-button";
    btn.innerHTML = `
      <div class="move-text">
        <strong>${move.label}</strong>
        <span>${move.description}</span>
      </div>
      <span class="move-info-icon" title="More info">i</span>
    `;
    btn.addEventListener("click", () => chooseMove(move.id));
    const infoIcon = btn.querySelector(".move-info-icon");
    if (infoIcon) {
      infoIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        showMoveInfo(move.id, classKey);
      });
    }
    container.appendChild(btn);
  });
}

function setupClassTestUI() {
  if (!classSelectEl) {
    classSelectEl = document.getElementById("class-test-select");
  }
  if (!classApplyBtn) {
    classApplyBtn = document.getElementById("class-test-apply");
  }
  if (!classSelectEl || !classApplyBtn) return;

  classSelectEl.innerHTML = "";
  Object.keys(CLASS_MOVES).forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = formatClassLabel(key);
    classSelectEl.appendChild(opt);
  });
  classSelectEl.value = playerClass;

  classApplyBtn.onclick = async () => {
    const newClass = classSelectEl.value || DEFAULT_CLASS;
    if (!matchId || !currentUserId) return;
    try {
      playerClass = newClass;
      renderMoveMenu(newClass);
      await Promise.all([
        update(playerRef, { class: newClass }),
        update(ref(db, `users/${currentUserId}`), { class: newClass }),
      ]);
      logMessage(`Class switched to ${formatClassLabel(newClass)} for testing.`);
    } catch (err) {
      console.error("Failed to change class", err);
      logMessage("Could not change class right now.");
    }
  };
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

function setupMoveInfoUI() {
  if (!moveInfoOverlay) {
    moveInfoOverlay = document.getElementById("move-info-overlay");
  }
  if (!moveInfoTitle) {
    moveInfoTitle = document.getElementById("move-info-title");
  }
  if (!moveInfoBody) {
    moveInfoBody = document.getElementById("move-info-body");
  }
  if (!moveInfoType) {
    moveInfoType = document.getElementById("move-info-type");
  }

  const closeBtn = document.getElementById("move-info-close");
  if (closeBtn) {
    closeBtn.onclick = hideMoveInfo;
  }

  if (moveInfoOverlay) {
    moveInfoOverlay.addEventListener("click", (evt) => {
      if (evt.target === moveInfoOverlay) {
        hideMoveInfo();
      }
    });
  }
}

function showMoveInfo(moveId, classKey = playerClass) {
  const move = findMove(moveId, classKey);
  if (!move) return;
  setupMoveInfoUI();
  if (!moveInfoOverlay || !moveInfoTitle || !moveInfoBody || !moveInfoType) return;

  moveInfoTitle.textContent = move.label || "Move Info";
  moveInfoType.textContent = move.type ? move.type.toUpperCase() : "INFO";
  moveInfoBody.innerHTML = "";

  const summaryText = move.summary || move.description || "";
  if (summaryText) {
    const summary = document.createElement("p");
    summary.className = "move-info-summary";
    summary.textContent = summaryText;
    moveInfoBody.appendChild(summary);
  }

  const detailLines = move.details || [];
  if (detailLines.length > 0) {
    const list = document.createElement("ul");
    list.className = "move-info-list";
    detailLines.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    });
    moveInfoBody.appendChild(list);
  } else if (move.info) {
    const detail = document.createElement("p");
    detail.className = "move-info-detail";
    detail.textContent = move.info;
    moveInfoBody.appendChild(detail);
  }

  moveInfoOverlay.style.display = "flex";
}

function hideMoveInfo() {
  if (moveInfoOverlay) {
    moveInfoOverlay.style.display = "none";
  }
}

async function forfeitPlayer(targetId, reason = "Forfeit") {
  if (!matchRef || !targetId) return;
  if (latestMatchData?.status === "finished") return;

  const winnerId = targetId === currentUserId ? opponentId : currentUserId;
  const forfeitingRef = targetId === currentUserId ? playerRef : opponentRef;

  try {
    await update(matchRef, {
      status: "finished",
      winner: winnerId,
      message: reason,
    });
    if (forfeitingRef) {
      await update(forfeitingRef, { fainted: true, hp: 0 });
    }
    disableButtons();
  } catch (err) {
    console.error("Failed to process forfeit", err);
  }
}

function startPresenceMonitor() {
  if (!opponentId) return;
  if (detachPresenceListener) {
    detachPresenceListener();
    detachPresenceListener = null;
  }
  if (disconnectRef) {
    onDisconnect(disconnectRef).cancel().catch(() => {});
  }
  opponentPresenceRef = ref(db, `presence/${opponentId}`);
  opponentOfflineSince = null;
  detachPresenceListener = onValue(opponentPresenceRef, (snap) => {
    const val = snap.val();
    const online = val?.online === true;
    if (online) {
      opponentOfflineSince = null;
    } else {
      opponentOfflineSince = opponentOfflineSince || Date.now();
    }
  });
  // Set up onDisconnect to auto-forfeit if this client disconnects entirely
  disconnectRef = ref(db, `matches/${matchId}`);
  const forfeitUpdate = {
    status: "finished",
    winner: opponentId || null,
    message: "Player disconnected.",
    lastMove: "disconnect_forfeit",
    lastMoveActor: currentUserId,
    currentTurn: null,
    turnDeadline: null,
    lastMoveLabel: "Disconnect",
    lastMoveDamage: 0,
    lastMoveHeal: 0,
  };
  onDisconnect(disconnectRef).update(forfeitUpdate).catch(() => {});
}

function startTurnTimer(matchData) {
  stopTurnTimer(true);
  if (!matchData || matchData.status === "finished") return;
  if (!matchData.currentTurn) return;
  lastTimerTurnId = matchData.currentTurn;

  let deadline = matchData.turnDeadline;
  const now = Date.now();
  if (!deadline || now > deadline + MAX_DEADLINE_DRIFT_MS) {
    deadline = now + TURN_DURATION_MS;
    update(matchRef, { turnDeadline: deadline }).catch(() => {});
  }
  turnTimerDeadline = deadline;
  updateTurnTimerUI();
  turnTimerInterval = setInterval(() => updateTurnTimerUI(), 500);
}

function stopTurnTimer(clearText = false) {
  if (turnTimerInterval) {
    clearInterval(turnTimerInterval);
    turnTimerInterval = null;
  }
  turnTimerDeadline = null;
  if (clearText) {
    const timerEl = document.getElementById("turn-timer");
    if (timerEl) timerEl.textContent = "";
  }
}

async function handleTurnTimeout() {
  if (!latestMatchData || latestMatchData.status === "finished") return;
  const currentTurn = latestMatchData.currentTurn;
  if (!currentTurn) return;
  currentTurnId = currentTurn;
  // Only process once per turn id to avoid chaining timeouts
  if (lastTimerTurnId && lastTimerTurnId !== currentTurn) {
    return;
  }

  const targetId = currentTurn;
  const nextId = targetId === currentUserId ? opponentId : currentUserId;
  const nextSkipCounts = { ...(latestMatchData.skipCounts || {}) };
  const newCount = (nextSkipCounts[targetId] || 0) + 1;
  nextSkipCounts[targetId] = newCount;

  const matchUpdates = {
    lastMoveAt: Date.now(),
    currentTurn: nextId,
    skipCounts: nextSkipCounts,
    message: newCount >= 3 ? "Auto-forfeit due to inactivity." : "Turn skipped due to timeout.",
  };

  if (newCount >= 3) {
    matchUpdates.status = "finished";
    matchUpdates.winner = nextId;
    matchUpdates.turnDeadline = null;
  } else {
    matchUpdates.turnDeadline = Date.now() + TURN_DURATION_MS;
    matchUpdates.lastMoveActor = targetId;
    matchUpdates.lastMove = "turn_timeout";
  }

  await update(matchRef, matchUpdates);

  if (newCount >= 3) {
    disableButtons();
  }
}

function updateTurnTimerUI() {
  if (!latestMatchData || latestMatchData.status === "finished") {
    stopTurnTimer();
    return;
  }
  const timerEl = document.getElementById("turn-timer");
  if (!timerEl) return;

  if (!turnTimerDeadline) {
    return;
  }

  const now = Date.now();
  if (now >= turnTimerDeadline) {
    timerEl.textContent = "Turn timed out...";
    stopTurnTimer(false);
    handleTurnTimeout();
    return;
  }

  const remaining = Math.max(0, turnTimerDeadline - now);
  const seconds = Math.ceil(remaining / 1000);
  const isMyTurn = latestMatchData.currentTurn === currentUserId;
  timerEl.textContent = `${isMyTurn ? "Your" : "Opponent's"} turn: ${seconds}s`;
}

function enableButtons() {
  const buttons = document.querySelectorAll("#menu button");
  buttons.forEach(btn => {
    btn.disabled = false;
    btn.style.opacity = "1";
  });
  const forfeitBtn = document.getElementById("forfeit-btn");
  if (forfeitBtn) forfeitBtn.disabled = false;
  document.querySelectorAll(".item-button").forEach((btn) => {
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
  const forfeitBtn = document.getElementById("forfeit-btn");
  if (forfeitBtn) forfeitBtn.disabled = true;
  document.querySelectorAll(".item-button").forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = "0.6";
  });
}

async function forceResetBattle(reason = "Match unavailable.") {
  if (forceResetting) return;
  forceResetting = true;
  try {
    stopTurnTimer(true);
    if (detachPresenceListener) {
      detachPresenceListener();
      detachPresenceListener = null;
    }
    if (disconnectRef) {
      onDisconnect(disconnectRef).cancel().catch(() => {});
      disconnectRef = null;
    }
    if (currentUserId) {
      await set(ref(db, `users/${currentUserId}/currentMatch`), null);
    }
    resetLocalBattleState();
    const battleEl = document.getElementById("battle");
    const queueBtn = document.getElementById("queueBtn");
    if (battleEl) battleEl.style.display = "none";
    if (queueBtn) {
      queueBtn.style.display = "inline";
      queueBtn.textContent = "Find a Match";
    }
    logMessage(reason);
  } catch (err) {
    console.error("Failed to reset ghost match", err);
  } finally {
    forceResetting = false;
  }
}

async function chooseMove(moveId) {
  if (!matchId || !currentUserId) {
    logMessage("Not in a match!");
    return;
  }

  const turnSnapshot = await get(currentTurnRef);
  if (!turnSnapshot.exists()) {
    await update(currentTurnRef, currentUserId);
  } else if (turnSnapshot.val() !== currentUserId) {
    logMessage("It's not your turn!");
    return;
  }

  const [playerSnapshot, opponentSnapshot, matchSnapshot] = await Promise.all([
    get(playerRef),
    get(opponentRef),
    get(matchRef),
  ]);
  const playerStats = mergeWithClassDefaults(playerSnapshot.val() || {}, playerClass);
  const opponentStats = mergeWithClassDefaults(opponentSnapshot.val() || {}, opponentClass);
  const matchData = matchSnapshot.val();

  if (matchData?.status === "finished") {
    logMessage("The match is already over.");
    return;
  }

  if (!playerStats || playerStats.fainted) {
    logMessage("You cannot move, you have fainted!");
    return;
  }

  if (!opponentStats || opponentStats.fainted) {
    logMessage("Opponent has fainted! You win!");
    return;
  }

  const activeClass = playerStats.class || playerClass || DEFAULT_CLASS;
  playerClass = activeClass;
  opponentClass = opponentStats.class || opponentClass || DEFAULT_CLASS;
  const moveDef = findMove(moveId, activeClass);
  if (!moveDef) {
    logMessage("That move is not available to your class.");
    return;
  }

  const ctx = { playerStats, opponentStats };
  const result = moveDef.execute(ctx) || {};

  const playerUpdates = { ...(result.playerUpdates || {}) };
  const opponentUpdates = { ...(result.opponentUpdates || {}) };
  const matchUpdates = { ...(result.matchUpdates || {}) };
  const nowTs = Date.now();

  let moveDamage = Math.max(0, Math.round(result.damage || 0));
  let moveHeal = Math.max(0, Math.round(result.heal || 0));
  let gameOver = Boolean(result.gameOver);

  const playerMaxHp = playerStats?.maxHp || 100;
  const opponentMaxHp = opponentStats?.maxHp || 100;

  // Normalize HP boundaries
  if (typeof playerUpdates.hp === "number") {
    playerUpdates.hp = clampHp(playerUpdates.hp, playerMaxHp);
  }
  if (typeof opponentUpdates.hp === "number") {
    opponentUpdates.hp = clampHp(opponentUpdates.hp, opponentMaxHp);
  }

  // Derive heal/damage values if not supplied
  if (!moveHeal && typeof playerUpdates.hp === "number") {
    moveHeal = Math.max(0, playerUpdates.hp - (playerStats.hp ?? playerMaxHp));
  }
  if (!moveDamage && typeof opponentUpdates.hp === "number") {
    moveDamage = Math.max(0, (opponentStats.hp ?? opponentMaxHp) - opponentUpdates.hp);
  }

  // Handle fainted states
  if (typeof opponentUpdates.hp === "number" && opponentUpdates.hp <= 0) {
    opponentUpdates.hp = 0;
    opponentUpdates.fainted = true;
    gameOver = true;
    matchUpdates.status = "finished";
    matchUpdates.winner = currentUserId;
    matchUpdates.message = `You defeated ${opponentStats.name || "your opponent"}!`;
  }
  if (typeof playerUpdates.hp === "number" && playerUpdates.hp <= 0) {
    playerUpdates.hp = 0;
    playerUpdates.fainted = true;
    gameOver = true;
    matchUpdates.status = "finished";
    matchUpdates.winner = opponentId;
    matchUpdates.message = `${opponentStats.name || "Opponent"} outlasted you.`;
  }

  // Check for turn counter - reset boosts every 3 turns
  let turnCounter = (matchData?.turnCounter || 0) + 1;
  matchUpdates.turnCounter = turnCounter;

  const playerBase = getClassPreset(playerStats.class);
  const opponentBase = getClassPreset(opponentStats.class);

  if (turnCounter % 3 === 0 && turnCounter > 0 && result.preventBoostReset !== true) {
    if (playerUpdates.attackBoost === undefined) playerUpdates.attackBoost = playerBase.attackBoost || 0;
    if (opponentUpdates.attackBoost === undefined) opponentUpdates.attackBoost = opponentBase.attackBoost || 0;
  }

  // Reset defenses unless the move keeps them
  if (!result.keepDefense) {
    if (playerUpdates.defense === undefined) playerUpdates.defense = 0;
  }
  if (result.resetOpponentDefense !== false) {
    if (opponentUpdates.defense === undefined) opponentUpdates.defense = 0;
  }

  // Update turn counter and switch turns (unless game over)
  let extraTurn = false;
  if (!gameOver && result.skipTurnSwap !== true) {
    const extraTurnChance = getExtraTurnChance(playerStats, opponentStats);
    if (extraTurnChance > 0 && Math.random() < extraTurnChance) {
      matchUpdates.currentTurn = currentUserId;
      extraTurn = true;
    } else {
      matchUpdates.currentTurn = opponentId;
    }
  }
  const updatedSkipCounts = { ...(matchData.skipCounts || {}) };
  updatedSkipCounts[currentUserId] = 0;
  matchUpdates.skipCounts = updatedSkipCounts;
  playerUpdates.lastActionAt = nowTs;
  matchUpdates.lastMoveAt = nowTs;
  if (!gameOver) {
    matchUpdates.turnDeadline = nowTs + TURN_DURATION_MS;
  } else {
    matchUpdates.turnDeadline = null;
  }
  matchUpdates.lastMove = moveDef.id;
  matchUpdates.lastMoveLabel = moveDef.label;
  matchUpdates.lastMoveActor = currentUserId;
  matchUpdates.lastMoveDamage = moveDamage;
  matchUpdates.lastMoveHeal = moveHeal;
  const noteParts = [];
  if (result.note) {
    noteParts.push(result.note);
  }
  if (result.missed) {
    noteParts.push("The attack missed!");
  } else if (result.crit) {
    noteParts.push("Critical hit!");
  }
  if (extraTurn) {
    noteParts.push("You were faster and take another turn!");
  }
  matchUpdates.lastMoveNote = noteParts.join(" ").trim();

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

async function useItem(item) {
  if (!matchId || !currentUserId) {
    logMessage("Not in a match!");
    return;
  }
  const turnSnapshot = await get(currentTurnRef);
  const myTurn = turnSnapshot.exists() ? turnSnapshot.val() === currentUserId : false;
  if (!myTurn) {
    logMessage("It's not your turn!");
    return;
  }
  if (!item || !item.key) {
    logMessage("Item not found.");
    return;
  }
  const itemEffect = applyItemEffect(item, mergeWithClassDefaults(prevPlayerStats || {}));
  if (!itemEffect) {
    logMessage("This item can't be used.");
    return;
  }

  const [playerSnapshot, opponentSnapshot, matchSnapshot] = await Promise.all([
    get(playerRef),
    get(opponentRef),
    get(matchRef),
  ]);
  const playerStats = mergeWithClassDefaults(playerSnapshot.val() || {}, playerClass);
  const opponentStats = mergeWithClassDefaults(opponentSnapshot.val() || {}, opponentClass);
  const matchData = matchSnapshot.val() || {};
  if (matchData.status === "finished") return;

  const playerUpdates = { ...(itemEffect.playerUpdates || {}) };
  const opponentUpdates = {};
  const matchUpdates = {};

  const playerMaxHp = playerStats.maxHp || 100;
  if (typeof playerUpdates.hp === "number") {
    playerUpdates.hp = clampHp(playerUpdates.hp, playerMaxHp);
  }

  let moveHeal = Math.max(0, Math.round(itemEffect.heal || 0));
  let moveDamage = Math.max(0, Math.round(itemEffect.damage || 0));

  // derive heals from hp change if not provided
  if (!moveHeal && typeof playerUpdates.hp === "number") {
    moveHeal = Math.max(0, playerUpdates.hp - (playerStats.hp ?? playerMaxHp));
  }

  // Turn swap after item use
  matchUpdates.currentTurn = opponentId;
  matchUpdates.lastMove = `item_${item.id}`;
  matchUpdates.lastMoveLabel = ITEM_DEFS[item.id]?.label || item.label || "Item";
  matchUpdates.lastMoveActor = currentUserId;
  matchUpdates.lastMoveDamage = moveDamage;
  matchUpdates.lastMoveHeal = moveHeal;
  matchUpdates.lastMoveNote = itemEffect.note || "Item used.";
  matchUpdates.turnDeadline = Date.now() + TURN_DURATION_MS;
  const updatedSkipCounts = { ...(matchData.skipCounts || {}) };
  updatedSkipCounts[currentUserId] = 0;
  matchUpdates.skipCounts = updatedSkipCounts;

  playerUpdates.lastActionAt = Date.now();

  const updates = [];
  if (Object.keys(playerUpdates).length) updates.push(update(playerRef, playerUpdates));
  if (Object.keys(opponentUpdates).length) updates.push(update(opponentRef, opponentUpdates));
  updates.push(update(matchRef, matchUpdates));
  updates.push(set(ref(db, `users/${currentUserId}/items/${item.key}`), null));

  await Promise.all(updates);
}
