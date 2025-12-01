import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  get,
  ref,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

const CLASS_BASE_STATS = {
  warrior: {
    maxHp: 115,
    physicalAttack: 16,
    magicAttack: 6,
    physicalDefense: 12,
    magicDefense: 8,
    speed: 9,
    critChance: 0.1,
    evasion: 0.05,
    defense: 0,
  },
  mage: {
    maxHp: 95,
    physicalAttack: 7,
    magicAttack: 18,
    physicalDefense: 7,
    magicDefense: 12,
    speed: 11,
    critChance: 0.12,
    evasion: 0.08,
    defense: 0,
  },
  archer: {
    maxHp: 105,
    physicalAttack: 15,
    magicAttack: 10,
    physicalDefense: 8,
    magicDefense: 9,
    speed: 15,
    critChance: 0.18,
    evasion: 0.12,
    defense: 0,
  },
  cleric: {
    maxHp: 110,
    physicalAttack: 11,
    magicAttack: 15,
    physicalDefense: 10,
    magicDefense: 12,
    speed: 10,
    critChance: 0.1,
    evasion: 0.08,
    defense: 0,
  },
  thief: {
    maxHp: 100,
    physicalAttack: 16,
    magicAttack: 9,
    physicalDefense: 8,
    magicDefense: 8,
    speed: 17,
    critChance: 0.2,
    evasion: 0.15,
    defense: 0,
  },
  monk: {
    maxHp: 108,
    physicalAttack: 14,
    magicAttack: 12,
    physicalDefense: 10,
    magicDefense: 10,
    speed: 13,
    critChance: 0.12,
    evasion: 0.1,
    defense: 0,
  },
};

const nameEl = document.getElementById("profile-name");
const emailEl = document.getElementById("profile-email");
const classPill = document.getElementById("profile-class-pill");
const winsEl = document.getElementById("profile-wins");
const lossesEl = document.getElementById("profile-losses");
const ratioEl = document.getElementById("profile-ratio");
const unauthCard = document.getElementById("profile-unauth");
const profileCard = document.getElementById("profile-card");

const statIds = {
  maxHp: document.getElementById("stat-maxhp"),
  physicalAttack: document.getElementById("stat-phys-atk"),
  magicAttack: document.getElementById("stat-mag-atk"),
  physicalDefense: document.getElementById("stat-phys-def"),
  magicDefense: document.getElementById("stat-mag-def"),
  defense: document.getElementById("stat-guard"),
  speed: document.getElementById("stat-speed"),
  critChance: document.getElementById("stat-crit"),
  evasion: document.getElementById("stat-evasion"),
};

function formatPercent(value = 0) {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function formatClassLabel(classKey = "warrior") {
  if (!classKey) return "Adventurer";
  return classKey.charAt(0).toUpperCase() + classKey.slice(1);
}

function renderStats(classKey = "warrior") {
  const stats = CLASS_BASE_STATS[classKey] || CLASS_BASE_STATS.warrior;
  if (statIds.maxHp) statIds.maxHp.textContent = stats.maxHp;
  if (statIds.physicalAttack) statIds.physicalAttack.textContent = stats.physicalAttack;
  if (statIds.magicAttack) statIds.magicAttack.textContent = stats.magicAttack;
  if (statIds.physicalDefense) statIds.physicalDefense.textContent = stats.physicalDefense;
  if (statIds.magicDefense) statIds.magicDefense.textContent = stats.magicDefense;
  if (statIds.defense) statIds.defense.textContent = stats.defense;
  if (statIds.speed) statIds.speed.textContent = stats.speed;
  if (statIds.critChance) statIds.critChance.textContent = formatPercent(stats.critChance);
  if (statIds.evasion) statIds.evasion.textContent = formatPercent(stats.evasion);
}

function renderRecord(wins = 0, losses = 0) {
  const totalLosses = typeof losses === "number" && losses >= 0 ? losses : 0;
  const totalWins = typeof wins === "number" && wins >= 0 ? wins : 0;
  const totalGames = totalWins + totalLosses;
  const ratio = totalGames === 0 ? 0 : totalWins / totalGames;
  if (winsEl) winsEl.textContent = totalWins;
  if (lossesEl) lossesEl.textContent = totalLosses;
  if (ratioEl) ratioEl.textContent = ratio.toFixed(2);
}

async function loadProfile(user) {
  const userRef = ref(db, `users/${user.uid}`);
  const snap = await get(userRef);
  const data = snap.val() || {};

  const classKey = data.class || "warrior";
  if (classPill) classPill.textContent = formatClassLabel(classKey);
  if (nameEl) nameEl.textContent = data.displayName || user.displayName || user.email || "Player";
  if (emailEl) emailEl.textContent = user.email || "";

  renderStats(classKey);
  renderRecord(data.wins || 0, data.losses || 0);

  if (unauthCard) unauthCard.style.display = "none";
  if (profileCard) profileCard.style.display = "block";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (profileCard) profileCard.style.display = "none";
    if (unauthCard) unauthCard.style.display = "block";
    return;
  }
  loadProfile(user).catch((err) => {
    console.error("Failed to load profile", err);
  });
});
