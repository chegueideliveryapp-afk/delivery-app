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

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Não informado";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function statusTexto(status) {
  if (status === "pendente") return "Pendente";
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
  return "gray";
}

function pagamentoTexto(forma) {
  if (forma === "cartao") return "Cartão";
  if (forma === "dinheiro") return "Dinheiro";
  return "Pix";
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
    pedido.pagamentoMotoboyCreditado === true &&
    pedido.pagamentoMotoboyEstornado !== true
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

        card.innerHTML = `
          <div>
            <strong>${pedido.restauranteNome || "Restaurante não informado"}</strong>

            <div class="status-row">
              <span class="badge ${classeStatus(pedido.status)}">
                ${statusTexto(pedido.status)}
              </span>

              ${
                pedido.pagamentoMotoboyEstornado
                  ? `<span class="badge red">Pagamento estornado</span>`
                  : ""
              }
            </div>

            <p><b>Pedido:</b> ${pedido.id}</p>
            <p><b>Endereço:</b> ${pedido.enderecoEntrega || "Não informado"}</p>
            <p><b>Motoboy:</b> ${pedido.motoboyNome || pedido.motoboyId || "Ainda não aceito"}</p>
            <p><b>Pagamento:</b> ${pagamentoTexto(pedido.formaPagamento)}</p>
            <p><b>Retorno:</b> ${pedido.precisaRetorno ? "Sim" : "Não"}</p>
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
                ? `<button type="button" data-action="estornar" data-id="${pedido.id}">
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
          alert("Informe um motivo para registrar a correção.");
          return;
        }

        const confirmar = confirm(
          "Confirmar estorno? O valor será retirado do saldo do motoboy."
        );

        if (!confirmar) return;

        button.disabled = true;
        button.innerText = "Estornando...";

        try {
          await estornarEntregaMotoboy(pedidoId, motivo.trim());
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
    throw new Error("Admin não autenticado.");
  }

  const pedidoRef = doc(db, "pedidos", pedidoId);

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido não encontrado.");
    }

    const pedido = pedidoSnap.data();

    if (!pedido.motoboyId) {
      throw new Error("Pedido ainda não possui motoboy.");
    }

    if (!["aceito", "no_restaurante", "coletado", "no_cliente"].includes(pedido.status)) {
      throw new Error("Esse pedido não está em andamento.");
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
    throw new Error("Admin não autenticado.");
  }

  const pedidoRef = doc(db, "pedidos", pedidoId);
  const ledgerRef = doc(collection(db, "ledger_motoboy"));

  await runTransaction(db, async (transaction) => {
    const pedidoSnap = await transaction.get(pedidoRef);

    if (!pedidoSnap.exists()) {
      throw new Error("Pedido não encontrado.");
    }

    const pedido = pedidoSnap.data();

    if (pedido.status !== "entregue") {
      throw new Error("Somente entregas finalizadas podem ser estornadas.");
    }

    if (!pedido.motoboyId) {
      throw new Error("Pedido sem motoboy vinculado.");
    }

    if (pedido.pagamentoMotoboyEstornado === true) {
      throw new Error("Essa entrega já foi estornada.");
    }

    const motoboyRef = doc(db, "motoboys", pedido.motoboyId);
    const motoboySnap = await transaction.get(motoboyRef);

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy não encontrado.");
    }

    const motoboy = motoboySnap.data();

    const valorMotoboy = Number(pedido.valorMotoboy || 0);
    const saldoAntes = Number(motoboy.saldo || 0);
    const saldoDepois = Number((saldoAntes - valorMotoboy).toFixed(2));
    const totalEntregasAntes = Number(motoboy.totalEntregas || 0);
    const totalEntregasDepois = Math.max(0, totalEntregasAntes - 1);

    transaction.update(motoboyRef, {
      saldo: saldoDepois,
      totalEntregas: totalEntregasDepois,
      updatedAt: serverTimestamp()
    });

    transaction.update(pedidoRef, {
      pagamentoMotoboyEstornado: true,
      statusFinanceiroMotoboy: "estornado",
      estornadoAt: serverTimestamp(),
      estornadoPor: adminId,
      motivoEstorno: motivo,
      updatedAt: serverTimestamp()
    });

    transaction.set(ledgerRef, {
      motoboyId: pedido.motoboyId,
      motoboyNome: pedido.motoboyNome || motoboy.nome || "",
      pedidoId,
      restauranteId: pedido.restauranteId || "",
      restauranteNome: pedido.restauranteNome || "",
      tipo: "estorno_entrega",
      valor: -valorMotoboy,
      saldoAntes,
      saldoDepois,
      motivo,
      descricao: "Estorno administrativo de entrega finalizada",
      criadoPor: adminId,
      createdAt: serverTimestamp()
    });
  });
}
