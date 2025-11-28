import { auth, db, } from "./firebase.js";

/*
import {
  connectFunctionsEmulator,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";
*/

import {
  onValue,
  ref,
  set,
  update,
  get,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"

import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

// setup connection listener
const connectedRef = ref(db, ".info/connected");
onValue(connectedRef, (snap) => {
  console.log("connected:", snap.val());
});

var uid
var queueRef;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("user").textContent =
      `Signed in as ${user.displayName || user.email}`;
    document.getElementById("queueBtn").style = "display: inline;";
    writeUserData(user.uid, user.displayName);
    uid = user.uid;
    // sync any locally selected class into the user's DB record so functions can read it
    try {
      const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
      if (local) {
        // write selectedClass to user node
        await update(ref(db, `users/${uid}`), { selectedClass: local });
      }
    } catch (err) {
      console.error('Error syncing local selectedClass to DB on sign-in', err);
    }
    const matchRef = ref(db, "users/" + uid + "/currentMatch");
    queueRef = ref(db, 'queue/' + uid);
    onDisconnect(queueRef).remove();

    document.querySelectorAll('.not-logged-in-vis')
      .forEach(el => el.style.display = 'none');

    // Ensure battle UI is hidden initially when user logs in
    document.getElementById("battle").style.display = "none";

    console.log(user);

    // Ensure starter items exist for this user (do not overwrite existing items)
    try {
      await seedStarterItemsIfMissing(uid);
    } catch (e) {
      console.error('Error seeding starter items for user', e);
    }


    onValue(matchRef, snap => {
      if (snap.exists()) {
        const matchId = snap.val();
        document.getElementById("queueBtn").style.display = "none"; // Hide match button when in match
          document.getElementById("battle").style.display = "block";
          // hide class selector when in a match
          const cs = document.getElementById('class-select'); if (cs) cs.style.display = 'none';
        console.log("Matched! Match ID:", matchId);
        // Initialize battle when match is found
        // Wait a bit for battle.js to load if it hasn't yet
        setTimeout(() => {
          if (typeof window.initializeBattle === 'function') {
            window.initializeBattle(matchId, uid);
          } else {
            console.error("initializeBattle function not found!");
          }
        }, 100);
      } else {
        document.getElementById("queueBtn").style.display = "inline"; // Show match button when not in match
        document.getElementById("battle").style.display = "none";
        // show class selector when not in a match
        const cs2 = document.getElementById('class-select'); if (cs2) cs2.style.display = '';
      }
    });


  } else {
    document.getElementById("user").textContent = "Not signed in";
    document.getElementById("battle").style.display = "none";
  }
});

function writeUserData(userId, name) {
  // use update to avoid overwriting other fields (like selectedClass)
  update(ref(db, 'users/' + userId), {
    displayName: name,
  });
}

async function updateQueueData() {
  // TODO: store rank value later for skill based matchmaking
  document.getElementsByClassName("queueBtn")[0].textContent = "Finding a Match...";
  document.getElementById("battle").style.display = "none"; // Hide battle UI while searching
  // ensure selectedClass is written to DB before adding to queue (avoid race)
  try {
    const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
    if (local && uid) {
      await update(ref(db, `users/${uid}`), { selectedClass: local });
    }
  } catch (err) {
    console.error('Error writing selectedClass before queueing', err);
  }
  // write queue entry that includes selectedClass to avoid cross-node races
  try {
    const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
    const payload = { uid: uid };
    if (local) payload.selectedClass = local;
    if (queueRef) {
      await set(queueRef, payload);
    } else {
      await set(ref(db, `queue/${uid}`), payload);
    }
  } catch (err) {
    console.error('Error writing queue entry', err);
  }
}

document.getElementById("queueBtn").addEventListener("click", (e) => { updateQueueData().catch(console.error); }, false);

