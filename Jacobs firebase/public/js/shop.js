(function(){
  // Consumable pool (larger than 5 so random picks vary)
  const CONSUMABLE_POOL = [
    { id: 'potion_small', name: 'Minor Potion', desc: 'Heals a tiny amount', basePrice: 100000 },
    { id: 'potion_big', name: 'Greater Potion', desc: 'Heals a large amount', basePrice: 500000 },
    { id: 'elixir', name: 'Elixir of Might', desc: 'Temporary +50% attack', basePrice: 1000000 },
    { id: 'scroll_luck', name: 'Scroll of Luck', desc: 'Slightly boosts loot luck', basePrice: 250000 },
    { id: 'token', name: 'Mystery Token', desc: 'Redeem for a surprise (maybe)', basePrice: 9999999 },
    { id: 'bomb', name: 'Bomb', desc: 'Deal damage to enemy', basePrice: 300000 },
    { id: 'stamina', name: 'Stamina Draught', desc: 'Restore action points', basePrice: 150000 }
  ];

  const SHOP_REFRESH_PRICE = 500000; // cost to force-refresh shop (very high)
  const SHOP_TTL_MS = 1000 * 60 * 60; // 1 hour

  function formatPrice(n) { return (Number(n) || 0).toLocaleString(); }

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
        const price = Math.max(10000, Math.round(((i+1) * 1000000) * (rarity === 'legendary' ? 4 : rarity === 'epic' ? 2 : rarity === 'rare' ? 1.2 : 1)));
        offers.push({ id: (gear && gear.id) ? gear.id : ('offer_'+Math.random().toString(36).slice(2,8)), name, gear, rarity, price });
      } catch (e) { offers.push({ id: 'offer_'+i, name: 'Unknown', gear: null, rarity: 'rare', price: 5000000 }); }
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
        if (data && data.ts && (now - data.ts) < SHOP_TTL_MS && data.consumables && data.gear) {
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
        c.innerHTML = `<h3>${it.name}</h3><div>${it.desc}</div><div class="shop-price">Price: ${formatPrice(it.price)}</div>`;
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
        let html = `<h3>${g.name}</h3><div>Rarity: ${g.rarity}</div><div class="shop-price">Price: ${formatPrice(g.price)}</div>`;
        c.innerHTML = html;
        const actions = document.createElement('div'); actions.className='shop-actions';
        const btn = document.createElement('button'); btn.type='button'; btn.textContent='Buy';
        btn.addEventListener('click', async ()=>{ await buyGearOffer(g); });
        actions.appendChild(btn); c.appendChild(actions);
        gearEl.appendChild(c);
      }
    }
  }

  async function buyConsumable(it) {
    try {
      const uid = window.currentUserUid;
      if (!uid) { alert('Please log in to buy items'); return; }
      if (!window.Gear || typeof window.Gear.getGold !== 'function' || typeof window.Gear.creditGoldOnServer !== 'function') { alert('Shop requires server-backed gold; purchase unavailable'); return; }
      const gold = await window.Gear.getGold();
      if (gold < it.price) { alert('Not enough gold. You have ' + gold); return; }
      const newVal = await window.Gear.creditGoldOnServer(uid, -it.price);
      if (newVal === null) { alert('Purchase failed: server error'); return; }
      alert('Purchased ' + it.name + ' for ' + formatPrice(it.price) + ' gold');
      await renderShop();
    } catch (e) { console.error('buyConsumable failed', e); alert('Purchase failed'); }
  }

  async function buyGearOffer(offer) {
    try {
      const uid = window.currentUserUid;
      if (!uid) { alert('Please log in to buy items'); return; }
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
