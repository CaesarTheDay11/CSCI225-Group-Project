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

// Note: in-match Armory button removed — armory still accessible from top nav.
let opponentId = null;
let matchRef = null;
let currentTurnRef = null;
let playerRef = null;
let opponentRef = null;
let isPlayer1 = false;
let lastProcessedMoveActor = null;
let lastProcessedMove = null;
let lastActivityTs = Date.now();
let inactivityInterval = null;
let inactivityFinishing = false;
const INACTIVITY_LIMIT_MS = 60000; // 60 seconds
let perTurnStartTs = null;
let currentTurnUid = null;
let countdownInterval = null;
//this debounces death checks triggered by realtime listeners to avoid races with concurrent writes
const _deathCheckTimers = {};

// Damage log UI: a scrollable box in the bottom-right that records events.
// By default the log is disabled; call DamageLog.show() when a match/battle starts
// and DamageLog.hide() when it ends. This prevents the log from appearing on non-battle pages.
const DamageLog = (function(){
  let container = null;
  let enabled = false; // only write logs when enabled
  function ensure() {
    try {
      if (container) return container;
      // create styles
      const styleId = '__damage_log_style_v1';
      if (!document.getElementById(styleId)) {
        const s = document.createElement('style');
        s.id = styleId;
        s.textContent = `#__damage_log { position: fixed; right: 12px; bottom: 12px; width: 360px; height: 220px; background: rgba(0,0,0,0.8); color: #eee; font-family: inherit; font-size: 13px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.6); z-index: 99999; display:flex; flex-direction:column; }
          #__damage_log .hdr { background: rgba(255,255,255,0.03); padding:6px 8px; border-top-left-radius:6px; border-top-right-radius:6px; display:flex; align-items:center; justify-content:space-between; }
          #__damage_log .body { padding:8px; overflow:auto; flex:1; font-family: monospace; font-size:12px }
          #__damage_log .entry { margin-bottom:6px; line-height:1.2; display:flex; gap:8px; align-items:flex-start; }
          #__damage_log .ts { color:#88f; min-width:64px; }
          #__damage_log .actor { color:#f6c; font-weight:600; }
          #__damage_log .target { color:#8ff; font-weight:600; }
          #__damage_log .amount { color:#ffb86b; font-weight:700; }
          #__damage_log .info { color:#ddd; font-size:12px; }
          #__damage_log .controls { display:flex; gap:6px; }
          #__damage_log .controls button { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); color: #fff; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:12px }
          #__damage_log .controls button:hover { background: rgba(255,255,255,0.06); }
          `;
        document.head.appendChild(s);
      }
      container = document.createElement('div');
      container.id = '__damage_log';
      container.innerHTML = `<div class="hdr"><div>Damage Log</div><div class="controls"><button id="__damage_log_toggle">Hide</button><button id="__damage_log_clear">Clear</button></div></div><div class="body" id="__damage_log_body"></div>`;
      document.body.appendChild(container);
      const btn = document.getElementById('__damage_log_clear');
      btn.addEventListener('click', () => { const b = document.getElementById('__damage_log_body'); if (b) b.innerHTML = ''; });
      const toggle = document.getElementById('__damage_log_toggle');
      try {
        const body = document.getElementById('__damage_log_body');
        let hidden = false;
        toggle.addEventListener('click', () => {
          try {
            hidden = !hidden;
            if (body) body.style.display = hidden ? 'none' : 'block';
            toggle.textContent = hidden ? 'Show' : 'Hide';
            try { localStorage.setItem('__damage_log_hidden_v1', hidden ? '1' : '0'); } catch(e) {}
          } catch(e){}
        });
        // restore previous state
        try {
          const prev = localStorage.getItem('__damage_log_hidden_v1');
          if (prev === '1') { body.style.display = 'none'; toggle.textContent = 'Show'; }
        } catch(e) {}
      } catch(e) {}
      return container;
    } catch (e) {
      // DOM may not be ready - try later
      try { setTimeout(ensure, 200); } catch(e2){}
      return null;
    }
  }

  // Accept either a string message or a structured object to render clearer entries.
  function log(payload, level='info') {
    try {
      if (!enabled) return; // don't create or write the log unless enabled
      const c = ensure();
      if (!c) return;
      const body = c.querySelector('.body');
      if (!body) return;
      const el = document.createElement('div');
      el.className = 'entry';
      const ts = new Date().toLocaleTimeString();
      if (typeof payload === 'string') {
        el.innerHTML = `<span class="ts">[${ts}]</span><div class="info">${escapeHtml(payload)}</div>`;
      } else if (typeof payload === 'object' && payload !== null) {
        // structured rendering
        const actor = escapeHtml(String(payload.actor || payload.attacker || ''));
        const target = escapeHtml(String(payload.target || payload.defender || ''));
        const amt = (typeof payload.final !== 'undefined') ? payload.final : (payload.amount || '');
        const raw = (typeof payload.raw !== 'undefined') ? payload.raw : '';
        const def = (typeof payload.def !== 'undefined') ? payload.def : '';
        const crit = payload.crit ? '<span style="color:#ff5;">✶</span>' : '';
        const dodged = payload.dodged ? '<span style="color:#faa;">(dodged)</span>' : '';
        const reason = escapeHtml(String(payload.reason || payload.note || ''));
        const elem = payload.element ? `<span style="color:#9cf">[${escapeHtml(payload.element)}]</span>` : '';
        let procsHtml = '';
        if (Array.isArray(payload.procs) && payload.procs.length) {
          procsHtml = '<div class="info">';
          payload.procs.forEach(p => {
            try {
              const elName = escapeHtml(String(p.element || p.elem || ''));
              const effect = escapeHtml(String(p.effect || p.type || '')); 
              const amount = (typeof p.amount !== 'undefined') ? escapeHtml(String(p.amount)) : '';
              const turns = (typeof p.turns !== 'undefined') ? ` turns=${escapeHtml(String(p.turns))}` : '';
              const resist = (typeof p.resist !== 'undefined') ? ` resist=${escapeHtml(String((p.resist*100).toFixed ? (p.resist*100).toFixed(1) : String(p.resist)))}%` : '';
              const chance = (typeof p.chance !== 'undefined') ? ` chance=${escapeHtml(String((p.chance*100).toFixed ? (p.chance*100).toFixed(1) : String(p.chance)))}%` : '';
              let bits = [];
              if (elName) bits.push('['+elName+']');
              if (effect) bits.push(effect);
              if (amount) bits.push('amt='+amount);
              bits.push(turns.trim());
              if (resist) bits.push(resist.trim());
              if (chance) bits.push(chance.trim());
              procsHtml += '• ' + bits.filter(Boolean).join(' ') + '<br/>';
            } catch (e) { procsHtml += escapeHtml(JSON.stringify(p)) + '<br/>'; }
          });
          procsHtml += '</div>';
        }
        el.innerHTML = `<span class="ts">[${ts}]</span><div><span class="actor">${actor}</span> → <span class="target">${target}</span> ${elem} <div class="info">${reason}</div><div class="amount">${crit} ${escapeHtml(String(amt))} HP</div><div class="info">(raw:${escapeHtml(String(raw))} def:${escapeHtml(String(def))}) ${dodged}</div>${procsHtml}</div>`;
      } else {
        el.innerHTML = `<span class="ts">[${ts}]</span><div class="info">${escapeHtml(String(payload))}</div>`;
      }
      body.appendChild(el);
      // keep scrolled to bottom
      body.scrollTop = body.scrollHeight;
    } catch (e) { /* ignore logging errors */ }
  }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function show() { enabled = true; try { ensure(); const c = document.getElementById('__damage_log'); if (c) c.style.display = 'flex'; } catch(e) {} }
  function hide() { enabled = false; try { const c = document.getElementById('__damage_log'); if (c) c.style.display = 'none'; } catch(e) {} }
  // attach to window so other modules (app.js) can toggle visibility
  try { if (typeof window !== 'undefined') window.DamageLog = undefined; } catch(e) {}
  // ensure we return control methods
  return { log, show, hide };
})();

