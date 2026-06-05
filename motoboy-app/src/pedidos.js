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
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let uid = null;
let motoboyAtual = null;
let pedidosEmBusca = [];
let pedidosDoMotoboy = [];
let pedidosDisponiveis = [];
let corridaAtual = null;
let pedidoModalAtual = null;
let idsJaNotificados = new Set();

let alertaNovaCorridaAtivo = false;
let alertaNovaCorridaTimer = null;
let alertaNovaCorridaPedidoId = null;

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
  const nLat1 = Number(lat1);
  const nLng1 = Number(lng1);
  const nLat2 = Number(lat2);
  const nLng2 = Number(lng2);

  if (
    !Number.isFinite(nLat1) ||
    !Number.isFinite(nLng1) ||
    !Number.isFinite(nLat2) ||
    !Number.isFinite(nLng2)
  ) {
    return null;
  }

  const R = 6371;
  const dLat = (nLat2 - nLat1) * Math.PI / 180;
  const dLng = (nLng2 - nLng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(nLat1 * Math.PI / 180) *
    Math.cos(nLat2 * Math.PI / 180) *
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

function maiorRaioDoPedido(pedido) {
  const raios = Array.isArray(pedido.raiosBuscaKm)
    ? pedido.raiosBuscaKm.map(Number).filter(Number.isFinite)
    : [];

  const raioAtual = Number(pedido.raioAtualKm || 0);

  if (raios.length === 0) {
    return raioAtual || 15;
  }

  return Math.max(raioAtual || 0, ...raios);
}

function podeReceberPedidos() {
  return (
    uid &&
    motoboyAtual &&
    motoboyAtual.online === true &&
    motoboyAtual.aprovado === true &&
    motoboyAtual.ativo !== false &&
    motoboyAtual.bloqueado !== true &&
    motoboyAtual.location &&
    Number.isFinite(Number(motoboyAtual.location.lat)) &&
    Number.isFinite(Number(motoboyAtual.location.lng))
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
    motoboyAtual.location.lat,
    motoboyAtual.location.lng,
    origemPedido.lat,
    origemPedido.lng
  );

  if (distancia === null) return false;

  const raioPermitido = maiorRaioDoPedido(pedido);

  return distancia <= raioPermitido;
}

function tocarSomNovaCorrida() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(1.0, ctx.currentTime + 0.03);
    masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);
    masterGain.connect(ctx.destination);

    const frequencias = [880, 1175, 1568];

    frequencias.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const inicio = ctx.currentTime + (index * 0.28);
      const fim = inicio + 0.42;

      osc.type = "square";
      osc.frequency.setValueAtTime(freq, inicio);

      gain.gain.setValueAtTime(0.001, inicio);
      gain.gain.exponentialRampToValueAtTime(0.9, inicio + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, fim);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(inicio);
      osc.stop(fim);
    });

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 2200);
  } catch (erro) {
    console.warn("Som não liberado pelo navegador.", erro);
  }
}

function vibrarNovaCorrida() {
  if (navigator.vibrate) {
    navigator.vibrate([250, 80, 250]);
  }
}

function iniciarAlertaNovaCorrida(pedidoId) {
  if (!pedidoId) return;

  if (
    alertaNovaCorridaAtivo === true &&
    alertaNovaCorridaPedidoId === pedidoId
  ) {
    return;
  }

  pararAlertaNovaCorrida();

  alertaNovaCorridaAtivo = true;
  alertaNovaCorridaPedidoId = pedidoId;

  tocarSomNovaCorrida();
  vibrarNovaCorrida();

  alertaNovaCorridaTimer = setInterval(() => {
    if (!alertaNovaCorridaAtivo) return;

    tocarSomNovaCorrida();
    vibrarNovaCorrida();
  }, 2100);
}

function pararAlertaNovaCorrida() {
  alertaNovaCorridaAtivo = false;
  alertaNovaCorridaPedidoId = null;

  if (alertaNovaCorridaTimer) {
    clearInterval(alertaNovaCorridaTimer);
    alertaNovaCorridaTimer = null;
  }

  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}

