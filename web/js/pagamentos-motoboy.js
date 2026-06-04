import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const estado = {
  motoboys: [],
  ledgers: [],
  pagamentos: []
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

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function dataTexto(timestampOuDate) {
  if (timestampOuDate?.toDate) {
    return timestampOuDate.toDate().toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    });
  }

  if (timestampOuDate instanceof Date) {
    return timestampOuDate.toLocaleDateString("pt-BR");
  }

  return "Data não informada";
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

function preencherDatasPadrao() {
  const inicioInput = document.getElementById("inicioPagamento");
  const fimInput = document.getElementById("fimPagamento");

  if (!inicioInput || !fimInput) return;

  if (!inicioInput.value) {
    inicioInput.value = inicioSemanaAtual().toISOString().slice(0, 10);
  }

  if (!fimInput.value) {
    fimInput.value = fimSemanaAtual().toISOString().slice(0, 10);
  }
}

function obterPeriodo() {
  const inicioInput = document.getElementById("inicioPagamento")?.value;
  const fimInput = document.getElementById("fimPagamento")?.value;

  const inicio = inicioInput
    ? new Date(`${inicioInput}T00:00:00`)
    : inicioSemanaAtual();

  const fim = fimInput
    ? new Date(`${fimInput}T23:59:59`)
    : fimSemanaAtual();

  return { inicio, fim };
}

function dentroDoPeriodo(timestamp, inicio, fim) {
  if (!timestamp?.toDate) return false;

  const data = timestamp.toDate();

  return data >= inicio && data <= fim;
}

function obterGruposPorMotoboy() {
  const { inicio, fim } = obterPeriodo();
  const busca = normalizarTexto(
    document.getElementById("buscaMotoboyPagamento")?.value
  );

  const ledgersAbertosPeriodo = estado.ledgers.filter((ledger) => {
    return ledger.pago !== true
      && ledger.tipo === "entrega"
      && dentroDoPeriodo(ledger.createdAt, inicio, fim);
  });

  const grupos = {};

  ledgersAbertosPeriodo.forEach((ledger) => {
    const motoboyId = ledger.motoboyId;

    if (!motoboyId) return;

    const motoboyCadastro = estado.motoboys.find((m) => m.id === motoboyId);

    const nome = ledger.motoboyNome || motoboyCadastro?.nome || "Motoboy não informado";
    const cpf = motoboyCadastro?.cpf || "";
    const telefone = motoboyCadastro?.telefone || "";

    const textoBusca = normalizarTexto(`${nome} ${cpf} ${telefone}`);

    if (busca && !textoBusca.includes(busca)) return;

    if (!grupos[motoboyId]) {
      grupos[motoboyId] = {
        motoboyId,
        motoboyNome: nome,
        cpf,
        telefone,
        saldoAtual: Number(motoboyCadastro?.saldo || 0),
        total: 0,
        entregas: [],
        ledgerIds: []
      };
    }

    grupos[motoboyId].total += Number(ledger.valor || 0);
    grupos[motoboyId].entregas.push(ledger);
    grupos[motoboyId].ledgerIds.push(ledger.id);
  });

  return Object.values(grupos).sort((a, b) => b.total - a.total);
}

function renderizarResumo() {
  const grupos = obterGruposPorMotoboy();

  const totalPagar = grupos.reduce((total, grupo) => {
    return total + Number(grupo.total || 0);
  }, 0);

  const totalEntregas = grupos.reduce((total, grupo) => {
    return total + grupo.entregas.length;
  }, 0);

  const totalPix = grupos.length;

  const { inicio, fim } = obterPeriodo();

  setHtml(
    "resumoPagamentosMotoboy",
    `
      <div class="list-card">
        <div>
          <strong>Total a pagar: ${dinheiro(totalPagar)}</strong>
          <p>Período: ${dataTexto(inicio)} até ${dataTexto(fim)}</p>
          <p>Total de motoboys a pagar: ${totalPix}</p>
          <p>Total de Pix necessários: ${totalPix}</p>
          <p>Total de entregas no fechamento: ${totalEntregas}</p>

          <div class="status-row">
            <span class="badge yellow">Fechamento agrupado</span>
            <span class="badge gray">1 Pix por motoboy</span>
          </div>
        </div>
      </div>
    `
  );
}

