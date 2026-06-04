import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  getDoc,
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

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Data não informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
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

function formatarDataInput(data) {
  return data.toISOString().slice(0, 10);
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

function dentroDoPeriodo(item, inicio, fim) {
  const data = item.createdAt?.toDate?.();

  if (!data) return false;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;

  return true;
}

function ehPendentePagamento(item) {
  return item.statusPagamento !== "pago";
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

function agruparPendentes() {
  const dataInicio = parseDataInicio(document.getElementById("dataInicio")?.value);
  const dataFim = parseDataFim(document.getElementById("dataFim")?.value);
  const filtroMotoboy = document.getElementById("filtroMotoboy")?.value || "";

  const grupos = {};

  ledgerCache
    .filter((item) => item.motoboyId)
    .filter((item) => item.tipo === "credito_entrega" || item.tipo === "entrega")
    .filter((item) => ehPendentePagamento(item))
    .filter((item) => dentroDoPeriodo(item, dataInicio, dataFim))
    .filter((item) => !filtroMotoboy || item.motoboyId === filtroMotoboy)
    .forEach((item) => {
      if (!grupos[item.motoboyId]) {
        grupos[item.motoboyId] = {
          motoboyId: item.motoboyId,
          motoboyNome: nomeMotoboy(item.motoboyId, item.motoboyNome),
          telefone: telefoneMotoboy(item.motoboyId),
          total: 0,
          entregas: 0,
          itens: [],
          primeiraData: null,
          ultimaData: null
        };
      }

      const valor = Number(item.valor || 0);
      const data = item.createdAt?.toDate?.() || null;

      grupos[item.motoboyId].total += valor;
      grupos[item.motoboyId].entregas += 1;
      grupos[item.motoboyId].itens.push(item);

      if (data) {
        if (!grupos[item.motoboyId].primeiraData || data < grupos[item.motoboyId].primeiraData) {
          grupos[item.motoboyId].primeiraData = data;
        }

        if (!grupos[item.motoboyId].ultimaData || data > grupos[item.motoboyId].ultimaData) {
          grupos[item.motoboyId].ultimaData = data;
        }
      }
    });

  return Object.values(grupos).sort((a, b) => b.total - a.total);
}

function renderizarPagamentosPendentes() {
  const lista = document.getElementById("listaPagamentosMotoboy");
  const resumo = document.getElementById("resumoPagamentos");

  if (!lista) return;

  const grupos = agruparPendentes();

  const totalGeral = grupos.reduce((acc, grupo) => acc + grupo.total, 0);
  const totalEntregas = grupos.reduce((acc, grupo) => acc + grupo.entregas, 0);

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
    const inicio = grupo.primeiraData
      ? grupo.primeiraData.toLocaleDateString("pt-BR")
      : "Data não informada";

    const fim = grupo.ultimaData
      ? grupo.ultimaData.toLocaleDateString("pt-BR")
      : "Data não informada";

    const card = document.createElement("div");
    card.className = "list-card";

    card.innerHTML = `
      <div>
        <strong>${grupo.motoboyNome}</strong>

        <p>Telefone: ${grupo.telefone}</p>
        <p>Total a pagar: <b>${dinheiro(grupo.total)}</b></p>
        <p>Entregas no período: ${grupo.entregas}</p>
        <p>Período: ${inicio} até ${fim}</p>

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
        alert("Erro ao marcar pagamento.");
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

  if (pagamentosCache.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhum pagamento registrado ainda.</div>`;
    return;
  }

  pagamentosCache
    .slice()
    .sort((a, b) => {
      const dataA = a.pagoAt?.toMillis?.() || 0;
      const dataB = b.pagoAt?.toMillis?.() || 0;
      return dataB - dataA;
    })
    .forEach((pagamento) => {
      const card = document.createElement("div");
      card.className = "list-card";

      card.innerHTML = `
        <div>
          <strong>${pagamento.motoboyNome || nomeMotoboy(pagamento.motoboyId)}</strong>

          <p>Valor pago: <b>${dinheiro(pagamento.valorTotal)}</b></p>
          <p>Entregas pagas: ${pagamento.totalEntregas || 0}</p>
          <p>Pago em: ${dataTexto(pagamento.pagoAt)}</p>
          <p>Período: ${pagamento.periodoInicio || "Não informado"} até ${pagamento.periodoFim || "Não informado"}</p>

          <div class="status-row">
            <span class="badge green">Pago</span>
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
    const saldoAtual = Number(motoboy.saldo || 0);
    const valorPago = Number(grupo.total || 0);
    const novoSaldo = Math.max(0, saldoAtual - valorPago);

    transaction.set(pagamentoRef, {
      motoboyId: grupo.motoboyId,
      motoboyNome: grupo.motoboyNome,
      telefone: grupo.telefone,

      valorTotal: valorPago,
      totalEntregas: grupo.entregas,

      periodoInicio: grupo.primeiraData
        ? grupo.primeiraData.toLocaleDateString("pt-BR")
        : "",
      periodoFim: grupo.ultimaData
        ? grupo.ultimaData.toLocaleDateString("pt-BR")
        : "",

      ledgerIds: grupo.itens.map((item) => item.id),

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

export async function iniciarPagamentosMotoboyAdmin() {
  preencherDatasPadrao();

  const motoboysSnap = await getDocs(collection(db, "motoboys"));

  motoboysCache = {};

  motoboysSnap.forEach((docSnap) => {
    motoboysCache[docSnap.id] = {
      id: docSnap.id,
      ...docSnap.data()
    };
  });

  atualizarSelectMotoboys();

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

export function filtrarPagamentosMotoboyAdmin() {
  renderizarPagamentosPendentes();
}
