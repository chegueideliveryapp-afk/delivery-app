import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let motoboysCache = {};
let pedidosCache = [];
let ledgerCache = [];
let pagamentosCache = [];

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

function inicioDaSemana() {
  const hoje = new Date();
  const dia = hoje.getDay();
  const diferenca = dia === 0 ? -6 : 1 - dia;

  const segunda = new Date(hoje);
  segunda.setDate(hoje.getDate() + diferenca);
  segunda.setHours(0, 0, 0, 0);

  return segunda;
}

function fimDaSemana() {
  const inicio = inicioDaSemana();
  const fim = new Date(inicio);

  fim.setDate(inicio.getDate() + 6);
  fim.setHours(23, 59, 59, 999);

  return fim;
}

function parseDataInicio(valor) {
  if (!valor) return null;

  const data = new Date(`${valor}T00:00:00`);
  return Number.isNaN(data.getTime()) ? null : data;
}

function parseDataFim(valor) {
  if (!valor) return null;

  const data = new Date(`${valor}T23:59:59`);
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

function dentroDoPeriodoPorData(data, inicio, fim) {
  if (!data) return true;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;

  return true;
}

function nomeMotoboy(motoboyId, fallback = "") {
  return (
    motoboysCache[motoboyId]?.nome ||
    fallback ||
    "Motoboy não informado"
  );
}

function telefoneMotoboy(motoboyId) {
  return motoboysCache[motoboyId]?.telefone || "Telefone não informado";
}

function preencherDatasPadrao() {
  const dataInicio = document.getElementById("dataInicio");
  const dataFim = document.getElementById("dataFim");

  if (dataInicio && !dataInicio.value) {
    dataInicio.value = formatarDataInput(inicioDaSemana());
  }

  if (dataFim && !dataFim.value) {
    dataFim.value = formatarDataInput(fimDaSemana());
  }
}

function atualizarSelectMotoboys() {
  const select = document.getElementById("filtroMotoboy");
  if (!select) return;

  const valorAtual = select.value;

  select.innerHTML = `<option value="">Todos os motoboys</option>`;

  Object.entries(motoboysCache)
    .sort((a, b) => {
      const nomeA = a[1]?.nome || "";
      const nomeB = b[1]?.nome || "";
      return nomeA.localeCompare(nomeB);
    })
    .forEach(([id, motoboy]) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = motoboy.nome || id;
      select.appendChild(option);
    });

  select.value = valorAtual;
}

function pedidoFoiPagoAoMotoboy(pedido) {
  return (
    pedido.pagamentoMotoboyPago === true ||
    pedido.pagamentoMotoboyStatus === "pago" ||
    Boolean(pedido.pagamentoMotoboyId)
  );
}

function pedidoEntregueComValorMotoboy(pedido) {
  return (
    pedido.status === "entregue" &&
    pedido.motoboyId &&
    numero(pedido.valorMotoboy, 0) > 0
  );
}

