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

let map = null;
let restauranteMarker = null;
let motoboyMarkers = {};
let unsubscribeMotoboys = {};

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

function iniciarMapa() {
  map = L.map("mapaRastreamento").setView([-22.376, -46.942], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function limparMotoboysSemPedido(pedidosAtivos) {
  const idsAtivos = pedidosAtivos.map((pedido) => pedido.id);

  Object.keys(motoboyMarkers).forEach((pedidoId) => {
    if (!idsAtivos.includes(pedidoId)) {
      map.removeLayer(motoboyMarkers[pedidoId]);
      delete motoboyMarkers[pedidoId];
    }
  });

  Object.keys(unsubscribeMotoboys).forEach((pedidoId) => {
    if (!idsAtivos.includes(pedidoId)) {
      unsubscribeMotoboys[pedidoId]();
      delete unsubscribeMotoboys[pedidoId];
    }
  });
}

function atualizarRestauranteNoMapa(restauranteLocation) {
  if (!restauranteLocation?.lat || !restauranteLocation?.lng) return;

  const pos = [
    Number(restauranteLocation.lat),
    Number(restauranteLocation.lng)
  ];

  if (!restauranteMarker) {
    restauranteMarker = L.marker(pos).addTo(map);
    restauranteMarker.bindPopup("Restaurante");
  } else {
    restauranteMarker.setLatLng(pos);
  }

  map.setView(pos, 14);
}

function pegarLatLngMotoboy(motoboy) {
  const lat = Number(
    motoboy.location?.lat ??
    motoboy.lat
  );

  const lng = Number(
    motoboy.location?.lng ??
    motoboy.lng
  );

  if (!lat || !lng) return null;

  return [lat, lng];
}

function acompanharMotoboyDoPedido(pedido) {
  if (!pedido.motoboyId) return;
  if (unsubscribeMotoboys[pedido.id]) return;

  const motoboyRef = doc(db, "motoboys", pedido.motoboyId);

  unsubscribeMotoboys[pedido.id] = onSnapshot(
    motoboyRef,
    (snap) => {
      if (!snap.exists()) return;

      const motoboy = snap.data();
      const pos = pegarLatLngMotoboy(motoboy);

      if (!pos) return;

      if (!motoboyMarkers[pedido.id]) {
        motoboyMarkers[pedido.id] = L.marker(pos).addTo(map);
      } else {
        motoboyMarkers[pedido.id].setLatLng(pos);
      }

      motoboyMarkers[pedido.id].bindPopup(`
        <strong>${motoboy.nome || pedido.motoboyNome || "Motoboy"}</strong><br>
        Pedido: ${pedido.id}<br>
        Entrega: ${pedido.enderecoEntrega || "Endereço não informado"}<br>
        Última atualização: ${dataTexto(motoboy.ultimaLocalizacaoAt)}
      `);

      const bounds = [];

      if (pedido.restauranteLocation?.lat && pedido.restauranteLocation?.lng) {
        bounds.push([
          Number(pedido.restauranteLocation.lat),
          Number(pedido.restauranteLocation.lng)
        ]);
      }

      bounds.push(pos);

      if (bounds.length > 1) {
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 16
        });
      } else {
        map.setView(pos, 15);
      }
    },
    (erro) => {
      console.error("Erro ao acompanhar motoboy:", erro);
    }
  );
}

function renderizarLista(pedidos) {
  const lista = document.getElementById("listaRastreamento");

  if (!lista) return;

  lista.innerHTML = "";

  if (pedidos.length === 0) {
    lista.innerHTML = `
      <div class="empty-mini">
        Nenhuma corrida em andamento no momento.
      </div>
    `;
    return;
  }

  pedidos.forEach((pedido) => {
    const item = document.createElement("div");
    item.className = "tracking-item";

    item.innerHTML = `
      <strong>${pedido.motoboyNome || "Motoboy aceitou a corrida"}</strong>

      <p>Pedido: ${pedido.id}</p>
      <p>Entrega: ${pedido.enderecoEntrega || "Endereço não informado"}</p>
      <p>Status: ${pedido.status || "aceito"}</p>
      <p>Aceito em: ${dataTexto(pedido.aceitoAt)}</p>

      <span class="tracking-status">Em andamento</span>
    `;

    lista.appendChild(item);
  });
}

async function validarRestaurante(user) {
  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists() || userSnap.data().role !== "restaurante") {
    await signOut(auth);
    window.location.href = "./login.html";
    return false;
  }

  return true;
}

export function iniciarRastreamentoRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    const valido = await validarRestaurante(user);

    if (!valido) return;

    iniciarMapa();

    const pedidosRef = collection(db, "pedidos");

    const q = query(
      pedidosRef,
      where("restauranteId", "==", user.uid),
      where("status", "==", "aceito")
    );

    onSnapshot(
      q,
      (snapshot) => {
        const pedidos = [];

        snapshot.forEach((docSnap) => {
          const pedido = {
            id: docSnap.id,
            ...docSnap.data()
          };

          if (pedido.motoboyId) {
            pedidos.push(pedido);
          }
        });

        setText("totalCorridas", `${pedidos.length} corrida(s)`);

        limparMotoboysSemPedido(pedidos);
        renderizarLista(pedidos);

        if (pedidos.length > 0) {
          atualizarRestauranteNoMapa(pedidos[0].restauranteLocation);
        }

        pedidos.forEach((pedido) => {
          acompanharMotoboyDoPedido(pedido);
        });
      },
      (erro) => {
        console.error("Erro ao carregar rastreamento:", erro);

        setText("totalCorridas", "Erro");

        const lista = document.getElementById("listaRastreamento");

        if (lista) {
          lista.innerHTML = `
            <div class="empty-mini">
              Erro ao carregar rastreamento. Confira permissões do Firestore.
            </div>
          `;
        }
      }
    );
  });
}
