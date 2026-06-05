import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let motoboysCache = {};
let ledgerCache = [];
let pagamentosCache = [];

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function numero(valor, padrao = 0) {
  const n = Number(valor || padrao);
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

function dataDoLedger(item) {
  return (
    item.createdAt?.toDate?.() ||
    item.entregueAt?.toDate?.() ||
    item.pagoAt?.toDate?.() ||
    null
  );
}

function dentroDoPeriodo(item, inicio, fim) {
  const data = dataDoLedger(item);

  if (!data) return true;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;

  return true;
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

function entregaFoiPaga(item) {
  return (
    item.statusPagamento === "pago" ||
    item.pago === true ||
    item.pagamentoId
  );
}

function tipoLedgerValido(item) {
  return (
    item.tipo === "entrega" ||
    item.tipo === "credito_entrega" ||
    item.tipo === "finalizacao_entrega" ||
    !item.tipo
  );
}

function ehLedgerPendente(item) {
  return (
    item.motoboyId &&
    tipoLedgerValido(item) &&
    numero(item.valor, 0) > 0 &&
    !entregaFoiPaga(item)
  );
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

function criarGrupoBase(motoboyId, motoboyNome = "") {
  return {
    motoboyId,
    motoboyNome: nomeMotoboy(motoboyId, motoboyNome),
    telefone: telefoneMotoboy(motoboyId),
    total: 0,
    entregas: 0,
    itens: [],
    primeiraData: null,
    ultimaData: null,
    origem: "ledger"
  };
}

function adicionarLedgerAoGrupo(grupo, item) {
  const valor = numero(item.valor, 0);
  const data = dataDoLedger(item);

  grupo.total += valor;
  grupo.entregas += 1;
  grupo.itens.push(item);

  if (data) {
    if (!grupo.primeiraData || data < grupo.primeiraData) {
      grupo.primeiraData = data;
    }

    if (!grupo.ultimaData || data > grupo.ultimaData) {
      grupo.ultimaData = data;
    }
  }
}

function agruparPendentes() {
  const dataInicio = parseDataInicio(document.getElementById("dataInicio")?.value);
  const dataFim = parseDataFim(document.getElementById("dataFim")?.value);
  const filtroMotoboy = document.getElementById("filtroMotoboy")?.value || "";

  const grupos = {};

  ledgerCache
    .filter(ehLedgerPendente)
    .filter((item) => dentroDoPeriodo(item, dataInicio, dataFim))
    .filter((item) => !filtroMotoboy || item.motoboyId === filtroMotoboy)
    .forEach((item) => {
      if (!grupos[item.motoboyId]) {
        grupos[item.motoboyId] = criarGrupoBase(item.motoboyId, item.motoboyNome);
      }

      adicionarLedgerAoGrupo(grupos[item.motoboyId], item);
    });

  Object.entries(motoboysCache).forEach(([motoboyId, motoboy]) => {
    if (filtroMotoboy && motoboyId !== filtroMotoboy) return;

    const saldo = numero(motoboy.saldo, 0);

    if (saldo <= 0) return;
    if (grupos[motoboyId]) return;

    grupos[motoboyId] = {
      motoboyId,
      motoboyNome: motoboy.nome || "Motoboy não informado",
      telefone: motoboy.telefone || "Telefone não informado",
      total: saldo,
      entregas: 0,
      itens: [],
      primeiraData: dataInicio,
      ultimaData: dataFim,
      origem: "saldo"
    };
  });

  return Object.values(grupos)
    .filter((grupo) => numero(grupo.total, 0) > 0)
    .sort((a, b) => b.total - a.total);
}

function renderizarPagamentosPendentes() {
  const lista = document.getElementById("listaPagamentosMotoboy");
  const resumo = document.getElementById("resumoPagamentos");

  if (!lista) return;

  const grupos = agruparPendentes();

  const totalGeral = grupos.reduce((acc, grupo) => acc + numero(grupo.total, 0), 0);
  const totalEntregas = grupos.reduce((acc, grupo) => acc + numero(grupo.entregas, 0), 0);

  if (resumo) {
    resumo.innerText =
      `${dinheiro(totalGeral)} a pagar em ${totalEntregas} entrega(s), agrupado em ${grupos.length} motoboy(s).`;
  }

  lista.innerHTML = "";

  if (grupos.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhum pagamento pendente neste período.</div>`;
    return;
  }

  grupos.forEach((grupo) => {
    const inicio = dataCurta(grupo.primeiraData);
    const fim = dataCurta(grupo.ultimaData);

    const origemTexto = grupo.origem === "saldo"
      ? "Baseado no saldo atual do motoboy"
      : "Baseado nas entregas finalizadas";

    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${grupo.motoboyNome}</strong>

        <p>Telefone: ${grupo.telefone}</p>
        <p>Total a pagar: <b>${dinheiro(grupo.total)}</b></p>
        <p>Entregas no período: ${grupo.entregas}</p>
        <p>Período: ${inicio} até ${fim}</p>
        <p>Origem: ${origemTexto}</p>

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

function renderizarHistoricoPagamentos() {
  const lista = document.getElementById("historicoPagamentosMotoboy");
  if (!lista) return;

  lista.innerHTML = "";

  const historico = pagamentosCache
    .slice()
    .sort((a, b) => {
      const dataA = a.pagoAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
      const dataB = b.pagoAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
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

      ledgerIds: grupo.itens.map((item) => item.id),
      origem: grupo.origem,

      status: "pago",
      pago: true,
      pagoAt: serverTimestamp(),
      pagoPor: uidAdmin,

      createdAt: serverTimestamp()
    });

    grupo.itens.forEach((item) => {
      const ledgerRef = doc(db, "ledger_motoboy", item.id);

      transaction.update(ledgerRef, {
        statusPagamento: "pago",
        pagamentoId: pagamentoRef.id,
        pago: true,
        pagoAt: serverTimestamp(),
        pagoPor: uidAdmin
      });
    });

    transaction.update(motoboyRef, {
      saldo: novoSaldo,
      ultimoPagamentoAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
}

async function carregarMotoboysUmaVez() {
  const motoboysSnap = await getDocs(collection(db, "motoboys"));

  motoboysCache = {};

  motoboysSnap.forEach((docSnap) => {
    motoboysCache[docSnap.id] = {
      id: docSnap.id,
      ...docSnap.data()
    };
  });

  atualizarSelectMotoboys();
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
    renderizarPagamentosPendentes();
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

    renderizarPagamentosPendentes();
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

    renderizarHistoricoPagamentos();
  });
}

export async function iniciarPagamentosMotoboyAdmin() {
  preencherDatasPadrao();

  await carregarMotoboysUmaVez();

  escutarMotoboys();
  escutarLedgerMotoboy();
  escutarPagamentosMotoboy();
}

export function filtrarPagamentosMotoboyAdmin() {
  renderizarPagamentosPendentes();
}
