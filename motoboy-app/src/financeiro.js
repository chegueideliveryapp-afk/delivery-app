import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let uid = null;
let pedidosCache = [];
let pagamentosCache = [];
let ledgerCache = [];

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function numero(valor, padrao = 0) {
  const n = Number(valor ?? padrao);
  return Number.isFinite(n) ? n : padrao;
}

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Não informado";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function dataDoPedido(pedido) {
  return (
    pedido.entregueAt?.toDate?.() ||
    pedido.updatedAt?.toDate?.() ||
    pedido.createdAt?.toDate?.() ||
    null
  );
}

function inicioSemana(dataReferencia = new Date()) {
  const data = new Date(dataReferencia);
  const dia = data.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;

  data.setDate(data.getDate() + diff);
  data.setHours(0, 0, 0, 0);

  return data;
}

function fimSemana(dataReferencia = new Date()) {
  const inicio = inicioSemana(dataReferencia);
  const fim = new Date(inicio);

  fim.setDate(inicio.getDate() + 6);
  fim.setHours(23, 59, 59, 999);

  return fim;
}

function proximaSegundaTexto() {
  const hoje = new Date();
  const dia = hoje.getDay();
  const dias = dia === 1 ? 7 : (8 - dia) % 7 || 7;

  const proxima = new Date(hoje);
  proxima.setDate(hoje.getDate() + dias);
  proxima.setHours(0, 0, 0, 0);

  return proxima.toLocaleDateString("pt-BR");
}

function pedidoDentroDaSemanaAtual(pedido) {
  const data = dataDoPedido(pedido);

  if (!data) return false;

  return data >= inicioSemana() && data <= fimSemana();
}

function pedidoFoiEstornado(pedido) {
  return (
    pedido.estornado === true ||
    pedido.pagamentoMotoboyEstornado === true ||
    pedido.pagamentoMotoboyStatus === "estornado" ||
    pedido.statusFinanceiroMotoboy === "estornado"
  );
}

function pagamentoTemPedido(pagamento, pedidoId) {
  if (Array.isArray(pagamento.pedidoIds) && pagamento.pedidoIds.includes(pedidoId)) {
    return true;
  }

  if (pagamento.pedidoId === pedidoId) {
    return true;
  }

  return false;
}

function ledgerDoPedido(pedidoId) {
  return ledgerCache.filter((ledger) => ledger.pedidoId === pedidoId);
}

function ledgerFoiPago(ledger) {
  return (
    ledger.statusPagamento === "pago" ||
    ledger.pago === true ||
    Boolean(ledger.pagamentoId)
  );
}

function pedidoFoiPagoPorLedger(pedido) {
  const ledgers = ledgerDoPedido(pedido.id);
  return ledgers.some(ledgerFoiPago);
}

function pedidoFoiPagoPorPagamento(pedido) {
  return pagamentosCache.some((pagamento) => {
    const pagamentoValido =
      pagamento.status === "pago" ||
      pagamento.pago === true ||
      pagamento.pagoAt;

    if (!pagamentoValido) return false;

    return pagamentoTemPedido(pagamento, pedido.id);
  });
}

function pedidoFoiPago(pedido) {
  return (
    pedido.pagamentoMotoboyPago === true ||
    pedido.pagamentoMotoboyStatus === "pago" ||
    Boolean(pedido.pagamentoMotoboyId) ||
    pedidoFoiPagoPorPagamento(pedido) ||
    pedidoFoiPagoPorLedger(pedido)
  );
}

function pedidoEntregueDoMotoboy(pedido) {
  return (
    pedido.status === "entregue" &&
    pedido.motoboyId === uid &&
    numero(pedido.valorMotoboy, 0) > 0
  );
}

function pedidoAbertoParaReceber(pedido) {
  return (
    pedidoEntregueDoMotoboy(pedido) &&
    pedidoDentroDaSemanaAtual(pedido) &&
    !pedidoFoiEstornado(pedido) &&
    !pedidoFoiPago(pedido)
  );
}

function pedidoPagoValido(pedido) {
  return (
    pedidoEntregueDoMotoboy(pedido) &&
    !pedidoFoiEstornado(pedido) &&
    pedidoFoiPago(pedido)
  );
}

function pedidoValidoParaMedia(pedido) {
  return (
    pedidoEntregueDoMotoboy(pedido) &&
    !pedidoFoiEstornado(pedido)
  );
}

function valorPagamento(pagamento) {
  return numero(
    pagamento.valorTotal ??
    pagamento.valorTotalSemana ??
    pagamento.valorPago ??
    pagamento.valor,
    0
  );
}

function totalEntregasPagamento(pagamento) {
  if (Array.isArray(pagamento.pedidoIds)) return pagamento.pedidoIds.length;

  return numero(
    pagamento.totalEntregas ??
    pagamento.entregas,
    0
  );
}

