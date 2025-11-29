const CLASS_STATS = {
    warrior: { name: 'Warrior', hp: 120, maxHp: 120, baseAtk: 12, defense: 4, attackBoost: 0, fainted: false, abilities: ['warrior_rend', 'warrior_shout', 'warrior_whirlwind'] },
    mage: { name: 'Mage', hp: 80, maxHp: 80, baseAtk: 16, defense: 1, attackBoost: 0, fainted: false, abilities: ['mage_fireball', 'mage_iceblast', 'mage_arcane_burst'] },
    archer: { name: 'Archer', hp: 95, maxHp: 95, baseAtk: 14, defense: 2, attackBoost: 0, fainted: false, abilities: ['archer_volley', 'archer_poison', 'archer_trap'] }
};

const ENEMY_STATS = {
    slime: { name: 'Slime', hp: 40, maxHp: 40, baseAtk: 6, defense: 0, attackBoost: 0, fainted: false, abilities: ['slime_splatter'] },
    gladiator: { name: 'Gladiator', hp: 80, maxHp: 80, baseAtk: 11, defense: 2, attackBoost: 0, fainted: false, abilities: ['gladiator_charge'] },
    boss: { name: 'Boss', hp: 200, maxHp: 200, baseAtk: 18, defense: 4, attackBoost: 0, fainted: false, abilities: ['boss_earthquake'] }
};

