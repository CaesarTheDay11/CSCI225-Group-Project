import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  onValue,
  ref,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

const unauthCard = document.getElementById("inventory-unauth");
const inventoryCard = document.getElementById("inventory-card");
const listEl = document.getElementById("inventory-list");
const signOutBtn = document.getElementById("signOutBtn");
const userDisplay = document.getElementById("user-display");

const ITEM_DESCRIPTIONS = {
  healing_potion: "Restore 25 HP.",
  power_elixir: "Gain +6 Attack Boost for this battle.",
  iron_skin: "Gain +12 guard.",
  swift_boots: "Gain +4 Speed.",
  focus_charm: "Gain +8% crit chance.",
};

function renderItems(items = []) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = `<p class="muted">No items yet. Win battles for a chance to earn some!</p>`;
    return;
  }
  items.forEach((item) => {
    const desc = ITEM_DESCRIPTIONS[item.id] || item.description || "";
    const card = document.createElement("div");
    card.className = "item-button";
    card.innerHTML = `<div><strong>${item.label || item.id}</strong><p>${desc}</p></div>`;
    listEl.appendChild(card);
  });
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (inventoryCard) inventoryCard.style.display = "none";
    if (unauthCard) unauthCard.style.display = "block";
    if (userDisplay) userDisplay.textContent = "Not signed in";
    if (signOutBtn) signOutBtn.style.display = "none";
    return;
  }

  if (unauthCard) unauthCard.style.display = "none";
  if (inventoryCard) inventoryCard.style.display = "block";
  if (userDisplay) userDisplay.textContent = `Signed in as ${user.displayName || user.email || "Player"}`;
  if (signOutBtn) {
    signOutBtn.style.display = "inline-flex";
    signOutBtn.onclick = async () => {
      await signOut(auth);
    };
  }

  const itemsRef = ref(db, `users/${user.uid}/items`);
  onValue(itemsRef, (snap) => {
    const val = snap.val() || {};
    const items = Object.values(val);
    renderItems(items);
  });
});
