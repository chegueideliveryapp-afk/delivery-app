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
  runTransaction,
  serverTimestamp,
  arrayUnion,
  increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let uid = null;
let motoboyAtual = null;
let pedidosMap = new Map();
let pedidosCache = [];
let renderInterval = null;

let configApp = {
  raiosBuscaKm: [3, 5, 10, 15],
  raioKm: 15,
  tempoPorRaioSegundos: 15
};

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function atualizarCachePedidos() {
  pedidosCache = Array.from(pedidosMap.values());

  pedidosCache.sort((a, b) => {
    const dataA = a.pedido.createdAt?.toMillis?.() || 0;
    const dataB = b.pedido.createdAt?.toMillis?.() || 0;
    return dataB - dataA;
  });

  renderizarPedidos();
}

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

function maiorRaioPedido(pedido) {
  const raios = normalizarRaios(pedido.raiosBuscaKm || configApp.raiosBuscaKm);
  const maior = Math.max(...raios);

  return Number.isFinite(maior) && maior > 0
    ? maior
    : Number(configApp.raioKm || 15);
}

function raioAtualTexto(pedido) {
  const raio = Number(pedido.raioAtualKm || 0);

  if (raio > 0) return raio;

  const raios = normalizarRaios(pedido.raiosBuscaKm || configApp.raiosBuscaKm);
  return raios[0] || 3;
}

function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function temGpsMotoboy() {
  return Boolean(
    motoboyAtual?.location?.lat &&
    motoboyAtual?.location?.lng
  );
}

function gpsAtual() {
  if (!temGpsMotoboy()) {
    return null;
  }

  return {
    lat: Number(motoboyAtual.location.lat),
    lng: Number(motoboyAtual.location.lng)
  };
}

function podeReceberPedido() {
  return (
    motoboyAtual &&
    motoboyAtual.online === true &&
    motoboyAtual.aprovado === true &&
    motoboyAtual.ativo !== false &&
    motoboyAtual.bloqueado !== true &&
    temGpsMotoboy()
  );
}

function localizacaoPedido(pedido) {
  const origem =
    pedido.restauranteLocation ||
    pedido.locationRestaurante ||
    pedido.location ||
    null;

  if (!origem?.lat || !origem?.lng) {
    return null;
  }

  return {
    lat: Number(origem.lat),
    lng: Number(origem.lng)
  };
}

function distanciaAteRestaurante(pedido) {
  if (!temGpsMotoboy()) return null;

  const origem = localizacaoPedido(pedido);
  if (!origem) return null;

  const gps = gpsAtual();

  return distanciaKm(gps.lat, gps.lng, origem.lat, origem.lng);
}

function pagamentoTexto(forma) {
  if (forma === "cartao") return "Cartão";
  if (forma === "dinheiro") return "Dinheiro";
  return "Pix";
}

function textoRetorno(pedido) {
  return pedido.precisaRetorno ? "Sim" : "Não";
}

function statusTexto(status) {
  if (status === "pendente") return "Pendente";
  if (status === "aceito") return "Aceito";
  if (status === "entregue") return "Entregue";
  if (status === "sem_motoboy") return "Sem motoboy";
  return status || "Sem status";
}

function pedidoEstaDentroDoRaioMaximo(pedido) {
  const distancia = distanciaAteRestaurante(pedido);

  if (distancia === null) return false;

  const raioMaximo = maiorRaioPedido(pedido);

  return distancia <= raioMaximo;
}

function renderPedidoDisponivel(id, pedido) {
  const distanciaRestaurante = distanciaAteRestaurante(pedido);
  const distanciaEntrega = Number(pedido.distanciaKm || 0);
  const raioAtual = raioAtualTexto(pedido);
  const raioMaximo = maiorRaioPedido(pedido);

  return `
    <div class="delivery-card">
      <div class="delivery-card-head">
        <div>
          <span>Nova corrida</span>
          <strong>${pedido.restauranteNome || "Restaurante"}</strong>
        </div>
        <b>${dinheiro(pedido.valorMotoboy)}</b>
      </div>

      <p><b>Entrega:</b> ${pedido.enderecoEntrega || "Endereço não informado"}</p>
      <p><b>Distância até restaurante:</b> ${distanciaRestaurante !== null ? distanciaRestaurante.toFixed(2) + " km" : "---"}</p>
      <p><b>Distância da entrega:</b> ${distanciaEntrega ? distanciaEntrega.toFixed(2) + " km" : "---"}</p>
      <p><b>Raio atual:</b> ${raioAtual} km</p>
      <p><b>Raio máximo:</b> ${raioMaximo} km</p>
      <p><b>Pagamento:</b> ${pagamentoTexto(pedido.formaPagamento)}</p>
      <p><b>Retorno:</b> ${textoRetorno(pedido)}</p>

      ${
        pedido.valorTroco
          ? `<p><b>Troco:</b> ${dinheiro(pedido.valorTroco)}</p>`
          : ""
      }

      ${
        pedido.observacao
          ? `<p><b>Observação:</b> ${pedido.observacao}</p>`
          : ""
      }

      <div class="delivery-actions">
        <button type="button" class="accept-btn" data-action="aceitar" data-id="${id}">
          Aceitar
        </button>

        <button type="button" class="decline-btn" data-action="recusar" data-id="${id}">
          Recusar
        </button>
      </div>
    </div>
  `;
}

