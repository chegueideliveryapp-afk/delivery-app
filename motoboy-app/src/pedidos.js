import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let uid = null;
let motoboyAtual = null;
let pedidosDisponiveis = [];
let corridaAtual = null;
let pedidoModalAtual = null;
let idsJaNotificados = new Set();
let audioLiberado = false;

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function textoPagamento(valor) {
  if (valor === "cartao") return "Cartão";
  if (valor === "dinheiro") return "Dinheiro";
  return "Pix";
}

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;

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

function obterLocationPedido(pedido) {
  const lat =
    pedido.restauranteLocation?.lat ??
    pedido.location?.lat ??
    pedido.lat ??
    null;

  const lng =
    pedido.restauranteLocation?.lng ??
    pedido.location?.lng ??
    pedido.lng ??
    null;

  return {
    lat: Number(lat),
    lng: Number(lng)
  };
}

function podeReceberPedidos() {
  return (
    uid &&
    motoboyAtual &&
    motoboyAtual.online === true &&
    motoboyAtual.aprovado === true &&
    motoboyAtual.ativo !== false &&
    motoboyAtual.bloqueado !== true &&
    motoboyAtual.location?.lat &&
    motoboyAtual.location?.lng
  );
}

function pedidoEstaDisponivel(pedido) {
  const statusValido =
    pedido.status === "pendente" ||
    pedido.status === "buscando_motoboy";

  if (!statusValido) return false;
  if (pedido.motoboyId) return false;

  const recusados = pedido.recusadoPor || [];
  if (recusados.includes(uid)) return false;

  if (!podeReceberPedidos()) return false;

  const origemPedido = obterLocationPedido(pedido);

  const distancia = calcularDistanciaKm(
    Number(motoboyAtual.location.lat),
    Number(motoboyAtual.location.lng),
    origemPedido.lat,
    origemPedido.lng
  );

  if (distancia === null) return false;

  const raioAtual = Number(pedido.raioAtualKm || 15);

  return distancia <= raioAtual;
}

function tocarSomNovaCorrida() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1040, ctx.currentTime + 0.16);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.26, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (erro) {
    console.warn("Som não liberado pelo navegador.", erro);
  }
}

function vibrarNovaCorrida() {
  if (navigator.vibrate) {
    navigator.vibrate([250, 80, 250]);
  }
}

function liberarAudioNaPrimeiraInteracao() {
  if (audioLiberado) return;

  audioLiberado = true;

  document.removeEventListener("click", liberarAudioNaPrimeiraInteracao);
  document.removeEventListener("touchstart", liberarAudioNaPrimeiraInteracao);
}

document.addEventListener("click", liberarAudioNaPrimeiraInteracao);
document.addEventListener("touchstart", liberarAudioNaPrimeiraInteracao);

function mostrarModalNovaCorrida(pedido) {
  if (!pedido) return;
  if (corridaAtual) return;

  pedidoModalAtual = pedido;

  const origemPedido = obterLocationPedido(pedido);

  const distanciaAteRestaurante = calcularDistanciaKm(
    Number(motoboyAtual.location.lat),
    Number(motoboyAtual.location.lng),
    origemPedido.lat,
    origemPedido.lng
  );

  document.getElementById("modalRestauranteNome").innerText =
    pedido.restauranteNome || "Restaurante";

  document.getElementById("modalValorMotoboy").innerText =
    dinheiro(pedido.valorMotoboy);

  document.getElementById("modalEnderecoEntrega").innerText =
    pedido.enderecoEntrega || "Endereço não informado";

  document.getElementById("modalDistanciaRestaurante").innerText =
    distanciaAteRestaurante !== null
      ? `${distanciaAteRestaurante.toFixed(2)} km`
      : "---";

  document.getElementById("modalDistanciaEntrega").innerText =
    pedido.distanciaKm
      ? `${Number(pedido.distanciaKm).toFixed(2)} km`
      : "---";

  document.getElementById("modalPagamento").innerText =
    textoPagamento(pedido.formaPagamento);

  document.getElementById("modalRetorno").innerText =
    pedido.precisaRetorno ? "Sim" : "Não";

  document.getElementById("novaCorridaOverlay").classList.remove("hidden");

  if (!idsJaNotificados.has(pedido.id)) {
    idsJaNotificados.add(pedido.id);
    tocarSomNovaCorrida();
    vibrarNovaCorrida();
  }
}

function fecharModalNovaCorrida() {
  pedidoModalAtual = null;
  document.getElementById("novaCorridaOverlay")?.classList.add("hidden");
}

