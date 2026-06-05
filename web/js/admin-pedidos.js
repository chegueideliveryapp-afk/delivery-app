import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function numero(valor, padrao = 0) {
  const n = Number(valor || padrao);
  return Number.isFinite(n) ? n : padrao;
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Nao informado";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function statusTexto(status) {
  if (status === "pendente") return "Pendente";
  if (status === "buscando_motoboy") return "Buscando motoboy";
  if (status === "aceito") return "Aceito";
  if (status === "no_restaurante") return "No restaurante";
  if (status === "coletado") return "Coletado";
  if (status === "no_cliente") return "No cliente";
  if (status === "entregue") return "Entregue";
  if (status === "sem_motoboy") return "Sem motoboy";
  if (status === "cancelado") return "Cancelado";
  return status || "Sem status";
}

function classeStatus(status) {
  if (status === "entregue") return "green";
  if (status === "cancelado") return "red";
  if (status === "sem_motoboy") return "red";
  if (status === "pendente") return "yellow";
  if (status === "buscando_motoboy") return "yellow";
  if (status === "aceito") return "gray";
  return "gray";
}

function pagamentoTexto(forma) {
  if (forma === "cartao") return "Cartao";
  if (forma === "dinheiro") return "Dinheiro";
  return "Pix";
}

function pedidoFoiEstornado(pedido) {
  return (
    pedido.estornado === true ||
    pedido.pagamentoMotoboyEstornado === true ||
    pedido.pagamentoMotoboyStatus === "estornado" ||
    pedido.statusFinanceiroMotoboy === "estornado"
  );
}

function pedidoFoiPagoAoMotoboy(pedido) {
  return (
    pedido.pagamentoMotoboyPago === true ||
    pedido.pagamentoMotoboyStatus === "pago" ||
    pedido.statusFinanceiroMotoboy === "pago"
  );
}

function podeLiberarParaOutroMotoboy(pedido) {
  return (
    pedido.motoboyId &&
    ["aceito", "no_restaurante", "coletado", "no_cliente"].includes(pedido.status)
  );
}

function podeEstornarEntrega(pedido) {
  return (
    pedido.status === "entregue" &&
    pedido.motoboyId &&
    !pedidoFoiEstornado(pedido)
  );
}