function renderCorridaAtual(id, pedido) {
  const distanciaRestaurante = distanciaAteRestaurante(pedido);

  return `
    <div class="delivery-card current-delivery">
      <div class="delivery-card-head">
        <div>
          <span>Corrida em andamento</span>
          <strong>${pedido.restauranteNome || "Restaurante"}</strong>
        </div>
        <b>${dinheiro(pedido.valorMotoboy)}</b>
      </div>

      <p><b>Entrega:</b> ${pedido.enderecoEntrega || "Endereço não informado"}</p>
      <p><b>Status:</b> ${statusTexto(pedido.status)}</p>
      <p><b>Pagamento:</b> ${pagamentoTexto(pedido.formaPagamento)}</p>
      <p><b>Retorno:</b> ${textoRetorno(pedido)}</p>

      ${
        distanciaRestaurante !== null
          ? `<p><b>Distância até restaurante:</b> ${distanciaRestaurante.toFixed(2)} km</p>`
          : ""
      }

      ${
        pedido.valorTroco
          ? `<p><b>Troco:</b> ${dinheiro(pedido.valorTroco)}</p>`
          : ""
      }

      ${
        pedido.observacao
          ? `<p><b>Observação:</b> ${pedido.observacao}</p>`
          : ""
      }

      <div class="delivery-actions">
        <button type="button" class="finish-btn compact-btn" data-action="finalizar" data-id="${id}">
          Finalizar entrega
        </button>
      </div>
    </div>
  `;
}

function renderizarPedidos() {
  if (!uid || !motoboyAtual) return;

  const corridaAtual = pedidosCache.find((item) => {
    return (
      item.pedido.motoboyId === uid &&
      item.pedido.status === "aceito"
    );
  });

  if (corridaAtual) {
    setHtml("corridaAtualMotoboy", renderCorridaAtual(corridaAtual.id, corridaAtual.pedido));
  } else {
    setHtml("corridaAtualMotoboy", `
      <div class="empty-state">
        Nenhuma corrida em andamento.
      </div>
    `);
  }

  if (!podeReceberPedido()) {
    setHtml("listaPedidosMotoboy", `
      <div class="empty-state">
        Fique online, com GPS ativo e conta aprovada para receber corridas.
      </div>
    `);
    return;
  }

  if (corridaAtual) {
    setHtml("listaPedidosMotoboy", `
      <div class="empty-state">
        Você já possui uma corrida em andamento.
      </div>
    `);
    return;
  }

  const disponiveis = pedidosCache.filter((item) => {
    const pedido = item.pedido;
    const recusados = pedido.recusadoPor || [];

    return (
      pedido.status === "pendente" &&
      !pedido.motoboyId &&
      !recusados.includes(uid) &&
      pedidoEstaDentroDoRaioMaximo(pedido)
    );
  });

  if (!disponiveis.length) {
    const pendentes = pedidosCache.filter((item) => item.pedido.status === "pendente");
    const totalPendentes = pendentes.length;

    setHtml("listaPedidosMotoboy", `
      <div class="empty-state">
        Nenhuma corrida próxima no momento.<br>
        ${totalPendentes ? `${totalPendentes} pedido(s) pendente(s), mas fora do raio máximo permitido.` : ""}
      </div>
    `);
    return;
  }

  const html = disponiveis
    .map((item) => renderPedidoDisponivel(item.id, item.pedido))
    .join("");

  setHtml("listaPedidosMotoboy", html);
  configurarBotoesPedidos();
}

function configurarBotoesPedidos() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const pedidoId = button.dataset.id;

      button.disabled = true;

      try {
        if (action === "aceitar") {
          await aceitarPedido(pedidoId);
        }

        if (action === "recusar") {
          await recusarPedido(pedidoId);
        }

        if (action === "finalizar") {
          await finalizarEntrega(pedidoId);
        }
      } catch (erro) {
        console.error(erro);
        alert(erro.message || "Erro ao processar ação.");
      }

      button.disabled = false;
    });
  });
}

async function aceitarPedido(pedidoId) {
  const pedidoRef = doc(db, "pedidos", pedidoId);
  const motoboyRef = doc(db, "motoboys", uid);

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);
    const motoboySnap = await transaction.get(motoboyRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido não encontrado.");
    }

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy não encontrado.");
    }

    const pedido = pedidoSnap.data();
    const motoboy = motoboySnap.data();

    if (pedido.status !== "pendente" || pedido.motoboyId) {
      throw new Error("Essa corrida já foi aceita.");
    }

    if ((pedido.recusadoPor || []).includes(uid)) {
      throw new Error("Você já recusou essa corrida.");
    }

    if (motoboy.online !== true || motoboy.aprovado !== true || motoboy.bloqueado === true) {
      throw new Error("Você não está liberado para aceitar corridas.");
    }

    transaction.update(pedidoRef, {
      status: "aceito",
      motoboyId: uid,
      motoboyNome: motoboy.nome || "",
      aceitoAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}

async function recusarPedido(pedidoId) {
  const pedidoRef = doc(db, "pedidos", pedidoId);
  const motoboyRef = doc(db, "motoboys", uid);

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido não encontrado.");
    }

    const pedido = pedidoSnap.data();

    if (pedido.status !== "pendente") {
      throw new Error("Esse pedido não está mais pendente.");
    }

    transaction.update(pedidoRef, {
      recusadoPor: arrayUnion(uid),
      updatedAt: serverTimestamp()
    });

    transaction.update(motoboyRef, {
      totalRecusas: increment(1),
      updatedAt: serverTimestamp()
    });
  });
}

