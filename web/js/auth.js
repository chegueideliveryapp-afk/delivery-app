import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function loginComEmailSenha(email, senha) {
  const credencial = await signInWithEmailAndPassword(auth, email, senha);
  const uid = credencial.user.uid;

  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists()) {
    await signOut(auth);
    throw new Error("Usuário sem perfil no sistema.");
  }

  const perfil = userSnap.data();

  if (perfil.ativo !== true) {
    await signOut(auth);
    throw new Error("Usuário inativo.");
  }

  if (perfil.bloqueado === true) {
    await signOut(auth);
    throw new Error("Usuário bloqueado.");
  }

  return {
    uid,
    ...perfil
  };
}

export async function logout() {
  await signOut(auth);
}

export function protegerPagina(rolePermitida) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    const snap = await getDoc(doc(db, "users", user.uid));

    if (!snap.exists()) {
      await signOut(auth);
      window.location.href = "./login.html";
      return;
    }

    const perfil = snap.data();

    if (
      perfil.role !== rolePermitida ||
      perfil.ativo !== true ||
      perfil.bloqueado === true
    ) {
      await signOut(auth);
      window.location.href = "./login.html";
    }
  });
}
