let player = { name: "Hero", hp: 100, maxHp: 100, defense: 0, attackBoost: 0, fainted: false };
let enemy = { name: "Gladiator", hp: 80, maxHp: 80, defense: 0, attackBoost: 0, fainted: false };
let playerTurn = true; // when true the player can act; when false input is ignored
turnCounter = 0;
function updateUI() {
  document.getElementById("player-hp").style.width = (player.hp / player.maxHp * 100) + "%";
  document.getElementById("enemy-hp").style.width = (enemy.hp / enemy.maxHp * 100) + "%";
}

function logMessage(msg) {
  document.getElementById("message").textContent = msg;
}

function chooseMove(move) {
  if (!playerTurn) {
    logMessage("It's not your turn!");
    return;
  }

  if (move === "attack" && player.fainted === false) {
    let damage = Math.floor(Math.random() * 10) + 10 + player.attackBoost;
    enemy.hp = Math.max(0, enemy.hp - damage);
    logMessage(`You hit ${enemy.name} for ${damage} damage!`);
  } else if (move === "heal" && player.fainted === false) {
    let heal = Math.floor(Math.random() * 15) + 5;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    logMessage(`You healed yourself for ${heal} HP!`);
  } else if (move === "defend" && player.fainted === false) {
    logMessage("You brace yourself for the next attack!");
    player.defense += 5;
  } else if (move === "prepare" && player.fainted === false) {
    logMessage("You prepare for your next move.");
    player.attackBoost += 5;
  } else {
    logMessage("You cannot move, you have fainted!");
  }
  updateUI();

  if (enemy.hp <= 0) {
    logMessage(`You defeated the ${enemy.name}!`);
    enemy.fainted = true;
    return;
  }

  playerTurn = false;
  enemy.defense = 0; 
  setTimeout(enemyTurn, 1000);
}

function enemyTurn() {
    if (enemy.fainted) {
    return;
  }
  let choice = Math.floor(Math.random() * 6);
  if (choice > 2) {
    let damage = Math.floor(Math.random() * 10) + 10 + enemy.attackBoost;
    player.hp = Math.max(0, player.hp + player.defense - damage);
    logMessage(`${enemy.name} attacks for ${damage} damage!`);
  } else if (choice === 2) { 
    let heal = Math.floor(Math.random() * 10) + 5;
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
    logMessage(`${enemy.name} healed for ${heal} HP!`);
  } else if (choice === 1) {
    logMessage(`${enemy.name} is defending!`);
    enemy.defense += 5; 
  } else {
    logMessage(`${enemy.name} is sizing you up!`);
    enemy.attackBoost += 5; 
  }

  updateUI();

  if (player.hp <= 0) {
    logMessage("You fainted!");
    player.fainted = true;
    playerTurn = false;
    return;
  }
  player.defense = 0;
  playerTurn = true;
}

updateUI();
logMessage(`A ${enemy.name} appeared!`);
