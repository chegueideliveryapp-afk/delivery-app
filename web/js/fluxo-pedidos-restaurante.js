import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let restauranteId = null;

let configApp = {
  raiosBuscaKm: [3, 5, 10, 15],
  tempoPorRaioSegundos: 15
};

let pedidosMonitorados = [];
let intervaloFluxo = null;
let iniciado = false;

function normalizarRaios(valor) {
  if (Array.isArray(valor) && valor.length) {
    return valor
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
  }

  if (typeof valor === "string") {
    const raios = valor
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0);

    if (raios.length) return raios;
  }

  return [3, 5, 10, 15];
}

function millis(timestamp) {
  if (timestamp?.toMillis) {
    return timestamp.toMillis();
  }

  return Date.now();
}

function precisaAtualizar(pedido, novosDados) {
  if (novosDados.status && pedido.status !== novosDados.status) {
    return true;
  }

  if (
    novosDados.raioAtualKm !== undefined &&
    Number(pedido.raioAtualKm || 0) !== Number(novosDados.raioAtualKm || 0)
  ) {
    return true;
  }

  if (
    novosDados.tentativaBusca !== undefined &&
    Number(pedido.tentativaBusca || 0) !== Number(novosDados.tentativaBusca || 0)
  ) {
    return true;
  }

  return false;
}

async function carregarConfig() {
  try {
    const snap = await getDoc(doc(db, "config", "app"));

    if (snap.exists()) {
      configApp = {
        ...configApp,
        ...snap.data()
      };
    }
  } catch (erro) {
    console.error("Erro ao carregar config/app:", erro);
  }
}

async function processarPedido(item) {
  const pedido = item.pedido;

  if (!restauranteId) return;
  if (pedido.restauranteId !== restauranteId) return;
  if (pedido.status !== "pendente") return;
  if (pedido.motoboyId) return;

  const raios = normalizarRaios(pedido.raiosBuscaKm || configApp.raiosBuscaKm);
  const tempoPorRaioSegundos = Number(
    pedido.tempoPorRaioSegundos ||
    configApp.tempoPorRaioSegundos ||
    15
  );

  const criadoEm = millis(pedido.createdAt);
  const agora = Date.now();
  const segundos = Math.max(0, Math.floor((agora - criadoEm) / 1000));
  const indice = Math.floor(segundos / tempoPorRaioSegundos);

  const pedidoRef = doc(db, "pedidos", item.id);

  if (indice >= raios.length) {
    const dadosSemMotoboy = {
      status: "sem_motoboy",
      semMotoboyAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    if (pedido.status !== "sem_motoboy") {
      await updateDoc(pedidoRef, dadosSemMotoboy);
    }

    return;
  }

  const raioAtual = Number(raios[indice]);

  const dadosAtualizacao = {
    status: "pendente",
    raioAtualKm: raioAtual,
    tentativaBusca: indice,
    ultimaExpansaoAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (precisaAtualizar(pedido, dadosAtualizacao)) {
    await updateDoc(pedidoRef, dadosAtualizacao);
  }
}

async function processarFluxo() {
  if (!pedidosMonitorados.length) return;

  for (const item of pedidosMonitorados) {
    try {
      await processarPedido(item);
    } catch (erro) {
      console.error("Erro ao avançar raio do pedido:", item.id, erro);
    }
  }
}

function escutarPedidos() {
  const q = query(
    collection(db, "pedidos"),
    where("restauranteId", "==", restauranteId)
  );

  onSnapshot(
    q,
    (snapshot) => {
      pedidosMonitorados = [];

      snapshot.forEach((docSnap) => {
        const pedido = docSnap.data();

        if (
          pedido.status === "pendente" &&
          !pedido.motoboyId
        ) {
          pedidosMonitorados.push({
            id: docSnap.id,
            pedido
          });
        }
      });

      processarFluxo();
    },
    (erro) => {
      console.error("Erro ao escutar pedidos do restaurante:", erro);
    }
  );
}

export function iniciarFluxoPedidosRestaurante() {
  if (iniciado) return;

  iniciado = true;

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    restauranteId = user.uid;

    await carregarConfig();

    escutarPedidos();

    if (intervaloFluxo) {
      clearInterval(intervaloFluxo);
    }

    intervaloFluxo = setInterval(() => {
      processarFluxo();
    }, 5000);
  });
}