function abrirUrlNavegacao(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function abrirGoogleMapsParaRestaurante(pedido) {
  const destino = obterLocationPedido(pedido);

  if (!destino.lat || !destino.lng) {
    alert("Localização do restaurante não encontrada.");
    return;
  }

  const url =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${encodeURIComponent(`${destino.lat},${destino.lng}`)}` +
    `&travelmode=driving`;

  abrirUrlNavegacao(url);
}

function abrirWazeParaRestaurante(pedido) {
  const destino = obterLocationPedido(pedido);

  if (!destino.lat || !destino.lng) {
    alert("Localização do restaurante não encontrada.");
    return;
  }

  const url =
    `https://waze.com/ul?ll=${encodeURIComponent(`${destino.lat},${destino.lng}`)}` +
    `&navigate=yes`;

  abrirUrlNavegacao(url);
}

function abrirGoogleMapsParaCliente(pedido) {
  if (!pedido.enderecoEntrega) {
    alert("Endereço de entrega não encontrado.");
    return;
  }

  const url =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${encodeURIComponent(pedido.enderecoEntrega)}` +
    `&travelmode=driving`;

  abrirUrlNavegacao(url);
}

function abrirWazeParaCliente(pedido) {
  if (!pedido.enderecoEntrega) {
    alert("Endereço de entrega não encontrado.");
    return;
  }

  const url =
    `https://waze.com/ul?q=${encodeURIComponent(pedido.enderecoEntrega)}` +
    `&navigate=yes`;

  abrirUrlNavegacao(url);
}

function mostrarModalNovaCorrida(pedido) {
  if (!pedido) return;
  if (corridaAtual) return;

  pedidoModalAtual = pedido;

  const origemPedido = obterLocationPedido(pedido);

  const distanciaAteRestaurante = calcularDistanciaKm(
    motoboyAtual.location.lat,
    motoboyAtual.location.lng,
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

  idsJaNotificados.add(pedido.id);
  iniciarAlertaNovaCorrida(pedido.id);
}

function fecharModalNovaCorrida() {
  pedidoModalAtual = null;
  pararAlertaNovaCorrida();
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

      <div class="navigation-panel">
        <span>Navegação</span>
        <strong>Escolha seu GPS</strong>

        <div class="navigation-group">
          <p>Ir até o restaurante</p>

          <div class="navigation-buttons">
            <button type="button" class="nav-btn google" data-nav="google-restaurante">
              Google Maps
            </button>

            <button type="button" class="nav-btn waze" data-nav="waze-restaurante">
              Waze
            </button>
          </div>
        </div>

        <div class="navigation-group">
          <p>Ir até o cliente</p>

          <div class="navigation-buttons">
            <button type="button" class="nav-btn google" data-nav="google-cliente">
              Google Maps
            </button>

            <button type="button" class="nav-btn waze" data-nav="waze-cliente">
              Waze
            </button>
          </div>
        </div>
      </div>

      <button class="finish-btn" type="button" data-finalizar="${corridaAtual.id}">
        Finalizar entrega
      </button>
    </div>
  `;

  const btnFinalizar = box.querySelector("button[data-finalizar]");
  if (btnFinalizar) {
    btnFinalizar.addEventListener("click", () => finalizarEntrega(corridaAtual.id));
  }

  box.querySelectorAll("button[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      const tipo = button.dataset.nav;

      if (tipo === "google-restaurante") {
        abrirGoogleMapsParaRestaurante(corridaAtual);
      }

      if (tipo === "waze-restaurante") {
        abrirWazeParaRestaurante(corridaAtual);
      }

      if (tipo === "google-cliente") {
        abrirGoogleMapsParaCliente(corridaAtual);
      }

      if (tipo === "waze-cliente") {
        abrirWazeParaCliente(corridaAtual);
      }
    });
  });
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
      motoboyAtual.location.lat,
      motoboyAtual.location.lng,
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

  pararAlertaNovaCorrida();

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

  pararAlertaNovaCorrida();

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

function recalcularPedidosDisponiveis() {
  const disponiveis = [];

  const atual = pedidosDoMotoboy.find((pedido) => {
    return pedido.status === "aceito" && pedido.motoboyId === uid;
  }) || null;

  pedidosEmBusca.forEach((pedido) => {
    if (pedidoEstaDisponivel(pedido)) {
      const origemPedido = obterLocationPedido(pedido);

      const distanciaAteRestaurante = calcularDistanciaKm(
        motoboyAtual.location.lat,
        motoboyAtual.location.lng,
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

function escutarPedidosEmBusca() {
  const q = query(
    collection(db, "pedidos"),
    where("status", "in", ["pendente", "buscando_motoboy"])
  );

  onSnapshot(
    q,
    (snapshot) => {
      pedidosEmBusca = [];

      snapshot.forEach((docSnap) => {
        pedidosEmBusca.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      recalcularPedidosDisponiveis();
    },
    (erro) => {
      console.error("Erro ao carregar pedidos em busca:", erro);

      const lista = document.getElementById("listaPedidosMotoboy");
      if (lista) {
        lista.innerHTML = `
          <div class="empty-state">
            Erro ao carregar pedidos. Verifique permissões do Firestore.
          </div>
        `;
      }
    }
  );
}

function escutarPedidosDoMotoboy() {
  const q = query(
    collection(db, "pedidos"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      pedidosDoMotoboy = [];

      snapshot.forEach((docSnap) => {
        pedidosDoMotoboy.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      recalcularPedidosDisponiveis();
    },
    (erro) => {
      console.error("Erro ao carregar pedidos do motoboy:", erro);
    }
  );
}

function escutarMotoboy() {
  onSnapshot(doc(db, "motoboys", uid), (snap) => {
    if (!snap.exists()) return;

    motoboyAtual = {
      id: snap.id,
      ...snap.data()
    };

    recalcularPedidosDisponiveis();
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
  escutarPedidosEmBusca();
  escutarPedidosDoMotoboy();
});
