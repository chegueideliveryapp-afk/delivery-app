import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  runTransaction,
  updateDoc,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let uidMotoboy = null;
let motoboyAtual = null;
let unsubscribePedidosPendentes = null;
let unsubscribeMinhasCorridas = null;

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

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const raioTerraKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return raioTerraKm * c;
}

function motoboyPodeReceberPedidos() {
  return (
    motoboyAtual &&
    motoboyAtual.aprovado === true &&
    motoboyAtual.ativo !== false &&
    motoboyAtual.bloqueado !== true &&
    motoboyAtual.online === true &&
    motoboyAtual.location &&
    Number(motoboyAtual.location.lat) &&
    Number(motoboyAtual.location.lng)
  );
}

function pedidoJaFoiRecusado(pedido) {
  return Array.isArray(pedido.recusadoPor) && pedido.recusadoPor.includes(uidMotoboy);
}

function distanciaAteRestaurante(pedido) {
  const motoLat = Number(motoboyAtual?.location?.lat);
  const motoLng = Number(motoboyAtual?.location?.lng);

  const restauranteLat = Number(
    pedido.restauranteLocation?.lat ??
    pedido.restauranteLat ??
    pedido.lat
  );

  const restauranteLng = Number(
    pedido.restauranteLocation?.lng ??
    pedido.restauranteLng ??
    pedido.lng
  );

  if (!motoLat || !motoLng || !restauranteLat || !restauranteLng) {
    return null;
  }

  return calcularDistanciaKm(
    motoLat,
    motoLng,
    restauranteLat,
    restauranteLng
  );
}

function renderizarPedidoPendente(id, pedido, distanciaKm) {
  const pagamentoTexto = {
    pix: "Pix",
    cartao: "Cartão",
    dinheiro: "Dinheiro"
  };

  return `
    <div class="delivery-card">
      <div class="delivery-topline">
        <span>Nova corrida</span>
        <strong>${dinheiro(pedido.valorMotoboy)}</strong>
      </div>

      <h3>${pedido.restauranteNome || "Restaurante"}</h3>

      <p><b>Entrega:</b> ${pedido.enderecoEntrega || "Endereço não informado"}</p>
      <p><b>Distância até restaurante:</b> ${distanciaKm.toFixed(2)} km</p>
      <p><b>Distância da entrega:</b> ${Number(pedido.distanciaKm || 0).toFixed(2)} km</p>
      <p><b>Pagamento:</b> ${pagamentoTexto[pedido.formaPagamento] || "Não informado"}</p>
      <p><b>Retorno:</b> ${pedido.precisaRetorno ? "Sim" : "Não"}</p>

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
        <button class="accept-btn" data-action="aceitarPedido" data-id="${id}">
          Aceitar
        </button>

        <button class="decline-btn" data-action="recusarPedido" data-id="${id}">
          Recusar
        </button>
      </div>
    </div>
  `;
}

function renderizarCorridaAtual(id, pedido) {
  const pagamentoTexto = {
    pix: "Pix",
    cartao: "Cartão",
    dinheiro: "Dinheiro"
  };

  return `
    <div class="delivery-card active-delivery">
      <div class="delivery-topline">
        <span>Corrida em andamento</span>
        <strong>${dinheiro(pedido.valorMotoboy)}</strong>
      </div>

      <h3>${pedido.restauranteNome || "Restaurante"}</h3>

      <p><b>Entrega:</b> ${pedido.enderecoEntrega || "Endereço não informado"}</p>
      <p><b>Pagamento:</b> ${pagamentoTexto[pedido.formaPagamento] || "Não informado"}</p>
      <p><b>Retorno:</b> ${pedido.precisaRetorno ? "Sim" : "Não"}</p>
      <p><b>Status:</b> ${pedido.status || "aceito"}</p>

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

      <p class="delivery-note">
        A finalização da entrega será adicionada na próxima etapa.
      </p>
    </div>
  `;
}

function configurarBotoesPedidos() {
  document.querySelectorAll("button[data-action='aceitarPedido']").forEach((button) => {
    button.addEventListener("click", async () => {
      const pedidoId = button.dataset.id;

      button.disabled = true;
      button.innerText = "Aceitando...";

      try {
        await aceitarPedido(pedidoId);
      } catch (erro) {
        console.error(erro);
        alert(erro.message || "Erro ao aceitar pedido.");
        button.disabled = false;
        button.innerText = "Aceitar";
      }
    });
  });

  document.querySelectorAll("button[data-action='recusarPedido']").forEach((button) => {
    button.addEventListener("click", async () => {
      const pedidoId = button.dataset.id;

      button.disabled = true;
      button.innerText = "Recusando...";

      try {
        await recusarPedido(pedidoId);
      } catch (erro) {
        console.error(erro);
        alert("Erro ao recusar pedido.");
        button.disabled = false;
        button.innerText = "Recusar";
      }
    });
  });
}

