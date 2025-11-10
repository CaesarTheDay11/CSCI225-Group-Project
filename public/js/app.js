import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js'

import {
	getDatabase,
	connectDatabaseEmulator,
	ref, set,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"

import {
	getAuth,
	GoogleAuthProvider,
	signInWithPopup,
	onAuthStateChanged,
	connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

const firebaseConfig = {
	apiKey: "AIzaSyCAZCdpLSNAHhJMbX6XO7kM6OGEq1Wlp_g",
	authDomain: "arena-battlegrounds-2724e.firebaseapp.com",
	projectId: "arena-battlegrounds-2724e",
	storageBucket: "arena-battlegrounds-2724e.firebasestorage.app",
	messagingSenderId: "772072071103",
	appId: "1:772072071103:web:0ecb0d98cdbe1d39708b0a",
	measurementId: "G-G1Q86QFQBP",
	databaseURL: "https://arena-battlegrounds-2724e-default-rtdb.firebaseio.com/"
};

// Initialize Firebase and services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

connectAuthEmulator(auth, "http://127.0.0.1:9199");
connectDatabaseEmulator(db, "127.0.0.1", 9009);


// auth setup
const provider = new GoogleAuthProvider();

document.getElementById("googleBtn").onclick = async () => {
	try {
		await signInWithPopup(auth, provider);
	} catch (e) {
		console.error(e);
	}
};

onAuthStateChanged(auth, (user) => {
	if (user) {
		document.getElementById("user").textContent =
			`Signed in as ${user.displayName || user.email}`;
		writeUserData(user.userId, user.displayName)
	} else {
		document.getElementById("user").textContent = "Not signed in";
	}
});


function writeUserData(userId, name) {
	set(ref(db, 'users/' + userId), {
		name: name,
	});
}

