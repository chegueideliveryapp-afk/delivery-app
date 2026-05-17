import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function mostrarMensagem(texto) {
  const msg = document.getElementById("mensagem");
  if (msg) msg.innerText = texto;
}

export async function loginRestaurante() {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  const btn = document.getElementById("btnLogin");

  mostrarMensagem("");

  if (!email || !senha) {
    mostrarMensagem("Preencha e-mail e senha.");
    return;
  }

  btn.disabled = true;
  btn.innerText = "Entrando...";

  try {
    const credencial = await signInWithEmailAndPassword(auth, email, senha);
    const uid = credencial.user.uid;

    const userSnap = await getDoc(doc(db, "users", uid));

    if (!userSnap.exists()) {
      await signOut(auth);
      mostrarMensagem("Usuário sem perfil.");
      return;
    }

    const perfil = userSnap.data();

    if (perfil.role !== "restaurante") {
      await signOut(auth);
      mostrarMensagem("Este usuário não é um restaurante.");
      return;
    }

    if (perfil.ativo !== true) {
      await signOut(auth);
      mostrarMensagem("Conta inativa.");
      return;
    }

    if (perfil.bloqueado === true) {
      await signOut(auth);
      mostrarMensagem("Conta bloqueada.");
      return;
    }

    window.location.href = "./dashboard.html";
  } catch (erro) {
    console.error(erro);
    mostrarMensagem("E-mail ou senha inválidos.");
  }

  btn.disabled = false;
  btn.innerText = "Acessar painel";
}

export function protegerRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    const userSnap = await getDoc(doc(db, "users", user.uid));

    if (!userSnap.exists() || userSnap.data().role !== "restaurante") {
      await signOut(auth);
      window.location.href = "./login.html";
    }
  });
}

export function carregarDashboardRestaurante() {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;

    const restauranteRef = doc(db, "restaurantes", user.uid);

    onSnapshot(restauranteRef, (snap) => {
      if (!snap.exists()) {
        signOut(auth);
        window.location.href = "./login.html";
        return;
      }

      const r = snap.data();

      setText("nomeRestaurante", r.nome || "Restaurante");
      setText("saldoPrePago", dinheiro(r.saldoPrePago));

      const lat = r.location?.lat ?? "---";
      const lng = r.location?.lng ?? "---";
      setText("localizacaoRestaurante", `${lat}, ${lng}`);

      if (r.bloqueado) {
        setText("statusConta", "Bloqueado");
        setText("statusDescricao", "Entre em contato com a administração.");
        return;
      }

      if (r.ativo === false) {
        setText("statusConta", "Inativo");
        setText("statusDescricao", "Sua conta está inativa no momento.");
        return;
      }

      setText("statusConta", "Ativo");
      setText("statusDescricao", "Você já pode solicitar entregas com saldo disponível.");
    });
  });
}

export async function sairRestaurante() {
  await signOut(auth);
  window.location.href = "./login.html";
}