function escutarPedidosPendentes() {
  const listaId = "listaPedidosMotoboy";

  if (unsubscribePedidosPendentes) {
    unsubscribePedidosPendentes();
  }

  const q = query(
    collection(db, "pedidos"),
    where("status", "==", "pendente")
  );

  unsubscribePedidosPendentes = onSnapshot(
    q,
    (snapshot) => {
      if (!motoboyPodeReceberPedidos()) {
        setHtml(
          listaId,
          `<div class="empty-state">Fique online com GPS ativo para receber corridas próximas.</div>`
        );
        return;
      }

      const pedidosDisponiveis = [];

      snapshot.forEach((docSnap) => {
        const pedido = docSnap.data();

        if (pedidoJaFoiRecusado(pedido)) return;

        const distanciaKm = distanciaAteRestaurante(pedido);

        if (distanciaKm === null) return;

        const raioAtualKm = Number(pedido.raioAtualKm || 3);

        if (distanciaKm > raioAtualKm) return;

        pedidosDisponiveis.push({
          id: docSnap.id,
          pedido,
          distanciaKm
        });
      });

      pedidosDisponiveis.sort((a, b) => a.distanciaKm - b.distanciaKm);

      if (!pedidosDisponiveis.length) {
        setHtml(
          listaId,
          `<div class="empty-state">Nenhuma corrida próxima no momento.</div>`
        );
        return;
      }

      setHtml(
        listaId,
        pedidosDisponiveis
          .map((item) => renderizarPedidoPendente(item.id, item.pedido, item.distanciaKm))
          .join("")
      );

      configurarBotoesPedidos();
    },
    (erro) => {
      console.error(erro);
      setHtml(
        listaId,
        `<div class="empty-state">Erro ao carregar pedidos. Confira as regras do Firestore.</div>`
      );
    }
  );
}

function escutarMinhasCorridas() {
  const listaId = "corridaAtualMotoboy";

  if (unsubscribeMinhasCorridas) {
    unsubscribeMinhasCorridas();
  }

  const q = query(
    collection(db, "pedidos"),
    where("motoboyId", "==", uidMotoboy)
  );

  unsubscribeMinhasCorridas = onSnapshot(
    q,
    (snapshot) => {
      const corridas = [];

      snapshot.forEach((docSnap) => {
        const pedido = docSnap.data();

        if (pedido.status === "aceito") {
          corridas.push({
            id: docSnap.id,
            pedido
          });
        }
      });

      if (!corridas.length) {
        setHtml(
          listaId,
          `<div class="empty-state">Nenhuma corrida em andamento.</div>`
        );
        return;
      }

      setHtml(
        listaId,
        corridas
          .map((item) => renderizarCorridaAtual(item.id, item.pedido))
          .join("")
      );
    },
    (erro) => {
      console.error(erro);
      setHtml(
        listaId,
        `<div class="empty-state">Erro ao carregar sua corrida atual.</div>`
      );
    }
  );
}

async function aceitarPedido(pedidoId) {
  if (!uidMotoboy || !motoboyAtual) {
    throw new Error("Motoboy não carregado.");
  }

  if (!motoboyPodeReceberPedidos()) {
    throw new Error("Você precisa estar online, aprovado e com GPS ativo.");
  }

  const pedidoRef = doc(db, "pedidos", pedidoId);
  const motoboyRef = doc(db, "motoboys", uidMotoboy);

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

    if (pedido.status !== "pendente") {
      throw new Error("Essa corrida já foi aceita por outro motoboy.");
    }

    if (Array.isArray(pedido.recusadoPor) && pedido.recusadoPor.includes(uidMotoboy)) {
      throw new Error("Você já recusou essa corrida.");
    }

    if (
      motoboy.aprovado !== true ||
      motoboy.ativo === false ||
      motoboy.bloqueado === true ||
      motoboy.online !== true
    ) {
      throw new Error("Seu cadastro não está liberado para aceitar corrida.");
    }

    transaction.update(pedidoRef, {
      status: "aceito",
      motoboyId: uidMotoboy,
      motoboyNome: motoboy.nome || "",
      aceitoAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}

async function recusarPedido(pedidoId) {
  if (!uidMotoboy) return;

  const pedidoRef = doc(db, "pedidos", pedidoId);

  await updateDoc(pedidoRef, {
    recusadoPor: arrayUnion(uidMotoboy),
    updatedAt: serverTimestamp()
  });
}

function iniciarPedidosMotoboy() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      return;
    }

    uidMotoboy = user.uid;

    const motoboyRef = doc(db, "motoboys", uidMotoboy);

    onSnapshot(
      motoboyRef,
      (snap) => {
        if (!snap.exists()) return;

        motoboyAtual = snap.data();

        escutarPedidosPendentes();
        escutarMinhasCorridas();
      },
      (erro) => {
        console.error(erro);
      }
    );
  });
}

iniciarPedidosMotoboy();
