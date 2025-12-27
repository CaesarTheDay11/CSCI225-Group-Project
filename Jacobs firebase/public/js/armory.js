// Armory UI with drag-and-drop and slot grid
(function(global){
  // fallback placeholder: small inline SVG data URI (avoids missing-file 404s)
  const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24"><rect width="24" height="24" fill="#111"/><g fill="#666"><path d="M12 2c-1.1 0-2 .9-2 2v1h4V4c0-1.1-.9-2-2-2z"/><path d="M5 8c0 3.9 3.1 7 7 7s7-3.1 7-7V7H5v1z"/></g></svg>');
  // friendly labels and superchange descriptions used throughout the UI
  const SECONDARY_LABELS = {
    lifesteal: 'Lifesteal', regen: 'Health Regen', critChance: 'Crit Chance', critDamage: 'Crit Damage', evasion: 'Evasion', maxHpPercent: 'Max HP %', speed: 'Speed', pierce: 'Pierce', manaRegen: 'Mana Regen', attack: 'Attack', defense: 'Defense', hp: 'HP'
  };
  const ENCHANT_SUPER_DESC = {
    lifesteal: (base) => ({ name: 'Vampirism', desc: `${Math.round((base*3||0)*10000)/100}% — 50% chance to deal 6 extra damage and heal for that amount` }),
    regen: (base) => ({ name: 'Regenerator', desc: `${(base*3||0)} HP/turn — 25% chance to clear debuffs on turn start` }),
    critChance: (base) => ({ name: 'Executioner', desc: `${Math.round((base*3||0)*10000)/100}% — 15% chance to execute for 10 damage` }),
    critDamage: (base) => ({ name: 'Overkill', desc: `+${Math.round((base*3||0))}% crit damage — gains +20% overkill damage on crit` }),
    evasion: (base) => ({ name: 'Shadowstep', desc: `${Math.round((base*3||0)*10000)/100}% — 25% chance to counter for 6 damage` }),
    maxHpPercent: (base) => ({ name: 'Bulwark', desc: `+${Math.round((base*3||0))}% Max HP — 5% damage reflect` }),
    speed: (base) => ({ name: 'Swiftwind', desc: `+${Math.round((base*3||0))} Speed — 15% chance for extra action` }),
    pierce: (base) => ({ name: 'Piercing Edge', desc: `+${Math.round((base*3||0))} Pierce — 20% chance to ignore defense` }),
    manaRegen: (base) => ({ name: 'Mana Well', desc: `+${Math.round((base*3||0))} mana/turn — 20% chance to gain a mana shield` })
  };
  function loadEquip() { try { return JSON.parse(localStorage.getItem('armory_equip_v1') || '{}') || {}; } catch(e){ return {}; } }
  function saveEquip(eq){ try{ localStorage.setItem('armory_equip_v1', JSON.stringify(eq||{})); }catch(e){} }

  function tryImagePaths(g) {
    // candidates: organized by slot folder, then flat by id or name
    const candidates = [];
    // support legacy/supplied split_N.png asset names mapping
    const SPLIT_MAP = {
      fire: 'split_1.png',
      electric: 'split_2.png',
      lightning: 'split_2.png',
      ice: 'split_3.png',
      wind: 'split_4.png',
      earth: 'split_5.png',
      neutral: 'split_6.png'
    };
    if (g && g.slot && g.id) {
      // Support common folder/name aliases so assets with slightly different naming still resolve.
      const SLOT_ALIASES = {
        pants: ['pants','leggings'],
        leggings: ['leggings','pants'],
        ring1: ['ring1','ring','rings'],
        ring2: ['ring2','ring','rings'],
        chestplate: ['chestplate','chest'],
        necklace: ['necklace','amulet'],
        // broaden melee aliases to include concrete weapon folders so legacy/generic items
        // with names like 'sword' or 'staff' will find matching assets in img/gear/<type>/
  left_weapon: ['melee','left_weapon','weapon','sword','spear','axe','dagger','staff','mace','hammer'],
  right_weapon: ['melee','right_weapon','weapon','sword','spear','axe','dagger','staff','mace','hammer'],
        ranged: ['ranged','bow','crossbow','gun','weapon']
      };
      const slotCandidates = SLOT_ALIASES[g.slot] ? SLOT_ALIASES[g.slot].slice() : [g.slot];
      // ensure the original slot is tried first
      if (slotCandidates.indexOf(g.slot) === -1) slotCandidates.unshift(g.slot);

      for (const s of slotCandidates) {
        if (g.element) {
          candidates.push(`img/gear/${s}/${g.element}_${s}.png`);
          candidates.push(`img/gear/${s}/${g.element}_${s}.jpg`);
          candidates.push(`img/gear/${s}/${g.element}_${g.id}.png`);
          candidates.push(`img/gear/${s}/${g.element}_${g.id}.jpg`);
          candidates.push(`img/gear/${s}/${g.element}_${g.name}.png`);
          candidates.push(`img/gear/${s}/${g.element}_${g.name}.jpg`);
          // also top-level lookups
          candidates.push(`img/${g.element}_${s}.png`);
          candidates.push(`img/${g.element}_${s}.jpg`);
          // fallback to split_N.png naming supplied by user
          const split = SPLIT_MAP[g.element];
          if (split) {
            candidates.push(`img/gear/${s}/${split}`);
            candidates.push(`img/${split}`);
          }
        }
        candidates.push(`img/gear/${s}/${g.id}.png`);
        candidates.push(`img/gear/${s}/${g.id}.jpg`);
        candidates.push(`img/gear/${s}/${g.name}.png`);
        candidates.push(`img/gear/${s}/${g.name}.jpg`);
      }
    }
    if (g && g.id) {
      candidates.push(`img/${g.id}.png`);
      candidates.push(`img/${g.id}.jpg`);
      candidates.push(`img/${g.name}.png`);
      candidates.push(`img/${g.name}.jpg`);
      // If the item name contains a concrete weapon/folder keyword (e.g. 'sword','staff'),
      // also try folder paths using that word so images like img/gear/sword/... are found.
      try {
        const nameLower = String(g.name || '').toLowerCase();
        const keywords = ['sword','staff','dagger','spear','axe','mace','hammer','bow','crossbow','shield','helmet','chestplate','boots','rings','ring'];
        for (const kw of keywords) {
          if (nameLower.indexOf(kw) !== -1) {
            candidates.push(`img/gear/${kw}/${g.element || 'neutral'}_${kw}.png`);
            candidates.push(`img/gear/${kw}/${g.element || 'neutral'}_${kw}.jpg`);
            candidates.push(`img/gear/${kw}/${g.id}.png`);
            candidates.push(`img/gear/${kw}/${g.id}.jpg`);
            candidates.push(`img/gear/${kw}/${g.name}.png`);
            candidates.push(`img/gear/${kw}/${g.name}.jpg`);
            break;
          }
        }
      } catch (e) {}
      candidates.push(`img/${g.name}.jpg`);
    }
    // lastly fall back to generic
    candidates.push(PLACEHOLDER);
    return candidates;
  }

  function makeImgForGear(g) {
    const img = document.createElement('img');
    img.className = 'gear-img';
    img.alt = g.name || g.id || 'gear';
    const candidates = tryImagePaths(g);
    // iterate through candidate URLs until one loads
    let idx = 0;
    const tryNext = () => {
      if (idx >= candidates.length) {
        img.onerror = null;
        img.src = PLACEHOLDER;
        return;
      }
      img.onerror = onErr;
      img.src = candidates[idx++];
    };
    const onErr = function() {
      // attempt next candidate
      tryNext();
    };
    tryNext();
    return img;
  }

  function isInMatch() {
    try { return !!(localStorage && localStorage.getItem && localStorage.getItem('in_match_v1')); } catch (e) { return false; }
  }

  function clearNode(n){ if (n) n.innerHTML = ''; }

  function renderSlots() {
    const slotsContainer = document.getElementById('armory-slots'); if (!slotsContainer) return;
    // show banner if armory is read-only due to active match
    try {
      let banner = document.getElementById('armory-readonly-banner');
      if (!banner) {
        banner = document.createElement('div'); banner.id = 'armory-readonly-banner'; banner.style.marginBottom='8px'; banner.style.padding='8px'; banner.style.background='#2b2b2b'; banner.style.color='#ffc'; banner.style.borderRadius='6px';
        const container = document.body || document.documentElement;
        if (container && container.firstChild) container.insertBefore(banner, container.firstChild);
      }
      if (isInMatch()) banner.textContent = 'Armory is read-only while you are in an active match. You can view items but cannot equip/unequip or delete them.';
      else banner.parentNode && banner.parentNode.removeChild(banner);
    } catch(e) { /* ignore banner errors */ }
    clearNode(slotsContainer);
    const equip = loadEquip();
  const SLOTS = (typeof Gear !== 'undefined' && Gear.SLOTS) ? Gear.SLOTS : ['helmet','chestplate','left_greave','right_greave','pants','boots','ring1','ring2','necklace','left_weapon','right_weapon'];
    for (const s of SLOTS) {
      const slotCard = document.createElement('div'); slotCard.className = 'slot-card'; slotCard.dataset.slot = s;
      const title = document.createElement('div'); title.className='slot-title'; title.textContent = s.replace(/_/g,' ');
      const dropZone = document.createElement('div'); dropZone.className='slot-drop'; dropZone.dataset.slot = s;
      // drop handlers
      dropZone.addEventListener('dragover', (ev)=>{ ev.preventDefault(); dropZone.classList.add('can-drop'); });
      dropZone.addEventListener('dragleave', (ev)=>{ dropZone.classList.remove('can-drop'); });
      dropZone.addEventListener('drop', (ev)=>{ ev.preventDefault(); dropZone.classList.remove('can-drop'); const gid = ev.dataTransfer.getData('text/gear-id'); if(gid) handleDropOnSlot(s,gid); });

      // show equipped item if present
      const eqId = equip[s];
      if (eqId) {
        const gear = (typeof Gear !== 'undefined') ? Gear.getArmory().find(x=>x.id===eqId) : null;
        if (gear) {
          const img = makeImgForGear(gear);
          img.draggable = true;
          img.addEventListener('dragstart', (ev)=>{ if (isInMatch()) { ev.preventDefault(); return; } ev.dataTransfer.setData('text/gear-id', gear.id); ev.dataTransfer.setData('text/from-slot', s); });
          const name = document.createElement('div'); name.className='slot-gear-name'; name.textContent = gear.name;
          dropZone.appendChild(img); dropZone.appendChild(name);
        } else {
          // stale equip id: remove
          const eq = loadEquip(); delete eq[s]; saveEquip(eq);
        }
      } else {
        const hint = document.createElement('div'); hint.className='slot-empty'; hint.textContent = 'Drop gear here';
        dropZone.appendChild(hint);
      }

      slotCard.appendChild(title); slotCard.appendChild(dropZone);
      slotsContainer.appendChild(slotCard);
    }
  }

  // Helper: map a slot string (legacy or new) to a simple category: 'melee', 'ranged', 'ring', or 'other'
  // This extended classifier lets us accept weapons into left/right weapon slots, allow rings in either ring slot,
  // and restrict ranged items to ranged slots.
  function slotCategory(slotName) {
    if (!slotName) return 'other';
    const s = String(slotName).toLowerCase();
    // ring keywords
    if (s.indexOf('ring') !== -1) return 'ring';
    // ranged keywords
    if (s.indexOf('bow') !== -1 || s.indexOf('crossbow') !== -1 || s.indexOf('ranged') !== -1) return 'ranged';
    // melee/weapon keywords (includes left_weapon/right_weapon aliases)
    if (s.indexOf('sword') !== -1 || s.indexOf('dagger') !== -1 || s.indexOf('mace') !== -1 || s.indexOf('axe') !== -1 || s.indexOf('hammer') !== -1 || s.indexOf('spear') !== -1 || s.indexOf('staff') !== -1 || s.indexOf('melee') !== -1 || s.indexOf('weapon') !== -1) return 'melee';
    return 'other';
  }

  function handleDropOnSlot(slot, gearId) {
    if (isInMatch()) { alert('Cannot change equipment while in an active match.'); return; }
    const list = Gear.getArmory();
    const g = list.find(x=>x.id===gearId);
    if (!g) { alert('Item not found'); return; }
    // allow equip if exact slot matches, or if categories align
    const targetCat = slotCategory(slot);
    const itemCat = slotCategory(g.slot);

    const allowed = (g.slot === slot) ||
      // rings can go into either ring1 or ring2
      (itemCat === 'ring' && targetCat === 'ring') ||
      // melee weapons (including legacy 'melee' items) can go into left/right weapon slots
      (itemCat === 'melee' && targetCat === 'melee') ||
      // ranged items only to ranged slot
      (itemCat === 'ranged' && targetCat === 'ranged');

    if (!allowed) {
      alert(`This item is ${g.slot} and cannot be equipped in ${slot}`);
      return;
    }

    // prevent the same gear item being equipped into multiple slots simultaneously.
    // If this gear id is found in another slot, remove it first.
    const eq = loadEquip();
    for (const s in eq) {
      if (eq[s] === gearId && s !== slot) delete eq[s];
    }
    eq[slot] = gearId;
    saveEquip(eq);
    render();
    try { if (window && typeof window.onEquipChanged === 'function') window.onEquipChanged(eq); } catch(e){}
  }

  function unequipSlot(slot) {
    if (isInMatch()) { alert('Cannot unequip during an active match.'); return; }
    const eq = loadEquip(); if (eq && eq[slot]) delete eq[slot]; saveEquip(eq); render(); try { if (window && typeof window.onEquipChanged === 'function') window.onEquipChanged(eq); } catch(e){}
  }

  function renderList() {
    const list = (typeof Gear !== 'undefined') ? Gear.getArmory() : [];
    const el = document.getElementById('armory-list'); if (!el) return; clearNode(el);
    if (!list || !list.length) { el.textContent = '(no gear in armory)'; return; }
    const equip = loadEquip();
    for (const g of list) {
      const card = document.createElement('div'); card.className = 'gear-card'; card.draggable = false;
      const top = document.createElement('div'); top.className='gear-top';
      const img = makeImgForGear(g); img.draggable = true; img.addEventListener('dragstart',(ev)=>{ ev.dataTransfer.setData('text/gear-id', g.id); });
      const title = document.createElement('div'); title.className='gear-title';
      try {
        // Pass the whole item into prettyName so adjectives can be derived from element/secondaries/enchant
        if (window.Gear && typeof window.Gear.prettyName === 'function') title.textContent = window.Gear.prettyName(g, g.rarity) + (g.element ? ` (${g.element})` : '');
        else title.textContent = g.name;
      } catch (e) { title.textContent = g.name; }
      top.appendChild(img); top.appendChild(title);
      const slot = document.createElement('div'); slot.className='gear-slot'; slot.textContent = `Slot: ${g.slot} — ${g.rarity}`;
      // helper to guess stat name from slot if item data is inconsistent
      const guessStatFromSlot = (slotName) => {
        if (!slotName) return 'stat';
        slotName = slotName.toLowerCase();
        if (slotName.indexOf('bow') !== -1 || slotName.indexOf('sword') !== -1 || slotName.indexOf('dagger') !== -1 || slotName.indexOf('staff') !== -1 || slotName.indexOf('mace') !== -1 || slotName.indexOf('axe') !== -1 || slotName.indexOf('hammer') !== -1 || slotName.indexOf('spear') !== -1 || slotName.indexOf('crossbow') !== -1) return 'attack';
        if (slotName.indexOf('shield') !== -1 || slotName.indexOf('chest') !== -1 || slotName.indexOf('helmet') !== -1 || slotName.indexOf('pants') !== -1 || slotName.indexOf('leggings') !== -1 || slotName.indexOf('boots') !== -1 || slotName.indexOf('bracer') !== -1) return 'defense';
        // necklaces/amulets should be displayed as regen (HP regen / mana regen)
        if (slotName.indexOf('neck') !== -1 || slotName.indexOf('amulet') !== -1) return 'regen';
        if (slotName.indexOf('ring') !== -1) return 'attack';
        return 'stat';
      };
      // Prefer a sensible stat name: use baseStatName when it clearly indicates attack/defense/hp,
      // otherwise fall back to guessing from the slot to avoid items showing the wrong stat.
      let statNameRaw = (g.baseStatName && String(g.baseStatName).trim()) || '';
      const statLower = statNameRaw.toLowerCase();
      if (!statNameRaw || !(/attack|atk|def|hp|health/.test(statLower))) {
        statNameRaw = guessStatFromSlot(g.slot);
      }
      const statLabel = statNameRaw.charAt(0).toUpperCase() + statNameRaw.slice(1);
      const baseVal = Number(g.baseStatValue || 0);
      const r1 = Number(g.rand1 || 0);
      const r2 = Number(g.rand2 || 0);
      // Prepare display: prefer named randStats if available
      const stats = document.createElement('div'); stats.className='gear-stats';
      const elementLine = `<div>Element: ${g.element || 'neutral'}</div>`;
      let secondariesHtml = '';
      // build a normalized list of interpreted secondaries (from compact choices or legacy inference)
      const interpretedList = [];
      if (Array.isArray(g.randStats) && g.randStats.length) {
        for (const rs of g.randStats) {
          if (!rs) continue;
          let interp = null;
          if (typeof rs.choice !== 'undefined' && window.Gear && typeof window.Gear.interpretSecondaryChoice === 'function') {
            interp = window.Gear.interpretSecondaryChoice(Number(rs.choice), Number(g.baseStatValue || 0));
          } else if (typeof rs.type !== 'undefined') interp = { type: rs.type, value: rs.value };
          if (interp) interpretedList.push(interp);
        }
      } else if (window.Gear && typeof window.Gear.inferLegacyRandStats === 'function') {
        // attempt to infer named secondaries from legacy rand1/rand2
        const inferred = window.Gear.inferLegacyRandStats(g) || [];
        if (inferred && inferred.length) {
          // persist the inferred secondaries into the stored armory so future renders are direct
          try {
            const updated = Object.assign({}, g, { randStats: inferred });
            // remove old entry then add updated one (attempt server sync when available)
            (async ()=>{
              try {
                if (window.Gear && typeof window.Gear.removeGearByIdAndSync === 'function') await window.Gear.removeGearByIdAndSync(g.id);
                else if (window.Gear && typeof window.Gear.removeGearById === 'function') window.Gear.removeGearById(g.id);
                if (window.Gear && typeof window.Gear.addGearToArmoryAndSync === 'function') await window.Gear.addGearToArmoryAndSync(updated);
                else if (window.Gear && typeof window.Gear.addGearToArmory === 'function') window.Gear.addGearToArmory(updated);
              } catch(e) { /* ignore sync errors */ }
            })();
            // use updated for display
            for (const inf of inferred) if (inf) interpretedList.push(inf);
          } catch (e) { /* ignore persistence errors and fall back to transient display */
            for (const inf of inferred) if (inf) interpretedList.push(inf);
          }
        }
      }

          // detect if this item has an enchant that "superchanges" one of its secondaries
          let isSupercharged = false;
          try {
            const present = {};
            for (const it of interpretedList) if (it && it.type) present[it.type] = Number(it.value || 0);
            if (Array.isArray(g.enchants)) {
              for (const e of g.enchants) {
                if (!e || !e.type) continue;
                // if the enchant targets a secondary type on this item, treat as supercharged
                if (present[e.type]) { isSupercharged = true; break; }
                // legacy-style supercharge objects may have type 'supercharge' with a target field
                if (e.type === 'supercharge' && e.target && present[e.target]) { isSupercharged = true; break; }
              }
            }
          } catch (e) {}

      // render base stat on its own line
      let html = `<div>${statLabel}: ${baseVal}</div>`;
      // compute element power and show per-item proc chance (uses same formula as combat: chance = min(0.6, power/200))
      try {
        let elemTotal = 0;
        if (window.Gear && typeof window.Gear.computeItemElementPower === 'function') {
          elemTotal = Number(window.Gear.computeItemElementPower(g) || 0);
        } else {
          elemTotal = (Number(baseVal || 0) + Number(g.rand1 || 0) + Number(g.rand2 || 0)) || 0;
        }
        if (elemTotal > 0) {
          const elemChance = Math.min(0.6, elemTotal / 200);
          const pct = Math.round(elemChance * 10000) / 100; // two decimals
          html += `<div>Element Power: ${elemTotal} — Proc: ${pct}%</div>`;
        }
      } catch (e) { /* ignore */ }
      if (interpretedList.length) {
        for (const interp of interpretedList) {
          const t = interp.type || 'secondary';
          const v = interp.value;
          const label = SECONDARY_LABELS[t] || (t.charAt(0).toUpperCase()+t.slice(1));
          if (t === 'critChance' || t === 'evasion' || t === 'lifesteal') html += `<div>${label}: ${Math.round((v||0)*10000)/100}%</div>`;
          else html += `<div>${label}: ${v}</div>`;
        }
      } else {
        // fallback: show legacy flat display if no interpreted secondaries
        const total = baseVal + r1 + r2;
        html += `<div>( +${r1} / +${r2} ) = ${total}</div>`;
      }
      stats.innerHTML = elementLine + html;
      // enchants display
      const enchantsDiv = document.createElement('div'); enchantsDiv.className = 'gear-enchants';
      // mapping and descriptions are defined at top-level and reused here
      try {
  if (Array.isArray(g.enchants) && g.enchants.length) {
          const ul = document.createElement('ul'); ul.style.margin='6px 0 0 12px'; ul.style.padding='0';
          for (const e of g.enchants) {
            const li = document.createElement('li'); li.style.listStyle='disc'; li.style.color='#ddd'; li.style.fontSize='0.9em';
            if (!e || !e.type) { li.textContent = 'Unknown enchant'; ul.appendChild(li); continue; }
            const val = e.value;
            switch(e.type) {
              case 'regen': li.textContent = `Regen: ${val} HP/turn`; break;
              case 'lifesteal': li.textContent = `Lifesteal: ${Math.round((val||0)*10000)/100}%`; break;
              case 'critChance': li.textContent = `Crit Chance: ${Math.round((val||0)*10000)/100}%`; break;
              case 'critDamage': li.textContent = `Crit Damage: +${val}%`; break;
              case 'evasion': li.textContent = `Evasion: ${Math.round((val||0)*10000)/100}%`; break;
              case 'maxHpPercent': li.textContent = `Max HP: +${val}%`; break;
              default: li.textContent = `${e.type}: ${val}`; break;
            }
            ul.appendChild(li);
          }
          enchantsDiv.appendChild(ul);
        } else {
          // show explicit 'no enchants' when none
          const none = document.createElement('div'); none.style.color='#9aa'; none.style.fontSize='0.9em'; none.textContent = 'No enchants'; enchantsDiv.appendChild(none);
        }
      } catch (err) { /* ignore UI render errors */ }
      // If detected supercharged, overlay a small icon on the item's image
      try {
        if (isSupercharged) {
          // ensure container can host positioned overlay
          try { top.style.position = top.style.position || 'relative'; } catch(e){}
          // small inline SVG star as overlay (green accent)
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28"><path fill="#6b3" d="M12 2l2.9 6.1L21 9.2l-5 3.9L17 21l-5-3.2L7 21l1-7.9-5-3.9 6.1-1.1z"/></svg>';
          const overlay = document.createElement('img');
          overlay.className = 'gear-super-overlay';
          overlay.alt = 'supercharged';
          overlay.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
          overlay.style.position = 'absolute';
          overlay.style.right = '6px';
          overlay.style.top = '6px';
          overlay.style.width = '28px';
          overlay.style.height = '28px';
          overlay.style.pointerEvents = 'none';
          overlay.style.zIndex = 5;
          top.appendChild(overlay);
        }
      } catch (e) {}

      // Append content (drag-to-trash handles deletion). No explicit delete button to keep UI minimal.
      card.appendChild(top); card.appendChild(slot); card.appendChild(stats); card.appendChild(enchantsDiv);
      el.appendChild(card);
    }
  }

  // Render an aggregate element-power panel for currently equipped items (shows proc chance %)
  function renderAggregate() {
    const container = document.getElementById('armory-aggregate'); if (!container) return;
    try {
      if (typeof Gear === 'undefined' || typeof Gear.computeEquipModifiers !== 'function') { container.textContent = '(gear module not loaded)'; return; }
      const mods = Gear.computeEquipModifiers() || {};
      const elems = mods.elements || {};
      const lines = [];
      const ELEMENT_ORDER = ['fire','electric','ice','wind','earth','neutral'];
      for (const el of ELEMENT_ORDER) {
        const power = Number(elems[el] || 0);
        if (power <= 0) continue;
        const chance = Math.min(0.6, power / 200);
        const pct = Math.round(chance * 10000) / 100; // two decimals
        lines.push(`<div style="margin:4px 0"><strong>${el.charAt(0).toUpperCase()+el.slice(1)}</strong>: ${pct}% chance (${power} power)</div>`);
      }
      container.innerHTML = lines.length ? lines.join('') : '(no elemental power from equipped items)';
    } catch (e) { container.textContent = '(error computing aggregate)'; }
  }

  

  // Drop handlers for global unequip and trash areas
  function setupGlobalDrops() {
    try {
      const unequip = document.getElementById('drop-unequip');
      const trash = document.getElementById('drop-trash');
      if (unequip) {
        // avoid attaching handlers more than once
        if (unequip.dataset.dropInit !== '1') {
          const dz = unequip.querySelector('.slot-drop');
          dz.addEventListener('dragover', (ev)=>{ ev.preventDefault(); dz.classList.add('can-drop'); });
          dz.addEventListener('dragleave', ()=> dz.classList.remove('can-drop'));
          dz.addEventListener('drop', (ev)=>{ ev.preventDefault(); dz.classList.remove('can-drop'); const gid = ev.dataTransfer.getData('text/gear-id'); if (!gid) return; // if equipped, unequip
            const emap = loadEquip(); let foundSlot = null; for (const s in emap) if (emap[s] === gid) { foundSlot = s; break; } if (foundSlot) { unequipSlot(foundSlot); } else { alert('Item is not currently equipped.'); } });
          unequip.dataset.dropInit = '1';
        }
      }
      if (trash) {
        if (trash.dataset.dropInit !== '1') {
          const dz2 = trash.querySelector('.slot-drop');
          dz2.addEventListener('dragover', (ev)=>{ ev.preventDefault(); dz2.classList.add('can-drop'); });
          dz2.addEventListener('dragleave', ()=> dz2.classList.remove('can-drop'));
          dz2.addEventListener('drop', (ev)=>{ ev.preventDefault(); dz2.classList.remove('can-drop'); const gid = ev.dataTransfer.getData('text/gear-id'); if (!gid) return; if (isInMatch()) { alert('Cannot delete items during an active match.'); return; } if (!confirm('Delete gear permanently?')) return; // remove gear and clean equip map
            (async ()=>{
              try { if (Gear && typeof Gear.removeGearByIdAndSync === 'function') await Gear.removeGearByIdAndSync(gid); else Gear.removeGearById(gid); } catch (e) { /* ignore */ }
              const eq = loadEquip(); for (const s in eq) if (eq[s] === gid) delete eq[s]; saveEquip(eq); render();
            })();
          });
          trash.dataset.dropInit = '1';
        }
      }
    } catch (e) { /* ignore setup errors */ }
  }

  function render() { renderSlots(); renderList(); renderAggregate(); setupGlobalDrops(); }


  window.addEventListener('DOMContentLoaded', async ()=>{
    // Attempt to sync server gear if user is signed in. Auth may resolve asynchronously,
    // so poll for window.currentUserUid for a short period and call sync when available.
    try {
      const trySync = async (uid) => {
        if (uid && window.Gear && typeof window.Gear.syncArmoryFromServer === 'function') {
          try { await window.Gear.syncArmoryFromServer(uid); } catch (e) { /* ignore sync errors */ }
        }
      };

      const uid = (typeof window !== 'undefined') ? window.currentUserUid : null;
      if (uid) {
        await trySync(uid);
        render();
        return;
      }

      // poll for auth for up to 5 seconds
      let waited = 0;
      const interval = setInterval(async () => {
        const uid2 = (typeof window !== 'undefined') ? window.currentUserUid : null;
        if (uid2) {
          clearInterval(interval);
          await trySync(uid2);
          render();
          return;
        }
        waited += 200;
        if (waited >= 5000) {
          clearInterval(interval);
          render();
        }
      }, 200);
    } catch (e) {
      try { render(); } catch (err) {}
    }
  });
  // expose render for other pages
  global.renderArmory = render;
  // Keep armory UI in sync across tabs: listen for storage changes to in_match_v1 and equip map
  try {
    window.addEventListener('storage', (ev) => {
      try {
        if (!ev) return;
        if (ev.key === 'in_match_v1' || ev.key === 'armory_equip_v1') {
          // re-render to update banner and equip state when changed in another tab
          render();
        }
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore if addEventListener unavailable */ }
})(window);
