// Minimal gear/armory system
// Gear slots: helmet, chestplate, left_greave, right_greave, pants, boots, ring1, ring2, necklace, weapon1, weapon2
// Each gear item: { id, name, slot, baseStatName, baseStatValue, rand1, rand2, rarity, createdAt }
(function(global) {
  const STORAGE_KEY = 'armory_v1';
  // Updated slots per user request. Two ring slots (either may hold a ring) and explicit left/right weapon slots
  // Reduced slot set: keep armor/accessory slots, add left/right weapon and one ranged slot + shield
  const SLOTS = ['helmet','chestplate','bracers','pants','boots','ring1','ring2','necklace','left_weapon','right_weapon','ranged','shield'];
  const RARITIES = [ 'common', 'uncommon', 'rare', 'epic', 'legendary' ];
  const ELEMENTS = ['fire','electric','ice','wind','earth','neutral'];
  // Generation-time scaling: bake multipliers into generated items so displayed
  // item numbers reflect effective stats (HP x3, defense x1.4). Modifier-time
  // scaling is disabled to avoid double-application.
  const GEN_HP_FACTOR = 4.0; // multiply HP baseStatValue by 4 at generation (increase HP power)
  const GEN_DEFENSE_FACTOR = 1.4; // multiply defense baseStatValue by 1.4 at generation

  // Runtime modifier scaling (disabled; handled at generation)
  const ATTACK_FACTOR = 1.0; // no attack scaling at modifier time
  const DEFENSE_FACTOR = 1.0; // no defense scaling at modifier time
  const HP_FACTOR = 1.0; // no HP scaling at modifier time
  // Secondary types and a compact choice space: 10 unique secondary types X 3 variants = 30 choices
  // Order secondary types so index ranges map as: 0-2=lifesteal, 3-5=regen, 6-8=attack, etc.
  const SECONDARY_TYPES = ['lifesteal','regen','attack','defense','hp','speed','critChance','evasion','accuracy','pierce','maxHpPercent'];
  const SECONDARY_VARIANT_COUNT = 3; // low/mid/high

  // Interpret a compact secondary choice index into a { type, value } pair using the item's base stat value.
  function interpretSecondaryChoice(choiceIdx, baseVal) {
    if (typeof choiceIdx !== 'number' || isNaN(choiceIdx)) return null;
    const total = SECONDARY_TYPES.length * SECONDARY_VARIANT_COUNT;
    if (choiceIdx < 0 || choiceIdx >= total) return null;
    const typeIdx = Math.floor(choiceIdx / SECONDARY_VARIANT_COUNT);
    const variant = choiceIdx % SECONDARY_VARIANT_COUNT; // 0=low,1=mid,2=high
    const type = SECONDARY_TYPES[typeIdx] || 'attack';
    baseVal = Number(baseVal || 1) || 1;
    let value = 0;
    // deterministic scales so interpretation is stable (no extra randomness on display)
    switch (type) {
      case 'attack': {
        // Reduce attack secondary contributions so items don't dominate damage output.
        // Smaller scales than before to keep weapons from blowing out damage.
        const scales = [0.05, 0.12, 0.22];
        value = Math.max(0, Math.round(baseVal * scales[variant]));
      } break;
      case 'defense': {
        // Balanced defense contributions: still meaningful but less spiky than before.
        const scales = [0.4, 0.8, 1.2];
        value = Math.max(0, Math.round(baseVal * scales[variant]));
      } break;
      case 'hp': {
        // Balanced HP secondaries: meaningful but capped to avoid runaway health
        const scales = [1.0, 1.8, 3.0];
        value = Math.max(1, Math.round(baseVal * scales[variant]));
      } break;
      case 'speed': {
        const scales = [0.05, 0.1, 0.18];
        value = Math.max(1, Math.round(baseVal * scales[variant]));
      } break;
      case 'critChance':
      case 'evasion':
      case 'lifesteal': {
        // Use smaller, clearer percentage steps: low=1%, mid=2%, high=3%
        const scales = [0.01, 0.02, 0.03];
        value = +(Math.round(scales[variant] * 10000) / 10000) || scales[variant];
      } break;
      case 'accuracy': {
        // Accuracy is a direct counter to evasion. Provide small fractional accuracy values.
        const scales = [0.02, 0.04, 0.06];
        value = +(Math.round(scales[variant] * 10000) / 10000) || scales[variant];
      } break;
      case 'regen': {
        const scales = [0.12, 0.3, 0.6];
        value = Math.max(1, Math.round(baseVal * scales[variant]));
      } break;
      case 'pierce': {
        const vals = [1,2,3]; value = vals[variant];
      } break;
      case 'maxHpPercent': {
        // Increase percentage bonus for max HP to make HP-focused gear more impactful
        const vals = [5,10,20]; value = vals[variant];
      } break;
      default: value = 0; break;
    }
    return { type, value };
  }

  function uid() { return 'g_' + Math.random().toString(36).slice(2,10); }

  function loadArmory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) || [];
    } catch (e) { return []; }
  }
  function saveArmory(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list || [])); } catch (e) { console.error('saveArmory failed', e); }
  }

  function randomBetween(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }

  // returns base ranges per slot
  function slotBaseRange(slot) {
    switch(slot) {
      // Armor pieces: boost base ranges so armor has meaningful impact across rarities
      case 'helmet': return { stat: 'defense', min: 2, max: 8 };
  case 'chestplate': return { stat: 'defense', min: 5, max: 14 };
  case 'bracers': return { stat: 'attack', min: 1, max: 5 };
      case 'pants': return { stat: 'defense', min: 2, max: 8 };
      // boots should be noticeably better so they matter in early loot
  case 'boots': return { stat: 'defense', min: 3, max: 7 };
      // rings provide modest attack bonuses but slightly bumped
  case 'ring1': case 'ring2': return { stat: 'hp', min: 10, max: 22 };
      // necklaces/amulets act as regen items (HP regen / mana regen)
      case 'necklace': return { stat: 'regen', min: 2, max: 10 };
      // weapons: left and right weapon slots and one ranged slot (unchanged attack ranges)
      // Reduce weapon base attack ranges so items are less likely to blow out damage values.
    case 'left_weapon': case 'right_weapon': return { stat: 'attack', min: 2, max: 8 };
  case 'ranged': return { stat: 'attack', min: 2, max: 7 };
      // shields now stronger
  case 'shield': return { stat: 'defense', min: 3, max: 10 };
      default: return { stat: 'defense', min: 1, max: 3 };
    }
  }

  function pickRarity() {
    const roll = Math.random();
    if (roll < 0.70) return 'common';
    if (roll < 0.90) return 'uncommon';
    if (roll < 0.95) return 'rare';
    if (roll < 0.99) return 'epic';
    return 'legendary';
  }

  function rarityMultiplier(r) {
    switch(r) {
      case 'common': return 1.0;
      case 'uncommon': return 1.15;
      case 'rare': return 1.35;
      case 'epic': return 1.6;
      case 'legendary': return 2.0;
    }
    return 1;
  }

  function prettyName(slot, rarity) {
    // Accept either a slot string or a full item object as first argument.
    // If an item object is passed we can produce an adjective based on element/secondaries/enchant.
    let item = null;
    let slotName = slot;
    if (slot && typeof slot === 'object') {
      item = slot;
      slotName = (item.slot || '').toString();
      rarity = rarity || item.rarity || 'common';
    }
    const s = (slotName || '').toString().toLowerCase();

    // map technical slots to concrete user-facing names
    const SLOT_MAP = {
      left_weapon: ['sword','spear','axe','mace','hammer','dagger','staff'],
      right_weapon: ['sword','spear','axe','mace','hammer','dagger','staff'],
      ranged: ['bow','crossbow','gun'],
      sword: ['sword'], spear: ['spear'], axe: ['axe'], hammer: ['hammer'], mace: ['mace'], staff: ['staff'], dagger: ['dagger'],
      bow: ['bow'], crossbow: ['crossbow'], gun: ['gun'],
      shield: ['shield'], bracers: ['bracers'], boots: ['boots'], necklace: ['necklace'], ring1: ['rings'], ring2: ['rings'], chestplate: ['chestplate'], helmet: ['helmet'], pants: ['leggings'], leggings: ['leggings']
    };

    // deterministic chooser: use item.id hash when available; otherwise fall back to slot order
    const pickFrom = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return 'item';
      if (item && item.id) {
        // simple deterministic hash from id
        let h = 0; for (let i=0;i<item.id.length;i++) h = (h * 31 + item.id.charCodeAt(i)) >>> 0;
        return arr[h % arr.length];
      }
      return arr[0];
    };

    const baseCandidates = SLOT_MAP[s] || SLOT_MAP[s.replace(/s$/,'')] || ['item'];
    const base = pickFrom(baseCandidates);

    // Build adjective list based on element and secondaries (if item provided)
    const adjs = [];
    if (item) {
      const el = (item.element || '').toLowerCase();
      const ELEM_ADJ = { fire: 'Fiery', electric: 'Shocking', lightning: 'Shocking', ice: 'Icy', wind: 'Gale', earth: 'Earthen', neutral: '' };
      if (ELEM_ADJ[el]) adjs.push(ELEM_ADJ[el]);

      // inspect secondaries (prefer named randStats, fall back to legacy inference)
      const secList = Array.isArray(item.randStats) && item.randStats.length ? item.randStats.map(rs => {
        if (!rs) return null; if (typeof rs.choice !== 'undefined') return interpretSecondaryChoice(Number(rs.choice), Number(item.baseStatValue||0)); if (typeof rs.type !== 'undefined') return { type: rs.type, value: Number(rs.value||0) }; return null;
      }).filter(Boolean) : inferLegacyRandStats(item) || [];

      // select prominent secondary types
      const types = (secList || []).map(s2 => s2.type);
      if (types.indexOf('lifesteal') !== -1) adjs.push('Vampiric');
      else if (types.indexOf('regen') !== -1) adjs.push('Regenerative');
      else if (types.indexOf('critChance') !== -1) adjs.push('Keen');
      else if (types.indexOf('speed') !== -1) adjs.push('Swift');
      else if (types.indexOf('pierce') !== -1) adjs.push('Piercing');
      else if (types.indexOf('defense') !== -1) adjs.push('Reinforced');
      else if (types.indexOf('hp') !== -1 || types.indexOf('maxHpPercent') !== -1) adjs.push('Stout');

      // supercharged detection: if enchants target a secondary on this item, make the descriptor stronger
      try {
        if (Array.isArray(item.enchants) && item.enchants.length) {
          const present = {};
          for (const it of secList) if (it && it.type) present[it.type] = true;
          for (const e of item.enchants) {
            if (!e || !e.type) continue;
            if (present[e.type] || (e.type === 'supercharge' && e.target && present[e.target])) {
              // push a stronger adjective to highlight supercharged items
              adjs.unshift('Supercharged');
              break;
            }
          }
        }
      } catch (e) {}
    }

    // Compose final name: Rarity + adjectives + base. Avoid double spaces.
    const rarityLabel = (rarity || 'common');
    const capRarity = rarityLabel.charAt(0).toUpperCase() + rarityLabel.slice(1);
    const adjStr = adjs.filter(Boolean).join(' ');
    return `${capRarity}${adjStr ? ' ' + adjStr : ''} ${base}`.trim();
  }

  function generateGear(slot, forcedRarity) {
    if (!SLOTS.includes(slot)) slot = SLOTS[Math.floor(Math.random()*SLOTS.length)];
    const rarity = forcedRarity || pickRarity();
    const rmul = rarityMultiplier(rarity);
  const base = slotBaseRange(slot);
  const baseVal = Math.max(1, Math.round(randomBetween(base.min, base.max) * rmul));
  // Apply generation-time scaling so HP/defense show their effective values on the item
  let scaledBaseVal = baseVal;
  if (base.stat === 'hp') scaledBaseVal = Math.max(1, Math.round(baseVal * GEN_HP_FACTOR));
  else if (base.stat === 'defense') scaledBaseVal = Math.max(1, Math.round(baseVal * GEN_DEFENSE_FACTOR));
  // two randomized secondary choice indexes (compact choice space 0..totalChoices-1)
  const totalChoices = SECONDARY_TYPES.length * SECONDARY_VARIANT_COUNT;
  const rand1 = Math.floor(Math.random() * totalChoices);
  const rand2 = Math.floor(Math.random() * totalChoices);
    // named secondary choices (compact): pick up to two choices from a 30-entry space
    // each choice is an integer index (0..(SECONDARY_TYPES.length*SECONDARY_VARIANT_COUNT-1)).
    // We store the index so display/interpretation can be deterministic and centralized.
  // totalChoices already computed above for rand1/rand2 generation
    const availableChoices = [];
    for (let i = 0; i < totalChoices; i++) availableChoices.push(i);
    // try to avoid picking a secondary whose type equals the base stat when possible
    // build a shimmed available list that deprioritizes variants of the base stat
    const baseStatType = base.stat;
    const chooseIndex = () => {
      if (!availableChoices.length) return null;
      // If the item's primary is attack, bias secondaries toward hp/defense occasionally
      if (baseStatType === 'attack') {
        try {
          const biased = availableChoices.filter(c => {
            const t = SECONDARY_TYPES[Math.floor(c / SECONDARY_VARIANT_COUNT)];
            return t === 'hp' || t === 'defense';
          });
          // 60% chance to pick a HP/DEF biased secondary when available
          if (biased.length && Math.random() < 0.6) {
            const pick = biased[Math.floor(Math.random() * biased.length)];
            const idx = availableChoices.indexOf(pick);
            if (idx !== -1) availableChoices.splice(idx, 1);
            return pick;
          }
        } catch (e) {}
      }
      // attempt up to 4 tries to pick a non-base-type choice
      for (let attempt = 0; attempt < 4; attempt++) {
        const idx = Math.floor(Math.random() * availableChoices.length);
        const c = availableChoices[idx];
        const type = SECONDARY_TYPES[Math.floor(c / SECONDARY_VARIANT_COUNT)];
        if (type !== baseStatType) {
          availableChoices.splice(idx, 1);
          return c;
        }
      }
      // fallback: just pop a random remaining
      const idx = Math.floor(Math.random() * availableChoices.length);
      return availableChoices.splice(idx, 1)[0];
    };
    const randStats = [];
    for (let i = 0; i < 2; i++) {
      const choice = chooseIndex();
      if (choice === null || typeof choice === 'undefined') break;
      randStats.push({ choice });
    }
    // element affinity
    const element = ELEMENTS[Math.floor(Math.random()*ELEMENTS.length)];
    const item = {
      id: uid(),
      name: prettyName(slot, rarity) + ' (' + element.charAt(0).toUpperCase() + element.slice(1) + ')',
      slot,
      baseStatName: base.stat,
      // store scaled base stat so UI reflects effective stat values
      baseStatValue: scaledBaseVal,
      element,
  rand1,
  rand2,
  // backward-compatible: keep rand1/rand2, and store compact secondary choices in randStats
  randStats,
      rarity,
      enchants: [],
      createdAt: Date.now()
    };
    // attach random enchants based on rarity and scaled with rarity multiplier
    try {
  // allow enchants that can target secondaries as well
  const enchantPool = ['regen','lifesteal','critChance','critDamage','evasion','maxHpPercent','speed','pierce','manaRegen'];
      // determine enchant count range per rarity (min,max)
      const rarityEnchantRange = {
        common: [0,0],
        uncommon: [0,1],
        rare: [1,2],
        epic: [1,3],
        legendary: [2,4]
      };
      const range = rarityEnchantRange[rarity] || [0,0];
      const add = randomBetween(range[0], range[1]);
      // sample unique enchants where possible
      const pool = enchantPool.slice();
      for (let i=0;i<add && pool.length>0;i++) {
        const idx = Math.floor(Math.random()*pool.length);
        const type = pool.splice(idx,1)[0];
        let val = 0;
        // scale values with rarity multiplier (rmul)
        switch(type) {
          case 'regen':
            // small HP per turn, scales with scaledBaseVal
            val = randomBetween(1, Math.max(1, Math.round(Math.max(1, scaledBaseVal * 0.12) * rmul)));
            break;
          case 'lifesteal':
            // fractional lifesteal (0.02 - 0.10) scaled by rarity, keep as fraction
            {
              const minF = 0.02 * rmul;
              const maxF = Math.min(0.35, 0.10 * rmul);
              val = +(Math.round((Math.random() * (maxF - minF) + minF) * 10000) / 10000);
            }
            break;
          case 'critChance':
            // small fractional chance
            {
              const minF = 0.01 * rmul;
              const maxF = Math.min(0.5, 0.06 * rmul);
              val = +(Math.round((Math.random() * (maxF - minF) + minF) * 10000) / 10000);
            }
            break;
          case 'critDamage':
            // percent points added to crit damage (e.g., +10 => +10%)
            val = Math.round((Math.random() * 30 + 10) * rmul);
            break;
          case 'evasion':
            {
              const minF = 0.01 * rmul;
              const maxF = Math.min(0.5, 0.06 * rmul);
              val = +(Math.round((Math.random() * (maxF - minF) + minF) * 10000) / 10000);
            }
            break;
          case 'maxHpPercent':
            val = Math.round((Math.random() * 6 + 2) * rmul);
            break;
          default:
            val = 0;
        }
        item.enchants.push({ type, value: val });
      }
    } catch(e) { console.error('generateGear enchant error', e); }
    return item;
  }

  function addGearToArmory(item) {
    const list = loadArmory();
    list.push(item);
    saveArmory(list);
    return item;
  }

  function getEquipMap() {
    try { return JSON.parse(localStorage.getItem('armory_equip_v1') || '{}') || {}; } catch (e) { return {}; }
  }

  function getEquippedItems() {
    const eq = getEquipMap();
    const list = loadArmory();
    const out = [];
    for (const slot in eq) {
      const id = eq[slot];
      const found = list.find(x => x.id === id);
      if (found) out.push(found);
    }
    return out;
  }

    // Compute a conservative element-power number for an item used to derive proc chances.
    // Uses baseStatValue plus any numeric secondary contributions (attack/defense/hp/speed/pierce).
    function computeItemElementPower(item) {
    try {
      const baseV = Number(item.baseStatValue || 0) || 0;
      let power = baseV;
        const addFromInterp = (interp) => {
          if (!interp || typeof interp.type === 'undefined') return 0;
          const t = interp.type;
          const v = Number(interp.value || 0) || 0;
          // Only include numeric-magnitude secondaries that reasonably contribute to element power
          if (t === 'attack' || t === 'defense' || t === 'hp' || t === 'speed' || t === 'pierce') return v;
          // percent-like stats (critChance, lifesteal, evasion, etc.) are omitted to avoid inflating power
          return 0;
        };

        if (Array.isArray(item.randStats) && item.randStats.length) {
          for (const rs of item.randStats) {
            if (!rs) continue;
            let interp = null;
            if (typeof rs.choice !== 'undefined') interp = interpretSecondaryChoice(Number(rs.choice), baseV);
            else if (typeof rs.type !== 'undefined') interp = { type: rs.type, value: Number(rs.value || 0) };
            power += addFromInterp(interp);
          }
        } else {
          // fallback: try to infer legacy rand stats and sum numeric ones
          const inferred = inferLegacyRandStats(item) || [];
          for (const inf of inferred) power += addFromInterp(inf);
          // Note: do NOT blindly add raw rand1/rand2 indices as numeric power because
          // in the compact choice representation rand1/rand2 are indexes (0..N-1).
        }
        // Reduce elemental power so elements remain impactful but do not overpower direct stats.
        // Scale down by ~45% to make proc chances and DOTs more conservative.
        return Math.max(0, Math.round(power * 0.45));
      } catch (e) { return Number(item.baseStatValue || 0) || 0; }
    }

  function computeEquipModifiers() {
  const equipped = getEquippedItems();
  const mods = { attack: 0, defense: 0, hp: 0, elements: {}, accuracy: 0 };
    for (const it of equipped) {
      // Prefer new randStats when present; otherwise infer named secondaries from legacy rand1/rand2
      const baseV = Number(it.baseStatValue || 0);
      let usedRandStats = null;
    if (Array.isArray(it.randStats) && it.randStats.length) {
        // first add primary base value to the stat implied by baseStatName
  const stat = (it.baseStatName || '').toLowerCase();
  if (stat.indexOf('attack') !== -1 || stat.indexOf('atk') !== -1) mods.attack += Math.round(baseV * ATTACK_FACTOR);
  else if (stat.indexOf('def') !== -1) mods.defense += Math.round(baseV * DEFENSE_FACTOR);
  else if (stat.indexOf('hp') !== -1) mods.hp += Math.round(baseV * HP_FACTOR);
  else if (stat.indexOf('regen') !== -1) { mods.regenPerTurn = (mods.regenPerTurn || 0) + baseV; mods.manaRegen = (mods.manaRegen || 0) + Math.max(0, Math.round(baseV * 0.5)); }
  else mods.defense += Math.round(baseV * DEFENSE_FACTOR);
        // apply each named secondary appropriately — support both legacy {type,value} and compact {choice}
        for (const rs of it.randStats) {
          if (!rs) continue;
          let interp = null;
          if (typeof rs.choice !== 'undefined') interp = interpretSecondaryChoice(Number(rs.choice), baseV);
          else if (typeof rs.type !== 'undefined') interp = { type: rs.type, value: Number(rs.value || 0) };
          if (!interp) continue;
          const val = Number(interp.value || 0);
          if (interp.type === 'attack') mods.attack += Math.round(Number(val || 0) * ATTACK_FACTOR);
          else if (interp.type === 'defense') mods.defense += Math.round(Number(val || 0) * DEFENSE_FACTOR);
          else if (interp.type === 'hp') mods.hp += Math.round(Number(val || 0) * HP_FACTOR);
          else if (interp.type === 'accuracy') mods.accuracy = (mods.accuracy || 0) + val;
          else {
            mods[interp.type] = (mods[interp.type] || 0) + val;
          }
        }
        usedRandStats = it.randStats;
      } else {
        // infer randStats from legacy rand1/rand2
        const inferred = inferLegacyRandStats(it);
        usedRandStats = inferred;
  const stat = (it.baseStatName || '').toLowerCase();
  // primary base always applies to canonical stat (apply scaling factors)
  if (stat.indexOf('attack') !== -1 || stat.indexOf('atk') !== -1) mods.attack += Math.round(baseV * ATTACK_FACTOR);
  else if (stat.indexOf('def') !== -1) mods.defense += Math.round(baseV * DEFENSE_FACTOR);
  else if (stat.indexOf('hp') !== -1) mods.hp += Math.round(baseV * HP_FACTOR);
  else if (stat.indexOf('regen') !== -1) { mods.regenPerTurn = (mods.regenPerTurn || 0) + baseV; mods.manaRegen = (mods.manaRegen || 0) + Math.max(0, Math.round(baseV * 0.5)); }
  else mods.defense += Math.round(baseV * DEFENSE_FACTOR);
        for (const rs of inferred) {
          if (!rs) continue;
          const val = Number(rs.value || 0);
          if (rs.type === 'attack') mods.attack += Math.round(val * ATTACK_FACTOR);
          else if (rs.type === 'defense') mods.defense += Math.round(val * DEFENSE_FACTOR);
          else if (rs.type === 'hp') mods.hp += Math.round(val * HP_FACTOR);
          else mods[rs.type] = (mods[rs.type] || 0) + val;
        }
      }
  // element aggregation: increase element power by a conservative total derived from the item
  const el = (it.element || 'neutral');
  // compute element power without treating rand1/rand2 as raw numeric indexes
  const elemTotal = computeItemElementPower(it) || 0;
  mods.elements[el] = (mods.elements[el] || 0) + elemTotal;
      // process enchants for equipped item
      if (Array.isArray(it.enchants)) {
        const randMap = {};
        if (Array.isArray(it.randStats)) for (const rs of it.randStats) {
          if (!rs) continue;
          if (typeof rs.choice !== 'undefined') {
            const ip = interpretSecondaryChoice(Number(rs.choice), baseV);
            if (ip && ip.type) randMap[ip.type] = Number(ip.value || 0);
          } else if (typeof rs.type !== 'undefined') {
            randMap[rs.type] = Number(rs.value || 0);
          }
        }
        for (const e of it.enchants) {
          if (!e || !e.type) continue;
          const t = e.type;
          if (typeof randMap[t] !== 'undefined') {
            const base = Number(randMap[t] || 0);
            switch(t) {
              case 'lifesteal': mods.lifestealPercent = (mods.lifestealPercent || 0) + (base * 2); mods.vampirismChance = (mods.vampirismChance || 0) + 0.5; mods.vampirismDamage = (mods.vampirismDamage || 0) + 6; break;
              case 'regen': mods.regenPerTurn = (mods.regenPerTurn || 0) + (base * 2); mods.regeneratorChance = (mods.regeneratorChance || 0) + 0.25; break;
              case 'critChance': mods.critChance = (mods.critChance || 0) + (base * 2); mods.executeChance = (mods.executeChance || 0) + 0.15; mods.executeDamage = (mods.executeDamage || 0) + 10; break;
              case 'critDamage': mods.critDamageBonus = (mods.critDamageBonus || 0) + (base * 2); mods.critOverkill = (mods.critOverkill || 0) + 0.2; break;
              case 'evasion': mods.evasion = (mods.evasion || 0) + (base * 2); mods.counterChance = (mods.counterChance || 0) + 0.25; mods.counterDamage = (mods.counterDamage || 0) + 6; break;
              case 'accuracy': mods.accuracy = (mods.accuracy || 0) + (base * 2); break;
              case 'maxHpPercent': mods.maxHpPercent = (mods.maxHpPercent || 0) + (base * 2); mods.reflectPercent = (mods.reflectPercent || 0) + 0.05; break;
              case 'speed': mods.speed = (mods.speed || 0) + (base * 2); mods.extraActionChance = (mods.extraActionChance || 0) + 0.15; break;
              case 'pierce': mods.pierce = (mods.pierce || 0) + (base * 2); mods.ignoreDefenseChance = (mods.ignoreDefenseChance || 0) + 0.20; break;
              case 'manaRegen': mods.manaRegen = (mods.manaRegen || 0) + (base * 2); mods.manaShieldChance = (mods.manaShieldChance || 0) + 0.2; break;
              default: break;
            }
            continue;
          }
          // normal enchant processing
          switch(t) {
            case 'regen': mods.regenPerTurn = (mods.regenPerTurn || 0) + Number(e.value || 0); break;
            case 'lifesteal': mods.lifestealPercent = (mods.lifestealPercent || 0) + Number(e.value || 0); break;
            case 'critChance': mods.critChance = (mods.critChance || 0) + Number(e.value || 0); break;
            case 'critDamage': mods.critDamageBonus = (mods.critDamageBonus || 0) + Number(e.value || 0); break;
            case 'evasion': mods.evasion = (mods.evasion || 0) + Number(e.value || 0); break;
            case 'accuracy': mods.accuracy = (mods.accuracy || 0) + Number(e.value || 0); break;
            case 'maxHpPercent': mods.maxHpPercent = (mods.maxHpPercent || 0) + Number(e.value || 0); break;
            case 'speed': mods.speed = (mods.speed || 0) + Number(e.value || 0); break;
            case 'pierce': mods.pierce = (mods.pierce || 0) + Number(e.value || 0); break;
            case 'manaRegen': mods.manaRegen = (mods.manaRegen || 0) + Number(e.value || 0); break;
            default: break;
          }
        }
      }
    }
    return mods;
  }

  // Infer named secondaries from legacy rand1/rand2 values for backward compatibility.
  function inferLegacyRandStats(item) {
    const out = [];
    const base = Number(item.baseStatValue || 1) || 1;
    const totalChoices = SECONDARY_TYPES.length * SECONDARY_VARIANT_COUNT;
    const mapChoiceOrValue = (v) => {
      const n = Number(v || 0);
      // If value falls within compact choice space, interpret as a choice index
      if (Number.isInteger(n) && n >= 0 && n < totalChoices) {
        return interpretSecondaryChoice(n, base);
      }
      // otherwise fall back to legacy magnitude-based inference
      const val = n;
      if (val <= 0) return null;
      if (val <= Math.max(2, Math.round(base * 0.15))) {
        return { type: 'lifesteal', value: +(Math.round((val * 0.01) * 10000) / 10000) };
      }
      if (val <= Math.max(5, Math.round(base * 0.35))) {
        return { type: 'regen', value: Math.max(1, Math.round(val * 0.3)) };
      }
      if (val <= Math.max(8, Math.round(base * 0.6))) {
        return { type: 'critChance', value: +(Math.round((val * 0.01) * 10000) / 10000) };
      }
      return { type: 'attack', value: val };
    };
    const r1 = mapChoiceOrValue(item.rand1);
    const r2 = mapChoiceOrValue(item.rand2);
    if (r1) out.push(r1);
    if (r2) out.push(r2);
    return out;
  }

  // Compute modifiers from an explicit gear list (array of gear objects)
  function computeModifiersFromList(gearList) {
  const mods = { attack: 0, defense: 0, hp: 0, elements: {}, accuracy: 0 };
    if (!Array.isArray(gearList)) return mods;
    for (const it of gearList) {
      const baseV = Number(it.baseStatValue || 0);
      let usedRandStats = null;

      if (Array.isArray(it.randStats) && it.randStats.length) {
        const stat = (it.baseStatName || '').toLowerCase();
        if (stat.indexOf('attack') !== -1 || stat.indexOf('atk') !== -1) mods.attack += baseV;
        else if (stat.indexOf('def') !== -1) mods.defense += baseV;
        else if (stat.indexOf('hp') !== -1) mods.hp += baseV;
        else mods.defense += baseV;

        for (const rs of it.randStats) {
          if (!rs) continue;
          let interp = null;
          if (typeof rs.choice !== 'undefined') interp = interpretSecondaryChoice(Number(rs.choice), baseV);
          else if (typeof rs.type !== 'undefined') interp = { type: rs.type, value: Number(rs.value || 0) };
          if (!interp) continue;
          const val = Number(interp.value || 0);
          if (interp.type === 'attack') mods.attack += val;
          else if (interp.type === 'defense') mods.defense += val;
          else if (interp.type === 'hp') mods.hp += val;
          else if (interp.type === 'accuracy') mods.accuracy = (mods.accuracy || 0) + val;
          else mods[interp.type] = (mods[interp.type] || 0) + val;
        }
        usedRandStats = it.randStats;

      } else if (typeof it.rand1 !== 'undefined' || typeof it.rand2 !== 'undefined') {
        // legacy data present -> infer named secondaries
        const inferred = inferLegacyRandStats(it) || [];
        usedRandStats = inferred;
        const stat = (it.baseStatName || '').toLowerCase();
        if (stat.indexOf('attack') !== -1 || stat.indexOf('atk') !== -1) mods.attack += baseV;
        else if (stat.indexOf('def') !== -1) mods.defense += baseV;
        else if (stat.indexOf('hp') !== -1) mods.hp += baseV;
        else mods.defense += baseV;

        for (const rs of inferred) {
          if (!rs) continue;
          const val = Number(rs.value || 0);
          if (rs.type === 'attack') mods.attack += val;
          else if (rs.type === 'defense') mods.defense += val;
          else if (rs.type === 'hp') mods.hp += val;
          else mods[rs.type] = (mods[rs.type] || 0) + val;
        }

      } else {
        // no randStats and no legacy rand values -> just add base to canonical stat
        const total = baseV;
        const stat = (it.baseStatName || '').toLowerCase();
        if (stat.indexOf('attack') !== -1 || stat.indexOf('atk') !== -1) mods.attack += total;
        else if (stat.indexOf('def') !== -1) mods.defense += total;
        else if (stat.indexOf('hp') !== -1) mods.hp += total;
        else mods.defense += total;
      }

  const el = (it.element || 'neutral');
  const elemTotal = computeItemElementPower(it) || 0;
  mods.elements[el] = (mods.elements[el] || 0) + elemTotal;

      // process enchants if present — enchants can either add their own bonuses
      // or, if they target an existing named secondary on the same item, they "superchange" it
      if (Array.isArray(it.enchants)) {
        const randMap = {};
        if (Array.isArray(it.randStats)) for (const rs of it.randStats) {
          if (!rs) continue;
          if (typeof rs.choice !== 'undefined') {
            const ip = interpretSecondaryChoice(Number(rs.choice), baseV);
            if (ip && ip.type) randMap[ip.type] = Number(ip.value || 0);
          } else if (typeof rs.type !== 'undefined') {
            randMap[rs.type] = Number(rs.value || 0);
          }
        }
        // also include inferred rand stats if randStats not present
        if (!Array.isArray(it.randStats) && Array.isArray(usedRandStats)) for (const rs of usedRandStats) if (rs && rs.type) randMap[rs.type] = Number(rs.value || 0);

        for (const e of it.enchants) {
          if (!e || !e.type) continue;
          const t = e.type;
          if (typeof randMap[t] !== 'undefined') {
            const base = Number(randMap[t] || 0);
            switch(t) {
              case 'lifesteal': mods.lifestealPercent = (mods.lifestealPercent || 0) + (base * 2); mods.vampirismChance = (mods.vampirismChance || 0) + 0.5; mods.vampirismDamage = (mods.vampirismDamage || 0) + 6; break;
              case 'regen': mods.regenPerTurn = (mods.regenPerTurn || 0) + (base * 2); mods.regeneratorChance = (mods.regeneratorChance || 0) + 0.25; break;
              case 'critChance': mods.critChance = (mods.critChance || 0) + (base * 2); mods.executeChance = (mods.executeChance || 0) + 0.15; mods.executeDamage = (mods.executeDamage || 0) + 10; break;
              case 'critDamage': mods.critDamageBonus = (mods.critDamageBonus || 0) + (base * 2); mods.critOverkill = (mods.critOverkill || 0) + 0.2; break;
              case 'evasion': mods.evasion = (mods.evasion || 0) + (base * 2); mods.counterChance = (mods.counterChance || 0) + 0.25; mods.counterDamage = (mods.counterDamage || 0) + 6; break;
              case 'accuracy': mods.accuracy = (mods.accuracy || 0) + (base * 2); break;
              case 'maxHpPercent': mods.maxHpPercent = (mods.maxHpPercent || 0) + (base * 2); mods.reflectPercent = (mods.reflectPercent || 0) + 0.05; break;
              case 'speed': mods.speed = (mods.speed || 0) + (base * 2); mods.extraActionChance = (mods.extraActionChance || 0) + 0.15; break;
              case 'pierce': mods.pierce = (mods.pierce || 0) + (base * 2); mods.ignoreDefenseChance = (mods.ignoreDefenseChance || 0) + 0.20; break;
              case 'manaRegen': mods.manaRegen = (mods.manaRegen || 0) + (base * 2); mods.manaShieldChance = (mods.manaShieldChance || 0) + 0.2; break;
              default:
                break;
            }
            continue;
          }

          switch(t) {
            case 'regen': mods.regenPerTurn = (mods.regenPerTurn || 0) + Number(e.value || 0); break;
            case 'lifesteal': mods.lifestealPercent = (mods.lifestealPercent || 0) + Number(e.value || 0); break;
            case 'critChance': mods.critChance = (mods.critChance || 0) + Number(e.value || 0); break;
            case 'critDamage': mods.critDamageBonus = (mods.critDamageBonus || 0) + Number(e.value || 0); break;
            case 'evasion': mods.evasion = (mods.evasion || 0) + Number(e.value || 0); break;
            case 'accuracy': mods.accuracy = (mods.accuracy || 0) + Number(e.value || 0); break;
            case 'maxHpPercent': mods.maxHpPercent = (mods.maxHpPercent || 0) + Number(e.value || 0); break;
            case 'speed': mods.speed = (mods.speed || 0) + Number(e.value || 0); break;
            case 'pierce': mods.pierce = (mods.pierce || 0) + Number(e.value || 0); break;
            case 'manaRegen': mods.manaRegen = (mods.manaRegen || 0) + Number(e.value || 0); break;
            default: break;
          }
        }
      }
    }
    return mods;
  }

  // Apply a given gear list (array of gear objects) to a stats object. Does not read localStorage.
  function applyGearListToStats(stats, gearList) {
    if (!stats || typeof stats !== 'object') return stats;
    try {
      if (stats._equipApplied) removeEquipFromStats(stats);
      const mods = computeModifiersFromList(gearList || []);
      stats._orig_baseAtk = typeof stats.baseAtk !== 'undefined' ? stats.baseAtk : (typeof stats.attack !== 'undefined' ? stats.attack : 0);
      stats._orig_defense = typeof stats.defense !== 'undefined' ? stats.defense : (typeof stats.def !== 'undefined' ? stats.def : 0);
      stats._orig_maxHp = typeof stats.maxHp !== 'undefined' ? stats.maxHp : (typeof stats.maxHP !== 'undefined' ? stats.maxHP : (stats.hp || 100));
      stats.baseAtk = (stats.baseAtk || 0) + (mods.attack || 0);
      stats.attack = stats.baseAtk;
      stats.defense = (stats.defense || 0) + (mods.defense || 0);
      const deltaHp = mods.hp || 0;
      stats.maxHp = (stats.maxHp || stats._orig_maxHp || 100) + deltaHp;
      stats.hp = Math.min(stats.maxHp, (stats.hp || 0) + deltaHp);
      stats._equipMods = mods;
      try {
        if (typeof window !== 'undefined' && window.__GEAR_DEBUG__) console.debug('applyGearListToStats applied mods', mods, 'to', stats.id || stats.name || 'player');
      } catch (e) {}
      stats._equipElements = mods.elements || {};
      // apply enchant-derived bonuses
      if (mods.evasion) stats.evasion = (stats.evasion || 0) + (mods.evasion || 0);
      if (mods.critChance) stats.critChance = (stats.critChance || 0) + (mods.critChance || 0);
      if (mods.critDamageBonus) stats._critDamageBonus = (stats._critDamageBonus || 0) + (mods.critDamageBonus || 0);
  if (mods.speed) stats.speed = (stats.speed || 0) + (mods.speed || 0);
      if (mods.regenPerTurn) stats._regenPerTurn = (stats._regenPerTurn || 0) + (mods.regenPerTurn || 0);
      if (mods.lifestealPercent) stats._lifestealPercent = (stats._lifestealPercent || 0) + (mods.lifestealPercent || 0);
      if (mods.maxHpPercent) {
        // Apply percent-based max HP increases relative to the original max HP snapshot.
        // To avoid surprising jumps in current HP, scale current HP proportionally to the new max HP
        const origMax = Number(stats._orig_maxHp || stats.maxHp || 100) || 100;
        const add = Math.round(((mods.maxHpPercent||0)/100) * origMax);
        const prevMaxBeforePercent = Number(stats.maxHp || origMax) || origMax; // includes any flat HP additions already applied
        const newMax = prevMaxBeforePercent + add;
        // Maintain same percentage of HP as before the percent increase
        const curHp = Number(stats.hp || 0);
        let newHp = curHp;
        try {
          if (prevMaxBeforePercent > 0) {
            const pct = curHp / prevMaxBeforePercent;
            newHp = Math.min(newMax, Math.round(pct * newMax));
          } else {
            newHp = Math.min(newMax, curHp + add);
          }
        } catch (e) { newHp = Math.min(newMax, curHp + add); }
        stats.maxHp = newMax;
        stats.hp = newHp;
      }
      stats._equipEnchants = (mods) ? mods : {};
      // apply accuracy so battle code can use it to counter evasion
      if (mods.accuracy) stats.accuracy = (stats.accuracy || 0) + (mods.accuracy || 0);
      stats._equipApplied = true;
    } catch (e) { console.error('applyGearListToStats failed', e); }
    return stats;
  }

  function applyEquipToStats(stats) {
    if (!stats || typeof stats !== 'object') return stats;
    try {
      // remove existing equip first
      if (stats._equipApplied) {
        removeEquipFromStats(stats);
      }
      const mods = computeEquipModifiers();
      // store originals
      stats._orig_baseAtk = typeof stats.baseAtk !== 'undefined' ? stats.baseAtk : (typeof stats.attack !== 'undefined' ? stats.attack : 0);
      stats._orig_defense = typeof stats.defense !== 'undefined' ? stats.defense : (typeof stats.def !== 'undefined' ? stats.def : 0);
      stats._orig_maxHp = typeof stats.maxHp !== 'undefined' ? stats.maxHp : (typeof stats.maxHP !== 'undefined' ? stats.maxHP : (stats.hp || 100));

      // apply
      stats.baseAtk = (stats.baseAtk || 0) + (mods.attack || 0);
      stats.attack = stats.baseAtk; // keep alias
      stats.defense = (stats.defense || 0) + (mods.defense || 0);
      // adjust maxHp and current hp proportionally (additive)
      const deltaHp = mods.hp || 0;
      stats.maxHp = (stats.maxHp || stats._orig_maxHp || 100) + deltaHp;
      stats.hp = Math.min(stats.maxHp, (stats.hp || 0) + deltaHp);

      stats._equipMods = mods;
      try {
        if (typeof window !== 'undefined' && window.__GEAR_DEBUG__) console.debug('applyEquipToStats applied mods', mods, 'to', stats.id || stats.name || 'player');
      } catch (e) {}
      // expose element power map for hit effects
      stats._equipElements = mods.elements || {};
      // apply enchant-derived bonuses (same as applyGearListToStats)
      if (mods.evasion) stats.evasion = (stats.evasion || 0) + (mods.evasion || 0);
      if (mods.critChance) stats.critChance = (stats.critChance || 0) + (mods.critChance || 0);
      if (mods.critDamageBonus) stats._critDamageBonus = (stats._critDamageBonus || 0) + (mods.critDamageBonus || 0);
  if (mods.speed) stats.speed = (stats.speed || 0) + (mods.speed || 0);
      if (mods.regenPerTurn) stats._regenPerTurn = (stats._regenPerTurn || 0) + (mods.regenPerTurn || 0);
      if (mods.lifestealPercent) stats._lifestealPercent = (stats._lifestealPercent || 0) + (mods.lifestealPercent || 0);
      if (mods.maxHpPercent) {
        const origMax = Number(stats._orig_maxHp || stats.maxHp || 100) || 100;
        const add = Math.round(((mods.maxHpPercent||0)/100) * origMax);
        const prevMaxBeforePercent = Number(stats.maxHp || origMax) || origMax;
        const newMax = prevMaxBeforePercent + add;
        const curHp = Number(stats.hp || 0);
        let newHp = curHp;
        try {
          if (prevMaxBeforePercent > 0) {
            const pct = curHp / prevMaxBeforePercent;
            newHp = Math.min(newMax, Math.round(pct * newMax));
          } else {
            newHp = Math.min(newMax, curHp + add);
          }
        } catch (e) { newHp = Math.min(newMax, curHp + add); }
        stats.maxHp = newMax;
        stats.hp = newHp;
      }
      stats._equipEnchants = (mods) ? mods : {};
      // apply accuracy so battle code can use it to counter evasion
      if (mods.accuracy) stats.accuracy = (stats.accuracy || 0) + (mods.accuracy || 0);
      stats._equipApplied = true;
    } catch (e) { console.error('applyEquipToStats failed', e); }
    return stats;
  }

  function removeEquipFromStats(stats) {
    if (!stats || !stats._equipApplied) return stats;
    try {
      if (typeof stats._orig_baseAtk !== 'undefined') stats.baseAtk = stats._orig_baseAtk;
      if (typeof stats._orig_defense !== 'undefined') stats.defense = stats._orig_defense;
      if (typeof stats._orig_maxHp !== 'undefined') {
        const prevMax = stats._orig_maxHp;
        const curMax = stats.maxHp || prevMax;
        const delta = (curMax - prevMax) || 0;
        stats.maxHp = prevMax;
        stats.hp = Math.max(0, (stats.hp || 0) - delta);
      }
    } catch (e) { console.error('removeEquipFromStats failed', e); }
    delete stats._equipApplied;
    delete stats._equipMods;
    delete stats._orig_baseAtk;
    delete stats._orig_defense;
    delete stats._orig_maxHp;
    return stats;
  }

  async function syncGearToServer(item) {
    try {
      // prefer abstracted helper if app exposes it
      if (window && typeof window.addGearToUser === 'function') {
        const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
        if (uid) { await window.addGearToUser(uid, item); return true; }
      }
      // fallback: attempt direct firebase writes if db/ref/update exist globally
      if (typeof db !== 'undefined' && typeof ref === 'function' && typeof update === 'function') {
        const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
        if (!uid) return false;
        const gearRef = ref(db, `users/${uid}/gear/${item.id}`);
        await update(gearRef, item);
        return true;
      }
    } catch (e) { console.error('syncGearToServer failed', e); }
    return false;
  }

  // Pull gear for a user from the server into localStorage (merge, avoid duplicates)
  async function syncArmoryFromServer(uid) {
    try {
      if (!uid) return false;
      if (typeof db === 'undefined' || typeof ref !== 'function' || typeof get !== 'function') return false;
      const snap = await get(ref(db, `users/${uid}/gear`));
      if (!snap.exists()) return false;
      const serverGear = snap.val() || {};
      const list = loadArmory();
      const byId = {};
      for (const g of list) byId[g.id] = g;
      // Merge server gear into local armory. For starter items we may remap legacy small rand values
      // into the full compact choice space to avoid many items mapping to lifesteal only.
      const totalChoices = (Array.isArray(SECONDARY_TYPES) ? SECONDARY_TYPES.length : 10) * (typeof SECONDARY_VARIANT_COUNT === 'number' ? SECONDARY_VARIANT_COUNT : 3);
      for (const k of Object.keys(serverGear)) {
        try {
          const g = serverGear[k];
          if (!g || !g.id) continue;
          // If server provided legacy-style small rand1/rand2 for starter items, remap locally to full choice space
          try {
            const isStarter = String(g.id || '').indexOf('starter_') === 0;
            const hasRandStats = Array.isArray(g.randStats) && g.randStats.length;
            if (isStarter && !hasRandStats) {
              // If rand1/rand2 exist and are small (<=2) remap to random full-range choices to diversify starter pools
              const small1 = (typeof g.rand1 !== 'undefined') && Number(g.rand1) >= 0 && Number(g.rand1) <= 2;
              const small2 = (typeof g.rand2 !== 'undefined') && Number(g.rand2) >= 0 && Number(g.rand2) <= 2;
              if (small1 || small2) {
                const c1 = Math.floor(Math.random() * totalChoices);
                const c2 = Math.floor(Math.random() * totalChoices);
                g.rand1 = c1;
                g.rand2 = c2;
                g.randStats = [{ choice: c1 }, { choice: c2 }];
                // store this locally only; do not overwrite server data here
                console.debug('Remapped starter gear rand fields to choice space locally for', g.id, g.rand1, g.rand2);
              }
            }
          } catch (e) { /* ignore remap errors */ }
          byId[g.id] = g;
        } catch (e) { /* ignore malformed entries */ }
      }
      const merged = Object.keys(byId).map(id => byId[id]);
      saveArmory(merged);
      return true;
    } catch (e) { console.error('syncArmoryFromServer failed', e); return false; }
  }

  // Apply elemental on-hit effects. attacker and target are stats-like objects (may be copies).
  // This function returns an object { targetStatus: {...}, attackerUpdates: {...} } describing status changes
  // For PVE we mutate objects directly; for PvP we return updates to be applied to DB.
  function applyOnHit(attacker, target, damage, options = {}) {
    try {
      if (!attacker || !target) return {};
      const attackerElMap = (attacker._equipElements) ? attacker._equipElements : {};
      const targetElMap = (target._equipElements) ? target._equipElements : {};
      const outTargetStatus = {};
      const outAttackerUpd = {};
      // neutral on target reduces incoming damage and debuff chance
      const neutralPower = Number(targetElMap.neutral || 0);
      const neutralReduce = Math.min(0.5, neutralPower / 200); // up to 50% dmg reduction

      // Iterate each element on attacker and attempt to apply effects
      Object.keys(attackerElMap || {}).forEach(el => {
        const power = attackerElMap[el] || 0;
        if (power <= 0) return;
        const chance = Math.min(0.6, power / 200); // scale chance with power
        const effectiveChance = Math.max(0, chance - (neutralPower ? (neutralPower/500) : 0));
        if (el === 'fire') {
          if (Math.random() < effectiveChance) {
            // burn: DOT for 3 turns, amount scaled
            outTargetStatus.burn = { amount: Math.max(1, Math.ceil(power/10)), turns: 3 };
          }
        } else if (el === 'electric') {
          if (Math.random() < effectiveChance) {
            outTargetStatus.stun = { turns: 1 };
          }
        } else if (el === 'ice') {
          if (Math.random() < effectiveChance) {
            // slow/weak: reduce attackBoost or apply weaken
            outTargetStatus.weaken = { amount: Math.max(1, Math.ceil(power/15)), turns: 2 };
          }
        } else if (el === 'wind') {
          if (Math.random() < effectiveChance) {
            // chance to ignore defense for this hit
            outTargetStatus.pierce = { turns: 1, amount: Math.max(1, Math.ceil(power/10)) };
          }
        } else if (el === 'earth') {
          if (Math.random() < effectiveChance) {
            // chance to apply poison
            outTargetStatus.poison = { amount: Math.max(1, Math.ceil(power/12)), turns: 3 };
          }
          if (Math.random() < Math.min(0.4, power/300)) {
            // small chance to grant attacker temporary defense
            outAttackerUpd.defense = (attacker.defense || 0) + Math.max(1, Math.ceil(power/12));
          }
        } else if (el === 'neutral') {
          // neutral on attacker slightly reduces debuff chance on hit
        }
      });

      return { targetStatus: outTargetStatus, attackerUpdates: outAttackerUpd, neutralReduce };
    } catch (e) { console.error('applyOnHit failed', e); return {}; }
  }

  function awardGearToPlayer({ slot=null, guaranteed=false } = {}) {
    // if guaranteed, force at least uncommon
    const rarity = guaranteed ? 'uncommon' : null;
    const gear = generateGear(slot, rarity);
    addGearToArmory(gear);
    try { console.debug('gear awarded', gear); } catch (e) {}
    // notify game UIs
    try { if (window && typeof window.onGearAwarded === 'function') window.onGearAwarded(gear); } catch(e){}
    // attempt server sync asynchronously
    try { syncGearToServer(gear).catch(()=>{}); } catch(e){}
    return gear;
  }

  async function addGearToArmoryAndSync(item) {
    const added = addGearToArmory(item);
    try { await syncGearToServer(item); } catch (e) {}
    return added;
  }

  function getArmory() { return loadArmory(); }
  function removeGearById(id) { const list = loadArmory().filter(g => g.id !== id); saveArmory(list); }

  // Remove gear locally and attempt to remove from server-side storage when possible.
  async function removeGearByIdAndSync(id) {
    try {
      // remove locally first
      removeGearById(id);
      // attempt server-side removal: prefer app-provided helper
      if (window && typeof window.removeGearFromUser === 'function') {
        const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
        if (uid) { await window.removeGearFromUser(uid, id); return true; }
      }
      // fallback: use firebase helpers if available (update parent with null for the key)
      if (typeof db !== 'undefined' && typeof ref === 'function' && typeof update === 'function') {
        const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
        if (!uid) return false;
        const gearParentRef = ref(db, `users/${uid}/gear`);
        const payload = {};
        payload[id] = null;
        await update(gearParentRef, payload);
        return true;
      }
    } catch (e) { console.error('removeGearByIdAndSync failed', e); }
    return false;
  }

  // expose
  global.Gear = {
    generateGear,
    addGearToArmory,
    awardGearToPlayer,
    addGearToArmoryAndSync,
    getArmory,
    removeGearById,
    getEquipMap,
    getEquippedItems,
    computeEquipModifiers,
    applyEquipToStats,
    computeModifiersFromList,
    applyGearListToStats,
    removeEquipFromStats,
    syncArmoryFromServer,
    interpretSecondaryChoice,
    inferLegacyRandStats,
    computeItemElementPower,
    SECONDARY_TYPES,
    SLOTS
    ,
    prettyName
    ,
    removeGearByIdAndSync
  };
})(window);
