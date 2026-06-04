import { db } from "./firebase.js";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  updateDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let configApp = null;
let timersPedidos = new Map();

function numero(valor, padrao = 0) {
  const n = Number(valor ?? padrao);
  return Number.isFinite(n) ? n : padrao;
}

function limparTimer(pedidoId) {
  const timer = timersPedidos.get(pedidoId);

  if (timer) {
    clearTimeout(timer);
    timersPedidos.delete(pedidoId);
  }
}

function limparTimersQueNaoExistem(idsAtuais) {
  timersPedidos.forEach((timer, pedidoId) => {
    if (!idsAtuais.has(pedidoId)) {
      clearTimeout(timer);
      timersPedidos.delete(pedidoId);
    }
  });
}

function calcularProximoPasso(pedido) {
  const raiosBuscaKm = Array.isArray(pedido.raiosBuscaKm) && pedido.raiosBuscaKm.length
    ? pedido.raiosBuscaKm.map(Number)
    : configApp?.raiosBuscaKm || [3, 5, 10, 15];

  const tentativaAtual = numero(pedido.tentativaBusca, 0);
  const proximaTentativa = tentativaAtual + 1;

  if (proximaTentativa >= raiosBuscaKm.length) {
    return {
      finalizarSemMotoboy: true,
      proximaTentativa,
      proximoRaio: raiosBuscaKm[raiosBuscaKm.length - 1] || 15
    };
  }

  return {
    finalizarSemMotoboy: false,
    proximaTentativa,
    proximoRaio: raiosBuscaKm[proximaTentativa]
  };
}

async function avancarRaioOuFinalizar(pedidoId) {
  try {
    const pedidoRef = doc(db, "pedidos", pedidoId);
    const snap = await getDoc(pedidoRef);

    if (!snap.exists()) {
      limparTimer(pedidoId);
      return;
    }

    const pedido = snap.data();

    if (pedido.status !== "pendente") {
      limparTimer(pedidoId);
      return;
    }

    const passo = calcularProximoPasso(pedido);

    if (passo.finalizarSemMotoboy) {
      await updateDoc(pedidoRef, {
        status: "sem_motoboy",
        tentativaBusca: passo.proximaTentativa,
        raioAtualKm: passo.proximoRaio,
        semMotoboyAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      limparTimer(pedidoId);
      return;
    }

    await updateDoc(pedidoRef, {
      tentativaBusca: passo.proximaTentativa,
      raioAtualKm: passo.proximoRaio,
      updatedAt: serverTimestamp()
    });

    limparTimer(pedidoId);
  } catch (erro) {
    console.error("Erro ao avançar raio do pedido:", pedidoId, erro);
    limparTimer(pedidoId);
  }
}

function agendarPedido(pedidoId, pedido) {
  if (!configApp) return;
  if (pedido.status !== "pendente") return;
  if (timersPedidos.has(pedidoId)) return;

  const tempoPorRaioSegundos = numero(configApp.tempoPorRaioSegundos, 15);
  const tempoMs = Math.max(tempoPorRaioSegundos, 5) * 1000;

  const timer = setTimeout(() => {
    avancarRaioOuFinalizar(pedidoId);
  }, tempoMs);

  timersPedidos.set(pedidoId, timer);
}

function carregarConfigDistribuicao() {
  const configRef = doc(db, "config", "app");

  onSnapshot(configRef, (snap) => {
    if (!snap.exists()) {
      configApp = {
        raiosBuscaKm: [3, 5, 10, 15],
        tempoPorRaioSegundos: 15
      };

      return;
    }

    const dados = snap.data();

    configApp = {
      ...dados,
      raiosBuscaKm: Array.isArray(dados.raiosBuscaKm)
        ? dados.raiosBuscaKm.map(Number)
        : [3, 5, 10, 15],
      tempoPorRaioSegundos: numero(dados.tempoPorRaioSegundos, 15)
    };
  });
}

function iniciarDistribuicaoPedidos() {
  carregarConfigDistribuicao();

  const q = query(
    collection(db, "pedidos"),
    where("status", "==", "pendente")
  );

  onSnapshot(
    q,
    (snapshot) => {
      const idsAtuais = new Set();

      snapshot.forEach((docSnap) => {
        const pedidoId = docSnap.id;
        const pedido = docSnap.data();

        idsAtuais.add(pedidoId);
        agendarPedido(pedidoId, pedido);
      });

      limparTimersQueNaoExistem(idsAtuais);
    },
    (erro) => {
      console.error("Erro ao escutar pedidos pendentes:", erro);
    }
  );
}

iniciarDistribuicaoPedidos();
