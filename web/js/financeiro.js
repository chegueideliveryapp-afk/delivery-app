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

function statusTexto(status) {
  if (status === "aprovada") return "Aprovada";
  if (status === "recusada") return "Recusada";
  return "Pendente";
}

function classeStatus(status) {
  if (status === "aprovada") return "green";
  if (status === "recusada") return "red";
  return "yellow";
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Data não informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function textoSeguro(valor, fallback = "Não informado") {
  return valor || fallback;
}

function inicioSemanaAtual() {
  const hoje = new Date();
  const dia = hoje.getDay();
  const distanciaSegunda = dia === 0 ? -6 : 1 - dia;

  const segunda = new Date(hoje);
  segunda.setDate(hoje.getDate() + distanciaSegunda);
  segunda.setHours(0, 0, 0, 0);

  return segunda;
}

function fimSemanaAtual() {
  const inicio = inicioSemanaAtual();
  const fim = new Date(inicio);
  fim.setDate(inicio.getDate() + 6);
  fim.setHours(23, 59, 59, 999);

  return fim;
}

/* =========================================================
   RECARGAS RESTAURANTE
========================================================= */

export function carregarRecargasAdmin() {
  const lista = document.getElementById("listaRecargasAdmin");

  if (!lista) {
    console.error("Elemento listaRecargasAdmin não encontrado.");
    return;
  }

  lista.innerHTML = `<div class="empty">Buscando recargas...</div>`;

  const q = query(collection(db, "recargas_restaurante"));

  onSnapshot(
    q,
    (snapshot) => {
      lista.innerHTML = "";

      if (snapshot.empty) {
        lista.innerHTML = `<div class="empty">Nenhuma solicitação de recarga.</div>`;
        return;
      }

      const recargas = [];

      snapshot.forEach((docSnap) => {
        recargas.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      recargas.sort((a, b) => {
        const dataA = a.solicitadoAt?.toMillis?.() || 0;
        const dataB = b.solicitadoAt?.toMillis?.() || 0;
        return dataB - dataA;
      });

      recargas.forEach((recarga) => {
        const card = document.createElement("div");
        card.className = "list-card";

        const pendente = recarga.status === "pendente";

        card.innerHTML = `
          <div>
            <strong>${textoSeguro(recarga.restauranteNome, "Restaurante não informado")}</strong>

            <p>Valor: ${dinheiro(recarga.valor)}</p>

            <p>Status:
              <span class="badge ${classeStatus(recarga.status)}">
                ${statusTexto(recarga.status)}
              </span>
            </p>

            <p>Método: ${textoSeguro(recarga.metodo, "pix")}</p>
            <p>Chave Pix: ${textoSeguro(recarga.chavePixUsada)}</p>
            <p>Observação: ${recarga.observacao || "Sem observação"}</p>
            <p>Solicitada em: ${dataTexto(recarga.solicitadoAt)}</p>

            ${
              recarga.status === "aprovada"
                ? `<p>Aprovada em: ${dataTexto(recarga.aprovadoAt)}</p>`
                : ""
            }

            ${
              recarga.status === "recusada"
                ? `<p>Recusada em: ${dataTexto(recarga.recusadoAt)}</p>
                   <p>Motivo: ${recarga.motivoRecusa || "Sem motivo informado"}</p>`
                : ""
            }
          </div>

          <div class="actions">
            ${
              pendente
                ? `
                  <button data-action="aprovarRecarga" data-id="${recarga.id}">
                    Aprovar
                  </button>

                  <button data-action="recusarRecarga" data-id="${recarga.id}">
                    Recusar
                  </button>
                `
                : ""
            }
          </div>
        `;

        lista.appendChild(card);
      });

      lista.querySelectorAll("button[data-action='aprovarRecarga']").forEach((button) => {
        button.addEventListener("click", async () => {
          const recargaId = button.dataset.id;
          const confirmar = confirm("Confirmar aprovação desta recarga?");

          if (!confirmar) return;

          button.disabled = true;
          button.innerText = "Aprovando...";

          try {
            await aprovarRecarga(recargaId);
          } catch (erro) {
            console.error(erro);
            alert("Erro ao aprovar recarga.");
            button.disabled = false;
            button.innerText = "Aprovar";
          }
        });
      });

      lista.querySelectorAll("button[data-action='recusarRecarga']").forEach((button) => {
        button.addEventListener("click", async () => {
          const recargaId = button.dataset.id;
          const motivo = prompt("Informe o motivo da recusa:");

          if (motivo === null) return;

          button.disabled = true;
          button.innerText = "Recusando...";

          try {
            await recusarRecarga(recargaId, motivo.trim());
          } catch (erro) {
            console.error(erro);
            alert("Erro ao recusar recarga.");
            button.disabled = false;
            button.innerText = "Recusar";
          }
        });
      });
    },
    (erro) => {
      console.error("Erro ao carregar recargas:", erro);
      lista.innerHTML = `<div class="empty">Erro ao carregar recargas: ${erro.message}</div>`;
    }
  );
}

async function aprovarRecarga(recargaId) {
  const uidAdmin = auth.currentUser?.uid;

  if (!uidAdmin) {
    throw new Error("Admin não autenticado.");
  }

  const recargaRef = doc(db, "recargas_restaurante", recargaId);

  await runTransaction(db, async (transaction) => {
    const recargaSnap = await transaction.get(recargaRef);

    if (!recargaSnap.exists()) {
      throw new Error("Recarga não encontrada.");
    }

    const recarga = recargaSnap.data();

    if (recarga.status !== "pendente") {
      throw new Error("Recarga já processada.");
    }

    const restauranteRef = doc(db, "restaurantes", recarga.restauranteId);
    const restauranteSnap = await transaction.get(restauranteRef);

    if (!restauranteSnap.exists()) {
      throw new Error("Restaurante não encontrado.");
    }

    const restaurante = restauranteSnap.data();

    const valor = Number(recarga.valor || 0);

    if (!valor || valor <= 0) {
      throw new Error("Valor inválido.");
    }

    const saldoAntes = Number(restaurante.saldoPrePago || 0);
    const saldoDepois = saldoAntes + valor;

    const ledgerRef = doc(collection(db, "ledger_restaurante"));

    transaction.update(restauranteRef, {
      saldoPrePago: saldoDepois,
      updatedAt: serverTimestamp()
    });

    transaction.update(recargaRef, {
      status: "aprovada",
      aprovadoAt: serverTimestamp(),
      aprovadoPor: uidAdmin
    });

    transaction.set(ledgerRef, {
      restauranteId: recarga.restauranteId,
      restauranteNome: recarga.restauranteNome || restaurante.nome || "",
      tipo: "recarga",
      valor,
      saldoAntes,
      saldoDepois,
      recargaId,
      pedidoId: null,
      descricao: "Recarga Pix aprovada",
      createdAt: serverTimestamp(),
      criadoPor: uidAdmin
    });
  });
}

async function recusarRecarga(recargaId, motivo) {
  const uidAdmin = auth.currentUser?.uid;

  if (!uidAdmin) {
    throw new Error("Admin não autenticado.");
  }

  const recargaRef = doc(db, "recargas_restaurante", recargaId);

  await runTransaction(db, async (transaction) => {
    const recargaSnap = await transaction.get(recargaRef);

    if (!recargaSnap.exists()) {
      throw new Error("Recarga não encontrada.");
    }

    const recarga = recargaSnap.data();

    if (recarga.status !== "pendente") {
      throw new Error("Recarga já processada.");
    }

    transaction.update(recargaRef, {
      status: "recusada",
      recusadoAt: serverTimestamp(),
      recusadoPor: uidAdmin,
      motivoRecusa: motivo || "Sem motivo informado"
    });
  });
}

/* =========================================================
   PAGAMENTOS MOTOBOY
========================================================= */

export function carregarPagamentosMotoboyAdmin() {
  const lista = document.getElementById("listaPagamentosMotoboy");
  const resumo = document.getElementById("resumoPagamentosMotoboy");
  const historico = document.getElementById("historicoPagamentosMotoboy");

  if (!lista || !resumo || !historico) {
    console.error("Elementos da tela de pagamentos não encontrados.");
    return;
  }

  const estado = {
    motoboys: [],
    ledgers: [],
    pagamentos: []
  };

  function renderizarTudo() {
    renderizarResumoPagamentos(resumo, estado);
    renderizarListaPagamentos(lista, estado);
    renderizarHistoricoPagamentos(historico, estado);
  }

  onSnapshot(
    collection(db, "motoboys"),
    (snapshot) => {
      estado.motoboys = [];

      snapshot.forEach((docSnap) => {
        estado.motoboys.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error(erro);
      lista.innerHTML = `<div class="empty">Erro ao carregar motoboys.</div>`;
    }
  );

  onSnapshot(
    collection(db, "ledger_motoboy"),
    (snapshot) => {
      estado.ledgers = [];

      snapshot.forEach((docSnap) => {
        estado.ledgers.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error(erro);
      lista.innerHTML = `<div class="empty">Erro ao carregar ledger dos motoboys.</div>`;
    }
  );

  onSnapshot(
    collection(db, "pagamentos_motoboy"),
    (snapshot) => {
      estado.pagamentos = [];

      snapshot.forEach((docSnap) => {
        estado.pagamentos.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error(erro);
      historico.innerHTML = `<div class="empty">Erro ao carregar histórico de pagamentos.</div>`;
    }
  );
}

function renderizarResumoPagamentos(container, estado) {
  const ledgersAbertos = estado.ledgers.filter((l) => l.pago !== true);
  const totalAberto = ledgersAbertos.reduce((total, item) => {
    return total + Number(item.valor || 0);
  }, 0);

  const motoboysComSaldo = new Set(
    ledgersAbertos.map((item) => item.motoboyId)
  ).size;

  const entregasAbertas = ledgersAbertos.length;

  container.innerHTML = `
    <div class="list-card">
      <div>
        <strong>Total em aberto: ${dinheiro(totalAberto)}</strong>
        <p>Motoboys com saldo: ${motoboysComSaldo}</p>
        <p>Entregas ainda não pagas: ${entregasAbertas}</p>
        <p>Regra do negócio: pagamento toda segunda-feira.</p>
      </div>
    </div>
  `;
}

function renderizarListaPagamentos(container, estado) {
  const ledgersAbertos = estado.ledgers.filter((l) => l.pago !== true);

  if (!ledgersAbertos.length) {
    container.innerHTML = `<div class="empty">Nenhum pagamento em aberto.</div>`;
    return;
  }

  const porMotoboy = {};

  ledgersAbertos.forEach((ledger) => {
    const motoboyId = ledger.motoboyId;

    if (!porMotoboy[motoboyId]) {
      porMotoboy[motoboyId] = {
        motoboyId,
        motoboyNome: ledger.motoboyNome || "Motoboy não informado",
        total: 0,
        entregas: [],
        ledgerIds: []
      };
    }

    porMotoboy[motoboyId].total += Number(ledger.valor || 0);
    porMotoboy[motoboyId].entregas.push(ledger);
    porMotoboy[motoboyId].ledgerIds.push(ledger.id);
  });

  const grupos = Object.values(porMotoboy)
    .sort((a, b) => b.total - a.total);

  container.innerHTML = "";

  grupos.forEach((grupo) => {
    const motoboy = estado.motoboys.find((m) => m.id === grupo.motoboyId);
    const saldoAtual = Number(motoboy?.saldo || 0);

    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${grupo.motoboyNome}</strong>

        <p>Total a pagar: ${dinheiro(grupo.total)}</p>
        <p>Saldo atual no cadastro: ${dinheiro(saldoAtual)}</p>
        <p>Entregas em aberto: ${grupo.entregas.length}</p>

        <div class="status-row">
          <span class="badge yellow">Aguardando pagamento</span>
          <span class="badge gray">Pagamento semanal</span>
        </div>
      </div>

      <div class="actions">
        <button
          data-action="marcarPagoMotoboy"
          data-motoboy-id="${grupo.motoboyId}"
          data-ledgers="${grupo.ledgerIds.join(",")}"
        >
          Marcar como pago
        </button>
      </div>
    `;

    container.appendChild(card);
  });

  container.querySelectorAll("button[data-action='marcarPagoMotoboy']").forEach((button) => {
    button.addEventListener("click", async () => {
      const motoboyId = button.dataset.motoboyId;
      const ledgerIds = button.dataset.ledgers
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      const confirmar = confirm(
        "Confirmar pagamento deste motoboy?\n\nIsso vai zerar o saldo e marcar as entregas como pagas."
      );

      if (!confirmar) return;

      button.disabled = true;
      button.innerText = "Pagando...";

      try {
        await marcarMotoboyComoPago(motoboyId, ledgerIds);
        alert("Pagamento registrado com sucesso.");
      } catch (erro) {
        console.error(erro);
        alert(erro.message || "Erro ao registrar pagamento.");
        button.disabled = false;
        button.innerText = "Marcar como pago";
      }
    });
  });
}

function renderizarHistoricoPagamentos(container, estado) {
  if (!estado.pagamentos.length) {
    container.innerHTML = `<div class="empty">Nenhum pagamento registrado ainda.</div>`;
    return;
  }

  const pagamentos = [...estado.pagamentos].sort((a, b) => {
    const dataA = a.pagoAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
    const dataB = b.pagoAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
    return dataB - dataA;
  });

  container.innerHTML = "";

  pagamentos.forEach((pagamento) => {
    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${pagamento.motoboyNome || "Motoboy não informado"}</strong>

        <p>Valor pago: ${dinheiro(pagamento.valorTotalSemana)}</p>
        <p>Entregas pagas: ${pagamento.totalEntregas || 0}</p>
        <p>Início da semana: ${dataTexto(pagamento.inicioSemana)}</p>
        <p>Fim da semana: ${dataTexto(pagamento.fimSemana)}</p>
        <p>Pago em: ${dataTexto(pagamento.pagoAt)}</p>

        <div class="status-row">
          <span class="badge green">Pago</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

async function marcarMotoboyComoPago(motoboyId, ledgerIds) {
  const uidAdmin = auth.currentUser?.uid;

  if (!uidAdmin) {
    throw new Error("Admin não autenticado.");
  }

  if (!motoboyId) {
    throw new Error("Motoboy inválido.");
  }

  if (!ledgerIds.length) {
    throw new Error("Nenhuma entrega em aberto para pagar.");
  }

  const motoboyRef = doc(db, "motoboys", motoboyId);
  const pagamentoRef = doc(collection(db, "pagamentos_motoboy"));

  await runTransaction(db, async (transaction) => {
    const motoboySnap = await transaction.get(motoboyRef);

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy não encontrado.");
    }

    const motoboy = motoboySnap.data();

    const ledgers = [];

    for (const ledgerId of ledgerIds) {
      const ledgerRef = doc(db, "ledger_motoboy", ledgerId);
      const ledgerSnap = await transaction.get(ledgerRef);

      if (!ledgerSnap.exists()) continue;

      const ledger = ledgerSnap.data();

      if (ledger.motoboyId !== motoboyId) continue;
      if (ledger.pago === true) continue;

      ledgers.push({
        id: ledgerId,
        ref: ledgerRef,
        data: ledger
      });
    }

    if (!ledgers.length) {
      throw new Error("Não existem entregas pendentes para este motoboy.");
    }

    const valorTotal = ledgers.reduce((total, item) => {
      return total + Number(item.data.valor || 0);
    }, 0);

    if (!valorTotal || valorTotal <= 0) {
      throw new Error("Valor total inválido.");
    }

    transaction.set(pagamentoRef, {
      motoboyId,
      motoboyNome: motoboy.nome || ledgers[0].data.motoboyNome || "",
      valorTotalSemana: valorTotal,
      totalEntregas: ledgers.length,
      ledgerIds: ledgers.map((item) => item.id),
      pago: true,
      inicioSemana: inicioSemanaAtual(),
      fimSemana: fimSemanaAtual(),
      pagoAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      pagoPor: uidAdmin
    });

    ledgers.forEach((item) => {
      transaction.update(item.ref, {
        pago: true,
        semanaPagaId: pagamentoRef.id,
        pagoAt: serverTimestamp(),
        pagoPor: uidAdmin
      });
    });

    transaction.update(motoboyRef, {
      saldo: 0,
      updatedAt: serverTimestamp()
    });
  });
}
