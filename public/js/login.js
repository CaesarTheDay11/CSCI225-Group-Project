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

const statusEl = document.getElementById("auth-status");
const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");

const validClasses = ["warrior", "mage", "archer", "cleric", "thief", "monk"];

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
  if (playerClass) {
    profile.class = playerClass;
  }
  const userRef = ref(db, `users/${user.uid}`);
  const snap = await get(userRef);

  // Write a full record on first sight so the DB always has the user
  if (!snap.exists()) {
    await set(userRef, profile);
  } else {
    await update(userRef, profile);
  }
}

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
      window.location.href = "battle.html";
    } catch (err) {
      console.error(err);
      setStatus(err.message, "error");
    }
  });
}

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
      window.location.href = "battle.html";
    } catch (err) {
      console.error(err);
      setStatus(err.message, "error");
    }
  });
}