function renderizarCorridaAtual() {
  const box = document.getElementById("corridaAtualMotoboy");
  if (!box) return;

  if (!corridaAtual) {
    box.innerHTML = `
      <div class="empty-state">
        Nenhuma corrida em andamento.
      </div>
    `;
    return;
  }

  box.innerHTML = `
    <div class="current-order-card">
      <span class="current-order-label">Corrida em andamento</span>
      <strong>${corridaAtual.restauranteNome || "Restaurante"}</strong>

      <p><b>Valor:</b> ${dinheiro(corridaAtual.valorMotoboy)}</p>
      <p><b>Entrega:</b> ${corridaAtual.enderecoEntrega || "Endereço não informado"}</p>
      <p><b>Status:</b> Aceito</p>
      <p><b>Pagamento:</b> ${textoPagamento(corridaAtual.formaPagamento)}</p>
      <p><b>Retorno:</b> ${corridaAtual.precisaRetorno ? "Sim" : "Não"}</p>

      <button class="finish-btn" type="button" data-finalizar="${corridaAtual.id}">
        Finalizar entrega
      </button>
    </div>
  `;

  const btn = box.querySelector("button[data-finalizar]");
  if (btn) {
    btn.addEventListener("click", () => finalizarEntrega(corridaAtual.id));
  }
}

