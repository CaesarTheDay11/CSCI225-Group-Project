import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { ref, get, onValue, update } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

function el(id) { return document.getElementById(id); }

async function renderInventory(uid) {
  const container = el('profile-inventory');
  if (!container) return;
  container.textContent = '(loading...)';
  if (!uid) { container.textContent = '(not signed in)'; return; }

  try {
    const snap = await get(ref(db, `users/${uid}/items`));
    const items = snap.exists() ? snap.val() : {};
    container.innerHTML = '';
    if (!items || Object.keys(items).length === 0) {
      container.textContent = '(no items)';
      return;
    }

    for (const key of Object.keys(items)) {
      const it = items[key];
      const row = document.createElement('div');
      row.className = 'inv-row';
      const left = document.createElement('div'); left.textContent = `${it.name} x${it.qty}`;
      const right = document.createElement('div');
      const useBtn = document.createElement('button'); useBtn.textContent = 'Use'; useBtn.disabled = !(it.qty>0);
      useBtn.addEventListener('click', async () => {
        try {
          if (window && window.useItemForUser) {
            await window.useItemForUser(uid, key);
          } else {
            // fallback
            const itemRef = ref(db, `users/${uid}/items/${key}`);
            const iSnap = await get(itemRef);
            const qty = (iSnap.exists() && iSnap.val().qty) ? Number(iSnap.val().qty) : 0;
            if (qty <= 0) throw new Error('No item');
            const newQty = qty - 1;
            if (newQty <= 0) await update(itemRef, null); else await update(itemRef, { qty: newQty });
          }
          await renderInventory(uid);
        } catch (e) { console.error(e); alert('Could not use item: '+(e.message||e)); }
      });
      right.appendChild(useBtn);
      row.appendChild(left); row.appendChild(right);
      container.appendChild(row);
    }
  } catch (e) {
    console.error('renderInventory error', e);
    container.textContent = '(error)';
  }
}

async function renderStats(uid) {
  el('profile-name').textContent = '(loading...)';
  el('profile-selected-class').textContent = '(loading...)';
  el('profile-wins').textContent = '0';
  el('profile-losses').textContent = '0';
  if (!uid) { el('profile-name').textContent='(not signed in)'; return; }

  try {
    const uSnap = await get(ref(db, `users/${uid}`));
    const u = uSnap.exists() ? uSnap.val() : {};
    el('profile-name').textContent = u.displayName || u.email || uid;
    el('profile-selected-class').textContent = u.selectedClass || '(none)';
    el('profile-wins').textContent = (u.wins || 0);
    el('profile-losses').textContent = (u.losses || 0);
  } catch (e) { console.error('renderStats error', e); }
}

async function renderPlayedClasses(uid) {
  const node = el('played-classes-list');
  if (!node) return;
  node.textContent = '(loading...)';
  if (!uid) { node.textContent='(not signed in)'; return; }

  try {
    const snap = await get(ref(db, 'matches'));
    const counts = {};
    if (snap.exists()) {
      const matches = snap.val();
      for (const mid of Object.keys(matches)) {
        const m = matches[mid];
        if (!m.players) continue;
        if (m.players[uid]) {
          const classId = m.players[uid].classId || '(unset)';
          counts[classId] = (counts[classId] || 0) + 1;
        }
      }
    }
    node.innerHTML = '';
    if (!Object.keys(counts).length) { node.textContent = '(no recorded matches)'; return; }
    for (const k of Object.keys(counts)) {
      const d = document.createElement('div'); d.textContent = `${k}: ${counts[k]}`; node.appendChild(d);
    }
  } catch (e) { console.error('renderPlayedClasses error', e); node.textContent='(error)'; }
}

onAuthStateChanged(auth, async (user) => {
  const uid = user ? user.uid : null;
  if (!uid) {
    el('profile-name').textContent = '(not signed in)';
    el('profile-inventory').textContent = '(not signed in)';
    el('played-classes-list').textContent = '(not signed in)';
    return;
  }

  await renderStats(uid);
  await renderInventory(uid);
  await renderPlayedClasses(uid);

  // Hook add-test-potion button
  const addBtn = el('add-test-potion');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      try {
        if (window && window.addItemToUser) {
          await window.addItemToUser(uid, { id: 'potion_small', name: 'Small Potion', qty: 1 });
        } else {
          const pRef = ref(db, `users/${uid}/items/potion_small`);
          const s = await get(pRef);
          const qty = (s.exists() && s.val().qty) ? Number(s.val().qty) + 1 : 1;
          await update(pRef, { id: 'potion_small', name: 'Small Potion', qty });
        }
        await renderInventory(uid);
      } catch (e) { console.error(e); alert('Could not add item'); }
    });
  }
});
