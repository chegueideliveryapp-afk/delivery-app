import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let mapa = null;
let markers = {};

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Ainda sem atualização";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function statusTexto(status) {
  if (status === "aceito") return "Em andamento";
  if (status === "entregue") return "Entregue";
  return status || "Não informado";
}

async function validarRestaurante(user) {
  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists()) {
    await signOut(auth);
    window.location.href = "./login.html";
    return false;
  }

  const perfil = userSnap.data();

  if (
    perfil.role !== "restaurante" ||
    perfil.ativo !== true ||
    perfil.bloqueado === true
  ) {
    await signOut(auth);
    window.location.href = "./login.html";
    return false;
  }

  return true;
}

function iniciarMapa() {
  if (mapa) return;

  mapa = L.map("mapaRastreamento").setView([-22.376, -46.942], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(mapa);
}

function limparMarkers() {
  Object.values(markers).forEach((marker) => {
    mapa.removeLayer(marker);
  });

  markers = {};
}

function renderizarLista(rastreamentos) {
  if (!rastreamentos.length) {
    setHtml(
      "listaRastreamento",
      `<div class="empty-mini">Nenhuma corrida com rastreamento no momento.</div>`
    );
    return;
  }

  setHtml(
    "listaRastreamento",
    rastreamentos.map((r) => {
      return `
        <div class="tracking-item">
          <strong>${r.motoboyNome || "Motoboy"}</strong>
          <p>Pedido: ${r.pedidoId}</p>
          <p>Entrega: ${r.enderecoEntrega || "Endereço não informado"}</p>
          <p>Última atualização: ${dataTexto(r.ultimaAtualizacaoAt)}</p>

          <span class="tracking-status ${r.status || "aceito"}">
            ${statusTexto(r.status)}
          </span>
        </div>
      `;
    }).join("")
  );
}

function atualizarMapa(rastreamentos) {
  limparMarkers();

  const bounds = [];

  rastreamentos.forEach((r) => {
    const lat = Number(r.location?.lat);
    const lng = Number(r.location?.lng);

    if (!lat || !lng) return;

    const marker = L.marker([lat, lng])
      .addTo(mapa)
      .bindPopup(`
        <strong>${r.motoboyNome || "Motoboy"}</strong><br>
        Status: ${statusTexto(r.status)}<br>
        Atualizado: ${dataTexto(r.ultimaAtualizacaoAt)}
      `);

    markers[r.pedidoId] = marker;
    bounds.push([lat, lng]);
  });

  if (bounds.length) {
    mapa.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 16
    });
  }
}

export function carregarRastreamentoRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    const valido = await validarRestaurante(user);

    if (!valido) return;

    iniciarMapa();

    const q = query(
      collection(db, "rastreamento_pedidos"),
      where("restauranteId", "==", user.uid)
    );

    onSnapshot(
      q,
      (snapshot) => {
        const rastreamentos = [];

        snapshot.forEach((docSnap) => {
          rastreamentos.push({
            id: docSnap.id,
            ...docSnap.data()
          });
        });

        rastreamentos.sort((a, b) => {
          const dataA = a.ultimaAtualizacaoAt?.toMillis?.() || 0;
          const dataB = b.ultimaAtualizacaoAt?.toMillis?.() || 0;
          return dataB - dataA;
        });

        setText("totalRastreamento", `${rastreamentos.length} corrida(s)`);

        renderizarLista(rastreamentos);
        atualizarMapa(rastreamentos);
      },
      (erro) => {
        console.error(erro);

        setText("totalRastreamento", "Erro");

        setHtml(
          "listaRastreamento",
          `<div class="empty-mini">Erro ao carregar rastreamento. Confira as regras do Firestore.</div>`
        );
      }
    );
  });
}