function pedidoPendentePagamento(pedido) {
  return (
    pedidoEntregueComValorMotoboy(pedido) &&
    !pedidoFoiPagoAoMotoboy(pedido)
  );
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

function agruparPedidosPendentesPagamento() {
  const filtroMotoboy = document.getElementById("filtroMotoboy")?.value || "";
  const grupos = {};

  pedidosCache
    .filter(pedidoPendentePagamento)
    .filter((pedido) => !filtroMotoboy || pedido.motoboyId === filtroMotoboy)
    .forEach((pedido) => {
      const motoboyId = pedido.motoboyId;

      if (!grupos[motoboyId]) {
        grupos[motoboyId] = {
          motoboyId,
          motoboyNome: nomeMotoboy(motoboyId, pedido.motoboyNome),
          telefone: telefoneMotoboy(motoboyId),
          total: 0,
          entregas: 0,
          pedidos: [],
          primeiraData: null,
          ultimaData: null,
          saldoAtual: numero(motoboysCache[motoboyId]?.saldo, 0)
        };
      }

      const valor = numero(pedido.valorMotoboy, 0);
      const data = dataDoPedido(pedido);

      grupos[motoboyId].total += valor;
      grupos[motoboyId].entregas += 1;
      grupos[motoboyId].pedidos.push(pedido);

      if (data) {
        if (!grupos[motoboyId].primeiraData || data < grupos[motoboyId].primeiraData) {
          grupos[motoboyId].primeiraData = data;
        }

        if (!grupos[motoboyId].ultimaData || data > grupos[motoboyId].ultimaData) {
          grupos[motoboyId].ultimaData = data;
        }
      }
    });

  return Object.values(grupos).sort((a, b) => b.total - a.total);
}

function renderizarPagamentosPendentes() {
  const lista = document.getElementById("listaPagamentosMotoboy");
  const resumo = document.getElementById("resumoPagamentos");

  if (!lista) return;

  const grupos = agruparPedidosPendentesPagamento();

  const totalGeral = grupos.reduce((acc, grupo) => acc + numero(grupo.total, 0), 0);
  const totalEntregas = grupos.reduce((acc, grupo) => acc + numero(grupo.entregas, 0), 0);

  if (resumo) {
    resumo.innerText =
      `${dinheiro(totalGeral)} em aberto, ${totalEntregas} entrega(s), agrupado em ${grupos.length} motoboy(s).`;
  }

  lista.innerHTML = "";

  if (grupos.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhum pagamento pendente no momento.</div>`;
    return;
  }

  grupos.forEach((grupo) => {
    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${grupo.motoboyNome}</strong>

        <p>Motoboy ID: ${grupo.motoboyId}</p>
        <p>Telefone: ${grupo.telefone}</p>
        <p>Total a pagar: <b>${dinheiro(grupo.total)}</b></p>
        <p>Saldo atual no cadastro: ${dinheiro(grupo.saldoAtual)}</p>
        <p>Entregas pendentes: ${grupo.entregas}</p>
        <p>Período: ${dataCurta(grupo.primeiraData)} até ${dataCurta(grupo.ultimaData)}</p>

        <div class="status-row">
          <span class="badge yellow">Pagamento pendente</span>
          <span class="badge gray">${grupo.entregas} entrega(s)</span>
        </div>
      </div>

      <div class="actions">
        <button
          type="button"
          data-action="marcarPago"
          data-motoboy-id="${grupo.motoboyId}"
        >
          Marcar como pago
        </button>
      </div>
    `;

    lista.appendChild(card);
  });

  lista.querySelectorAll("button[data-action='marcarPago']").forEach((button) => {
    button.addEventListener("click", async () => {
      const motoboyId = button.dataset.motoboyId;
      const grupo = grupos.find((item) => item.motoboyId === motoboyId);

      if (!grupo) return;

      const confirmar = confirm(
        `Confirmar pagamento para ${grupo.motoboyNome}?\n\nValor: ${dinheiro(grupo.total)}\nEntregas: ${grupo.entregas}`
      );

      if (!confirmar) return;

      button.disabled = true;
      button.innerText = "Pagando...";

      try {
        await marcarGrupoComoPago(grupo);
        alert("Pagamento marcado como realizado.");
      } catch (erro) {
        console.error(erro);
        alert("Erro ao marcar pagamento: " + (erro.message || "erro desconhecido"));
        button.disabled = false;
        button.innerText = "Marcar como pago";
      }
    });
  });
}

function renderizarEntregasPeriodo() {
  const lista = document.getElementById("listaEntregasPeriodo");
  if (!lista) return;

  const dataInicio = parseDataInicio(document.getElementById("dataInicio")?.value);
  const dataFim = parseDataFim(document.getElementById("dataFim")?.value);
  const filtroMotoboy = document.getElementById("filtroMotoboy")?.value || "";

  const entregas = pedidosCache
    .filter(pedidoEntregueComValorMotoboy)
    .filter((pedido) => {
      return dentroDoPeriodoPorData(dataDoPedido(pedido), dataInicio, dataFim);
    })
    .filter((pedido) => !filtroMotoboy || pedido.motoboyId === filtroMotoboy)
    .sort((a, b) => {
      const dataA = dataDoPedido(a)?.getTime?.() || 0;
      const dataB = dataDoPedido(b)?.getTime?.() || 0;
      return dataB - dataA;
    });

  lista.innerHTML = "";

  if (entregas.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhuma entrega encontrada neste período.</div>`;
    return;
  }

  entregas.forEach((pedido) => {
    const pago = pedidoFoiPagoAoMotoboy(pedido);

    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${nomeMotoboy(pedido.motoboyId, pedido.motoboyNome)}</strong>

        <p>Valor motoboy: <b>${dinheiro(pedido.valorMotoboy)}</b></p>
        <p>Pedido ID: ${pedido.id}</p>
        <p>Motoboy ID: ${pedido.motoboyId || "Não informado"}</p>
        <p>Restaurante: ${pedido.restauranteNome || "Não informado"}</p>
        <p>Entrega: ${pedido.enderecoEntrega || "Não informado"}</p>
        <p>Data: ${dataTexto(pedido.entregueAt || pedido.updatedAt || pedido.createdAt)}</p>

        <div class="status-row">
          ${
            pago
              ? `<span class="badge green">Pago</span>`
              : `<span class="badge yellow">Pendente</span>`
          }
        </div>
      </div>
    `;

    lista.appendChild(card);
  });
}

