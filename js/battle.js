let player = { name: "Hero", hp: 100, maxHp: 100 };
let enemy = { name: "Wild Slime", hp: 80, maxHp: 80 };

function updateUI() {
  document.getElementById("player-hp").style.width = (player.hp / player.maxHp * 100) + "%";
  document.getElementById("enemy-hp").style.width = (enemy.hp / enemy.maxHp * 100) + "%";
}

function logMessage(msg) {
  document.getElementById("message").textContent = msg;
}

function chooseMove(move) {
  if (move === "attack") {
    let damage = Math.floor(Math.random() * 20) + 10;
    enemy.hp = Math.max(0, enemy.hp - damage);
    logMessage(`You hit ${enemy.name} for ${damage} damage!`);
  } else if (move === "heal") {
    let heal = Math.floor(Math.random() * 15) + 5;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    logMessage(`You healed yourself for ${heal} HP!`);
  }

updateUI();

  if (enemy.hp <= 0) {
    logMessage(`You defeated the ${enemy.name}!`);
    return;
  }

  // Enemy's turn
  setTimeout(enemyTurn, 1000);
}

function enemyTurn() {
  let damage = Math.floor(Math.random() * 15) + 5;
  player.hp = Math.max(0, player.hp - damage);
  logMessage(`${enemy.name} attacks for ${damage} damage!`);
  updateUI();

  if (player.hp <= 0) {
    logMessage("You fainted!");
  }
}

// Initialize
updateUI();
logMessage("A wild Slime appeared!");
