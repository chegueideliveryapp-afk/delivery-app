import { db } from "./firebase.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const estado = {
  motoboys: [],
  restaurantes: [],
  pedidos: [],
  recargas: [],
  ledgerMotoboy: []
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

function contar(lista, filtro) {
  return lista.filter(filtro).length;
}

function soma(lista, campoOuFuncao) {
  return lista.reduce((total, item) => {
    const valor = typeof campoOuFuncao === "function"
      ? campoOuFuncao(item)
      : item[campoOuFuncao];

    return total + Number(valor || 0);
  }, 0);
}

function cardResumo(titulo, valor, texto, classe = "gray") {
  return `
    <div class="list-card">
      <div>
        <strong>${valor}</strong>
        <p>${titulo}</p>
        <div class="status-row">
          <span class="badge ${classe}">${texto}</span>
        </div>
      </div>
    </div>
  `;
}

function renderizarResumo() {
  const totalMotoboys = estado.motoboys.length;
  const motoboysOnline = contar(estado.motoboys, (m) => m.online === true);
  const motoboysPendentes = contar(estado.motoboys, (m) => m.statusCadastro === "pendente" || m.aprovado !== true);

  const restaurantesAtivos = contar(
    estado.restaurantes,
    (r) => r.ativo !== false && r.bloqueado !== true
  );

  const saldoRestaurantes = soma(
    estado.restaurantes,
    (r) => r.saldoPrePago || 0
  );

  const pedidosPendentes = contar(estado.pedidos, (p) => p.status === "pendente");
  const pedidosAceitos = contar(estado.pedidos, (p) => p.status === "aceito");
  const pedidosEntregues = contar(estado.pedidos, (p) => p.status === "entregue");

  const recargasPendentes = contar(estado.recargas, (r) => r.status === "pendente");

  const valorMotoboyAberto = soma(
    estado.ledgerMotoboy.filter((l) => l.pago !== true),
    (l) => l.valor || 0
  );

  setHtml(
    "resumoAdmin",
    `
      ${cardResumo("Motoboys cadastrados", totalMotoboys, "Base de entregadores", "gray")}
      ${cardResumo("Motoboys online", motoboysOnline, "Disponíveis agora", motoboysOnline > 0 ? "green" : "yellow")}
      ${cardResumo("Motoboys pendentes", motoboysPendentes, "Aguardando aprovação", motoboysPendentes > 0 ? "yellow" : "green")}
      ${cardResumo("Restaurantes ativos", restaurantesAtivos, "Operando na plataforma", "green")}
      ${cardResumo("Saldo dos restaurantes", dinheiro(saldoRestaurantes), "Pré-pago disponível", "green")}
      ${cardResumo("Pedidos pendentes", pedidosPendentes, "Buscando motoboy", pedidosPendentes > 0 ? "yellow" : "gray")}
      ${cardResumo("Pedidos aceitos", pedidosAceitos, "Em andamento", pedidosAceitos > 0 ? "green" : "gray")}
      ${cardResumo("Pedidos entregues", pedidosEntregues, "Finalizados", "green")}
      ${cardResumo("Recargas pendentes", recargasPendentes, "Precisam aprovação", recargasPendentes > 0 ? "yellow" : "green")}
      ${cardResumo("A pagar motoboys", dinheiro(valorMotoboyAberto), "Entregas não pagas", valorMotoboyAberto > 0 ? "yellow" : "green")}
    `
  );

  renderizarAlertas({
    motoboysPendentes,
    recargasPendentes,
    pedidosPendentes,
    pedidosAceitos,
    valorMotoboyAberto
  });
}

function renderizarAlertas(info) {
  const alertas = [];

  if (info.motoboysPendentes > 0) {
    alertas.push(`
      <div class="list-card">
        <div>
          <strong>${info.motoboysPendentes} motoboy(s) aguardando aprovação</strong>
          <p>Entre em Motoboys para aprovar ou bloquear cadastros.</p>
          <div class="status-row">
            <span class="badge yellow">Cadastro pendente</span>
          </div>
        </div>

        <div class="actions">
          <a class="topbar-link" href="./motoboys.html">Ver</a>
        </div>
      </div>
    `);
  }

  if (info.recargasPendentes > 0) {
    alertas.push(`
      <div class="list-card">
        <div>
          <strong>${info.recargasPendentes} recarga(s) Pix pendente(s)</strong>
          <p>Confira comprovantes e aprove manualmente.</p>
          <div class="status-row">
            <span class="badge yellow">Financeiro</span>
          </div>
        </div>

        <div class="actions">
          <a class="topbar-link" href="./recargas.html">Ver</a>
        </div>
      </div>
    `);
  }

  if (info.pedidosPendentes > 0) {
    alertas.push(`
      <div class="list-card">
        <div>
          <strong>${info.pedidosPendentes} pedido(s) procurando motoboy</strong>
          <p>Pedidos ainda pendentes aguardando aceite.</p>
          <div class="status-row">
            <span class="badge yellow">Operação</span>
          </div>
        </div>

        <div class="actions">
          <a class="topbar-link" href="./pedidos.html">Ver</a>
        </div>
      </div>
    `);
  }

  if (info.pedidosAceitos > 0) {
    alertas.push(`
      <div class="list-card">
        <div>
          <strong>${info.pedidosAceitos} corrida(s) em andamento</strong>
          <p>Acompanhe pedidos aceitos e motoboys em rota.</p>
          <div class="status-row">
            <span class="badge green">Em rota</span>
          </div>
        </div>

        <div class="actions">
          <a class="topbar-link" href="./pedidos.html">Ver</a>
        </div>
      </div>
    `);
  }

  if (info.valorMotoboyAberto > 0) {
    alertas.push(`
      <div class="list-card">
        <div>
          <strong>${dinheiro(info.valorMotoboyAberto)} em aberto para motoboys</strong>
          <p>Valores acumulados para pagamento semanal.</p>
          <div class="status-row">
            <span class="badge yellow">Pagamento segunda-feira</span>
          </div>
        </div>

        <div class="actions">
          <a class="topbar-link" href="./pagamentos.html">Ver</a>
        </div>
      </div>
    `);
  }

  if (!alertas.length) {
    setHtml(
      "alertasAdmin",
      `<div class="empty">Nenhum alerta importante no momento.</div>`
    );
    return;
  }

  setHtml("alertasAdmin", alertas.join(""));
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

      renderizarResumo();
    },
    (erro) => {
      console.error(`Erro ao carregar ${nomeColecao}:`, erro);
    }
  );
}

export function carregarDashboardAdmin() {
  setHtml("resumoAdmin", `<div class="empty">Carregando resumo...</div>`);
  setHtml("alertasAdmin", `<div class="empty">Carregando alertas...</div>`);

  escutarColecao("motoboys", "motoboys");
  escutarColecao("restaurantes", "restaurantes");
  escutarColecao("pedidos", "pedidos");
  escutarColecao("recargas_restaurante", "recargas");
  escutarColecao("ledger_motoboy", "ledgerMotoboy");
}
