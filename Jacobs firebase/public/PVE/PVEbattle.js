const CLASS_STATS = {
    warrior: { name: 'Warrior', hp: 120, maxHp: 120, baseAtk: 12, defense: 4, speed: 5, critChance: 0.04, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['warrior_rend', 'warrior_shout', 'warrior_whirlwind'] },
    mage: { name: 'Mage', hp: 80, maxHp: 80, baseAtk: 16, defense: 1, speed: 6, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['mage_fireball', 'mage_iceblast', 'mage_arcane_burst'], mana: 30 },
    archer: { name: 'Archer', hp: 95, maxHp: 95, baseAtk: 14, defense: 2, speed: 8, critChance: 0.12, evasion: 0.06, attackBoost: 0, fainted: false, abilities: ['archer_volley', 'archer_poison', 'archer_trap'] },
    cleric: { name: 'Cleric', hp: 90, maxHp: 90, baseAtk: 8, defense: 2, speed: 5, critChance: 0.03, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['cleric_heal', 'cleric_smite', 'cleric_shield'], mana: 30 },
    knight: { name: 'Knight', hp: 140, maxHp: 140, baseAtk: 13, defense: 6, speed: 4, critChance: 0.03, evasion: 0.01, attackBoost: 0, fainted: false, abilities: ['knight_guard', 'knight_charge', 'knight_bastion'] },
    rogue: { name: 'Rogue', hp: 85, maxHp: 85, baseAtk: 18, defense: 1, speed: 9, critChance: 0.15, evasion: 0.08, attackBoost: 0, fainted: false, abilities: ['rogue_backstab', 'rogue_poisoned_dagger', 'rogue_evade'] },
    paladin: { name: 'Paladin', hp: 130, maxHp: 130, baseAtk: 11, defense: 5, speed: 5, critChance: 0.04, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['paladin_aura', 'paladin_holy_strike', 'paladin_bless'], mana: 15 },
    dark_mage: { name: 'Dark Mage', hp: 75, maxHp: 75, baseAtk: 12, defense: 1, speed: 6, critChance: 0.05, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['necro_siphon', 'necro_raise', 'necro_curse'], mana: 35 },
    necromancer: { name: 'Necromancer', hp: 80, maxHp: 80, baseAtk: 10, defense: 2, speed: 6, critChance: 0.05, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['necro_summon_skeleton', 'necro_spirit_shackles', 'necro_dark_inversion'], mana: 40 },
    monk: { name: 'Monk', hp: 105, maxHp: 105, baseAtk: 13, defense: 3, speed: 8, critChance: 0.07, evasion: 0.05, attackBoost: 0, fainted: false, abilities: ['monk_flurry', 'monk_stunning_blow', 'monk_quivering_palm'], mana: 20 },
    wild_magic_sorcerer: { name: 'Wild Magic Sorcerer', hp: 85, maxHp: 85, baseAtk: 14, defense: 1, speed: 6, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['wild_attack', 'wild_buff', 'wild_arcanum'], mana: 40 },
    druid: { name: 'Druid', hp: 100, maxHp: 100, baseAtk: 12, defense: 2, speed: 6, critChance: 0.05, evasion: 0.04, attackBoost: 0, fainted: false, abilities: ['druid_entangle', 'druid_regrowth', 'druid_barkskin'], mana: 30 }
};

