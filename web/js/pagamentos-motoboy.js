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
let semanaBase = new Date();

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
  if (!timestamp?.toDate) return "Data nao informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function dataCurta(data) {
  if (!data) return "Nao informado";
  return data.toLocaleDateString("pt-BR");
}

function formatarDataInput(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

function obterInicioSemana(dataReferencia) {
  const data = new Date(dataReferencia);
  const dia = data.getDay();
  const diferenca = dia === 0 ? -6 : 1 - dia;

  data.setDate(data.getDate() + diferenca);
  data.setHours(0, 0, 0, 0);

  return data;
}

function obterFimSemana(dataReferencia) {
  const inicio = obterInicioSemana(dataReferencia);
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

function aplicarSemanaNaTela(dataReferencia) {
  semanaBase = new Date(dataReferencia);

  const inicio = obterInicioSemana(semanaBase);
  const fim = obterFimSemana(semanaBase);

  const dataInicio = document.getElementById("dataInicio");
  const dataFim = document.getElementById("dataFim");

  if (dataInicio) dataInicio.value = formatarDataInput(inicio);
  if (dataFim) dataFim.value = formatarDataInput(fim);

  atualizarResumoSemana();
  renderizarTudo();
}

function atualizarResumoSemana() {
  const inicio = parseDataInicio(document.getElementById("dataInicio")?.value);
  const fim = parseDataFim(document.getElementById("dataFim")?.value);

  const semanaResumo = document.getElementById("semanaResumo");
  const semanaDescricao = document.getElementById("semanaDescricao");

  if (semanaResumo) {
    semanaResumo.innerText = `${dataCurta(inicio)} ate ${dataCurta(fim)}`;
  }

  if (semanaDescricao) {
    semanaDescricao.innerText =
      `Voce esta conferindo as entregas finalizadas de segunda-feira (${dataCurta(inicio)}) ate domingo (${dataCurta(fim)}).`;
  }
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
    "Motoboy nao informado"
  );
}

function telefoneMotoboy(motoboyId) {
  return motoboysCache[motoboyId]?.telefone || "Telefone nao informado";
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

function ledgerDoPedido(pedidoId) {
  return ledgerCache.filter((ledger) => ledger.pedidoId === pedidoId);
}

function pagamentoContemLedgerDoPedido(pagamento, pedidoId) {
  if (!Array.isArray(pagamento.ledgerIds)) return false;

  const ledgersDoPedido = ledgerDoPedido(pedidoId);

  return ledgersDoPedido.some((ledger) => {
    return pagamento.ledgerIds.includes(ledger.id);
  });
}

function pedidoFoiPagoPorPagamento(pedido) {
  return pagamentosCache.some((pagamento) => {
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

  return ledgersDoPedido.some((ledger) => ledgerFoiPago(ledger));
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

function pedidoFoiEstornado(pedido) {
  return (
    pedido.estornado === true ||
    pedido.pagamentoMotoboyEstornado === true ||
    pedido.pagamentoMotoboyStatus === "estornado" ||
    pedido.statusFinanceiroMotoboy === "estornado"
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
    !pedidoFoiEstornado(pedido) &&
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

function pedidosDaSemana() {
  const dataInicio = parseDataInicio(document.getElementById("dataInicio")?.value);
  const dataFim = parseDataFim(document.getElementById("dataFim")?.value);
  const filtroMotoboy = document.getElementById("filtroMotoboy")?.value || "";

  return pedidosCache
    .filter(pedidoEntregueComValorMotoboy)
    .filter((pedido) => dentroDoPeriodoPorData(dataDoPedido(pedido), dataInicio, dataFim))
    .filter((pedido) => !filtroMotoboy || pedido.motoboyId === filtroMotoboy);
}

function pedidosEstornadosDaSemana() {
  return pedidosDaSemana()
    .filter(pedidoFoiEstornado)
    .sort((a, b) => {
      const dataA = dataDoPedido(a)?.getTime?.() || 0;
      const dataB = dataDoPedido(b)?.getTime?.() || 0;
      return dataB - dataA;
    });
}

function agruparPendentesDaSemana() {
  const grupos = {};

  pedidosDaSemana()
    .filter(pedidoPendentePagamento)
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
          ultimaData: null
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

function garantirBlocoEstornadas() {
  let lista = document.getElementById("listaEntregasEstornadas");
  if (lista) return lista;

  const referencia = document.getElementById("listaEntregasPeriodo");
  if (!referencia) return null;

  const painelReferencia = referencia.closest(".panel");
  if (!painelReferencia) return null;

  const painel = document.createElement("section");
  painel.className = "panel";
  painel.innerHTML = `
    <h2>Entregas estornadas</h2>
    <p class="hint">
      Entregas removidas do pagamento do motoboy e devolvidas ao saldo do restaurante.
    </p>
    <div id="listaEntregasEstornadas">
      <div class="empty">Carregando entregas estornadas...</div>
    </div>
  `;

  painelReferencia.after(painel);

  return document.getElementById("listaEntregasEstornadas");
}

function renderizarPagamentosPendentes() {
  const lista = document.getElementById("listaPagamentosMotoboy");
  const resumo = document.getElementById("resumoPagamentos");

  if (!lista) return;

  atualizarResumoSemana();

  const grupos = agruparPendentesDaSemana();

  const totalGeral = grupos.reduce((acc, grupo) => acc + numero(grupo.total, 0), 0);
  const totalEntregas = grupos.reduce((acc, grupo) => acc + numero(grupo.entregas, 0), 0);

  if (resumo) {
    resumo.innerText =
      `${dinheiro(totalGeral)} a pagar nesta semana, ${totalEntregas} entrega(s), agrupado em ${grupos.length} motoboy(s).`;
  }

  lista.innerHTML = "";

  if (grupos.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhum pagamento pendente nesta semana.</div>`;
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
        <p>Total a pagar nesta semana: <b>${dinheiro(grupo.total)}</b></p>
        <p>Entregas pendentes nesta semana: ${grupo.entregas}</p>
        <p>Periodo: ${dataCurta(grupo.primeiraData)} ate ${dataCurta(grupo.ultimaData)}</p>

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
        `Confirmar pagamento semanal para ${grupo.motoboyNome}?\n\nValor: ${dinheiro(grupo.total)}\nEntregas: ${grupo.entregas}\nPeriodo: ${dataCurta(grupo.primeiraData)} ate ${dataCurta(grupo.ultimaData)}`
      );

      if (!confirmar) return;

      button.disabled = true;
      button.innerText = "Pagando...";

      try {
        await marcarGrupoComoPago(grupo);
        alert("Pagamento semanal marcado como realizado.");
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

  const entregas = pedidosDaSemana().sort((a, b) => {
    const dataA = dataDoPedido(a)?.getTime?.() || 0;
    const dataB = dataDoPedido(b)?.getTime?.() || 0;
    return dataB - dataA;
  });

  lista.innerHTML = "";

  if (entregas.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhuma entrega encontrada nesta semana.</div>`;
    return;
  }

  entregas.forEach((pedido) => {
    const pago = pedidoFoiPagoAoMotoboy(pedido);
    const estornado = pedidoFoiEstornado(pedido);

    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${nomeMotoboy(pedido.motoboyId, pedido.motoboyNome)}</strong>

        <p>Valor motoboy: <b>${dinheiro(pedido.valorMotoboy)}</b></p>
        <p>Pedido ID: ${pedido.id}</p>
        <p>Motoboy ID: ${pedido.motoboyId || "Nao informado"}</p>
        <p>Restaurante: ${pedido.restauranteNome || "Nao informado"}</p>
        <p>Entrega: ${pedido.enderecoEntrega || "Nao informado"}</p>
        <p>Data: ${dataTexto(pedido.entregueAt || pedido.updatedAt || pedido.createdAt)}</p>

        ${
          estornado && pedido.motivoEstorno
            ? `<p>Motivo do estorno: ${pedido.motivoEstorno}</p>`
            : ""
        }

        <div class="status-row">
          ${
            estornado
              ? `<span class="badge red">Estornado</span>`
              : pago
                ? `<span class="badge green">Pago</span>`
                : `<span class="badge yellow">Pendente nesta semana</span>`
          }
        </div>
      </div>
    `;

    lista.appendChild(card);
  });
}

function renderizarEntregasEstornadas() {
  const lista = garantirBlocoEstornadas();
  if (!lista) return;

  const entregas = pedidosEstornadosDaSemana();

  lista.innerHTML = "";

  if (entregas.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhuma entrega estornada nesta semana.</div>`;
    return;
  }

  entregas.forEach((pedido) => {
    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${nomeMotoboy(pedido.motoboyId, pedido.motoboyNome)}</strong>

        <p>Pedido ID: ${pedido.id}</p>
        <p>Restaurante: ${pedido.restauranteNome || "Nao informado"}</p>
        <p>Entrega: ${pedido.enderecoEntrega || "Nao informado"}</p>
        <p>Valor removido do motoboy: <b>${dinheiro(pedido.valorMotoboy)}</b></p>
        <p>Total devolvido ao restaurante: <b>${dinheiro(pedido.valorTotal)}</b></p>
        <p>Entregue em: ${dataTexto(pedido.entregueAt || pedido.updatedAt || pedido.createdAt)}</p>
        <p>Estornado em: ${dataTexto(pedido.estornadoAt)}</p>
        <p>Motivo: ${pedido.motivoEstorno || "Motivo nao informado"}</p>

        <div class="status-row">
          <span class="badge red">Estornado</span>
          <span class="badge gray">Nao entra no pagamento</span>
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
      "Nao informado";

    const periodoFim =
      pagamento.periodoFim ||
      pagamento.fimSemanaTexto ||
      "Nao informado";

    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${pagamento.motoboyNome || nomeMotoboy(pagamento.motoboyId)}</strong>

        <p>Pagamento ID: ${pagamento.id}</p>
        <p>Motoboy ID: ${pagamento.motoboyId || "Nao informado"}</p>
        <p>Valor pago: <b>${dinheiro(valor)}</b></p>
        <p>Entregas pagas: ${pagamento.totalEntregas || pagamento.entregas || 0}</p>
        <p>Pago em: ${dataTexto(pagamento.pagoAt || pagamento.createdAt)}</p>
        <p>Periodo pago: ${periodoInicio} ate ${periodoFim}</p>

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
    throw new Error("Admin nao autenticado.");
  }

  const pagamentoRef = doc(collection(db, "pagamentos_motoboy"));
  const motoboyRef = doc(db, "motoboys", grupo.motoboyId);

  await runTransaction(db, async (transaction) => {
    const motoboySnap = await transaction.get(motoboyRef);

    if (!motoboySnap.exists()) {
      throw new Error("Motoboy nao encontrado.");
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
  renderizarEntregasEstornadas();
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
  aplicarSemanaNaTela(new Date());

  escutarMotoboys();
  escutarPedidos();
  escutarLedgerMotoboy();
  escutarPagamentosMotoboy();
}

export function filtrarPagamentosMotoboyAdmin() {
  atualizarResumoSemana();
  renderizarTudo();
}

export function irParaSemanaAnterior() {
  const novaData = new Date(semanaBase);
  novaData.setDate(novaData.getDate() - 7);
  aplicarSemanaNaTela(novaData);
}

export function irParaSemanaAtual() {
  aplicarSemanaNaTela(new Date());
}

export function irParaProximaSemana() {
  const novaData = new Date(semanaBase);
  novaData.setDate(novaData.getDate() + 7);
  aplicarSemanaNaTela(novaData);
}
