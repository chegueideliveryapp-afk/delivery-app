import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function limparNumero(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function cpfParaEmail(cpf) {
  return `${limparNumero(cpf)}@app.com`;
}

function mostrarMensagem(texto, tipo = "erro") {
  const msg = document.getElementById("mensagem");
  if (!msg) return;

  msg.className = tipo;
  msg.innerText = texto;
}

function irParaDashboard() {
  window.location.href = "./dashboard.html";
}

async function verificarMotoboyLogado(user) {
  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists()) {
    await signOut(auth);
    mostrarMensagem("Usuário sem perfil no sistema.");
    return;
  }

  const perfil = userSnap.data();

  if (perfil.role !== "motoboy") {
    await signOut(auth);
    mostrarMensagem("Este login não pertence a um motoboy.");
    return;
  }

  if (perfil.ativo !== true) {
    await signOut(auth);
    mostrarMensagem("Usuário inativo.");
    return;
  }

  if (perfil.bloqueado === true) {
    await signOut(auth);
    mostrarMensagem("Usuário bloqueado.");
    return;
  }

  irParaDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  const btnLogin = document.getElementById("btnLogin");

  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      const cpf = limparNumero(document.getElementById("cpfLogin").value);
      const senha = document.getElementById("senhaLogin").value;

      if (cpf.length !== 11) {
        mostrarMensagem("CPF inválido.");
        return;
      }

      if (!senha) {
        mostrarMensagem("Digite sua senha.");
        return;
      }

      btnLogin.disabled = true;
      btnLogin.innerText = "Entrando...";

      try {
        const email = cpfParaEmail(cpf);
        const credencial = await signInWithEmailAndPassword(auth, email, senha);

        await verificarMotoboyLogado(credencial.user);
      } catch (erro) {
        console.error(erro);
        mostrarMensagem("CPF ou senha inválidos.");
      }

      btnLogin.disabled = false;
      btnLogin.innerText = "Entrar";
    });
  }

  const tabLogin = document.getElementById("tabLogin");
  const tabCadastro = document.getElementById("tabCadastro");
  const loginBox = document.getElementById("loginBox");
  const cadastroBox = document.getElementById("cadastroBox");

  if (tabLogin && tabCadastro) {
    tabLogin.addEventListener("click", () => {
      tabLogin.classList.add("active");
      tabCadastro.classList.remove("active");
      loginBox.classList.remove("hidden");
      cadastroBox.classList.add("hidden");
      mostrarMensagem("");
    });

    tabCadastro.addEventListener("click", () => {
      tabCadastro.classList.add("active");
      tabLogin.classList.remove("active");
      cadastroBox.classList.remove("hidden");
      loginBox.classList.add("hidden");
      mostrarMensagem("");
    });
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  if (location.pathname.endsWith("index.html") || location.pathname.endsWith("/")) {
    await verificarMotoboyLogado(user);
  }
});