async function finalizarEntrega(pedidoId) {
  const pedidoRef = doc(db, "pedidos", pedidoId);
  const motoboyRef = doc(db, "motoboys", uid);
  const ledgerRef = doc(collection(db, "ledger_motoboy"));
  const rastreamentoRef = doc(db, "rastreamento_pedidos", pedidoId);

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);
    const motoboySnap = await transaction.get(motoboyRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido não encontrado.");
    }

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy não encontrado.");
    }

    const pedido = pedidoSnap.data();
    const motoboy = motoboySnap.data();

    if (pedido.motoboyId !== uid) {
      throw new Error("Essa corrida não pertence a você.");
    }

    if (pedido.status !== "aceito") {
      throw new Error("Essa corrida não está em andamento.");
    }

    if (pedido.pagamentoMotoboyCreditado === true) {
      throw new Error("Essa entrega já foi creditada.");
    }

    const valorMotoboy = Number(pedido.valorMotoboy || 0);
    const saldoAntes = Number(motoboy.saldo || 0);
    const saldoDepois = Number((saldoAntes + valorMotoboy).toFixed(2));

    transaction.update(pedidoRef, {
      status: "entregue",
      entregueAt: serverTimestamp(),
      pagamentoMotoboyCreditado: true,
      pagamentoMotoboyEstornado: false,
      updatedAt: serverTimestamp()
    });

    transaction.update(motoboyRef, {
      saldo: saldoDepois,
      totalEntregas: Number(motoboy.totalEntregas || 0) + 1,
      updatedAt: serverTimestamp()
    });

    transaction.set(ledgerRef, {
      motoboyId: uid,
      motoboyNome: motoboy.nome || pedido.motoboyNome || "",
      pedidoId,
      restauranteId: pedido.restauranteId || "",
      restauranteNome: pedido.restauranteNome || "",
      tipo: "credito_entrega",
      valor: valorMotoboy,
      saldoAntes,
      saldoDepois,
      status: "disponivel",
      descricao: "Entrega finalizada pelo motoboy",
      createdAt: serverTimestamp()
    });

    transaction.set(rastreamentoRef, {
      pedidoId,
      motoboyId: uid,
      restauranteId: pedido.restauranteId || "",
      status: "entregue",
      ativo: false,
      ultimaAtualizacaoAt: serverTimestamp()
    }, { merge: true });
  });
}

function carregarConfig() {
  onSnapshot(doc(db, "config", "app"), (snap) => {
    if (snap.exists()) {
      configApp = {
        ...configApp,
        ...snap.data()
      };
    }

    renderizarPedidos();
  });
}

function carregarMotoboyLogado() {
  onSnapshot(doc(db, "motoboys", uid), (snap) => {
    if (!snap.exists()) return;

    motoboyAtual = snap.data();
    renderizarPedidos();
  });
}

function carregarPedidosPendentes() {
  const q = query(
    collection(db, "pedidos"),
    where("status", "==", "pendente")
  );

  onSnapshot(
    q,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const id = change.doc.id;

        if (change.type === "removed") {
          pedidosMap.delete(id);
          return;
        }

        pedidosMap.set(id, {
          id,
          pedido: change.doc.data()
        });
      });

      atualizarCachePedidos();
    },
    (erro) => {
      console.error("Erro ao carregar pedidos pendentes:", erro);

      setHtml("listaPedidosMotoboy", `
        <div class="empty-state">
          Erro ao carregar pedidos pendentes: ${erro.message}
        </div>
      `);
    }
  );
}

function carregarMinhasCorridas() {
  const q = query(
    collection(db, "pedidos"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        const id = change.doc.id;

        if (change.type === "removed") {
          pedidosMap.delete(id);
          return;
        }

        pedidosMap.set(id, {
          id,
          pedido: change.doc.data()
        });
      });

      atualizarCachePedidos();
    },
    (erro) => {
      console.error("Erro ao carregar minhas corridas:", erro);
    }
  );
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  uid = user.uid;

  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists() || userSnap.data().role !== "motoboy") {
    return;
  }

  carregarConfig();
  carregarMotoboyLogado();
  carregarPedidosPendentes();
  carregarMinhasCorridas();

  if (!renderInterval) {
    renderInterval = setInterval(() => {
      renderizarPedidos();
    }, 5000);
  }
});