// Class selection UI wiring (visible before joining a match)
function initClassSelector() {
  const container = document.getElementById('class-select');
  if (!container) {
    console.debug('Class selector: container not found');
    return;
  }
  const label = document.getElementById('selected-class-label');

  function setSelectedClass(classId) {
    (async () => {
      try { localStorage.setItem('selectedClass', classId); } catch (e) {}
      if (label) label.textContent = `Selected: ${classId}`;
      console.debug('Class selector: selected', classId);
      // If signed in, write to DB and await to ensure persistence
      if (typeof uid !== 'undefined' && uid) {
        try {
          await update(ref(db, `users/${uid}`), { selectedClass: classId });
        } catch (err) {
          console.error('Error saving selectedClass to DB on selection', err);
        }
      }
      // update visible status
      updateClassStatusUI().catch(console.error);
    })();
  }

  function markActive(classId) {
    Array.from(container.querySelectorAll('[data-class]')).forEach(b => b.classList.remove('active'));
    if (!classId) return;
    const btn = container.querySelector(`[data-class='${classId}']`);
    if (btn) btn.classList.add('active');
  }
  // attach handlers to buttons
  let classButtons = Array.from(container.querySelectorAll('[data-class]'));
  // If no buttons are present (HTML not updated or cached), create fallback buttons dynamically
  if (!classButtons || classButtons.length === 0) {
    console.warn('[class-select] no class buttons found in DOM — creating fallback buttons');
    const classes = ['warrior','mage','archer','cleric','knight','rogue','paladin','necromancer','druid'];
    let grid = container.querySelector('.class-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'class-grid';
      container.appendChild(grid);
    }
    classes.forEach(cid => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-class', cid);
      b.className = 'class-btn';
      const label = cid.charAt(0).toUpperCase() + cid.slice(1);
      b.textContent = label;
      // small descriptive tooltip for fallback buttons
      const descMap = {
        warrior: 'Warrior — tough melee fighter, high HP and defense',
        mage: 'Mage — powerful spellcaster with mana and area damage',
        archer: 'Archer — ranged DPS, balanced attack and accuracy',
        cleric: 'Cleric — divine healer, can restore HP and remove DOTs',
        knight: 'Knight — heavy tank, strong defense and crowd control',
        rogue: 'Rogue — high single-target damage, stealthy strikes',
        paladin: 'Paladin — hybrid support with heals and offensive strikes',
        necromancer: 'Necromancer — deals necrotic damage and siphons life',
        druid: 'Druid — nature caster: heal-over-time and control'
      };
      if (descMap[cid]) {
        b.classList.add('has-tooltip');
        b.setAttribute('data-tooltip', descMap[cid]);
      }
      grid.appendChild(b);
    });
    classButtons = Array.from(container.querySelectorAll('[data-class]'));
  }

  classButtons.forEach(btn => {
    btn.addEventListener('click', (ev) => {
      const cls = btn.getAttribute('data-class');
      // fire-and-forget async selection handler
      try { setSelectedClass(cls); } catch (e) { console.error(e); }
      // visually mark active
      try { markActive(cls); } catch (e) { /* ignore */ }
    });
  });

  // initialize label from localStorage
  const existing = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
  if (existing && label) label.textContent = `Selected: ${existing}`;
  // mark active button visually
  try { markActive(existing); } catch (e) { /* ignore */ }
  console.debug('Class selector initialized, existing:', existing);
  // update visible status on init
  updateClassStatusUI().catch(console.error);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initClassSelector);
} else {
  // DOMContentLoaded already fired, initialize immediately
  initClassSelector();
}

// Update the visible class status element: local value and saved DB value
async function updateClassStatusUI() {
  const display = document.getElementById('selected-class-display');
  const saved = document.getElementById('selected-class-saved');
  const local = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
  if (display) display.textContent = local || '(none)';

  if (!saved) return;
  if (!uid) {
    saved.textContent = '(not signed in)';
    saved.style.color = 'gray';
    return;
  }

  try {
    const snap = await get(ref(db, `users/${uid}/selectedClass`));
    if (snap.exists()) {
      const dbVal = snap.val();
      if (dbVal === local) {
        saved.textContent = `(saved: ${dbVal})`;
        saved.style.color = 'green';
      } else {
        saved.textContent = `(saved: ${dbVal || 'none'})`;
        saved.style.color = 'orange';
      }
    } else {
      saved.textContent = '(not saved)';
      saved.style.color = 'gray';
    }
  } catch (err) {
    console.error('Error reading selectedClass from DB', err);
    saved.textContent = '(db error)';
    saved.style.color = 'red';
  }
}

