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
let motoboyAtual = null;
let pedidos = [];
let pagamentosDiretos = [];
let pagamentosPorPedidos = [];
let ledger = [];

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

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Data não informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function dataCurta(data) {
  if (!data) return "Não informado";
  return data.toLocaleDateString("pt-BR");
}

function inicioDaSemanaAtual() {
  const hoje = new Date();
  const dia = hoje.getDay();
  const diferenca = dia === 0 ? -6 : 1 - dia;

  const segunda = new Date(hoje);
  segunda.setDate(hoje.getDate() + diferenca);
  segunda.setHours(0, 0, 0, 0);

  return segunda;
}

function fimDaSemanaAtual() {
  const inicio = inicioDaSemanaAtual();
  const fim = new Date(inicio);

  fim.setDate(inicio.getDate() + 6);
  fim.setHours(23, 59, 59, 999);

  return fim;
}

function dataDoPedido(pedido) {
  return (
    pedido.entregueAt?.toDate?.() ||
    pedido.updatedAt?.toDate?.() ||
    pedido.createdAt?.toDate?.() ||
    null
  );
}

function dataDoPagamento(pagamento) {
  return (
    pagamento.pagoAt?.toDate?.() ||
    pagamento.createdAt?.toDate?.() ||
    null
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
  return ledger.filter((item) => item.pedidoId === pedidoId);
}

function ledgerFoiPago(item) {
  return (
    item.statusPagamento === "pago" ||
    item.pago === true ||
    Boolean(item.pagamentoId)
  );
}

function pagamentoContemLedgerDoPedido(pagamento, pedidoId) {
  if (!Array.isArray(pagamento.ledgerIds)) return false;

  const ledgersDoPedido = ledgerDoPedido(pedidoId);

  return ledgersDoPedido.some((item) => {
    return pagamento.ledgerIds.includes(item.id);
  });
}

function todosPagamentos() {
  const mapa = {};

  pagamentosDiretos.forEach((pagamento) => {
    mapa[pagamento.id] = pagamento;
  });

  pagamentosPorPedidos.forEach((pagamento) => {
    mapa[pagamento.id] = pagamento;
  });

  return Object.values(mapa);
}

function pagamentoPertenceAoMotoboy(pagamento) {
  if (pagamento.motoboyId === uid) return true;

  const pedidosDoMotoboy = pedidos.filter((pedido) => {
    return pedido.motoboyId === uid;
  });

  const temPedidoDoMotoboy = pedidosDoMotoboy.some((pedido) => {
    return pagamentoTemPedido(pagamento, pedido.id);
  });

  if (temPedidoDoMotoboy) return true;

  if (Array.isArray(pagamento.ledgerIds)) {
    return ledger.some((item) => {
      return item.motoboyId === uid && pagamento.ledgerIds.includes(item.id);
    });
  }

  return false;
}

function pedidoFoiPagoPorPagamento(pedido) {
  return todosPagamentos().some((pagamento) => {
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
  const ledgersDoPedido = ledgerDoPedido(pedido.id);

  return ledgersDoPedido.some((item) => ledgerFoiPago(item));
}

function pedidoFoiPagoAoMotoboy(pedido) {
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

function entregasAReceber() {
  return pedidos
    .filter(pedidoEntregueDoMotoboy)
    .filter((pedido) => !pedidoFoiPagoAoMotoboy(pedido))
    .sort((a, b) => {
      const dataA = dataDoPedido(a)?.getTime?.() || 0;
      const dataB = dataDoPedido(b)?.getTime?.() || 0;
      return dataB - dataA;
    });
}

function entregasPagas() {
  return pedidos
    .filter(pedidoEntregueDoMotoboy)
    .filter((pedido) => pedidoFoiPagoAoMotoboy(pedido))
    .sort((a, b) => {
      const dataA = dataDoPedido(a)?.getTime?.() || 0;
      const dataB = dataDoPedido(b)?.getTime?.() || 0;
      return dataB - dataA;
    });
}

function pagamentosDoMotoboy() {
  return todosPagamentos()
    .filter(pagamentoPertenceAoMotoboy)
    .filter((pagamento) => {
      return pagamento.status === "pago" || pagamento.pago === true || pagamento.pagoAt;
    })
    .sort((a, b) => {
      const dataA = dataDoPagamento(a)?.getTime?.() || 0;
      const dataB = dataDoPagamento(b)?.getTime?.() || 0;
      return dataB - dataA;
    });
}

function valorPagamentoHistorico(pagamento) {
  return numero(
    pagamento.valorTotal ??
    pagamento.valorTotalSemana ??
    pagamento.valorPago ??
    pagamento.valor,
    0
  );
}

function renderizarResumo() {
  const abertas = entregasAReceber();
  const pagas = entregasPagas();

  const totalAberto = abertas.reduce((total, pedido) => {
    return total + numero(pedido.valorMotoboy, 0);
  }, 0);

  setText("valorAbertoMotoboy", dinheiro(totalAberto));
  setText("totalEntregasAbertas", abertas.length);
  setText("totalEntregasPagas", pagas.length);

  const inicio = inicioDaSemanaAtual();
  const fim = fimDaSemanaAtual();

  setText("semanaPagamento", `${dataCurta(inicio)} até ${dataCurta(fim)}`);
}

function renderizarEntregasAReceber() {
  const lista = document.getElementById("listaEntregasAReceber");
  if (!lista) return;

  const abertas = entregasAReceber();

  lista.innerHTML = "";

  if (abertas.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        Nenhuma entrega em aberto para receber.
      </div>
    `;
    return;
  }

  abertas.forEach((pedido) => {
    const card = document.createElement("div");
    card.className = "finance-item";

    card.innerHTML = `
      <div>
        <strong>${dinheiro(pedido.valorMotoboy)}</strong>
        <p>Pedido: ${pedido.id}</p>
        <p>Restaurante: ${pedido.restauranteNome || "Não informado"}</p>
        <p>Entrega: ${pedido.enderecoEntrega || "Endereço não informado"}</p>
        <p>Finalizada em: ${dataTexto(pedido.entregueAt || pedido.updatedAt || pedido.createdAt)}</p>
      </div>

      <span class="finance-status open">A receber</span>
    `;

    lista.appendChild(card);
  });
}

function renderizarPagamentosRecebidos() {
  const lista = document.getElementById("listaPagamentosRecebidos");
  if (!lista) return;

  const historico = pagamentosDoMotoboy();

  lista.innerHTML = "";

  if (historico.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        Nenhum pagamento recebido ainda.
      </div>
    `;
    return;
  }

  historico.forEach((pagamento) => {
    const valor = valorPagamentoHistorico(pagamento);

    const periodoInicio =
      pagamento.periodoInicio ||
      pagamento.inicioSemanaTexto ||
      "Não informado";

    const periodoFim =
      pagamento.periodoFim ||
      pagamento.fimSemanaTexto ||
      "Não informado";

    const card = document.createElement("div");
    card.className = "finance-item";

    card.innerHTML = `
      <div>
        <strong>${dinheiro(valor)}</strong>
        <p>Pagamento: ${pagamento.id}</p>
        <p>Entregas pagas: ${pagamento.totalEntregas || pagamento.entregas || 0}</p>
        <p>Período: ${periodoInicio} até ${periodoFim}</p>
        <p>Pago em: ${dataTexto(pagamento.pagoAt || pagamento.createdAt)}</p>
      </div>

      <span class="finance-status paid">Pago</span>
    `;

    lista.appendChild(card);
  });
}

function renderizarEntregasPagas() {
  const lista = document.getElementById("listaEntregasPagas");
  if (!lista) return;

  const pagas = entregasPagas();

  lista.innerHTML = "";

  if (pagas.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        Nenhuma entrega paga encontrada.
      </div>
    `;
    return;
  }

  pagas.forEach((pedido) => {
    const card = document.createElement("div");
    card.className = "finance-item";

    card.innerHTML = `
      <div>
        <strong>${dinheiro(pedido.valorMotoboy)}</strong>
        <p>Pedido: ${pedido.id}</p>
        <p>Restaurante: ${pedido.restauranteNome || "Não informado"}</p>
        <p>Entrega: ${pedido.enderecoEntrega || "Endereço não informado"}</p>
        <p>Finalizada em: ${dataTexto(pedido.entregueAt || pedido.updatedAt || pedido.createdAt)}</p>
      </div>

      <span class="finance-status paid">Pago</span>
    `;

    lista.appendChild(card);
  });
}

function renderizarConferencia() {
  const box = document.getElementById("boxConferenciaFinanceira");
  if (!box) return;

  const abertas = entregasAReceber();

  const totalAbertoCalculado = abertas.reduce((total, pedido) => {
    return total + numero(pedido.valorMotoboy, 0);
  }, 0);

  const saldoCadastro = numero(motoboyAtual?.saldo, 0);

  box.innerHTML = `
    <div class="finance-item">
      <div>
        <strong>${dinheiro(totalAbertoCalculado)}</strong>
        <p>Total calculado pelas entregas ainda não pagas.</p>
        <p>Saldo atual no cadastro: ${dinheiro(saldoCadastro)}</p>
        <p>Se houver diferença, vale o total calculado pelas entregas abertas para evitar documentos antigos.</p>
      </div>

      <span class="finance-status open">Conferência</span>
    </div>
  `;
}

function renderizarTudo() {
  renderizarResumo();
  renderizarEntregasAReceber();
  renderizarPagamentosRecebidos();
  renderizarEntregasPagas();
  renderizarConferencia();
}

function escutarMotoboy() {
  onSnapshot(doc(db, "motoboys", uid), (snap) => {
    if (!snap.exists()) return;

    motoboyAtual = {
      id: snap.id,
      ...snap.data()
    };

    renderizarTudo();
  });
}

function escutarPedidos() {
  const q = query(
    collection(db, "pedidos"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      pedidos = [];

      snapshot.forEach((docSnap) => {
        pedidos.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error("Erro ao carregar pedidos:", erro);
    }
  );
}

function escutarPagamentosDiretos() {
  const q = query(
    collection(db, "pagamentos_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      pagamentosDiretos = [];

      snapshot.forEach((docSnap) => {
        pagamentosDiretos.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error("Erro ao carregar pagamentos diretos:", erro);
    }
  );
}

function escutarPagamentosPorPedidos() {
  onSnapshot(
    collection(db, "pagamentos_motoboy"),
    (snapshot) => {
      pagamentosPorPedidos = [];

      snapshot.forEach((docSnap) => {
        const pagamento = {
          id: docSnap.id,
          ...docSnap.data()
        };

        pagamentosPorPedidos.push(pagamento);
      });

      renderizarTudo();
    },
    (erro) => {
      console.error("Erro ao carregar histórico geral:", erro);
    }
  );
}

function escutarLedger() {
  const q = query(
    collection(db, "ledger_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      ledger = [];

      snapshot.forEach((docSnap) => {
        ledger.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error("Erro ao carregar ledger:", erro);
    }
  );
}

async function validarUsuario(user) {
  const snap = await getDoc(doc(db, "users", user.uid));

  if (!snap.exists() || snap.data().role !== "motoboy") {
    await signOut(auth);
    window.location.href = "./index.html";
    return false;
  }

  return true;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./index.html";
    return;
  }

  uid = user.uid;

  const valido = await validarUsuario(user);
  if (!valido) return;

  escutarMotoboy();
  escutarPedidos();
  escutarPagamentosDiretos();
  escutarPagamentosPorPedidos();
  escutarLedger();
});
