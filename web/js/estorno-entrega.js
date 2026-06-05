import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

export async function estornarEntrega(pedidoId, motivoEstorno) {
  const uidAdmin = auth.currentUser?.uid;

  if (!uidAdmin) {
    throw new Error("Admin não autenticado.");
  }

  if (!pedidoId) {
    throw new Error("Pedido não informado.");
  }

  const pedidoRef = doc(db, "pedidos", pedidoId);

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido não encontrado.");
    }

    const pedido = pedidoSnap.data();

    if (pedido.status !== "entregue") {
      throw new Error("Só é possível estornar pedido entregue.");
    }

    if (pedido.pagamentoMotoboyPago === true || pedido.pagamentoMotoboyStatus === "pago") {
      throw new Error("Essa entrega já foi paga ao motoboy. Faça ajuste manual no financeiro.");
    }

    if (pedido.pagamentoMotoboyEstornado === true || pedido.pagamentoMotoboyStatus === "estornado") {
      throw new Error("Essa entrega já foi estornada.");
    }

    const motoboyId = pedido.motoboyId || "";
    const restauranteId = pedido.restauranteId || "";

    if (!motoboyId) {
      throw new Error("Pedido sem motoboy vinculado.");
    }

    if (!restauranteId) {
      throw new Error("Pedido sem restaurante vinculado.");
    }

    const motoboyRef = doc(db, "motoboys", motoboyId);
    const restauranteRef = doc(db, "restaurantes", restauranteId);

    const motoboySnap = await transaction.get(motoboyRef);
    const restauranteSnap = await transaction.get(restauranteRef);

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy não encontrado.");
    }

    if (!restauranteSnap.exists()) {
      throw new Error("Restaurante não encontrado.");
    }

    const motoboy = motoboySnap.data();
    const restaurante = restauranteSnap.data();

    const valorMotoboy = Number(pedido.valorMotoboy || 0);
    const valorTotalRestaurante = Number(pedido.valorTotal || 0);

    if (valorMotoboy <= 0 || valorTotalRestaurante <= 0) {
      throw new Error("Valores inválidos para estorno.");
    }

    const saldoMotoboyAntes = Number(motoboy.saldo || 0);
    const saldoMotoboyDepois = Math.max(0, saldoMotoboyAntes - valorMotoboy);

    const saldoRestauranteAntes = Number(restaurante.saldoPrePago || 0);
    const saldoRestauranteDepois = saldoRestauranteAntes + valorTotalRestaurante;

    const ledgerMotoboyRef = doc(collection(db, "ledger_motoboy"));
    const ledgerRestauranteRef = doc(collection(db, "ledger_restaurante"));
    const notificacaoRef = doc(collection(db, "notificacoes_motoboy"));

    transaction.update(pedidoRef, {
      pagamentoMotoboyEstornado: true,
      pagamentoMotoboyStatus: "estornado",
      estornado: true,
      estornadoAt: serverTimestamp(),
      estornadoPor: uidAdmin,
      motivoEstorno: motivoEstorno || "Estorno administrativo",
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
      motoboyId,
      motoboyNome: pedido.motoboyNome || motoboy.nome || "",
      pedidoId,
      restauranteId,
      restauranteNome: pedido.restauranteNome || restaurante.nome || "",
      tipo: "estorno_entrega",
      valor: -valorMotoboy,
      saldoAntes: saldoMotoboyAntes,
      saldoDepois: saldoMotoboyDepois,
      motivo: motivoEstorno || "Estorno administrativo",
      statusPagamento: "estornado",
      pago: false,
      pagamentoId: null,
      createdAt: serverTimestamp(),
      criadoPor: uidAdmin
    });

    transaction.set(ledgerRestauranteRef, {
      restauranteId,
      restauranteNome: pedido.restauranteNome || restaurante.nome || "",
      pedidoId,
      tipo: "estorno_pedido",
      valor: valorTotalRestaurante,
      saldoAntes: saldoRestauranteAntes,
      saldoDepois: saldoRestauranteDepois,
      descricao: "Estorno de pedido entregue",
      motivo: motivoEstorno || "Estorno administrativo",
      createdAt: serverTimestamp(),
      criadoPor: uidAdmin
    });

    transaction.set(notificacaoRef, {
      motoboyId,
      motoboyNome: pedido.motoboyNome || motoboy.nome || "",
      pedidoId,
      tipo: "estorno_entrega",
      titulo: "Entrega estornada",
      mensagem: `A entrega do restaurante ${pedido.restauranteNome || "Restaurante"} foi estornada. O valor de ${dinheiro(valorMotoboy)} saiu dos seus ganhos.`,
      valor: valorMotoboy,
      motivo: motivoEstorno || "Estorno administrativo",
      lida: false,
      createdAt: serverTimestamp()
    });
  });
}