function renderizarHistoricoPagamentos() {
  const lista = document.getElementById("historicoPagamentosMotoboy");
  if (!lista) return;

  lista.innerHTML = "";

  const historico = pagamentosCache
    .slice()
    .sort((a, b) => {
      const dataA = dataDoPagamento(a)?.getTime?.() || 0;
      const dataB = dataDoPagamento(b)?.getTime?.() || 0;
      return dataB - dataA;
    });

  if (historico.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhum pagamento registrado ainda.</div>`;
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
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${pagamento.motoboyNome || nomeMotoboy(pagamento.motoboyId)}</strong>

        <p>Pagamento ID: ${pagamento.id}</p>
        <p>Motoboy ID: ${pagamento.motoboyId || "Não informado"}</p>
        <p>Valor pago: <b>${dinheiro(valor)}</b></p>
        <p>Entregas pagas: ${pagamento.totalEntregas || pagamento.entregas || 0}</p>
        <p>Pago em: ${dataTexto(pagamento.pagoAt || pagamento.createdAt)}</p>
        <p>Período: ${periodoInicio} até ${periodoFim}</p>

        <div class="status-row">
          <span class="badge green">Pago</span>
          ${valor <= 0 ? `<span class="badge yellow">Registro antigo sem valor</span>` : ""}
        </div>
      </div>
    `;

    lista.appendChild(card);
  });
}

function buscarLedgerDoPedido(pedidoId) {
  return ledgerCache.filter((item) => item.pedidoId === pedidoId);
}

async function marcarGrupoComoPago(grupo) {
  const uidAdmin = auth.currentUser?.uid;

  if (!uidAdmin) {
    throw new Error("Admin não autenticado.");
  }

  const pagamentoRef = doc(collection(db, "pagamentos_motoboy"));
  const motoboyRef = doc(db, "motoboys", grupo.motoboyId);

  await runTransaction(db, async (transaction) => {
    const motoboySnap = await transaction.get(motoboyRef);

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy não encontrado.");
    }

    const motoboy = motoboySnap.data();

    const saldoAtual = numero(motoboy.saldo, 0);
    const valorPago = numero(grupo.total, 0);
    const novoSaldo = Math.max(0, saldoAtual - valorPago);

    transaction.set(pagamentoRef, {
      motoboyId: grupo.motoboyId,
      motoboyNome: grupo.motoboyNome,
      telefone: grupo.telefone,

      valorTotal: valorPago,
      valorTotalSemana: valorPago,
      totalEntregas: grupo.entregas,

      periodoInicio: dataCurta(grupo.primeiraData),
      periodoFim: dataCurta(grupo.ultimaData),

      pedidoIds: grupo.pedidos.map((pedido) => pedido.id),

      status: "pago",
      pago: true,
      pagoAt: serverTimestamp(),
      pagoPor: uidAdmin,

      createdAt: serverTimestamp()
    });

    grupo.pedidos.forEach((pedido) => {
      const pedidoRef = doc(db, "pedidos", pedido.id);

      transaction.update(pedidoRef, {
        pagamentoMotoboyPago: true,
        pagamentoMotoboyStatus: "pago",
        pagamentoMotoboyId: pagamentoRef.id,
        pagamentoMotoboyPagoAt: serverTimestamp(),
        pagamentoMotoboyPagoPor: uidAdmin,
        updatedAt: serverTimestamp()
      });

      const ledgersDoPedido = buscarLedgerDoPedido(pedido.id);

      ledgersDoPedido.forEach((ledger) => {
        const ledgerRef = doc(db, "ledger_motoboy", ledger.id);

        transaction.update(ledgerRef, {
          statusPagamento: "pago",
          pagamentoId: pagamentoRef.id,
          pago: true,
          pagoAt: serverTimestamp(),
          pagoPor: uidAdmin
        });
      });
    });

    transaction.update(motoboyRef, {
      saldo: novoSaldo,
      ultimoPagamentoAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}

function renderizarTudo() {
  renderizarPagamentosPendentes();
  renderizarEntregasPeriodo();
  renderizarHistoricoPagamentos();
}

function escutarMotoboys() {
  onSnapshot(query(collection(db, "motoboys")), (snapshot) => {
    motoboysCache = {};

    snapshot.forEach((docSnap) => {
      motoboysCache[docSnap.id] = {
        id: docSnap.id,
        ...docSnap.data()
      };
    });

    atualizarSelectMotoboys();
    renderizarTudo();
  });
}

function escutarPedidos() {
  onSnapshot(query(collection(db, "pedidos")), (snapshot) => {
    pedidosCache = [];

    snapshot.forEach((docSnap) => {
      pedidosCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarTudo();
  });
}

function escutarLedgerMotoboy() {
  onSnapshot(query(collection(db, "ledger_motoboy")), (snapshot) => {
    ledgerCache = [];

    snapshot.forEach((docSnap) => {
      ledgerCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarTudo();
  });
}

function escutarPagamentosMotoboy() {
  onSnapshot(query(collection(db, "pagamentos_motoboy")), (snapshot) => {
    pagamentosCache = [];

    snapshot.forEach((docSnap) => {
      pagamentosCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    renderizarTudo();
  });
}

export function iniciarPagamentosMotoboyAdmin() {
  preencherDatasPadrao();

  escutarMotoboys();
  escutarPedidos();
  escutarLedgerMotoboy();
  escutarPagamentosMotoboy();
}

export function filtrarPagamentosMotoboyAdmin() {
  renderizarTudo();
}