// --------------------
// Per-user items (inventory) helpers
// Schema: users/<uid>/items/{ itemId: { id, name, qty } }
// --------------------
async function seedStarterItemsIfMissing(uid) {
  if (!uid) return;
  try {
    const snap = await get(ref(db, `users/${uid}/items`));
    if (!snap.exists()) {
      // Seed one of each item for testing
      const starter = {
        potion_small: { id: 'potion_small', name: 'Small Potion', qty: 1 },
        potion_large: { id: 'potion_large', name: 'Large Potion', qty: 1 },
        bomb: { id: 'bomb', name: 'Bomb', qty: 1 },
        elixir: { id: 'elixir', name: 'Elixir', qty: 1 },
        shield_token: { id: 'shield_token', name: 'Shield Token', qty: 1 },
        speed_scroll: { id: 'speed_scroll', name: 'Speed Scroll', qty: 1 },
        strength_tonic: { id: 'strength_tonic', name: 'Strength Tonic', qty: 1 },
        revive_scroll: { id: 'revive_scroll', name: 'Revive Scroll', qty: 1 }
      };
      // Use update so we don't overwrite other user fields
      await update(ref(db, `users/${uid}`), { items: starter });
      console.log('Seeded starter items for user', uid);
    }
  } catch (e) {
    console.error('seedStarterItemsIfMissing error', e);
  }
}

async function getUserItems(uid) {
  if (!uid) return {};
  const snap = await get(ref(db, `users/${uid}/items`));
  return snap.exists() ? snap.val() : {};
}

async function addItemToUser(uid, item) {
  // item: { id, name, qty }
  if (!uid || !item || !item.id) throw new Error('Invalid args to addItemToUser');
  const itemRef = ref(db, `users/${uid}/items/${item.id}`);
  const snap = await get(itemRef);
  if (snap.exists()) {
    const existing = snap.val();
    const newQty = (existing.qty || 0) + (item.qty || 1);
    await update(itemRef, { qty: newQty, name: item.name || existing.name });
  } else {
    await update(itemRef, { id: item.id, name: item.name || item.id, qty: item.qty || 1 });
  }
}

async function useItemForUser(uid, itemId) {
  if (!uid || !itemId) throw new Error('Invalid args to useItemForUser');
  const itemRef = ref(db, `users/${uid}/items/${itemId}`);
  const snap = await get(itemRef);
  if (!snap.exists()) throw new Error('Item not found');
  const item = snap.val();
  const qty = item.qty || 0;
  if (qty <= 0) throw new Error('No item left');
  const newQty = qty - 1;
  if (newQty <= 0) {
    // remove the item node when qty hits zero
    await set(itemRef, null);
  } else {
    await update(itemRef, { qty: newQty });
  }
  return item;
}

// Expose quick helpers for debugging in console
window.getUserItems = getUserItems;
window.addItemToUser = addItemToUser;
window.useItemForUser = useItemForUser;

// Item catalog (used for reward selection and UI labels)
const ITEM_CATALOG = {
  potion_small: { id: 'potion_small', name: 'Small Potion', desc: 'Heals 20 HP.' },
  potion_large: { id: 'potion_large', name: 'Large Potion', desc: 'Heals 50 HP.' },
  bomb: { id: 'bomb', name: 'Bomb', desc: 'Deals damage to the opponent.' },
  elixir: { id: 'elixir', name: 'Elixir', desc: 'Fully restores mana.' },
  shield_token: { id: 'shield_token', name: 'Shield Token', desc: 'Grants +10 temporary defense for 1 turn.' },
  speed_scroll: { id: 'speed_scroll', name: 'Speed Scroll', desc: 'Next turn acts first.' },
  strength_tonic: { id: 'strength_tonic', name: 'Strength Tonic', desc: 'Temporarily increases attack for 1 turn.' },
  revive_scroll: { id: 'revive_scroll', name: 'Revive Scroll', desc: 'Revives with 30% HP once.' }
  ,
  jps: { id: 'jps', name: 'JPS Token', desc: 'A mysterious token — appears in inventory for testing.' }
};

window.getItemCatalog = () => ITEM_CATALOG;