function pagamentoDentroDoFiltro(pagamento) {
  const filtro = document.getElementById("filtroHistoricoPagamentos")?.value || "todos";
  const dataPagamento =
    pagamento.pagoAt?.toDate?.() ||
    pagamento.createdAt?.toDate?.() ||
    null;

  if (!dataPagamento) return true;

  if (filtro === "todos") return true;

  if (filtro === "semanaAtual") {
    return dataPagamento >= inicioSemana() && dataPagamento <= fimSemana();
  }

  if (filtro === "ultimos30") {
    const limite = new Date();
    limite.setDate(limite.getDate() - 30);
    limite.setHours(0, 0, 0, 0);

    return dataPagamento >= limite;
  }

  if (filtro === "semanaSelecionada") {
    const valor = document.getElementById("semanaHistorico")?.value;

    if (!valor) return true;

    const dataEscolhida = new Date(`${valor}T00:00:00`);

    return (
      dataPagamento >= inicioSemana(dataEscolhida) &&
      dataPagamento <= fimSemana(dataEscolhida)
    );
  }

  return true;
}

function renderizarResumo() {
  const entregasAbertasSemana = pedidosCache.filter(pedidoAbertoParaReceber);
  const entregasPagas = pedidosCache.filter(pedidoPagoValido);
  const entregasValidas = pedidosCache.filter(pedidoValidoParaMedia);

  const valorAbertoSemana = entregasAbertasSemana.reduce((acc, pedido) => {
    return acc + numero(pedido.valorMotoboy, 0);
  }, 0);

  const pagamentosValidos = pagamentosCache.filter((pagamento) => {
    return pagamento.status === "pago" || pagamento.pago === true || pagamento.pagoAt;
  });

  const totalRecebido = pagamentosValidos.reduce((acc, pagamento) => {
    return acc + valorPagamento(pagamento);
  }, 0);

  const somaEntregasValidas = entregasValidas.reduce((acc, pedido) => {
    return acc + numero(pedido.valorMotoboy, 0);
  }, 0);

  const media = entregasValidas.length > 0
    ? somaEntregasValidas / entregasValidas.length
    : 0;

  const maiorEntrega = entregasValidas.reduce((maior, pedido) => {
    return Math.max(maior, numero(pedido.valorMotoboy, 0));
  }, 0);

  const ganhosSemana = entregasValidas
    .filter(pedidoDentroDaSemanaAtual)
    .reduce((acc, pedido) => acc + numero(pedido.valorMotoboy, 0), 0);

  const percentual = maiorEntrega > 0
    ? Math.min(100, (ganhosSemana / Math.max(maiorEntrega * 10, 1)) * 100)
    : 0;

  setText("valorAbertoMotoboy", dinheiro(valorAbertoSemana));
  setText("proximoPagamento", proximaSegundaTexto());
  setText("totalRecebidoMotoboy", dinheiro(totalRecebido));
  setText("mediaEntregaMotoboy", dinheiro(media));
  setText("totalEntregasAbertas", entregasAbertasSemana.length);
  setText("totalEntregasPagas", entregasPagas.length);
  setText("ritmoGanhosTexto", `${dinheiro(ganhosSemana)} esta semana`);
  setText("maiorEntregaTexto", dinheiro(maiorEntrega));

  const barra = document.getElementById("barraGanhosSemana");
  if (barra) barra.style.width = `${percentual}%`;
}

function renderizarEntregasAReceber() {
  const entregas = pedidosCache
    .filter(pedidoAbertoParaReceber)
    .sort((a, b) => {
      const dataA = dataDoPedido(a)?.getTime?.() || 0;
      const dataB = dataDoPedido(b)?.getTime?.() || 0;
      return dataB - dataA;
    });

  if (!entregas.length) {
    setHtml(
      "listaEntregasAReceber",
      `<div class="empty-state">Nenhuma entrega em aberto para receber nesta semana.</div>`
    );
    return;
  }

  setHtml(
    "listaEntregasAReceber",
    entregas.map((pedido) => {
      return `
        <div class="finance-item">
          <strong>${pedido.restauranteNome || "Restaurante"}</strong>
          <p><b>Pedido:</b> ${pedido.id}</p>
          <p><b>Valor:</b> ${dinheiro(pedido.valorMotoboy)}</p>
          <p><b>Finalizada em:</b> ${dataTexto(pedido.entregueAt)}</p>
          <span class="status-pill pendente">A receber</span>
        </div>
      `;
    }).join("")
  );
}

function renderizarPagamentosRecebidos() {
  const pagamentos = pagamentosCache
    .filter((pagamento) => pagamento.status === "pago" || pagamento.pago === true || pagamento.pagoAt)
    .filter(pagamentoDentroDoFiltro)
    .sort((a, b) => {
      const dataA = a.pagoAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
      const dataB = b.pagoAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
      return dataB - dataA;
    });

  if (!pagamentos.length) {
    setHtml(
      "listaPagamentosRecebidos",
      `<div class="empty-state">Nenhum pagamento encontrado neste filtro.</div>`
    );
    return;
  }

  setHtml(
    "listaPagamentosRecebidos",
    pagamentos.map((pagamento) => {
      return `
        <div class="finance-item">
          <strong>${dinheiro(valorPagamento(pagamento))}</strong>
          <p><b>Pagamento:</b> ${pagamento.id}</p>
          <p><b>Pago em:</b> ${dataTexto(pagamento.pagoAt || pagamento.createdAt)}</p>
          <p><b>Entregas pagas:</b> ${totalEntregasPagamento(pagamento)}</p>
          <p><b>Período:</b> ${pagamento.periodoInicio || "Não informado"} até ${pagamento.periodoFim || "Não informado"}</p>
          <span class="status-pill aprovada">Recebido</span>
        </div>
      `;
    }).join("")
  );
}