const ENEMY_STATS = {
    // Added combat stats (speed, critChance, evasion) so PVE uses the same properties
    slime: { name: 'Slime', hp: 40, maxHp: 40, baseAtk: 6, defense: 0, attackBoost: 0, fainted: false, abilities: ['slime_splatter'], speed: 3, critChance: 0.02, evasion: 0.01 },
    gladiator: { name: 'Gladiator', hp: 80, maxHp: 80, baseAtk: 11, defense: 2, attackBoost: 0, fainted: false, abilities: ['gladiator_charge'], speed: 5, critChance: 0.05, evasion: 0.02 },
    boss: { name: 'Boss', hp: 200, maxHp: 200, baseAtk: 18, defense: 4, attackBoost: 0, fainted: false, abilities: ['boss_earthquake'], speed: 4, critChance: 0.06, evasion: 0.03 }
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

// Add fuller ability metadata from the PvP implementation so PVE handlers use proper costs and cooldowns
// (this prevents the ensureAbilityMetadata fallback from creating zero-cooldown entries)
ABILITIES.warrior_whirlwind = ABILITIES.warrior_whirlwind || { id: 'warrior_whirlwind', name: 'Whirlwind', cost: 0, cooldown: 4, desc: 'Spin and strike hard, dealing physical damage and reducing the enemy attack for a short time.' };
ABILITIES.mage_arcane_burst = ABILITIES.mage_arcane_burst || { id: 'mage_arcane_burst', name: 'Arcane Burst', cost: 12, cooldown: 5, desc: 'A focused magical blast that deals strong magic damage and empowers the caster with a temporary +9 attack instead of burning the foe.' };
ABILITIES.archer_trap = ABILITIES.archer_trap || { id: 'archer_trap', name: 'Trap', cost: 0, cooldown: 5, desc: 'Set a wound-trap on the enemy (applies bleeding over time).' };
ABILITIES.cleric_shield = ABILITIES.cleric_shield || { id: 'cleric_shield', name: 'Sanctuary Shield', cost: 6, cooldown: 5, desc: 'Create a holy shield around yourself that raises defense for a few turns.' };
ABILITIES.knight_bastion = ABILITIES.knight_bastion || { id: 'knight_bastion', name: 'Bastion', cost: 0, cooldown: 6, desc: 'Assume Bastion: gain +12 DEF for 3 turns (shield persists until it expires). Incoming damage is reduced by your increased defense while active.' };
ABILITIES.rogue_evade = ABILITIES.rogue_evade || { id: 'rogue_evade', name: 'Evasive Roll', cost: 0, cooldown: 4, desc: 'Delay your action and unleash three rapid, consecutive turns.' };
ABILITIES.paladin_bless = ABILITIES.paladin_bless || { id: 'paladin_bless', name: 'Blessing', cost: 8, cooldown: 5, desc: 'A small heal and an inspirational attack boost to yourself.' };
ABILITIES.necro_curse = ABILITIES.necro_curse || { id: 'necro_curse', name: 'Curse of Decay', cost: 10, cooldown: 5, desc: 'Afflict the target so they suffer reduced healing (slimed) and ongoing rot.' };
ABILITIES.druid_barkskin = ABILITIES.druid_barkskin || { id: 'druid_barkskin', name: 'Barkskin', cost: 6, cooldown: 5, desc: 'Harden your skin: heal a small amount, gain +6 defense for several turns, and lash the enemy for minor damage.' };

// Monk abilities (previously missing -> created by fallback with zero cooldown). Give proper costs and cooldowns.
ABILITIES.monk_flurry = ABILITIES.monk_flurry || { id: 'monk_flurry', name: 'Flurry', cost: 4, cooldown: 3, desc: 'Three rapid strikes that together deal good damage and inflict Weaken. Costs 4 mana.' };
ABILITIES.monk_stunning_blow = ABILITIES.monk_stunning_blow || { id: 'monk_stunning_blow', name: 'Stunning Blow', cost: 0, cooldown: 4, desc: 'A heavy strike that has a 50% chance to stun the target.' };
ABILITIES.monk_quivering_palm = ABILITIES.monk_quivering_palm || { id: 'monk_quivering_palm', name: 'Quivering Palm', cost: 10, cooldown: 6, desc: 'Inflicts bleeding (5% max HP per turn for 4 turns). If the target is at <=20% max HP when this hits they die instantly.' };

// Necromancer / summoner abilities
ABILITIES.necro_summon_skeleton = ABILITIES.necro_summon_skeleton || { id: 'necro_summon_skeleton', name: 'Summon Skeleton', cost: 8, cooldown: 5, desc: 'Summon a skeleton: gain +5 ATK and +5 DEF for a few turns and poison the enemy.' };
ABILITIES.necro_spirit_shackles = ABILITIES.necro_spirit_shackles || { id: 'necro_spirit_shackles', name: 'Spirit Shackles', cost: 10, cooldown: 6, desc: 'Shackle the enemy: -5 ATK for 4 turns, reduce their defense by 75% and prevent item use.' };
ABILITIES.necro_dark_inversion = ABILITIES.necro_dark_inversion || { id: 'necro_dark_inversion', name: 'Dark Inversion', cost: 12, cooldown: 8, desc: 'For 3 turns, damage heals you and healing damages you (reverse HP effects).' };
ABILITIES.necro_siphon = ABILITIES.necro_siphon || { id: 'necro_siphon', name: 'Siphon Life', cost: 8, cooldown: 3, desc: 'Deal damage and heal the caster for part of it. Deals double damage against targets suffering reduced healing (slimed).' };
ABILITIES.necro_raise = ABILITIES.necro_raise || { id: 'necro_raise', name: 'Raise Rot', cost: 12, cooldown: 5, desc: 'Inflict a necrotic poison that deals stronger damage over several turns.' };

// Wild magic: ensure costs/cooldowns
ABILITIES.wild_attack = ABILITIES.wild_attack || { id: 'wild_attack', name: 'Wild Magic: Attack', cost: 10, cooldown: 4, desc: 'Unleash chaotic magic (d20): effects range from caster backlash to debuffs, burn, stuns, or extra damage.' };
ABILITIES.wild_buff = ABILITIES.wild_buff || { id: 'wild_buff', name: 'Wild Magic: Buff', cost: 8, cooldown: 5, desc: 'Invoke chaotic boons (d20): may curse you, heal a little, grant attack buffs, mana, or a powerful boon on a high roll.' };
ABILITIES.wild_arcanum = ABILITIES.wild_arcanum || { id: 'wild_arcanum', name: 'Wild Magic: Arcanum', cost: 14, cooldown: 6, desc: 'High-variance arcane nuke (d20): can deal massive damage, sometimes backfires and harms the caster.' };

// Misc additional metadata used by handlers
ABILITIES.knight_guard = ABILITIES.knight_guard || { id: 'knight_guard', name: 'Shield Bash', cost: 0, cooldown: 4, desc: 'Strike with your shield to deal damage and increase defense for 2 turns.' };
ABILITIES.knight_charge = ABILITIES.knight_charge || { id: 'knight_charge', name: 'Mounted Charge', cost: 0, cooldown: 3, desc: 'Powerful charge that may stun.' };
ABILITIES.rogue_backstab = ABILITIES.rogue_backstab || { id: 'rogue_backstab', name: 'Backstab', cost: 0, cooldown: 3, desc: 'High damage attack that ignores some defense.' };
ABILITIES.rogue_poisoned_dagger = ABILITIES.rogue_poisoned_dagger || { id: 'rogue_poisoned_dagger', name: 'Poisoned Dagger', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison.' };
ABILITIES.paladin_aura = ABILITIES.paladin_aura || { id: 'paladin_aura', name: 'Aura of Valor', cost: 0, cooldown: 5, desc: 'Boost your attack for a few turns.' };
ABILITIES.paladin_holy_strike = ABILITIES.paladin_holy_strike || { id: 'paladin_holy_strike', name: 'Holy Strike', cost: 10, cooldown: 4, desc: 'Deal holy damage and heal yourself a bit.' };
ABILITIES.paladin_bless = ABILITIES.paladin_bless || { id: 'paladin_bless', name: 'Blessing', cost: 8, cooldown: 5, desc: 'A heal and an inspirational attack boost to yourself.' };
ABILITIES.druid_entangle = ABILITIES.druid_entangle || { id: 'druid_entangle', name: 'Entangle', cost: 0, cooldown: 3, desc: 'Conjure grasping vines that deal damage, may stun, and weaken the target.' };
ABILITIES.druid_regrowth = ABILITIES.druid_regrowth || { id: 'druid_regrowth', name: 'Regrowth', cost: 8, cooldown: 4, desc: 'Heal immediately and gain regeneration-over-time for several turns.' };

// Basic move tooltips
ABILITIES.attack = ABILITIES.attack || { id: 'attack', name: 'Attack', desc: 'Basic physical attack: deal damage equal to your attack (reduced by target defense).' };
ABILITIES.heal = ABILITIES.heal || { id: 'heal', name: 'Rest', desc: 'Basic heal: recover a small amount of HP to yourself.' };
ABILITIES.defend = ABILITIES.defend || { id: 'defend', name: 'Defend', desc: 'Defend: brace and gain a small defense increase that helps against the next enemy attack.' };
ABILITIES.prepare = ABILITIES.prepare || { id: 'prepare', name: 'Prepare', desc: 'Prepare: gain a temporary attack boost for the next 1–2 turns.' };

// Ensure every ability referenced by classes/enemies has a metadata entry
// Missing ABILITIES entries were causing canUseAbility(...) to return false
// (because canUseAbility checks for ABILITIES[abilityId] existence). Create
// friendly defaults for any missing ids so handlers and tooltips work.
(function ensureAbilityMetadata() {
    function humanize(id) {
        if (!id || typeof id !== 'string') return String(id);
        return id.split(/[_-]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    }

    const gather = new Set();
    for (const k in CLASS_STATS) {
        const cls = CLASS_STATS[k];
        if (cls && Array.isArray(cls.abilities)) cls.abilities.forEach(a => gather.add(a));
    }
    for (const k in ENEMY_STATS) {
        const e = ENEMY_STATS[k];
        if (e && Array.isArray(e.abilities)) e.abilities.forEach(a => gather.add(a));
    }

    gather.forEach(id => {
        if (!id) return;
        if (!ABILITIES[id]) {
            ABILITIES[id] = { id: id, name: humanize(id), cost: 0, cooldown: 0, desc: '' };
            try { console.info(`PVE: created fallback ABILITIES entry for '${id}'`); } catch (e) { }
        }
    });
})();


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

function _showAbilityTooltip(evt, info) {
    const node = _getAbilityTooltipNode();
    info = info || {};
    node.querySelector('.title').textContent = info.name || '';
    node.querySelector('.desc').textContent = info.desc || info.detail || '';
    const metaParts = [];
    if (typeof info.cost === 'number' && info.cost > 0) metaParts.push(`Cost: ${info.cost}M`);
    if (typeof info.cooldown === 'number' && info.cooldown > 0) metaParts.push(`CD: ${info.cooldown}`);
    node.querySelector('.meta').textContent = metaParts.join(' — ');
    // Position tooltip intelligently: prefer mouse position (client), fallback to element bounding rect
    try {
        // keep tooltip hidden while we measure and position to avoid flicker
        node.style.visibility = 'hidden';
        node.classList.remove('visible');

        // ensure it's rendered so offsetWidth/offsetHeight are available
        node.style.left = '0px';
        node.style.top = '0px';

        const vw = document.documentElement.clientWidth || window.innerWidth;
        const scrollX = window.scrollX || window.pageXOffset || 0;
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const pad = 8;

        // measure
        const tw = node.offsetWidth || 200;
        const th = node.offsetHeight || 60;

        let left = scrollX + 12;
        let top = scrollY + 12;

        // Prefer element bounding rect placement for menu/special buttons because
        // some environments report clientX/clientY as 0 on mouseenter. Item tooltips
        // use CSS and work reliably; for ability buttons we use rect-based placement
        // when the event target is inside the #menu or #specials container or has an
        // inline onclick attribute (legacy markup).
        const target = evt && evt.target;
        const isMenuButton = !!(target && target.closest && (target.closest('#menu') || target.closest('#specials') || target.hasAttribute && target.hasAttribute('onclick')));

        if (!isMenuButton && evt && typeof evt.clientX === 'number' && typeof evt.clientY === 'number') {
            left = scrollX + evt.clientX + 12;
            top = scrollY + evt.clientY + 12;
        } else if (evt && evt.target && evt.target.getBoundingClientRect) {
            const rect = evt.target.getBoundingClientRect();
            // prefer above the element if there's room, otherwise below
            const above = scrollY + rect.top - th - pad;
            const below = scrollY + rect.bottom + pad;
            top = above > scrollY + 8 ? above : below;
            left = scrollX + rect.left + Math.max(8, (rect.width - tw) / 2);
        }

        // clamp horizontally to viewport
        left = Math.max(scrollX + 8, Math.min(left, scrollX + vw - tw - 8));

        node.style.left = Math.round(left) + 'px';
        node.style.top = Math.round(top) + 'px';
        node.style.visibility = '';
        node.classList.add('visible');
    } catch (e) {
        // fallback simple placement
        const x = Math.max(8, (evt && evt.pageX) ? evt.pageX + 12 : 12);
        const y = Math.max(8, (evt && evt.pageY) ? evt.pageY + 12 : 12);
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        node.classList.add('visible');
    }
}

function _hideAbilityTooltip() {
    const node = document.getElementById('ability-tooltip');
    if (node) node.classList.remove('visible');
}

function attachActionTooltips() {
    const menu = document.getElementById('menu');
    if (!menu) return;
    const buttons = Array.from(menu.querySelectorAll('button, [data-ability]'));

    buttons.forEach(btn => {
        // Skip specials (they have their own tooltips attached when rendered)
        if (btn.closest && btn.closest('#specials')) return;
        let abilityKey = btn.getAttribute('data-ability');
        if (!abilityKey) {
            const on = btn.getAttribute('onclick') || '';
            const m = on.match(/chooseMove\(['"](\w+)['"]\)/);
            if (m) abilityKey = m[1];
        }
        abilityKey = abilityKey || btn.textContent.trim().toLowerCase();

        const moveHandler = (evt) => {
            const info = ABILITIES[abilityKey] || ACTION_DESCS[abilityKey] || { name: abilityKey, desc: '' };
            try { _showAbilityTooltip(evt, info); } catch (e) { /* ignore */ }
        };

        btn.addEventListener('mouseenter', moveHandler);
        btn.addEventListener('mousemove', moveHandler);
        btn.addEventListener('mouseleave', _hideAbilityTooltip);
        btn.addEventListener('focus', moveHandler);
        btn.addEventListener('blur', _hideAbilityTooltip);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    // attachActionTooltips will be invoked once later when the main DOMContentLoaded handler runs
});

const abilityHandlers = {
    mage_fireball(user, target) {
        const base = user.baseAtk || 10;
        const dmg = Math.floor(Math.random() * 8) + base + 8;
    const dealt = applyDamage(target, dmg, { attacker: user });
        target.status = target.status || {};
        target.status.burn = { turns: 3, dmg: Math.max(2, Math.floor(base / 3)) };
        return `${user.name} casts Fireball for ${dealt} damage and inflicts burn!`;
    },

    warrior_rend(user, target) {
        const base = user.baseAtk || 12;
        const dmg = Math.floor(Math.random() * 10) + base + 6;
        const effectiveDefense = (target.defense || 0) / 2;
        const final = Math.max(0, dmg - effectiveDefense);
    const dealt = applyDamage(target, final, { ignoreDefense: true, attacker: user });
        return `${user.name} rends ${target.name} for ${dealt} damage!`;
    },

    archer_volley(user, target) {
        const base = user.baseAtk || 14;
        let total = 0;
        for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 6) + Math.floor(base / 2);
    const dealt = applyDamage(target, total, { attacker: user });

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
    const dealt = applyDamage(target, dmg, { attacker: user });
        target.status = target.status || {};
        target.status.slimed = { turns: 3, effect: 'reduce-heal' };
        return `Slime splatters for ${dealt} and leaves a sticky slime!`;
    },

    gladiator_charge(user, target) {
        const base = user.baseAtk || 11;
        const dmg = Math.floor(Math.random() * 12) + base + 4;
    const dealt = applyDamage(target, dmg, { attacker: user });
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
    const dealt = applyDamage(target, dmg, { attacker: user });
        target.status = target.status || {};
        target.status.stun = { turns: 1 };
        return `${user.name} slams the ground for ${dealt} — ${target.name} is stunned!`;
    },
    mage_iceblast(user, target) {
        const base = user.baseAtk || 10;
        const dmg = Math.floor(Math.random() * 6) + base + 6;
    const dealt = applyDamage(target, dmg, { attacker: user });

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
    const dealt = applyDamage(target, dmg, { attacker: user });
        target.status = target.status || {};
        target.status.poison = { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) };
        return `${user.name} hits ${target.name} for ${dealt} and applies poison!`;
    }
    ,
    // Additional handlers ported from PvP rules for PvE mode
    warrior_whirlwind(user, target) {
        const base = user.baseAtk || 12;
        const raw = Math.floor(Math.random() * 12) + base + 6;
    const dealt = applyDamage(target, raw, { attacker: user });
        target.status = target.status || {};
        const amount = 3;
        if (!target.status.weaken) {
            target.status.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
            target.attackBoost = (target.attackBoost || 0) - amount;
        } else {
            target.status.weaken.amount = (target.status.weaken.amount || 0) + amount;
            target.status.weaken.turns = Math.max(target.status.weaken.turns, 2);
            target.attackBoost = (target.attackBoost || 0) - amount;
        }
        return `${user.name} spins a Whirlwind for ${dealt} damage and weakens the foe!`;
    },

    mage_arcane_burst(user, target) {
        const base = user.baseAtk || 14;
        const raw = Math.floor(Math.random() * 14) + base + 8;
    const dealt = applyDamage(target, raw, { attacker: user });
        user.status = user.status || {};
        const boost = 9;
        user.status.shout = { turns: 2, amount: boost };
        user.attackBoost = (user.attackBoost || 0) + boost;
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.mage_arcane_burst.cost || 0));
        return `${user.name} unleashes Arcane Burst for ${dealt} magic damage and gains +${boost} attack!`;
    },

    archer_trap(user, target) {
        const base = user.baseAtk || 12;
        const raw = Math.floor(Math.random() * 8) + base + 4;
    const dealt = applyDamage(target, raw, { attacker: user });
        target.status = target.status || {};
        const incoming = { turns: 3, pct: 0.05 };
        if (!target.status.bleed) target.status.bleed = incoming;
        else { target.status.bleed.pct = Math.max(target.status.bleed.pct || 0, incoming.pct); target.status.bleed.turns = Math.max(target.status.bleed.turns || 0, incoming.turns); }
        return `${user.name} sets a trap and deals ${dealt} damage, inflicting bleeding.`;
    },

    cleric_heal(user, target) {
        const heal = Math.floor(Math.random() * 14) + 12; //12-25
        const isSlimed = !!(user.status && user.status.slimed);
        const actualHeal = isSlimed ? Math.floor(heal / 2) : heal;
        user.hp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
        user.status = user.status || {};
        let dispelled = false;
        if (user.status.poison) { delete user.status.poison; dispelled = true; }
        if (user.status.burn) { delete user.status.burn; dispelled = true; }
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.cleric_heal.cost || 0));
        return `${user.name} channels divine energy and heals for ${actualHeal} HP${dispelled ? ' and dispels harmful effects!' : '!'}`;
    },

    cleric_smite(user, target) {
        const base = user.baseAtk || 8;
        const raw = Math.floor(Math.random() * 8) + base + 6;
    const dealt = applyDamage(target, raw, { attacker: user });
        target.status = target.status || {};
        target.status.burn = { turns: 3, dmg: 4 };
        user.status = user.status || {};
        let dispelled = false;
        if (user.status.poison) { delete user.status.poison; dispelled = true; }
        if (user.status.burn) { delete user.status.burn; dispelled = true; }
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.cleric_smite.cost || 0));
        return `${user.name} smites the foe for ${dealt} holy damage${dispelled ? ' and dispels DOTs on self!' : '!'}`;
    },

    cleric_shield(user, target) {
        const add = 10;
        user.defense = (user.defense || 0) + add;
        user.status = user.status || {};
        user.status.shield = { turns: 3, amount: add };
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.cleric_shield.cost || 0));
        return `${user.name} raises a Sanctuary Shield, increasing defense by ${add} for several turns.`;
    },

    knight_guard(user, target) {
        const base = user.baseAtk || 10;
        const raw = Math.floor(Math.random() * 6) + base + 4;
    const dealt = applyDamage(target, raw, { attacker: user });
        const add = 5;
        user.defense = (user.defense || 0) + add;
        user.status = user.status || {};
        user.status.shield = { turns: 1, amount: add };
        return `${user.name} strikes and assumes a guarded stance, dealing ${dealt} and increasing defense by ${add}.`;
    },

    knight_bastion(user, target) {
        const add = 12;
        user.defense = (user.defense || 0) + add;
        user.status = user.status || {};
        user.status.shield = { turns: 3, amount: add };
        return `${user.name} assumes Bastion stance, increasing defense by ${add} for several turns.`;
    },

    rogue_backstab(user, target) {
        const base = user.baseAtk || 16;
        const raw = Math.floor(Math.random() * 12) + base + 8;
        const final = Math.max(0, raw - Math.floor((target.defense || 0) / 3));
    const dealt = applyDamage(target, final, { attacker: user });
        return `${user.name} backstabs ${target.name} for ${dealt} damage!`;
    },

    rogue_poisoned_dagger(user, target) {
        const base = user.baseAtk || 12;
        const raw = Math.floor(Math.random() * 8) + base;
    const dealt = applyDamage(target, raw, { attacker: user });
        target.status = target.status || {};
        const incoming = { turns: 3, dmg: Math.max(1, Math.floor(base / 4)) };
        if (target.status.poison) {
            target.status.poison.dmg = Math.max(target.status.poison.dmg || 0, incoming.dmg);
            target.status.poison.turns = Math.max(target.status.poison.turns || 0, incoming.turns);
        } else target.status.poison = incoming;
        return `${user.name} plunges a poisoned dagger for ${dealt} damage and applies poison!`;
    },

    rogue_evade(user, target) {
        user.status = user.status || {};
        user.status.extraTurns = (user.status.extraTurns || 0) + 2;
        return `${user.name} performs an evasive roll and gains multiple rapid actions!`;
    },

    paladin_aura(user, target) {
        const amt = 6; const defAdd = 5;
        user.status = user.status || {};
        user.status.shout = { turns: 3, amount: amt };
        user.status.shield = { turns: 3, amount: defAdd };
        user.attackBoost = (user.attackBoost || 0) + amt;
        user.defense = (user.defense || 0) + defAdd;
        return `${user.name} radiates an Aura of Valor, increasing attack by ${amt} and defense by ${defAdd}.`;
    },

    paladin_holy_strike(user, target) {
        const base = user.baseAtk || 11;
        const raw = Math.floor(Math.random() * 10) + base + 6;
    const dealt = applyDamage(target, raw, { attacker: user });
        const heal = Math.floor(dealt * 0.4);
        user.hp = Math.min(user.maxHp || 100, (user.hp || 0) + heal);
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.paladin_holy_strike ? ABILITIES.paladin_holy_strike.cost : 0));
        return `${user.name} smites for ${dealt} and is healed for ${heal} HP.`;
    },

    paladin_bless(user, target) {
        const baseHeal = 20; const amt = 8;
        const actualHeal = (user.status && user.status.slimed) ? Math.floor(baseHeal / 2) : baseHeal;
        user.hp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
        user.attackBoost = (user.attackBoost || 0) + amt;
        user.status = user.status || {};
        user.status.shout = { turns: 3, amount: amt };
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.paladin_bless ? ABILITIES.paladin_bless.cost : 0));
        return `${user.name} calls a Blessing, healing ${actualHeal} HP and gaining +${amt} attack.`;
    },

    necro_summon_skeleton(user, target) {
        const atkAdd = 5; const defAdd = 5;
        user.attackBoost = (user.attackBoost || 0) + atkAdd;
        user.defense = (user.defense || 0) + defAdd;
        user.status = user.status || {};
        user.status.summon = { turns: 3 };
        target.status = target.status || {};
        const incoming = { turns: 3, dmg: Math.max(1, Math.floor((user.baseAtk * 2 || 8) / 3)) };
        if (target.status.poison) {
            target.status.poison.dmg = Math.max(target.status.poison.dmg || 0, incoming.dmg);
            target.status.poison.turns = Math.max(target.status.poison.turns || 0, incoming.turns);
        } else target.status.poison = incoming;
        return `${user.name} summons a skeleton, gaining +${atkAdd} ATK and +${defAdd} DEF while poisoning the foe.`;
    },

    necro_spirit_shackles(user, target) {
        target.status = target.status || {};
        const weakenAmt = 5;
        if (!target.status.weaken) target.status.weaken = { turns: 4, amount: weakenAmt, prevBoost: (target.attackBoost || 0) };
        else { target.status.weaken.amount = (target.status.weaken.amount || 0) + weakenAmt; target.status.weaken.turns = Math.max(target.status.weaken.turns || 0, 4); }
        target.defense = Math.floor((target.defense || 0) * 0.25);
        target.status.no_items = { turns: 4 };
        return `${user.name} binds the enemy with Spirit Shackles: -${weakenAmt} ATK, heavy defense reduction and items disabled.`;
    },

    necro_dark_inversion(user, target) {
        user.status = user.status || {};
        user.status.dark_inversion = { turns: 3 };
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.necro_dark_inversion ? ABILITIES.necro_dark_inversion.cost : 0));
        return `${user.name} twists life into unlife: for 3 turns healing harms and damage heals.`;
    },

    necro_siphon(user, target) {
        const base = user.baseAtk || 10;
        let raw = Math.floor(Math.random() * 10) + base + 6;
        const hasHealingReduction = !!(target.status && target.status.slimed);
        if (hasHealingReduction) raw = raw * 2;
    const dealt = applyDamage(target, raw, { attacker: user });
        let healAmt = Math.floor(dealt * 0.6);
        if (user.status && user.status.slimed) healAmt = Math.floor(healAmt / 2);
        user.hp = Math.min(user.maxHp || 100, (user.hp || 0) + healAmt);
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.necro_siphon ? ABILITIES.necro_siphon.cost : 0));
        return `${user.name} siphons ${dealt} life and heals for ${healAmt}.`;
    },

    necro_raise(user, target) {
        const base = user.baseAtk || 9;
        const poisonDmg = Math.max(2, Math.floor(base / 2));
        target.status = target.status || {};
        const incoming = { turns: 5, dmg: poisonDmg };
        if (target.status.poison) { target.status.poison.dmg = Math.max(target.status.poison.dmg || 0, incoming.dmg); target.status.poison.turns = Math.max(target.status.poison.turns || 0, incoming.turns); }
        else target.status.poison = incoming;
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.necro_raise ? ABILITIES.necro_raise.cost : 0));
        return `${user.name} invokes rot; ${target.name} is cursed for ${poisonDmg} poison per turn.`;
    },

    druid_entangle(user, target) {
        const amount = 4;
        target.status = target.status || {};
        if (!target.status.weaken) target.status.weaken = { turns: 2, amount: amount, prevBoost: (target.attackBoost || 0) };
        else { target.status.weaken.amount = (target.status.weaken.amount || 0) + amount; target.status.weaken.turns = Math.max(target.status.weaken.turns || 0, 2); }
        const base = user.baseAtk || 10;
        const raw = Math.floor(Math.random() * 10) + Math.floor(base / 2);
    const dealt = applyDamage(target, raw, { attacker: user });
        target.attackBoost = Math.max(0, (target.attackBoost || 0) - amount);
        if (Math.random() < 0.15) target.status.stun = { turns: 1 };
        return `${user.name} conjures vines dealing ${dealt} damage and weakening the foe.`;
    },

    druid_regrowth(user, target) {
        const immediate = Math.floor(Math.random() * 10) + 10;
        const regenAmount = 6; const regenTurns = 4;
        const actualImmediate = (user.status && user.status.slimed) ? Math.floor(immediate / 2) : immediate;
        user.hp = Math.min(user.maxHp || 100, (user.hp || 0) + actualImmediate);
        user.status = user.status || {};
        user.status.regen = { turns: regenTurns, amount: regenAmount };
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.druid_regrowth ? ABILITIES.druid_regrowth.cost : 0));
        return `${user.name} calls regrowth, healing ${actualImmediate} HP and regenerating ${regenAmount} HP for ${regenTurns} turns.`;
    },

    druid_barkskin(user, target) {
        const immediate = 6; const shieldAmount = 8;
        user.hp = Math.min(user.maxHp || 100, (user.hp || 0) + immediate);
        user.status = user.status || {};
        user.status.shield = { turns: 3, amount: shieldAmount };
        user.defense = (user.defense || 0) + shieldAmount;
        const base = user.baseAtk || 10;
    const raw = Math.floor(Math.random() * 6) + Math.floor(base / 2);
    const dealt = applyDamage(target, raw, { attacker: user });
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.druid_barkskin ? ABILITIES.druid_barkskin.cost : 0));
        return `${user.name} hardens skin and lashes out, healing ${immediate} and dealing ${dealt} damage.`;
    },

    monk_flurry(user, target) {
        const base = user.baseAtk || 12;
        let total = 0; for (let i=0;i<3;i++) total += Math.floor(Math.random()*6) + Math.floor(base/2);
    const dealt = applyDamage(target, total, { attacker: user });
        target.status = target.status || {};
        const weakenAmt = 4;
        if (!target.status.weaken) target.status.weaken = { turns: 2, amount: weakenAmt, prevBoost: (target.attackBoost || 0) };
        else { target.status.weaken.amount = (target.status.weaken.amount || 0) + weakenAmt; target.status.weaken.turns = Math.max(target.status.weaken.turns || 0, 2); }
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.monk_flurry ? ABILITIES.monk_flurry.cost : 0));
        return `${user.name} strikes in a flurry for ${dealt} total damage and weakens the enemy!`;
    },

    monk_stunning_blow(user, target) {
        const base = user.baseAtk || 14; const raw = Math.floor(Math.random()*12) + base;
    const dealt = applyDamage(target, raw, { attacker: user });
        if (Math.random() < 0.5) target.status = target.status || {}, target.status.stun = { turns: 1 };
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.monk_stunning_blow ? ABILITIES.monk_stunning_blow.cost : 0));
        return `${user.name} delivers a Stunning Blow for ${dealt} damage!`;
    },

    monk_quivering_palm(user, target) {
        const maxHpT = target.maxHp || 100; const threshold = Math.floor(maxHpT * 0.2);
        if ((target.hp || 0) <= threshold) { target.hp = 0; target.fainted = true; return `${user.name} collapses the enemy instantly with Quivering Palm!`; }
        const base = user.baseAtk || 12; const raw = Math.floor(Math.random()*10) + Math.floor(base/2);
    const dealt = applyDamage(target, raw, { attacker: user });
        target.status = target.status || {};
        const incoming = { turns: 4, pct: 0.05 };
        if (!target.status.bleed) target.status.bleed = incoming; else { target.status.bleed.pct = Math.max(target.status.bleed.pct||0,incoming.pct); target.status.bleed.turns = Math.max(target.status.bleed.turns||0,incoming.turns); }
        user.mana = Math.max(0, (user.mana || 0) - (ABILITIES.monk_quivering_palm ? ABILITIES.monk_quivering_palm.cost : 0));
        return `${user.name} uses Quivering Palm dealing ${dealt} damage and inflicting bleeding!`;
    },

    wild_attack(user, target) {
        const roll = Math.floor(Math.random()*20)+1;
        const base = user.baseAtk || 16;
        let damage = Math.floor(Math.random()*16) + base + 4;
    let dealt = applyDamage(target, damage, { attacker: user });
        let message = `${user.name} triggers Wild Attack (d20=${roll})`;
        if (roll <= 3) {
            const backlash = Math.floor(damage * 0.4); user.hp = Math.max(0, (user.hp||0)-backlash); message += ` — chaotic backlash! You suffer ${backlash} damage.`;
        } else if (roll <= 8) { target.status = target.status||{}; target.status.weaken = { turns:2, amount:4, prevBoost:(target.attackBoost||0)}; message += ` — the enemy is weakened.`; }
        else if (roll <= 15) { target.status = target.status||{}; target.status.burn = { turns:3, dmg: Math.max(3, Math.floor(base/3)) }; message += ` — the enemy is scorched.`; }
            else if (roll <= 19) { const extra = Math.floor(Math.random()*14)+10; applyDamage(target, extra, { attacker: user }); target.status = target.status||{}; target.status.stun = { turns:1 }; message += ` — a powerful surge stuns the opponent!`; }
        else { const extra = Math.floor(Math.random()*26)+18; applyDamage(target, extra, { attacker: user }); user.status = user.status||{}; user.status.shout = { turns: 3, amount: 12 }; user.attackBoost = (user.attackBoost||0)+12; message += ` — critical wild surge! Massive damage and you're empowered.`; }
        return message;
    },

    wild_buff(user, target) {
        const roll = Math.floor(Math.random()*20)+1; user.status = user.status||{}; user.mana = Math.max(0,(user.mana||0)-(ABILITIES.wild_buff?ABILITIES.wild_buff.cost:0));
        if (roll <=4) { user.status.weaken = { turns:3, amount:4, prevBoost:(user.attackBoost||0) }; return `${user.name} invoked Wild Buff (d20=${roll}) — misfired and you feel weaker.`; }
        if (roll <=10) { const heal = 10; user.hp = Math.min(user.maxHp||(100), (user.hp||0)+heal); return `${user.name} invoke Wild Buff (d20=${roll}) — minor regenerative pulse heals ${heal} HP.`; }
        if (roll <=16) { user.status.shout = { turns:2, amount:6 }; user.attackBoost = (user.attackBoost||0)+6; return `${user.name} invoke Wild Buff (d20=${roll}) — arcane winds bolster your strength.`; }
        if (roll <=19) { user.mana = Math.min(user.maxMana||(user.mana||0), (user.mana||0)+12); return `${user.name} invoke Wild Buff (d20=${roll}) — mana surges through you.`; }
        user.hp = Math.min(user.maxHp||(100), (user.hp||0)+25); user.status.shout = { turns:3, amount:12 }; user.attackBoost = (user.attackBoost||0)+12; return `${user.name} invoke Wild Buff (d20=${roll}) — incredible boon!`;
    },

    wild_arcanum(user, target) {
        const roll = Math.floor(Math.random()*20)+1; const base = user.baseAtk || 18; let raw = Math.floor(Math.random()*24)+base+12; applyDamage(target, raw, { attacker: user });
        user.mana = Math.max(0,(user.mana||0)-(ABILITIES.wild_arcanum?ABILITIES.wild_arcanum.cost:0));
        if (roll <=4) { const back = Math.floor(raw*0.5); user.hp = Math.max(0,(user.hp||0)-back); return `${user.name} cast Wild Arcanum (d20=${roll}) — chaotic backlash! You suffer ${back} damage.`; }
    if (roll <=12) { const extra = Math.floor(Math.random()*12)+8; applyDamage(target, extra, { attacker: user }); return `${user.name} cast Wild Arcanum (d20=${roll}) — arcane surge deals extra damage.`; }
    if (roll <=19) { const extra = Math.floor(Math.random()*20)+12; applyDamage(target, extra, { attacker: user }); user.hp = Math.min(user.maxHp||(100),(user.hp||0)+Math.floor(extra*0.4)); return `${user.name} cast Wild Arcanum (d20=${roll}) — hits hard and you siphon life.`; }
    const nuke = Math.floor(Math.random()*36)+36; applyDamage(target, nuke, { attacker: user }); user.status = user.status || {}; user.status.shout = { turns:3, amount:14 }; user.attackBoost = (user.attackBoost||0)+14; return `${user.name} cast Wild Arcanum (d20=${roll}) — Critical wild arcanum! Massive surge.`;
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
// initialize mana from CLASS_STATS so every class that defines mana gets it
mainPlayerObj.mana = (CLASS_STATS[selectedClass] && typeof CLASS_STATS[selectedClass].mana === 'number') ? CLASS_STATS[selectedClass].mana : 0;
mainPlayerObj.maxMana = (CLASS_STATS[selectedClass] && typeof CLASS_STATS[selectedClass].mana === 'number') ? CLASS_STATS[selectedClass].mana : 0;
party.push(mainPlayerObj);

for (const aid of initialAllies) {
    if (!CLASS_STATS[aid]) continue;
    const allyObj = Object.assign({}, CLASS_STATS[aid]);
    allyObj.classId = aid;
    allyObj.hp = allyObj.hp ?? CLASS_STATS[aid].hp;
    allyObj.maxHp = allyObj.maxHp ?? CLASS_STATS[aid].maxHp;
    allyObj.baseAtk = CLASS_STATS[aid].baseAtk;
    allyObj.abilityCooldowns = {};
    allyObj.mana = (CLASS_STATS[aid] && typeof CLASS_STATS[aid].mana === 'number') ? CLASS_STATS[aid].mana : 0;
    allyObj.maxMana = (CLASS_STATS[aid] && typeof CLASS_STATS[aid].mana === 'number') ? CLASS_STATS[aid].mana : 0;
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
// running drop chance accumulated during the current wave (percent, additive)
let pveRunDropChance = 0;

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
    const pSpeedText = document.getElementById('player-speed-text');
    const eSpeedText = document.getElementById('enemy-speed-text');
    const pCritText = document.getElementById('player-crit-text');
    const eCritText = document.getElementById('enemy-crit-text');
    const pEvasionText = document.getElementById('player-evasion-text');
    const eEvasionText = document.getElementById('enemy-evasion-text');
    if (pDefText) pDefText.textContent = `DEF: ${player.defense >= 0 ? '+' + player.defense : String(player.defense)}`;
    if (eDefText) eDefText.textContent = `DEF: ${enemy.defense >= 0 ? '+' + enemy.defense : String(enemy.defense)}`;
    if (pSpeedText) pSpeedText.textContent = `SPD: ${player.speed ?? CLASS_STATS[player.classId || selectedClass].speed ?? '--'}`;
    if (eSpeedText) eSpeedText.textContent = `SPD: ${enemy.speed ?? ENEMY_STATS[currentEnemyId].speed ?? '--'}`;
    if (pCritText) pCritText.textContent = `CRIT: ${Math.round(Number(player.critChance || CLASS_STATS[player.classId || selectedClass].critChance || 0) * 100)}%`;
    if (eCritText) eCritText.textContent = `CRIT: ${Math.round(Number(enemy.critChance || ENEMY_STATS[currentEnemyId].critChance || 0) * 100)}%`;
    if (pEvasionText) pEvasionText.textContent = `EVA: ${Math.round(Number(player.evasion || CLASS_STATS[player.classId || selectedClass].evasion || 0) * 100)}%`;
    if (eEvasionText) eEvasionText.textContent = `EVA: ${Math.round(Number(enemy.evasion || ENEMY_STATS[currentEnemyId].evasion || 0) * 100)}%`;

    const pManaText = document.getElementById('player-mana-text');
    if (pManaText) pManaText.textContent = player.maxMana ? `MANA: ${player.mana}/${player.maxMana}` : '';

    // update mana bar fill (if present)
    const pManaFill = document.getElementById('player-mana');
    if (pManaFill) {
        if (player.maxMana && player.maxMana > 0) {
            try {
                pManaFill.style.width = ((player.mana || 0) / player.maxMana * 100) + '%';
                pManaFill.style.opacity = '1';
            } catch (e) { /* ignore style errors */ }
        } else {
            // hide or collapse when no mana
            pManaFill.style.width = '0%';
            pManaFill.style.opacity = '0';
        }
    }

    const pSprite = document.getElementById('player-sprite');
    const eSprite = document.getElementById('enemy-sprite');
    try {
        if (pSprite) {
            const cls = player && player.classId ? player.classId : selectedClass;
            const jpgSrc = `../img/${cls}.jpg`;
            // use JPG only
            pSprite.src = jpgSrc;
            pSprite.alt = player.name;
            pSprite.onerror = function () {
                // if missing, show a softened placeholder
                this.style.opacity = '0.7';
            };
        }
        if (eSprite) {
            const jpg2 = `../img/${currentEnemyId}.jpg`;
            eSprite.src = jpg2;
            eSprite.alt = enemy.name;
            eSprite.onerror = function () {
                this.style.opacity = '0.7';
            };
        }
    } catch (e) {
        // ignore UI sprite failures
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


// Tooltip helpers are defined above (shared implementation). Use those.

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

    const infoForTooltip = () => Object.assign({}, abil, { cooldown: cd });
    btn.addEventListener('mouseenter', (evt) => _showAbilityTooltip(evt, infoForTooltip()));
    btn.addEventListener('mousemove', (evt) => _showAbilityTooltip(evt, infoForTooltip()));
    btn.addEventListener('mouseleave', _hideAbilityTooltip);
    btn.addEventListener('focus', (evt) => _showAbilityTooltip(evt, infoForTooltip()));
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

    // If player has extraTurns, consume one and keep the turn
    if (player.status && (player.status.extraTurns || 0) > 0) {
        player.status.extraTurns = Math.max(0, (player.status.extraTurns || 0) - 1);
        if (player.status.extraTurns <= 0) delete player.status.extraTurns;
        tickCooldowns(player);
        updateUI();
        return;
    }

    playerTurn = false;
    setTimeout(enemyTurn, 800);
}

function renderStatusIcons(actor, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!actor || !actor.status) return;

    const fallbackEmoji = {
        burn: '🔥', stun: '⛔', slimed: '🟢', weaken: '⚠️'
    };

    for (const key in actor.status) {
        if (!Object.prototype.hasOwnProperty.call(actor.status, key)) continue;
        const jpg = `../img/status_${key}.jpg`;
        // use JPG only; if missing show emoji/text
        const img = document.createElement('img');
        img.className = 'status-icon';
        img.alt = key;
        img.src = jpg;
        img.onerror = function () {
            const span = document.createElement('span');
            span.className = 'status-badge';
            span.textContent = fallbackEmoji[key] || key.slice(0, 2).toUpperCase();
            this.replaceWith(span);
        };
        container.appendChild(img);
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
    // accumulate drop chance based on enemy defeated
    const DROP_CHANCES = { slime: 5, gladiator: 10, boss: 25 };
    try { pveRunDropChance = Math.min(100, pveRunDropChance + (DROP_CHANCES[currentEnemyId] || 0)); } catch (e) { }

    if (enemyQueue.length > 0) {
        setTimeout(() => {
            const nextId = enemyQueue.shift();
            spawnEnemy(nextId);
            logMessage(`A ${enemy.name} appears!`);
            playerTurn = true;
            updateUI();
        }, 1000);
    } else {
        // wave complete — roll for item drop using additive percentage
        setTimeout(async () => {
            updateUI();
            logMessage('Victory! All enemies defeated.');
            try {
                const roll = Math.random() * 100;
                const chance = Number(pveRunDropChance || 0);
                if (roll < chance) {
                    // player earned a reward choice — present them 3 random catalog options to pick
                    const catalog = (window.getItemCatalog && window.getItemCatalog()) || {};
                    const keys = Object.keys(catalog || {});
                    if (keys.length) {
                        // choose up to 3 unique random options
                        const shuffled = keys.slice();
                        for (let i = shuffled.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
                        }
                        const options = shuffled.slice(0, Math.min(3, shuffled.length)).map(k => ({ id: k, meta: catalog[k] || { id: k, name: k } }));

                        // build overlay chooser
                        const overlayId = 'pve-reward-overlay';
                        if (!document.getElementById(overlayId)) {
                            const overlay = document.createElement('div');
                            overlay.id = overlayId;
                            overlay.style.position = 'fixed';
                            overlay.style.left = '0';
                            overlay.style.top = '0';
                            overlay.style.width = '100%';
                            overlay.style.height = '100%';
                            overlay.style.background = 'rgba(0,0,0,0.6)';
                            overlay.style.display = 'flex';
                            overlay.style.alignItems = 'center';
                            overlay.style.justifyContent = 'center';
                            overlay.style.zIndex = '9999';

                            const panel = document.createElement('div');
                            panel.style.background = '#000';
                            panel.style.color = '#fff';
                            panel.style.padding = '20px';
                            panel.style.borderRadius = '8px';
                            panel.style.maxWidth = '720px';
                            panel.style.width = '90%';
                            panel.style.boxSizing = 'border-box';
                            panel.style.textAlign = 'center';

                            const title = document.createElement('h2');
                            title.textContent = 'Choose your reward';
                            panel.appendChild(title);

                            // Compute simple party and wave power metrics to show on the winner screen
                            try {
                                const partyPower = (Array.isArray(party) ? party : []).reduce((acc, p) => {
                                    const atk = Number(p.baseAtk || 0) + Number(p.attackBoost || 0);
                                    const hpScore = (Number(p.maxHp || p.hp || 0) / 10);
                                    const spd = Number(p.speed || (p.classId && CLASS_STATS[p.classId] && CLASS_STATS[p.classId].speed) || 0);
                                    return acc + atk + hpScore + (spd * 2);
                                }, 0);

                                const waveIds = (Array.isArray(initialQueue) && initialQueue.length) ? initialQueue : [currentEnemyId];
                                const wavePower = waveIds.reduce((acc, id) => {
                                    const e = ENEMY_STATS[id] || {};
                                    const atk = Number(e.baseAtk || 0);
                                    const hpScore = (Number(e.maxHp || e.hp || 0) / 10);
                                    const spd = Number(e.speed || 0);
                                    return acc + atk + hpScore + (spd * 2);
                                }, 0);

                                const statsRow = document.createElement('div');
                                statsRow.style.display = 'flex';
                                statsRow.style.justifyContent = 'space-between';
                                statsRow.style.margin = '8px 0';
                                statsRow.style.gap = '12px';

                                const leftStat = document.createElement('div');
                                leftStat.style.flex = '1';
                                leftStat.style.padding = '8px';
                                leftStat.style.border = '1px solid #eee';
                                leftStat.style.borderRadius = '6px';
                                leftStat.innerHTML = `<div style="font-weight:700;">Party Power</div><div style="font-size:1.2rem;">${Math.round(partyPower)}</div><div style=\"font-size:12px;color:#666\">Combined team strength (atk + hp/10 + 2*spd)</div>`;

                                const rightStat = document.createElement('div');
                                rightStat.style.flex = '1';
                                rightStat.style.padding = '8px';
                                rightStat.style.border = '1px solid #eee';
                                rightStat.style.borderRadius = '6px';
                                rightStat.innerHTML = `<div style="font-weight:700;">Wave Power</div><div style="font-size:1.2rem;">${Math.round(wavePower)}</div><div style=\"font-size:12px;color:#666\">Estimated enemy strength for this wave</div>`;

                                statsRow.appendChild(leftStat);
                                statsRow.appendChild(rightStat);
                                panel.appendChild(statsRow);
                            } catch (e) { /* ignore UI metric errors */ }

                            const row = document.createElement('div');
                            row.style.display = 'flex';
                            row.style.gap = '12px';
                            row.style.justifyContent = 'center';
                            row.style.flexWrap = 'wrap';

                            options.forEach(opt => {
                                const card = document.createElement('div');
                                card.style.border = '1px solid #333';
                                card.style.borderRadius = '6px';
                                card.style.padding = '8px';
                                card.style.width = '180px';
                                card.style.boxSizing = 'border-box';
                                card.style.background = '#111';
                                card.style.color = '#fff';

                                const img = document.createElement('img');
                                const paths = getItemImagePaths(opt.id);
                                img.src = paths.jpg;
                                img.alt = opt.meta.name || opt.id;
                                img.style.width = '100%';
                                img.style.height = '96px';
                                img.style.objectFit = 'contain';
                                img.onerror = function () { if (!this._triedSvg) { this._triedSvg = true; this.src = paths.svg; return; } this.style.opacity = '0.6'; };
                                card.appendChild(img);

                                const nm = document.createElement('div');
                                nm.textContent = opt.meta.name || opt.id;
                                nm.style.fontWeight = '700';
                                nm.style.margin = '8px 0';
                                nm.style.color = '#fff';
                                card.appendChild(nm);

                                const btn = document.createElement('button');
                                btn.type = 'button';
                                btn.textContent = 'Select';
                                btn.style.width = '100%';
                                btn.className = 'primary-btn';
                                btn.style.backgroundColor = '#222'; btn.style.color = '#fff'; btn.style.border = '1px solid #333';
                                btn.addEventListener('click', async () => {
                                    try {
                                        btn.disabled = true;
                                        const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
                                        if (uid && window.addItemToUser) {
                                            try { await window.addItemToUser(uid, { id: opt.meta.id, name: opt.meta.name, qty: 1 }); } catch (e) { console.error('addItemToUser failed', e); }
                                        } else {
                                            // local fallback
                                            try {
                                                const rawInv = JSON.parse(localStorage.getItem('inventory') || 'null') || {};
                                                const cur = rawInv[opt.meta.id] && rawInv[opt.meta.id].qty ? rawInv[opt.meta.id].qty : (rawInv[opt.meta.id] || 0);
                                                rawInv[opt.meta.id] = (typeof cur === 'number') ? cur + 1 : (cur + 1);
                                                localStorage.setItem('inventory', JSON.stringify(rawInv));
                                            } catch (e) { console.error('local award failed', e); }
                                        }
                                        logMessage(`You received: ${opt.meta.name}`);
                                    } catch (e) { console.error('reward select failed', e); }
                                    // cleanup and redirect to selection
                                    try { overlay.remove(); } catch (e) { /* ignore */ }
                                    pveRunDropChance = 0;
                                    setTimeout(() => { location.href = 'selection.html'; }, 500);
                                });

                                card.appendChild(btn);
                                row.appendChild(card);
                            });

                            panel.appendChild(row);

                            const small = document.createElement('div');
                            small.style.marginTop = '12px';
                            small.style.fontSize = '12px';
                            small.style.color = '#ccc';
                            small.textContent = 'Pick one reward to claim it. You will be returned to the selection screen afterwards.';
                            panel.appendChild(small);

                            overlay.appendChild(panel);
                            document.body.appendChild(overlay);
                        }
                        // done — don't auto-redirect; wait for player selection
                        return;
                    }
                }
                // No drop or no catalog entries: just show a short message and return to selection
                logMessage('No drop this run. Returning to selection...');
                pveRunDropChance = 0;
                try {
                    setTimeout(() => { location.href = 'selection.html'; }, 1000);
                } catch (e) { /* ignore redirect errors */ }
            } catch (e) { console.error('drop roll failed', e); pveRunDropChance = 0; try { setTimeout(() => { location.href = 'selection.html'; }, 1000); } catch (er) {} }
        }, 800);
    }
}

function handlePlayerDefeat() {
    // If a revive was prepared, consume it and restore the player
    if (player && player.has_revive) {
        try {
            const newHp = Math.max(1, Math.ceil((player.maxHp || player.maxHP || 100) * 0.3));
            player.hp = newHp;
            player.fainted = false;
            // remove harmful DOTs so revive isn't immediately countered
            if (player.status) {
                if (player.status.poison) delete player.status.poison;
                if (player.status.burn) delete player.status.burn;
            }
            player.has_revive = false;
            logMessage('A Revive Scroll saved you from defeat!');
            updateUI();
            // keep the turn with the player after revive
            playerTurn = true;
            return;
        } catch (e) { console.error('revive handling failed', e); }
    }

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
        setTimeout(() => {
            logMessage('You have been defeated!');
            updateUI();
            // award a consolation drop based on accumulated run chance
            try {
                const roll = Math.random() * 100;
                if (roll < (pveRunDropChance || 0)) {
                    const catalog = (window.getItemCatalog && window.getItemCatalog()) || {};
                    const keys = Object.keys(catalog || {});
                    if (keys.length) {
                        const chosen = keys[Math.floor(Math.random() * keys.length)];
                        const meta = catalog[chosen] || { id: chosen, name: chosen };
                        const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
                        if (uid && window.addItemToUser) {
                            try { window.addItemToUser(uid, { id: meta.id, name: meta.name, qty: 1 }); } catch (e) { console.error('addItemToUser failed', e); }
                        } else {
                            try {
                                const raw = JSON.parse(localStorage.getItem('inventory') || 'null') || {};
                                raw[meta.id] = Math.max(0, (raw[meta.id] && raw[meta.id].qty) ? raw[meta.id].qty : (raw[meta.id] || 0));
                                if (typeof raw[meta.id] === 'number') raw[meta.id] = raw[meta.id] + 1; else raw[meta.id] = (raw[meta.id].qty || 0) + 1;
                                localStorage.setItem('inventory', JSON.stringify(raw));
                            } catch (e) { console.error('local inventory update failed', e); }
                        }
                        logMessage(`You received a consolation item: ${meta.name}`);
                    }
                }
            } catch (e) { console.error('consolation drop roll failed', e); }

            // show a return button to selection
            try {
                const container = document.getElementById('battle') || document.body;
                if (container && !document.getElementById('return-to-selection-btn')) {
                    const btn = document.createElement('button');
                    btn.id = 'return-to-selection-btn';
                    btn.textContent = 'Return to Selection';
                    btn.style.marginTop = '12px';
                    btn.className = 'primary-btn';
                    btn.addEventListener('click', () => { location.href = 'selection.html'; });
                    container.appendChild(btn);
                }
            } catch (e) { /* ignore */ }
        }, 400);
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

    // Regen / healing-over-time
    if (actor.status.regen) {
        const r = actor.status.regen;
        const healAmt = r.amount || 3;
        const maxHpLocal = actor.maxHp || actor.maxHP || 100;
        actor.hp = Math.min(maxHpLocal, (actor.hp || 0) + healAmt);
        messages.push(`${actor.name} regenerates ${healAmt} HP.`);
        r.turns--;
        if (r.turns <= 0) delete actor.status.regen;
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

    // Bleed: percent-based DOT (e.g., 5% max HP per turn)
    if (actor.status.bleed) {
        try {
            const pct = Number(actor.status.bleed.pct || 0);
            const maxHpLocal = actor.maxHp || actor.maxHP || 100;
            const dmg = Math.max(1, Math.floor(maxHpLocal * pct));
            const dealt = applyDamage(actor, dmg, { ignoreDefense: true });
            messages.push(`${actor.name} bleeds for ${dealt} damage.`);
            actor.status.bleed.turns--;
            if (actor.status.bleed.turns <= 0) delete actor.status.bleed;
        } catch (e) { /* ignore bleed processing errors */ }
    }

    if (actor.status.shout) {
        actor.status.shout.turns--;
        if (actor.status.shout.turns <= 0) {
            const amt = actor.status.shout.amount || 0;
            actor.attackBoost = Math.max(0, (actor.attackBoost || 0) - amt);
            delete actor.status.shout;
        }
    }

    // Shield expiry: when shield turns expire, reset defense to class baseline
    if (actor.status.shield) {
        try {
            actor.status.shield.turns = (actor.status.shield.turns || 0) - 1;
            if (actor.status.shield.turns <= 0) {
                const cls = actor.classId || actor.class || null;
                const baseDef = (cls && CLASS_STATS[cls] && typeof CLASS_STATS[cls].defense !== 'undefined') ? CLASS_STATS[cls].defense : 0;
                actor.defense = baseDef;
                delete actor.status.shield;
            }
        } catch (e) { /* ignore shield expiry errors */ }
    }

    // Dark Inversion expiry handling: decrement duration and remove when expired
    if (actor.status.dark_inversion) {
        try {
            actor.status.dark_inversion.turns = (actor.status.dark_inversion.turns || 0) - 1;
            if (actor.status.dark_inversion.turns <= 0) {
                delete actor.status.dark_inversion;
            }
        } catch (e) { /* ignore */ }
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

// If a target has dark_inversion status, hp changes should be inverted.
// This mirrors the multiplayer helper so PVE item/ability logic behaves the same.
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

            // damage -> heal
            if (newHp < cur) {
                const damage = cur - newHp;
                const maxHp = Number(targetStats.maxHp || targetStats.maxHP || cur || 100);
                updatesObj.hp = Math.min(maxHp, cur + damage);
                if (updatesObj.hp > 0 && updatesObj.fainted) updatesObj.fainted = false;
                return updatesObj;
            }

            // heal -> damage
            if (newHp > cur) {
                const heal = newHp - cur;
                const dmg = heal;
                updatesObj.hp = Math.max(0, cur - dmg);
                if (updatesObj.hp <= 0) updatesObj.fainted = true;
                return updatesObj;
            }

            return updatesObj;
        };

        invertIfNeeded(p, playerStats);
        invertIfNeeded(o, opponentStats);
    } catch (e) {
        console.error('applyDarkInversionToUpdates failed', e);
    }
    return { playerUpdates: p, opponentUpdates: o };
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
        const dealt = applyDamage(enemy, damage, { attacker: player });
        logMessage(`You hit ${enemy.name} for ${dealt} damage!`);
    } else if (move === 'heal' && !player.fainted) {
        let heal = Math.floor(Math.random() * 15) + 5;
        if (player.status && player.status.slimed) heal = Math.max(0, Math.floor(heal / 2));
        // If player is under dark_inversion status, healing damages instead
        if (player.status && player.status.dark_inversion) {
            player.hp = Math.max(0, (player.hp || 0) - heal);
            logMessage(`Your healing backfired due to Dark Inversion and dealt ${heal} damage to you!`);
            if (player.hp <= 0) { player.fainted = true; handlePlayerDefeat(); updateUI(); return; }
        } else {
            player.hp = Math.min(player.maxHp, player.hp + heal);
            logMessage(`You healed yourself for ${heal} HP!`);
        }
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
    // If player has extraTurns, consume one and keep the turn
    if (player.status && (player.status.extraTurns || 0) > 0) {
        player.status.extraTurns = Math.max(0, (player.status.extraTurns || 0) - 1);
        if (player.status.extraTurns <= 0) delete player.status.extraTurns;
        tickCooldowns(player);
        updateUI();
        // keep playerTurn true so player acts again immediately
        return;
    }
    // normal flow: end player turn and schedule enemy
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
    const dealt = applyDamage(player, damage, { attacker: enemy });
    logMessage(`${enemy.name} attacks for ${dealt} damage!`);
    } else if (choice === 2) {
        const heal = Math.floor(Math.random() * 10) + 5;
        if (enemy.status && enemy.status.dark_inversion) {
            enemy.hp = Math.max(0, (enemy.hp || 0) - heal);
            logMessage(`${enemy.name}'s heal backfired due to Dark Inversion and they took ${heal} damage!`);
            if (enemy.hp <= 0) { enemy.fainted = true; handleEnemyDefeat(); updateUI(); return; }
        } else {
            enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
            logMessage(`${enemy.name} healed for ${heal} HP!`);
        }
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

// (old duplicate attachActionTooltips removed - multiplayer-style tooltip helpers above are used)

function applyDamage(target, rawDamage, opts = {}) {
    // opts: { ignoreDefense: bool, attacker: { critChance, ... }, considerHit: bool }
    const ignoreDefense = !!opts.ignoreDefense;
    const attacker = opts.attacker || null;
    const considerHit = (typeof opts.considerHit === 'boolean') ? opts.considerHit : !!attacker;

    // Evasion check
    const targetEvasion = Number(target.evasion || 0) || 0;
    if (considerHit && targetEvasion > 0) {
        try {
            if (Math.random() < targetEvasion) {
                // Dodge: no damage applied
                try { console.debug('[PVE] attack dodged by target', { target: target.name || target.classId, evasion: targetEvasion }); } catch(e){}
                return 0;
            }
        } catch (e) { /* ignore RNG errors */ }
    }

    const defense = ignoreDefense ? 0 : (target.defense || 0);
    let final = Math.max(0, Math.round(rawDamage - defense));

    // Crit check
    const critChance = attacker ? Number(attacker.critChance || 0) : 0;
    if (considerHit && critChance > 0) {
        try {
            if (Math.random() < critChance) {
                final = Math.max(1, Math.round(final * 1.5)); // +50% damage on crit
                try { console.debug('[PVE] critical hit', { attacker: attacker.name || attacker.classId, critChance: critChance }); } catch(e){}
            }
        } catch (e) { /* ignore RNG errors */ }
    }

    // If the target has dark_inversion status, damage should heal them instead.
    try {
        const hasInvert = !!(target && target.status && target.status.dark_inversion);
        if (hasInvert) {
            // treat damage as healing (cap at maxHp)
            const maxHp = Number(target.maxHp || target.maxHP || 100);
            target.hp = Math.min(maxHp, (target.hp || 0) + final);
            // if they were fainted and got healed, clear fainted
            if (target.hp > 0 && target.fainted) target.fainted = false;
            return final;
        }
    } catch (e) { /* ignore inversion check errors */ }

    target.hp = Math.max(0, (target.hp || 0) - final);
    return final;
}

// --- Inventory: use the multiplayer (PvP) implementation as the canonical UI/behavior
// ITEM_IMAGE_MAP maps item ids to filenames found under public/img. We use ../img/ paths
// because this PVE script lives in public/PVE/ and the images are in public/img/.
const ITEM_IMAGE_MAP = {
    potion_small: 'small potion.jpg',
    potion_large: 'large potion.jpg',
    bomb: 'bomb.jpg',
    elixir: 'elixir.jpg',
    shield_token: 'shield scroll.jpg',
    speed_scroll: 'speed scroll.jpg',
    strength_tonic: 'strength tonic.jpg',
    revive_scroll: 'revive scroll.jpg'
    ,
   
    swift_boots: 'swift boots.jpg',
    focus_charm: 'focus charm.jpg'
};

function getItemImagePaths(itemId) {
    const mapped = ITEM_IMAGE_MAP[itemId];
    if (mapped) {
        const jpg = `../img/${mapped}`;
        const svg = mapped.endsWith('.jpg') ? `../img/${mapped.slice(0, -4)}.svg` : `../img/${mapped}.svg`;
        return { jpg, svg };
    }
    return { jpg: `../img/items/${itemId}.jpg`, svg: `../img/items/${itemId}.svg` };
}

async function renderInventory() {
    const invEl = document.getElementById('inventory-list');
    if (!invEl) return;
    invEl.textContent = '(loading...)';

    try {
        const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
        // If signed in, prefer DB-backed items (app.js exposes getUserItems/useItemForUser)
        if (uid && typeof window.getUserItems === 'function') {
            const items = await window.getUserItems(uid) || {};
            invEl.innerHTML = '';
            const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
            const keys = Object.keys(items || {});
            if (!keys.length) { invEl.textContent = '(no items)'; return; }

            for (const key of keys) {
                if (key === 'jps') continue; // legacy skip
                const it = items[key] || {};
                const qty = it.qty || 0;
                if (qty <= 0) continue;

                const row = document.createElement('div'); row.className = 'inventory-item'; row.tabIndex = 0;
                const left = document.createElement('div'); left.className = 'inv-item-left';

                const img = document.createElement('img');
                const paths = getItemImagePaths(key);
                img.className = 'inv-item-img';
                img.src = paths.jpg;
                img.alt = catalog[key]?.name || it.name || key;
                img.onerror = function() {
                    try {
                        if (!this._triedSvg) { this._triedSvg = true; this.src = paths.svg; return; }
                    } catch (e) {}
                    this.onerror = null;
                };

                const nameWrap = document.createElement('div');
                nameWrap.innerHTML = `<div class="inv-item-name">${catalog[key]?.name || it.name || key}</div><div class="inv-item-qty">x${qty}</div>`;
                left.appendChild(img); left.appendChild(nameWrap);

                const right = document.createElement('div');
                const useBtn = document.createElement('button'); useBtn.type = 'button'; useBtn.className = 'inv-use-btn'; useBtn.textContent = 'Use';
                useBtn.disabled = !(qty > 0);
                if (catalog[key] && catalog[key].desc) { useBtn.classList.add('has-tooltip'); useBtn.setAttribute('data-tooltip', catalog[key].desc); }
                useBtn.addEventListener('click', async () => {
                    if (player.status && player.status.no_items) { logMessage('Items are disabled right now!'); return; }
                    try {
                        if (!uid || !window.useItemForUser) throw new Error('Not signed in or helper missing');
                        const used = await window.useItemForUser(uid, key);
                        // apply the in-battle effect locally for PVE
                        applyItemEffectToBattle(used || { id: key });
                        logMessage(`Used ${used && used.name ? used.name : key}`);

                        // Consume player's turn unless the item explicitly grants an extra immediate action
                        const itemId = (used && (used.id || used.itemId)) || key;
                        if (itemId !== 'speed_scroll') {
                            turnCounter = (turnCounter || 0) + 1;
                            playerTurn = false;
                            if (!(enemy && enemy.hp <= 0)) setTimeout(enemyTurn, 800);
                        } else {
                            // speed_scroll: player retains turn (applyItemEffectToBattle already handled extraTurns)
                        }
                    } catch (e) {
                        console.error('useItemForUser failed', e);
                        logMessage('Could not use item: ' + (e && e.message));
                    }
                    updateUI();
                    try { await renderInventory(); } catch (e) { /* ignore */ }
                });

                right.appendChild(useBtn);
                row.appendChild(left); row.appendChild(right);
                invEl.appendChild(row);
            }
            return;
        }

        // localStorage fallback for anonymous players
        const raw = (() => { try { return JSON.parse(localStorage.getItem('inventory') || 'null'); } catch (e) { return null; } })();
        const inv = (raw && typeof raw === 'object') ? raw : { potion_small: 2 };
        invEl.innerHTML = '';
        const keys = Object.keys(inv || {});
        if (!keys.length) { invEl.textContent = '(empty)'; return; }

        for (const id of keys) {
            const qty = inv[id] || 0; if (qty <= 0) continue;
            const paths = getItemImagePaths(id);
            const row = document.createElement('div'); row.className = 'inv-row';
            const left = document.createElement('div'); left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '8px';
            const img = document.createElement('img'); img.src = encodeURI(paths.jpg); img.alt = id; img.style.width='48px'; img.style.height='48px'; img.style.objectFit='contain';
            img.onerror = function() { try { if (!this._triedSvg) { this._triedSvg = true; this.src = paths.svg; return; } } catch(e){} this.style.opacity='0.6'; };
            const name = document.createElement('div'); name.style.fontWeight='700'; name.textContent = `${id} x${qty}`;
            left.appendChild(img); left.appendChild(name);
            const btn = document.createElement('button'); btn.textContent='Use'; btn.addEventListener('click', async () => {
                if (player.status && player.status.no_items) { logMessage('Items are disabled right now!'); return; }
                // simple local uses
                if (id === 'potion_small' || id === 'potion_large') {
                    const amt = (id === 'potion_small') ? 20 : 50;
                    player.hp = Math.min(player.maxHp || 100, (player.hp || 0) + amt);
                    inv[id] = Math.max(0, (inv[id] || 0) - 1);
                    localStorage.setItem('inventory', JSON.stringify(inv));
                    logMessage(`Used ${id}, healed ${amt} HP.`);
                    updateUI(); await renderInventory();
                } else if (id === 'elixir') {
                    const amt = player.maxMana || 0; player.mana = amt; inv[id] = Math.max(0,(inv[id]||0)-1); localStorage.setItem('inventory', JSON.stringify(inv)); logMessage('Mana fully restored.'); updateUI(); await renderInventory();
                } else if (id === 'speed_scroll') {
                    const newStatus = Object.assign({}, player.status || {});
                    newStatus.extraTurns = (newStatus.extraTurns || 0) + 1;
                    player.status = newStatus;
                    inv[id] = Math.max(0, (inv[id] || 0) - 1);
                    localStorage.setItem('inventory', JSON.stringify(inv));
                    logMessage('Used Speed Scroll: you gain an extra immediate action.');
                    updateUI(); await renderInventory();
                    // do not end turn for speed scroll
                    return;
                } else {
                    logMessage(`Used ${id}.`);
                    inv[id] = Math.max(0, (inv[id] || 0) - 1);
                    localStorage.setItem('inventory', JSON.stringify(inv));
                    updateUI(); await renderInventory();
                }

                // consume turn for local-use items (unless speed_scroll which returned above)
                turnCounter = (turnCounter || 0) + 1;
                playerTurn = false;
                if (!(enemy && enemy.hp <= 0)) setTimeout(enemyTurn, 800);
            });
            row.appendChild(left); row.appendChild(btn); invEl.appendChild(row);
        }
    } catch (e) {
        console.error('renderInventory error', e);
        const invEl2 = document.getElementById('inventory-list'); if (invEl2) invEl2.textContent = '(error)';
    }
}

window.renderInventory = renderInventory;

// Apply an item's in-battle effects for PVE mode. The multiplayer implementation
// applies updates to remote DB nodes; here we mutate local `player`/`enemy` and
// party state and call the existing PVE handlers (handleEnemyDefeat/handlePlayerDefeat).
function applyItemEffectToBattle(item) {
    try {
        const id = (item && (item.id || item.itemId)) || item;
        if (!id) return;
        if (!player) return;

        // build structured updates rather than mutating directly so dark inversion
        // can be applied consistently (matches PvP helper behavior)
        let playerUpdates = {};
        let opponentUpdates = {};

        if (id === 'potion_small') {
            const heal = 20;
            const actualHeal = (player.status && player.status.slimed) ? Math.floor(heal / 2) : heal;
            playerUpdates.hp = Math.min(player.maxHp || player.hp || 100, (player.hp || 0) + actualHeal);
            logMessage(`Used Small Potion: healed ${actualHeal} HP.`);
        } else if (id === 'potion_large') {
            const heal = 50;
            const actualHeal = (player.status && player.status.slimed) ? Math.floor(heal / 2) : heal;
            playerUpdates.hp = Math.min(player.maxHp || player.hp || 100, (player.hp || 0) + actualHeal);
            logMessage(`Used Large Potion: healed ${actualHeal} HP.`);
        } else if (id === 'bomb') {
            const dmg = 20;
            const actual = Math.max(0, dmg - (enemy.defense || 0));
            opponentUpdates.hp = Math.max(0, (enemy.hp || 0) - actual);
            logMessage(`Used Bomb: dealt ${actual} damage to ${enemy.name}.`);
        } else if (id === 'elixir') {
            playerUpdates.mana = player.maxMana || player.mana || 0;
            const newStatus = Object.assign({}, player.status || {});
            newStatus.strength = { turns: 2, amount: 4 };
            playerUpdates.status = newStatus;
            logMessage('Used Elixir: restored mana and granted a short strength boost.');
        } else if (id === 'shield_token' || id === 'shield scroll') {
            const add = 10;
            playerUpdates.defense = (player.defense || 0) + add;
            const newStatus = Object.assign({}, player.status || {});
            newStatus.shield = { turns: 1, amount: add };
            playerUpdates.status = newStatus;
            logMessage('Used Shield Token: temporary defense granted.');
        } else if (id === 'speed_scroll') {
            const newStatus = Object.assign({}, player.status || {});
            newStatus.extraTurns = (newStatus.extraTurns || 0) + 1;
            playerUpdates.status = newStatus;
            // indicate that player should retain the turn
            playerTurn = true;
            logMessage('Used Speed Scroll: you gain an extra immediate action.');
        } else if (id === 'strength_tonic') {
            const newStatus = Object.assign({}, player.status || {});
            newStatus.strength_boost = { turns: 1, amount: 10 };
            playerUpdates.status = newStatus;
            logMessage('Used Strength Tonic: temporary attack boost applied.');
        } else if (id === 'swift_boots') {
            const newStatus = Object.assign({}, player.status || {});
            newStatus.haste = { turns: 3, amount: 4 };
            // immediate effect: increase speed for combat calculations
            player.speed = (player.speed || 0) + 4;
            playerUpdates.status = newStatus;
            logMessage('Used Swift Boots: increased speed for a few turns.');
        } else if (id === 'focus_charm') {
            const newStatus = Object.assign({}, player.status || {});
            newStatus.critChance = (newStatus.critChance || 0) + 0.08;
            playerUpdates.status = newStatus;
            logMessage('Used Focus Charm: increased critical chance temporarily.');
        } else if (id === 'revive_scroll') {
            playerUpdates.has_revive = true;
            logMessage('Revive Scroll prepared: you will be revived automatically if you fall.');
        } else {
            logMessage('Used unknown item: ' + id);
        }

        // Apply dark inversion if present on either actor before committing updates
        const adjusted = applyDarkInversionToUpdates(player, enemy, playerUpdates, opponentUpdates, true);

        // Merge adjusted updates into live objects
        if (adjusted.playerUpdates) {
            if (typeof adjusted.playerUpdates.hp !== 'undefined') player.hp = adjusted.playerUpdates.hp;
            if (typeof adjusted.playerUpdates.defense !== 'undefined') player.defense = adjusted.playerUpdates.defense;
            if (typeof adjusted.playerUpdates.mana !== 'undefined') player.mana = adjusted.playerUpdates.mana;
            if (typeof adjusted.playerUpdates.has_revive !== 'undefined') player.has_revive = adjusted.playerUpdates.has_revive;
            if (adjusted.playerUpdates.status) {
                player.status = Object.assign({}, player.status || {}, adjusted.playerUpdates.status || {});
            }
        }
        if (adjusted.opponentUpdates) {
            if (typeof adjusted.opponentUpdates.hp !== 'undefined') enemy.hp = adjusted.opponentUpdates.hp;
            if (typeof adjusted.opponentUpdates.defense !== 'undefined') enemy.defense = adjusted.opponentUpdates.defense;
            if (adjusted.opponentUpdates.status) {
                enemy.status = Object.assign({}, enemy.status || {}, adjusted.opponentUpdates.status || {});
            }
        }

        // Check for enemy faint
        if (enemy && enemy.hp <= 0) {
            enemy.fainted = true;
            handleEnemyDefeat();
        }

        // Check for player faint (e.g., inverted heal -> damage)
        if (player && player.hp <= 0) {
            player.fainted = true;
            handlePlayerDefeat();
        }

        try { updateUI(); } catch (e) { /* ignore */ }
    } catch (e) {
        console.error('applyItemEffectToBattle failed', e);
    }
}

// Wire Items toggle button
window.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-inventory-btn');
    const invPanel = document.getElementById('inventory');
    if (toggleBtn && invPanel) {
        toggleBtn.addEventListener('click', async () => {
            const hidden = invPanel.classList.toggle('hidden');
            if (!hidden) {
                try { await renderInventory(); } catch (e) { console.error('Could not render inventory', e); }
            }
        });
    }
});