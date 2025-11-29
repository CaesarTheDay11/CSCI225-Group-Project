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

    // Render inventory as read-only: show image, name and quantity only (no in-profile item usage)
    const ITEM_IMAGE_MAP = {
      potion_small: 'small potion.jpg',
      potion_large: 'large potion.jpg',
      bomb: 'bomb.jpg',
      elixir: 'elixir.jpg',
      shield_token: 'shield scroll.jpg',
      speed_scroll: 'speed scroll.jpg',
      strength_tonic: 'strength tonic.jpg',
      revive_scroll: 'revive scroll.jpg'
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

    for (const key of Object.keys(items)) {
      const it = items[key];
      const row = document.createElement('div');
      row.className = 'inv-row';

      // left: image + name/qty
      const left = document.createElement('div');
      left.className = 'inv-left';
      const img = document.createElement('img');
      img.className = 'inv-item-img';
      // resolve image path (try JPG then SVG then fallback to inline)
      const { jpg, svg } = getItemImagePaths(it.id || key);
      img.onerror = function() {
        if (!img._triedSvg) {
          img._triedSvg = true;
          img.src = svg;
          return;
        }
        // final fallback: inline placeholder
        const inline = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='100%' height='100%' fill='%23eee'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='12' fill='%23666'>${(it.name||'?').slice(0,2)}</text></svg>`;
        img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(inline);
        img.onerror = null;
      };
      img.src = jpg;

      const text = document.createElement('div');
      text.textContent = `${it.name || key} x${it.qty}`;
      left.appendChild(img);
      left.appendChild(text);

      row.appendChild(left);
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
