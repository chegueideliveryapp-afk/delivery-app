import { db, firebaseConfig } from "./firebase.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const secondaryApp = initializeApp(firebaseConfig, "adminCreateUserApp");
const secondaryAuth = getAuth(secondaryApp);

function valorInput(id) {
  return document.getElementById(id)?.value.trim() || "";
}

function numeroInput(id, padrao = 0) {
  const valor = Number(document.getElementById(id)?.value || padrao);
  return Number.isFinite(valor) ? valor : padrao;
}

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function limparFormularioRestaurante() {
  [
    "nome",
    "responsavel",
    "telefone",
    "email",
    "senha",
    "endereco",
    "lat",
    "lng",
    "saldoPrePago",
    "taxaSistemaPadrao",
    "valorMotoboyPadrao"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

export async function cadastrarRestaurante() {
  const msg = document.getElementById("mensagem");
  const btn = document.getElementById("btnSalvar");

  const nome = valorInput("nome");
  const responsavel = valorInput("responsavel");
  const telefone = valorInput("telefone");
  const email = valorInput("email");
  const senha = document.getElementById("senha")?.value || "";
  const endereco = valorInput("endereco");

  const lat = numeroInput("lat", 0);
  const lng = numeroInput("lng", 0);
  const saldoPrePago = numeroInput("saldoPrePago", 0);
  const taxaSistemaPadrao = numeroInput("taxaSistemaPadrao", 5);
  const valorMotoboyPadrao = numeroInput("valorMotoboyPadrao", 10);

  msg.innerText = "";

  if (!nome) {
    msg.innerText = "Informe o nome do restaurante.";
    return;
  }

  if (!telefone) {
    msg.innerText = "Informe o telefone.";
    return;
  }

  if (!email) {
    msg.innerText = "Informe o e-mail de login.";
    return;
  }

  if (!senha || senha.length < 6) {
    msg.innerText = "Informe uma senha com pelo menos 6 caracteres.";
    return;
  }

  if (!lat || !lng) {
    msg.innerText = "Informe latitude e longitude fixas do restaurante.";
    return;
  }

  btn.disabled = true;
  btn.innerText = "Criando login e cadastro...";

  try {
    const credencial = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      senha
    );

    const uid = credencial.user.uid;

    await setDoc(doc(db, "users", uid), {
      nome,
      email,
      role: "restaurante",
      ativo: true,
      bloqueado: false,
      refId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await setDoc(doc(db, "restaurantes", uid), {
      nome,
      responsavel,
      telefone,
      email,
      endereco,

      location: {
        lat,
        lng
      },

      saldoPrePago,
      ativo: true,
      bloqueado: false,

      taxaSistemaPadrao,
      valorMotoboyPadrao,

      totalPedidos: 0,
      totalGasto: 0,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await signOut(secondaryAuth);

    msg.innerText = "Restaurante cadastrado com login criado.";
    limparFormularioRestaurante();
  } catch (erro) {
    console.error(erro);

    if (erro.code === "auth/email-already-in-use") {
      msg.innerText = "Este e-mail já está cadastrado.";
    } else if (erro.code === "auth/invalid-email") {
      msg.innerText = "E-mail inválido.";
    } else if (erro.code === "auth/weak-password") {
      msg.innerText = "Senha fraca. Use pelo menos 6 caracteres.";
    } else {
      msg.innerText = "Erro ao cadastrar restaurante.";
    }
  }

  btn.disabled = false;
  btn.innerText = "Cadastrar restaurante";
}

export function carregarRestaurantes() {
  const lista = document.getElementById("listaRestaurantes");

  if (!lista) return;

  const q = query(collection(db, "restaurantes"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    lista.innerHTML = "";

    if (snapshot.empty) {
      lista.innerHTML = `<div class="empty">Nenhum restaurante cadastrado.</div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const r = docSnap.data();
      const id = docSnap.id;

      const card = document.createElement("div");
      card.className = "list-card";

      const lat = r.location?.lat ?? "";
      const lng = r.location?.lng ?? "";

      card.innerHTML = `
        <div>
          <strong>${r.nome || "Sem nome"}</strong>
          <p>${r.endereco || "Endereço não informado"}</p>
          <p>Telefone: ${r.telefone || "Não informado"}</p>
          <p>E-mail: ${r.email || "Não informado"}</p>
          <p>Localização fixa: ${lat}, ${lng}</p>
          <p>Saldo: ${dinheiro(r.saldoPrePago)}</p>
          <p>Taxa sistema: ${dinheiro(r.taxaSistemaPadrao)}</p>
          <p>Valor motoboy: ${dinheiro(r.valorMotoboyPadrao)}</p>
          <p>Status: ${r.ativo ? "Ativo" : "Inativo"} | ${r.bloqueado ? "Bloqueado" : "Liberado"}</p>
        </div>

        <div class="actions">
          <button data-action="toggleAtivo" data-id="${id}" data-value="${r.ativo ? "false" : "true"}">
            ${r.ativo ? "Inativar" : "Ativar"}
          </button>

          <button data-action="toggleBloqueado" data-id="${id}" data-value="${r.bloqueado ? "false" : "true"}">
            ${r.bloqueado ? "Desbloquear" : "Bloquear"}
          </button>
        </div>
      `;

      lista.appendChild(card);
    });

    lista.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.id;
        const action = button.dataset.action;
        const value = button.dataset.value === "true";

        if (action === "toggleAtivo") {
          await updateDoc(doc(db, "restaurantes", id), {
            ativo: value,
            updatedAt: serverTimestamp()
          });

          await updateDoc(doc(db, "users", id), {
            ativo: value,
            updatedAt: serverTimestamp()
          });
        }

        if (action === "toggleBloqueado") {
          await updateDoc(doc(db, "restaurantes", id), {
            bloqueado: value,
            updatedAt: serverTimestamp()
          });

          await updateDoc(doc(db, "users", id), {
            bloqueado: value,
            updatedAt: serverTimestamp()
          });
        }
      });
    });
  });
}
