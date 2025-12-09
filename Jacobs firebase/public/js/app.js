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
  signOut,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

// setup connection listener
const connectedRef = ref(db, ".info/connected");
onValue(connectedRef, (snap) => {
  console.log("connected:", snap.val());
});

let uid;
let queueRef;
let detachMatchListener = null;
let detachProfileListener = null;

// Ensure login/signup handlers are loaded anywhere app.js runs
import("./login.js").catch((err) => {
  console.error("[app] failed to load login module", err);
});

onAuthStateChanged(auth, async (user) => {
  // Use the more robust sign-in UI logic (nav links, signout button, presence) while
  // preserving the existing game logic in this file.
  const userDisplay = document.getElementById("user") || document.getElementById("user-display");
  const battleElement = document.getElementById("battle");
  const queueBtnEl = document.getElementById("queueBtn") || document.querySelector('.queueBtn');
  const signOutBtn = document.getElementById("signOutBtn");
  const navAuthLinks = document.querySelectorAll('.nav-auth-link');
  const navProtectedLinks = document.querySelectorAll('.nav-protected-link');

  // detach any existing listeners when auth state changes
  if (detachMatchListener) {
    try { detachMatchListener(); } catch (e) { /* ignore */ }
    detachMatchListener = null;
  }
  if (detachProfileListener) {
    try { detachProfileListener(); } catch (e) { /* ignore */ }
    detachProfileListener = null;
  }

  if (user) {
    uid = user.uid;
    // write a minimal profile if missing
    try { await writeUserData(user.uid, user.displayName || user.email); } catch (e) { console.error('writeUserData failed', e); }

    // show/hide nav links and signout
    if (userDisplay) userDisplay.textContent = `Signed in as ${user.displayName || user.email}`;
    if (signOutBtn) signOutBtn.style.display = 'inline-flex';
    navAuthLinks.forEach((link) => (link.style.display = 'none'));
    navProtectedLinks.forEach((link) => (link.style.display = ''));

    // listen for profile updates
    const userProfileRef = ref(db, `users/${uid}`);
    detachProfileListener = onValue(userProfileRef, (snap) => {
      const data = snap.val() || {};
      const name = data.displayName || user.displayName || user.email;
      const classLabel = data.class ? ` (${capitalize(data.class)})` : "";
      if (userDisplay) userDisplay.textContent = `Signed in as ${name}${classLabel}`;
    });

    // ensure presence/queue behavior
    queueRef = ref(db, `queue/${uid}`);
    onDisconnect(queueRef).remove();
    if (queueBtnEl) queueBtnEl.style.display = 'inline';
    document.querySelectorAll('.not-logged-in-vis').forEach((el) => (el.style.display = 'none'));

    // apply any pending signup profile info stored transiently
    try {
      const pendingDisplayName = (typeof localStorage !== 'undefined') ? localStorage.getItem('pendingDisplayName') : null;
      const pendingClass = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
      const updates = {};
      if (pendingDisplayName) updates.displayName = pendingDisplayName;
      // Persist under selectedClass to match server-side expectations
      if (pendingClass) updates.selectedClass = pendingClass;
      if (Object.keys(updates).length > 0) {
        await update(ref(db, `users/${uid}`), updates);
        try { localStorage.removeItem('pendingDisplayName'); } catch (e) {}
      }
    } catch (e) {
      console.error('Error applying pending signup profile to DB', e);
    }

    // seed starter items if necessary
    try { await seedStarterItemsIfMissing(uid); } catch (e) { console.error('Error seeding starter items for user', e); }

    // match listener
    const matchRef = ref(db, `users/${uid}/currentMatch`);
    detachMatchListener = onValue(matchRef, (snap) => {
      if (snap.exists()) {
        const matchId = snap.val();
        if (queueBtnEl) queueBtnEl.style.display = 'none';
        if (battleElement) battleElement.style.display = 'block';
        // hide class selector when in a match
        const cs = document.getElementById('class-select'); if (cs) cs.style.display = 'none';
        console.log('Matched! Match ID:', matchId);
        setTimeout(() => {
          if (typeof window.initializeBattle === 'function') {
            window.initializeBattle(matchId, uid);
          } else {
            console.error('initializeBattle function not found!');
          }
        }, 100);
      } else {
        if (queueBtnEl) queueBtnEl.style.display = 'inline';
        if (battleElement) battleElement.style.display = 'none';
        const cs2 = document.getElementById('class-select'); if (cs2) cs2.style.display = '';
      }
    });

  } else {
    // signed out
    if (userDisplay) userDisplay.textContent = 'Not signed in';
    if (battleElement) battleElement.style.display = 'none';
    if (signOutBtn) signOutBtn.style.display = 'none';
    navAuthLinks.forEach((link) => (link.style.display = ''));
    navProtectedLinks.forEach((link) => (link.style.display = 'none'));
    document.querySelectorAll('.not-logged-in-vis').forEach((el) => (el.style.display = ''));
  }
});

function writeUserData(userId, name) {
  // use update to avoid overwriting other fields (like selectedClass)
  update(ref(db, 'users/' + userId), {
    displayName: name,
  });
}

// Capture signup form inputs so app.js can persist them on auth state change.
// We don't perform auth here (login.js handles that); we only store transient inputs.
try {
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', (ev) => {
      try {
        const fd = new FormData(signupForm);
        const displayName = fd.get('displayName')?.toString().trim();
        const playerClass = fd.get('playerClass')?.toString();
        if (typeof localStorage !== 'undefined') {
          if (displayName) localStorage.setItem('pendingDisplayName', displayName);
          if (playerClass) localStorage.setItem('selectedClass', playerClass);
        }
      } catch (e) {
        console.error('Error capturing signup form values', e);
      }
      // allow the form to continue (login.js will handle createUserWithEmailAndPassword)
    }, false);
  }
} catch (e) {
  console.error('Signup form listener setup failed', e);
}

async function updateQueueData() {
  // write queue entry and show searching state
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

const _queueBtnEl = document.getElementById("queueBtn");
if (_queueBtnEl) {
  _queueBtnEl.addEventListener("click", (e) => { updateQueueData().catch(console.error); }, false);
} else {
  console.debug('[app] queueBtn not found on this page; skipping queue button wiring');
}

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
  // Use the same class set exposed in signup.html
  const classes = ['warrior','mage','archer','cleric','rogue','dark_mage','necromancer','paladin','druid','knight','monk','wild_magic_sorcerer'];
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
        rogue: 'Rogue — agile striker who deals burst damage and evades',
        dark_mage: 'Dark Mage — former necromantic arts focused on life-siphon and rot',
        necromancer: 'Necromancer — summoner and debuffer: skeletons, shackles, and inversion magic',
        paladin: 'Paladin — holy warrior with support and offense',
        druid: 'Druid — nature caster: heal-over-time and control',
        knight: 'Knight — heavy tank, strong defense and crowd control'
      };
      // add descriptions for newly added classes
      descMap.monk = 'Monk — quick martial artist: flurries, stuns, and powerful finishing blows.';
  descMap.wild_magic_sorcerer = 'Wild Magic Sorcerer — unpredictable caster with random d20-driven effects.';
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
  // initialize label from localStorage; default to 'warrior' if not set
  let existing = (typeof localStorage !== 'undefined') ? localStorage.getItem('selectedClass') : null;
  if (!existing) {
    try { localStorage.setItem('selectedClass', 'warrior'); existing = 'warrior'; } catch (e) { /* ignore */ }
  }
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
};

window.getItemCatalog = () => ITEM_CATALOG;

