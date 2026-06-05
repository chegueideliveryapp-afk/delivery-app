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
let pedidos = [];
let pagamentos = [];
let ledger = [];

const META_VISUAL_SEMANAL = 300;

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

function parseDataInput(valor) {
  if (!valor) return null;

  const data = new Date(`${valor}T00:00:00`);
  return Number.isNaN(data.getTime()) ? null : data;
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

function dataDoPedido(pedido) {
  return (
    pedido.entregueAt?.toDate?.() ||
    pedido.updatedAt?.toDate?.() ||
    pedido.createdAt?.toDate?.() ||
    null
  );
}

function dentroDoPeriodo(data, inicio, fim) {
  if (!data) return true;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;
  return true;
}

function pedidoEntregueDoMotoboy(pedido) {
  return (
    pedido.status === "entregue" &&
    pedido.motoboyId === uid &&
    pedido.pagamentoMotoboyEstornado !== true &&
    pedido.pagamentoMotoboyStatus !== "estornado" &&
    numero(pedido.valorMotoboy, 0) > 0
  );
}

function pagamentoValido(pagamento) {
  return (
    pagamento.status === "pago" ||
    pagamento.pago === true ||
    Boolean(pagamento.pagoAt)
  );
}

function pagamentoTemPedido(pagamento, pedidoId) {
  if (Array.isArray(pagamento.pedidoIds) && pagamento.pedidoIds.includes(pedidoId)) {
    return true;
  }

  return pagamento.pedidoId === pedidoId;
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
    if (!pagamentoValido(pagamento)) return false;

    return (
      pagamentoTemPedido(pagamento, pedido.id) ||
      pagamentoContemLedgerDoPedido(pagamento, pedido.id)
    );
  });
}

function pedidoFoiPagoPorLedger(pedido) {
  return ledgerDoPedido(pedido.id).some((item) => ledgerFoiPago(item));
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

function entregasTodas() {
  return pedidos
    .filter(pedidoEntregueDoMotoboy)
    .sort((a, b) => {
      const dataA = dataDoPedido(a)?.getTime?.() || 0;
      const dataB = dataDoPedido(b)?.getTime?.() || 0;
      return dataB - dataA;
    });
}

function entregasAReceber() {
  return entregasTodas().filter((pedido) => !pedidoFoiPagoAoMotoboy(pedido));
}

function entregasPagas() {
  return entregasTodas().filter((pedido) => pedidoFoiPagoAoMotoboy(pedido));
}

function totalEntregas(lista) {
  return lista.reduce((total, pedido) => {
    return total + numero(pedido.valorMotoboy, 0);
  }, 0);
}

function entregasDaSemanaAtual() {
  const inicio = inicioDaSemana(new Date());
  const fim = fimDaSemana(new Date());

  return entregasTodas().filter((pedido) => {
    return dentroDoPeriodo(dataDoPedido(pedido), inicio, fim);
  });
}

function maiorValorEntrega() {
  const todas = entregasTodas();

  if (todas.length === 0) return 0;

  return Math.max(...todas.map((pedido) => numero(pedido.valorMotoboy, 0)));
}

function filtroHistorico() {
  return document.getElementById("filtroHistoricoPagamentos")?.value || "todos";
}

function entregasPagasFiltradas() {
  const filtro = filtroHistorico();
  const todas = entregasPagas();

  if (filtro === "todos") {
    return todas;
  }

  if (filtro === "ultimos30") {
    const fim = new Date();
    const inicio = new Date();

    inicio.setDate(fim.getDate() - 30);
    inicio.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 999);

    return todas.filter((pedido) => {
      return dentroDoPeriodo(dataDoPedido(pedido), inicio, fim);
    });
  }

  const dataSelecionada = parseDataInput(
    document.getElementById("semanaHistorico")?.value
  );

  const referencia =
    filtro === "semanaSelecionada" && dataSelecionada
      ? dataSelecionada
      : new Date();

  const inicio = inicioDaSemana(referencia);
  const fim = fimDaSemana(referencia);

  return todas.filter((pedido) => {
    return dentroDoPeriodo(dataDoPedido(pedido), inicio, fim);
  });
}

function agruparEntregasPagasPorSemana() {
  const grupos = {};

  entregasPagasFiltradas().forEach((pedido) => {
    const data = dataDoPedido(pedido) || new Date();
    const inicio = inicioDaSemana(data);
    const fim = fimDaSemana(data);
    const chave = formatarDataInput(inicio);

    if (!grupos[chave]) {
      grupos[chave] = {
        inicio,
        fim,
        total: 0,
        entregas: 0
      };
    }

    grupos[chave].total += numero(pedido.valorMotoboy, 0);
    grupos[chave].entregas += 1;
  });

  return Object.values(grupos).sort((a, b) => b.inicio - a.inicio);
}