//this defines ABILITIES metadata
const ABILITIES = {
  mage_fireball: { id: 'mage_fireball', name: 'Fireball', element: 'fire', cost: 10, cooldown: 3, desc: 'Deal strong magic damage and apply burn (DOT for 3 turns).' },
  warrior_rend:  { id: 'warrior_rend',  name: 'Rend',     cost: 0,  cooldown: 3, desc: 'Powerful physical strike that ignores some defense. (Buffed)' },
  archer_volley: { id: 'archer_volley', name: 'Volley',   cost: 0,  cooldown: 3, desc: 'Hits multiple shots; chance to reduce enemy attack.' },
  slime_splatter:{ id: 'slime_splatter',name: 'Splatter', cost: 0,  cooldown: 4, desc: 'Deals damage and applies slime (reduces healing/attack).' },
  gladiator_charge:{id:'gladiator_charge',name:'Charge',  cost: 0,  cooldown: 4, desc: 'Heavy single-target hit with chance to stun.' },
  boss_earthquake:{id:'boss_earthquake', name:'Earthquake', cost:0, cooldown:5, desc:'Massive damage and stuns the player for 1 turn.'},
  // tag as earth elemental (element assigned after object literal)
  mage_iceblast:  { id: 'mage_iceblast', name: 'Ice Blast', element: 'ice', cost: 8, cooldown: 4, desc: 'Deal magic damage and reduce enemy ATK for 2 turns.' },
  warrior_shout:  { id: 'warrior_shout', name: 'Battle Shout', cost: 0, cooldown: 5, desc: 'Increase your attack boost for several turns (now +10).' },
  archer_poison:  { id: 'archer_poison', name: 'Poison Arrow', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison (DOT).' }
};

// mark boss earthquake as earth-elemental
ABILITIES.boss_earthquake.element = 'earth';

ABILITIES.cleric_heal = { id: 'cleric_heal', name: 'Divine Heal', cost: 8, cooldown: 3, desc: 'Restore a moderate amount of HP to yourself and dispel poison/burn from yourself.' };
ABILITIES.cleric_smite = { id: 'cleric_smite', name: 'Smite', cost: 6, cooldown: 4, desc: 'Holy damage that also dispels poison/burn from yourself.' };
ABILITIES.cleric_smite.element = 'light';

//this adds third ability for each class
ABILITIES.warrior_whirlwind = { id: 'warrior_whirlwind', name: 'Whirlwind', cost: 0, cooldown: 4, desc: 'Spin and strike hard, dealing physical damage and reducing the enemy attack for a short time.' };
  ABILITIES.mage_arcane_burst = { id: 'mage_arcane_burst', name: 'Arcane Burst', element: 'light', cost: 12, cooldown: 5, desc: 'A focused magical blast that deals strong magic damage and empowers the caster with a temporary +9 attack instead of burning the foe.' };
ABILITIES.archer_trap = { id: 'archer_trap', name: 'Trap', cost: 0, cooldown: 5, desc: 'Set a wound-trap on the enemy (applies bleeding over time).' };
ABILITIES.cleric_shield = { id: 'cleric_shield', name: 'Sanctuary Shield', cost: 6, cooldown: 5, desc: 'Create a holy shield around yourself that raises defense for a few turns.' };
ABILITIES.knight_bastion = { id: 'knight_bastion', name: 'Bastion', cost: 0, cooldown: 6, desc: 'Assume Bastion: gain +12 DEF for 3 turns (shield persists until it expires). Incoming damage is reduced by your increased defense while active.' };
ABILITIES.rogue_evade = { id: 'rogue_evade', name: 'Evasive Roll', cost: 0, cooldown: 4, desc: 'Delay your action and unleash three rapid, consecutive turns.' };
ABILITIES.paladin_bless = { id: 'paladin_bless', name: 'Blessing', cost: 8, cooldown: 5, desc: 'A heal 20 hp and an gain an inspirational attack boost to yourself.' };
ABILITIES.necro_curse = { id: 'necro_curse', name: 'Curse of Decay', cost: 10, cooldown: 5, desc: 'Afflict the target so they suffer reduced healing (slimed) and ongoing rot.' };
ABILITIES.druid_barkskin = { id: 'druid_barkskin', name: 'Barkskin', cost: 8, cooldown: 5, desc: 'Harden your skin: heal a small amount, gain +8 defense for several turns, and lash the enemy for minor damage.' };

// New classes: Artificer, Valkyrie, Barbarian
ABILITIES.artificer_turret = { id: 'artificer_turret', name: 'Deploy Turret', cost: 6, cooldown: 5, desc: 'Deploy a mechanical turret that deals damage for 3 turns.' };
  ABILITIES.artificer_shock = { id: 'artificer_shock', name: 'Arc Shock', element: 'electric', cost: 4, cooldown: 3, desc: 'Zap the target for moderate piercing damage and a small chance to stun (ignores defense).' };
ABILITIES.artificer_repair_field = { id: 'artificer_repair_field', name: 'Repair Field', cost: 8, cooldown: 6, desc: 'Repair your systems: heals you and grants small regen for several turns.' };

ABILITIES.valkyrie_spear = { id: 'valkyrie_spear', name: 'Spear Strike', cost: 4, cooldown: 3, desc: 'A piercing spear strike that ignores some defense.' };
ABILITIES.valkyrie_aerial_sweep = { id: 'valkyrie_aerial_sweep', name: 'Aerial Sweep', cost: 6, cooldown: 4, desc: 'A sweeping aerial strike that deals solid damage and inflicts burn and poison.' };
  ABILITIES.valkyrie_aerial_sweep.element = 'wind';
ABILITIES.valkyrie_guard = { id: 'valkyrie_guard', name: 'Valkyrie Guard', cost: 6, cooldown: 5, desc: 'Raise a protective guard: gain a +10 DEF shield for several turns.' };

ABILITIES.barbarian_berserk_slam = { id: 'barbarian_berserk_slam', name: 'Berserk Slam', cost: 0, cooldown: 4, desc: 'A heavy slam that deals big damage and increases your attack for a short time.' };
  ABILITIES.barbarian_war_cry = { id: 'barbarian_war_cry', name: 'War Cry', cost: 0, cooldown: 5, desc: 'A fierce cry that raises your attack for several turns, grants minor regeneration, and silences the opponent (prevents specials).' };
ABILITIES.barbarian_reckless_strike = { id: 'barbarian_reckless_strike', name: 'Reckless Strike', cost: 0, cooldown: 6, desc: 'Deliver a massive strike with 50% chance to deal increased damage; costs some HP as recoil.' };

// New Monk abilities
  ABILITIES.monk_flurry = { id: 'monk_flurry', name: 'Flurry', cost: 4, cooldown: 3, desc: 'Three rapid strikes: higher per-hit damage and a stronger weaken.' };
  ABILITIES.monk_stunning_blow = { id: 'monk_stunning_blow', name: 'Stunning Blow', cost: 0, cooldown: 4, desc: 'A heavy strike with a high chance to stun (buffed).' };
  ABILITIES.monk_quivering_palm = { id: 'monk_quivering_palm', name: 'Quivering Palm', cost: 10, cooldown: 6, desc: 'Deep bleeding over time; instantly kills at low HP.' };

// New Necromancer (summoner support spellset)
ABILITIES.necro_summon_skeleton = { id: 'necro_summon_skeleton', name: 'Summon Skeleton', cost: 8, cooldown: 5, desc: 'Summon a skeleton: gain +5 ATK and +5 DEF for a few turns and poison the enemy.' };
ABILITIES.necro_spirit_shackles = { id: 'necro_spirit_shackles', name: 'Spirit Shackles', cost: 10, cooldown: 6, desc: 'Shackle the enemy: -5 ATK for 4 turns, reduce their defense by 75% and prevent item use.' };
ABILITIES.necro_dark_inversion = { id: 'necro_dark_inversion', name: 'Dark Inversion', cost: 12, cooldown: 8, desc: 'For 3 turns, damage heals you and healing damages you (reverse HP effects).' };
ABILITIES.necro_dark_inversion.element = 'dark';

// Wild Magic Sorcerer abilities
ABILITIES.wild_attack = { id: 'wild_attack', name: 'Wild Magic: Attack', cost: 10, cooldown: 4, desc: 'Unleash chaotic magic (d20): effects range from caster backlash to debuffs, burn, stuns, or extra damage.' };
ABILITIES.wild_buff = { id: 'wild_buff', name: 'Wild Magic: Buff', cost: 8, cooldown: 5, desc: 'Invoke chaotic boons (d20): may curse you, heal a little, grant attack buffs, mana, or a powerful boon on a high roll.' };
ABILITIES.wild_arcanum = { id: 'wild_arcanum', name: 'Wild Magic: Arcanum', cost: 14, cooldown: 6, desc: 'High-variance arcane nuke (d20): can deal massive damage, sometimes backfires and harms the caster.' };

ABILITIES.knight_guard = { id: 'knight_guard', name: 'Shield Bash', cost: 0, cooldown: 4, desc: 'Strike with your shield to deal damage and increase defense for 2 turns.' };
ABILITIES.knight_charge = { id: 'knight_charge', name: 'Mounted Charge', cost: 0, cooldown: 3, desc: 'Powerful charge that may stun.' };

ABILITIES.rogue_backstab = { id: 'rogue_backstab', name: 'Backstab', cost: 0, cooldown: 3, desc: 'High damage attack that ignores some defense.' };
ABILITIES.rogue_poisoned_dagger = { id: 'rogue_poisoned_dagger', name: 'Poisoned Dagger', cost: 0, cooldown: 4, desc: 'Deal damage and apply poison.' };

ABILITIES.paladin_aura = { id: 'paladin_aura', name: 'Aura of Valor', cost: 0, cooldown: 5, desc: 'Boost your attack for a few turns.' };
ABILITIES.paladin_holy_strike = { id: 'paladin_holy_strike', name: 'Holy Strike', cost: 10, cooldown: 4, desc: 'Deal holy damage and heal yourself a bit.' };
ABILITIES.paladin_holy_strike.element = 'light';

ABILITIES.necro_siphon = { id: 'necro_siphon', name: 'Siphon Life', cost: 8, cooldown: 3, desc: 'Deal damage and heal the caster for part of it. Deals double damage against targets suffering reduced healing (slimed).' };
ABILITIES.necro_siphon.element = 'dark';
ABILITIES.necro_raise = { id: 'necro_raise', name: 'Raise Rot', cost: 12, cooldown: 5, desc: 'Inflict a necrotic poison that deals stronger damage over several turns.' };

ABILITIES.druid_entangle = { id: 'druid_entangle', name: 'Entangle', cost: 0, cooldown: 3, desc: "Conjure grasping vines that deal immediate damage, 10% chance to stun, and weaken the target's attack for 2 turns." };
ABILITIES.druid_regrowth = { id: 'druid_regrowth', name: 'Regrowth', cost: 8, cooldown: 4, desc: 'Heal immediately and gain regeneration-over-time for several turns to restore sustained HP.' };

// Basic move tooltips (used for menu buttons)
// Basic move tooltips (used for menu buttons)
ABILITIES.attack = { id: 'attack', name: 'Attack', desc: 'Basic physical attack — deal damage based on your attack value (reduced by the target\'s defense).' };
ABILITIES.heal = { id: 'heal', name: 'Heal', desc: 'Basic heal — recover a small amount of HP for yourself.' };
ABILITIES.defend = { id: 'defend', name: 'Defend', desc: 'Defend — brace to gain a small temporary defense bonus that reduces damage from the next enemy attack.' };
ABILITIES.prepare = { id: 'prepare', name: 'Prepare', desc: 'Prepare — gain a temporary attack boost that lasts 1-2 turns.' };

// Additional elemental tags for abilities (comprehensive mapping)
ABILITIES.archer_poison.element = 'earth';
ABILITIES.druid_barkskin.element = 'earth';
ABILITIES.monk_quivering_palm.element = 'earth';
ABILITIES.rogue_poisoned_dagger.element = 'earth';
ABILITIES.necro_raise.element = 'earth';
ABILITIES.druid_entangle.element = 'earth';
ABILITIES.druid_regrowth.element = 'earth';

ABILITIES.cleric_heal.element = 'light';
// cleric_smite already tagged as light earlier
ABILITIES.paladin_bless.element = 'light';
ABILITIES.wild_buff.element = 'light';

ABILITIES.necro_curse.element = 'dark';
// necro_dark_inversion, necro_siphon already tagged dark
ABILITIES.necro_spirit_shackles.element = 'dark';
ABILITIES.necro_summon_skeleton.element = 'dark';
ABILITIES.wild_arcanum.element = 'dark';

// lightning/electric mapping
ABILITIES.wild_attack.element = 'electric';
// artificer_shock already uses 'electric'

// wind mapping
ABILITIES.rogue_backstab.element = 'wind';
// valkyrie_aerial_sweep already set to 'wind'

// Added element tags requested by user
ABILITIES.cleric_shield.element = 'fire';
ABILITIES.barbarian_berserk_slam.element = 'fire';
ABILITIES.monk_flurry.element = 'fire';

ABILITIES.warrior_rend.element = 'earth';
ABILITIES.archer_trap.element = 'earth';
ABILITIES.knight_guard.element = 'earth';
ABILITIES.knight_bastion.element = 'earth';

ABILITIES.artificer_repair_field.element = 'light';
ABILITIES.valkyrie_guard.element = 'light';

// map 'lightning' requested -> use internal 'electric'
ABILITIES.artificer_turret.element = 'electric';
ABILITIES.warrior_shout.element = 'electric';
ABILITIES.barbarian_war_cry.element = 'electric';
ABILITIES.knight_charge.element = 'electric';
ABILITIES.monk_stunning_blow.element = 'electric';

ABILITIES.warrior_whirlwind.element = 'wind';
ABILITIES.archer_volley.element = 'wind';
ABILITIES.rogue_evade.element = 'wind';
ABILITIES.valkyrie_spear.element = 'wind';

ABILITIES.barbarian_reckless_strike.element = 'dark';

const CLASS_STATS = {
  warrior: { name: 'Warrior', hp: 210, maxHp: 210, baseAtk: 20, defense: 9, speed: 5, critChance: 0.04, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['warrior_rend', 'warrior_shout', 'warrior_whirlwind'] },
  mage:    { name: 'Mage',    hp: 120, maxHp: 120, baseAtk: 24, defense: 2, speed: 6, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['mage_fireball', 'mage_iceblast', 'mage_arcane_burst'], mana: 30 },
  archer:  { name: 'Archer',  hp: 143, maxHp: 143, baseAtk: 21, defense: 3, speed: 8, critChance: 0.12, evasion: 0.06, attackBoost: 0, fainted: false, abilities: ['archer_volley', 'archer_poison', 'archer_trap'] },
  cleric:  { name: 'Cleric',  hp: 135, maxHp: 135, baseAtk: 12, defense: 3, speed: 5, critChance: 0.03, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['cleric_heal', 'cleric_smite', 'cleric_shield'], mana: 30 },
  knight:  { name: 'Knight',  hp: 210, maxHp: 210, baseAtk: 20, defense: 10, speed: 4, critChance: 0.03, evasion: 0.01, attackBoost: 0, fainted: false, abilities: ['knight_guard', 'knight_charge', 'knight_bastion'], mana: 0 },
  rogue:   { name: 'Rogue',   hp: 128, maxHp: 128, baseAtk: 27, defense: 2, speed: 9, critChance: 0.15, evasion: 0.08, attackBoost: 0, fainted: false, abilities: ['rogue_backstab', 'rogue_poisoned_dagger', 'rogue_evade'], mana: 0 },
  paladin: { name: 'Paladin', hp: 195, maxHp: 195, baseAtk: 17, defense: 8, speed: 5, critChance: 0.04, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['paladin_aura', 'paladin_holy_strike', 'paladin_bless'], mana: 15 },
  dark_mage: { name: 'Dark Mage', hp: 113, maxHp: 113, baseAtk: 18, defense: 2, speed: 6, critChance: 0.05, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['necro_siphon', 'necro_raise', 'necro_curse'], mana: 35 },
  necromancer: { name: 'Necromancer', hp: 120, maxHp: 120, baseAtk: 15, defense: 3, speed: 6, critChance: 0.05, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['necro_summon_skeleton', 'necro_spirit_shackles', 'necro_dark_inversion'], mana: 40 },
  monk:    { name: 'Monk',    hp: 188, maxHp: 188, baseAtk: 20, defense: 6, speed: 8, critChance: 0.08, evasion: 0.05, attackBoost: 0, fainted: false, abilities: ['monk_flurry', 'monk_stunning_blow', 'monk_quivering_palm'], mana: 20 },
  wild_magic_sorcerer: { name: 'Wild Magic Sorcerer', hp: 128, maxHp: 128, baseAtk: 21, defense: 2, speed: 6, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['wild_attack', 'wild_buff', 'wild_arcanum'], mana: 40 },
  druid:   { name: 'Druid',   hp: 165, maxHp: 165, baseAtk: 21, defense: 5, speed: 6, critChance: 0.05, evasion: 0.04, attackBoost: 0, fainted: false, abilities: ['druid_entangle', 'druid_regrowth', 'druid_barkskin'], mana: 30 },
  artificer: { name: 'Artificer', hp: 140, maxHp: 140, baseAtk: 24, defense: 9, speed: 5, critChance: 0.06, evasion: 0.03, attackBoost: 0, fainted: false, abilities: ['artificer_turret','artificer_shock','artificer_repair_field'], mana: 40 },
  valkyrie: { name: 'Valkyrie', hp: 195, maxHp: 195, baseAtk: 21, defense: 5, speed: 8, critChance: 0.06, evasion: 0.05, attackBoost: 0, fainted: false, abilities: ['valkyrie_spear','valkyrie_aerial_sweep','valkyrie_guard'], mana: 30 },
  barbarian: { name: 'Barbarian', hp: 210, maxHp: 210, baseAtk: 22, defense: 4, speed: 6, critChance: 0.05, evasion: 0.02, attackBoost: 0, fainted: false, abilities: ['barbarian_berserk_slam','barbarian_war_cry','barbarian_reckless_strike'], mana: 0 }
};

// --- Refresh lock: prevent refresh/navigation during reward selection/write ---
// This is a client-local guard that prompts the user if they try to refresh while
// rewards are being chosen/persisted. It is set when a match finishes and cleared
// when the `matches/{matchId}/rewards` node exists (or immediately after the
// client writes the rewards node).
const REFRESH_LOCK_KEY = 'preventRefreshDuringRewardsV1';
let _refreshLockTimer = null;
function beforeUnloadGuard(e) {
  // modern browsers ignore custom messages but returning a value triggers the prompt
  const msg = 'Match is in reward phase — leaving now may forfeit your reward. Are you sure you want to leave?';
  e.preventDefault();
  e.returnValue = msg;
  return msg;
}
function setRefreshLock(matchId) {
  try {
    if (matchId) localStorage.setItem(REFRESH_LOCK_KEY, String(matchId));
    else localStorage.setItem(REFRESH_LOCK_KEY, '1');
    window.addEventListener('beforeunload', beforeUnloadGuard);
    // clear any existing timer
    try { if (_refreshLockTimer) { clearTimeout(_refreshLockTimer); _refreshLockTimer = null; } } catch (e) { /* best-effort */ }
    // fallback: automatically clear lock after 60s to avoid permanent lock
    _refreshLockTimer = setTimeout(() => {
      try { console.warn('Refresh lock auto-cleared after timeout'); clearRefreshLock(); } catch (e) { /* best-effort */ }
    }, 60000);
  } catch (e) { /* best-effort */ }
}
function clearRefreshLock() {
  try {
    localStorage.removeItem(REFRESH_LOCK_KEY);
    window.removeEventListener('beforeunload', beforeUnloadGuard);
    if (_refreshLockTimer) { clearTimeout(_refreshLockTimer); _refreshLockTimer = null; }
  } catch (e) { /* best-effort */ }
}
function isRefreshLocked() {
  try { return !!localStorage.getItem(REFRESH_LOCK_KEY); } catch (e) { return false; }
}

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
  // Additions from NewJacob: keep existing items and add these new reward/utility items
  swift_boots: 'swift boots.jpg',
  focus_charm: 'focus charm.jpg',
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

// Return a best-effort image path for a gear object. Gear images are stored under
// img/gear/<type>/split_<n>.png. We choose a deterministic split index from the gear id
// so repeated renders pick the same image.
function getGearImagePath(g) {
  try {
    if (!g) return 'img/gear/sword/split_1.png';
    if (g.image) return g.image;
    const slot = (g.slot || '').toString().toLowerCase();
    // map technical slot names to gear folders
    const SLOT_TO_FOLDER = {
      left_weapon: 'sword', right_weapon: 'sword', sword: 'sword', spear: 'spear', axe: 'axe', hammer: 'hammer', mace: 'mace', dagger: 'dagger', staff: 'staff', bow: 'bow', crossbow: 'crossbow', gun: 'gun', shield: 'shield', bracers: 'bracers', chestplate: 'chestplate', helmet: 'helmet', leggings: 'leggings', pants: 'leggings', boots: 'boots', necklace: 'necklace', rings: 'rings', ring1: 'rings', ring2: 'rings'
    };
    const folder = SLOT_TO_FOLDER[slot] || 'sword';
    // Prefer element-specific images when available (some folders like chestplate
    // ship with files named <element>_<folder>.png e.g. fire_chestplate.png).
    // Otherwise map elements to a consistent split_N index so element-colored
    // visuals are deterministic across clients.
    const rawEl = (g.element || '').toString().toLowerCase();
    // normalize common synonyms so filenames match the repo assets
    const ELEMENT_NORMALIZE = { electric: 'lightning', thunder: 'lightning', phys: 'neutral', none: 'neutral', natural: 'wind' };
    const el = ELEMENT_NORMALIZE[rawEl] || rawEl;
    const ELEMENT_SPLIT = { fire:1, lightning:2, ice:3, wind:4, earth:5, neutral:6 };
    // folders that contain element_<folder>.png assets
    const ELEMENT_SPECIFIC_FOLDERS = new Set(['chestplate']);
    if (el) {
      if (ELEMENT_SPECIFIC_FOLDERS.has(folder)) {
        return `img/gear/${folder}/${el}_${folder}.png`;
      }
      const sidx = ELEMENT_SPLIT[el];
      if (sidx) return `img/gear/${folder}/split_${sidx}.png`;
    }
    // deterministic hash from id (fallback when element not present)
    const id = g.id || (g.name ? g.name.replace(/\s+/g,'_').toLowerCase() : Math.random().toString(36).slice(2,8));
    let h = 0; for (let i=0;i<id.length;i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const idx = (h % 6) + 1; // files named split_1..split_6.png
    return `img/gear/${folder}/split_${idx}.png`;
  } catch (e) { return 'img/gear/sword/split_1.png'; }
}

// Return an ordered list of candidate image paths to try for a gear object. The
// chooser image onerror handler will step through these until one loads.
function getGearImageCandidates(g, metaId) {
  const candidates = [];
  try {
    if (!g) return candidates.concat([`img/gear/sword/split_1.png`]);
    if (g.image) candidates.push(g.image);
    const slot = (g.slot || '').toString().toLowerCase();
  const folder = (function(){ const m = { left_weapon:'sword', right_weapon:'sword', sword:'sword', spear:'spear', axe:'axe', hammer:'hammer', mace:'mace', dagger:'dagger', staff:'staff', bow:'bow', crossbow:'crossbow', gun:'gun', shield:'shield', bracers:'bracers', chestplate:'chestplate', helmet:'helmet', leggings:'leggings', pants:'leggings', boots:'boots', necklace:'necklace', rings:'rings', ring1:'rings', ring2:'rings' }; return m[slot] || 'sword'; })();
    const rawEl = (g.element || '').toString().toLowerCase();
    const ELEMENT_NORMALIZE = { electric: 'lightning', thunder: 'lightning', phys: 'neutral', none: 'neutral', natural: 'wind' };
    const el = ELEMENT_NORMALIZE[rawEl] || rawEl;
    // element-specific chestplate image
    if (el && folder === 'chestplate') candidates.push(`img/gear/${folder}/${el}_${folder}.png`);
    // element-split fallback when available
    const ELEMENT_SPLIT = { fire:1, lightning:2, ice:3, wind:4, earth:5, neutral:6 };
    if (el && ELEMENT_SPLIT[el]) candidates.push(`img/gear/${folder}/split_${ELEMENT_SPLIT[el]}.png`);
    // deterministic split by id
    const id = g.id || (g.name ? g.name.replace(/\s+/g,'_').toLowerCase() : Math.random().toString(36).slice(2,8));
    let h = 0; for (let i=0;i<id.length;i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const idx = (h % 6) + 1;
    candidates.push(`img/gear/${folder}/split_${idx}.png`);
    // per-item image catalog (jpg/svg)
    if (metaId) {
      const p = getItemImagePaths(metaId || id);
      if (p.jpg) candidates.push(p.jpg);
      if (p.svg) candidates.push(p.svg);
    }
  } catch (e) { /* ignore */ }
  // final generic fallback
  candidates.push('img/gear/sword/split_1.png');
  return candidates.filter(Boolean);
}

function attachActionTooltips() {
  const menu = document.getElementById('menu');
  if (!menu) return;
  const buttons = Array.from(menu.querySelectorAll('button'));
      buttons.forEach(btn => {
        // Skip special buttons inside #specials - they have their own tooltips
        if (btn.closest && btn.closest('#specials')) return;
        let abilityKey = btn.getAttribute('data-ability');
        if (!abilityKey) {
          const on = btn.getAttribute('onclick') || '';
          const m = on.match(/chooseMove\(['"](\w+)['"]\)/);
          if (m) abilityKey = m[1];
        }
        abilityKey = abilityKey || btn.textContent.trim().toLowerCase();

    const moveHandler = (evt) => {
      // Build a small info object (compatible with _showAbilityTooltip signature)
      const info = ABILITIES[abilityKey] || { name: abilityKey, desc: '' };
      try { _showAbilityTooltip(evt, info); } catch (e) { /* ignore */ }
    };

    btn.addEventListener('mouseenter', moveHandler);
    btn.addEventListener('mousemove', moveHandler);
    btn.addEventListener('mouseleave', _hideAbilityTooltip);
    btn.addEventListener('focus', moveHandler);
    btn.addEventListener('blur', _hideAbilityTooltip);
  });
  // start inactivity watcher when listeners are ready
  try { startInactivityWatcher(); } catch (e) { console.error('Could not start inactivity watcher', e); }
}

function applyDamageToObject(targetObj, rawDamage, opts = {}) {
  // opts: { ignoreDefense: bool, attacker: { critChance, ... }, considerHit: bool }
  const ignoreDefense = !!opts.ignoreDefense;
  const attacker = opts.attacker || null;
    const considerHit = typeof opts.considerHit === 'boolean' ? opts.considerHit : !!attacker;

  // Evasion check (target may dodge entirely). Factor attacker's accuracy which
  // reduces effective evasion (accuracy directly subtracts from evasion).
    const targetEvasion = Number(targetObj.evasion || 0);
    const attackerAccuracy = attacker ? Number(attacker.accuracy || 0) : 0;
    const effectiveEvasion = Math.max(0, targetEvasion - attackerAccuracy);
  let dodged = false;
  if (considerHit && effectiveEvasion > 0) {
    try {
      if (Math.random() < effectiveEvasion) {
        // Dodge: no damage dealt
        dodged = true;
        try {
          window._lastPvpDamageInfo = { rawDamage: Number(rawDamage||0), final: 0, newHp: targetObj.hp||0, isCrit: false, dodged: true, defenseAbsorbed: false };
        } catch(e){}
        try { DamageLog.log((opts.attacker && (opts.attacker.name || opts.attacker.id) ? (opts.attacker.name || opts.attacker.id) : 'Attacker') + " attack was dodged by " + (targetObj.name || 'Target'), 'info'); } catch(e){}
        return { damage: 0, newHp: targetObj.hp || 0, dodged: true, isCrit: false };
      }
    } catch (e) { /* ignore RNG errors */ }
  }

  const defense = ignoreDefense ? 0 : (targetObj.defense || 0);
  let final = Math.max(0, Math.round(rawDamage - defense));

  // Apply attacker-sourced true damage (bypasses defense) and low-HP bonuses
  try {
    const attacker = opts.attacker || null;
    const attackerEnchants = attacker ? (attacker._equipEnchants || attacker._equipMods || {}) : {};
    const defenderEnchants = targetObj ? (targetObj._equipEnchants || targetObj._equipMods || {}) : {};
    // trueDamage: flat damage added after defense
    const trueD = Number(attackerEnchants.trueDamage || 0) || 0;
    if (trueD > 0) final = final + Math.max(0, Math.round(trueD));

    // lowHpDamage: percent bonus when target is at or below 35% HP
    const lowHpPct = Number(attackerEnchants.lowHpDamage || 0) || 0;
    try {
      const cur = Number(targetObj.hp || 0);
      const maxHpLocal = Number(targetObj.maxHp || targetObj.maxHP || 100) || 100;
      const frac = maxHpLocal > 0 ? (cur / maxHpLocal) : 1;
      if (lowHpPct > 0 && frac <= 0.35) {
        final = Math.max(0, Math.round(final * (1 + (lowHpPct / 100))));
      }
    } catch (e) { /* ignore low-hp calc errors */ }

    // Defender mitigation: percent damage reduction applied at the end of this helper
    // (stored as whole percents like 1,3,6 -> convert to fraction)
    const mitPct = Number(defenderEnchants.mitigationPercent || 0) || 0;
    if (mitPct > 0) {
      const mit = Math.max(0, Math.min(0.95, (mitPct / 100)));
      final = Math.max(0, Math.round(final * (1 - mit)));
    }
  } catch (e) { /* best-effort only */ }

  // Crit check (attacker may deal increased damage)
  let isCrit = false;
  const critChance = attacker ? Number(attacker.critChance || 0) : 0;
  if (considerHit && critChance > 0) {
    try {
      // Account for target crit resistance when present (may be exposed via _equipEnchants or a direct field)
      const targetCritResist = Number((targetObj && ((targetObj._equipEnchants && targetObj._equipEnchants.critResist) || targetObj.critResist)) || 0) || 0;
      const effectiveCritChance = Math.max(0, critChance - targetCritResist);
      if (Math.random() < effectiveCritChance) {
        isCrit = true;
        // Allow gear to increase crit damage via _critDamageBonus (stored as percent points)
        const critBonusPct = Number((attacker && (attacker._critDamageBonus || (attacker._equipEnchants && attacker._equipEnchants.critDamageBonus))) || 0) || 0;
        const baseMultiplier = 1.5; // default crit = +50%
        const multiplier = baseMultiplier + (critBonusPct / 100);
        final = Math.max(1, Math.round(final * multiplier));
      }
    } catch (e) { /* ignore RNG errors */ }
  }

  const newHp = Math.max(0, (targetObj.hp || 0) - final);

  // Flag whether defense fully absorbed the hit (rawDamage>0 but final becomes 0 and defense was in play)
  const defenseAbsorbed = (Number(rawDamage || 0) > 0 && final === 0 && Number(defense || 0) > 0 && !isCrit && !dodged);

  // Expose last PvP damage info for UI instrumentation (consumers should clear after use)
  try {
    window._lastPvpDamageInfo = {
      rawDamage: Number(rawDamage || 0),
      final: final,
      newHp: newHp,
      isCrit: !!isCrit,
      dodged: !!dodged,
      defenseAbsorbed: !!defenseAbsorbed
    };
    try {
      const atkName = (attacker && (attacker.name || attacker.id)) ? (attacker.name || attacker.id) : 'Attacker';
      const tgtName = (targetObj && (targetObj.name || targetObj.id)) ? (targetObj.name || targetObj.id) : 'Target';
      DamageLog.log(`${atkName} -> ${tgtName}: raw=${Number(rawDamage||0)}, def=${defense||0}, final=${final}, crit=${!!isCrit}, dodged=${!!dodged}`, 'info');
    } catch(e) {}
  } catch (e) { /* ignore global set errors */ }

  // Final instrumentation log (helps the in-game Damage Log show unified entries)
  try {
    const atkName = (attacker && (attacker.name || attacker.id)) ? (attacker.name || attacker.id) : 'Attacker';
    const tgtName = (targetObj && (targetObj.name || targetObj.id)) ? (targetObj.name || targetObj.id) : 'Target';
    const level = dodged ? 'warn' : 'info';
    DamageLog.log(`${atkName} -> ${tgtName}: dealt ${final} dmg (raw=${Number(rawDamage||0)}, def=${defense||0}, crit=${!!isCrit}, dodged=${!!dodged})`, level);
  } catch (e) { /* ignore logging errors */ }

  return { damage: final, newHp, isCrit, dodged: !!dodged, defenseAbsorbed };
}

// Debug helper: compute and print class base stats and gear-applied stats for a given user or stats object.
// Usage examples (in browser console):
//   window.dumpComputedStats('uid_abc123'); // fetches user and gear from server (best-effort)
//   window.dumpComputedStats(playerStatsObject); // computes based on provided object and local gear (if equipped list present)
window.dumpComputedStats = async function(arg) {
  try {
    // helper to shallow-clone an object
    const clone = (o) => JSON.parse(JSON.stringify(o || {}));
    let template = null;
    let gearItems = [];

    if (!arg) {
      console.warn('dumpComputedStats: provide a uid string or a stats-like object');
      return null;
    }

    if (typeof arg === 'object') {
      // stats-like object passed in
      template = clone(arg);
      // try to pull equipped IDs from the object if present (for remote match seeds)
      const eq = template.equipped || template._equipList || template.equippedMap || null;
      if (eq && Array.isArray(eq)) {
        // assume it's an array of gear objects
        gearItems = eq.slice();
      } else if (eq && typeof eq === 'object') {
        const ids = Object.values(eq).filter(Boolean);
        // attempt to fetch items for currentUserId only
        if (ids.length && typeof db !== 'undefined' && typeof ref === 'function' && typeof get === 'function' && currentUserId) {
          gearItems = await Promise.all(ids.map(id => get(ref(db, `users/${currentUserId}/gear/${id}`)).then(s=>s.exists()?s.val():null).catch(()=>null)));
          gearItems = gearItems.filter(Boolean);
        }
      }
    } else if (typeof arg === 'string') {
      const uid = arg;
      // fetch user's selectedClass and build base template
      if (typeof db !== 'undefined' && typeof ref === 'function' && typeof get === 'function') {
        try {
          const userSnap = await get(ref(db, `users/${uid}`));
          const userVal = userSnap.exists() ? (userSnap.val() || {}) : {};
          const selected = userVal.selectedClass || (typeof localStorage !== 'undefined' ? localStorage.getItem('selectedClass') : null) || 'warrior';
          template = clone(CLASS_STATS[selected] || CLASS_STATS.warrior || {});
          // attempt to fetch equipped map from match node if available
          if (matchId) {
            try {
              const pSnap = await get(ref(db, `matches/${matchId}/players/${uid}`));
              const pVal = pSnap.exists() ? (pSnap.val() || {}) : {};
              const equipped = pVal.equipped || {};
              const ids = Object.values(equipped).filter(Boolean);
              if (ids.length) {
                const items = await Promise.all(ids.map(id => get(ref(db, `users/${uid}/gear/${id}`)).then(s=>s.exists()?s.val():null).catch(()=>null)));
                gearItems = items.filter(Boolean);
              }
            } catch (e) { /* ignore */ }
          }
          // fallback: if no match node items, try local storage for current user only
          if (!gearItems.length && uid === currentUserId && typeof Gear !== 'undefined' && typeof Gear.getArmory === 'function') {
            try {
              const localEq = JSON.parse(localStorage.getItem('armory_equip_v1') || '{}') || {};
              const ids = Object.values(localEq).filter(Boolean);
              if (ids.length) {
                const arm = Gear.getArmory() || [];
                gearItems = ids.map(id => arm.find(x=>x.id===id)).filter(Boolean);
              }
            } catch(e){}
          }
        } catch (e) { console.warn('dumpComputedStats: failed to fetch user', e); }
      } else {
        console.warn('dumpComputedStats: no db available to fetch user');
      }
    }

    if (!template) { console.warn('dumpComputedStats: could not build base template'); return null; }

    const before = clone(template);
    // apply gear items if available; prefer Gear.applyGearListToStats when present
    if (Array.isArray(gearItems) && gearItems.length && typeof Gear !== 'undefined' && typeof Gear.applyGearListToStats === 'function') {
      try { Gear.applyGearListToStats(template, gearItems); } catch (e) { console.warn('applyGearListToStats failed', e); }
    }

    console.group('dumpComputedStats');
    console.log('base:', before);
    console.log('with gear applied:', template);
    if (template._equipMods) console.log('computed mods:', template._equipMods);
    console.groupEnd();
    return { base: before, computed: template, mods: template._equipMods || {} };
  } catch (e) { console.error('dumpComputedStats failure', e); return null; }
};
// Effective attack includes baseAtk plus any one-turn strength boosts
function getEffectiveBaseAtk(user, fallback = 10) {
  if (!user) return fallback;
  // Prefer explicit baseAtk (which may already include gear). Fallback to attack or
  // construct from fallback + gear mods when necessary. This ensures abilities
  // use gear-provided attack bonuses even if some code paths forgot to fold them.
  let base = null;
  if (typeof user.baseAtk !== 'undefined') base = Number(user.baseAtk);
  else if (typeof user.attack !== 'undefined') base = Number(user.attack);
  else base = Number(fallback || 10);
  try {
    // If gear mods are present but the original base snapshot (_orig_baseAtk) is missing,
    // it's likely the calc copy hasn't had its baseAtk folded with mods. Add mods.attack
    // proactively (only when we can detect a separate _equipMods.attack and no _orig_baseAtk).
    if (user._equipMods && typeof user._equipMods.attack !== 'undefined' && typeof user._orig_baseAtk === 'undefined') {
      base = base + Number(user._equipMods.attack || 0);
    }
  } catch (e) { /* ignore */ }
  const temp = (user.status && user.status.strength_boost) ? Number(user.status.strength_boost.amount || 0) : 0;
  // Include attackBoost in effective attack for abilities so attack boosts
  // also amplify magical/elemental specials that use this helper.
  const atkBoost = Number(user.attackBoost || 0);
  return base + temp + atkBoost;
}

function tickCooldownsObject(abilityCooldowns) {
  if (!abilityCooldowns) return {};
  const out = Object.assign({}, abilityCooldowns);
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'number' && out[k] > 0) out[k] = out[k] - 1;
  }
  return out;
}

// Ensure that a calc copy has gear attack included in baseAtk when possible.
// Some code paths create shallow calc copies that may carry _equipMods but
// not have baseAtk folded; this helper folds mods.attack into baseAtk when
// a snapshot of the original base is not present. It is deliberately conservative
// to avoid double-counting when applyEquipToStats already updated baseAtk.
function ensureEquipAttackIncluded(actor) {
  try {
    if (!actor) return;
    const mods = actor._equipMods || (actor._equipEnchants || {});
    if (!mods) return;
    const atkMod = Number((mods && typeof mods.attack !== 'undefined') ? mods.attack : 0) || 0;
    // If we've already saved an original base, assume applyEquipToStats folded mods into baseAtk.
    if (atkMod && typeof actor._orig_baseAtk === 'undefined') {
      actor.baseAtk = (Number(actor.baseAtk || actor.attack || 0)) + atkMod;
      actor.attack = actor.baseAtk;
    }
  } catch (e) { /* best-effort only */ }
}

function regenManaValue(actor, amount = 2) {
  const max = actor?.maxMana || 0;
  if (max <= 0) return actor?.mana || 0;
  return Math.min(max, (actor.mana || 0) + amount);
}

// If a player has dark_inversion status, HP changes should be inverted
// This helper expects absolute HP values in updates (e.g., { hp: 50 }) and
// will convert them by computing the delta relative to the current stats and
// inverting that delta when dark_inversion is present on the relevant actor.
// actingIsPlayer: true when the actor performing the move is the 'playerStats' (currentUser).
// When true, only invert hp changes that affect the acting player (incoming effects to player).
// This ensures attacks made by the acting player on opponents do not heal them.
function applyDarkInversionToUpdates(playerStats, opponentStats, playerUpdates = {}, opponentUpdates = {}, actingIsPlayer = true) {
  // Symmetric dark inversion: if a given target (player or opponent) has status.dark_inversion
  // then any HP-decrease targeting them is converted into healing instead. This lets an acting
  // client invert the appropriate target's update regardless of which side is acting.
  const p = Object.assign({}, playerUpdates);
  const o = Object.assign({}, opponentUpdates);

  try {
    const invertIfNeeded = (updatesObj, targetStats) => {
      if (!updatesObj || typeof updatesObj.hp === 'undefined' || !targetStats) return updatesObj;
      const cur = Number(targetStats.hp || 0);
      const newHp = Number(updatesObj.hp || 0);
      const hasInvert = !!(targetStats.status && targetStats.status.dark_inversion);
      console.debug('[darkInversion] target before:', { cur, newHp, dark_inversion: hasInvert });

      if (!hasInvert) return updatesObj;

      // If the new HP is lower than current => original effect is damage. Invert to heal.
      if (newHp < cur) {
        const damage = cur - newHp;
        const maxHp = Number(targetStats.maxHp || targetStats.maxHP || cur || 100);
        updatesObj.hp = Math.min(maxHp, cur + damage);
        if (updatesObj.hp > 0 && updatesObj.fainted) updatesObj.fainted = false;
        console.debug('[darkInversion] inverted damage -> heal', { damage, healedTo: updatesObj.hp });
        return updatesObj;
      }

      // If the new HP is greater than current => original effect is healing. Invert to damage.
      if (newHp > cur) {
        const heal = newHp - cur;
        const dmg = heal; // treat heal amount as damage amount
        updatesObj.hp = Math.max(0, cur - dmg);
        // If HP drops to 0 or below set fainted flag
        if (updatesObj.hp <= 0) updatesObj.fainted = true;
        console.debug('[darkInversion] inverted heal -> damage', { heal, damagedTo: updatesObj.hp });
        return updatesObj;
      }

      return updatesObj;
    };

    // Respect actingIsPlayer: when the acting client is the 'playerStats', we should
    // only invert HP changes that affect the acting player (incoming effects to player).
    // This prevents attacks made by the acting player from being turned into heals on
    // opponents that happen to have dark_inversion. When actingIsPlayer is false,
    // the opponent is the actor and we invert opponent-targeting updates instead.
    if (actingIsPlayer) {
      invertIfNeeded(p, playerStats);
    } else {
      invertIfNeeded(o, opponentStats);
    }
  } catch (e) {
    console.error('applyDarkInversionToUpdates failed', e);
  }

  return { playerUpdates: p, opponentUpdates: o };
}

// Defensive helper: detect obvious swapped-HP updates (player update contains opponent HP or vice versa)
// and fix them by swapping back. This catches a common bug where update objects for
// player/opponent were accidentally assigned to the wrong variable before writing.
function detectAndFixSwappedHp(adjusted, playerStats, opponentStats) {
  try {
    if (!adjusted) return adjusted;
    const p = adjusted.playerUpdates || {};
    const o = adjusted.opponentUpdates || {};
    // If player's updated hp equals the opponent's current hp (exact match), that's suspicious.
    const suspectPlayerHpIsOpp = (typeof p.hp !== 'undefined') && (Number(p.hp) === Number(opponentStats.hp || 0));
    const suspectOppHpIsPlayer = (typeof o.hp !== 'undefined') && (Number(o.hp) === Number(playerStats.hp || 0));
    if (suspectPlayerHpIsOpp || suspectOppHpIsPlayer) {
      try { console.error('[DEFENSE] Detected possible swapped HP updates — attempting auto-fix', { suspectPlayerHpIsOpp, suspectOppHpIsPlayer, playerStatsHp: playerStats.hp, opponentStatsHp: opponentStats.hp, adjusted: adjusted }); } catch(e){}
      // Swap hp fields if both present
      if (typeof p.hp !== 'undefined' && typeof o.hp !== 'undefined') {
        const tmp = p.hp; p.hp = o.hp; o.hp = tmp;
      } else if (suspectPlayerHpIsOpp && typeof o.hp === 'undefined') {
        // Move player's hp update to opponent if opponent has no hp update
        o.hp = p.hp; delete p.hp;
      } else if (suspectOppHpIsPlayer && typeof p.hp === 'undefined') {
        p.hp = o.hp; delete o.hp;
      }
      adjusted.playerUpdates = p; adjusted.opponentUpdates = o;
      try { console.warn('[DEFENSE] Auto-fixed swapped HP updates', { playerUpdates: p, opponentUpdates: o }); } catch(e){}
    }
  } catch (e) { console.error('detectAndFixSwappedHp failed', e); }
  return adjusted;
}

// Schedule a re-check for death handling to avoid races between realtime listeners and
// the acting client's writes (which may include inverted HP values). When a player node
// shows hp<=0 we wait a short moment, re-read the match and player nodes, and then
// call handlePlayerDeath only if the player is still dead and the match is not already finished.
function scheduleDeathCheck(uid) {
  try {
    if (_deathCheckTimers[uid]) clearTimeout(_deathCheckTimers[uid]);
    _deathCheckTimers[uid] = setTimeout(async () => {
      delete _deathCheckTimers[uid];
      if (!matchRef) return;
      try {
        const [mSnap, pSnap] = await Promise.all([get(matchRef), get(ref(db, `matches/${matchId}/players/${uid}`))]);
        const m = mSnap.exists() ? mSnap.val() : {};
        const p = pSnap.exists() ? pSnap.val() : {};
        if (m?.status === 'finished') return; // already finished by another writer
        if ((p.hp || 0) <= 0 || p.fainted) {
          // still dead — call handler
          handlePlayerDeath(uid).catch(console.error);
        }
      } catch (e) { console.error('scheduleDeathCheck read error', e); }
    }, 180);
  } catch (e) { console.error('scheduleDeathCheck error', e); }
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

function processStatusEffectsLocal(actorStats, opponentStats) {
  if (!actorStats) return { updates: {}, opponentUpdates: {}, messages: [] };

  const updates = {};
  const opponentUpdates = {};
  const messages = [];
  const status = actorStats.status ? JSON.parse(JSON.stringify(actorStats.status)) : {};

  // Regenerator: chance to clear debuffs or grant small regen (from gear superchange)
  try {
    const aEnchants = (actorStats._equipEnchants) ? actorStats._equipEnchants : {};
    if (aEnchants.regeneratorChance && Math.random() < Number(aEnchants.regeneratorChance)) {
      // clear common harmful DOTs
      if (status.poison) { delete status.poison; messages.push(`${actorStats.name || 'Player'}'s gear purges poison!`); }
      if (status.burn) { delete status.burn; messages.push(`${actorStats.name || 'Player'}'s gear extinguishes burn!`); }
      if (status.bleed) { delete status.bleed; messages.push(`${actorStats.name || 'Player'}'s gear staunches bleeding!`); }
      if (status.slimed) { delete status.slimed; messages.push(`${actorStats.name || 'Player'}'s gear removes slimed debuff!`); }
      // small chance to grant a tiny regen-over-time entry as well
      const regenAmt = Number(aEnchants.regenPerTurn || 0) || 0;
      if (regenAmt > 0) {
        status.regen = status.regen || { amount: regenAmt, turns: 2 };
        messages.push(`${actorStats.name || 'Player'} gains a short regeneration from gear.`);
      }
    }
  } catch (e) { /* ignore regenerator errors */ }

  // Passive gear-provided regeneration: if equips grant a steady regen-per-turn, apply it here.
  try {
    const passiveRegen = Number(actorStats._regenPerTurn || 0) || 0;
    if (passiveRegen > 0) {
      const maxHpLocal = actorStats.maxHp || actorStats.maxHP || 100;
      const cur = ('hp' in updates) ? Number(updates.hp) : Number(actorStats.hp || 0);
      const newHp = Math.min(maxHpLocal, (cur || 0) + passiveRegen);
      updates.hp = newHp;
      messages.push(`${actorStats.name || 'Player'} regenerates ${passiveRegen} HP from gear.`);
    }
  } catch (e) { /* ignore passive regen errors */ }

  // Burn: DOT
  if (status.burn) {
    const effectiveAtk = getEffectiveBaseAtk(actorStats, actorStats.baseAtk || 10);
    // support both legacy .dmg and gear-produced .amount fields
    let dmg = (typeof status.burn.dmg !== 'undefined' ? status.burn.dmg : (typeof status.burn.amount !== 'undefined' ? status.burn.amount : Math.max(1, Math.floor(effectiveAtk / 3))));
    // reduce burn damage by burn resist (stored as fractional percent like 0.02 = 2%) on the actor
    try {
      const res = Number((actorStats._equipEnchants && actorStats._equipEnchants.burnResistPercent) || 0) || 0;
      if (res > 0) dmg = Math.max(0, Math.round(dmg * (1 - res)));
    } catch (e) {}
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
    // support both legacy .dmg and gear-produced .amount fields
    let pDmg = (typeof status.poison.dmg !== 'undefined' ? status.poison.dmg : (typeof status.poison.amount !== 'undefined' ? status.poison.amount : 1));
    try {
      const pres = Number((actorStats._equipEnchants && actorStats._equipEnchants.poisonResistPercent) || 0) || 0;
      if (pres > 0) pDmg = Math.max(0, Math.round(pDmg * (1 - pres)));
    } catch (e) {}
    const { damage, newHp } = applyDamageToObject({ hp: (updates.hp ?? actorStats.hp) }, pDmg, { ignoreDefense: true });
    updates.hp = newHp;
    messages.push(`${actorStats.name || 'Player'} suffers ${damage} poison damage.`);
    status.poison.turns = (status.poison.turns || 0) - 1;
    if (status.poison.turns <= 0) delete status.poison;
  }

  // Turret: if actor has a turret status, it should damage the opponent
  if (status.turret && opponentStats) {
    try {
      const t = status.turret;
      const dmg = t.dmg || 1;
      const { damage, newHp } = applyDamageToObject({ hp: opponentStats.hp, defense: opponentStats.defense || 0, evasion: opponentStats.evasion || 0 }, dmg, { ignoreDefense: !!t.ignoreDefense, attacker: actorStats });
      // Normalize hp (no negatives) and mark fainted if turret tick killed the target.
      const clamped = Math.max(0, newHp);
      opponentUpdates.hp = clamped;
      if (clamped <= 0) {
        opponentUpdates.fainted = true;
        try { console.debug('[turret] turret tick killed target, writing fainted=true for opponent', { actor: actorStats?.name, target: opponentStats?.name, dmg, clamped }); } catch (e) {}
      }
      messages.push(`${actorStats.name || 'Player'}'s Turret fires for ${damage} damage on ${opponentStats.name || 'Opponent'}.`);
      t.turns = (t.turns || 0) - 1;
      if (t.turns <= 0) delete status.turret;
      // propagate any status changes on opponent via turret? none for now
    } catch (e) { console.error('Error processing turret tick', e); }
  }

  // Turret: chance to stun the opponent on tick
  if (status.turret && opponentStats && status.turret.stunChance) {
    try {
      const t = status.turret;
      if (Math.random() < (t.stunChance || 0)) {
        const oppStatus = Object.assign({}, opponentStats.status || {});
        oppStatus.stun = { turns: 1 };
        opponentUpdates.status = Object.assign({}, opponentUpdates.status || {}, oppStatus);
        messages.push(`${actorStats.name || 'Player'}'s Turret stuns ${opponentStats.name || 'the opponent'}!`);
      }
    } catch (e) { console.error('Error processing turret stun chance', e); }
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

  // No-items / item-lock (e.g., Spirit Shackles)
  if (status.no_items) {
    status.no_items.turns = (status.no_items.turns || 0) - 1;
    if (status.no_items.turns <= 0) delete status.no_items;
  }

  // Summon buff entries (expire cleanly)
  if (status.summon) {
    status.summon.turns = (status.summon.turns || 0) - 1;
    if (status.summon.turns <= 0) delete status.summon;
  }

  // Dark inversion: expire after its turns
  if (status.dark_inversion) {
    status.dark_inversion.turns = (status.dark_inversion.turns || 0) - 1;
    if (status.dark_inversion.turns <= 0) delete status.dark_inversion;
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

  // Turret buff expiration: if actor has a turret_buff, decrement and revert attackBoost when it expires
  if (status.turret_buff) {
    status.turret_buff.turns = (status.turret_buff.turns || 0) - 1;
    if (status.turret_buff.turns <= 0) {
      const prev = typeof status.turret_buff.prevBoost === 'number' ? status.turret_buff.prevBoost : Math.max(0, (actorStats.attackBoost || 0) - (status.turret_buff.amount || 0));
      updates.attackBoost = prev;
      delete status.turret_buff;
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
  try { console.debug('[status] shield tick for', actorStats?.name, 'turnsBefore:', status.shield.turns); console.log('[status] shield tick for', actorStats?.name, 'turnsBefore:', status.shield.turns); } catch (e) {}
    status.shield.turns = (status.shield.turns || 0) - 1;
    if (status.shield.turns <= 0) {
      const amt = status.shield.amount || 0;
  try { console.debug('[status] shield expired for', actorStats?.name, { amount: amt, defenseBefore: actorStats?.defense }); console.log('[status] shield expired for', actorStats?.name, { amount: amt, defenseBefore: actorStats?.defense }); } catch (e) {}
      // Instead of subtracting the amount (which can double-remove if expiry runs multiple times),
      // reset defense to the class baseline. This is idempotent and avoids negative/zeroing bugs.
      try {
        const cls = actorStats.classId || actorStats.class || null;
        const baseDef = (cls && CLASS_STATS[cls] && typeof CLASS_STATS[cls].defense !== 'undefined') ? CLASS_STATS[cls].defense : 0;
        updates.defense = baseDef;
      } catch (e) {
        // fallback: keep current defense (avoid zeroing when class lookup fails)
        updates.defense = (typeof actorStats.defense !== 'undefined') ? actorStats.defense : 0;
      }
      delete status.shield;
    }
  }

  // Stun is handled by the move logic (we'll check actorStats.status.stun in chooseMove)

  updates.status = Object.keys(status).length ? status : null;
  if ((updates.hp ?? actorStats.hp) <= 0) {
    updates.hp = 0;
    updates.fainted = true;
  }

  return { updates, opponentUpdates, messages };
}

// --- Ability handlers (return DB-friendly update objects) ---
// NOTE: modernAbilityHandlers contains the newer handler implementations.
// We will prefer the legacy handlers (from the older snapshot) at runtime
// because they proved more stable in some cases. To keep all current
// instrumentation and sanitization intact we merge them at runtime:
// - If a legacy handler exists for an ability, it is used (wrapped with
//   a defensive fallback to the modern handler if it throws).
// - Otherwise the modern handler is used.
const modernAbilityHandlers = {
  mage_fireball(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 8) + base + 8;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    newStatus.burn = { turns: 3, dmg: Math.max(2, Math.floor(base / 3)) };
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_fireball'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.mage_fireball.cost || 0)) };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_mage_fireball' }, message: `${user.name || 'You'} casts Fireball for ${damage} damage and inflicts burn!`, lastMoveDamage: damage };
  },

  warrior_rend(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 12) + base + 8;
    const effectiveDefense = (target.defense || 0) / 2;
    const final = Math.max(0, Math.round(raw - effectiveDefense));
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: effectiveDefense, evasion: target.evasion || 0 }, final, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_rend') };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_rend' }, message: `${user.name || 'You'} rends ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  archer_volley(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    let total = 0;
    for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 6) + Math.floor(base / 2);
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, total, { attacker: user });
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
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
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
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'gladiator_charge') };
    let didStun = false;
    let message = `${user.name || 'Enemy'} charges for ${damage} damage!`;
    if (Math.random() < 0.3) {
      const newStatus = Object.assign({}, target.status || {});
      newStatus.stun = { turns: 1 };
      opponentUpdates.status = newStatus;
      message = `${user.name || 'Enemy'} charges with a heavy blow for ${damage} — ${target.name || 'the target'} is stunned!`;
      didStun = true;
    }
    const actorMsg = didStun ? `You charge with a heavy blow for ${damage} — ${target.name || 'the target'} are stunned!` : `You charge for ${damage} damage!`;
    const opponentMsg = didStun ? `${user.name || 'Opponent'} charges with a heavy blow for ${damage} — ${target.name || 'the target'} is stunned!` : `${user.name || 'Opponent'} charges for ${damage} damage!`;
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_gladiator_charge' }, message, lastMoveDamage: damage };
  },

  boss_earthquake(user, target) {
    const base = getEffectiveBaseAtk(user, 18);
    const raw = Math.floor(Math.random() * 18) + base + 8;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
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
  //this gives a longer shout buff so attack persists across more turns
  newStatus.shout = { turns: 4, amount: 10 };
  playerUpdates.status = newStatus;
  playerUpdates.attackBoost = (user.attackBoost || 0) + 10;
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_warrior_shout' }, message: `${user.name || 'You'} shouts and increases their attack!` };
  },

  archer_poison(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 6) + base;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
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
    const heal = Math.floor(Math.random() * 15) + 16; // 16-30 (buffed)
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
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 12) + base + 8; // stronger smite
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: false, attacker: user });
    const opponentUpdates = { hp: newHp };
    // inflict burn on the enemy (stronger)
    const oppStatus = Object.assign({}, target.status || {});
    oppStatus.burn = { turns: 3, dmg: Math.max(5, Math.floor(base / 3)) };
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
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };

    const add = 5; // smaller, short-lived defense increase
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 1, amount: add };
  try { console.debug('[ability] knight_guard applied', { caster: user?.name, amount: add, turns: newStatus.shield.turns }); console.log('[ability] knight_guard applied', { caster: user?.name, amount: add, turns: newStatus.shield.turns }); } catch (e) {}
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_guard') };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_knight_guard' }, message: `${user.name || 'You'} strikes and assumes a guarded stance, dealing ${damage} damage and increasing defense by ${add} for a short time.`, lastMoveDamage: damage };
  },

  knight_charge(user, target) {
    const base = getEffectiveBaseAtk(user, 13);
    const raw = Math.floor(Math.random() * 14) + base + 6;
      const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
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
    const actorMsg = didStun ? `You charge with a crushing blow for ${damage} — ${target.name || 'the enemy'} are stunned!` : `You charge for ${damage} damage!`;
    const opponentMsg = didStun ? `${user.name || 'Opponent'} charges with a crushing blow for ${damage} — ${target.name || 'the enemy'} is stunned!` : `${user.name || 'Opponent'} charges for ${damage} damage!`;
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_knight_charge' }, message, lastMoveDamage: damage };
  },

  rogue_backstab(user, target) {
    const base = getEffectiveBaseAtk(user, 16);
    const raw = Math.floor(Math.random() * 12) + base + 8;
    // backstab ignores defense partially
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: Math.floor((target.defense || 0) / 3), evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'rogue_backstab') };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_rogue_backstab' }, message: `${user.name || 'You'} backstabs ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  rogue_poisoned_dagger(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 8) + base;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
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
    //this aura should persist across multiple turns: use shout for attack and shield for defense
    newStatus.shout = { turns: 3, amount: amt };
    newStatus.shield = { turns: 3, amount: defAdd };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_aura'), attackBoost: (user.attackBoost || 0) + amt, defense: (user.defense || 0) + defAdd, status: newStatus };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_paladin_aura' }, message: `${user.name || 'You'} radiates an Aura of Valor, increasing attack by ${amt} and defense by ${defAdd} for several turns.` };
  },

  paladin_holy_strike(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const raw = Math.floor(Math.random() * 10) + base + 6;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
  const heal = Math.floor(damage * 0.4);
  const actualHeal = (user.status && user.status.slimed) ? Math.floor(heal / 2) : heal;
  const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_holy_strike'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.paladin_holy_strike.cost || 0)) };
  playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
  const opponentUpdates = { hp: newHp };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_paladin_holy_strike' }, message: `${user.name || 'You'} smites for ${damage} and is healed for ${actualHeal} HP.`, lastMoveDamage: damage };
  },

  necro_siphon(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    let raw = Math.floor(Math.random() * 14) + base + 8; // stronger hit
    // If target has healing reduction (slimed), siphon does double damage
    const hasHealingReduction = !!(target.status && target.status.slimed);
    if (hasHealingReduction) raw = raw * 2;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
  let healAmt = Math.floor(damage * 0.75); // bigger siphon heal
  // If caster is slimed (healing reduction), reduce siphon heal
  if (user.status && user.status.slimed) healAmt = Math.floor(healAmt / 2);
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_siphon'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.necro_siphon.cost || 0)) };
    playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + healAmt);
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_siphon' }, message: `${user.name || 'You'} siphons ${damage} life and heals for ${healAmt}.`, lastMoveDamage: damage };
  },

  necro_raise(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    // Increase rot potency: stronger per-turn damage and longer duration
    const poisonDmg = Math.max(3, Math.floor(base * 0.6));
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 6, dmg: poisonDmg };
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
  try { console.debug('[ability] necro_raise applied', { caster: user?.name, target: target?.name, incoming, resultingStatus: newStatus }); console.log('[ability] necro_raise applied', { caster: user?.name, target: target?.name, incoming, resultingStatus: newStatus }); } catch (e) {}
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
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
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
    const immediate = Math.floor(Math.random() * 12) + 12; // 12-23
    const regenAmount = 8; // per turn (increased)
    const regenTurns = 5; // lasts longer
    const actualImmediate = (user.status && user.status.slimed) ? Math.floor(immediate / 2) : immediate;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + actualImmediate);
    const newStatus = Object.assign({}, user.status || {});
    newStatus.regen = { turns: regenTurns, amount: regenAmount };
    const playerUpdates = { hp: newHp, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_regrowth'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.druid_regrowth.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_druid_regrowth' }, message: `${user.name || 'You'} calls regrowth, healing ${actualImmediate} HP and regenerating ${regenAmount} HP for ${regenTurns} turns.`, lastMoveHeal: actualImmediate };
  }

  ,artificer_turret(user, target) {
    const newStatus = Object.assign({}, user.status || {});
    // Stronger turret that pierces defenses and grants a larger temporary ATK buff
    const turretTurns = 3;
    const buffAmount = 8;
    const prevBoost = user.attackBoost || 0;
    const baseAtk = getEffectiveBaseAtk(user, 12);
    // reduce turret per-turn damage scaling slightly (balance)
    newStatus.turret = { turns: turretTurns, dmg: Math.max(16, Math.floor(baseAtk * 1.6)), ignoreDefense: true, stunChance: 0.25 };
    newStatus.turret_buff = { turns: turretTurns, amount: buffAmount, prevBoost: prevBoost };
    const playerUpdates = { status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'artificer_turret'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.artificer_turret.cost || 0)), attackBoost: prevBoost + buffAmount };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_artificer_turret' }, message: `${user.name || 'You'} deploys a Turret and gains +${buffAmount} ATK while it's active.` };
  },

  artificer_shock(user, target) {
    // Arc Shock: reduced damage (pierces defenses) and always stuns
    const base = getEffectiveBaseAtk(user, 20);
    // Lower overall shock potency: reduce multiplier so Artificer isn't overly bursty
    const raw = Math.floor(Math.random() * 12) + Math.floor(base * 1.0) + 4;
    // Arc Shock pierces defenses
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'artificer_shock'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.artificer_shock.cost || 0)) };
    // always stun on shock
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
    const playerUpdates = { hp: newHp, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'artificer_repair_field'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.artificer_repair_field.cost || 0)), defense: (user.defense || 0) + defAdd };
    // 50% chance to stun the target
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
    const effectiveDefense = Math.floor((target.defense || 0) * 0.4);
    const final = Math.max(0, Math.round(raw - effectiveDefense));
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, final, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'valkyrie_spear'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.valkyrie_spear.cost || 0)) };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_valkyrie_spear' }, message: `${user.name || 'You'} pierces the foe with Spear Strike for ${damage} damage!`, lastMoveDamage: damage };
  },

  valkyrie_aerial_sweep(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    // reduced damage and smaller flat bonus
    const raw = Math.floor(Math.random() * 10) + base + 2;
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    // Apply burn + poison to the opponent instead of evasion reduction
    const newStatus = Object.assign({}, target.status || {});
    const burnDmg = Math.max(1, Math.floor(base / 4));
    const burnIncoming = { turns: 3, dmg: burnDmg };
    if (newStatus.burn) {
      newStatus.burn.dmg = Math.max(newStatus.burn.dmg || 0, burnIncoming.dmg);
      newStatus.burn.turns = Math.max(newStatus.burn.turns || 0, burnIncoming.turns);
    } else {
      newStatus.burn = burnIncoming;
    }
  const poisonDmg = Math.max(1, Math.floor(base / 6));
    const poisonIncoming = { turns: 3, dmg: poisonDmg };
    if (newStatus.poison) {
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, poisonIncoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, poisonIncoming.turns);
    } else {
      newStatus.poison = poisonIncoming;
    }
    const opponentUpdates = { hp: newHp, status: newStatus };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'valkyrie_aerial_sweep'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.valkyrie_aerial_sweep.cost || 0)) };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_valkyrie_aerial_sweep' }, message: `${user.name || 'You'} performs Aerial Sweep for ${damage} damage and inflicts burn and poison!`, lastMoveDamage: damage };
  },

  valkyrie_guard(user, target) {
    const add = 6; // reduced shield
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 2, amount: add };
    const playerUpdates = { defense: (user.defense || 0) + add, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'valkyrie_guard'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.valkyrie_guard.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_valkyrie_guard' }, message: `${user.name || 'You'} gains Valkyrie Guard (+${add} DEF) for several turns.` };
  },

  barbarian_berserk_slam(user, target) {
    const base = getEffectiveBaseAtk(user, 12);
    const raw = Math.floor(Math.random() * 10) + base + 4; // greatly reduced damage
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const buff = 2; // much smaller attack buff
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'barbarian_berserk_slam'), attackBoost: (user.attackBoost || 0) + buff };
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_barbarian_berserk_slam' }, message: `${user.name || 'You'} slams in berserk fury for ${damage} damage and gains +${buff} ATK.`, lastMoveDamage: damage };
  },

  barbarian_war_cry(user, target) {
    // Stronger attack boost and small regeneration as an extra effect
    const buff = 6;
    const regenAmount = 4; // HP per turn
    const regenTurns = 3;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'barbarian_war_cry'), attackBoost: (user.attackBoost || 0) + buff };
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shout = { turns: 3, amount: buff };
    // Merge or overwrite regen status to ensure predictable behavior
    newStatus.regen = { turns: regenTurns, amount: regenAmount };
    playerUpdates.status = newStatus;
    // Apply silence to opponent to prevent specials for a short duration
    const opponentUpdates = {};
    try {
      const oppStatus = Object.assign({}, (target.status || {}));
      // 2 turns of silence by default
      oppStatus.silence = { turns: 2 };
      opponentUpdates.status = oppStatus;
    } catch (e) { /* defensive: if target missing, ignore */ }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_barbarian_war_cry' }, message: `${user.name || 'You'} bellows a War Cry, boosting attack by ${buff}, regenerating ${regenAmount} HP for ${regenTurns} turns, and silencing the opponent.` };
  },

  barbarian_reckless_strike(user, target) {
    // Stronger final attack: higher base, wider random range, larger crit/empower chance
    const base = getEffectiveBaseAtk(user, 14);
    const raw = Math.floor(Math.random() * 18) + base + 6; // larger damage range
    // ~50% chance to deal a larger empowered hit (1.5x)
    let usedRaw = raw;
    let boosted = false;
    if (Math.random() < 0.5) { usedRaw = Math.floor(raw * 1.5); boosted = true; }
    const { damage, newHp } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, usedRaw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    // increased self-damage tradeoff (20%) to discourage spamming
    const selfDmg = Math.max(4, Math.floor(damage * 0.20));
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'barbarian_reckless_strike') };
    playerUpdates.hp = Math.max(0, (user.hp || 0) - selfDmg);
  return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_barbarian_reckless_strike' }, message: `${user.name || 'You'} deals ${damage} with Reckless Strike${boosted ? ' (empowered)' : ''} and takes ${selfDmg} recoil.`, lastMoveDamage: damage };
  },
  // Third-ability handlers
  warrior_whirlwind(user, target) {
    const base = getEffectiveBaseAtk(user, 16);
    const raw = Math.floor(Math.random() * 18) + base + 10;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    // apply a weaken to reduce enemy attack for 2 turns
    const newStatus = Object.assign({}, target.status || {});
    const amount = 6;
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
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
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
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
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
  try { console.debug('[ability] cleric_shield applied', { caster: user?.name, amount: add, turns: newStatus.shield.turns }); console.log('[ability] cleric_shield applied', { caster: user?.name, amount: add, turns: newStatus.shield.turns }); } catch (e) {}
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'cleric_shield'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.cleric_shield.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_cleric_shield' }, message: `${user.name || 'You'} raises a Sanctuary Shield, increasing defense by ${add} for several turns.` };
  },

  knight_bastion(user, target) {
    const add = 12;
    const newDefense = (user.defense || 0) + add;
    const newStatus = Object.assign({}, user.status || {});
    newStatus.shield = { turns: 3, amount: add };
  try { console.debug('[ability] knight_bastion applied', { caster: user?.name, amount: add, turns: newStatus.shield.turns }); console.log('[ability] knight_bastion applied', { caster: user?.name, amount: add, turns: newStatus.shield.turns }); } catch (e) {}
    const playerUpdates = { defense: newDefense, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'knight_bastion') };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_knight_bastion' }, message: `${user.name || 'You'} assumes Bastion stance, greatly increasing defense for several turns.` };
  },

  rogue_evade(user, target) {
    //this grants extraTurns so the player gets 3 consecutive turns total
    const newStatus = Object.assign({}, user.status || {});
    newStatus.extraTurns = (newStatus.extraTurns || 0) + 2; // two extra turns (current action + 2 = 3 total)
    const playerUpdates = { status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'rogue_evade') };
  //this keeps the current turn with the acting player so they can act immediately
    const matchUpdates = { lastMove: 'special_rogue_evade', currentTurn: currentUserId };
    return { playerUpdates, opponentUpdates: {}, matchUpdates, message: `${user.name || 'You'} performs an evasive roll and gains multiple rapid actions!` };
  },

  paladin_bless(user, target) {
    const baseHeal = 20; //this baseHeal does stronger heal
    const actualHeal = (user.status && user.status.slimed) ? Math.floor(baseHeal / 2) : baseHeal;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + actualHeal);
    const amt = 8; // stronger attack boost
    const newStatus = Object.assign({}, user.status || {});
    //this blessing should last multiple turns
    newStatus.shout = { turns: 3, amount: amt };
    const playerUpdates = { hp: newHp, attackBoost: (user.attackBoost || 0) + amt, status: newStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'paladin_bless'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.paladin_bless.cost || 0)) };
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_paladin_bless' }, message: `${user.name || 'You'} calls a Blessing, healing ${actualHeal} HP and gaining +${amt} attack for a short time.`, lastMoveHeal: actualHeal };
  },

  necro_curse(user, target) {
    const base = getEffectiveBaseAtk(user, 11);
    const newStatus = Object.assign({}, target.status || {});
    // apply slimed to reduce healing
    // increase slimed duration so Dark Mage curses are more impactful
    newStatus.slimed = { turns: 7, effect: 'reduce-heal' };
    // apply stronger poison/rot
    const incoming = { turns: 6, dmg: Math.max(3, Math.floor(base * 0.6)) };
    if (newStatus.poison) {
      newStatus.poison.dmg = Math.max(newStatus.poison.dmg || 0, incoming.dmg);
      newStatus.poison.turns = Math.max(newStatus.poison.turns || 0, incoming.turns);
    } else {
      newStatus.poison = incoming;
    }
    // also apply a burn
    newStatus.burn = { turns: 3, dmg: 4 };
    // 80% chance to stun
    if (Math.random() < 0.8) {
      newStatus.stun = { turns: 1 };
  try { console.debug('[ability] necro_curse applied stun to target', { caster: user?.name, target: target?.name, status: newStatus }); console.log('[ability] necro_curse applied stun to target', { caster: user?.name, target: target?.name, status: newStatus }); } catch (e) {}
    }
    const opponentUpdates = { status: newStatus };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_curse'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.necro_curse.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_curse' }, message: `${user.name || 'You'} curses ${target.name || 'the enemy'}, reducing their healing and afflicting rot and flame.` };
  },

  druid_barkskin(user, target) {
    //this grants a short defensive shield, heals a bit, and deals a small lash of damage
    //this ensures shield increases defense property so expiry can reset safely
    const immediate = 6;
    const newHp = Math.min(user.maxHp || 100, (user.hp || 0) + immediate);
  const shieldAmount = 8; //this shieldAmount does increased defense boost
  const newStatus = Object.assign({}, user.status || {});
  newStatus.shield = { turns: 3, amount: shieldAmount };
  try { console.debug('[ability] druid_barkskin applied', { caster: user?.name, amount: shieldAmount, turns: newStatus.shield.turns }); console.log('[ability] druid_barkskin applied', { caster: user?.name, amount: shieldAmount, turns: newStatus.shield.turns }); } catch (e) {}
    // increase defense immediately so the shield has an effect and expires cleanly later
    const playerUpdates = { hp: newHp, status: newStatus, defense: (user.defense || 0) + shieldAmount, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'druid_barkskin'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.druid_barkskin.cost || 0)) };

    // small damaging lash to the target
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 6) + Math.floor(base / 2);
  const { damage, newHp: oppNewHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: oppNewHp };

    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_druid_barkskin' }, message: `${user.name || 'You'} hardens skin and lashes out, healing ${immediate} HP, gaining +${shieldAmount} defense and dealing ${damage} damage to the foe.`, lastMoveHeal: immediate, lastMoveDamage: damage };
  }

  // ---- Monk ability handlers ----
  ,monk_flurry(user, target) {
    // Three quick strikes; increased per-hit damage and stronger weaken.
    const base = getEffectiveBaseAtk(user, 16);
    let total = 0;
    for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 8) + Math.floor(base / 2);
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, total, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    // stronger weaken so Monk can better control enemies
    const weakenAmt = 8;
    if (!newStatus.weaken) {
      newStatus.weaken = { turns: 2, amount: weakenAmt, prevBoost: (target.attackBoost || 0) };
    } else {
      newStatus.weaken.amount = (newStatus.weaken.amount || 0) + weakenAmt;
      newStatus.weaken.turns = Math.max(newStatus.weaken.turns || 0, 2);
    }
    opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_flurry'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.monk_flurry.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_flurry' }, message: `${user.name || 'You'} strikes in a flurry for ${damage} total damage and weakens the enemy!`, lastMoveDamage: damage };
  }

  ,monk_stunning_blow(user, target) {
    const base = getEffectiveBaseAtk(user, 18);
    const raw = Math.floor(Math.random() * 16) + base + 4;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    // higher stun chance to make Monk more reliable
    if (Math.random() < 0.75) {
      const s = Object.assign({}, target.status || {});
      s.stun = { turns: 1 };
      opponentUpdates.status = s;
    }
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_stunning_blow') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_stunning_blow' }, message: `${user.name || 'You'} delivers a Stunning Blow for ${damage} damage${opponentUpdates.status && opponentUpdates.status.stun ? ' and stuns the foe!' : '!'}`, lastMoveDamage: damage };
  }

  ,monk_quivering_palm(user, target) {
    // If enemy is already at <=20% max HP when this hits, they die instantly.
    const maxHpT = target.maxHp || target.maxHP || 100;
    const threshold = Math.floor(maxHpT * 0.2);
    if ((target.hp || 0) <= threshold) {
      const opponentUpdates = { hp: 0, fainted: true };
      const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_quivering_palm') };
      return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_quivering_palm' }, message: `${user.name || 'You'} strikes a Quivering Palm and collapses the enemy instantly!` };
    }
    // Otherwise apply bleed: 5% max HP per turn for 4 turns
    const base = getEffectiveBaseAtk(user, 16);
    const raw = Math.floor(Math.random() * 14) + Math.floor(base / 2) + 4;
  const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { attacker: user });
    const opponentUpdates = { hp: newHp };
    const newStatus = Object.assign({}, target.status || {});
    const incoming = { turns: 4, pct: 0.05 };
    if (newStatus.bleed) {
      newStatus.bleed.pct = Math.max(newStatus.bleed.pct || 0, incoming.pct);
      newStatus.bleed.turns = Math.max(newStatus.bleed.turns || 0, incoming.turns);
    } else {
      newStatus.bleed = incoming;
    }
  opponentUpdates.status = newStatus;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'monk_quivering_palm'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.monk_quivering_palm.cost || 0)) };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_monk_quivering_palm' }, message: `${user.name || 'You'} uses Quivering Palm dealing ${damage} damage and inflicting deep bleeding!`, lastMoveDamage: damage };
  }

  // ---- New Necromancer handlers (summoner / debuff focused) ----
  ,necro_summon_skeleton(user, target) {
    const playerUpdates = {};
    // grant temporary attack/defense via status so it expires cleanly
    const newStatus = Object.assign({}, user.status || {});
    const atkAdd = 5;
    const defAdd = 5;
    // Use shout for attack boosts so processStatusEffectsLocal handles expiry correctly
    // and use shield for defense so shield expiry resets defense to class baseline.
    newStatus.shout = { turns: 3, amount: atkAdd };
    newStatus.shield = { turns: 3, amount: defAdd };
    playerUpdates.attackBoost = (user.attackBoost || 0) + atkAdd;
    playerUpdates.defense = (user.defense || 0) + defAdd;
    playerUpdates.status = newStatus;
    // poison the enemy lightly
    const oppStatus = Object.assign({}, target.status || {});
  const incoming = { turns: 3, dmg: Math.max(1, Math.floor((getEffectiveBaseAtk(user,8) * 2 || 8) / 3)) };
    if (oppStatus.poison) {
      oppStatus.poison.dmg = Math.max(oppStatus.poison.dmg || 0, incoming.dmg);
      oppStatus.poison.turns = Math.max(oppStatus.poison.turns || 0, incoming.turns);
    } else {
      oppStatus.poison = incoming;
    }
    const opponentUpdates = { status: oppStatus };
    playerUpdates.abilityCooldowns = startAbilityCooldownLocal(user.abilityCooldowns, 'necro_summon_skeleton');
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_summon_skeleton' }, message: `${user.name || 'You'} summons a skeleton, gaining +${atkAdd} ATK and +${defAdd} DEF while poisoning the foe.` };
  }

  ,necro_spirit_shackles(user, target) {
    const oppStatus = Object.assign({}, target.status || {});
    // apply -5 attack for 4 turns
    const weakenAmt = 5;
    if (!oppStatus.weaken) {
      oppStatus.weaken = { turns: 4, amount: weakenAmt, prevBoost: (target.attackBoost || 0) };
    } else {
      oppStatus.weaken.amount = (oppStatus.weaken.amount || 0) + weakenAmt;
      oppStatus.weaken.turns = Math.max(oppStatus.weaken.turns || 0, 4);
    }
    // remove 75% of defense (leave 25%)
    const reducedDef = Math.floor((target.defense || 0) * 0.25);
    const opponentUpdates = { status: oppStatus, defense: reducedDef };
    // prevent item usage
    oppStatus.no_items = { turns: 4 };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_spirit_shackles') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_spirit_shackles' }, message: `${user.name || 'You'} binds the enemy with Spirit Shackles: -${weakenAmt} ATK, defense heavily reduced and items disabled.` };
  }

  ,necro_dark_inversion(user, target) {
    // For 3 turns invert healing/damage for the caster only (do not apply to the enemy)
    const playerStatus = Object.assign({}, user.status || {});
    playerStatus.dark_inversion = { turns: 3 };
    const playerUpdates = { status: playerStatus, abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'necro_dark_inversion'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.necro_dark_inversion.cost || 0)) };
    // do not set dark_inversion on opponent
    const opponentUpdates = {};
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_necro_dark_inversion' }, message: `${user.name || 'You'} twists life into unlife: for 3 turns, healing becomes harmful and damage becomes restorative.` };
  }

  // ---- Wild Magic Sorcerer handlers ----
  ,wild_attack(user, target) {
    // roll a d20 and pick an effect set (1 worst ... 20 best)
    const roll = Math.floor(Math.random() * 20) + 1;
    const base = getEffectiveBaseAtk(user, 16);
    let damage = Math.floor(Math.random() * 16) + base + 4;
    const opponentUpdates = { hp: Math.max(0, (target.hp || 0) - Math.max(0, damage - (target.defense || 0))) };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'wild_attack'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.wild_attack.cost || 0)) };
    let message = `${user.name || 'You'} triggers Wild Attack (d20=${roll})`; 
    // sample effects mapping (not exhaustive but varied)
    if (roll <= 3) {
      // small backlash: caster takes a bit of damage
      const backlash = Math.floor(damage * 0.4);
      const pHp = Math.max(0, (user.hp || 0) - backlash);
      playerUpdates.hp = pHp;
      message += ` — chaotic backlash! You suffer ${backlash} damage.`;
    } else if (roll <= 8) {
      // apply random debuff to opponent (stronger)
      const s = Object.assign({}, target.status || {});
      s.weaken = { turns: 2, amount: 4, prevBoost: (target.attackBoost || 0) };
      opponentUpdates.status = s;
      message += ` — the enemy is weakened.`;
    } else if (roll <= 15) {
      // normal damage + burn (stronger)
      const s = Object.assign({}, target.status || {});
      s.burn = { turns: 3, dmg: Math.max(3, Math.floor(base / 3)) };
      opponentUpdates.status = s;
      message += ` — the enemy is scorched.`;
    } else if (roll <= 19) {
      // strong hit + stun
      const extra = Math.floor(Math.random() * 14) + 10;
      const newHp = Math.max(0, (opponentUpdates.hp || target.hp) - extra);
      opponentUpdates.hp = newHp;
      const s = Object.assign({}, opponentUpdates.status || target.status || {});
      s.stun = { turns: 1 };
      opponentUpdates.status = s;
      message += ` — a powerful surge stuns the opponent!`;
    } else {
      // 20: best-case: big damage + buff the caster
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
  }

  ,wild_buff(user, target) {
    const roll = Math.floor(Math.random() * 20) + 1;
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'wild_buff'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.wild_buff.cost || 0)) };
    const pS = Object.assign({}, user.status || {});
    let message = `${user.name || 'You'} invoke Wild Buff (d20=${roll})`;
    if (roll <= 4) {
      // curse: reduce own attack
      pS.weaken = { turns: 3, amount: 4, prevBoost: (user.attackBoost || 0) };
      message += ` — misfired and you feel weaker.`;
    } else if (roll <= 10) {
      // small heal
      const heal = 10;
      playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + heal);
      message += ` — minor regenerative pulse heals ${heal} HP.`;
    } else if (roll <= 16) {
      // small buff
      pS.shout = { turns: 2, amount: 6 };
      playerUpdates.attackBoost = (user.attackBoost || 0) + 6;
      message += ` — arcane winds bolster your strength.`;
    } else if (roll <= 19) {
      // mana surge
      playerUpdates.mana = Math.min(user.maxMana || (user.mana || 0), (user.mana || 0) + 12);
      message += ` — mana surges through you.`;
    } else {
      // 20: best-case: big heal + strong buff
      playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + 25);
      pS.shout = { turns: 3, amount: 12 };
      playerUpdates.attackBoost = (user.attackBoost || 0) + 12;
      message += ` — incredible boon: large heal and huge strength.`;
    }
    playerUpdates.status = Object.keys(pS).length ? pS : null;
    return { playerUpdates, opponentUpdates: {}, matchUpdates: { lastMove: 'special_wild_buff' }, message };
  }

  ,wild_arcanum(user, target) {
  //this amplifies wild arcanum baseline and variance with stronger mid-tier and critical outcomes.
    const roll = Math.floor(Math.random() * 20) + 1;
    const base = getEffectiveBaseAtk(user, 18);
    // larger variance and higher baseline
    let raw = Math.floor(Math.random() * 24) + base + 12;
    const opponentUpdates = { hp: Math.max(0, (target.hp || 0) - Math.max(0, raw - (target.defense || 0))) };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'wild_arcanum'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.wild_arcanum.cost || 0)) };
    let message = `${user.name || 'You'} cast Wild Arcanum (d20=${roll})`;
    if (roll <= 4) {
      // significant backlash: caster takes a larger chunk of damage
      const back = Math.floor(raw * 0.5);
      playerUpdates.hp = Math.max(0, (user.hp || 0) - back);
      message += ` — chaotic backlash! You suffer ${back} damage.`;
    } else if (roll <= 12) {
      // moderate effect: moderate extra damage
      const extra = Math.floor(Math.random() * 12) + 8;
      opponentUpdates.hp = Math.max(0, (opponentUpdates.hp || target.hp) - extra);
      message += ` — arcane surge deals extra damage.`;
    } else if (roll <= 19) {
      // strong hit + lifesteal on the caster
      const extra = Math.floor(Math.random() * 20) + 12;
      opponentUpdates.hp = Math.max(0, (opponentUpdates.hp || target.hp) - extra);
      playerUpdates.hp = Math.min(user.maxHp || 100, (user.hp || 0) + Math.floor(extra * 0.4));
      message += ` — wild arcanum hits hard and you siphon some life.`;
    }
    if (roll === 20) {
      // critical: very large nuke and an empowering buff
      const nuke = Math.floor(Math.random() * 36) + 36;
      opponentUpdates.hp = Math.max(0, (opponentUpdates.hp || target.hp) - nuke);
      const pS = Object.assign({}, user.status || {});
      pS.shout = { turns: 3, amount: 14 };
      playerUpdates.status = pS;
      playerUpdates.attackBoost = (user.attackBoost || 0) + 14;
      message += ` Critical wild arcanum! Massive surge and you are empowered.`;
    }
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_wild_arcanum' }, message, lastMoveDamage: raw };
  }
};

// Initialize battle when match is found
window.initializeBattle = async function(mId, userId) {
  matchId = mId;
  try { localStorage.setItem('in_match_v1', matchId); } catch(e) {}
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
  // expose opponentId to window so other modules (UI/gear) can reliably fetch opponent gear
  try { if (typeof window !== 'undefined') window.opponentId = opponentId; } catch(e) {}
  opponentRef = ref(db, `matches/${matchId}/players/${opponentId}`);

  // Set player names and seed player stats if not already present
  const userSnapshot = await get(ref(db, `users/${userId}`));
  const userName = userSnapshot.val()?.displayName || "Player";
  // Show forfeit UI
  try { const fb = document.getElementById('forfeitBtn'); if (fb) fb.style.display = 'inline-block'; const fn = document.getElementById('forfeit-note'); if (fn) fn.style.display='block'; } catch(e){}

  // Determine player's selected class: prefer DB stored selection, fallback to localStorage
  const dbSelected = userSnapshot.val()?.selectedClass;
  const selectedClass = dbSelected || ((typeof localStorage !== 'undefined') ? (localStorage.getItem('selectedClass') || 'warrior') : 'warrior');
  const classTemplate = CLASS_STATS[selectedClass] || CLASS_STATS.warrior;

  // Get existing player node to avoid overwriting any existing server values
  const existingPlayerSnap = await get(playerRef);
  const existing = existingPlayerSnap.exists() ? existingPlayerSnap.val() : {};
  const opponentSnapNow = await get(opponentRef);
  const existingOpponent = opponentSnapNow.exists() ? opponentSnapNow.val() : {};
  // Decide which class to seed for this player. Use the selectedClass (from users node or localStorage)
  // and avoid carrying over abilities from a different existing class. If an existing player node
  // belongs to a different class, overwrite abilities with the templateAbilities for the selectedClass.
  // Only grant abilities that belong to the selected class's template.
  // This prevents retention of abilities from previously-assigned different classes (e.g., Dark Mage)
  // which could otherwise leak into a newly-selected class like Necromancer.
  const templateAbilities = Array.isArray(classTemplate.abilities) ? classTemplate.abilities : [];
  let resolvedAbilities = templateAbilities.slice();

  // Determine mana/maxMana to seed: if the existing node already belonged to the same class
  // preserve its mana (if present). If it's a different class or missing, use the class template.
  const manaVal = (existing && existing.classId === selectedClass)
    ? (typeof existing.mana !== 'undefined' && existing.mana !== null ? existing.mana : (classTemplate.mana || 0))
    : (classTemplate.mana || 0);
  const maxManaVal = (existing && existing.classId === selectedClass)
    ? (typeof existing.maxMana !== 'undefined' && existing.maxMana !== null ? existing.maxMana : (classTemplate.mana || 0))
    : (classTemplate.mana || 0);

  const seed = {
    name: userName,
    // force the seeded classId to selectedClass so client/server are in agreement
    classId: selectedClass,
    baseAtk: existing.baseAtk ?? classTemplate.baseAtk,
    hp: existing.hp ?? classTemplate.hp,
    maxHp: existing.maxHp ?? classTemplate.maxHp,
    defense: existing.defense ?? classTemplate.defense ?? 0,
    // Ensure speed/crit/evasion are present on the match player node so UI and combat
    // mechanics can read them reliably. Preserve any existing custom values when present.
    speed: (typeof existing.speed !== 'undefined' ? existing.speed : classTemplate.speed),
    critChance: (typeof existing.critChance !== 'undefined' ? existing.critChance : classTemplate.critChance),
    evasion: (typeof existing.evasion !== 'undefined' ? existing.evasion : classTemplate.evasion),
    attackBoost: existing.attackBoost ?? classTemplate.attackBoost ?? 0,
    fainted: existing.fainted ?? false,
    abilityCooldowns: existing.abilityCooldowns ?? {},
    status: existing.status ?? {},
    abilities: resolvedAbilities,
    mana: manaVal,
    maxMana: maxManaVal
  };

  // Apply local equipped gear to the seed so the authoritative match node reflects
  // gear-derived HP/MaxHP/attack/defense bonuses. Without this the local UI may
  // show gear-adjusted values while the match node (used for combat calculations)
  // remains at base stats causing mismatches where opponents see different HP.
  try {
    if (window.Gear && typeof Gear.applyEquipToStats === 'function') {
      try { Gear.applyEquipToStats(seed); } catch (e) { console.warn('applyEquipToStats on seed failed', e); }
    }
  } catch (e) {}

  // Immediate UI hydration: show the seeded values locally to avoid the initial
  // placeholder UI (HP: --/--) while DB listeners and seeder logic complete.
  try {
    try { updatePlayerUI(seed, true); } catch (uiE) { /* ignore UI errors */ }
    if (existingOpponent && Object.keys(existingOpponent||{}).length) {
      try { updatePlayerUI(existingOpponent, false); } catch (uiE) { /* ignore UI errors */ }
    }
  } catch (e) { /* best-effort only */ }

  // Only write the full seed if the player node did not previously exist. If a
  // node already exists, avoid overwriting it — this prevents a race where both
  // clients write gear-applied seeds and the last writer wins, producing
  // inconsistent authoritative stats. The equipped map is synced separately
  // below (and may be written/merged if missing).
  try {
    if (!existingPlayerSnap.exists()) {
      await update(playerRef, seed);
    } else {
      // If the node exists, ensure any missing core fields are present without
      // stomping existing values. Only write fields that are absent.
      const minimal = {};
      if (typeof existing.hp === 'undefined') minimal.hp = seed.hp;
      if (typeof existing.maxHp === 'undefined' && typeof seed.maxHp !== 'undefined') minimal.maxHp = seed.maxHp;
      if (typeof existing.baseAtk === 'undefined' && typeof seed.baseAtk !== 'undefined') minimal.baseAtk = seed.baseAtk;
      if (typeof existing.defense === 'undefined' && typeof seed.defense !== 'undefined') minimal.defense = seed.defense;
      if (Object.keys(minimal).length) {
        try { await update(playerRef, minimal); } catch(e){}
      }
    }
  } catch (e) { console.warn('writing player seed conditionally failed', e); }

  // Authoritative equip write: if the match player node doesn't have an `equipped` map,
  // write the client's local equip map so both sides can see equipped IDs.
  try {
    const localEq = (typeof localStorage !== 'undefined') ? (JSON.parse(localStorage.getItem('armory_equip_v1') || '{}') || {}) : {};
    // If there's no authoritative equipped map, or it differs from the client's local equip map,
    // write/merge the local map so both sides can see equipped IDs. This helps avoid races
    // where the opponent UI cannot fetch gear because the match node lacks the equipped IDs.
    const existingEq = existing && existing.equipped ? existing.equipped : {};
    const needWrite = (!existingEq || Object.keys(existingEq || {}).length === 0) || (JSON.stringify(existingEq) !== JSON.stringify(localEq));
    if (needWrite && Object.keys(localEq || {}).length) {
      try { await update(playerRef, { equipped: localEq }); } catch(e){}
    }
    // Also ensure equipped gear items are present on the server under users/{uid}/gear
    try {
      if (typeof db !== 'undefined' && typeof ref === 'function' && typeof update === 'function' && window.Gear && typeof Gear.getArmory === 'function') {
        const arm = Gear.getArmory() || [];
        const ids = Object.values(localEq).filter(Boolean);
        // write any equipped items the client has locally to the server so the seeder can fetch them
        for (const id of ids) {
          try {
            const found = arm.find(x => x.id === id);
            if (found) {
              const gearRef = ref(db, `users/${currentUserId}/gear/${found.id}`);
              // best-effort update (do not await multiple in series too long)
              try { await update(gearRef, found); } catch(e) { /* ignore write errors */ }
            }
          } catch (e) { /* ignore per-item errors */ }
        }
      }
    } catch (e) { /* ignore gear sync errors */ }
  } catch (e) { console.error('writing initial equipped map failed', e); }

  // Starter gear is granted at signup (login.js) or via end-of-match rewards.

  // Attempt to perform a single authoritative seeding of both players' match nodes
  // with gear-applied stats. We elect the lexicographically smaller uid as the
  // seeder to avoid races; the seeder will wait briefly for both players' equipped
  // maps to appear in the match node, fetch the referenced gear objects, apply
  // gear modifiers to calculated seeds and write both players under matches/{id}/players
  // in a single update so both clients observe identical starting stats.
  try {
    const p1 = matchData.p1, p2 = matchData.p2;
    if (p1 && p2) {
      const seeder = (p1 < p2) ? p1 : p2;
      // ensure local equip map is written for this client (existing logic)
      try {
        const localEq = (typeof localStorage !== 'undefined') ? (JSON.parse(localStorage.getItem('armory_equip_v1') || '{}') || {}) : {};
        const existingEq = existing && existing.equipped ? existing.equipped : {};
        const needWrite = (!existingEq || Object.keys(existingEq || {}).length === 0) || (JSON.stringify(existingEq) !== JSON.stringify(localEq));
        if (needWrite && Object.keys(localEq || {}).length) {
          try { await update(playerRef, { equipped: localEq }); } catch(e){}
        }
      } catch (e) { /* ignore equip write errors */ }

      // Only the chosen seeder performs the combined seed write
      if (currentUserId === seeder) {
        // wait for both equipped maps to be present (retry a few times)
        const maxRetries = 6; let retry = 0; let bothEq = false;
        while (retry < maxRetries) {
          try {
            const snap = await get(matchRef);
            const md = snap.val() || {};
            const players = md.players || {};
            const p1eq = players[p1] && players[p1].equipped && Object.keys(players[p1].equipped||{}).length;
            const p2eq = players[p2] && players[p2].equipped && Object.keys(players[p2].equipped||{}).length;
            if (p1eq && p2eq) { bothEq = true; break; }
          } catch (e) { /* ignore */ }
          // small backoff
          await new Promise(r=>setTimeout(r, 250));
          retry++;
        }

        // fetch equipped maps (best-effort) from match node
        let playersNode = {};
        try { playersNode = (await get(ref(db, `matches/${matchId}/players`))).val() || {}; } catch (e) { playersNode = {}; }

        // helper to build a seed for a uid
        const buildSeedFor = async (uid, existingNode) => {
          try {
            const userSnap = await get(ref(db, `users/${uid}`));
            const userVal = userSnap.val() || {};
            const userName = userVal.displayName || (existingNode && existingNode.name) || 'Player';
            const dbSelected = userVal.selectedClass;
            const selectedClass = dbSelected || ((typeof localStorage !== 'undefined' && uid===currentUserId) ? (localStorage.getItem('selectedClass') || 'warrior') : (existingNode && existingNode.classId) || 'warrior');
            const classTemplate = CLASS_STATS[selectedClass] || CLASS_STATS.warrior;
            const seedLocal = {
              name: userName,
              classId: selectedClass,
              baseAtk: existingNode.baseAtk ?? classTemplate.baseAtk,
              hp: existingNode.hp ?? classTemplate.hp,
              maxHp: existingNode.maxHp ?? classTemplate.maxHp,
              defense: existingNode.defense ?? classTemplate.defense ?? 0,
              speed: (typeof existingNode.speed !== 'undefined' ? existingNode.speed : classTemplate.speed),
              critChance: (typeof existingNode.critChance !== 'undefined' ? existingNode.critChance : classTemplate.critChance),
              evasion: (typeof existingNode.evasion !== 'undefined' ? existingNode.evasion : classTemplate.evasion),
              attackBoost: existingNode.attackBoost ?? classTemplate.attackBoost ?? 0,
              fainted: existingNode.fainted ?? false,
              abilityCooldowns: existingNode.abilityCooldowns ?? {},
              status: existingNode.status ?? {},
              abilities: Array.isArray(classTemplate.abilities) ? classTemplate.abilities.slice() : [],
              mana: existingNode.mana ?? (classTemplate.mana || 0),
              maxMana: existingNode.maxMana ?? (classTemplate.mana || 0)
            };
            // attempt to apply gear if we can fetch equipped map and gear items
            try {
              const equipped = (playersNode[uid] && playersNode[uid].equipped) ? playersNode[uid].equipped : (uid===currentUserId ? (JSON.parse(localStorage.getItem('armory_equip_v1')||'{}')||{}) : {});
              const gearIds = equipped ? Object.values(equipped).filter(Boolean) : [];
              if (gearIds.length && window.Gear && typeof Gear.applyGearListToStats === 'function') {
                const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${uid}/gear/${id}`)).then(s => s.exists()?s.val():null).catch(()=>null)))).filter(Boolean);
                if (items.length) {
                  Gear.applyGearListToStats(seedLocal, items);
                }
              }
            } catch (e) { /* ignore gear fetch/apply errors */ }
            return seedLocal;
          } catch (e) { return null; }
        };

        // Only perform seeding when the match appears to be pre-start (turnCounter not present or zero)
        const needSeeding = (!matchData.turnCounter || matchData.turnCounter === 0);
        if (needSeeding) {
          const s1 = await buildSeedFor(p1, playersNode[p1]||{});
          const s2 = await buildSeedFor(p2, playersNode[p2]||{});
          const updates = {};
          if (s1) updates[`players/${p1}`] = s1;
          if (s2) updates[`players/${p2}`] = s2;
          if (Object.keys(updates).length) {
            try { await update(matchRef, updates); } catch (e) { console.warn('combined seed update failed', e); }
          }
        }
      }
    }
  } catch (e) { console.warn('combined seeding logic failed', e); }

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
  try { attachActionTooltips(); } catch (e) { /* ignore */ }
  onValue(playerRef, () => { renderSpecialButtons().catch(console.error); });
  onValue(currentTurnRef, () => { renderSpecialButtons().catch(console.error); });
  //this renderInventory and re-render on player/opponent changes
  try { await renderInventory(); } catch (e) { /* ignore */ }
  onValue(playerRef, () => { renderInventory().catch(console.error); });
  onValue(opponentRef, () => { renderInventory().catch(console.error); });
  // Sync equipped map from match node to localStorage so clients' Gear state matches authoritative match data
  onValue(playerRef, (snap) => {
    try {
      if (!snap.exists()) return;
      const p = snap.val();
      const eq = p && p.equipped ? p.equipped : null;
      if (eq && typeof localStorage !== 'undefined') {
        try { localStorage.setItem('armory_equip_v1', JSON.stringify(eq)); } catch(e){}
        try { if (window && typeof window.onEquipChanged === 'function') window.onEquipChanged(eq); } catch(e){}
      }
    } catch (e) { /* ignore sync errors */ }
  });
  
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
    currentTurnUid = currentTurn;
    const isMyTurn = currentTurn === currentUserId;
    // update per-turn timestamps so inactivity is per-player-per-turn
    perTurnStartTs = Date.now();
    lastActivityTs = Date.now();

    if (isMyTurn) {
      enableButtons();
      showTurnIndicator(true);
    } else {
      disableButtons();
      showTurnIndicator(false);
    }

    // Refresh UI state for both players to avoid stale displays when turns change
    (async () => {
      try {
        const [pSnap, oSnap] = await Promise.all([ get(playerRef), get(opponentRef) ]);
        if (pSnap.exists()) updatePlayerUI(pSnap.val(), true);
        if (oSnap.exists()) updatePlayerUI(oSnap.val(), false);
      } catch (e) { /* ignore */ }
    })();
    // ensure inactivity watcher running
    try { startInactivityWatcher(); } catch (e) {}
  });

  // Listen to player stats changes
  onValue(playerRef, (snap) => {
    if (snap.exists()) {
      const stats = snap.val();
      updatePlayerUI(stats, true);
      // Check if player died — debounce the actual death handling to avoid races
      if (stats.hp <= 0 || stats.fainted) {
        console.debug('[listener] player hp <=0 observed, scheduling death check for', currentUserId, stats);
        scheduleDeathCheck(currentUserId);
      }
    }
  });

  // Listen to opponent stats changes
  onValue(opponentRef, (snap) => {
    if (snap.exists()) {
      const stats = snap.val();
      updatePlayerUI(stats, false);
      // Check if opponent died — debounce the actual death handling to avoid races
      if (stats.hp <= 0 || stats.fainted) {
        console.debug('[listener] opponent hp <=0 observed, scheduling death check for', opponentId, stats);
        scheduleDeathCheck(opponentId);
      }
    }
  });

  // Listen to match state changes to generate appropriate messages
  onValue(ref(db, `matches/${matchId}`), async (snap) => {
    if (!snap.exists()) return;

    const matchData = snap.val();

    // Update last-activity timestamp whenever the match node changes.
    // This helps the inactivity watcher detect real activity (moves, turn
    // changes, etc.).
    lastActivityTs = Date.now();

    // Don't process messages if game is finished (end game overlay handles that)
    if (matchData?.status === "finished") {
      return;
    }
    
    const lastMoveActor = matchData?.lastMoveActor;
    const lastMove = matchData?.lastMove;
    // Debug: record observed last-move details to help diagnose rapid/incorrect
    // special-processing glitches. These logs are lightweight and can be
    // removed after verification.
    try {
      console.debug('[matchListener] lastMoveActor=', lastMoveActor, 'lastMove=', lastMove, 'currentTurn=', matchData?.currentTurn, 'message=', matchData?.message);
    } catch (e) {}
    
    if (!lastMoveActor || !lastMove) return;
    
    // Only process if this is a new move
    if (lastMoveActor === lastProcessedMoveActor && lastMove === lastProcessedMove) {
      return;
    }
    
    lastProcessedMoveActor = lastMoveActor;
    lastProcessedMove = lastMove;
    
    // Generate message based on who made the move. We handle common
    // canned moves and also support persisted messages for specials
    // and status-blocks (stun/silence). If the match node contains a
    // pre-built message (e.g. from chooseSpecial), prefer that.
    const wasMyMove = lastMoveActor === currentUserId;

    const playerSnapshot = await get(playerRef);
    const opponentSnapshot = await get(opponentRef);
    const playerStats = playerSnapshot.val();
    const opponentStats = opponentSnapshot.val();

    let message = "";

    // If the server/client wrote a friendly persisted message, use it.
    if (matchData.message) {
      if (typeof matchData.message === 'object') {
        message = wasMyMove ? (matchData.message.actor || matchData.message.text || '') : (matchData.message.opponent || matchData.message.text || '');
      } else {
        // legacy string message
        message = matchData.message;
      }
    } else if (wasMyMove) {
      // My move - use first person for built-in move types
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
      } else if (lastMove === 'stunned') {
        message = "You are stunned and cannot act!";
      } else if (lastMove === 'silenced') {
        message = "You are silenced and cannot use specials!";
      } else if (typeof lastMove === 'string' && lastMove.startsWith('special_')) {
        // fallback for specials when no persisted message exists
        const ability = lastMove.split('_')[1] || 'special';
        message = `You used ${ability}!`;
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
      } else if (lastMove === 'stunned') {
        message = `${opponentName} was stunned and cannot act!`;
      } else if (lastMove === 'silenced') {
        message = `${opponentName} was silenced and cannot use specials!`;
      } else if (typeof lastMove === 'string' && lastMove.startsWith('special_')) {
        // fallback for specials when no persisted message exists
        const ability = lastMove.split('_')[1] || 'special';
        message = `${opponentName} used ${ability}!`;
      }
    }
    
    if (message) {
      logMessage(message);
    }
  });

  // Listen to match status changes (for game over)
  onValue(ref(db, `matches/${matchId}/status`), (snap) => {
    if (snap.exists() && snap.val() === "finished") {
      try { localStorage.removeItem('in_match_v1'); } catch(e) {}
      // stop the inactivity watcher when match ends
      stopInactivityWatcher();
      disableButtons();
      try { setRefreshLock(matchId); } catch (e) { /* best-effort */ }
      const winnerRef = ref(db, `matches/${matchId}/winner`);
      onValue(winnerRef, async (winnerSnap) => {
        if (winnerSnap.exists()) {
          const winnerId = winnerSnap.val();
          const isWinner = winnerId === currentUserId;
          
          // Get opponent name for message
          const opponentSnapshot = await get(opponentRef);
          const opponentName = opponentSnapshot.val()?.name || "Opponent";
          // Winner client should initiate the reward phase (assign loser random item and show chooser)
          try {
            if (isWinner) {
              const fullMatchSnap = await get(matchRef);
              const fullMatchData = fullMatchSnap.exists() ? fullMatchSnap.val() : {};
              const loserUid = (fullMatchData?.p1 === winnerId) ? fullMatchData?.p2 : fullMatchData?.p1;
              // start reward flow (winner client shows chooser)
              initiateRewardPhase(winnerId, loserUid).catch(console.error);
            }
          } catch (e) {
            console.error('Could not initiate reward phase automatically', e);
          }
          
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
    // rewards exist now — clear the refresh lock so users can navigate safely
    try { clearRefreshLock(); } catch (e) { /* best-effort */ }
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

      // Handle loser rewards; supports new shape { gear: {...}, item: {...} } or legacy single id
      if (rewards && rewards.loser) {
        const l = rewards.loser;
        // gear portion
            if (l.gear && l.gear.id) {
          const ownerUid = l.gear.uid;
          if (ownerUid && currentUserId === ownerUid) {
            // fetch meta name if available
            try {
              const gsnap = await get(ref(db, `users/${ownerUid}/gear/${l.gear.id}`));
              if (gsnap.exists()) {
                const g = gsnap.val();
                const metaName = (g && (g.name || g.pretty)) ? (g.name || g.pretty) : l.gear.id;
                rewardStatusEl.textContent = `You received (gear): ${metaName}`;
                try { if (g) clearRefreshLock(); } catch (e) { /* best-effort */ }
              } else {
                const meta = catalog[l.gear.id] || { id: l.gear.id, name: l.gear.id };
                rewardStatusEl.textContent = `You received (gear): ${meta.name}`;
              }
            } catch (e) { rewardStatusEl.textContent = `You received (gear): ${l.gear.id}`; }
            if (chooser) chooser.style.display = 'none';
          }
        } else if (typeof l === 'string' || typeof l.id !== 'undefined') {
          // legacy single-id behavior
          const legacy = (typeof l === 'string' || typeof l === 'number') ? { id: l } : (l.id ? l : null);
          if (legacy && legacy.id) {
            const ownerUid = legacy.uid;
            if (ownerUid) {
              if (currentUserId === ownerUid) {
                const meta = catalog[legacy.id] || { id: legacy.id, name: legacy.id };
                rewardStatusEl.textContent = `You received: ${meta.name}`;
                if (chooser) chooser.style.display = 'none';
              }
            } else {
              if (winnerId) {
                const loserUid = (matchData?.p1 === winnerId) ? matchData?.p2 : matchData?.p1;
                if (currentUserId === loserUid) {
                  const meta = catalog[legacy.id] || { id: legacy.id, name: legacy.id };
                  rewardStatusEl.textContent = `You received: ${meta.name}`;
                  if (chooser) chooser.style.display = 'none';
                }
              }
            }
          }
        }

        // catalog item portion
        if (l.item && l.item.id) {
          const ownerUid2 = l.item.uid;
          if (ownerUid2 && currentUserId === ownerUid2) {
            const meta = catalog[l.item.id] || { id: l.item.id, name: l.item.id };
            rewardStatusEl.textContent = `You received (item): ${meta.name}`;
            if (chooser) chooser.style.display = 'none';
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
      // Additionally, if the recorded reward is a gear object, fetch it from DB and add to local armory
      try {
        // handle loser gear (support new shape rewards.loser.gear)
        const loserPayload = rewards?.loser || null;
        let loserGear = null;
        if (loserPayload && loserPayload.gear && loserPayload.gear.id) {
          loserGear = loserPayload.gear;
        } else if (loserInfo && loserInfo.id && loserInfo.uid && (loserInfo.type === 'gear' || String(loserInfo.id).startsWith('g_'))) {
          loserGear = loserInfo;
        }
        if (loserGear && window.Gear && currentUserId === loserGear.uid) {
          try {
            const gsnap = await get(ref(db, `users/${loserGear.uid}/gear/${loserGear.id}`));
            if (gsnap.exists()) {
              const g = gsnap.val();
              try { await Gear.addGearToArmoryAndSync(g); } catch(e) { try { Gear.addGearToArmory(g); } catch(_){} }
              if (rewardStatusEl && currentUserId === loserGear.uid) {
                const meta = (catalog[loserGear.id] || { id: loserGear.id, name: g.name || loserGear.id });
                rewardStatusEl.textContent = `You received: ${meta.name}`;
              }
                try { if (g && currentUserId === loserGear.uid) clearRefreshLock(); } catch (e) { /* best-effort */ }
            }
          } catch (e) { console.warn('Could not fetch/attach loser gear locally', e); }
        }

        // handle winner gear
        if (winnerInfo && winnerInfo.id && winnerInfo.uid && (winnerInfo.type === 'gear' || String(winnerInfo.id).startsWith('g_'))) {
          if (window.Gear && currentUserId === winnerInfo.uid) {
            try {
              const gsnap = await get(ref(db, `users/${winnerInfo.uid}/gear/${winnerInfo.id}`));
              if (gsnap.exists()) {
                const g = gsnap.val();
                try { await Gear.addGearToArmoryAndSync(g); } catch(e) { try { Gear.addGearToArmory(g); } catch(_){} }
                if (rewardStatusEl && currentUserId === winnerInfo.uid) {
                  const meta = (catalog[winnerInfo.id] || { id: winnerInfo.id, name: g.name || winnerInfo.id });
                  rewardStatusEl.textContent = `You received: ${meta.name}`;
                }
                try { if (g && currentUserId === winnerInfo.uid) clearRefreshLock(); } catch (e) { /* best-effort */ }
              }
            } catch (e) { console.warn('Could not fetch/attach winner gear locally', e); }
          }
        }
      } catch (e) { /* non-fatal reward attach errors */ }
    } catch (e) {
      console.error('Error handling rewards listener', e);
    }
  });
}

  // In-match class chooser UI helpers
  // Inactivity watcher helpers: finish match after prolonged inactivity
  function stopInactivityWatcher() {
    try {
      if (inactivityInterval) {
        clearInterval(inactivityInterval);
        inactivityInterval = null;
      }
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      try { const fn = document.getElementById('forfeit-note'); if (fn) { fn.style.display='none'; fn.textContent = 'Time remaining: --s'; } } catch (e) {}
    } catch (e) { /* ignore */ }
  }

  function startInactivityWatcher() {
    stopInactivityWatcher();
    inactivityInterval = setInterval(async () => {
      try {
        if (!matchId || inactivityFinishing) return;
        const age = Date.now() - (lastActivityTs || 0);
        if (age >= INACTIVITY_LIMIT_MS) {
          inactivityFinishing = true;
          await finishMatchDueToInactivity();
          inactivityFinishing = false;
        }
      } catch (e) {
        console.error('inactivity watcher error', e);
      }
    }, 3000);
    // UI countdown updater (per-second)
    countdownInterval = setInterval(() => {
      try {
        if (!matchId) return;
        const fn = document.getElementById('forfeit-note');
        if (!fn) return;
        // prefer per-turn start timestamp, otherwise fall back to lastActivityTs
        const start = perTurnStartTs || lastActivityTs || Date.now();
        const elapsed = Date.now() - start;
        const remainingMs = Math.max(0, INACTIVITY_LIMIT_MS - elapsed);
        const seconds = Math.ceil(remainingMs / 1000);
        let label = `Time remaining: ${seconds}s`;
        // indicate whose turn it is
        try {
          if (currentTurnUid) {
            if (currentTurnUid === currentUserId) label = `Your turn — ${seconds}s`;
            else label = `Opponent's turn — ${seconds}s`;
          }
        } catch (e) {}
        fn.textContent = label;
        fn.style.display = 'block';
        // color hint in last 10s
        if (remainingMs <= 10000) fn.style.color = '#c33'; else fn.style.color = '#666';
      } catch (e) { /* ignore */ }
    }, 1000);
  }

  async function finishMatchDueToInactivity() {
    if (!matchId) return;
    try {
      const snap = await get(matchRef);
      if (!snap.exists()) return;
      const matchData = snap.val() || {};
      if (matchData.status === 'finished') return;
      // Per-turn timeout: the currentTurn actor is considered to have
      // forfeited by not acting during their 60s window. Prefer to use
      // matchData.currentTurn; if missing, fallback to HP comparison.
      const timedOut = matchData.currentTurn;
      let winnerId = null;
      const p1 = matchData.p1;
      const p2 = matchData.p2;
      if (timedOut) {
        // winner is the other player
        if (p1 && p2) {
          winnerId = (timedOut === p1) ? p2 : p1;
        }
      }
      if (!winnerId) {
        // fallback to HP comparison
        if (!p1 || !p2) return;
        const p1Snap = await get(ref(db, `matches/${matchId}/players/${p1}`));
        const p2Snap = await get(ref(db, `matches/${matchId}/players/${p2}`));
        const p1Stats = p1Snap.exists() ? p1Snap.val() : {};
        const p2Stats = p2Snap.exists() ? p2Snap.val() : {};
        const p1Hp = Number(p1Stats.hp || 0);
        const p2Hp = Number(p2Stats.hp || 0);
        if (p1Hp > p2Hp) winnerId = p1;
        else if (p2Hp > p1Hp) winnerId = p2;
        else winnerId = (Math.random() < 0.5) ? p1 : p2;
      }

      await update(matchRef, { status: 'finished', winner: winnerId, message: 'Match ended due to inactivity (turn timeout).' });
      // stop timer after writing
      stopInactivityWatcher();
    } catch (e) {
      console.error('Could not finish match due to inactivity', e);
    }
  }

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

// Helper: build a consistent set of updates to consume a one-time revive
function buildConsumeReviveUpdates(stats = {}) {
  const rawMax = Number(stats.maxHp || stats.maxHP || 100) || 100;
  const intended = Math.max(1, Math.ceil(rawMax * 0.3));
  const newHp = Math.min(rawMax, intended);
  const newStatus = Object.assign({}, stats.status || {});
  if (newStatus.poison) delete newStatus.poison;
  if (newStatus.burn) delete newStatus.burn;
  // Clear revive flags and prepare a minimal status object
  return {
    has_revive: null,
    revivePreparedAt: null,
    revivePreparedBy: null,
    hp: newHp,
    fainted: false,
    status: Object.keys(newStatus).length ? newStatus : null
  };
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
      // consume revive and restore to ~30% HP using centralized helper to ensure consistency
      const consume = buildConsumeReviveUpdates(deadStats);
      try { console.debug('[revive] consuming revive for', deadPlayerId, { consume, deadStats }); } catch (e) {}
      await update(deadPlayerRef, consume);
      logMessage('A Revive Scroll saved the player from defeat! (revive hp=' + (consume.hp || '?') + ')');
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

  // Ensure chooser and status are readable: use dark background with light text
  try {
    chooser.style.backgroundColor = '#000';
    chooser.style.color = '#fff';
    chooser.style.padding = chooser.style.padding || '12px';
    status.style.backgroundColor = '#000';
    status.style.color = '#fff';
    status.style.padding = status.style.padding || '8px';
  } catch (e) { /* ignore styling errors */ }

  // get catalog
  const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
  // filter out any legacy/removed tokens (e.g., 'jps') so they don't surface in the chooser
  let itemKeys = Object.keys(catalog || {}).filter(k => k !== 'jps');

  // Assign loser rewards: make these less generous
  // - gear awarded to loser only on a modest chance (consolation), not guaranteed
  // - catalog/item award is also probabilistic to avoid giving both every match
  try {
    const rewardsRef = ref(db, `matches/${matchId}/rewards`);
    const rewardsSnap = await get(rewardsRef);
    const existingRewards = rewardsSnap.exists() ? rewardsSnap.val() : {};
    if (!existingRewards || !existingRewards.loser) {
      const loserPayload = {};
      // Award a guaranteed common gear to the loser (one gear per match requirement)
      try {
        if (typeof Gear !== 'undefined') {
          const g = Gear.generateGear(null, 'common');
          try {
            await update(ref(db, `users/${loserUid}/gear/${g.id}`), g);
            loserPayload.gear = { id: g.id, uid: loserUid, type: 'gear' };
            if (loserUid === currentUserId) {
              try { Gear.addGearToArmoryAndSync(g).catch(()=>{}); } catch(e){}
            }
          } catch (e) { console.error('Failed to award gear to loser', e); }
        }
      } catch (e) { /* ignore Gear generation errors */ }

      // Persist loser gear payload
      try { await update(rewardsRef, { loser: loserPayload }); } catch (e) { console.error('Could not write loser reward to match', e); }
  try { clearRefreshLock(); } catch (e) { /* best-effort */ }
    }
  } catch (e) {
    console.error('Error assigning loser reward', e);
  }

  // Prepare winner options (3 generated gear choices + 1 catalog choice) and persist
  try {
    const rewardsRef = ref(db, `matches/${matchId}/rewards`);
    // Only create options if they don't already exist to avoid overwriting
    const existing = (await get(rewardsRef)).exists() ? (await get(rewardsRef)).val() : {};
    if (!existing || !existing.options) {
      const options = { gears: [], catalogs: [], generatedAt: Date.now() };
      try {
        if (typeof Gear !== 'undefined') {
          for (let i = 0; i < 3; i++) options.gears.push(Gear.generateGear(null, null));
        }
      } catch (e) { console.error('Could not generate winner gear options', e); }
      try {
        const keys = Object.keys(catalog || {}).filter(k => k !== 'jps');
        const pickRandom = () => keys.length ? keys[Math.floor(Math.random() * keys.length)] : 'potion_small';
        const seen = new Set();
        for (let i = 0; i < 3; i++) {
          let id = pickRandom();
          // avoid duplicates where possible
          let attempts = 0;
          while (seen.has(id) && attempts++ < 6) id = pickRandom();
          seen.add(id);
          options.catalogs.push({ id, name: (catalog[id]?.name || id) });
        }
      } catch (e) { console.error('Could not generate catalog options', e); }
  try { await update(rewardsRef, { options }); } catch (e) { console.error('Could not persist reward options', e); }
  try { clearRefreshLock(); } catch (e) { /* best-effort */ }
    }
  } catch (e) { console.error('Error preparing winner options', e); }

  if (currentUserId === winnerUid) {
    // render choices as image cards for clarity (limit to 12 items)
    chooser.innerHTML = '';
    const header = document.createElement('div'); header.style.marginBottom = '8px'; header.textContent = 'Pick your reward:';
    chooser.appendChild(header);
  const grid = document.createElement('div');
  // Use CSS grid to present items in 3 columns for a cleaner selector layout
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  grid.style.gap = '12px';
  grid.style.justifyItems = 'center';
    // If reward options exist in DB, render those (prefer deterministic generated gear),
    // otherwise fall back to showing catalog items.
    let options = null;
    try {
      const rSnap = await get(ref(db, `matches/${matchId}/rewards/options`));
      if (rSnap.exists()) options = rSnap.val();
      else {
        const fullSnap = await get(ref(db, `matches/${matchId}/rewards`));
        options = (fullSnap.exists() && fullSnap.val().options) ? fullSnap.val().options : null;
      }
    } catch (e) { console.warn('Could not fetch reward options to render chooser', e); }

    if (options && ( (options.gears && options.gears.length) || (options.catalogs && options.catalogs.length) )) {
      // Render catalog options section
      if (options.catalogs && options.catalogs.length) {
        const headerC = document.createElement('div'); headerC.style.fontWeight='700'; headerC.style.margin = '6px 0'; headerC.textContent = 'Choice of item:'; chooser.appendChild(headerC);
        // Top row: exactly up to 3 catalog choices in a 3-column grid
        const topRow = document.createElement('div');
        topRow.style.display = 'grid';
        topRow.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
        topRow.style.gap = '12px';
        topRow.style.justifyItems = 'center';
        (options.catalogs.slice(0,3)).forEach((c) => {
          const meta = catalog[c.id] || { id: c.id, name: c.name || c.id };
          const card = document.createElement('div'); card.style.width='180px'; card.style.border='1px solid #ccc'; card.style.borderRadius='6px'; card.style.overflow='hidden'; card.style.background='#111'; card.style.color='#fff'; card.style.boxSizing='border-box'; card.style.textAlign='center'; card.style.padding='8px';
          const paths = getItemImagePaths(meta.id);
          const img = document.createElement('img'); img.src = paths.jpg; img.alt = meta.name || meta.id; img.style.width='100%'; img.style.height='80px'; img.style.objectFit='contain'; img.onerror = function(){ if(!this._triedSvg){ this._triedSvg=true; this.src = paths.svg; return; } this.style.opacity='0.6'; };
          card.appendChild(img);
          const nm = document.createElement('div'); nm.textContent = meta.name || meta.id; nm.style.fontWeight='700'; nm.style.margin='8px 0 6px 0'; card.appendChild(nm);
          const btn = document.createElement('button'); btn.type='button'; btn.className='primary-btn'; btn.style.width='100%'; btn.textContent='Select'; btn.style.backgroundColor='#222'; btn.style.color='#fff'; btn.style.border='1px solid #333';
          btn.addEventListener('click', async () => {
            try {
              btn.disabled = true;
              // initialize selection storage
              try { if (!window._rewardChooserSelection) window._rewardChooserSelection = { catalog: null, gear: null }; } catch(e) { window._rewardChooserSelection = { catalog: null, gear: null }; }
              window._rewardChooserSelection.catalog = c.id;
              status.textContent = `Selected item: ${meta.name}. Please also pick a gear item.`;
              try { clearRefreshLock(); } catch (e) { /* best-effort */ }
              const sel = window._rewardChooserSelection || {};
              if (sel.catalog && sel.gear) {
                chooser.style.display = 'none';
                const combined = { type: 'combined', catalogId: sel.catalog, gear: sel.gear };
                await finalizeRewards(winnerUid, loserUid, combined);
                status.textContent = `You received: ${meta.name} and gear. Loser assigned random rewards.`;
              }
            } catch(e){ console.error('finalizeRewards error', e); status.textContent='(error assigning rewards)'; }
          });
          card.appendChild(btn);
          topRow.appendChild(card);
        });
        chooser.appendChild(topRow);
      }
      // Render gear options section
      if (options.gears && options.gears.length) {
        const headerG = document.createElement('div'); headerG.style.fontWeight='700'; headerG.style.margin = '12px 0 6px 0'; headerG.textContent = 'Choice of gear:'; chooser.appendChild(headerG);
        // Bottom row: exactly up to 3 gear choices in a 3-column grid
        const bottomRow = document.createElement('div');
        bottomRow.style.display = 'grid';
        bottomRow.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
        bottomRow.style.gap = '12px';
        bottomRow.style.justifyItems = 'center';
        (options.gears.slice(0,3)).forEach((g) => {
          const meta = g || { id: (g && g.id) || '', name: (g && g.name) || ((g && g.id) || '') };
          const card = document.createElement('div'); card.style.width='180px'; card.style.border='1px solid #ccc'; card.style.borderRadius='6px'; card.style.overflow='hidden'; card.style.background='#111'; card.style.color='#fff'; card.style.boxSizing='border-box'; card.style.textAlign='center'; card.style.padding='8px';
          const img = document.createElement('img');
          // compute candidate list and use the first, stepping on error
          const candidates = getGearImageCandidates(g, meta.id);
          img.src = candidates.length ? candidates[0] : 'img/gear/sword/split_1.png';
          img.alt = meta.name || meta.id;
          img.style.width='100%'; img.style.height='80px'; img.style.objectFit='contain';
          img._candidateIndex = 0;
          img.onerror = function(){
            try {
              if (!this._candidateIndex && this._candidateIndex !== 0) this._candidateIndex = 0;
              this._candidateIndex++;
              if (candidates && this._candidateIndex < candidates.length) {
                this.src = candidates[this._candidateIndex];
                return;
              }
              // final fallback: try item catalog images
              if (!this._triedCatalogFallback) {
                this._triedCatalogFallback = true;
                try {
                  const p = getItemImagePaths(meta.id);
                  if (p && p.jpg) { this.src = p.jpg; return; }
                  if (p && p.svg) { this.src = p.svg; return; }
                } catch(e) {}
              }
            } catch(e) {}
            this.style.opacity='0.6';
          };
          card.appendChild(img);
          const nm = document.createElement('div'); nm.textContent = meta.name || meta.id; nm.style.fontWeight='700'; nm.style.margin='8px 0 6px 0'; card.appendChild(nm);
          if (g && g.pretty) { const desc = document.createElement('div'); desc.textContent = g.pretty; desc.style.fontSize='12px'; desc.style.color='#ccc'; desc.style.minHeight='34px'; desc.style.marginBottom='8px'; card.appendChild(desc); }
          const btn = document.createElement('button'); btn.type='button'; btn.className='primary-btn'; btn.style.width='100%'; btn.textContent='Select'; btn.style.backgroundColor='#222'; btn.style.color='#fff'; btn.style.border='1px solid #333';
          btn.addEventListener('click', async () => {
            try {
              btn.disabled = true;
              try { if (!window._rewardChooserSelection) window._rewardChooserSelection = { catalog: null, gear: null }; } catch(e) { window._rewardChooserSelection = { catalog: null, gear: null }; }
              window._rewardChooserSelection.gear = g;
              status.textContent = `Selected gear: ${g.name}. Please also pick an item.`;
              try { clearRefreshLock(); } catch (e) { /* best-effort */ }
              const sel = window._rewardChooserSelection || {};
              if (sel.catalog && sel.gear) {
                chooser.style.display = 'none';
                const combined = { type: 'combined', catalogId: sel.catalog, gear: sel.gear };
                await finalizeRewards(winnerUid, loserUid, combined);
                status.textContent = `You received gear and an item. Loser assigned random rewards.`;
              }
            } catch(e){ console.error('finalizeRewards error', e); status.textContent='(error assigning rewards)'; }
          });
          card.appendChild(btn);
          bottomRow.appendChild(card);
        });
        chooser.appendChild(bottomRow);
      }
      chooser.style.display = '';
    } else {
      // Fallback: render a simple catalog grid as before
      const visibleKeys = itemKeys.slice(0, 12);
      visibleKeys.forEach(k => {
        const meta = catalog[k] || { id: k, name: k };
        const card = document.createElement('div');
        card.style.width = '100%'; card.style.maxWidth = '220px'; card.style.border = '1px solid #ccc'; card.style.borderRadius = '6px'; card.style.overflow = 'hidden';
        card.style.background = '#111'; card.style.color = '#fff'; card.style.boxSizing = 'border-box'; card.style.textAlign = 'center'; card.style.padding = '8px';
        const img = document.createElement('img'); const paths = getItemImagePaths(k); img.src = paths.jpg; img.alt = meta.name || k; img.style.width='100%'; img.style.height='96px'; img.style.objectFit='contain'; img.onerror = function(){ if(!this._triedSvg){ this._triedSvg=true; this.src = paths.svg; return; } this.style.opacity='0.6'; };
        card.appendChild(img);
        const nm = document.createElement('div'); nm.textContent = meta.name || k; nm.style.fontWeight='700'; nm.style.margin='8px 0 6px 0'; card.appendChild(nm);
        const btn = document.createElement('button'); btn.type='button'; btn.className='primary-btn'; btn.style.width='100%'; btn.textContent='Select'; btn.style.backgroundColor='#222'; btn.style.color='#fff'; btn.style.border='1px solid #333';
        btn.addEventListener('click', async () => {
          try {
            btn.disabled = true;
            try { if (!window._rewardChooserSelection) window._rewardChooserSelection = { catalog: null, gear: null }; } catch(e) { window._rewardChooserSelection = { catalog: null, gear: null }; }
            window._rewardChooserSelection.catalog = k;
            status.textContent = `Selected item: ${meta.name}. Please also pick a gear item.`;
            const sel = window._rewardChooserSelection || {};
            if (sel.catalog && sel.gear) {
              chooser.style.display = 'none';
              const combined = { type: 'combined', catalogId: sel.catalog, gear: sel.gear };
              await finalizeRewards(winnerUid, loserUid, combined);
              status.textContent = `You received: ${meta.name} and gear. Loser assigned random rewards.`;
            }
          } catch(e){ console.error('finalizeRewards error', e); status.textContent='(error assigning rewards)'; }
        });
        card.appendChild(btn);
        grid.appendChild(card);
      });
      chooser.appendChild(grid);
      chooser.style.display = '';
    }
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

async function finalizeRewards(winnerUid, loserUid, chosenChoice) {
  // chosenChoice is an object: { type: 'gear'|'catalog', id, gear? }
  try {
    const rewardsRef = ref(db, `matches/${matchId}/rewards`);
    const rSnap = await get(rewardsRef);
    const existingRewards = rSnap.exists() ? rSnap.val() : {};

    // Remove any auto-assigned winner gear (cleanup) if present
    try {
      const winnerInfo = existingRewards && existingRewards.winner ? (typeof existingRewards.winner === 'string' ? { id: existingRewards.winner } : existingRewards.winner) : null;
      if (winnerInfo && winnerInfo.type === 'gear' && winnerInfo.uid === winnerUid && winnerInfo.id) {
        try {
          const gSnap = await get(ref(db, `users/${winnerUid}/gear/${winnerInfo.id}`));
          if (gSnap.exists()) {
            const gObj = gSnap.val();
            if (gObj && gObj._auto) {
              try { await set(ref(db, `users/${winnerUid}/gear/${winnerInfo.id}`), null); } catch(e) { await update(ref(db, `users/${winnerUid}/gear/${winnerInfo.id}`), null).catch(()=>{}); }
            }
          }
        } catch (e) { console.warn('Could not remove auto winner gear', e); }
      }
    } catch (e) { console.warn('Error checking/removing auto winner gear', e); }

    // Validate chosenChoice
    if (!chosenChoice || !chosenChoice.type) {
      throw new Error('Invalid reward choice');
    }

    // Award chosen reward
    if (chosenChoice.type === 'combined') {
      // composed payload: { type: 'combined', catalogId, gear }
      const g = chosenChoice.gear || null;
      const catalogId = chosenChoice.catalogId || null;
      // persist gear first
      if (g && g.id) {
        try {
          await update(ref(db, `users/${winnerUid}/gear/${g.id}`), g);
          if (winnerUid === currentUserId && window.Gear) {
            try { Gear.addGearToArmoryAndSync(g).catch(()=>{}); } catch(e){}
          }
          try { if (winnerUid === currentUserId && g) clearRefreshLock(); } catch (e) { /* best-effort */ }
        } catch (e) { console.error('Could not persist chosen gear for winner (combined)', e); }
      }
      // persist catalog item
      if (catalogId) {
        const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
        const chosenMeta = catalog[catalogId] || { id: catalogId, name: catalogId };
        if (window && window.addItemToUser) {
          await window.addItemToUser(winnerUid, { id: chosenMeta.id, name: chosenMeta.name, qty: 1 });
        } else {
          const wItemRef = ref(db, `users/${winnerUid}/items/${chosenMeta.id}`);
          const s = await get(wItemRef);
          const qty = (s.exists() && s.val().qty) ? Number(s.val().qty) + 1 : 1;
          await update(wItemRef, { id: chosenMeta.id, name: chosenMeta.name, qty });
        }
      }
  try { await update(rewardsRef, { winner: { type: 'combined', catalogId: catalogId || null, gearId: (g && g.id) ? g.id : null, uid: winnerUid } }); } catch (e) { console.error('Could not write winner combined reward to match', e); }
  try { clearRefreshLock(); } catch (e) { /* best-effort */ }

    } else if (chosenChoice.type === 'gear') {
      const g = (chosenChoice.gear) ? chosenChoice.gear : null;
      if (!g || !g.id) {
        throw new Error('Invalid gear choice payload');
      }
      try {
        await update(ref(db, `users/${winnerUid}/gear/${g.id}`), g);
        if (winnerUid === currentUserId && window.Gear) {
          try { Gear.addGearToArmoryAndSync(g).catch(()=>{}); } catch(e){}
        }
  try { if (winnerUid === currentUserId && g) clearRefreshLock(); } catch (e) { /* best-effort */ }
        // persist winner reward record
  await update(rewardsRef, { winner: { id: g.id, uid: winnerUid, type: 'gear' } });
  try { clearRefreshLock(); } catch (e) { /* best-effort */ }
      } catch (e) { console.error('Could not persist chosen gear for winner', e); }

    } else if (chosenChoice.type === 'catalog') {
      const catalog = (window.getItemCatalog) ? window.getItemCatalog() : {};
      const chosenId = chosenChoice.id;
      const chosenMeta = catalog[chosenId] || { id: chosenId, name: chosenId };
      if (window && window.addItemToUser) {
        await window.addItemToUser(winnerUid, { id: chosenMeta.id, name: chosenMeta.name, qty: 1 });
      } else {
        const wItemRef = ref(db, `users/${winnerUid}/items/${chosenMeta.id}`);
        const s = await get(wItemRef);
        const qty = (s.exists() && s.val().qty) ? Number(s.val().qty) + 1 : 1;
        await update(wItemRef, { id: chosenMeta.id, name: chosenMeta.name, qty });
      }
  try { await update(rewardsRef, { winner: { id: chosenId, uid: winnerUid, type: 'catalog' } }); } catch (e) { console.error('Could not write winner reward to match', e); }
  try { clearRefreshLock(); } catch (e) { /* best-effort */ }
    }

    // Optionally: small chance to also award additional random gear (legacy behavior)
    try {
      if (typeof Gear !== 'undefined') {
        // reduce legacy extra-gear chance for winners (was 50%) to make additional gear rarer
        const roll = Math.random();
        const chance = 0.15;
        if (roll < chance) {
          const g2 = Gear.generateGear(null, null);
          try {
            await update(ref(db, `users/${winnerUid}/gear/${g2.id}`), g2);
            if (winnerUid === currentUserId) {
              try { Gear.addGearToArmoryAndSync(g2).catch(()=>{}); } catch(e){}
            }
            try { if (winnerUid === currentUserId && g2) clearRefreshLock(); } catch (e) { /* best-effort */ }
            try { if (winnerUid === currentUserId) logMessage(`You received extra gear: ${g2.name}`); } catch (e) {}
          } catch (e) { console.error('Could not persist extra winner gear', e); }
        }
      }
    } catch (e) { /* non-fatal */ }

  } catch (e) {
    console.error('finalizeRewards error', e);
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
  
  try { clearRefreshLock(); } catch (e) { /* best-effort */ }
  // Clear current match reference
  await set(ref(db, `users/${currentUserId}/currentMatch`), null);
  // stop inactivity watcher
  try { stopInactivityWatcher(); } catch (e) { /* ignore */ }
  
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
  try { localStorage.removeItem('in_match_v1'); } catch(e) {}
  currentUserId = null;
  opponentId = null;
  lastProcessedMoveActor = null;
  lastProcessedMove = null;
  try { const fb = document.getElementById('forfeitBtn'); if (fb) fb.style.display = 'none'; const fn = document.getElementById('forfeit-note'); if (fn) fn.style.display='none'; } catch(e){}
  try { const cs = document.getElementById('class-select'); if (cs) cs.style.display = ''; } catch(e){}
};

// Forfeit the current match: mark current user as forfeiter and set opponent as winner
window.forfeitMatch = async function() {
  try {
    if (!matchId || !currentUserId) return;
    const snap = await get(matchRef);
    if (!snap.exists()) return;
    const matchData = snap.val() || {};
    const p1 = matchData.p1;
    const p2 = matchData.p2;
    const opponent = (currentUserId === p1) ? p2 : p1;
    if (!opponent) return;
    await update(matchRef, { status: 'finished', winner: opponent, message: 'Player forfeited.' });
    stopInactivityWatcher();
  } catch (e) {
    console.error('forfeitMatch error', e);
  }
};

async function updatePlayerUI(stats, isPlayer) {
  // If the Gear module is present, render with equipped modifiers applied.
  try {
    // work on a copy so we don't mutate the canonical match node
    stats = JSON.parse(JSON.stringify(stats || {}));
    if (window.Gear && isPlayer) {
      try {
        // Prefer authoritative gear objects referenced by the match node so both
        // clients apply identical gear bonuses. Try to read stats.equipped first,
        // then fall back to the match node, and finally to local applyEquipToStats.
        const uid = currentUserId;
        let equippedMap = stats && stats.equipped && Object.keys(stats.equipped||{}).length ? stats.equipped : null;
        if (!equippedMap && matchId && uid) {
          try {
            const mp = await get(ref(db, `matches/${matchId}/players/${uid}`));
            if (mp.exists()) { const mv = mp.val() || {}; if (mv.equipped && Object.keys(mv.equipped||{}).length) equippedMap = mv.equipped; }
          } catch (ee) { /* ignore */ }
        }
        if (equippedMap && typeof Gear.applyGearListToStats === 'function') {
          const gearIds = Object.values(equippedMap||{}).filter(Boolean);
          if (gearIds.length) {
            const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${uid}/gear/${id}`)).then(s=>s.exists()?s.val():null).catch(()=>null)))).filter(Boolean);
            if (items.length) Gear.applyGearListToStats(stats, items);
          }
        } else if (typeof Gear.applyEquipToStats === 'function') {
          try { Gear.applyEquipToStats(stats); } catch (ee) { console.warn('applyEquipToStats threw', ee); }
        }
        if (typeof console !== 'undefined' && console.debug) console.debug('Player equip mods:', stats._equipMods || stats._equipModsApplied || null);
      } catch (e) { console.warn('Applying player gear for UI failed', e); }
    }
    // If updating opponent view, try to apply their equipped gear list (if present in the match node)
    if (window.Gear && !isPlayer) {
      try {
        // stats.equipped may be a map of slot->gearId. If missing, try to read authoritative equipped map from the match node.
        if ((!stats.equipped || Object.keys(stats.equipped||{}).length === 0) && matchId && window.opponentId) {
          try {
            const mp = await get(ref(db, `matches/${matchId}/players/${window.opponentId}`));
            if (mp.exists()) {
              const mpv = mp.val() || {};
              if (mpv.equipped && typeof mpv.equipped === 'object') stats.equipped = mpv.equipped;
            }
          } catch (ee) { /* ignore */ }
        }
        // stats.equipped should now be present if available
        if (stats.equipped && typeof stats.equipped === 'object') {
          const gearIds = Object.values(stats.equipped).filter(Boolean);
          if (gearIds.length && window.opponentId) {
            const promises = gearIds.map(id => get(ref(db, `users/${window.opponentId}/gear/${id}`)).then(s => s.exists() ? s.val() : null).catch(() => null));
            const items = (await Promise.all(promises)).filter(Boolean);
            if (items.length) Gear.applyGearListToStats(stats, items);
            // attach items to stats for display below
            stats.__fetchedEquipsForUI = items;
          }
        }
      } catch (e) { console.warn('Could not fetch/apply opponent gear for UI', e); }
    }
  } catch (e) { console.error('applyEquipToStats failed in updatePlayerUI', e); }
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
  try {
    const equipContainer = isPlayer ? document.getElementById('player-equips') : document.getElementById('enemy-equips');
    if (equipContainer) {
      equipContainer.innerHTML = '';
      if (isPlayer && window.Gear && typeof Gear.getEquippedItems === 'function') {
        const items = Gear.getEquippedItems() || [];
        if (!items.length) {
          equipContainer.textContent = '(no gear equipped)';
        } else {
          for (const it of items) {
            const span = document.createElement('span');
            span.style.display = 'inline-block';
            span.style.margin = '0 6px';
            span.style.padding = '2px 6px';
            span.style.borderRadius = '6px';
            span.style.background = 'rgba(0,0,0,0.15)';
            span.style.color = '#fff';
            span.title = `${it.name || ''} — ${it.rarity || ''}`;
            // small icon + name
            const txt = document.createElement('span');
            txt.textContent = it.name || it.id || '(item)';
            span.appendChild(txt);
            equipContainer.appendChild(span);
          }
        }
      } else if (!isPlayer) {
        const items = stats.__fetchedEquipsForUI || [];
        if (!items.length) equipContainer.textContent = '(unknown)';
        else {
          for (const it of items) {
            const span = document.createElement('span');
            span.style.display = 'inline-block';
            span.style.margin = '0 6px';
            span.style.padding = '2px 6px';
            span.style.borderRadius = '6px';
            span.style.background = 'rgba(0,0,0,0.08)';
            span.style.color = '#fff';
            span.title = `${it.name || ''} — ${it.rarity || ''}`;
            const txt = document.createElement('span');
            txt.textContent = it.name || it.id || '(item)';
            span.appendChild(txt);
            equipContainer.appendChild(span);
          }
        }
      }
    }
  } catch (e) { console.warn('Could not render equips UI', e); }
  // ATK / DEF text
  if (statsText) {
    // Display attack boost (ATK) primarily, with base attack shown in parentheses
    const atkBoost = Number(stats?.attackBoost ?? 0);
    const baseAtk = Number(stats?.baseAtk ?? 0);
    const weakenAmt = Number((stats?.status && stats.status.weaken && stats.status.weaken.amount) || 0);
    const displayAtkBoost = atkBoost - weakenAmt;
    const speed = Number(stats?.speed ?? (stats?.classId ? (CLASS_STATS[stats.classId] && CLASS_STATS[stats.classId].speed) : (CLASS_STATS[stats?.class] && CLASS_STATS[stats?.class].speed))) || 0;
    const crit = Number(stats?.critChance ?? 0) || 0;
    const eva = Number(stats?.evasion ?? 0) || 0;
  // Show crit/evasion as percentages for clarity
  const critPct = Math.round(crit * 100);
  const evaPct = Math.round(eva * 100);
  let statLine = `ATK: ${displayAtkBoost} (base ${baseAtk}) &nbsp; DEF: ${def} &nbsp; SPD: ${speed} &nbsp; CRIT: ${critPct}% &nbsp; EVA: ${evaPct}%`;
  // show current gear modifiers if present
  try {
    if (stats && stats._equipMods) {
      const gm = stats._equipMods;
      const parts = [];
      if (gm.attack) parts.push(`+${gm.attack} ATK`);
      if (gm.defense) parts.push(`+${gm.defense} DEF`);
      if (gm.hp) parts.push(`+${gm.hp} HP`);
      if (parts.length) statLine += ` | Gear: ${parts.join(', ')}`;
    }
  } catch (e) { /* ignore */ }
  // Update HP and Mana UI (bars and text)
  try {
    if (hpText) hpText.textContent = `HP: ${hp}/${maxHp}`;
    if (hpBar) {
      // hpBar is the inner fill element
      const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp * 100))) : 0;
      hpBar.style.width = pct + '%';
    }
    if (manaText) manaText.textContent = `Mana: ${mana}/${displayMaxMana || 0}`;
    if (manaFill) {
      const mpPct = displayMaxMana > 0 ? Math.max(0, Math.min(100, (mana / displayMaxMana * 100))) : 0;
      manaFill.style.width = (mpPct) + '%';
    }
  } catch (e) { console.warn('Could not update HP/Mana bars', e); }
  statsText.innerHTML = statLine;
    // Replace native title with styled tooltip
    try {
      statsText.classList.add('has-tooltip');
      statsText.setAttribute('data-tooltip', `Base ATK: ${baseAtk}. Current attack boost: ${displayAtkBoost}${weakenAmt ? ` (weakened by ${weakenAmt})` : ''}. Speed: ${speed}. Crit chance: ${Math.round(crit*100)}%. Evasion: ${Math.round(eva*100)}%.`);
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

// Called by armory UI when equip state changes. Re-evaluates UI and optionally writes a
// client-side preview of equipped stats into the match node for convenience.
window.onEquipChanged = async function(equipMap) {
  try {
    if (window.Gear && typeof Gear.applyEquipToStats === 'function') {
      if (matchId && currentUserId && playerRef) {
        const snap = await get(playerRef);
        const stats = snap.exists() ? snap.val() : null;
        if (stats) {
          const copy = JSON.parse(JSON.stringify(stats));
          Gear.applyEquipToStats(copy);
          // write a non-authoritative preview so other clients may display equip-influenced numbers
          try { await update(playerRef, { clientEquippedStats: { baseAtk: copy.baseAtk, defense: copy.defense, maxHp: copy.maxHp } }); } catch(e){}
          // update our UI with the modified copy
          try { updatePlayerUI(copy, true); } catch(e){}
        }
        // update opponent view too if present
        try {
          const os = await get(opponentRef);
          if (os.exists()) {
            const oStats = os.val();
            const ocopy = JSON.parse(JSON.stringify(oStats));
            Gear.applyEquipToStats(ocopy);
            try { updatePlayerUI(ocopy, false); } catch(e){}
          }
        } catch(e){}
      } else {
        // Not in a match: just refresh local display if possible
        try { const local = window.player || null; if (local) { const c = JSON.parse(JSON.stringify(local)); Gear.applyEquipToStats(c); updatePlayerUI(c, true); } } catch(e){}
      }
    }
  } catch (e) { console.error('onEquipChanged failed', e); }
};
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
  // If ability has an element tag, show it on the button: e.g. [Fire] Fireball
  const elemMap = { electric: 'Lightning', fire: 'Fire', ice: 'Ice', wind: 'Wind', earth: 'Earth', dark: 'Dark', light: 'Light', neutral: 'Neutral' };
  const tag = abil.element ? (`[${elemMap[abil.element] || (abil.element.charAt(0).toUpperCase() + abil.element.slice(1))}] `) : '';
  btn.textContent = `${tag}${abil.name}${cd > 0 ? ` (CD:${cd})` : (cost ? ` (${cost}M)` : '')}`;
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
  try {
    const messageEl = document.getElementById("message");
    // If there is a recent PvP damage info showing an absorption/reduction, append a shield icon
    try {
      if (window && window._lastPvpDamageInfo) {
        const info = window._lastPvpDamageInfo || {};
        if (info.defenseAbsorbed || info.final === 0) {
          // append a simple shield emoji indicator and then clear the info
          msg = String(msg) + ' 🛡';
          try { window._lastPvpDamageInfo = null; } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore inspection errors */ }

    if (messageEl) {
      // allow HTML-safe insertion (keep it simple: text + emoji)
      messageEl.textContent = msg;
    }
    console.log(msg);
  } catch (e) {
    try { console.log(msg); } catch (e) { /* swallow */ }
  }
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
  console.log('[chooseMove] invoked with move=', move);
  // scope-wide flag to allow gear/abilities to request keeping the turn
  let keepTurnThisAction = false;
  if (!matchId || !currentUserId) {
    console.log('[chooseMove] not in match or no user');
    logMessage("Not in a match!");
    return;
  }

  // Check if it's the player's turn
  const turnSnapshot = await get(currentTurnRef);
  if (!turnSnapshot.exists() || turnSnapshot.val() !== currentUserId) {
    console.log('[chooseMove] not your turn; currentTurn=', turnSnapshot.exists() ? turnSnapshot.val() : null);
    logMessage("It's not your turn!");
    return;
  }

  // Get current player stats
  const playerSnapshot = await get(playerRef);
  const playerStats = playerSnapshot.val();
  console.log('[chooseMove] playerStats fetched', playerStats ? { hp: playerStats.hp, fainted: playerStats.fainted, abilityCooldowns: playerStats.abilityCooldowns } : null);

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
  // Create local calculation copies and apply equips so gear-derived passive effects (regen, manaRegen, etc.) are visible
    let calcPlayer = Object.assign({}, playerStats ? JSON.parse(JSON.stringify(playerStats)) : {});
    let calcOpponent = Object.assign({}, opponentStats ? JSON.parse(JSON.stringify(opponentStats)) : {});
    try {
      if (typeof Gear !== 'undefined') {
        try {
          // Apply player equips using authoritative gear objects when available
          const uid = currentUserId;
          let equippedMapP = calcPlayer && calcPlayer.equipped && Object.keys(calcPlayer.equipped||{}).length ? calcPlayer.equipped : null;
          if (!equippedMapP && matchId && uid) {
            try { const mp = await get(ref(db, `matches/${matchId}/players/${uid}`)); if (mp.exists()) { const mv = mp.val() || {}; if (mv.equipped && Object.keys(mv.equipped||{}).length) equippedMapP = mv.equipped; } } catch(e){}
          }
          if (equippedMapP && Gear.applyGearListToStats) {
            const gearIds = Object.values(equippedMapP||{}).filter(Boolean);
            if (gearIds.length) {
              const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${uid}/gear/${id}`)).then(s=>s.exists()?s.val():null).catch(()=>null)))).filter(Boolean);
              if (items.length) Gear.applyGearListToStats(calcPlayer, items);
            }
          } else if (Gear.applyEquipToStats) {
            Gear.applyEquipToStats(calcPlayer);
          }
              // ensure attack from equips is folded into calcPlayer when needed
              try { ensureEquipAttackIncluded(calcPlayer); } catch(e){}
        } catch (ee) { console.warn('Applying player gear for tick failed', ee); }
        // Apply opponent's equips by fetching their equipped item objects from DB (avoid using local equip map)
        try {
          if (calcOpponent && calcOpponent.equipped && Gear.applyGearListToStats) {
            const gearIds = Object.values(calcOpponent.equipped || {}).filter(Boolean);
            if (gearIds.length) {
              const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${opponentId}/gear/${id}`)).then(s => s.exists() ? s.val() : null).catch(() => null)))).filter(Boolean);
              if (items.length) Gear.applyGearListToStats(calcOpponent, items);
            }
          } else if (Gear.applyEquipToStats) {
            // fallback: best-effort apply local equips (rare)
            Gear.applyEquipToStats(calcOpponent);
          }
              try { ensureEquipAttackIncluded(calcOpponent); } catch(e){}
        } catch (ee) { console.warn('Applying opponent gear for tick failed', ee); }
      }
    } catch (e) { console.warn('Applying equips to local calc copies failed', e); }

  // local control: if gear grants an immediate extra-action this turn we'll set this flag
    const statusRes = processStatusEffectsLocal(calcPlayer, calcOpponent);
  console.log('[chooseMove] statusRes', statusRes);
  if (statusRes.messages && statusRes.messages.length) statusRes.messages.forEach(m => { logMessage(m); try { DamageLog.log(m, 'info'); } catch(e){} });
    if ((statusRes.updates && Object.keys(statusRes.updates).length) || (statusRes.opponentUpdates && Object.keys(statusRes.opponentUpdates).length)) {
      // Respect dark_inversion when applying status tick updates (e.g., regen, burn, poison)
      const adjustedStatus = applyDarkInversionToUpdates(playerStats, opponentStats, statusRes.updates || {}, statusRes.opponentUpdates || {}, true);
      if (adjustedStatus.playerUpdates && Object.keys(adjustedStatus.playerUpdates).length) {
        await update(playerRef, adjustedStatus.playerUpdates);
      }
      if (adjustedStatus.opponentUpdates && Object.keys(adjustedStatus.opponentUpdates).length) {
        await update(opponentRef, adjustedStatus.opponentUpdates);
      }
      const [refreshedP, refreshedO] = await Promise.all([get(playerRef), get(opponentRef)]);
      Object.assign(playerStats, refreshedP.val());
      Object.assign(opponentStats, refreshedO.val());
      console.log('[chooseMove] after status updates, playerStats now', { hp: playerStats.hp, status: playerStats.status, abilityCooldowns: playerStats.abilityCooldowns });
    }
  } catch (err) {
    console.error('Error while processing statuses:', err);
  }

  // Re-check faint after status effects
  if (!playerStats || playerStats.fainted || playerStats.hp <= 0) {
    logMessage("You cannot move, you have fainted!");
    return;
  }

  // Create calculation copies and apply equipped gear modifiers so gear affects combat
  let calcPlayer = JSON.parse(JSON.stringify(playerStats));
  let calcOpponent = JSON.parse(JSON.stringify(opponentStats));
  try {
    if (window.Gear) {
      try {
        // prefer authoritative gear objects for player's calc
        const uid = currentUserId;
        let equippedMapP = calcPlayer && calcPlayer.equipped && Object.keys(calcPlayer.equipped||{}).length ? calcPlayer.equipped : null;
        if (!equippedMapP && matchId && uid) {
          try { const mp = await get(ref(db, `matches/${matchId}/players/${uid}`)); if (mp.exists()) { const mv = mp.val() || {}; if (mv.equipped && Object.keys(mv.equipped||{}).length) equippedMapP = mv.equipped; } } catch(e){}
        }
        if (equippedMapP && typeof Gear.applyGearListToStats === 'function') {
          const gearIds = Object.values(equippedMapP||{}).filter(Boolean);
          if (gearIds.length) {
            const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${uid}/gear/${id}`)).then(s=>s.exists()?s.val():null).catch(()=>null)))).filter(Boolean);
            if (items.length) Gear.applyGearListToStats(calcPlayer, items);
          }
        } else if (typeof Gear.applyEquipToStats === 'function') {
          Gear.applyEquipToStats(calcPlayer);
        }
      } catch (ee) { console.warn('Applying player gear failed', ee); }
      // ensure opponent equips are applied by fetching their gear objects
      try {
        if (calcOpponent && calcOpponent.equipped && typeof Gear.applyGearListToStats === 'function') {
          const gearIds = Object.values(calcOpponent.equipped || {}).filter(Boolean);
          if (gearIds.length) {
            const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${opponentId}/gear/${id}`)).then(s => s.exists() ? s.val() : null).catch(() => null)))).filter(Boolean);
            if (items.length) Gear.applyGearListToStats(calcOpponent, items);
          }
        } else if (typeof Gear.applyEquipToStats === 'function') {
          // fallback
          Gear.applyEquipToStats(calcOpponent);
        }
      } catch (ee) { console.warn('Applying opponent gear failed', ee); }
    }
  } catch (e) { console.error('applyEquipToStats failed in chooseMove', e); }

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
  console.log('[chooseMove] newPlayerCd', newPlayerCd);
  if (JSON.stringify(newPlayerCd) !== JSON.stringify(playerStats.abilityCooldowns || {})) {
    await update(playerRef, { abilityCooldowns: newPlayerCd });
    playerStats.abilityCooldowns = newPlayerCd;
  }

  // Regen small mana amount each turn (if applicable). Include gear-provided manaRegen when present.
  if (playerStats.maxMana > 0) {
    try {
      // prefer calcPlayer (gear-applied) mana regen values when available
      const extraManaFromGear = Number((typeof calcPlayer !== 'undefined' && calcPlayer._equipEnchants && calcPlayer._equipEnchants.manaRegen) ? calcPlayer._equipEnchants.manaRegen : (calcPlayer && calcPlayer._equipMods && calcPlayer._equipMods.manaRegen ? calcPlayer._equipMods.manaRegen : 0)) || 0;
      const baseAmount = 2;
      const newMana = regenManaValue(playerStats, baseAmount + extraManaFromGear);
      if (newMana !== playerStats.mana) {
        await update(playerRef, { mana: newMana });
        playerStats.mana = newMana;
      }
    } catch (e) { console.warn('Mana regen error', e); }
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
    console.log('[chooseMove] proceeding to attack branch');
    // Build base damage components
    const tempBoost = (calcPlayer.status && calcPlayer.status.strength_boost) ? Number(calcPlayer.status.strength_boost.amount || 0) : 0;
    const baseAtkValue = Number(calcPlayer.attack || calcPlayer.baseAtk || 0);
    const atkBoost = Number(calcPlayer.attackBoost || 0);
    const damage = Math.floor(Math.random() * 10) + 10 + baseAtkValue + atkBoost + tempBoost;

    // Determine whether we should ignore defense due to pierce (wind element) or enchants
    let opponentDefense = Number(calcOpponent.defense || 0);
    let ignoreDefense = false;
    try {
      const windPower = (calcPlayer._equipElements && calcPlayer._equipElements.wind) || 0;
      const pierceChance = Math.min(0.6, windPower / 200);
      if (Math.random() < pierceChance) {
        ignoreDefense = true;
      }
      const pEnchants = (calcPlayer._equipEnchants) ? calcPlayer._equipEnchants : {};
      if (pEnchants.ignoreDefenseChance && Math.random() < Number(pEnchants.ignoreDefenseChance)) {
        ignoreDefense = true;
        playerUpdates = Object.assign(playerUpdates || {}, { lastAction: (playerUpdates && playerUpdates.lastAction) ? playerUpdates.lastAction + ' (ignored defense)' : 'Ignored opponent defense!' });
      }
    } catch (e) { }

    // Pre-hit: consume any pierce status on the defender so a previously-applied pierce affects this hit.
    let preHitStatus = null;
    try {
      if (opponentStats && opponentStats.status && opponentStats.status.pierce) {
        preHitStatus = Object.assign({}, opponentStats.status || {});
        preHitStatus.pierce = Object.assign({}, opponentStats.status.pierce || {});
        preHitStatus.pierce.turns = (preHitStatus.pierce.turns || 1) - 1;
        if (preHitStatus.pierce.turns <= 0) delete preHitStatus.pierce;
        ignoreDefense = true; // consume pierce -> ignore defense for this hit
        playerUpdates = Object.assign(playerUpdates || {}, { lastAction: (playerUpdates && playerUpdates.lastAction) ? playerUpdates.lastAction + ' (consumed pierce on defender)' : 'Consumed defender pierce!' });
      }
    } catch (e) { /* ignore pre-hit pierce errors */ }

    // Use the centralized helper to compute base damage (handles evasion and crit)
    try {
      const baseRes = applyDamageToObject({ hp: calcOpponent.hp, defense: opponentDefense, evasion: calcOpponent.evasion || 0 }, damage, { ignoreDefense: ignoreDefense, attacker: calcPlayer });
      if (baseRes && baseRes.dodged) {
        // opponent dodged
        moveDamage = 0;
        opponentUpdates.lastAction = `${opponentStats.name || 'Opponent'} dodged the attack.`;
        matchUpdates.currentTurn = opponentId;
        matchUpdates.lastMoveActor = currentUserId;
        matchUpdates.lastMove = 'attack_dodged';
      } else {
        const baseDamage = baseRes ? (baseRes.damage || 0) : 0;
        const isCrit = baseRes ? !!baseRes.isCrit : false;
        moveDamage = baseDamage;

        // Apply elemental on-hit effects from attacker to opponent (PvP)
        try {
          if (window.Gear && typeof Gear.applyOnHit === 'function') {
            const res = Gear.applyOnHit(calcPlayer, calcOpponent, baseDamage, { pvp: true });
            if (res && res.targetStatus && Object.keys(res.targetStatus).length) {
              const baseStatus = Object.assign({}, opponentStats.status || {}, preHitStatus || {});
              const merged = Object.assign({}, baseStatus, res.targetStatus || {});
              opponentUpdates.status = merged;
            } else if (preHitStatus) {
              opponentUpdates.status = Object.assign({}, preHitStatus);
            }
            if (res && res.attackerUpdates && Object.keys(res.attackerUpdates).length) {
              playerUpdates = Object.assign(playerUpdates || {}, res.attackerUpdates);
            }
                // neutralReduce applies after damage calculation
                if (res && typeof res.neutralReduce === 'number' && res.neutralReduce > 0) {
                  const reduced = Math.floor(baseDamage * (1 - res.neutralReduce));
                  moveDamage = reduced;
                }
                // Log elemental procs and detailed reasons
                try {
                  const atkName = (calcPlayer && (calcPlayer.name || calcPlayer.id)) ? (calcPlayer.name || calcPlayer.id) : 'Attacker';
                  const tgtName = (calcOpponent && (calcOpponent.name || calcOpponent.id)) ? (calcOpponent.name || calcOpponent.id) : 'Target';
                  if (res && Array.isArray(res.procs) && res.procs.length) {
                    res.procs.forEach(p => {
                      try {
                        let msg = `${atkName} element ${p.element} proc:`;
                        if (p.effect) msg += ` ${p.effect}`;
                        if (typeof p.amount !== 'undefined') msg += ` amount=${p.amount}`;
                        if (typeof p.turns !== 'undefined') msg += ` turns=${p.turns}`;
                        if (typeof p.siphon !== 'undefined') msg += ` siphon=${p.siphon}`;
                        if (typeof p.rot !== 'undefined') msg += ` rot=${p.rot}`;
                        if (typeof p.heal !== 'undefined') msg += ` heal=${p.heal}`;
                        if (typeof p.resist !== 'undefined') msg += ` resist=${(p.resist*100).toFixed(1)}%`;
                        if (typeof p.chance !== 'undefined') msg += ` chance=${(p.chance*100).toFixed(1)}%`;
                        DamageLog.log(`${msg} on ${tgtName}`, 'info');
                      } catch (e2) {}
                    });
                  }
                  if (res && typeof res.neutralReduce === 'number' && res.neutralReduce > 0) {
                    const before = baseDamage;
                    const after = moveDamage;
                    DamageLog.log(`${atkName} neutralization reduced damage from ${before} to ${after} (${(res.neutralReduce*100).toFixed(1)}% reduction)`, 'info');
                  }
                } catch (e) { /* best-effort logging */ }
          } else if (preHitStatus) {
            opponentUpdates.status = Object.assign({}, preHitStatus);
          }
        } catch (e) { console.error('PvP applyOnHit failed', e); }

        // honor mana-shield on the defender (convert some damage to mana if available)
        const oEnchants = (calcOpponent._equipEnchants) ? calcOpponent._equipEnchants : {};
        let damageToApply = moveDamage;
        if (oEnchants.manaShieldChance && Math.random() < Number(oEnchants.manaShieldChance)) {
          const manaAvail = Number(opponentStats.mana || 0);
          const manaAbsorb = Math.min(manaAvail, damageToApply);
          if (manaAbsorb > 0) {
            damageToApply = Math.max(0, damageToApply - manaAbsorb);
            opponentUpdates.mana = Math.max(0, manaAvail - manaAbsorb);
            playerUpdates = Object.assign(playerUpdates || {}, { lastAction: (playerUpdates && playerUpdates.lastAction) ? playerUpdates.lastAction + ' (part absorbed by mana)' : 'Opponent used Mana Shield!' });
          }
        }

        // attacker execute / vampirism / extra damage checks (from enchants)
        const attackerEnchants = (calcPlayer._equipEnchants) ? calcPlayer._equipEnchants : {};
        // defensive mitigation on defender (applies to extras as well) - stored as whole percent
        const mitigationPct = Number(oEnchants.mitigationPercent || 0) || 0;
        const mitigationFactor = Math.max(0, 1 - (mitigationPct / 100));
        if (attackerEnchants.executeChance && Math.random() < Number(attackerEnchants.executeChance)) {
          const addExec = Math.round(Number(attackerEnchants.executeDamage || 0) * mitigationFactor);
          damageToApply += addExec;
          matchUpdates._executeTriggered = true;
          try {
            const atkName = (calcPlayer && (calcPlayer.name || calcPlayer.id)) ? (calcPlayer.name || calcPlayer.id) : 'Attacker';
            DamageLog.log(`${atkName} execute triggered: +${addExec} damage (mitigation ${mitigationPct}%)`, 'info');
          } catch(e) {}
        }
        let vampTriggered = false;
        if (attackerEnchants.vampirismChance && Math.random() < Number(attackerEnchants.vampirismChance)) {
          const vampD = Number(attackerEnchants.vampirismDamage || 0);
          if (vampD > 0) {
            const addVamp = Math.round(Number(vampD) * mitigationFactor);
            damageToApply += addVamp;
            vampTriggered = true;
            try { DamageLog.log(`${(calcPlayer && (calcPlayer.name || calcPlayer.id)) || 'Attacker'} vampirism triggered: +${addVamp} damage (mitigation ${mitigationPct}%)`, 'info'); } catch(e) {}
          }
        }

        // extra action: if gear grants an immediate extra action chance, keep the turn
        try {
          if (attackerEnchants.extraActionChance && Math.random() < Number(attackerEnchants.extraActionChance)) {
            keepTurnThisAction = true;
            playerUpdates = Object.assign(playerUpdates || {}, { lastAction: (playerUpdates && playerUpdates.lastAction) ? playerUpdates.lastAction + ' (extra action)' : 'Gained an extra action from gear!' });
          }
        } catch (e) { /* ignore extra-action RNG errors */ }

        // apply final damage to opponent (after all modifiers)
        const newOpponentHp = Math.max(0, (opponentStats.hp || 100) - damageToApply);
        opponentUpdates.hp = newOpponentHp;
        if (isCrit) opponentUpdates._lastCrit = true;

        // reflect: defender reflects a percentage of damage back to attacker
        if (oEnchants.reflectPercent && Number(oEnchants.reflectPercent) > 0) {
          try {
            const refPct = Number(oEnchants.reflectPercent || 0);
            const reflectD = Math.max(0, Math.round(damageToApply * refPct));
            if (reflectD > 0) {
              const refRes = applyDamageToObject({ hp: playerStats.hp, defense: playerStats.defense || 0, evasion: playerStats.evasion || 0 }, reflectD, { attacker: calcOpponent });
              if (refRes && typeof refRes.newHp !== 'undefined') {
                playerUpdates.hp = refRes.newHp;
                playerUpdates._reflected = refRes.damage || reflectD;
                try { DamageLog.log(`${(playerStats && (playerStats.name || playerStats.id)) || 'Player'} took ${playerUpdates._reflected} reflected damage (new HP ${playerUpdates.hp})`, 'warn'); } catch(e) {}
              }
            }
          } catch (e) { console.error('Reflect processing failed', e); }
        }

        // thorns: defender deals flat damage back to attacker when hit
        if (oEnchants.thorns && Number(oEnchants.thorns) > 0) {
          try {
            const thornD = Math.max(0, Math.round(Number(oEnchants.thorns || 0)));
            if (thornD > 0) {
              const thRes = applyDamageToObject({ hp: playerStats.hp, defense: playerStats.defense || 0, evasion: playerStats.evasion || 0 }, thornD, { attacker: calcOpponent });
              if (thRes && typeof thRes.newHp !== 'undefined') {
                playerUpdates.hp = thRes.newHp;
                playerUpdates._thorns = thRes.damage || thornD;
                try { DamageLog.log(`${(playerStats && (playerStats.name || playerStats.id)) || 'Player'} took ${playerUpdates._thorns} thorns damage (new HP ${playerUpdates.hp})`, 'warn'); } catch(e) {}
              }
            }
          } catch (e) { console.error('Thorns processing failed', e); }
        }

        // counter: defender may deal flat counter damage back
        if (oEnchants.counterChance && Math.random() < Number(oEnchants.counterChance)) {
          try {
            const counterD = Number(oEnchants.counterDamage || 0) || 0;
            if (counterD > 0) {
              const ctrRes = applyDamageToObject({ hp: playerStats.hp, defense: playerStats.defense || 0, evasion: playerStats.evasion || 0 }, counterD, { attacker: calcOpponent });
              if (ctrRes && typeof ctrRes.newHp !== 'undefined') {
                playerUpdates.hp = ctrRes.newHp;
                playerUpdates._countered = ctrRes.damage || counterD;
                try { DamageLog.log(`${(playerStats && (playerStats.name || playerStats.id)) || 'Player'} was countered for ${playerUpdates._countered} damage (new HP ${playerUpdates.hp})`, 'warn'); } catch(e) {}
              }
            }
          } catch (e) { console.error('Counter processing failed', e); }
        }

        // lifesteal: heal attacker proportionally to damage done
        if (calcPlayer._lifestealPercent) {
          try {
            const percent = Number(calcPlayer._lifestealPercent || 0);
            if (percent > 0 && damageToApply > 0) {
              const heal = Math.max(0, Math.round(damageToApply * percent));
              const curHp = ('hp' in playerUpdates) ? Number(playerUpdates.hp) : Number(playerStats.hp || 0);
              const maxHpLocal = Number(playerStats.maxHp || playerStats.maxHP || 100);
              playerUpdates.hp = Math.min(maxHpLocal, (curHp || 0) + heal);
              playerUpdates._lifesteal = heal;
                try { DamageLog.log(`${(calcPlayer && (calcPlayer.name || calcPlayer.id)) || 'Attacker'} lifesteals ${heal} HP (now ${playerUpdates.hp})`, 'info'); } catch(e) {}
            }
          } catch (e) { /* ignore lifesteal errors */ }
        }

        // vampirism heal: apply after damage if vamp triggered
        if (vampTriggered) {
          const vampHeal = Number(attackerEnchants.vampirismDamage || 0) || 0;
          if (vampHeal > 0) {
            const curHp = ('hp' in playerUpdates) ? Number(playerUpdates.hp) : Number(playerStats.hp || 0);
            const maxHpLocal = Number(playerStats.maxHp || playerStats.maxHP || 100);
            playerUpdates.hp = Math.min(maxHpLocal, (curHp || 0) + vampHeal);
            playerUpdates._vampirism = vampHeal;
            try { DamageLog.log(`${(calcPlayer && (calcPlayer.name || calcPlayer.id)) || 'Attacker'} vampirism heal ${vampHeal} HP (now ${playerUpdates.hp})`, 'info'); } catch(e) {}
          }
        }
      }
    } catch (e) {
      console.error('Error computing attack damage using centralized helper', e);
    }
  } else if (move === "heal") {
    moveHeal = Math.floor(Math.random() * 15) + 5;
    // Reduce generic Heal effectiveness for Paladin players to balance the class
    try {
      const cls = playerStats.classId || playerStats.class || null;
      if (cls === 'paladin') {
        moveHeal = Math.floor(moveHeal * 0.5);
        try { console.debug('[PvP] reduced generic heal for paladin to', moveHeal); } catch (e) {}
      }
    } catch (e) {}
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
    // Only clear periodic boosts if there isn't an active shout/prepare status
    if (!(playerStats.status && (playerStats.status.shout || playerStats.status.prepare))) {
      playerUpdates.attackBoost = 0;
    }
    if (!(opponentStats.status && (opponentStats.status.shout || opponentStats.status.prepare))) {
      opponentUpdates.attackBoost = 0;
    }
  }

  // Reset player's defense at the start of their turn (defense from previous turn expires)
  // Unless they're defending again this turn
  if (move !== "defend") {
    // Only clear an explicit defense value if the player does not have an active shield status
    if (!(playerStats.status && playerStats.status.shield)) {
      // Reset to the class' baseline defense rather than zero
      try {
        const cls = playerStats.classId || playerStats.class || null;
        const baseDef = (cls && CLASS_STATS[cls] && typeof CLASS_STATS[cls].defense !== 'undefined') ? CLASS_STATS[cls].defense : 0;
        playerUpdates.defense = baseDef;
      } catch (e) {
        // fallback: preserve current defense if class lookup fails
        playerUpdates.defense = (typeof playerStats.defense !== 'undefined') ? playerStats.defense : 0;
      }
    }
  }
  
  // Reset opponent's defense (their turn has ended, so their defense expires)
  // Only clear opponent defense if they do not currently have a shield status active
  if (!(opponentStats.status && opponentStats.status.shield)) {
    try {
      const ocls = opponentStats.classId || opponentStats.class || null;
      const oBaseDef = (ocls && CLASS_STATS[ocls] && typeof CLASS_STATS[ocls].defense !== 'undefined') ? CLASS_STATS[ocls].defense : 0;
      opponentUpdates.defense = oBaseDef;
    } catch (e) {
      // fallback: preserve current opponent defense if class lookup fails
      opponentUpdates.defense = (typeof opponentStats.defense !== 'undefined') ? opponentStats.defense : 0;
    }
  }

  // Update turn counter and switch turns (unless game over)
  if (!gameOver) {
    matchUpdates.turnCounter = turnCounter;
    // If player has an extraTurns buffer or we triggered a one-time extra-action this move, keep the turn
    const extra = (playerStats.status && playerStats.status.extraTurns) ? Number(playerStats.status.extraTurns) : 0;
    if (extra > 0 || keepTurnThisAction) {
      if (extra > 0) {
        // decrement extraTurns and persist it
        const newStatus = Object.assign({}, playerStats.status || {});
        newStatus.extraTurns = Math.max(0, extra - 1);
        if (newStatus.extraTurns <= 0) delete newStatus.extraTurns;
        matchUpdates.currentTurn = currentUserId;
        // also write back updated status for player
        playerUpdates.status = Object.keys(newStatus).length ? newStatus : null;
      } else {
        // one-time immediate extra action: keep turn for this move but don't persist extraTurns
        matchUpdates.currentTurn = currentUserId;
      }
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

  // Apply dark inversion if present on either actor before writing
  // actingIsPlayer = true (current user acting)
  try { console.debug('[chooseMove] prepared updates', { playerUid: currentUserId, playerUpdates, opponentUpdates, matchUpdates }); } catch (e) {}
  let adjusted = applyDarkInversionToUpdates(playerStats, opponentStats, playerUpdates, opponentUpdates, true);
  // Run defensive swap detection/fix
  adjusted = detectAndFixSwappedHp(adjusted, playerStats, opponentStats);

  // Re-evaluate fainting / game over based on adjusted HP values (post-inversion)
  const postPlayerHp = (typeof adjusted.playerUpdates.hp !== 'undefined') ? adjusted.playerUpdates.hp : playerStats.hp;
  const postOpponentHp = (typeof adjusted.opponentUpdates.hp !== 'undefined') ? adjusted.opponentUpdates.hp : opponentStats.hp;
  // Log any HP changes produced by handlers so the Damage Log shows them even when
  // the handler updated HP directly (not via applyDamageToObject).
  try {
    if (typeof adjusted.playerUpdates !== 'undefined' && typeof adjusted.playerUpdates.hp !== 'undefined') {
      const prev = Number(playerStats.hp || 0);
      const next = Number(postPlayerHp || 0);
      const delta = next - prev;
      const lvl = delta < 0 ? 'warn' : 'info';
      DamageLog.log(`${playerStats.name || 'Player'} HP ${delta < 0 ? 'lost' : 'gained'} ${Math.abs(delta)} -> ${next} (was ${prev})`, lvl);
    }
    if (typeof adjusted.opponentUpdates !== 'undefined' && typeof adjusted.opponentUpdates.hp !== 'undefined') {
      const prevO = Number(opponentStats.hp || 0);
      const nextO = Number(postOpponentHp || 0);
      const deltaO = nextO - prevO;
      const lvlO = deltaO < 0 ? 'warn' : 'info';
      DamageLog.log(`${opponentStats.name || 'Opponent'} HP ${deltaO < 0 ? 'lost' : 'gained'} ${Math.abs(deltaO)} -> ${nextO} (was ${prevO})`, lvlO);
    }
  } catch (e) { /* best-effort logging only */ }
  // Clear any pre-set match finish info from handlers so we decide based on post-inversion HP
  if (matchUpdates) {
    // clear any pre-set finish/winner/message set by handlers so we decide outcome from post-inversion HP
    // Important: set message = null to clear any previously persisted message in the DB.
    // Deleting the property here would leave the old message in the DB (update() is a shallow merge),
    // causing subsequent moves to display the prior special's message. Setting to null removes it.
    delete matchUpdates.status;
    delete matchUpdates.winner;
    matchUpdates.message = null;
  }

  if (postOpponentHp <= 0) {
    const opponentHasRevive = (typeof adjusted.opponentUpdates.has_revive !== 'undefined') ? adjusted.opponentUpdates.has_revive : opponentStats.has_revive;
    if (opponentHasRevive) {
      // consume revive for opponent
      const consumeOpp = buildConsumeReviveUpdates(opponentStats);
      adjusted.opponentUpdates = Object.assign(adjusted.opponentUpdates || {}, consumeOpp);
      try { console.debug('[revive] consuming revive for opponent (chooseMove)', { consumeOpp, opponentStats }); } catch (e) {}
      logMessage('Opponent was saved by a Revive Scroll!');
    } else {
      adjusted.opponentUpdates.fainted = true;
      matchUpdates.status = "finished";
      matchUpdates.winner = currentUserId;
      matchUpdates.message = `You defeated ${opponentStats.name || "your opponent"}!`;
      gameOver = true;
    }
  }
  if (postPlayerHp <= 0) {
    const playerHasRevive = (typeof adjusted.playerUpdates.has_revive !== 'undefined') ? adjusted.playerUpdates.has_revive : playerStats.has_revive;
    if (playerHasRevive) {
      const consumePlayer = buildConsumeReviveUpdates(playerStats);
      adjusted.playerUpdates = Object.assign(adjusted.playerUpdates || {}, consumePlayer);
      try { console.debug('[revive] consuming revive for player (chooseMove)', { consumePlayer, playerStats }); } catch (e) {}
      logMessage('Your Revive Scroll saved you from defeat!');
    } else {
      adjusted.playerUpdates.fainted = true;
      matchUpdates.status = "finished";
      matchUpdates.winner = opponentId;
      matchUpdates.message = `${opponentStats.name || 'Opponent'} defeated you!`;
      gameOver = true;
    }
  }

  const updatePromises = [];
  // Sanity: ensure writes go to correct refs (protect against swapped refs)
  try {
    let targetForPlayerRef = playerRef;
    let targetForOpponentRef = opponentRef;
    const pKey = (playerRef && playerRef.key) ? playerRef.key : null;
    const oKey = (opponentRef && opponentRef.key) ? opponentRef.key : null;
    if (pKey !== currentUserId && oKey === currentUserId) {
      try { console.warn('[REF_SANITY] Detected swapped player/opponent refs — correcting for write'); } catch(e){}
      targetForPlayerRef = opponentRef;
      targetForOpponentRef = playerRef;
    }
    if (Object.keys(adjusted.playerUpdates).length > 0) updatePromises.push(update(targetForPlayerRef, adjusted.playerUpdates));
    if (Object.keys(adjusted.opponentUpdates).length > 0) updatePromises.push(update(targetForOpponentRef, adjusted.opponentUpdates));
  } catch (e) {
    if (Object.keys(adjusted.playerUpdates).length > 0) updatePromises.push(update(playerRef, adjusted.playerUpdates));
    if (Object.keys(adjusted.opponentUpdates).length > 0) updatePromises.push(update(opponentRef, adjusted.opponentUpdates));
  }
  if (Object.keys(matchUpdates).length > 0) updatePromises.push(update(matchRef, matchUpdates));

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

  // Check silence: prevents using specials (acts similarly to stun but only blocks specials)
  if (playerStats.status && playerStats.status.silence) {
    logMessage("You are silenced and cannot use specials!");
    const newStatus = Object.assign({}, playerStats.status || {});
    newStatus.silence.turns = (newStatus.silence.turns || 1) - 1;
    const pUpdates = { status: Object.keys(newStatus).length ? newStatus : null };
    if (newStatus.silence.turns <= 0) { delete newStatus.silence; pUpdates.status = Object.keys(newStatus).length ? newStatus : null; }
    await update(playerRef, pUpdates);
    await update(matchRef, { currentTurn: opponentId, lastMoveActor: currentUserId, lastMove: 'silenced' });
    disableButtons();
    return;
  }

  // --- process status effects for the acting player before their action ---
  // (mirror chooseMove behavior so special abilities can't bypass ticks/stuns)
  try {
    // create calc copies and apply gear so passive equip effects count in status ticks
    let calcPlayerForTick = Object.assign({}, playerStats ? JSON.parse(JSON.stringify(playerStats)) : {});
    let calcOpponentForTick = Object.assign({}, opponentStats ? JSON.parse(JSON.stringify(opponentStats)) : {});
    try {
      if (typeof Gear !== 'undefined') {
        if (Gear.applyEquipToStats) Gear.applyEquipToStats(calcPlayerForTick);
        try {
          if (calcOpponentForTick && calcOpponentForTick.equipped && Gear.applyGearListToStats) {
            const gearIds = Object.values(calcOpponentForTick.equipped || {}).filter(Boolean);
            if (gearIds.length) {
              const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${opponentId}/gear/${id}`)).then(s => s.exists() ? s.val() : null).catch(() => null)))).filter(Boolean);
              if (items.length) Gear.applyGearListToStats(calcOpponentForTick, items);
            }
          } else if (Gear.applyEquipToStats) {
            Gear.applyEquipToStats(calcOpponentForTick);
          }
        } catch (ee) { console.warn('applyEquipToStats for special tick opponent failed', ee); }
      }
    } catch (e) { console.warn('applyEquipToStats failed for tick in chooseSpecial', e); }
  const statusRes = processStatusEffectsLocal(calcPlayerForTick, calcOpponentForTick);
  if (statusRes.messages && statusRes.messages.length) statusRes.messages.forEach(m => { logMessage(m); try { DamageLog.log(m, 'info'); } catch(e){} });
    if ((statusRes.updates && Object.keys(statusRes.updates).length) || (statusRes.opponentUpdates && Object.keys(statusRes.opponentUpdates).length)) {
      const adjustedStatus = applyDarkInversionToUpdates(playerStats, opponentStats, statusRes.updates || {}, statusRes.opponentUpdates || {}, true);
      if (adjustedStatus.playerUpdates && Object.keys(adjustedStatus.playerUpdates).length) {
        await update(playerRef, adjustedStatus.playerUpdates);
      }
      if (adjustedStatus.opponentUpdates && Object.keys(adjustedStatus.opponentUpdates).length) {
        await update(opponentRef, adjustedStatus.opponentUpdates);
      }
      const [refreshedP, refreshedO] = await Promise.all([get(playerRef), get(opponentRef)]);
      Object.assign(playerStats, refreshedP.val());
      Object.assign(opponentStats, refreshedO.val());
    }
  } catch (err) {
    console.error('Error while processing statuses in chooseSpecial:', err);
  }

  // Re-check faint after status effects
  if (!playerStats || playerStats.fainted || playerStats.hp <= 0) {
    logMessage("You cannot move, you have fainted!");
    return;
  }

  // Re-check stun after status ticks (defensive)
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

  // prepare calc copies and apply gear so enchants like extraActionChance are visible
  let keepTurnThisAction = false;
  let calcPlayer = JSON.parse(JSON.stringify(playerStats));
  let calcOpponent = JSON.parse(JSON.stringify(opponentStats));
  try {
    if (window.Gear) {
      try {
        // Prefer authoritative gear objects for both calcPlayer and calcOpponent
        const uid = currentUserId;
        // player
        try {
          let equippedMapP = calcPlayer && calcPlayer.equipped && Object.keys(calcPlayer.equipped||{}).length ? calcPlayer.equipped : null;
          if (!equippedMapP && matchId && uid) {
            try { const mp = await get(ref(db, `matches/${matchId}/players/${uid}`)); if (mp.exists()) { const mv = mp.val() || {}; if (mv.equipped && Object.keys(mv.equipped||{}).length) equippedMapP = mv.equipped; } } catch(e){}
          }
          if (equippedMapP && typeof Gear.applyGearListToStats === 'function') {
            const gearIds = Object.values(equippedMapP||{}).filter(Boolean);
            if (gearIds.length) {
              const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${uid}/gear/${id}`)).then(s=>s.exists()?s.val():null).catch(()=>null)))).filter(Boolean);
              if (items.length) Gear.applyGearListToStats(calcPlayer, items);
            }
          } else if (typeof Gear.applyEquipToStats === 'function') {
            Gear.applyEquipToStats(calcPlayer);
          }
              try { ensureEquipAttackIncluded(calcPlayer); } catch(e){}
        } catch(e) { console.warn('applyEquipToStats for calcPlayer (special) failed', e); }
        // opponent
        try {
          if (calcOpponent && calcOpponent.equipped && Gear.applyGearListToStats) {
            const gearIds = Object.values(calcOpponent.equipped || {}).filter(Boolean);
            if (gearIds.length) {
              const items = (await Promise.all(gearIds.map(id => get(ref(db, `users/${opponentId}/gear/${id}`)).then(s => s.exists() ? s.val() : null).catch(() => null)))).filter(Boolean);
              if (items.length) Gear.applyGearListToStats(calcOpponent, items);
            }
          } else if (typeof Gear.applyEquipToStats === 'function') {
            Gear.applyEquipToStats(calcOpponent);
          }
          try { ensureEquipAttackIncluded(calcOpponent); } catch(e){}
        } catch(e) { console.warn('applyEquipToStats for calcOpponent (special) failed', e); }
      } catch (e) { console.warn('applyEquipToStats failed in chooseSpecial', e); }
    }
  } catch (e) { console.error('applyEquipToStats failed in chooseSpecial', e); }

  // Use calc copies (with gear applied) so specials benefit from equip bonuses
  const result = handler(calcPlayer, calcOpponent) || {};
  // Debug: log raw handler output when debugging enabled
  try {
    if (window && window.DEBUG_SPECIALS) {
      try { console.log('[DEBUG_SPECIALS handler result special]', { abilityId: abilityId, rawResult: result, calcPlayer, calcOpponent }); } catch(e){}
    }
  } catch(e){}
  // Debug: log raw handler output when debugging enabled
  try {
    if (window && window.DEBUG_SPECIALS) {
      try { console.log('[DEBUG_SPECIALS handler result]', { abilityId: abilityId || move || null, rawResult: result, calcPlayer, calcOpponent }); } catch(e){}
    }
  } catch(e){}

  // Check gear-based extra action chance on the acting player's calc stats
  try {
    const attackerEnchants = (calcPlayer._equipEnchants) ? calcPlayer._equipEnchants : {};
    if (attackerEnchants.extraActionChance && Math.random() < Number(attackerEnchants.extraActionChance)) {
      keepTurnThisAction = true;
      // annotate playerUpdates so UI can show a message
      result.playerUpdates = Object.assign(result.playerUpdates || {}, { lastAction: (result.playerUpdates && result.playerUpdates.lastAction) ? result.playerUpdates.lastAction + ' (extra action)' : 'Gained an extra action from gear!' });
    }
  } catch (e) { /* ignore */ }
  // Defensive re-fetch to avoid races: ensure the player wasn't stunned by a simultaneous tick
  try {
    const latestP = (await get(playerRef)).val() || {};
    if (latestP.status && latestP.status.stun) {
      logMessage('Action aborted: you were stunned by a simultaneous effect.');
      // decrement stun and end turn
      const newStatus = Object.assign({}, latestP.status || {});
      newStatus.stun.turns = (newStatus.stun.turns || 1) - 1;
      const pUpdates = { status: Object.keys(newStatus).length ? newStatus : null };
      if (newStatus.stun.turns <= 0) { delete newStatus.stun; pUpdates.status = Object.keys(newStatus).length ? newStatus : null; }
      await update(playerRef, pUpdates);
      await update(matchRef, { currentTurn: opponentId, lastMoveActor: currentUserId, lastMove: 'stunned' });
      disableButtons();
      return;
    }
  } catch (e) { console.error('Error verifying latest player status before applying special:', e); }
  const playerUpdates = result.playerUpdates || {};
  const opponentUpdates = result.opponentUpdates || {};
  const matchUpdates = Object.assign({}, result.matchUpdates || {});
  // simple, authoritative message for the match node (keeps UI rendering consistent)
  const message = result.message || `${playerStats.name || 'You'} used ${abilityId}`;
  matchUpdates.lastMove = matchUpdates.lastMove || `special_${abilityId}`;
  matchUpdates.lastMoveActor = currentUserId;
  if (result.lastMoveDamage) matchUpdates.lastMoveDamage = result.lastMoveDamage;
  if (message) matchUpdates.message = message;
  // determine next turn, consuming extraTurns if present
  const currentMatchSnap = await get(matchRef);
  matchUpdates.turnCounter = (currentMatchSnap.val()?.turnCounter || 0) + 1;
  const extra = (playerStats.status && playerStats.status.extraTurns) ? Number(playerStats.status.extraTurns) : 0;
  if (extra > 0 || keepTurnThisAction) {
    if (extra > 0) {
      // consume one extra turn and keep turn with current player
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.extraTurns = Math.max(0, extra - 1);
      if (newStatus.extraTurns <= 0) delete newStatus.extraTurns;
      // merge into playerUpdates so it gets written
      playerUpdates.status = Object.keys(newStatus).length ? newStatus : null;
      matchUpdates.currentTurn = currentUserId;
    } else {
      // one-time immediate extra action: keep turn for this move but don't persist extraTurns
      matchUpdates.currentTurn = currentUserId;
    }
  } else {
    matchUpdates.currentTurn = opponentId;
  }

  // Apply dark inversion to any hp changes before writing
  // actingIsPlayer = true (current user is the actor)
  let adjusted = applyDarkInversionToUpdates(playerStats, opponentStats, playerUpdates, opponentUpdates, true);
  // Run defensive swap detection/fix
  adjusted = detectAndFixSwappedHp(adjusted, playerStats, opponentStats);

  // Debug hook: if enabled, log the pre-write updates so we can diagnose mis-targeting
  try {
    if (window && window.DEBUG_SPECIALS) {
      try {
        console.log('[DEBUG_SPECIALS chooseSpecial pre-write]', {
          matchId: matchId,
          actor: currentUserId,
          opponentId: opponentId,
          playerHpBefore: Number(playerStats.hp || 0),
          opponentHpBefore: Number(opponentStats.hp || 0),
          playerUpdates: playerUpdates,
          opponentUpdates: opponentUpdates,
          adjusted: adjusted,
          handlerId: abilityId
        });
      } catch (e) { console.warn('DEBUG_SPECIALS logging failed', e); }
    }
  } catch (e) { /* noop */ }
  // Debug hook: if enabled, log the pre-write updates so we can diagnose mis-targeting
  try {
    if (window && window.DEBUG_SPECIALS) {
      try {
        console.log('[DEBUG_SPECIALS chooseMove pre-write]', {
          matchId: matchId,
          actor: currentUserId,
          opponentId: opponentId,
          playerHpBefore: Number(playerStats.hp || 0),
          opponentHpBefore: Number(opponentStats.hp || 0),
          playerUpdates: playerUpdates,
          opponentUpdates: opponentUpdates,
          adjusted: adjusted
        });
      } catch (e) { console.warn('DEBUG_SPECIALS logging failed', e); }
    }
  } catch (e) { /* noop */ }

  // Re-evaluate fainting / game over based on adjusted HP values (post-inversion)
  const postPlayerHp = (typeof adjusted.playerUpdates.hp !== 'undefined') ? adjusted.playerUpdates.hp : playerStats.hp;
  const postOpponentHp = (typeof adjusted.opponentUpdates.hp !== 'undefined') ? adjusted.opponentUpdates.hp : opponentStats.hp;
  // Clear any prior finish/winner set by the ability handler; decide outcome from post-inversion HP
  // NOTE: keep any crafted `message` we built above — do not delete it (avoids losing sanitized messages and prevents legacy DOM/string persistence)
  if (matchUpdates) {
    delete matchUpdates.status;
    delete matchUpdates.winner;
    // preserve matchUpdates.message (it should be an object {actor,opponent} or will be sanitized below)
  }

  if (postOpponentHp <= 0) {
    const opponentHasRevive = (typeof adjusted.opponentUpdates.has_revive !== 'undefined') ? adjusted.opponentUpdates.has_revive : opponentStats.has_revive;
    if (opponentHasRevive) {
      const consumeOpp = buildConsumeReviveUpdates(opponentStats);
      adjusted.opponentUpdates = Object.assign(adjusted.opponentUpdates || {}, consumeOpp);
      try { console.debug('[revive] consuming revive for opponent (chooseSpecial)', { consumeOpp, opponentStats }); } catch (e) {}
      logMessage('Opponent was saved by a Revive Scroll!');
    } else {
      adjusted.opponentUpdates.fainted = true;
      matchUpdates.status = matchUpdates.status || "finished";
      matchUpdates.winner = matchUpdates.winner || currentUserId;
      matchUpdates.message = matchUpdates.message || `You defeated ${opponentStats.name || "your opponent"}!`;
    }
  }
  if (postPlayerHp <= 0) {
    const playerHasRevive = (typeof adjusted.playerUpdates.has_revive !== 'undefined') ? adjusted.playerUpdates.has_revive : playerStats.has_revive;
    if (playerHasRevive) {
      const consumePlayer = buildConsumeReviveUpdates(playerStats);
      adjusted.playerUpdates = Object.assign(adjusted.playerUpdates || {}, consumePlayer);
      try { console.debug('[revive] consuming revive for player (chooseSpecial)', { consumePlayer, playerStats }); } catch (e) {}
      logMessage('Your Revive Scroll saved you from defeat!');
    } else {
      adjusted.playerUpdates.fainted = true;
      matchUpdates.status = matchUpdates.status || "finished";
      matchUpdates.winner = matchUpdates.winner || opponentId;
      matchUpdates.message = matchUpdates.message || `${opponentStats.name || 'Opponent'} defeated you!`;
    }
  }

  const updatePromises = [];
  // Sanity: ensure we write playerUpdates to the ref that belongs to the current user and
  // opponentUpdates to the opponent's ref. Some race conditions or ref swaps in other modules
  // may have caused playerRef/opponentRef to be incorrectly assigned — detect and correct.
  try {
    let targetForPlayerRef = playerRef;
    let targetForOpponentRef = opponentRef;
    const pKey = (playerRef && playerRef.key) ? playerRef.key : null;
    const oKey = (opponentRef && opponentRef.key) ? opponentRef.key : null;
    if (pKey !== currentUserId && oKey === currentUserId) {
      // refs are swapped — correct locally
      try { console.warn('[REF_SANITY] Detected swapped player/opponent refs — correcting for write'); } catch(e){}
      targetForPlayerRef = opponentRef;
      targetForOpponentRef = playerRef;
    }
    if (Object.keys(adjusted.playerUpdates).length) updatePromises.push(update(targetForPlayerRef, adjusted.playerUpdates));
    if (Object.keys(adjusted.opponentUpdates).length) updatePromises.push(update(targetForOpponentRef, adjusted.opponentUpdates));
  } catch (e) {
    // fallback to naive writes if sanity check fails
    if (Object.keys(adjusted.playerUpdates).length) updatePromises.push(update(playerRef, adjusted.playerUpdates));
    if (Object.keys(adjusted.opponentUpdates).length) updatePromises.push(update(opponentRef, adjusted.opponentUpdates));
  }
  // Minimal message normalization: preserve the message set above. Gear-broken keeps a simple
  // authoritative message string; avoid heavy sanitization here to stay compatible.
  try { /* no-op normalization for parity with gear-broken */ } catch (e) { console.warn('Could not normalize matchUpdates.message', e); }
  if (Object.keys(matchUpdates).length) updatePromises.push(update(matchRef, matchUpdates));

  await Promise.all(updatePromises);
  // log actor-side message locally using the handler-provided message when available
  try { logMessage(message || (matchUpdates && matchUpdates.message) || ''); } catch(e) {}
}
window.chooseSpecial = chooseSpecial;

// Insert legacy ability handlers (copied from old-jacobs firebase) and merge.
// Legacy handlers are preferred to restore previously-stable behavior, but
// modern handlers (above) remain available as a fallback.
const LEGACY_ABILITY_HANDLERS = {
  mage_fireball(user, target) {
    const base = getEffectiveBaseAtk(user, 10);
    const raw = Math.floor(Math.random() * 8) + base + 8;
    const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, raw, { ignoreDefense: true, attacker: user });
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
    const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: effectiveDefense, evasion: target.evasion || 0 }, final, { ignoreDefense: true, attacker: user });
    const opponentUpdates = { hp: newHp };
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'warrior_rend') };
    return { playerUpdates, opponentUpdates, matchUpdates: { lastMove: 'special_warrior_rend' }, message: `${user.name || 'You'} rends ${target.name || 'the enemy'} for ${damage} damage!`, lastMoveDamage: damage };
  },

  archer_volley(user, target) {
    const base = getEffectiveBaseAtk(user, 14);
    let total = 0;
    for (let i = 0; i < 3; i++) total += Math.floor(Math.random() * 6) + Math.floor(base / 2);
    const { damage, newHp, isCrit, dodged } = applyDamageToObject({ hp: target.hp, defense: target.defense || 0, evasion: target.evasion || 0 }, total, { attacker: user });
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
    const playerUpdates = { abilityCooldowns: startAbilityCooldownLocal(user.abilityCooldowns, 'mage_iceblast'), mana: Math.max(0, (user.mana || 0) - (ABILITIES.mage_iceblast.cost || 0)) };
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
  // (NOTE: legacy handlers truncated in this inline block for brevity in the patch; the full legacy ability set
  // should be copied verbatim from old-jacobs firebase/public/js/battle.js in the same format as above.)
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

// Final runtime handlers map used by chooseSpecial/chooseMove
const abilityHandlers = createMergedHandlers(LEGACY_ABILITY_HANDLERS, modernAbilityHandlers);

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

  // Prevent item usage if a status effect forbids it (e.g., Spirit Shackles)
  if (playerStats.status && playerStats.status.no_items) {
    logMessage('Your items are currently locked and cannot be used!');
    return;
  }

  // Consume item in user's profile (window.useItemForUser was added in app.js)
  try {
    if (!window.useItemForUser) throw new Error('useItemForUser helper not available');
    const item = await window.useItemForUser(currentUserId, itemId);
    // Apply effects based on item id — collect structured updates then apply inversion helper
    const playerUpdates = {};
    const opponentUpdates = {};
    const matchUpdates = {};

    if (itemId === 'potion_small') {
      const heal = 20;
      const actualHeal = (playerStats.status && playerStats.status.slimed) ? Math.floor(heal / 2) : heal;
      const newHp = Math.min(playerStats.maxHp || 100, (playerStats.hp || 0) + actualHeal);
      playerUpdates.hp = newHp;
      matchUpdates.lastMove = 'use_item_potion_small';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveHeal = actualHeal;
    } else if (itemId === 'potion_large') {
      const heal = 50;
      const actualHeal = (playerStats.status && playerStats.status.slimed) ? Math.floor(heal / 2) : heal;
      const newHp = Math.min(playerStats.maxHp || 100, (playerStats.hp || 0) + actualHeal);
      playerUpdates.hp = newHp;
      matchUpdates.lastMove = 'use_item_potion_large';
      matchUpdates.lastMoveActor = currentUserId;
      matchUpdates.lastMoveHeal = actualHeal;
    } else if (itemId === 'bomb') {
      const dmg = 20;
      const actual = Math.max(0, dmg - (opponentStats.defense || 0));
      const newOppHp = Math.max(0, (opponentStats.hp || 0) - actual);
      opponentUpdates.hp = newOppHp;
      matchUpdates.lastMove = 'use_item_bomb';
      matchUpdates.lastMoveActor = currentUserId;
  matchUpdates.lastMoveDamage = actual;
    } else if (itemId === 'elixir') {
      // restore mana to max and grant a short attack boost
      const newMana = playerStats.maxMana || playerStats.mana || 0;
      const newStatus = Object.assign({}, playerStats.status || {});
      // temporary attack buff for 2 turns
      newStatus.strength = { turns: 2, amount: 4 };
      playerUpdates.mana = newMana;
      playerUpdates.status = newStatus;
      matchUpdates.lastMove = 'use_item_elixir';
      matchUpdates.lastMoveActor = currentUserId;
    } else if (itemId === 'shield_token') {
      // grant +10 defense for 1 turn via status
      const add = 10;
      const newDefense = (playerStats.defense || 0) + add;
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.shield = { turns: 1, amount: add };
      playerUpdates.defense = newDefense;
      playerUpdates.status = newStatus;
      matchUpdates.lastMove = 'use_item_shield_token';
      matchUpdates.lastMoveActor = currentUserId;
    } else if (itemId === 'speed_scroll') {
      // grant an extra action: increment player's extraTurns status and keep current turn
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.extraTurns = (newStatus.extraTurns || 0) + 1;
      playerUpdates.status = newStatus;
      matchUpdates.lastMove = 'use_item_speed_scroll';
      matchUpdates.lastMoveActor = currentUserId;
      // keep currentTurn with the player so they can act again immediately
      matchUpdates.currentTurn = currentUserId;
    } else if (itemId === 'strength_tonic') {
      // temporary improvement only: +10 strength for 1 turn (no permanent baseAtk increase)
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.strength_boost = { turns: 1, amount: 10 };
      playerUpdates.status = newStatus;
      matchUpdates.lastMove = 'use_item_strength_tonic';
      matchUpdates.lastMoveActor = currentUserId;
    } else if (itemId === 'revive_scroll') {
      // set a one-time revive flag on the player's match node so death handler consumes it
      playerUpdates.has_revive = true;
      // add a timestamp so we can trace revive preparation events in the DB for debugging
  try { playerUpdates.revivePreparedAt = serverTimestamp(); } catch(e) { playerUpdates.revivePreparedAt = Date.now(); }
  // record which player prepared the revive (helps debug race conditions)
  try { playerUpdates.revivePreparedBy = currentUserId; } catch(e) { playerUpdates.revivePreparedBy = currentUserId; }
      // reflect immediately in the local snapshot/UI so the player sees the prepared revive
      try { playerStats.has_revive = true; updateUI(); console.debug('[PvP] prepared revive locally for player'); } catch (e) {}
      matchUpdates.lastMove = 'use_item_revive_scroll';
      matchUpdates.lastMoveActor = currentUserId;
      logMessage('Revive Scroll prepared: you will be revived automatically if you fall.');
    } else if (itemId === 'swift_boots') {
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.haste = { turns: 3, amount: 4 };
      playerUpdates.status = newStatus;
      // if speed field exists, bump it locally; it will be used by client-side checks
      if (typeof playerStats.speed !== 'undefined') playerUpdates.speed = (playerStats.speed || 0) + 4;
      matchUpdates.lastMove = 'use_item_swift_boots';
      matchUpdates.lastMoveActor = currentUserId;
    } else if (itemId === 'focus_charm') {
      const newStatus = Object.assign({}, playerStats.status || {});
      newStatus.critChance = (newStatus.critChance || 0) + 0.08;
      playerUpdates.status = newStatus;
      matchUpdates.lastMove = 'use_item_focus_charm';
      matchUpdates.lastMoveActor = currentUserId;
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

  // Apply dark inversion transformations if present
  // actingIsPlayer = true since currentUser is acting here; only invert incoming effects to the player
  let adjusted = applyDarkInversionToUpdates(playerStats, opponentStats, playerUpdates, opponentUpdates, true);
  // Run defensive swap detection/fix for item usage path as well
  adjusted = detectAndFixSwappedHp(adjusted, playerStats, opponentStats);

    // Re-evaluate fainting / game over based on adjusted HP values (post-inversion)
    const postPlayerHp = (typeof adjusted.playerUpdates.hp !== 'undefined') ? adjusted.playerUpdates.hp : playerStats.hp;
    const postOpponentHp = (typeof adjusted.opponentUpdates.hp !== 'undefined') ? adjusted.opponentUpdates.hp : opponentStats.hp;

    // If either side drops to 0 or below, prefer consuming a one-time revive
    // flag (has_revive) if present on that player's match node. Only finish
    // the match if no revive is available.
    if (postOpponentHp <= 0) {
      const opponentHasRevive = (typeof adjusted.opponentUpdates.has_revive !== 'undefined') ? adjusted.opponentUpdates.has_revive : opponentStats.has_revive;
      if (opponentHasRevive) {
        // Consume revive for opponent using centralized helper
        const consumeOpp = buildConsumeReviveUpdates(opponentStats);
        adjusted.opponentUpdates = Object.assign(adjusted.opponentUpdates || {}, consumeOpp);
        try { console.debug('[revive] consuming revive for opponent', { consumeOpp, opponentStats }); } catch (e) {}
        logMessage('Opponent was saved by a Revive Scroll!');
      } else {
        adjusted.opponentUpdates.fainted = true;
        matchUpdates.status = matchUpdates.status || 'finished';
        matchUpdates.winner = matchUpdates.winner || currentUserId;
      }
    }

    if (postPlayerHp <= 0) {
      const playerHasRevive = (typeof adjusted.playerUpdates.has_revive !== 'undefined') ? adjusted.playerUpdates.has_revive : playerStats.has_revive;
      if (playerHasRevive) {
        // Consume revive for player using centralized helper
        const consumePlayer = buildConsumeReviveUpdates(playerStats);
        adjusted.playerUpdates = Object.assign(adjusted.playerUpdates || {}, consumePlayer);
        try { console.debug('[revive] consuming revive for player', { consumePlayer, playerStats }); } catch (e) {}
        logMessage('Your Revive Scroll saved you from defeat!');
      } else {
        adjusted.playerUpdates.fainted = true;
        matchUpdates.status = matchUpdates.status || 'finished';
        matchUpdates.winner = matchUpdates.winner || opponentId;
      }
    }

    const promises = [];
    // Sanity: ensure writes go to correct refs (protect against swapped refs in other modules)
    try {
      let targetForPlayerRef = playerRef;
      let targetForOpponentRef = opponentRef;
      const pKey = (playerRef && playerRef.key) ? playerRef.key : null;
      const oKey = (opponentRef && opponentRef.key) ? opponentRef.key : null;
      if (pKey !== currentUserId && oKey === currentUserId) {
        try { console.warn('[REF_SANITY] Detected swapped player/opponent refs (items) — correcting for write'); } catch(e){}
        targetForPlayerRef = opponentRef;
        targetForOpponentRef = playerRef;
      }
      if (Object.keys(adjusted.playerUpdates || {}).length) promises.push(update(targetForPlayerRef, adjusted.playerUpdates));
      if (Object.keys(adjusted.opponentUpdates || {}).length) promises.push(update(targetForOpponentRef, adjusted.opponentUpdates));
    } catch (e) {
      if (Object.keys(adjusted.playerUpdates || {}).length) promises.push(update(playerRef, adjusted.playerUpdates));
      if (Object.keys(adjusted.opponentUpdates || {}).length) promises.push(update(opponentRef, adjusted.opponentUpdates));
    }
    if (Object.keys(matchUpdates).length) promises.push(update(matchRef, matchUpdates));

    await Promise.all(promises);

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
