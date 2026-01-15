(function(){
  // Consumable pool (larger than 5 so random picks vary)
  // Reasonable shop currency units (small ints). Gear salvage (see gear.js)
  // uses base rarity numbers roughly { common:5, uncommon:12, rare:35, epic:85, legendary:220 }
  // We price gear so shopPrice ~= 3 * rarityBase => salvage ~= 1/3 of shop price.
  // Increase rarity gaps so rarer items are worth much more.
  const BASE_GEAR_PRICE_BY_RARITY = { common: 20, uncommon: 60, rare: 300, epic: 1200, legendary: 4800 };
  // expose mapping so computeSalvageValue in gear.js can align salvage to shop prices
  try { if (typeof window !== 'undefined') window.BASE_GEAR_PRICE_BY_RARITY = BASE_GEAR_PRICE_BY_RARITY; } catch(e){}

  // Consumables should use ids that the battle code expects (see useItem in battle.js)
  const CONSUMABLE_POOL = [
    { id: 'potion_small', name: 'Minor Potion', desc: 'Heals a small amount', basePrice: 15 },
    { id: 'potion_large', name: 'Greater Potion', desc: 'Heals a large amount', basePrice: 50 },
    { id: 'elixir', name: 'Elixir of Might', desc: 'Restore mana + short attack buff', basePrice: 200 },
    { id: 'scroll_luck', name: 'Scroll of Luck', desc: 'Temporarily increases luck for loot', basePrice: 40 },
    { id: 'shield_token', name: 'Shield Token', desc: 'Temporary +defense shield', basePrice: 25 },
    { id: 'bomb', name: 'Bomb', desc: 'Deal damage to enemy', basePrice: 25 },
    { id: 'strength_tonic', name: 'Strength Tonic', desc: 'Temporary strength boost', basePrice: 20 },
    { id: 'revive_scroll', name: 'Revive Scroll', desc: 'Prepare a one-time revive', basePrice: 120 },
    { id: 'speed_scroll', name: 'Speed Scroll', desc: 'Gain an extra action', basePrice: 30 },
    { id: 'swift_boots', name: 'Swift Boots', desc: 'Haste for a few turns', basePrice: 60 },
    { id: 'focus_charm', name: 'Focus Charm', desc: 'Small crit chance boost', basePrice: 45 }
  ];

  const SHOP_REFRESH_PRICE = 100; // reasonable cost to force-refresh shop
  const SHOP_TTL_MS = 1000 * 60 * 60; // 1 hour

  function formatPrice(n) { return (Number(n) || 0).toLocaleString(); }

  // Use the project's same item/gear image logic as the battle UI so visuals match.
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
    swift_boots: 'swift boots.jpg',
    focus_charm: 'focus charm.jpg',
  };

  function getItemImagePaths(itemId) {
    const mapped = ITEM_IMAGE_MAP[itemId];
    if (mapped) {
      const jpg = `img/${mapped}`;
      const svg = mapped.endsWith('.jpg') ? `img/${mapped.slice(0, -4)}.svg` : `img/${mapped}.svg`;
      return { jpg, svg };
    }
    return { jpg: `img/items/${itemId}.jpg`, svg: `img/items/${itemId}.svg` };
  }

  // Return an ordered list of candidate image paths for a gear object (copied from battle.js logic).
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
      if (el && folder === 'chestplate') candidates.push(`img/gear/${folder}/${el}_${folder}.png`);
      const ELEMENT_SPLIT = { fire:1, lightning:2, ice:3, wind:4, earth:5, neutral:6 };
      if (el && ELEMENT_SPLIT[el]) candidates.push(`img/gear/${folder}/split_${ELEMENT_SPLIT[el]}.png`);
      const id = g.id || (g.name ? g.name.replace(/\s+/g,'_').toLowerCase() : Math.random().toString(36).slice(2,8));
      let h = 0; for (let i=0;i<id.length;i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      const idx = (h % 6) + 1;
      candidates.push(`img/gear/${folder}/split_${idx}.png`);
      if (metaId) {
        const p = getItemImagePaths(metaId || id);
        if (p.jpg) candidates.push(p.jpg);
        if (p.svg) candidates.push(p.svg);
      }
    } catch (e) { /* ignore */ }
    candidates.push('img/gear/sword/split_1.png');
    return candidates.filter(Boolean);
  }

  // pick N random unique items from pool
  function pickRandom(list, n) {
    const copy = list.slice();
    const out = [];
    while (out.length < n && copy.length) {
      const i = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(i,1)[0]);
    }
    return out;
  }

  // generate gear offers: create N gear previews with randomized rarities using Gear.pickRarity if available
  function generateGearOffers(n) {
    const offers = [];
    for (let i=0;i<n;i++) {
      try {
        const rarity = (window.Gear && typeof window.Gear.pickRarity === 'function') ? window.Gear.pickRarity() : (['common','uncommon','rare','epic','legendary'][Math.floor(Math.random()*5)]);
        const gear = (window.Gear && typeof window.Gear.generateGear === 'function') ? window.Gear.generateGear(null, rarity) : null;
        const name = gear && window.Gear && typeof window.Gear.prettyName === 'function' ? window.Gear.prettyName(gear, gear.rarity) : (rarity + ' item');
        // base price tied to rarity so salvage (~gear.computeSalvageValue) is approx 1/3 of shop price
        const basePrice = BASE_GEAR_PRICE_BY_RARITY[rarity] || 15;
        // small variation by index so offers are not identical
        const multiplier = 1 + (i * 0.15);
        const price = Math.max(5, Math.round(basePrice * multiplier));
        offers.push({ id: (gear && gear.id) ? gear.id : ('offer_'+Math.random().toString(36).slice(2,8)), name, gear, rarity, price });
      } catch (e) { offers.push({ id: 'offer_'+i, name: 'Unknown', gear: null, rarity: 'rare', price: BASE_GEAR_PRICE_BY_RARITY.rare || 105 }); }
    }
    return offers;
  }

  // Server-backed shop: store per-user offers at users/{uid}/shop { ts, consumables, gear }
  async function loadOrCreateOffers() {
    const uid = window.currentUserUid;
    // If we don't have a logged-in user or DB helpers, generate ephemeral offers client-side
    if (!uid || typeof db === 'undefined' || typeof ref !== 'function' || typeof get !== 'function' || typeof update !== 'function') {
      return { ts: Date.now(), consumables: pickRandom(CONSUMABLE_POOL,5).map(i=>Object.assign({},i,{ price: i.basePrice })), gear: generateGearOffers(5) };
    }

    try {
      const snap = await get(ref(db, `users/${uid}/shop`));
      const now = Date.now();
      if (snap && snap.exists()) {
        const data = snap.val();
        // If shop expired, or missing arrays, or arrays empty, force regeneration
        if (data && data.ts && (now - data.ts) < SHOP_TTL_MS && Array.isArray(data.consumables) && Array.isArray(data.gear) && data.consumables.length > 0 && data.gear.length > 0) {
          return data;
        }
      }
      // generate new offers and write to server
  const consumables = pickRandom(CONSUMABLE_POOL,5).map(i=>Object.assign({},i,{ price: i.basePrice }));
  const gear = generateGearOffers(5);
      const payload = { ts: now, consumables, gear };
      // update at parent path users/{uid}/shop
      await update(ref(db, `users/${uid}`), { shop: payload });
      return payload;
    } catch (e) {
      console.warn('loadOrCreateOffers failed, falling back to client-only', e);
      return { ts: Date.now(), consumables: pickRandom(CONSUMABLE_POOL,5).map(i=>Object.assign({},i,{ price: i.basePrice })), gear: generateGearOffers(5) };
    }
  }

  async function forceRefreshOffersPaid() {
    const uid = window.currentUserUid;
    if (!uid) { alert('Please log in'); return false; }
    if (!window.Gear || typeof window.Gear.getGold !== 'function' || typeof window.Gear.creditGoldOnServer !== 'function') { alert('Server gold required for paid refresh'); return false; }
    try {
      const gold = await window.Gear.getGold();
      if (gold < SHOP_REFRESH_PRICE) { alert('Not enough gold for refresh.'); return false; }
      const res = await window.Gear.creditGoldOnServer(uid, -SHOP_REFRESH_PRICE);
      if (res === null) { alert('Could not charge gold for refresh.'); return false; }
      // generate fresh offers and write
      const consumables = pickRandom(CONSUMABLE_POOL,5).map(i=>Object.assign({},i,{ price: i.basePrice }));
      const gear = generateGearOffers(5);
      const payload = { ts: Date.now(), consumables, gear };
      if (typeof db !== 'undefined' && typeof ref === 'function' && typeof update === 'function') await update(ref(db, `users/${uid}`), { shop: payload });
      await renderShop();
      return true;
    } catch (e) { console.error('forceRefreshOffersPaid failed', e); alert('Refresh failed'); return false; }
  }

  async function renderShop() {
    const itemsEl = document.getElementById('shop-items');
    const gearEl = document.getElementById('shop-gear');
    const refreshContainer = document.getElementById('shop-refresh');
    const data = await loadOrCreateOffers();
    if (refreshContainer) {
      refreshContainer.innerHTML = '';
      const info = document.createElement('div'); info.textContent = 'Offers refresh hourly. Last refresh: ' + new Date(data.ts).toLocaleString();
      const btn = document.createElement('button'); btn.type='button'; btn.textContent = 'Refresh (pay ' + formatPrice(SHOP_REFRESH_PRICE) + ')';
      btn.addEventListener('click', async ()=>{ btn.disabled = true; await forceRefreshOffersPaid(); btn.disabled = false; });
      refreshContainer.appendChild(info); refreshContainer.appendChild(btn);
    }

    if (itemsEl) {
      itemsEl.innerHTML = '';
      for (const it of (data.consumables || [])) {
        const c = document.createElement('div'); c.className = 'shop-card';
        // create image element with jpg/svg fallback like battle.js
        const paths = getItemImagePaths(it.id);
        const imgEl = document.createElement('img'); imgEl.src = paths.jpg; imgEl.alt = it.name || it.id;
        imgEl.style.width = '64px'; imgEl.style.height = '64px'; imgEl.style.objectFit = 'contain'; imgEl.style.display = 'block'; imgEl.style.margin = '6px auto';
        imgEl.onerror = function(){ if(!this._triedSvg){ this._triedSvg = true; this.src = paths.svg; return; } this.style.opacity = '0.6'; };
        c.appendChild(imgEl);
        const title = document.createElement('h3'); title.textContent = it.name; c.appendChild(title);
        const desc = document.createElement('div'); desc.textContent = it.desc; c.appendChild(desc);
        const price = document.createElement('div'); price.className = 'shop-price'; price.textContent = 'Price: ' + formatPrice(it.price); c.appendChild(price);
        const actions = document.createElement('div'); actions.className='shop-actions';
        const btn = document.createElement('button'); btn.type='button'; btn.textContent='Buy';
        btn.addEventListener('click', async ()=>{ await buyConsumable(it); });
        actions.appendChild(btn); c.appendChild(actions);
        itemsEl.appendChild(c);
      }
    }
    if (gearEl) {
      gearEl.innerHTML = '';
      for (const g of (data.gear || [])) {
        const c = document.createElement('div'); c.className = 'shop-card';
        // gear image candidates mimic battle UI chooser: element-specific, split images, then per-item images
        const candidates = getGearImageCandidates(g.gear || g, (g.gear && g.gear.id) || g.id || null);
        const imgEl = document.createElement('img'); imgEl.alt = g.name || g.id || 'gear';
        imgEl.style.width = '64px'; imgEl.style.height = '64px'; imgEl.style.objectFit = 'contain'; imgEl.style.display = 'block'; imgEl.style.margin = '6px auto';
        let ci = 0; if (candidates && candidates.length) imgEl.src = candidates[ci];
        imgEl.onerror = function(){ try { ci++; if (ci < candidates.length) { this.src = candidates[ci]; return; } this.style.opacity='0.6'; } catch(e){} };
        c.appendChild(imgEl);
        const title = document.createElement('h3'); title.textContent = g.name; c.appendChild(title);
        const rarity = document.createElement('div'); rarity.textContent = 'Rarity: ' + g.rarity; c.appendChild(rarity);
        const price = document.createElement('div'); price.className = 'shop-price'; price.textContent = 'Price: ' + formatPrice(g.price); c.appendChild(price);
        const actions = document.createElement('div'); actions.className='shop-actions';
        const btn = document.createElement('button'); btn.type='button'; btn.textContent='Buy';
        btn.addEventListener('click', async ()=>{ await buyGearOffer(g); });
        actions.appendChild(btn); c.appendChild(actions);
        gearEl.appendChild(c);
      }
    }
  }

  // validate that an offer still exists on the server/client before charging
  async function validateOffer(offer, kind) {
    try {
      const data = await loadOrCreateOffers();
      if (kind === 'consumable') {
        return Array.isArray(data.consumables) && data.consumables.some(c => c.id === offer.id && Number(c.price) === Number(offer.price));
      }
      if (kind === 'gear') {
        return Array.isArray(data.gear) && data.gear.some(g => g.id === offer.id && Number(g.price) === Number(offer.price));
      }
      return false;
    } catch (e) { return false; }
  }

  async function buyConsumable(it) {
    try {
      // re-validate the offer exists and price matches
      const ok = await validateOffer(it, 'consumable');
      if (!ok) { alert('This consumable is no longer available or its price changed. Refreshing shop.'); await renderShop(); return; }
      const uid = window.currentUserUid;
      if (!uid) { alert('Please log in to buy items'); return; }
      if (typeof db !== 'undefined' && typeof ref === 'function') {
        // try to perform an atomic transaction server-side to deduct gold and remove the offer
        try {
          const mod = await import('https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js');
          const { runTransaction } = mod;
          const userRef = ref(db, `users/${uid}`);
          const res = await runTransaction(userRef, (current) => {
            if (!current) return; // abort
            const curGold = Number(current.gold || 0);
            const shop = (current.shop) ? current.shop : { consumables: [], gear: [] };
            const idx = Array.isArray(shop.consumables) ? shop.consumables.findIndex(c => c.id === it.id && Number(c.price) === Number(it.price)) : -1;
            if (idx === -1) return; // offer missing
            if (curGold < Number(it.price)) return; // insufficient funds
            // deduct and remove the consumed offer
            current.gold = Math.max(0, curGold - Number(it.price));
            shop.consumables = shop.consumables.slice(); shop.consumables.splice(idx,1);
            current.shop = shop;
            // record last purchase time
            current.lastShopPurchaseAt = Date.now();
            return current;
          });
          if (res.committed) {
            alert('Purchased ' + it.name + ' for ' + formatPrice(it.price) + ' gold');
            // client-side: grant item locally (if helper exists)
            if (window && typeof window.grantConsumableToUser === 'function') {
              try { await window.grantConsumableToUser(uid, it.id); } catch(e){}
            }
            await renderShop();
            return;
          }
        } catch (e) { console.warn('atomic purchase failed, falling back', e); }
      }
      // fallback: legacy flow (non-atomic)
      if (!window.Gear || typeof window.Gear.getGold !== 'function' || typeof window.Gear.creditGoldOnServer !== 'function') { alert('Shop requires server-backed gold; purchase unavailable'); return; }
      const gold = await window.Gear.getGold();
      if (gold < it.price) { alert('Not enough gold. You have ' + gold); return; }
      const newVal = await window.Gear.creditGoldOnServer(uid, -it.price);
      if (newVal === null) { alert('Purchase failed: server error'); return; }
      // best-effort: remove purchased offer from server shop so it's not buyable again
      try { if (typeof db !== 'undefined' && typeof ref === 'function' && typeof update === 'function') {
        const snap = await get(ref(db, `users/${uid}/shop`));
        const data = (snap && snap.exists()) ? snap.val() : null;
        if (data && Array.isArray(data.consumables)) {
          const idx = data.consumables.findIndex(c=>c.id===it.id && Number(c.price)===Number(it.price));
          if (idx!==-1) { data.consumables.splice(idx,1); await update(ref(db, `users/${uid}`), { shop: Object.assign({}, data, { ts: Date.now() }) }); }
        }
      }} catch(e){}
      alert('Purchased ' + it.name + ' for ' + formatPrice(it.price) + ' gold');
      await renderShop();
    } catch (e) { console.error('buyConsumable failed', e); alert('Purchase failed'); }
  }

  async function buyGearOffer(offer) {
    try {
      // re-validate the offer exists and price matches
      const ok = await validateOffer(offer, 'gear');
      if (!ok) { alert('This gear offer is no longer available or its price changed. Refreshing shop.'); await renderShop(); return; }
      const uid = window.currentUserUid;
      if (!uid) { alert('Please log in to buy items'); return; }
      // try atomic purchase via transaction when DB available
      if (typeof db !== 'undefined' && typeof ref === 'function') {
        try {
          const mod = await import('https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js');
          const { runTransaction } = mod;
          const userRef = ref(db, `users/${uid}`);
          const res = await runTransaction(userRef, (current) => {
            if (!current) return; // abort
            const curGold = Number(current.gold || 0);
            const shop = (current.shop) ? current.shop : { consumables: [], gear: [] };
            const idx = Array.isArray(shop.gear) ? shop.gear.findIndex(g => g.id === offer.id && Number(g.price) === Number(offer.price)) : -1;
            if (idx === -1) return; // offer missing
            if (curGold < Number(offer.price)) return; // insufficient funds
            // deduct gold and remove offer
            current.gold = Math.max(0, curGold - Number(offer.price));
            const picked = shop.gear[idx];
            shop.gear = shop.gear.slice(); shop.gear.splice(idx,1);
            current.shop = shop;
            // attach purchased gear server-side under users/{uid}/gear/{id} when gear object exists
            try {
              if (!current.gear) current.gear = {};
              if (picked && picked.gear && picked.gear.id) {
                current.gear[picked.gear.id] = picked.gear;
              }
            } catch(e){}
            current.lastShopPurchaseAt = Date.now();
            return current;
          });
          if (res.committed) {
            // if server didn't include gear object, create locally
            const purchased = (res.snapshot && res.snapshot.val && res.snapshot.val().lastShopPurchaseAt) ? true : true;
            const gearObj = offer.gear || (window.Gear && typeof window.Gear.generateGear === 'function' ? window.Gear.generateGear(null, offer.rarity) : null);
            if (gearObj && typeof window.Gear.addGearToArmoryAndSync === 'function') {
              try { await window.Gear.addGearToArmoryAndSync(gearObj); } catch(e) { try { window.Gear.addGearToArmory(gearObj); } catch(_){} }
            }
            alert('Purchased ' + offer.name + ' for ' + formatPrice(offer.price) + ' gold');
            await renderShop();
            return;
          }
        } catch (e) { console.warn('atomic gear purchase failed, falling back', e); }
      }
      // fallback legacy flow
      if (!window.Gear || typeof window.Gear.getGold !== 'function' || typeof window.Gear.creditGoldOnServer !== 'function') { alert('Shop requires server-backed gold; purchase unavailable'); return; }
      const gold = await window.Gear.getGold();
      if (gold < offer.price) { alert('Not enough gold. You have ' + gold); return; }
      const newVal = await window.Gear.creditGoldOnServer(uid, -offer.price);
      if (newVal === null) { alert('Purchase failed: server error'); return; }
      // award gear
      const gear = offer.gear || (window.Gear && window.Gear.generateGear ? window.Gear.generateGear(null, offer.rarity) : null);
      if (gear && typeof window.Gear.addGearToArmoryAndSync === 'function') {
        try { await window.Gear.addGearToArmoryAndSync(gear); } catch(e) { console.warn('failed to sync gear', e); if (window.Gear && typeof window.Gear.addGearToArmory === 'function') window.Gear.addGearToArmory(gear); }
      }
      // best-effort: remove purchased offer from server shop
      try { if (typeof db !== 'undefined' && typeof ref === 'function' && typeof update === 'function') {
        const snap = await get(ref(db, `users/${uid}/shop`));
        const data = (snap && snap.exists()) ? snap.val() : null;
        if (data && Array.isArray(data.gear)) {
          const idx = data.gear.findIndex(g=>g.id===offer.id && Number(g.price)===Number(offer.price));
          if (idx!==-1) { data.gear.splice(idx,1); await update(ref(db, `users/${uid}`), { shop: Object.assign({}, data, { ts: Date.now() }) }); }
        }
      }} catch(e){}
      alert('Purchased ' + offer.name + ' for ' + formatPrice(offer.price) + ' gold');
      await renderShop();
    } catch (e) { console.error('buyGearOffer failed', e); alert('Purchase failed'); }
  }

  window.addEventListener('DOMContentLoaded', ()=>{ 
    // create refresh container if missing
    try {
      if (!document.getElementById('shop-refresh')) {
        const parent = document.querySelector('body');
        const el = document.createElement('div'); el.id = 'shop-refresh'; el.style.margin='12px 0'; parent.insertBefore(el, parent.firstChild.nextSibling);
      }
    } catch(e){}
    renderShop();
  });
})();
