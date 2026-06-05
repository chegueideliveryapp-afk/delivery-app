import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function numero(valor, padrao = 0) {
  const n = Number(valor || padrao);
  return Number.isFinite(n) ? n : padrao;
}

export async function estornarEntrega(pedidoId, motivoEstorno) {
  const uidAdmin = auth.currentUser?.uid;

  if (!uidAdmin) {
    throw new Error("Admin nao autenticado.");
  }

  if (!pedidoId) {
    throw new Error("Pedido nao informado.");
  }

  const pedidoRef = doc(db, "pedidos", pedidoId);

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido nao encontrado.");
    }

    const pedido = pedidoSnap.data();

    if (pedido.status !== "entregue") {
      throw new Error("Somente entregas finalizadas podem ser estornadas.");
    }

    if (
      pedido.estornado === true ||
      pedido.pagamentoMotoboyEstornado === true ||
      pedido.pagamentoMotoboyStatus === "estornado"
    ) {
      throw new Error("Esta entrega ja foi estornada.");
    }

    if (
      pedido.pagamentoMotoboyPago === true ||
      pedido.pagamentoMotoboyStatus === "pago"
    ) {
      throw new Error("Esta entrega ja foi paga ao motoboy. Faca ajuste manual antes de estornar.");
    }

    if (!pedido.motoboyId) {
      throw new Error("Pedido sem motoboy vinculado.");
    }

    if (!pedido.restauranteId) {
      throw new Error("Pedido sem restaurante vinculado.");
    }

    const motoboyRef = doc(db, "motoboys", pedido.motoboyId);
    const restauranteRef = doc(db, "restaurantes", pedido.restauranteId);

    const motoboySnap = await transaction.get(motoboyRef);
    const restauranteSnap = await transaction.get(restauranteRef);

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy nao encontrado.");
    }

    if (!restauranteSnap.exists()) {
      throw new Error("Restaurante nao encontrado.");
    }

    const motoboy = motoboySnap.data();
    const restaurante = restauranteSnap.data();

    const valorMotoboy = numero(pedido.valorMotoboy, 0);
    const valorTotal = numero(pedido.valorTotal, 0);

    if (valorMotoboy <= 0) {
      throw new Error("Valor do motoboy invalido.");
    }

    if (valorTotal <= 0) {
      throw new Error("Valor total do pedido invalido.");
    }

    const saldoMotoboyAntes = numero(motoboy.saldo, 0);
    const saldoMotoboyDepois = Math.max(0, saldoMotoboyAntes - valorMotoboy);

    const saldoRestauranteAntes = numero(restaurante.saldoPrePago, 0);
    const saldoRestauranteDepois = saldoRestauranteAntes + valorTotal;

    const ledgerMotoboyRef = doc(collection(db, "ledger_motoboy"));
    const ledgerRestauranteRef = doc(collection(db, "ledger_restaurante"));
    const notificacaoRef = doc(collection(db, "notificacoes_motoboy"));

    transaction.update(pedidoRef, {
      estornado: true,
      estornadoAt: serverTimestamp(),
      estornadoPor: uidAdmin,
      motivoEstorno: motivoEstorno || "Estorno administrativo",

      pagamentoMotoboyEstornado: true,
      pagamentoMotoboyStatus: "estornado",

      updatedAt: serverTimestamp()
    });

    transaction.update(motoboyRef, {
      saldo: saldoMotoboyDepois,
      updatedAt: serverTimestamp()
    });

    transaction.update(restauranteRef, {
      saldoPrePago: saldoRestauranteDepois,
      updatedAt: serverTimestamp()
    });

    transaction.set(ledgerMotoboyRef, {
      motoboyId: pedido.motoboyId,
      motoboyNome: pedido.motoboyNome || motoboy.nome || "",
      restauranteId: pedido.restauranteId,
      restauranteNome: pedido.restauranteNome || restaurante.nome || "",
      pedidoId,

      tipo: "estorno_entrega",
      valor: -valorMotoboy,
      saldoAntes: saldoMotoboyAntes,
      saldoDepois: saldoMotoboyDepois,

      descricao: "Entrega estornada pela administracao",
      motivo: motivoEstorno || "Estorno administrativo",

      createdAt: serverTimestamp(),
      criadoPor: uidAdmin
    });

    transaction.set(ledgerRestauranteRef, {
      restauranteId: pedido.restauranteId,
      restauranteNome: pedido.restauranteNome || restaurante.nome || "",
      pedidoId,
      recargaId: null,

      tipo: "estorno_pedido",
      valor: valorTotal,
      saldoAntes: saldoRestauranteAntes,
      saldoDepois: saldoRestauranteDepois,

      descricao: "Valor devolvido ao restaurante por estorno de entrega",
      motivo: motivoEstorno || "Estorno administrativo",

      createdAt: serverTimestamp(),
      criadoPor: uidAdmin
    });

    transaction.set(notificacaoRef, {
      motoboyId: pedido.motoboyId,
      pedidoId,

      tipo: "estorno_entrega",
      titulo: "Entrega estornada",
      mensagem: `A entrega do restaurante ${pedido.restauranteNome || "Restaurante"} foi estornada pela administracao. O valor saiu dos seus ganhos em aberto.`,
      valor: valorMotoboy,
      motivo: motivoEstorno || "Estorno administrativo",

      lida: false,
      createdAt: serverTimestamp()
    });
  });
}
