import { db } from "./firebase.js";

import {
  collection,
  onSnapshot,
  query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let map = null;

let motoboys = [];
let restaurantes = [];
let pedidos = [];

let layers = {
  online: L.layerGroup(),
  offline: L.layerGroup(),
  pendentes: L.layerGroup(),
  corridas: L.layerGroup(),
  restaurantes: L.layerGroup()
};

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Data não informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function normalizarNumero(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function obterLatLng(obj) {
  const lat = normalizarNumero(
    obj?.location?.lat ??
    obj?.restauranteLocation?.lat ??
    obj?.lat
  );

  const lng = normalizarNumero(
    obj?.location?.lng ??
    obj?.restauranteLocation?.lng ??
    obj?.lng
  );

  if (lat === null || lng === null) return null;
  if (lat === 0 && lng === 0) return null;

  return [lat, lng];
}

function deslocarPosicao(pos, tipo) {
  const [lat, lng] = pos;

  const offsets = {
    online: [0.00005, 0.00005],
    offline: [-0.00005, -0.00005],
    corrida: [0.00008, -0.00008],
    pendente: [-0.00008, 0.00008],
    restaurante: [0, 0]
  };

  const offset = offsets[tipo] || [0, 0];

  return [
    lat + offset[0],
    lng + offset[1]
  ];
}

function criarIcone(tipo, texto) {
  return L.divIcon({
    html: `<div class="admin-map-marker ${tipo}">${texto}</div>`,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16]
  });
}

function iniciarMapaBase() {
  map = L.map("mapaAdmin").setView([-22.376, -46.942], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  Object.values(layers).forEach((layer) => {
    layer.addTo(map);
  });
}

function limparLayers() {
  Object.values(layers).forEach((layer) => {
    layer.clearLayers();
  });
}

function pedidoEstaEmAndamento(pedido) {
  return pedido.status === "aceito" && pedido.motoboyId;
}

function pedidoEstaPendente(pedido) {
  return (
    pedido.status === "pendente" ||
    pedido.status === "buscando_motoboy" ||
    pedido.status === "sem_motoboy"
  );
}

function motoboyTemCorrida(motoboyId) {
  return pedidos.some((pedido) => {
    return pedido.status === "aceito" && pedido.motoboyId === motoboyId;
  });
}

function renderizarRestaurantes(bounds) {
  restaurantes.forEach((restaurante) => {
    const pos = obterLatLng(restaurante);
    if (!pos) return;

    const marker = L.marker(
      deslocarPosicao(pos, "restaurante"),
      {
        icon: criarIcone("restaurante", "R")
      }
    );

    marker.bindPopup(`
      <div class="map-popup">
        <strong>${restaurante.nome || "Restaurante"}</strong>
        <p>Telefone: ${restaurante.telefone || "Não informado"}</p>
        <p>Endereço: ${restaurante.endereco || "Não informado"}</p>
        <p>Saldo: ${dinheiro(restaurante.saldoPrePago)}</p>
        <span class="popup-badge">Restaurante</span>
      </div>
    `);

    marker.addTo(layers.restaurantes);
    bounds.push(pos);
  });
}

function renderizarMotoboys(bounds) {
  motoboys.forEach((motoboy) => {
    const pos = obterLatLng(motoboy);
    if (!pos) return;

    const online = motoboy.online === true;
    const emCorrida = motoboyTemCorrida(motoboy.id);

    const tipo = online ? "online" : "offline";
    const layer = online ? layers.online : layers.offline;

    const marker = L.marker(
      deslocarPosicao(pos, tipo),
      {
        icon: criarIcone(tipo, "M")
      }
    );

    marker.bindPopup(`
      <div class="map-popup">
        <strong>${motoboy.nome || "Motoboy"}</strong>
        <p>Telefone: ${motoboy.telefone || "Não informado"}</p>
        <p>Status: ${online ? "Online" : "Offline"}</p>
        <p>Corrida atual: ${emCorrida ? "Sim" : "Não"}</p>
        <p>Saldo: ${dinheiro(motoboy.saldo)}</p>
        <p>Última localização: ${dataTexto(motoboy.ultimaLocalizacaoAt)}</p>
        <span class="popup-badge">${online ? "Motoboy online" : "Motoboy offline"}</span>
      </div>
    `);

    marker.addTo(layer);
    bounds.push(pos);
  });
}

function renderizarPedidosPendentes(bounds) {
  pedidos
    .filter(pedidoEstaPendente)
    .forEach((pedido) => {
      const pos = obterLatLng(pedido);
      if (!pos) return;

      const marker = L.marker(
        deslocarPosicao(pos, "pendente"),
        {
          icon: criarIcone("pendente", "P")
        }
      );

      marker.bindPopup(`
        <div class="map-popup">
          <strong>Pedido pendente</strong>
          <p>Restaurante: ${pedido.restauranteNome || "Não informado"}</p>
          <p>Entrega: ${pedido.enderecoEntrega || "Não informado"}</p>
          <p>Status: ${pedido.status || "pendente"}</p>
          <p>Raio atual: ${pedido.raioAtualKm || 0} km</p>
          <p>Motoboy: Ainda não aceito</p>
          <p>Total: ${dinheiro(pedido.valorTotal)}</p>
          <span class="popup-badge">Pedido pendente</span>
        </div>
      `);

      marker.addTo(layers.pendentes);
      bounds.push(pos);
    });
}

function buscarMotoboyPorId(id) {
  return motoboys.find((motoboy) => motoboy.id === id) || null;
}

function renderizarCorridasAndamento(bounds) {
  pedidos
    .filter(pedidoEstaEmAndamento)
    .forEach((pedido) => {
      const motoboy = buscarMotoboyPorId(pedido.motoboyId);

      const posMotoboy = obterLatLng(motoboy);
      const posPedido = obterLatLng(pedido);

      const pos = posMotoboy || posPedido;
      if (!pos) return;

      const marker = L.marker(
        deslocarPosicao(pos, "corrida"),
        {
          icon: criarIcone("corrida", "C")
        }
      );

      marker.bindPopup(`
        <div class="map-popup">
          <strong>Corrida em andamento</strong>
          <p>Restaurante: ${pedido.restauranteNome || "Não informado"}</p>
          <p>Motoboy: ${motoboy?.nome || pedido.motoboyNome || "Não informado"}</p>
          <p>Telefone motoboy: ${motoboy?.telefone || "Não informado"}</p>
          <p>Entrega: ${pedido.enderecoEntrega || "Não informado"}</p>
          <p>Status: ${pedido.status || "aceito"}</p>
          <p>Aceito em: ${dataTexto(pedido.aceitoAt)}</p>
          <p>Última localização: ${dataTexto(motoboy?.ultimaLocalizacaoAt)}</p>
          <span class="popup-badge">Corrida em andamento</span>
        </div>
      `);

      marker.addTo(layers.corridas);
      bounds.push(pos);
    });
}

function atualizarResumo() {
  const totalOnline = motoboys.filter((m) => m.online === true).length;
  const totalPendentes = pedidos.filter(pedidoEstaPendente).length;
  const totalCorridas = pedidos.filter(pedidoEstaEmAndamento).length;

  setText("totalMotoboysOnline", totalOnline);
  setText("totalPedidosPendentes", totalPendentes);
  setText("totalCorridasAndamento", totalCorridas);
  setText("totalRestaurantes", restaurantes.length);
}

function renderizarMapa() {
  if (!map) return;

  limparLayers();
  atualizarResumo();

  const bounds = [];

  renderizarRestaurantes(bounds);
  renderizarMotoboys(bounds);
  renderizarPedidosPendentes(bounds);
  renderizarCorridasAndamento(bounds);

  if (bounds.length > 0) {
    map.fitBounds(bounds, {
      padding: [50, 50],
      maxZoom: 15
    });
  }
}

function configurarFiltros() {
  const filtros = [
    {
      id: "filtroOnline",
      layer: layers.online
    },
    {
      id: "filtroOffline",
      layer: layers.offline
    },
    {
      id: "filtroPendentes",
      layer: layers.pendentes
    },
    {
      id: "filtroCorridas",
      layer: layers.corridas
    },
    {
      id: "filtroRestaurantes",
      layer: layers.restaurantes
    }
  ];

  filtros.forEach((filtro) => {
    const el = document.getElementById(filtro.id);
    if (!el) return;

    el.addEventListener("change", () => {
      if (el.checked) {
        filtro.layer.addTo(map);
      } else {
        map.removeLayer(filtro.layer);
      }
    });
  });
}

function escutarMotoboys() {
  onSnapshot(query(collection(db, "motoboys")), (snapshot) => {
    motoboys = [];

    snapshot.forEach((docSnap) => {
      motoboys.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarMapa();
  });
}

function escutarRestaurantes() {
  onSnapshot(query(collection(db, "restaurantes")), (snapshot) => {
    restaurantes = [];

    snapshot.forEach((docSnap) => {
      restaurantes.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarMapa();
  });
}

function escutarPedidos() {
  onSnapshot(query(collection(db, "pedidos")), (snapshot) => {
    pedidos = [];

    snapshot.forEach((docSnap) => {
      const pedido = {
        id: docSnap.id,
        ...docSnap.data()
      };

      if (pedido.status !== "entregue" && pedido.status !== "cancelado") {
        pedidos.push(pedido);
      }
    });

    renderizarMapa();
  });
}

export function iniciarMapaAdmin() {
  iniciarMapaBase();
  configurarFiltros();

  escutarMotoboys();
  escutarRestaurantes();
  escutarPedidos();
}