function renderizarEntregasPagas() {
  const entregas = pedidosCache
    .filter(pedidoPagoValido)
    .sort((a, b) => {
      const dataA = dataDoPedido(a)?.getTime?.() || 0;
      const dataB = dataDoPedido(b)?.getTime?.() || 0;
      return dataB - dataA;
    });

  if (!entregas.length) {
    setHtml(
      "listaEntregasPagas",
      `<div class="empty-state">Nenhuma entrega paga ainda.</div>`
    );
    return;
  }

  setHtml(
    "listaEntregasPagas",
    entregas.map((pedido) => {
      return `
        <div class="finance-item">
          <strong>${pedido.restauranteNome || "Restaurante"}</strong>
          <p><b>Pedido:</b> ${pedido.id}</p>
          <p><b>Valor pago:</b> ${dinheiro(pedido.valorMotoboy)}</p>
          <p><b>Aceitou em:</b> ${dataTexto(pedido.aceitoAt)}</p>
          <p><b>Finalizou em:</b> ${dataTexto(pedido.entregueAt)}</p>
          <span class="status-pill aprovada">Pago</span>
        </div>
      `;
    }).join("")
  );
}

function renderizarEntregasEstornadas() {
  const entregas = pedidosCache
    .filter((pedido) => pedido.motoboyId === uid)
    .filter(pedidoFoiEstornado)
    .sort((a, b) => {
      const dataA = a.estornadoAt?.toMillis?.() || a.updatedAt?.toMillis?.() || 0;
      const dataB = b.estornadoAt?.toMillis?.() || b.updatedAt?.toMillis?.() || 0;
      return dataB - dataA;
    });

  if (!entregas.length) {
    setHtml(
      "listaEntregasEstornadas",
      `<div class="empty-state">Nenhuma entrega estornada.</div>`
    );
    return;
  }

  setHtml(
    "listaEntregasEstornadas",
    entregas.map((pedido) => {
      return `
        <div class="finance-item refund">
          <strong>${pedido.restauranteNome || "Restaurante"}</strong>
          <p><b>Pedido:</b> ${pedido.id}</p>
          <p><b>Valor removido:</b> ${dinheiro(pedido.valorMotoboy)}</p>
          <p><b>Motivo:</b> ${pedido.motivoEstorno || "Motivo não informado"}</p>
          <p><b>Entregue em:</b> ${dataTexto(pedido.entregueAt)}</p>
          <p><b>Estornado em:</b> ${dataTexto(pedido.estornadoAt)}</p>
          <span class="status-pill estornada">Estornado</span>
        </div>
      `;
    }).join("")
  );
}

function renderizarTudo() {
  renderizarResumo();
  renderizarEntregasAReceber();
  renderizarPagamentosRecebidos();
  renderizarEntregasPagas();
  renderizarEntregasEstornadas();
}

function configurarFiltros() {
  const filtro = document.getElementById("filtroHistoricoPagamentos");
  const semana = document.getElementById("semanaHistorico");

  if (filtro) {
    filtro.addEventListener("change", renderizarPagamentosRecebidos);
  }

  if (semana) {
    semana.addEventListener("change", renderizarPagamentosRecebidos);
  }
}

function escutarPedidosMotoboy() {
  const q = query(
    collection(db, "pedidos"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      pedidosCache = [];

      snapshot.forEach((docSnap) => {
        pedidosCache.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error(erro);
      setHtml(
        "listaEntregasAReceber",
        `<div class="empty-state">Erro ao carregar entregas.</div>`
      );
    }
  );
}

function escutarPagamentosMotoboy() {
  const q = query(
    collection(db, "pagamentos_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      pagamentosCache = [];

      snapshot.forEach((docSnap) => {
        pagamentosCache.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error(erro);
      setHtml(
        "listaPagamentosRecebidos",
        `<div class="empty-state">Erro ao carregar pagamentos.</div>`
      );
    }
  );
}

function escutarLedgerMotoboy() {
  const q = query(
    collection(db, "ledger_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      ledgerCache = [];

      snapshot.forEach((docSnap) => {
        ledgerCache.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error(erro);
    }
  );
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./index.html";
    return;
  }

  uid = user.uid;

  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists() || userSnap.data().role !== "motoboy") {
    await signOut(auth);
    window.location.href = "./index.html";
    return;
  }

  configurarFiltros();
  renderizarTudo();
  escutarPedidosMotoboy();
  escutarPagamentosMotoboy();
  escutarLedgerMotoboy();
});
