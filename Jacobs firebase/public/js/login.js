import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  ref,
  get,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

import { auth, db } from "./firebase.js";

// Status / form elements (may be absent on some pages)
const statusEl = document.getElementById("auth-status");
const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");

const validClasses = ["warrior", "mage", "archer", "cleric", "knight", "rogue", "paladin", "dark_mage", "necromancer", "druid", "monk", "wild_magic_sorcerer"];

function setStatus(message, type = "info") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.type = type;
}

async function saveUserProfile(user, playerClass) {
  if (!user) return;
  const profile = {
    displayName: user.displayName || user.email,
  };
  // Persist selected class under the 'selectedClass' key so server functions and seeding
  // read a consistent field name (older code used 'class' inconsistently).
  if (playerClass) {
    profile.selectedClass = playerClass;
    profile.class = playerClass; // keep legacy 'class' for compatibility with older code
  }
  const userRef = ref(db, `users/${user.uid}`);
  const snap = await get(userRef);

  // No longer persist a 'mode' field; the app uses separate pages for PvE/PvP.

  if (!snap.exists()) {
    await set(userRef, profile);
  } else {
    // Preserve existing fields but ensure mode is present/updated from client if available
    const updates = Object.assign({}, profile);
    await update(userRef, updates);
  }
}

// Note: Google sign-in removed. This module provides email/password signup & signin only.

// Signup form (email/password)
if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(signupForm);
    const displayName = formData.get("displayName")?.toString().trim();
    const email = formData.get("email")?.toString().trim();
    const password = formData.get("password")?.toString();
    const playerClass = formData.get("playerClass")?.toString();

    if (!validClasses.includes(playerClass)) {
      setStatus("Pick a class to enter the arena.", "error");
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }
      await saveUserProfile(credential.user, playerClass);
  setStatus("Account created. You're ready to battle!", "success");
      signupForm.reset();
  // After signup, redirect players to the Title Screen
  window.location.href = "TitleScreen.html";
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Signup failed', "error");
    }
  });
}

// Login form (email/password)
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const email = formData.get("email")?.toString().trim();
    const password = formData.get("password")?.toString();

    if (!email || !password) {
      setStatus("Enter your email and password.", "error");
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await saveUserProfile(credential.user);
  setStatus("Signed in. Queue up when you're ready.", "success");
      loginForm.reset();
  // After sign-in, redirect players to the Title Screen
  window.location.href = "TitleScreen.html";
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Sign in failed', "error");
    }
  });
}