const ABILITIES = {
    mage_fireball: { id: 'mage_fireball', name: 'Fireball', cost: 10, cooldown: 3, desc: 'Deal strong magic damage and apply burn (DOT for 3 turns).' },
    warrior_rend: { id: 'warrior_rend', name: 'Rend', cost: 0, cooldown: 3, desc: 'Powerful physical strike that ignores some defense.' },
    archer_volley: { id: 'archer_volley', name: 'Volley', cost: 0, cooldown: 3, desc: 'Hits multiple shots; chance to reduce enemy attack.' },
    slime_splatter: { id: 'slime_splatter', name: 'Splatter', cost: 0, cooldown: 4, desc: 'Deals damage and applies slime (reduces healing/attack).' },
    gladiator_charge: { id: 'gladiator_charge', name: 'Charge', cost: 0, cooldown: 4, desc: 'Heavy single-target hit with chance to stun.' },
    boss_earthquake: { id: 'boss_earthquake', name: 'Earthquake', cost: 0, cooldown: 5, desc: 'Massive damage and stuns the player for 1 turn.' },
    mage_iceblast: { id: 'mage_iceblast', name: 'Ice Blast', cost: 8, cooldown: 4, desc: 'Deal magic damage and reduce enemy ATK for 2 turns.' },
    warrior_shout: { id: 'warrior_shout', name: 'Battle Shout', cost: 0, cooldown: 5, desc: 'Increase allied attackBoost for 2 turns.' },
    archer_poison: { id: 'archer_poison', name: 'Poison Arrow', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison (DOT).' }
};

// Third-ability metadata so copies of the single-player code display names correctly
ABILITIES.warrior_whirlwind = { id: 'warrior_whirlwind', name: 'Whirlwind', cost: 0, cooldown: 4, desc: 'Spin and strike hard, dealing physical damage and reducing the enemy attack for a short time.' };
ABILITIES.mage_arcane_burst = { id: 'mage_arcane_burst', name: 'Arcane Burst', cost: 12, cooldown: 5, desc: 'A focused magical blast that deals strong magic damage and empowers the caster with a temporary +9 attack instead of burning the foe.' };
ABILITIES.archer_trap = { id: 'archer_trap', name: 'Trap', cost: 0, cooldown: 5, desc: 'Set a wound-trap on the enemy (applies bleeding over time).' };
ABILITIES.cleric_shield = { id: 'cleric_shield', name: 'Sanctuary Shield', cost: 6, cooldown: 5, desc: 'Create a holy shield around yourself that raises defense for a few turns.' };
ABILITIES.knight_bastion = { id: 'knight_bastion', name: 'Bastion', cost: 0, cooldown: 6, desc: 'Assume Bastion: gain +12 DEF for 3 turns (shield persists until it expires). Incoming damage is reduced by your increased defense while active.' };
ABILITIES.rogue_evade = { id: 'rogue_evade', name: 'Evasive Roll', cost: 0, cooldown: 4, desc: 'Quickly reposition: grant an extra immediate action (extra turn).' };
ABILITIES.paladin_bless = { id: 'paladin_bless', name: 'Blessing', cost: 8, cooldown: 5, desc: 'A small heal and an inspirational attack boost to yourself.' };
ABILITIES.necro_curse = { id: 'necro_curse', name: 'Curse of Decay', cost: 10, cooldown: 5, desc: 'Afflict the target so they suffer reduced healing (slimed) and ongoing rot.' };
ABILITIES.druid_barkskin = { id: 'druid_barkskin', name: 'Barkskin', cost: 6, cooldown: 5, desc: 'Harden your skin: heal a small amount, gain +6 defense for several turns, and lash the enemy for minor damage.' };

// Ensure older two-ability server copies that use ability ids won't show ids
ABILITIES.cleric_heal = ABILITIES.cleric_heal || { id: 'cleric_heal', name: 'Divine Heal', cost: 8, cooldown: 3, desc: 'Restore HP and dispel poison/burn from yourself.' };
ABILITIES.cleric_smite = ABILITIES.cleric_smite || { id: 'cleric_smite', name: 'Smite', cost: 6, cooldown: 4, desc: 'Holy damage that also dispels poison/burn from yourself.' };


const ACTION_DESCS = {
  attack: {
    name: 'Attack',
    desc: 'Deal physical damage equal to your base attack plus any temporary attack boost.',
    detail: 'Good default move. No cooldown or mana.'
  },
  heal: {
    name: 'Heal',
    desc: 'Restore a moderate amount of HP to yourself.',
    detail: 'Amount scales modestly; healing may be reduced by slime status.'
  },
  defend: {
    name: 'Defend',
    desc: 'Increase your defense for one turn to reduce incoming damage.',
    detail: 'Stacks with base defense; useful before a big enemy attack.'
  },
  prepare: {
    name: 'Prepare',
    desc: 'Increase your attack boost for your next attack.',
    detail: 'Small charge that increases next-hit damage.'
  }
};

function _getAbilityTooltipNode() {
  let node = document.getElementById('ability-tooltip');
  if (!node) {
    node = document.createElement('div');
    node.id = 'ability-tooltip';
    node.className = 'ability-tooltip';
    node.innerHTML = '<div class="title"></div><div class="desc"></div><div class="meta"></div>';
    document.body.appendChild(node);
  }
  return node;
}

function _showAbilityTooltip(evt, abilityKey) {
  const node = _getAbilityTooltipNode();
  const info = ACTION_DESCS[abilityKey] || ABILITIES[abilityKey] || { name: abilityKey, desc: '', detail: '' };
  node.querySelector('.title').textContent = info.name || (ABILITIES[abilityKey] && ABILITIES[abilityKey].name) || abilityKey;
  node.querySelector('.desc').textContent = info.desc || info.detail || '';
  const metaParts = [];
  if (ABILITIES[abilityKey]) {
    const abil = ABILITIES[abilityKey];
    if (abil.cost) metaParts.push(`Cost: ${abil.cost}M`);
    if (abil.cooldown) metaParts.push(`CD: ${abil.cooldown}`);
  } else if (info.detail) {
    metaParts.push(info.detail);
  }
  node.querySelector('.meta').textContent = metaParts.join(' — ');
  const x = Math.max(8, evt.pageX + 12);
  const y = Math.max(8, evt.pageY + 12);
  node.style.left = x + 'px';
  node.style.top = y + 'px';
  node.classList.add('visible');
}

function _hideAbilityTooltip() {
  const node = document.getElementById('ability-tooltip');
  if (node) node.classList.remove('visible');
}

function attachActionTooltips() {
  const menu = document.getElementById('menu');
  if (!menu) return;
  const buttons = Array.from(menu.querySelectorAll('button, [data-ability]')).filter(b => {
    return b.closest('#specials') === null;
  });

  buttons.forEach(btn => {
  let abilityKey = btn.getAttribute('data-ability');
  if (!abilityKey) {
    const on = btn.getAttribute('onclick') || '';
    const m = on.match(/chooseMove\(['"](\w+)['"]\)/);
    if (m) abilityKey = m[1];
  }
  abilityKey = abilityKey || btn.textContent.trim().toLowerCase();

  const moveHandler = (evt) => {
    const abilObj = ABILITIES[abilityKey] || ACTION_DESCS[abilityKey] || { name: abilityKey, desc: ACTION_DESCS[abilityKey]?.desc || '', cost: 0 };
    const cd = 0;
    _showAbilityTooltip(evt, abilObj, cd);
  };

  btn.addEventListener('mouseenter', moveHandler);
  btn.addEventListener('mousemove', moveHandler);
  btn.addEventListener('mouseleave', _hideAbilityTooltip);
  btn.addEventListener('focus', moveHandler);
  btn.addEventListener('blur', _hideAbilityTooltip);
});
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(attachActionTooltips, 20);
});

const abilityHandlers = {
    mage_fireball(user, target) {
        const base = user.baseAtk || 10;
        const dmg = Math.floor(Math.random() * 8) + base + 8;
        const dealt = applyDamage(target, dmg);
        target.status = target.status || {};
        target.status.burn = { turns: 3, dmg: Math.max(2, Math.floor(base / 3)) };
        return `${user.name} casts Fireball for ${dealt} damage and inflicts burn!`;
    },

    warrior_rend(user, target) {
        const base = user.baseAtk || 12;
        const dmg = Math.floor(Math.random() * 10) + base + 6;
        const effectiveDefense = (target.defense || 0) / 2;
        const final = Math.max(0, dmg - effectiveDefense);
        const dealt = applyDamage(target, final, { ignoreDefense: true });
        return `${user.name} rends ${target.name} for ${dealt} damage!`;
    },

    archer_volley(user, target) {
        const base = user.baseAtk || 14;
        let total = 0;
        for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 6) + Math.floor(base / 2);
        const dealt = applyDamage(target, total);

        const amount = 2;
        target.status = target.status || {};
        if (!target.status.weaken) {
            target.status.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
            target.attackBoost = (target.attackBoost || 0) - amount;
        } else {
            target.status.weaken.amount = (target.status.weaken.amount || 0) + amount;
            target.status.weaken.turns = Math.max(target.status.weaken.turns, 2);
            target.attackBoost = (target.attackBoost || 0) - amount;
        }
        return `${user.name} fires a volley for ${dealt} total damage!`;
    },

    slime_splatter(user, target) {
        const base = user.baseAtk || 6;
        const dmg = Math.floor(Math.random() * 6) + base;
        const dealt = applyDamage(target, dmg);
        target.status = target.status || {};
        target.status.slimed = { turns: 3, effect: 'reduce-heal' };
        return `Slime splatters for ${dealt} and leaves a sticky slime!`;
    },

    gladiator_charge(user, target) {
        const base = user.baseAtk || 11;
        const dmg = Math.floor(Math.random() * 12) + base + 4;
        const dealt = applyDamage(target, dmg);
        if (Math.random() < 0.3) {
            target.status = target.status || {};
            target.status.stun = { turns: 1 };
            return `${user.name} charges with a heavy blow for ${dealt} — ${target.name} is stunned!`;
        }
        return `${user.name} charges for ${dealt} damage!`;
    },

    boss_earthquake(user, target) {
        const base = user.baseAtk || 18;
        const dmg = Math.floor(Math.random() * 18) + base + 8;
        const dealt = applyDamage(target, dmg);
        target.status = target.status || {};
        target.status.stun = { turns: 1 };
        return `${user.name} slams the ground for ${dealt} — ${target.name} is stunned!`;
    },
    mage_iceblast(user, target) {
        const base = user.baseAtk || 10;
        const dmg = Math.floor(Math.random() * 6) + base + 6;
        const dealt = applyDamage(target, dmg);

        const amount = Math.max(1, Math.floor(base / 4));
        target.status = target.status || {};
        if (!target.status.weaken) {
            target.status.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
            target.attackBoost = (target.attackBoost || 0) - amount;
        } else {
            target.status.weaken.amount = (target.status.weaken.amount || 0) + amount;
            target.status.weaken.turns = Math.max(target.status.weaken.turns, 2);
            target.attackBoost = (target.attackBoost || 0) - amount;
        }
        return `${user.name} blasts ${target.name} with ice for ${dealt} damage and lowers attack!`;
    },

    warrior_shout(user, target) {
        user.attackBoost = (user.attackBoost || 0) + 8;
        user.status = user.status || {};
        user.status.shout = { turns: 2, amount: 4 };
        return `${user.name} shouts and increases their attack!`;
    },

    archer_poison(user, target) {
        const base = user.baseAtk || 14;
        const dmg = Math.floor(Math.random() * 6) + base;
        const dealt = applyDamage(target, dmg);
        target.status = target.status || {};
        target.status.poison = { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) };
        return `${user.name} hits ${target.name} for ${dealt} and applies poison!`;
    }
};


const selectedClass = localStorage.getItem('selectedClass') || 'warrior';
const selectedEnemy = localStorage.getItem('selectedEnemy') || 'gladiator';

let rawQueue = null;
try { rawQueue = JSON.parse(localStorage.getItem('enemyQueue') || 'null'); } catch (e) { rawQueue = null; }
let initialQueue = (Array.isArray(rawQueue) && rawQueue.length > 0) ? rawQueue.slice() : [selectedEnemy];
if (initialQueue.length > 5) {
    initialQueue = initialQueue.slice(0, 5);
    localStorage.setItem('enemyQueue', JSON.stringify(initialQueue));
}
let enemyQueue = initialQueue.slice();
let currentEnemyId = enemyQueue.shift() || selectedEnemy;

let rawAllies = null;
try { rawAllies = JSON.parse(localStorage.getItem('allyQueue') || 'null'); } catch (e) { rawAllies = null; }
let initialAllies = (Array.isArray(rawAllies) && rawAllies.length > 0) ? rawAllies.slice() : [];
if (initialAllies.length > 2) {
    initialAllies = initialAllies.slice(0, 2);
    localStorage.setItem('allyQueue', JSON.stringify(initialAllies));
}

let party = [];
const mainPlayerObj = Object.assign({}, CLASS_STATS[selectedClass]);
mainPlayerObj.classId = selectedClass;
mainPlayerObj.hp = mainPlayerObj.hp ?? CLASS_STATS[selectedClass].hp;
mainPlayerObj.maxHp = mainPlayerObj.maxHp ?? CLASS_STATS[selectedClass].maxHp;
mainPlayerObj.baseAtk = CLASS_STATS[selectedClass].baseAtk;
mainPlayerObj.abilityCooldowns = {};
mainPlayerObj.mana = (selectedClass === 'mage') ? 30 : 0;
mainPlayerObj.maxMana = mainPlayerObj.mana;
party.push(mainPlayerObj);

for (const aid of initialAllies) {
    if (!CLASS_STATS[aid]) continue;
    const allyObj = Object.assign({}, CLASS_STATS[aid]);
    allyObj.classId = aid;
    allyObj.hp = allyObj.hp ?? CLASS_STATS[aid].hp;
    allyObj.maxHp = allyObj.maxHp ?? CLASS_STATS[aid].maxHp;
    allyObj.baseAtk = CLASS_STATS[aid].baseAtk;
    allyObj.abilityCooldowns = {};
    allyObj.mana = (aid === 'mage') ? 30 : 0;
    allyObj.maxMana = allyObj.mana;
    party.push(allyObj);
}

let partyIndex = 0;
let player = party[partyIndex];

let enemy = Object.assign({}, ENEMY_STATS[currentEnemyId]);
enemy.hp = enemy.hp ?? ENEMY_STATS[currentEnemyId].hp;
enemy.maxHp = enemy.maxHp ?? ENEMY_STATS[currentEnemyId].maxHp;
enemy.baseAtk = ENEMY_STATS[currentEnemyId].baseAtk;
enemy.abilityCooldowns = {};


let playerTurn = true;
let turnCounter = 0;

function updateUI() {
    const pBar = document.getElementById('player-hp');
    const eBar = document.getElementById('enemy-hp');
    if (pBar) pBar.style.width = (player.hp / player.maxHp * 100) + '%';
    if (eBar) eBar.style.width = (enemy.hp / enemy.maxHp * 100) + '%';

    const pHpText = document.getElementById('player-hp-text');
    const eHpText = document.getElementById('enemy-hp-text');
    if (pHpText) pHpText.textContent = `HP: ${player.hp}/${player.maxHp}`;
    if (eHpText) eHpText.textContent = `HP: ${enemy.hp}/${enemy.maxHp}`;

    const pAtkText = document.getElementById('player-atk-text');
    const eAtkText = document.getElementById('enemy-atk-text');
    if (pAtkText) pAtkText.textContent = `ATK: ${player.attackBoost >= 0 ? '+' + player.attackBoost : String(player.attackBoost)}`;
    if (eAtkText) eAtkText.textContent = `ATK: ${enemy.attackBoost >= 0 ? '+' + enemy.attackBoost : String(enemy.attackBoost)}`;

    const pDefText = document.getElementById('player-def-text');
    const eDefText = document.getElementById('enemy-def-text');
    if (pDefText) pDefText.textContent = `DEF: ${player.defense >= 0 ? '+' + player.defense : String(player.defense)}`;
    if (eDefText) eDefText.textContent = `DEF: ${enemy.defense >= 0 ? '+' + enemy.defense : String(enemy.defense)}`;

    const pManaText = document.getElementById('player-mana-text');
    if (pManaText) pManaText.textContent = player.maxMana ? `MANA: ${player.mana}/${player.maxMana}` : '';

    const pSprite = document.getElementById('player-sprite');
    const eSprite = document.getElementById('enemy-sprite');
    try {
        if (pSprite) {

            const cls = player && player.classId ? player.classId : selectedClass;
            const src = `img/${cls}.jpg`;
            pSprite.src = src;
            pSprite.alt = player.name;
            pSprite.onerror = function () { this.style.opacity = '0.7'; };
        }
        if (eSprite) {
            const src2 = `img/${currentEnemyId}.jpg`;
            eSprite.src = src2;
            eSprite.alt = enemy.name;
            eSprite.onerror = function () { this.style.opacity = '0.7'; };
        }
    } catch (e) {
    }
    const pCdText = document.getElementById('player-cd-text');
    if (pCdText) {
        if (player.abilities && player.abilities.length > 0) {
            pCdText.textContent = player.abilities.map(id => {
                const cd = player.abilityCooldowns && (player.abilityCooldowns[id] || 0);
                return `${(ABILITIES[id] && ABILITIES[id].name) || id}${cd > 0 ? `:${cd}` : '(R)'}`;
            }).join('  ');
        } else {
            pCdText.textContent = '';
        }
    }

    renderStatusIcons(player, 'player-status');
    renderStatusIcons(enemy, 'enemy-status');
    renderSpecialButtons();
}


function _getAbilityTooltipNode() {
  let node = document.getElementById('ability-tooltip');
  if (!node) {
    node = document.createElement('div');
    node.id = 'ability-tooltip';
    node.className = 'ability-tooltip';
    node.innerHTML = '<div class="title"></div><div class="desc"></div><div class="meta"></div>';
    document.body.appendChild(node);
  }
  return node;
}

function _showAbilityTooltip(evt, abil, cd) {
  const node = _getAbilityTooltipNode();
  node.querySelector('.title').textContent = abil.name || '';
  node.querySelector('.desc').textContent = abil.desc || '';
  const costText = abil.cost ? `Cost: ${abil.cost}M` : 'No mana cost';
  const cdText = cd > 0 ? `Cooldown: ${cd}` : 'Ready';
  node.querySelector('.meta').textContent = `${costText} — ${cdText}`;
  const x = evt.pageX + 12;
  const y = evt.pageY + 12;
  node.style.left = x + 'px';
  node.style.top = y + 'px';
  node.classList.add('visible');
}

function _hideAbilityTooltip() {
  const node = document.getElementById('ability-tooltip');
  if (node) node.classList.remove('visible');
}

function renderSpecialButtons() {
  const specials = document.getElementById('specials');
  if (!specials) return;
  specials.innerHTML = '';
  if (!player || !Array.isArray(player.abilities)) return;

  player.abilities.forEach((abilityId, idx) => {
    const abil = ABILITIES[abilityId] || { name: abilityId, cooldown: 0, cost: 0, desc: '' };
    const cd = player.abilityCooldowns && (player.abilityCooldowns[abilityId] || 0);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${abil.name}${cd > 0 ? ` (CD:${cd})` : (abil.cost ? ` (${abil.cost}M)` : '')}`;
    btn.disabled = !playerTurn || (cd > 0) || (abil.cost && (player.mana || 0) < abil.cost);

    btn.addEventListener('mouseenter', (evt) => _showAbilityTooltip(evt, abil, cd));
    btn.addEventListener('mousemove', (evt) => _showAbilityTooltip(evt, abil, cd));
    btn.addEventListener('mouseleave', _hideAbilityTooltip);
    btn.addEventListener('focus', (evt) => _showAbilityTooltip(evt, abil, cd));
    btn.addEventListener('blur', _hideAbilityTooltip);

    btn.addEventListener('click', () => useSpecial(idx));
    specials.appendChild(btn);
  });
}

function useSpecial(index = 0) {
    if (!playerTurn) { logMessage("It's not your turn!"); return; }
    const abilityId = (player.abilities && player.abilities[index]) || null;
    if (!abilityId) { logMessage("No special available."); return; }
    if (!canUseAbility(player, abilityId)) { logMessage("Special unavailable (cooldown or not enough mana)."); return; }

    const abil = ABILITIES[abilityId];
    if (abil.cost) player.mana = Math.max(0, player.mana - abil.cost);

    let result;
    try {
        result = (abilityHandlers[abilityId] && abilityHandlers[abilityId](player, enemy)) || `${player.name} uses ${abil ? abil.name : abilityId}`;
    } catch (err) {
        console.error('ability handler threw', abilityId, err);
        result = `${player.name} tried to use ${abil ? abil.name : abilityId} but it failed.`;
    }
    startAbilityCooldown(player, abilityId);

    updateUI();
    logMessage(result);

    playerTurn = false;
    setTimeout(enemyTurn, 800);
}

function renderStatusIcons(actor, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!actor || !actor.status) return;

    const mapping = {
        burn: { file: 'img/status_burn.svg', emoji: '🔥' },
        stun: { file: 'img/status_stun.svg', emoji: '⛔' },
        slimed: { file: 'img/status_slime.svg', emoji: '🟢' },
        weaken: { file: 'img/status_weaken.svg', emoji: '⚠️' }
    };

    for (const key in actor.status) {
        if (!Object.prototype.hasOwnProperty.call(actor.status, key)) continue;
        const info = mapping[key];
        if (info && info.file) {
            const img = document.createElement('img');
            img.className = 'status-icon';
            img.alt = key;
            img.src = info.file;
            img.onerror = function () {
                const span = document.createElement('span');
                span.className = 'status-badge';
                span.textContent = info.emoji || key.slice(0, 2).toUpperCase();
                this.replaceWith(span);
            };
            container.appendChild(img);
        } else {
            const span = document.createElement('span');
            span.className = 'status-badge';
            span.textContent = (mapping[key] && mapping[key].emoji) || key.slice(0, 2).toUpperCase();
            container.appendChild(span);
        }
    }
}

function spawnEnemy(enemyId) {
    currentEnemyId = enemyId;
    enemy = Object.assign({}, ENEMY_STATS[enemyId]);
    enemy.hp = enemy.hp ?? ENEMY_STATS[enemyId].hp;
    enemy.maxHp = enemy.maxHp ?? ENEMY_STATS[enemyId].maxHp;
    enemy.baseAtk = ENEMY_STATS[enemyId].baseAtk;
    enemy.abilityCooldowns = {};
    enemy.status = {};
    enemy.fainted = false;
    const eNameEl = document.getElementById('enemy-name');
    if (eNameEl) eNameEl.textContent = enemy.name;
    updateUI();
}

function handleEnemyDefeat() {
    logMessage(`You defeated the ${enemy.name}!`);
    enemy.fainted = true;
    updateUI();
    if (enemyQueue.length > 0) {
        setTimeout(() => {
            const nextId = enemyQueue.shift();
            spawnEnemy(nextId);
            logMessage(`A ${enemy.name} appears!`);
            playerTurn = true;
            updateUI();
        }, 1000);
    } else {
        setTimeout(() => { logMessage('Victory! All enemies defeated.'); updateUI(); }, 800);
    }
}

function handlePlayerDefeat() {
    player.fainted = true;
    updateUI();
    if (partyIndex + 1 < party.length) {
        partyIndex++;
        player = party[partyIndex];
        const pNameEl = document.getElementById('player-name');
        if (pNameEl) pNameEl.textContent = player.name;
        logMessage(`${player.name} joins the fight!`);
        updateUI();
        playerTurn = true;
    } else {
        setTimeout(() => { logMessage('You have been defeated!'); updateUI(); }, 400);
    }
}

function logMessage(msg) {
    const el = document.getElementById('message');
    if (el) el.textContent = msg;
}

function processStatusEffects(actor) {
    if (!actor.status) return [];
    const messages = [];

    if (actor.status.burn) {
        const b = actor.status.burn;
        const dealt = applyDamage(actor, b.dmg, { ignoreDefense: true });
        messages.push(`${actor.name} suffers ${dealt} burn damage.`);
        b.turns--;
        if (b.turns <= 0) delete actor.status.burn;
    }

    if (actor.status.slimed) {
        actor.status.slimed.turns--;
        if (actor.status.slimed.turns <= 0) delete actor.status.slimed;
    }

    if (actor.status.weaken) {
        actor.status.weaken.turns--;
        if (actor.status.weaken.turns <= 0) {
            if (typeof actor.status.weaken.prevBoost === 'number') {
                actor.attackBoost = actor.status.weaken.prevBoost;
            } else {
                actor.attackBoost = 0;
            }
            delete actor.status.weaken;
        }
    }
    if (actor.status.poison) {
        const p = actor.status.poison;
        const dealt = applyDamage(actor, p.dmg || 1, { ignoreDefense: true });
        messages.push(`${actor.name} suffers ${dealt} poison damage.`);
        p.turns--;
        if (p.turns <= 0) delete actor.status.poison;
    }

    if (actor.status.shout) {
        actor.status.shout.turns--;
        if (actor.status.shout.turns <= 0) {
            const amt = actor.status.shout.amount || 0;
            actor.attackBoost = Math.max(0, (actor.attackBoost || 0) - amt);
            delete actor.status.shout;
        }
    }


    return messages;
}

function tickCooldowns(actor) {
    if (!actor.abilityCooldowns) return;
    for (const id in actor.abilityCooldowns) {
        if (actor.abilityCooldowns[id] > 0) actor.abilityCooldowns[id]--;
    }
}
function regenMana(actor, amount = 2) {
  if (!actor || !(actor.maxMana > 0)) return;
  actor.mana = Math.min(actor.maxMana, (actor.mana || 0) + amount);
}

function regenPartyMana(amount = 2, includeEnemy = false) {
  if (Array.isArray(party)) {
    for (const mem of party) regenMana(mem, amount);
  }
  if (includeEnemy && typeof enemy !== 'undefined') regenMana(enemy, amount);
}

function canUseAbility(actor, abilityId) {
    const abil = ABILITIES[abilityId];
    if (!abil) return false;
    const cd = actor.abilityCooldowns[abilityId] || 0;
    if (cd > 0) return false;
    if (abil.cost && (actor.mana || 0) < abil.cost) return false;
    return true;
}

function startAbilityCooldown(actor, abilityId) {
    const abil = ABILITIES[abilityId];
    if (!abil) return;
    actor.abilityCooldowns[abilityId] = abil.cooldown;
}

function chooseMove(move) {
    if (!playerTurn) { logMessage("It's not your turn!"); return; }

    const pmsgs = processStatusEffects(player);
    if (pmsgs.length) pmsgs.forEach(m => logMessage(m));
    if (player.hp <= 0) { handlePlayerDefeat(); return; }

    if (player.status && player.status.stun) {
        logMessage("You are stunned and cannot act!");
        player.status.stun.turns--;
        if (player.status.stun.turns <= 0) delete player.status.stun;
        playerTurn = false;
        setTimeout(enemyTurn, 900);
        return;
    }

    if (move === 'attack' && !player.fainted) {
        const damage = Math.floor(Math.random() * 8) + player.baseAtk + player.attackBoost;
        const dealt = applyDamage(enemy, damage);
        logMessage(`You hit ${enemy.name} for ${dealt} damage!`);
    } else if (move === 'heal' && !player.fainted) {
        let heal = Math.floor(Math.random() * 15) + 5;
        if (player.status && player.status.slimed) heal = Math.max(0, Math.floor(heal / 2));
        player.hp = Math.min(player.maxHp, player.hp + heal);
        logMessage(`You healed yourself for ${heal} HP!`);
    } else if (move === 'defend' && !player.fainted) {
        player.defense += 5;
        logMessage('You brace yourself for the next attack!');
    } else if (move === 'prepare' && !player.fainted) {
        player.attackBoost += 5;
        logMessage('You prepare for your next move.');
    } else {
        logMessage('You cannot move, you have fainted!');
    }
    updateUI();


    if (enemy.hp <= 0) { handleEnemyDefeat(); return; }

    if (turnCounter % 3 === 0 && turnCounter !== 0) player.attackBoost = 0;
    turnCounter++;
    playerTurn = false;
    enemy.defense = ENEMY_STATS[currentEnemyId].defense;
    tickCooldowns(player);
    setTimeout(enemyTurn, 1000);
}

function enemyTurn() {
    const msgs = processStatusEffects(enemy);
    if (msgs.length) msgs.forEach(m => logMessage(m));
    if (enemy.hp <= 0) { handleEnemyDefeat(); return; }

    if (enemy.status && enemy.status.stun) {
        logMessage(`${enemy.name} is stunned and can't move!`);
        enemy.status.stun.turns--;
        if (enemy.status.stun.turns <= 0) delete enemy.status.stun;
        tickCooldowns(enemy);
        playerTurn = true;
        updateUI();
        return;
    }

    const available = (enemy.abilities || []).filter(id => canUseAbility(enemy, id));
    if (available.length && Math.random() < 0.4) {
        const pick = available[Math.floor(Math.random() * available.length)];
        let result;
        try {
            result = (abilityHandlers[pick] && abilityHandlers[pick](enemy, player)) || `${enemy.name} used ${pick}`;
        } catch (err) {
            console.error('enemy ability handler threw', pick, err);
            result = `${enemy.name} tried ${pick} but it failed.`;
        }
        startAbilityCooldown(enemy, pick);
        logMessage(result);
        tickCooldowns(enemy);
        updateUI();
        playerTurn = true;
        return;
    }

    if (enemy.fainted) return;
    let choice = Math.floor(Math.random() * 6);
    if (choice > 2) {
        const damage = Math.floor(Math.random() * 8) + enemy.baseAtk + enemy.attackBoost;
        const dealt = applyDamage(player, damage);
        logMessage(`${enemy.name} attacks for ${dealt} damage!`);
    } else if (choice === 2) {
        const heal = Math.floor(Math.random() * 10) + 5;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
        logMessage(`${enemy.name} healed for ${heal} HP!`);
    } else if (choice === 1) {
        enemy.defense += 5;
        logMessage(`${enemy.name} is defending!`);
    } else {
        enemy.attackBoost += 5;
        logMessage(`${enemy.name} is sizing you up!`);
    }

     tickCooldowns(enemy);
    if (player.hp <= 0) { handlePlayerDefeat(); return; }
    if (turnCounter % 3 === 0 && turnCounter !== 0) enemy.attackBoost = 0;
    player.defense = CLASS_STATS[player.classId || selectedClass].defense;
    regenPartyMana(2, false); 
    playerTurn = true;
    updateUI();
}

window.addEventListener('DOMContentLoaded', () => {
    const pName = document.getElementById('player-name');
    const eName = document.getElementById('enemy-name');
    if (pName) pName.textContent = player.name;
    if (eName) eName.textContent = enemy.name;
    updateUI();
    logMessage(`A ${enemy.name} appeared!`);
        try { attachActionTooltips(); } catch (e) { /* ignore */ }
});

function attachActionTooltips() {
    const menu = document.getElementById('menu');
    if (!menu) return;
    const buttons = Array.from(menu.querySelectorAll('button'));
    buttons.forEach(btn => {
        // determine move key from onclick or text
        let abilityKey = btn.getAttribute('data-ability');
        if (!abilityKey) {
            const on = btn.getAttribute('onclick') || '';
            const m = on.match(/chooseMove\(['"](\w+)['"]\)/);
            if (m) abilityKey = m[1];
        }
        abilityKey = abilityKey || btn.textContent.trim().toLowerCase();

        const handler = (evt) => {
            const abilObj = ABILITIES[abilityKey] || ACTION_DESCS[abilityKey] || { name: abilityKey, desc: ACTION_DESCS[abilityKey]?.desc || '' };
            _showAbilityTooltip(evt, abilObj, 0);
        };
        btn.addEventListener('mouseenter', handler);
        btn.addEventListener('mousemove', handler);
        btn.addEventListener('mouseleave', _hideAbilityTooltip);
        btn.addEventListener('focus', handler);
        btn.addEventListener('blur', _hideAbilityTooltip);
    });
}

function applyDamage(target, rawDamage, opts = {}) {
    const ignoreDefense = !!opts.ignoreDefense;
    const defense = ignoreDefense ? 0 : (target.defense || 0);
    const final = Math.max(0, Math.round(rawDamage - defense));
    target.hp = Math.max(0, (target.hp || 0) - final);
    return final;
}