function renderizarResumo() {
  const abertas = entregasAReceber();
  const pagas = entregasPagas();
  const todas = entregasTodas();

  const totalAberto = totalEntregas(abertas);
  const totalRecebido = totalEntregas(pagas);
  const media = todas.length > 0 ? totalEntregas(todas) / todas.length : 0;
  const totalSemana = totalEntregas(entregasDaSemanaAtual());
  const percentualMeta = Math.min(100, (totalSemana / META_VISUAL_SEMANAL) * 100);

  setText("valorAbertoMotoboy", dinheiro(totalAberto));
  setText("totalRecebidoMotoboy", dinheiro(totalRecebido));
  setText("mediaEntregaMotoboy", dinheiro(media));
  setText("totalEntregasAbertas", abertas.length);
  setText("totalEntregasPagas", pagas.length);
  setText("proximoPagamento", `Segunda, ${dataCurta(proximaSegunda())}`);
  setText("ritmoGanhosTexto", `${dinheiro(totalSemana)} esta semana`);
  setText("maiorEntregaTexto", dinheiro(maiorValorEntrega()));

  const barra = document.getElementById("barraGanhosSemana");
  if (barra) {
    barra.style.width = `${percentualMeta}%`;
  }
}

function renderizarTotalRecebido() {
  const box = document.getElementById("boxTotalRecebido");
  if (!box) return;

  const pagas = entregasPagas();
  const total = totalEntregas(pagas);
  const media = pagas.length > 0 ? total / pagas.length : 0;

  box.innerHTML = `
    <div class="finance-total-box">
      <strong>${dinheiro(total)}</strong>
      <p>Total já pago a você pela Cheguei Delivery.</p>
      <p>Entregas pagas: ${pagas.length}</p>
      <p>Média recebida por entrega paga: ${dinheiro(media)}</p>
      <span class="status-pill aprovada">Recebido</span>
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
      <strong>${dinheiro(pedido.valorMotoboy)}</strong>
      <p>Restaurante: ${pedido.restauranteNome || "Não informado"}</p>
      <p>Entrega: ${pedido.enderecoEntrega || "Endereço não informado"}</p>
      <p>Aceitou em: ${dataTexto(pedido.aceitoAt)}</p>
      <p>Finalizou em: ${dataTexto(pedido.entregueAt || pedido.updatedAt)}</p>
      <span class="status-pill pendente">A receber</span>
    `;

    lista.appendChild(card);
  });
}

function renderizarHistoricoSemanal() {
  const lista = document.getElementById("listaPagamentosRecebidos");
  if (!lista) return;

  const grupos = agruparEntregasPagasPorSemana();

  lista.innerHTML = "";

  if (grupos.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        Nenhum pagamento encontrado neste filtro.
      </div>
    `;
    return;
  }

  grupos.forEach((grupo) => {
    const card = document.createElement("div");
    card.className = "finance-item";

    card.innerHTML = `
      <strong>${dinheiro(grupo.total)}</strong>
      <p>Semana: ${dataCurta(grupo.inicio)} até ${dataCurta(grupo.fim)}</p>
      <p>Entregas pagas: ${grupo.entregas}</p>
      <span class="status-pill aprovada">Pago</span>
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
    card.className = "paid-delivery-card";

    card.innerHTML = `
      <div class="paid-delivery-top">
        <div>
          <span>Restaurante</span>
          <strong>${pedido.restauranteNome || "Restaurante não informado"}</strong>
        </div>

        <span class="paid-badge">Pago</span>
      </div>

      <div class="paid-delivery-value">
        <span>Valor recebido</span>
        <strong>${dinheiro(pedido.valorMotoboy)}</strong>
      </div>

      <div class="paid-delivery-info">
        <div>
          <span>Aceitou</span>
          <strong>${dataTexto(pedido.aceitoAt)}</strong>
        </div>

        <div>
          <span>Finalizou</span>
          <strong>${dataTexto(pedido.entregueAt || pedido.updatedAt)}</strong>
        </div>
      </div>

      <div class="support-order-id">
        <span>ID do pedido para suporte</span>
        <strong>${pedido.id}</strong>
      </div>
    `;

    lista.appendChild(card);
  });
}

function renderizarTudo() {
  renderizarResumo();
  renderizarTotalRecebido();
  renderizarEntregasAReceber();
  renderizarHistoricoSemanal();
  renderizarEntregasPagas();
}

function configurarFiltros() {
  const filtro = document.getElementById("filtroHistoricoPagamentos");
  const semana = document.getElementById("semanaHistorico");

  if (semana && !semana.value) {
    semana.value = formatarDataInput(new Date());
  }

  if (filtro) {
    filtro.addEventListener("change", renderizarTudo);
  }

  if (semana) {
    semana.addEventListener("change", renderizarTudo);
  }
}

function escutarPedidos() {
  const q = query(
    collection(db, "pedidos"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(q, (snapshot) => {
    pedidos = [];

    snapshot.forEach((docSnap) => {
      pedidos.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarTudo();
  });
}

function escutarPagamentos() {
  const q = query(
    collection(db, "pagamentos_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(q, (snapshot) => {
    pagamentos = [];

    snapshot.forEach((docSnap) => {
      pagamentos.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarTudo();
  });
}

function escutarLedger() {
  const q = query(
    collection(db, "ledger_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(q, (snapshot) => {
    ledger = [];

    snapshot.forEach((docSnap) => {
      ledger.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarTudo();
  });
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
  escutarPedidos();
  escutarPagamentos();
  escutarLedger();
});
