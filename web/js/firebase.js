import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCH17jg8aN5tUrICaoILOh6OEd88dVBLXI",
  authDomain: "cheguei-delivery-c5cc2.firebaseapp.com",
  projectId: "cheguei-delivery-c5cc2",
  storageBucket: "cheguei-delivery-c5cc2.firebasestorage.app",
  messagingSenderId: "115065576878",
  appId: "1:115065576878:web:e3de14a86375dfb03cbc3f"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export { app };
