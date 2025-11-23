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

  // Set player names if not already set
  const userSnapshot = await get(ref(db, `users/${userId}`));
  const userName = userSnapshot.val()?.displayName || "Player";
  
  await update(ref(db, `matches/${matchId}/players/${userId}`), {
    name: userName
  });

  // Listen to match state changes
  setupMatchListeners();

  // Initial UI update
  updateUI();
  
  // Set initial turn indicator
  const turnSnapshot = await get(currentTurnRef);
  const currentTurn = turnSnapshot.exists() ? turnSnapshot.val() : null;
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