function renderizarPedidosDisponiveis() {
  const lista = document.getElementById("listaPedidosMotoboy");
  if (!lista) return;

  lista.innerHTML = "";

  if (corridaAtual) {
    lista.innerHTML = `
      <div class="empty-state">
        Você já possui uma corrida em andamento.
      </div>
    `;
    fecharModalNovaCorrida();
    return;
  }

  if (!podeReceberPedidos()) {
    lista.innerHTML = `
      <div class="empty-state">
        Fique online e mantenha o GPS ativo para receber corridas.
      </div>
    `;
    fecharModalNovaCorrida();
    return;
  }

  if (pedidosDisponiveis.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        Nenhuma corrida próxima no momento.
      </div>
    `;
    fecharModalNovaCorrida();
    return;
  }

  pedidosDisponiveis.forEach((pedido) => {
    const origemPedido = obterLocationPedido(pedido);

    const distanciaAteRestaurante = calcularDistanciaKm(
      Number(motoboyAtual.location.lat),
      Number(motoboyAtual.location.lng),
      origemPedido.lat,
      origemPedido.lng
    );

    const card = document.createElement("div");
    card.className = "order-card";

    card.innerHTML = `
      <div class="order-card-top">
        <div>
          <span>Nova corrida</span>
          <strong>${pedido.restauranteNome || "Restaurante"}</strong>
        </div>

        <b>${dinheiro(pedido.valorMotoboy)}</b>
      </div>

      <p><b>Entrega:</b> ${pedido.enderecoEntrega || "Endereço não informado"}</p>
      <p><b>Distância até restaurante:</b> ${
        distanciaAteRestaurante !== null ? `${distanciaAteRestaurante.toFixed(2)} km` : "---"
      }</p>
      <p><b>Distância da entrega:</b> ${
        pedido.distanciaKm ? `${Number(pedido.distanciaKm).toFixed(2)} km` : "---"
      }</p>
      <p><b>Pagamento:</b> ${textoPagamento(pedido.formaPagamento)}</p>
      <p><b>Retorno:</b> ${pedido.precisaRetorno ? "Sim" : "Não"}</p>

      <div class="order-actions">
        <button class="accept-btn" type="button" data-aceitar="${pedido.id}">
          Aceitar
        </button>

        <button class="refuse-btn" type="button" data-recusar="${pedido.id}">
          Recusar
        </button>
      </div>
    `;

    lista.appendChild(card);
  });

  lista.querySelectorAll("button[data-aceitar]").forEach((btn) => {
    btn.addEventListener("click", () => aceitarPedido(btn.dataset.aceitar));
  });

  lista.querySelectorAll("button[data-recusar]").forEach((btn) => {
    btn.addEventListener("click", () => recusarPedido(btn.dataset.recusar));
  });

  mostrarModalNovaCorrida(pedidosDisponiveis[0]);
}

async function aceitarPedido(pedidoId) {
  if (!uid || !pedidoId) return;

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

    const statusValido =
      pedido.status === "pendente" ||
      pedido.status === "buscando_motoboy";

    if (!statusValido || pedido.motoboyId) {
      throw new Error("Essa corrida já foi aceita por outro motoboy.");
    }

    if (
      motoboy.aprovado !== true ||
      motoboy.bloqueado === true ||
      motoboy.online !== true
    ) {
      throw new Error("Seu cadastro não está liberado para aceitar corridas.");
    }

    transaction.update(pedidoRef, {
      status: "aceito",
      motoboyId: uid,
      motoboyNome: motoboy.nome || "",
      aceitoAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  fecharModalNovaCorrida();
}

async function recusarPedido(pedidoId) {
  if (!uid || !pedidoId) return;

  await updateDoc(doc(db, "pedidos", pedidoId), {
    recusadoPor: arrayUnion(uid),
    updatedAt: serverTimestamp()
  });

  await updateDoc(doc(db, "motoboys", uid), {
    totalRecusas: increment(1),
    updatedAt: serverTimestamp()
  });

  fecharModalNovaCorrida();
}

async function finalizarEntrega(pedidoId) {
  if (!uid || !pedidoId) return;

  const confirmar = confirm("Confirmar finalização desta entrega?");
  if (!confirmar) return;

  const pedidoRef = doc(db, "pedidos", pedidoId);
  const motoboyRef = doc(db, "motoboys", uid);
  const ledgerRef = doc(collection(db, "ledger_motoboy"));

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

    const valorMotoboy = Number(pedido.valorMotoboy || 0);
    const saldoAntes = Number(motoboy.saldo || 0);
    const saldoDepois = saldoAntes + valorMotoboy;

    transaction.update(pedidoRef, {
      status: "entregue",
      entregueAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      pagamentoMotoboyPago: false,
      pagamentoMotoboyStatus: "pendente",
      pagamentoMotoboyId: null
    });

    transaction.update(motoboyRef, {
      saldo: saldoDepois,
      totalEntregas: increment(1),
      updatedAt: serverTimestamp()
    });

    transaction.set(ledgerRef, {
      motoboyId: uid,
      motoboyNome: motoboy.nome || "",
      pedidoId,
      restauranteId: pedido.restauranteId || "",
      restauranteNome: pedido.restauranteNome || "",
      tipo: "credito_entrega",
      valor: valorMotoboy,
      saldoAntes,
      saldoDepois,
      statusPagamento: "pendente",
      pago: false,
      pagamentoId: null,
      createdAt: serverTimestamp()
    });
  });
}

function escolherPedidosDisponiveis(snapshot) {
  const disponiveis = [];
  let atual = null;

  snapshot.forEach((docSnap) => {
    const pedido = {
      id: docSnap.id,
      ...docSnap.data()
    };

    if (pedido.status === "aceito" && pedido.motoboyId === uid) {
      atual = pedido;
      return;
    }

    if (pedidoEstaDisponivel(pedido)) {
      const origemPedido = obterLocationPedido(pedido);

      const distanciaAteRestaurante = calcularDistanciaKm(
        Number(motoboyAtual.location.lat),
        Number(motoboyAtual.location.lng),
        origemPedido.lat,
        origemPedido.lng
      );

      disponiveis.push({
        ...pedido,
        distanciaAteRestaurante
      });
    }
  });

  disponiveis.sort((a, b) => {
    return Number(a.distanciaAteRestaurante || 999) - Number(b.distanciaAteRestaurante || 999);
  });

  corridaAtual = atual;
  pedidosDisponiveis = disponiveis;

  renderizarCorridaAtual();
  renderizarPedidosDisponiveis();
}

function escutarPedidos() {
  const q = query(collection(db, "pedidos"));

  onSnapshot(q, (snapshot) => {
    escolherPedidosDisponiveis(snapshot);
  });
}

function escutarMotoboy() {
  onSnapshot(doc(db, "motoboys", uid), (snap) => {
    if (!snap.exists()) return;

    motoboyAtual = {
      id: snap.id,
      ...snap.data()
    };

    renderizarPedidosDisponiveis();
  });
}

function configurarModal() {
  const btnAceitar = document.getElementById("btnModalAceitar");
  const btnRecusar = document.getElementById("btnModalRecusar");

  if (btnAceitar) {
    btnAceitar.addEventListener("click", () => {
      if (!pedidoModalAtual) return;
      aceitarPedido(pedidoModalAtual.id);
    });
  }

  if (btnRecusar) {
    btnRecusar.addEventListener("click", () => {
      if (!pedidoModalAtual) return;
      recusarPedido(pedidoModalAtual.id);
    });
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  uid = user.uid;

  const motoboySnap = await getDoc(doc(db, "motoboys", uid));

  if (!motoboySnap.exists()) return;

  motoboyAtual = {
    id: uid,
    ...motoboySnap.data()
  };

  configurarModal();
  escutarMotoboy();
  escutarPedidos();
});
