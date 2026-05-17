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

let mapaMotoboys = null;
let marcadoresMotoboys = {};

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

function limparTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function linkWhatsapp(telefone, nome) {
  const numeroLimpo = limparTelefone(telefone);

  if (!numeroLimpo) return "";

  const numero = numeroLimpo.startsWith("55")
    ? numeroLimpo
    : `55${numeroLimpo}`;

  const texto = encodeURIComponent(
    `Olá, ${nome || "motoboy"}. Aqui é da Cheguei Delivery.`
  );

  return `https://wa.me/${numero}?text=${texto}`;
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
    "taxaSistemaPadrao"
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

      const lat = r.location?.lat ?? "";
      const lng = r.location?.lng ?? "";

      const card = document.createElement("div");
      card.className = "list-card";

      card.innerHTML = `
        <div>
          <strong>${r.nome || "Sem nome"}</strong>
          <p>${r.endereco || "Endereço não informado"}</p>
          <p>Telefone: ${r.telefone || "Não informado"}</p>
          <p>E-mail: ${r.email || "Não informado"}</p>
          <p>Localização fixa: ${lat}, ${lng}</p>
          <p>Saldo: ${dinheiro(r.saldoPrePago)}</p>
          <p>Taxa sistema: ${dinheiro(r.taxaSistemaPadrao)}</p>
          <p>Status: ${r.ativo ? "Ativo" : "Inativo"} | ${r.bloqueado ? "Bloqueado" : "Liberado"}</p>
        </div>

        <div class="actions">
          <button data-action="toggleAtivoRestaurante" data-id="${id}" data-value="${r.ativo ? "false" : "true"}">
            ${r.ativo ? "Inativar" : "Ativar"}
          </button>

          <button data-action="toggleBloqueadoRestaurante" data-id="${id}" data-value="${r.bloqueado ? "false" : "true"}">
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

        if (action === "toggleAtivoRestaurante") {
          await updateDoc(doc(db, "restaurantes", id), {
            ativo: value,
            updatedAt: serverTimestamp()
          });

          await updateDoc(doc(db, "users", id), {
            ativo: value,
            updatedAt: serverTimestamp()
          });
        }

        if (action === "toggleBloqueadoRestaurante") {
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

function iniciarMapaMotoboysAdmin() {
  const el = document.getElementById("mapaMotoboys");

  if (!el || mapaMotoboys) return;

  mapaMotoboys = L.map("mapaMotoboys").setView([-22.376, -46.942], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(mapaMotoboys);
}

function criarIconeMotoboy(online, bloqueado, aprovado) {
  const cor = bloqueado
    ? "#dc2626"
    : online
      ? "#16a34a"
      : aprovado
        ? "#6b7280"
        : "#f59e0b";

  return L.divIcon({
    html: `
      <div style="
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: ${cor};
        border: 3px solid white;
        box-shadow: 0 4px 14px rgba(0,0,0,.3);
        display: grid;
        place-items: center;
        color: white;
        font-size: 14px;
        font-weight: bold;
      ">M</div>
    `,
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function textoStatusMotoboy(m) {
  const partes = [];

  partes.push(m.online ? "Online" : "Offline");
  partes.push(m.aprovado ? "Aprovado" : "Pendente");

  if (m.bloqueado) partes.push("Bloqueado");
  if (m.ativo === false) partes.push("Inativo");

  return partes.join(" | ");
}

function badgeClasse(condicao, verdadeiro = "green", falso = "gray") {
  return condicao ? verdadeiro : falso;
}

function montarPopupMotoboy(m) {
  const whatsapp = linkWhatsapp(m.telefone, m.nome);

  return `
    <div class="map-popup">
      <strong>${m.nome || "Motoboy sem nome"}</strong>
      <p>Telefone: ${m.telefone || "Não informado"}</p>
      <p>CPF: ${m.cpf || "Não informado"}</p>
      <p>Status: ${textoStatusMotoboy(m)}</p>
      <p>Saldo: ${dinheiro(m.saldo)}</p>
      <p>Entregas: ${m.totalEntregas || 0}</p>
      <p>Recusas: ${m.totalRecusas || 0}</p>
      ${whatsapp ? `<a class="whatsapp-link" href="${whatsapp}" target="_blank">Chamar no WhatsApp</a>` : ""}
    </div>
  `;
}

function montarCardMotoboy(id, m) {
  const lat = m.location?.lat ?? "";
  const lng = m.location?.lng ?? "";

  const aprovado = m.aprovado === true;
  const ativo = m.ativo !== false;
  const bloqueado = m.bloqueado === true;
  const online = m.online === true;
  const statusCadastro = m.statusCadastro || "pendente";
  const whatsapp = linkWhatsapp(m.telefone, m.nome);

  const card = document.createElement("div");
  card.className = "list-card";

  card.innerHTML = `
    <div>
      <strong>${m.nome || "Sem nome"}</strong>

      <div class="status-row">
        <span class="badge ${badgeClasse(online)}">${online ? "Online" : "Offline"}</span>
        <span class="badge ${badgeClasse(aprovado, "green", "yellow")}">${aprovado ? "Aprovado" : "Pendente"}</span>
        <span class="badge ${badgeClasse(ativo)}">${ativo ? "Ativo" : "Inativo"}</span>
        <span class="badge ${badgeClasse(!bloqueado, "green", "red")}">${bloqueado ? "Bloqueado" : "Liberado"}</span>
      </div>

      <p>CPF: ${m.cpf || "Não informado"}</p>
      <p>Telefone: ${m.telefone || "Não informado"}</p>
      <p>Nascimento: ${m.nascimento || "Não informado"}</p>
      <p>Status cadastro: ${statusCadastro}</p>
      <p>Saldo: ${dinheiro(m.saldo)}</p>
      <p>Entregas: ${m.totalEntregas || 0} | Recusas: ${m.totalRecusas || 0}</p>
      <p>Localização atual: ${lat || "sem lat"}, ${lng || "sem lng"}</p>
      ${whatsapp ? `<a class="whatsapp-link" href="${whatsapp}" target="_blank">Chamar no WhatsApp</a>` : ""}
    </div>

    <div class="actions">
      ${aprovado ? "" : `
        <button data-action="aprovarMotoboy" data-id="${id}">
          Aprovar
        </button>
      `}

      <button data-action="toggleAtivoMotoboy" data-id="${id}" data-value="${ativo ? "false" : "true"}">
        ${ativo ? "Inativar" : "Ativar"}
      </button>

      <button data-action="toggleBloqueadoMotoboy" data-id="${id}" data-value="${bloqueado ? "false" : "true"}">
        ${bloqueado ? "Desbloquear" : "Bloquear"}
      </button>
    </div>
  `;

  return card;
}

export function carregarMotoboys() {
  const lista = document.getElementById("listaMotoboys");

  if (!lista) return;

  iniciarMapaMotoboysAdmin();

  const q = query(collection(db, "motoboys"), orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    lista.innerHTML = "";

    if (mapaMotoboys) {
      Object.values(marcadoresMotoboys).forEach((marker) => {
        mapaMotoboys.removeLayer(marker);
      });
    }

    marcadoresMotoboys = {};

    const bounds = [];
    let totalComLocalizacao = 0;

    if (snapshot.empty) {
      lista.innerHTML = `<div class="empty">Nenhum motoboy cadastrado ainda.</div>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const m = docSnap.data();
      const id = docSnap.id;

      lista.appendChild(montarCardMotoboy(id, m));

      const lat = Number(m.location?.lat);
      const lng = Number(m.location?.lng);

      if (!lat || !lng || !mapaMotoboys) return;

      totalComLocalizacao++;

      const pos = [lat, lng];
      bounds.push(pos);

      const marker = L.marker(pos, {
        icon: criarIconeMotoboy(
          m.online === true,
          m.bloqueado === true,
          m.aprovado === true
        )
      })
        .addTo(mapaMotoboys)
        .bindPopup(montarPopupMotoboy(m));

      marcadoresMotoboys[id] = marker;
    });

    if (totalComLocalizacao > 0 && mapaMotoboys) {
      mapaMotoboys.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 15
      });
    }

    lista.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.id;
        const action = button.dataset.action;
        const value = button.dataset.value === "true";

        if (action === "aprovarMotoboy") {
          await updateDoc(doc(db, "motoboys", id), {
            aprovado: true,
            statusCadastro: "aprovado",
            ativo: true,
            bloqueado: false,
            updatedAt: serverTimestamp()
          });

          await updateDoc(doc(db, "users", id), {
            ativo: true,
            bloqueado: false,
            updatedAt: serverTimestamp()
          });
        }

        if (action === "toggleAtivoMotoboy") {
          await updateDoc(doc(db, "motoboys", id), {
            ativo: value,
            online: false,
            updatedAt: serverTimestamp()
          });

          await updateDoc(doc(db, "users", id), {
            ativo: value,
            updatedAt: serverTimestamp()
          });
        }

        if (action === "toggleBloqueadoMotoboy") {
          await updateDoc(doc(db, "motoboys", id), {
            bloqueado: value,
            online: false,
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