function renderizarListaPagamentos() {
  const grupos = obterGruposPorMotoboy();
  const { inicio, fim } = obterPeriodo();

  if (!grupos.length) {
    setHtml(
      "listaPagamentosMotoboy",
      `<div class="empty">Nenhum pagamento em aberto para o período selecionado.</div>`
    );
    return;
  }

  const html = grupos.map((grupo) => {
    const entregasOrdenadas = [...grupo.entregas].sort((a, b) => {
      const dataA = a.createdAt?.toMillis?.() || 0;
      const dataB = b.createdAt?.toMillis?.() || 0;
      return dataA - dataB;
    });

    const detalhesEntregas = entregasOrdenadas.map((entrega, index) => {
      return `
        <p>
          ${index + 1}. ${dataTexto(entrega.createdAt)}
          - ${entrega.restauranteNome || "Restaurante"}
          - ${dinheiro(entrega.valor)}
        </p>
      `;
    }).join("");

    return `
      <div class="list-card">
        <div>
          <strong>${grupo.motoboyNome}</strong>

          <p>Período: ${dataTexto(inicio)} até ${dataTexto(fim)}</p>
          <p>Total a pagar neste Pix: ${dinheiro(grupo.total)}</p>
          <p>Quantidade de entregas: ${grupo.entregas.length}</p>
          <p>Saldo atual no cadastro: ${dinheiro(grupo.saldoAtual)}</p>
          <p>CPF: ${grupo.cpf || "Não informado"}</p>
          <p>Telefone: ${grupo.telefone || "Não informado"}</p>

          <div class="status-row">
            <span class="badge yellow">Aguardando pagamento</span>
            <span class="badge gray">Pix único</span>
          </div>

          <div style="margin-top: 12px;">
            <strong style="font-size: 15px;">Entregas incluídas:</strong>
            ${detalhesEntregas}
          </div>
        </div>

        <div class="actions">
          <button
            data-action="marcarPagoMotoboy"
            data-motoboy-id="${grupo.motoboyId}"
            data-ledgers="${grupo.ledgerIds.join(",")}"
          >
            Marcar Pix como pago
          </button>
        </div>
      </div>
    `;
  }).join("");

  setHtml("listaPagamentosMotoboy", html);

  document.querySelectorAll("button[data-action='marcarPagoMotoboy']").forEach((button) => {
    button.addEventListener("click", async () => {
      const motoboyId = button.dataset.motoboyId;
      const ledgerIds = button.dataset.ledgers
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      const confirmar = confirm(
        "Confirmar pagamento agrupado deste motoboy?\n\nSerá registrado 1 pagamento/Pix para todas as entregas listadas."
      );

      if (!confirmar) return;

      button.disabled = true;
      button.innerText = "Registrando Pix...";

      try {
        await marcarMotoboyComoPago(motoboyId, ledgerIds);
        alert("Pagamento agrupado registrado com sucesso.");
      } catch (erro) {
        console.error(erro);
        alert(erro.message || "Erro ao registrar pagamento.");
        button.disabled = false;
        button.innerText = "Marcar Pix como pago";
      }
    });
  });
}

function renderizarHistorico() {
  if (!estado.pagamentos.length) {
    setHtml(
      "historicoPagamentosMotoboy",
      `<div class="empty">Nenhum pagamento registrado ainda.</div>`
    );
    return;
  }

  const pagamentos = [...estado.pagamentos].sort((a, b) => {
    const dataA = a.pagoAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
    const dataB = b.pagoAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
    return dataB - dataA;
  });

  const html = pagamentos.map((pagamento) => {
    return `
      <div class="list-card">
        <div>
          <strong>${pagamento.motoboyNome || "Motoboy não informado"}</strong>

          <p>Valor pago: ${dinheiro(pagamento.valorTotalSemana)}</p>
          <p>Entregas pagas: ${pagamento.totalEntregas || 0}</p>
          <p>Período: ${dataTexto(pagamento.inicioSemana)} até ${dataTexto(pagamento.fimSemana)}</p>
          <p>Pago em: ${dataTexto(pagamento.pagoAt)}</p>

          <div class="status-row">
            <span class="badge green">Pago</span>
            <span class="badge gray">Pix agrupado</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  setHtml("historicoPagamentosMotoboy", html);
}

function renderizarTudo() {
  renderizarResumo();
  renderizarListaPagamentos();
  renderizarHistorico();
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

  const { inicio, fim } = obterPeriodo();

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
      if (ledger.tipo !== "entrega") continue;
      if (!dentroDoPeriodo(ledger.createdAt, inicio, fim)) continue;

      ledgers.push({
        id: ledgerId,
        ref: ledgerRef,
        data: ledger
      });
    }

    if (!ledgers.length) {
      throw new Error("Não existem entregas pendentes para este motoboy neste período.");
    }

    const valorTotal = ledgers.reduce((total, item) => {
      return total + Number(item.data.valor || 0);
    }, 0);

    if (!valorTotal || valorTotal <= 0) {
      throw new Error("Valor total inválido.");
    }

    const saldoAtual = Number(motoboy.saldo || 0);
    const saldoDepois = Math.max(0, saldoAtual - valorTotal);

    transaction.set(pagamentoRef, {
      motoboyId,
      motoboyNome: motoboy.nome || ledgers[0].data.motoboyNome || "",
      valorTotalSemana: valorTotal,
      totalEntregas: ledgers.length,
      ledgerIds: ledgers.map((item) => item.id),
      pago: true,
      formaPagamento: "pix",
      agrupado: true,
      inicioSemana: inicio,
      fimSemana: fim,
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
      saldo: saldoDepois,
      updatedAt: serverTimestamp()
    });
  });
}

function configurarFiltros() {
  preencherDatasPadrao();

  const btn = document.getElementById("btnAplicarPagamento");
  const busca = document.getElementById("buscaMotoboyPagamento");
  const inicio = document.getElementById("inicioPagamento");
  const fim = document.getElementById("fimPagamento");

  if (btn) {
    btn.addEventListener("click", renderizarTudo);
  }

  [busca, inicio, fim].forEach((el) => {
    if (!el) return;

    el.addEventListener("input", renderizarTudo);
    el.addEventListener("change", renderizarTudo);
  });
}

function escutarColecao(nomeColecao, chaveEstado) {
  onSnapshot(
    collection(db, nomeColecao),
    (snapshot) => {
      estado[chaveEstado] = [];

      snapshot.forEach((docSnap) => {
        estado[chaveEstado].push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error(`Erro ao carregar ${nomeColecao}:`, erro);
    }
  );
}

export function carregarPagamentosMotoboyAdmin() {
  setHtml("resumoPagamentosMotoboy", `<div class="empty">Carregando resumo financeiro...</div>`);
  setHtml("listaPagamentosMotoboy", `<div class="empty">Carregando pagamentos...</div>`);
  setHtml("historicoPagamentosMotoboy", `<div class="empty">Carregando histórico...</div>`);

  configurarFiltros();

  escutarColecao("motoboys", "motoboys");
  escutarColecao("ledger_motoboy", "ledgers");
  escutarColecao("pagamentos_motoboy", "pagamentos");
}
