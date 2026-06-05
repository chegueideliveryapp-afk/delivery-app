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
let pagamentos = [];
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

function formatarDataInput(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

function inicioDaSemana(dataReferencia) {
  const data = new Date(dataReferencia);
  const dia = data.getDay();
  const diferenca = dia === 0 ? -6 : 1 - dia;

  data.setDate(data.getDate() + diferenca);
  data.setHours(0, 0, 0, 0);

  return data;
}

function fimDaSemana(dataReferencia) {
  const inicio = inicioDaSemana(dataReferencia);
  const fim = new Date(inicio);

  fim.setDate(inicio.getDate() + 6);
  fim.setHours(23, 59, 59, 999);

  return fim;
}

function proximaSegunda() {
  const hoje = new Date();
  const dia = hoje.getDay();
  const diasAteSegunda = dia === 1 ? 7 : (8 - dia) % 7 || 7;

  const data = new Date(hoje);
  data.setDate(hoje.getDate() + diasAteSegunda);
  data.setHours(0, 0, 0, 0);

  return data;
}

function parseDataInput(valor) {
  if (!valor) return null;

  const data = new Date(`${valor}T00:00:00`);
  return Number.isNaN(data.getTime()) ? null : data;
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

function dentroDoPeriodo(data, inicio, fim) {
  if (!data) return true;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;

  return true;
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

function pedidoFoiPagoPorPagamento(pedido) {
  return pagamentos.some((pagamento) => {
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
  return pagamentos
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

function pagamentosFiltrados() {
  const filtro = document.getElementById("filtroHistoricoPagamentos")?.value || "todos";
  const dataSelecionada = parseDataInput(document.getElementById("semanaHistorico")?.value);
  const todos = pagamentosDoMotoboy();

  if (filtro === "todos") {
    return todos;
  }

  if (filtro === "ultimos30") {
    const fim = new Date();
    const inicio = new Date();

    inicio.setDate(fim.getDate() - 30);
    inicio.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 999);

    return todos.filter((pagamento) => {
      return dentroDoPeriodo(dataDoPagamento(pagamento), inicio, fim);
    });
  }

  const referencia = filtro === "semanaSelecionada" && dataSelecionada
    ? dataSelecionada
    : new Date();

  const inicio = inicioDaSemana(referencia);
  const fim = fimDaSemana(referencia);

  return todos.filter((pagamento) => {
    return dentroDoPeriodo(dataDoPagamento(pagamento), inicio, fim);
  });
}

function totalRecebido() {
  return pagamentosDoMotoboy().reduce((total, pagamento) => {
    return total + valorPagamentoHistorico(pagamento);
  }, 0);
}

function totalEntregasPagasHistorico() {
  return pagamentosDoMotoboy().reduce((total, pagamento) => {
    return total + numero(pagamento.totalEntregas ?? pagamento.entregas, 0);
  }, 0);
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
  setText("proximoPagamento", `Segunda-feira, ${dataCurta(proximaSegunda())}`);
}

function renderizarTotalRecebido() {
  const box = document.getElementById("boxTotalRecebido");
  if (!box) return;

  const valor = totalRecebido();
  const entregas = totalEntregasPagasHistorico();

  box.innerHTML = `
    <div class="finance-item">
      <div>
        <strong>${dinheiro(valor)}</strong>
        <p>Total já pago a você pela Cheguei Delivery.</p>
        <p>Pagamentos recebidos: ${pagamentosDoMotoboy().length}</p>
        <p>Entregas pagas nesses pagamentos: ${entregas}</p>
      </div>

      <span class="finance-status paid">Recebido</span>
    </div>
  `;
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

  const historico = pagamentosFiltrados();

  lista.innerHTML = "";

  if (historico.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        Nenhum pagamento encontrado neste filtro.
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

function renderizarTudo() {
  renderizarResumo();
  renderizarTotalRecebido();
  renderizarEntregasAReceber();
  renderizarPagamentosRecebidos();
  renderizarEntregasPagas();
}

function configurarFiltros() {
  const filtro = document.getElementById("filtroHistoricoPagamentos");
  const semana = document.getElementById("semanaHistorico");

  if (semana && !semana.value) {
    semana.value = formatarDataInput(new Date());
  }

  if (filtro) {
    filtro.addEventListener("change", () => {
      renderizarPagamentosRecebidos();
    });
  }

  if (semana) {
    semana.addEventListener("change", () => {
      renderizarPagamentosRecebidos();
    });
  }
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

function escutarPagamentos() {
  const q = query(
    collection(db, "pagamentos_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      pagamentos = [];

      snapshot.forEach((docSnap) => {
        pagamentos.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      renderizarTudo();
    },
    (erro) => {
      console.error("Erro ao carregar pagamentos:", erro);
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

  configurarFiltros();

  escutarMotoboy();
  escutarPedidos();
  escutarPagamentos();
  escutarLedger();
});