export function carregarPedidosAdmin() {
  const lista = document.getElementById("listaPedidosAdmin");

  if (!lista) return;

  lista.innerHTML = `<div class="empty">Carregando pedidos...</div>`;

  const q = query(collection(db, "pedidos"));

  onSnapshot(
    q,
    (snapshot) => {
      const pedidos = [];

      snapshot.forEach((docSnap) => {
        pedidos.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      pedidos.sort((a, b) => {
        const dataA = a.createdAt?.toMillis?.() || 0;
        const dataB = b.createdAt?.toMillis?.() || 0;
        return dataB - dataA;
      });

      if (!pedidos.length) {
        lista.innerHTML = `<div class="empty">Nenhum pedido criado.</div>`;
        return;
      }

      lista.innerHTML = "";

      pedidos.forEach((pedido) => {
        const card = document.createElement("div");
        card.className = "list-card";

        const estornado = pedidoFoiEstornado(pedido);
        const pagoAoMotoboy = pedidoFoiPagoAoMotoboy(pedido);

        card.innerHTML = `
          <div>
            <strong>${pedido.restauranteNome || "Restaurante nao informado"}</strong>

            <div class="status-row">
              <span class="badge ${classeStatus(pedido.status)}">
                ${statusTexto(pedido.status)}
              </span>

              ${
                estornado
                  ? `<span class="badge red">Pagamento estornado</span>`
                  : ""
              }

              ${
                pagoAoMotoboy
                  ? `<span class="badge green">Motoboy pago</span>`
                  : ""
              }
            </div>

            <p><b>Pedido:</b> ${pedido.id}</p>
            <p><b>Endereco:</b> ${pedido.enderecoEntrega || "Nao informado"}</p>
            <p><b>Motoboy:</b> ${pedido.motoboyNome || pedido.motoboyId || "Ainda nao aceito"}</p>
            <p><b>Pagamento:</b> ${pagamentoTexto(pedido.formaPagamento)}</p>
            <p><b>Retorno:</b> ${pedido.precisaRetorno ? "Sim" : "Nao"}</p>

            ${
              pedido.valorTroco
                ? `<p><b>Troco:</b> ${dinheiro(pedido.valorTroco)}</p>`
                : ""
            }

            <p><b>Valor motoboy:</b> ${dinheiro(pedido.valorMotoboy)}</p>
            <p><b>Taxa Cheguei:</b> ${dinheiro(pedido.taxaSistema)}</p>
            <p><b>Taxa retorno:</b> ${dinheiro(pedido.taxaRetornoMotoboy)}</p>
            <p><b>Total cobrado do restaurante:</b> ${dinheiro(pedido.valorTotal)}</p>
            <p><b>Criado em:</b> ${dataTexto(pedido.createdAt)}</p>

            ${
              pedido.aceitoAt
                ? `<p><b>Aceito em:</b> ${dataTexto(pedido.aceitoAt)}</p>`
                : ""
            }

            ${
              pedido.noRestauranteAt
                ? `<p><b>Chegou no restaurante:</b> ${dataTexto(pedido.noRestauranteAt)}</p>`
                : ""
            }

            ${
              pedido.coletadoAt
                ? `<p><b>Coletado em:</b> ${dataTexto(pedido.coletadoAt)}</p>`
                : ""
            }

            ${
              pedido.noClienteAt
                ? `<p><b>Chegou no cliente:</b> ${dataTexto(pedido.noClienteAt)}</p>`
                : ""
            }

            ${
              pedido.entregueAt
                ? `<p><b>Entregue em:</b> ${dataTexto(pedido.entregueAt)}</p>`
                : ""
            }

            ${
              pedido.estornadoAt
                ? `<p><b>Estornado em:</b> ${dataTexto(pedido.estornadoAt)}</p>`
                : ""
            }

            ${
              pedido.motivoEstorno
                ? `<p><b>Motivo do estorno:</b> ${pedido.motivoEstorno}</p>`
                : ""
            }
          </div>

          <div class="actions">
            ${
              podeLiberarParaOutroMotoboy(pedido)
                ? `<button type="button" data-action="liberar" data-id="${pedido.id}">
                    Liberar para outro motoboy
                  </button>`
                : ""
            }

            ${
              podeEstornarEntrega(pedido)
                ? `<button type="button" class="danger-btn" data-action="estornar" data-id="${pedido.id}">
                    Estornar entrega
                  </button>`
                : ""
            }
          </div>
        `;

        lista.appendChild(card);
      });

      configurarAcoesPedidos();
    },
    (erro) => {
      console.error(erro);
      lista.innerHTML = `<div class="empty">Erro ao carregar pedidos: ${erro.message}</div>`;
    }
  );
}

function configurarAcoesPedidos() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const pedidoId = button.dataset.id;

      if (action === "liberar") {
        const confirmar = confirm(
          "Deseja retirar esse pedido do motoboy atual e liberar para outro motoboy?"
        );

        if (!confirmar) return;

        button.disabled = true;
        button.innerText = "Liberando...";

        try {
          await liberarParaOutroMotoboy(pedidoId);
        } catch (erro) {
          console.error(erro);
          alert(erro.message || "Erro ao liberar pedido.");
          button.disabled = false;
          button.innerText = "Liberar para outro motoboy";
        }
      }

      if (action === "estornar") {
        const motivo = prompt(
          "Informe o motivo do estorno. Ex: motoboy finalizou sem coletar ou sem entregar."
        );

        if (motivo === null) return;

        if (!motivo.trim()) {
          alert("Informe um motivo para registrar a correcao.");
          return;
        }

        const confirmar = confirm(
          "Confirmar estorno desta entrega?\n\n" +
          "O valor sera retirado dos ganhos do motoboy e o total cobrado sera devolvido ao saldo do restaurante."
        );

        if (!confirmar) return;

        button.disabled = true;
        button.innerText = "Estornando...";

        try {
          await estornarEntregaMotoboy(pedidoId, motivo.trim());
          alert("Entrega estornada com sucesso.");
        } catch (erro) {
          console.error(erro);
          alert(erro.message || "Erro ao estornar entrega.");
          button.disabled = false;
          button.innerText = "Estornar entrega";
        }
      }
    });
  });
}

