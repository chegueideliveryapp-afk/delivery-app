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

const estado = {
  pedidos: [],
  rastreamentos: []
};

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

function obterCorridasEmAndamento() {
  const pedidosAceitos = estado.pedidos.filter((pedido) => {
    return pedido.status === "aceito";
  });

  return pedidosAceitos
    .map((pedido) => {
      const rastreamento = estado.rastreamentos.find((r) => {
        return r.pedidoId === pedido.id;
      });

      if (!rastreamento) return null;

      return {
        ...rastreamento,
        pedidoStatusReal: pedido.status,
        pedidoId: pedido.id,
        motoboyNome: pedido.motoboyNome || rastreamento.motoboyNome || "Motoboy",
        restauranteNome: pedido.restauranteNome || rastreamento.restauranteNome || "",
        enderecoEntrega: pedido.enderecoEntrega || rastreamento.enderecoEntrega || "",
        aceitoAt: pedido.aceitoAt || null
      };
    })
    .filter(Boolean);
}

function renderizarLista(corridas) {
  if (!corridas.length) {
    setHtml(
      "listaRastreamento",
      `<div class="empty-mini">Nenhuma corrida em andamento no momento.</div>`
    );
    return;
  }

  setHtml(
    "listaRastreamento",
    corridas.map((r) => {
      return `
        <div class="tracking-item">
          <strong>${r.motoboyNome || "Motoboy"}</strong>
          <p>Pedido: ${r.pedidoId}</p>
          <p>Entrega: ${r.enderecoEntrega || "Endereço não informado"}</p>
          <p>Aceito em: ${dataTexto(r.aceitoAt)}</p>
          <p>Última atualização: ${dataTexto(r.ultimaAtualizacaoAt)}</p>

          <span class="tracking-status aceito">
            ${statusTexto(r.pedidoStatusReal)}
          </span>
        </div>
      `;
    }).join("")
  );
}

function atualizarMapa(corridas) {
  limparMarkers();

  const bounds = [];

  corridas.forEach((r) => {
    const lat = Number(r.location?.lat);
    const lng = Number(r.location?.lng);

    if (!lat || !lng) return;

    const marker = L.marker([lat, lng])
      .addTo(mapa)
      .bindPopup(`
        <strong>${r.motoboyNome || "Motoboy"}</strong><br>
        Status: Em andamento<br>
        Pedido: ${r.pedidoId}<br>
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

function renderizarTela() {
  const corridas = obterCorridasEmAndamento();

  setText("totalRastreamento", `${corridas.length} corrida(s)`);

  renderizarLista(corridas);
  atualizarMapa(corridas);
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

    const pedidosQuery = query(
      collection(db, "pedidos"),
      where("restauranteId", "==", user.uid)
    );

    const rastreamentoQuery = query(
      collection(db, "rastreamento_pedidos"),
      where("restauranteId", "==", user.uid)
    );

    onSnapshot(
      pedidosQuery,
      (snapshot) => {
        estado.pedidos = [];

        snapshot.forEach((docSnap) => {
          estado.pedidos.push({
            id: docSnap.id,
            ...docSnap.data()
          });
        });

        renderizarTela();
      },
      (erro) => {
        console.error(erro);

        setText("totalRastreamento", "Erro");

        setHtml(
          "listaRastreamento",
          `<div class="empty-mini">Erro ao carregar pedidos da corrida.</div>`
        );
      }
    );

    onSnapshot(
      rastreamentoQuery,
      (snapshot) => {
        estado.rastreamentos = [];

        snapshot.forEach((docSnap) => {
          estado.rastreamentos.push({
            id: docSnap.id,
            ...docSnap.data()
          });
        });

        renderizarTela();
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
