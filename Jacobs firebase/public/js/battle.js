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

// --- CLASS stats & ability lists (used to seed player records in DB) ---
const CLASS_STATS = {
  warrior: { name: 'Warrior', hp: 120, maxHp: 120, baseAtk: 12, defense: 4, attackBoost: 0, fainted: false, abilities: ['warrior_rend', 'warrior_shout'] },
  mage:    { name: 'Mage',    hp: 80,  maxHp: 80,  baseAtk: 16, defense: 1, attackBoost: 0, fainted: false, abilities: ['mage_fireball', 'mage_iceblast'], mana: 30 },
  archer:  { name: 'Archer',  hp: 95,  maxHp: 95,  baseAtk: 14, defense: 2, attackBoost: 0, fainted: false, abilities: ['archer_volley', 'archer_poison'] }
};

// --- Generic helpers used by abilities and turn processing ---
function applyDamageToObject(targetObj, rawDamage, opts = {}) {
  const ignoreDefense = !!opts.ignoreDefense;
  const defense = ignoreDefense ? 0 : (targetObj.defense || 0);
  const final = Math.max(0, Math.round(rawDamage - defense));
  const newHp = Math.max(0, (targetObj.hp || 0) - final);
  return { damage: final, newHp };
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
    const dmg = (status.burn.dmg || Math.max(1, Math.floor((actorStats.baseAtk||10)/3)));
    const { damage, newHp } = applyDamageToObject({ hp: actorStats.hp, defense: 0 }, dmg, { ignoreDefense: true });
    updates.hp = newHp;
    messages.push(`${actorStats.name || 'Player'} suffers ${damage} burn damage.`);
    status.burn.turns = (status.burn.turns || 0) - 1;
    if (status.burn.turns <= 0) delete status.burn;
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
    const base = (user.baseAtk || 10);
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
    const base = user.baseAtk || 12;
    const raw = Math.floor(Math.random() * 10) + base + 6;
    const effectiveDefense = (target.defense || 0) / 2;
    const final = Math.max(0, Math.round(raw - effectiveDefense));
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: effectiveDefense }, final, { ignoreDefense: true });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_rend') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_rend' }, message: `${user.name || 'You'} rends ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  archer_volley(user, target) {
    const base = user.baseAtk || 14;
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
    const base = user.baseAtk || 6;
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
    const base = user.baseAtk || 11;
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
    const base = user.baseAtk || 18;
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
    const base = user.baseAtk || 10;
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
    const base = user.baseAtk || 14;
    const raw = Math.floor(Math.random() * 6) + base;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0 }, raw);
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.poison = { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) };
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'archer_poison') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_archer_poison' }, message: `${user.name || 'You'} hits ${target.name || 'the enemy'} for ${damage} and applies poison!`, lastMoveDamage: damage };
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

  // Give rewards: increment wins/losses and award consolation items
  try {
    const winnerUid = winnerId;
    const loserUid = deadPlayerId;

    // increment winner.wins and loser.losses (best-effort)
    try {
      const wSnap = await get(ref(db, `users/${winnerUid}/wins`));
      const lSnap = await get(ref(db, `users/${loserUid}/losses`));
      const wVal = (wSnap.exists() ? Number(wSnap.val()) : 0) + 1;
      const lVal = (lSnap.exists() ? Number(lSnap.val()) : 0) + 1;
      const u1 = update(ref(db, `users/${winnerUid}`), { wins: wVal });
      const u2 = update(ref(db, `users/${loserUid}`), { losses: lVal });
      await Promise.all([u1, u2]);
    } catch (e) {
      console.error('Could not update wins/losses', e);
    }

    // Award items: winner gets 1 small potion, loser gets 3 small potions (consolation)
    try {
      if (window && window.addItemToUser) {
        await window.addItemToUser(winnerUid, { id: 'potion_small', name: 'Small Potion', qty: 1 });
        await window.addItemToUser(loserUid, { id: 'potion_small', name: 'Small Potion', qty: 3 });
      } else {
        // fallback: best-effort merge using get/update
        const wItemSnap = await get(ref(db, `users/${winnerUid}/items/potion_small`));
        const lItemSnap = await get(ref(db, `users/${loserUid}/items/potion_small`));
        const wQty = (wItemSnap.exists() && wItemSnap.val().qty) ? Number(wItemSnap.val().qty) + 1 : 1;
        const lQty = (lItemSnap.exists() && lItemSnap.val().qty) ? Number(lItemSnap.val().qty) + 3 : 3;
        const p1 = update(ref(db, `users/${winnerUid}/items/potion_small`), { id: 'potion_small', name: 'Small Potion', qty: wQty });
        const p2 = update(ref(db, `users/${loserUid}/items/potion_small`), { id: 'potion_small', name: 'Small Potion', qty: lQty });
        await Promise.all([p1, p2]);
      }
    } catch (e) {
      console.error('Could not award items', e);
    }
  } catch (e) {
    console.error('Rewarding players failed', e);
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
  const hpBar = isPlayer ? 
    document.getElementById("player-hp") : 
    document.getElementById("enemy-hp");
  const nameElement = isPlayer ? 
    document.getElementById("player-name") : 
    document.getElementById("enemy-name");

  if (hpBar) {
    const hpPercent = Math.max(0, (stats.hp / stats.maxHp) * 100);
    hpBar.style.width = hpPercent + "%";
  }

  if (nameElement && stats.name) {
    nameElement.textContent = stats.name;
  }
  
  // Update fainted state visually
  const card = isPlayer ? 
    document.getElementById("player") : 
    document.getElementById("enemy");
  
  if (card) {
    if (stats.hp <= 0 || stats.fainted) {
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
    const damage = Math.floor(Math.random() * 10) + 10 + (playerStats.attackBoost || 0);
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
    const currentBoost = playerStats.attackBoost || 0;
    playerUpdates.attackBoost = currentBoost + 5;
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
    matchUpdates.currentTurn = opponentId;
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
  matchUpdates.currentTurn = opponentId;
  matchUpdates.turnCounter = ( ( (await get(matchRef)).val()?.turnCounter || 0 ) + 1 );

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
    for (const key of Object.keys(items)) {
      const it = items[key];
      const row = document.createElement('div');
      row.className = 'inv-row';
      row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
      const name = document.createElement('span'); name.textContent = `${it.name} x${it.qty}`;
      const useBtn = document.createElement('button'); useBtn.textContent = 'Use';
      useBtn.disabled = !(it.qty > 0);
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
    } else if (itemId === 'bomb') {
      const dmg = 20;
      const actual = Math.max(0, dmg - (opponentStats.defense || 0));
      const newOppHp = Math.max(0, (opponentStats.hp || 0) - actual);
      updates.push(update(opponentRef, { hp: newOppHp }));
      matchUpdates.lastMove = 'use_item_bomb';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveDamage = actual;
      if (newOppHp <= 0) { matchUpdates.status = 'finished'; matchUpdates.winner = currentUserId; }
    } else {
      logMessage('Used unknown item: ' + itemId);
    }

    // advance turn and increment counter (unless match ended)
    const curMatchSnap = await get(matchRef);
    const turnCounter = (curMatchSnap.val()?.turnCounter || 0) + 1;
    if (!matchUpdates.status) {
      matchUpdates.currentTurn = opponentId;
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
