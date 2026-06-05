import { db } from "./firebase.js";

import {
  collection,
  onSnapshot,
  query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let motoboys = [];
let restaurantes = [];
let pedidos = [];
let recargas = [];
let pagamentosMotoboy = [];
let ledgerMotoboy = [];

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

function setText(id, valor) {
  const el = document.getElementById(id);
  if (el) el.innerText = valor;
}

function pedidoTemPagamentoDireto(pedido) {
  return (
    pedido.pagamentoMotoboyPago === true ||
    pedido.pagamentoMotoboyStatus === "pago" ||
    Boolean(pedido.pagamentoMotoboyId)
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

function ledgerFoiPago(ledger) {
  return (
    ledger.statusPagamento === "pago" ||
    ledger.pago === true ||
    Boolean(ledger.pagamentoId)
  );
}

function ledgersDoPedido(pedidoId) {
  return ledgerMotoboy.filter((ledger) => ledger.pedidoId === pedidoId);
}

function pagamentoContemLedgerDoPedido(pagamento, pedidoId) {
  if (!Array.isArray(pagamento.ledgerIds)) return false;

  const ledgers = ledgersDoPedido(pedidoId);

  return ledgers.some((ledger) => {
    return pagamento.ledgerIds.includes(ledger.id);
  });
}

function pedidoFoiPagoPorPagamento(pedido) {
  return pagamentosMotoboy.some((pagamento) => {
    const pagamentoValido =
      pagamento.status === "pago" ||
      pagamento.pago === true ||
      pagamento.pagoAt;

    if (!pagamentoValido) return false;

    return (
      pagamentoTemPedido(pagamento, pedido.id) ||
      pagamentoContemLedgerDoPedido(pagamento, pedido.id)
    );
  });
}

function pedidoFoiPagoPorLedger(pedido) {
  const ledgers = ledgersDoPedido(pedido.id);

  return ledgers.some((ledger) => ledgerFoiPago(ledger));
}

function pedidoFoiPagoAoMotoboy(pedido) {
  return (
    pedidoTemPagamentoDireto(pedido) ||
    pedidoFoiPagoPorPagamento(pedido) ||
    pedidoFoiPagoPorLedger(pedido)
  );
}

function pedidoEntregueComValorMotoboy(pedido) {
  return (
    pedido.status === "entregue" &&
    pedido.motoboyId &&
    numero(pedido.valorMotoboy, 0) > 0
  );
}

function pedidoPendentePagamentoMotoboy(pedido) {
  return (
    pedidoEntregueComValorMotoboy(pedido) &&
    !pedidoFoiPagoAoMotoboy(pedido)
  );
}

function calcularSaldoRestaurantes() {
  return restaurantes.reduce((total, restaurante) => {
    return total + numero(restaurante.saldoPrePago, 0);
  }, 0);
}

function calcularAPagarMotoboys() {
  return pedidos
    .filter(pedidoPendentePagamentoMotoboy)
    .reduce((total, pedido) => {
      return total + numero(pedido.valorMotoboy, 0);
    }, 0);
}

function renderizarDashboard() {
  const motoboysOnline = motoboys.filter((m) => m.online === true).length;
  const motoboysPendentes = motoboys.filter((m) => {
    return m.statusCadastro === "pendente" || m.aprovado !== true;
  }).length;

  const restaurantesAtivos = restaurantes.filter((r) => {
    return r.ativo !== false && r.bloqueado !== true;
  }).length;

  const pedidosPendentes = pedidos.filter((p) => {
    return p.status === "pendente" || p.status === "buscando_motoboy" || p.status === "sem_motoboy";
  }).length;

  const pedidosAceitos = pedidos.filter((p) => p.status === "aceito").length;
  const pedidosEntregues = pedidos.filter((p) => p.status === "entregue").length;

  const recargasPendentes = recargas.filter((r) => r.status === "pendente").length;

  const saldoRestaurantes = calcularSaldoRestaurantes();
  const aPagarMotoboys = calcularAPagarMotoboys();

  setText("totalMotoboys", motoboys.length);
  setText("motoboysOnline", motoboysOnline);
  setText("motoboysPendentes", motoboysPendentes);
  setText("restaurantesAtivos", restaurantesAtivos);

  setText("saldoRestaurantes", dinheiro(saldoRestaurantes));
  setText("pedidosPendentes", pedidosPendentes);
  setText("pedidosAceitos", pedidosAceitos);
  setText("pedidosEntregues", pedidosEntregues);

  setText("recargasPendentes", recargasPendentes);
  setText("aPagarMotoboys", dinheiro(aPagarMotoboys));

  renderizarAlertas(recargasPendentes, pedidosAceitos, aPagarMotoboys);
}

function renderizarAlertas(recargasPendentes, pedidosAceitos, aPagarMotoboys) {
  const lista = document.getElementById("listaAlertas");
  if (!lista) return;

  lista.innerHTML = "";

  if (recargasPendentes > 0) {
    lista.innerHTML += `
      <div class="list-card">
        <div>
          <strong>${recargasPendentes} recarga(s) Pix pendente(s)</strong>
          <p>Confira comprovantes e aprove manualmente.</p>
          <span class="badge yellow">Financeiro</span>
        </div>
        <div class="actions">
          <a class="topbar-link" href="./recargas.html">Ver</a>
        </div>
      </div>
    `;
  }

  if (pedidosAceitos > 0) {
    lista.innerHTML += `
      <div class="list-card">
        <div>
          <strong>${pedidosAceitos} corrida(s) em andamento</strong>
          <p>Acompanhe pedidos aceitos e motoboys em rota.</p>
          <span class="badge green">Em rota</span>
        </div>
        <div class="actions">
          <a class="topbar-link" href="./mapa.html">Ver</a>
        </div>
      </div>
    `;
  }

  if (aPagarMotoboys > 0) {
    lista.innerHTML += `
      <div class="list-card">
        <div>
          <strong>${dinheiro(aPagarMotoboys)} em aberto para motoboys</strong>
          <p>Valores acumulados para pagamento semanal.</p>
          <span class="badge yellow">Pagamento segunda-feira</span>
        </div>
        <div class="actions">
          <a class="topbar-link" href="./pagamentos.html">Ver</a>
        </div>
      </div>
    `;
  }

  if (!lista.innerHTML) {
    lista.innerHTML = `
      <div class="empty">
        Nenhum item crítico no momento.
      </div>
    `;
  }
}

function escutarColecao(nome, callback) {
  onSnapshot(query(collection(db, nome)), (snapshot) => {
    const itens = [];

    snapshot.forEach((docSnap) => {
      itens.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    callback(itens);
    renderizarDashboard();
  });
}

export function iniciarDashboardAdmin() {
  escutarColecao("motoboys", (itens) => {
    motoboys = itens;
  });

  escutarColecao("restaurantes", (itens) => {
    restaurantes = itens;
  });

  escutarColecao("pedidos", (itens) => {
    pedidos = itens;
  });

  escutarColecao("recargas_restaurante", (itens) => {
    recargas = itens;
  });

  escutarColecao("pagamentos_motoboy", (itens) => {
    pagamentosMotoboy = itens;
  });

  escutarColecao("ledger_motoboy", (itens) => {
    ledgerMotoboy = itens;
  });
}