async function liberarParaOutroMotoboy(pedidoId) {
  const adminId = auth.currentUser?.uid;

  if (!adminId) {
    throw new Error("Admin nao autenticado.");
  }

  const pedidoRef = doc(db, "pedidos", pedidoId);

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido nao encontrado.");
    }

    const pedido = pedidoSnap.data();

    if (!pedido.motoboyId) {
      throw new Error("Pedido ainda nao possui motoboy.");
    }

    if (!["aceito", "no_restaurante", "coletado", "no_cliente"].includes(pedido.status)) {
      throw new Error("Esse pedido nao esta em andamento.");
    }

    const recusadoPor = pedido.recusadoPor || [];
    const novoRecusadoPor = recusadoPor.includes(pedido.motoboyId)
      ? recusadoPor
      : [...recusadoPor, pedido.motoboyId];

    transaction.update(pedidoRef, {
      status: "pendente",
      motoboyId: "",
      motoboyNome: "",
      recusadoPor: novoRecusadoPor,
      liberadoPorAdmin: true,
      liberadoPorAdminAt: serverTimestamp(),
      liberadoPorAdminId: adminId,
      updatedAt: serverTimestamp()
    });
  });
}

async function estornarEntregaMotoboy(pedidoId, motivo) {
  const adminId = auth.currentUser?.uid;

  if (!adminId) {
    throw new Error("Admin nao autenticado.");
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

    if (!pedido.motoboyId) {
      throw new Error("Pedido sem motoboy vinculado.");
    }

    if (!pedido.restauranteId) {
      throw new Error("Pedido sem restaurante vinculado.");
    }

    if (pedidoFoiEstornado(pedido)) {
      throw new Error("Essa entrega ja foi estornada.");
    }

    if (pedidoFoiPagoAoMotoboy(pedido)) {
      throw new Error("Essa entrega ja foi marcada como paga ao motoboy. Faca ajuste manual antes de estornar.");
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
    const saldoMotoboyDepois = Math.max(
      0,
      Number((saldoMotoboyAntes - valorMotoboy).toFixed(2))
    );

    const saldoRestauranteAntes = numero(restaurante.saldoPrePago, 0);
    const saldoRestauranteDepois = Number((saldoRestauranteAntes + valorTotal).toFixed(2));

    const totalEntregasAntes = numero(motoboy.totalEntregas, 0);
    const totalEntregasDepois = Math.max(0, totalEntregasAntes - 1);

    const ledgerMotoboyRef = doc(collection(db, "ledger_motoboy"));
    const ledgerRestauranteRef = doc(collection(db, "ledger_restaurante"));
    const notificacaoRef = doc(collection(db, "notificacoes_motoboy"));

    transaction.update(motoboyRef, {
      saldo: saldoMotoboyDepois,
      totalEntregas: totalEntregasDepois,
      updatedAt: serverTimestamp()
    });

    transaction.update(restauranteRef, {
      saldoPrePago: saldoRestauranteDepois,
      updatedAt: serverTimestamp()
    });

    transaction.update(pedidoRef, {
      estornado: true,
      pagamentoMotoboyEstornado: true,
      pagamentoMotoboyStatus: "estornado",
      statusFinanceiroMotoboy: "estornado",
      estornadoAt: serverTimestamp(),
      estornadoPor: adminId,
      motivoEstorno: motivo,
      updatedAt: serverTimestamp()
    });

    transaction.set(ledgerMotoboyRef, {
      motoboyId: pedido.motoboyId,
      motoboyNome: pedido.motoboyNome || motoboy.nome || "",
      pedidoId,
      restauranteId: pedido.restauranteId || "",
      restauranteNome: pedido.restauranteNome || "",
      tipo: "estorno_entrega",
      valor: -valorMotoboy,
      saldoAntes: saldoMotoboyAntes,
      saldoDepois: saldoMotoboyDepois,
      pago: true,
      estorno: true,
      motivo,
      descricao: "Estorno administrativo de entrega finalizada",
      criadoPor: adminId,
      createdAt: serverTimestamp()
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
      motivo,
      descricao: "Valor devolvido ao restaurante por estorno de entrega",
      criadoPor: adminId,
      createdAt: serverTimestamp()
    });

    transaction.set(notificacaoRef, {
      motoboyId: pedido.motoboyId,
      pedidoId,
      tipo: "estorno_entrega",
      titulo: "Entrega estornada",
      mensagem: `A entrega do restaurante ${pedido.restauranteNome || "Restaurante"} foi estornada pela administracao. O valor saiu dos seus ganhos em aberto.`,
      valor: valorMotoboy,
      motivo,
      lida: false,
      createdAt: serverTimestamp()
    });
  });
}
