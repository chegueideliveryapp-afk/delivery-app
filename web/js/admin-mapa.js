import { db } from "./firebase.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let mapa = null;
let camadas = {
  motoboys: [],
  pedidos: [],
  corridas: [],
  restaurantes: []
};

const estado = {
  motoboys: [],
  pedidos: [],
  rastreamentos: [],
  restaurantes: []
};

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Data não informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function iniciarMapa() {
  if (mapa) return;

  mapa = L.map("mapaAdminOperacional").setView([-22.376, -46.942], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(mapa);
}

function criarIcone(cor, texto) {
  return L.divIcon({
    html: `
      <div style="
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: ${cor};
        color: white;
        display: grid;
        place-items: center;
        font-weight: 900;
        border: 3px solid white;
        box-shadow: 0 8px 18px rgba(0,0,0,.25);
      ">
        ${texto}
      </div>
    `,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

const icones = {
  motoboy: criarIcone("#16a34a", "M"),
  pedido: criarIcone("#f59e0b", "P"),
  corrida: criarIcone("#2563eb", "R"),
  restaurante: criarIcone("#ea1d2c", "L")
};

function limparCamadas() {
  Object.values(camadas).forEach((lista) => {
    lista.forEach((marker) => {
      mapa.removeLayer(marker);
    });
  });

  camadas = {
    motoboys: [],
    pedidos: [],
    corridas: [],
    restaurantes: []
  };
}

function popup(html) {
  return `<div class="popup-map">${html}</div>`;
}

function renderizarMotoboys(bounds) {
  const online = estado.motoboys.filter((m) => {
    const lat = Number(m.location?.lat);
    const lng = Number(m.location?.lng);

    return m.online === true && lat && lng;
  });

  setText("totalMotoboysOnlineMapa", online.length);

  online.forEach((m) => {
    const lat = Number(m.location.lat);
    const lng = Number(m.location.lng);

    const marker = L.marker([lat, lng], { icon: icones.motoboy })
      .addTo(mapa)
      .bindPopup(
        popup(`
          <strong>${m.nome || "Motoboy"}</strong>
          <p>Status: Online</p>
          <p>Telefone: ${m.telefone || "Não informado"}</p>
          <p>Saldo: ${dinheiro(m.saldo)}</p>
          <p>Última localização: ${dataTexto(m.ultimaLocalizacaoAt)}</p>
        `)
      );

    camadas.motoboys.push(marker);
    bounds.push([lat, lng]);
  });
}

function renderizarPedidosPendentes(bounds) {
  const pendentes = estado.pedidos.filter((p) => p.status === "pendente");

  setText("totalPedidosPendentesMapa", pendentes.length);

  pendentes.forEach((p) => {
    const lat = Number(p.restauranteLocation?.lat);
    const lng = Number(p.restauranteLocation?.lng);

    if (!lat || !lng) return;

    const marker = L.marker([lat, lng], { icon: icones.pedido })
      .addTo(mapa)
      .bindPopup(
        popup(`
          <strong>Pedido pendente</strong>
          <p>Restaurante: ${p.restauranteNome || "Não informado"}</p>
          <p>Entrega: ${p.enderecoEntrega || "Não informado"}</p>
          <p>Valor motoboy: ${dinheiro(p.valorMotoboy)}</p>
          <p>Raio atual: ${p.raioAtualKm || 3} km</p>
          <p>Criado em: ${dataTexto(p.createdAt)}</p>
        `)
      );

    camadas.pedidos.push(marker);
    bounds.push([lat, lng]);
  });
}

function renderizarCorridas(bounds) {
  const corridas = estado.rastreamentos.filter((r) => r.status === "aceito");

  setText("totalCorridasMapa", corridas.length);

  corridas.forEach((r) => {
    const lat = Number(r.location?.lat);
    const lng = Number(r.location?.lng);

    if (!lat || !lng) return;

    const marker = L.marker([lat, lng], { icon: icones.corrida })
      .addTo(mapa)
      .bindPopup(
        popup(`
          <strong>${r.motoboyNome || "Motoboy em rota"}</strong>
          <p>Status: Corrida em andamento</p>
          <p>Restaurante: ${r.restauranteNome || "Não informado"}</p>
          <p>Entrega: ${r.enderecoEntrega || "Não informado"}</p>
          <p>Atualizado em: ${dataTexto(r.ultimaAtualizacaoAt)}</p>
        `)
      );

    camadas.corridas.push(marker);
    bounds.push([lat, lng]);
  });
}

function renderizarRestaurantes(bounds) {
  const restaurantesValidos = estado.restaurantes.filter((r) => {
    const lat = Number(r.location?.lat);
    const lng = Number(r.location?.lng);

    return lat && lng;
  });

  setText("totalRestaurantesMapa", restaurantesValidos.length);

  restaurantesValidos.forEach((r) => {
    const lat = Number(r.location.lat);
    const lng = Number(r.location.lng);

    const marker = L.marker([lat, lng], { icon: icones.restaurante })
      .addTo(mapa)
      .bindPopup(
        popup(`
          <strong>${r.nome || "Restaurante"}</strong>
          <p>Status: ${r.ativo === false ? "Inativo" : "Ativo"}</p>
          <p>Bloqueado: ${r.bloqueado ? "Sim" : "Não"}</p>
          <p>Saldo: ${dinheiro(r.saldoPrePago)}</p>
          <p>Telefone: ${r.telefone || "Não informado"}</p>
        `)
      );

    camadas.restaurantes.push(marker);
    bounds.push([lat, lng]);
  });
}

function renderizarMapa() {
  if (!mapa) return;

  limparCamadas();

  const bounds = [];

  renderizarRestaurantes(bounds);
  renderizarPedidosPendentes(bounds);
  renderizarMotoboys(bounds);
  renderizarCorridas(bounds);

  if (bounds.length) {
    mapa.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 15
    });
  }
}

function escutarColecao(nomeColecao, chaveEstado) {
  onSnapshot(
    collection(db, nomeColecao),
    (snapshot) => {
      estado[chaveEstado] = [];

      snapshot.forEach((docSnap) => {
        estado[chaveEstado].push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarMapa();
    },
    (erro) => {
      console.error(`Erro ao carregar ${nomeColecao}:`, erro);
    }
  );
}

export function carregarMapaAdmin() {
  iniciarMapa();

  escutarColecao("motoboys", "motoboys");
  escutarColecao("pedidos", "pedidos");
  escutarColecao("rastreamento_pedidos", "rastreamentos");
  escutarColecao("restaurantes", "restaurantes");
}
