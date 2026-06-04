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
  ledgerMotoboy: [],
  ledgerRestaurante: [],
  pagamentosMotoboy: []
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

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function timestampDentroPeriodo(timestamp, inicio, fim) {
  if (!timestamp?.toDate) return false;

  const data = timestamp.toDate();

  return data >= inicio && data <= fim;
}

function obterPeriodoSelecionado() {
  const inicioInput = document.getElementById("dataInicioRelatorio")?.value;
  const fimInput = document.getElementById("dataFimRelatorio")?.value;

  const hoje = new Date();

  let inicio;
  let fim;

  if (inicioInput) {
    inicio = new Date(`${inicioInput}T00:00:00`);
  } else {
    inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
  }

  if (fimInput) {
    fim = new Date(`${fimInput}T23:59:59`);
  } else {
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return { inicio, fim };
}

function preencherDatasPadrao() {
  const inicio = document.getElementById("dataInicioRelatorio");
  const fim = document.getElementById("dataFimRelatorio");

  if (!inicio || !fim) return;

  const hoje = new Date();
  const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  if (!inicio.value) {
    inicio.value = primeiroDia.toISOString().slice(0, 10);
  }

  if (!fim.value) {
    fim.value = ultimoDia.toISOString().slice(0, 10);
  }
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
  const motoboysPendentes = contar(
    estado.motoboys,
    (m) => m.statusCadastro === "pendente" || m.aprovado !== true
  );

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

function calcularDadosRestaurante(restaurante, inicio, fim) {
  const restauranteId = restaurante.id;

  const debitosPedido = estado.ledgerRestaurante.filter((l) => {
    return l.restauranteId === restauranteId
      && l.tipo === "debito_pedido"
      && timestampDentroPeriodo(l.createdAt, inicio, fim);
  });

  const recargasAprovadas = estado.recargas.filter((r) => {
    return r.restauranteId === restauranteId
      && r.status === "aprovada"
      && timestampDentroPeriodo(r.aprovadoAt || r.solicitadoAt, inicio, fim);
  });

  const pedidosPeriodo = estado.pedidos.filter((p) => {
    return p.restauranteId === restauranteId
      && timestampDentroPeriodo(p.createdAt, inicio, fim);
  });

  return {
    creditoUsado: Math.abs(soma(debitosPedido, (l) => l.valor || 0)),
    totalRecargas: soma(recargasAprovadas, (r) => r.valor || 0),
    totalPedidos: pedidosPeriodo.length,
    saldoAtual: Number(restaurante.saldoPrePago || 0)
  };
}

function passaFiltroStatusRestaurante(restaurante, status) {
  if (status === "todos") return true;
  if (status === "ativo") return restaurante.ativo !== false;
  if (status === "inativo") return restaurante.ativo === false;
  if (status === "bloqueado") return restaurante.bloqueado === true;
  if (status === "liberado") return restaurante.bloqueado !== true;
  return true;
}

function ordenarRestaurantes(lista, ordenacao) {
  return lista.sort((a, b) => {
    if (ordenacao === "creditoUsado") return b.metricas.creditoUsado - a.metricas.creditoUsado;
    if (ordenacao === "recargas") return b.metricas.totalRecargas - a.metricas.totalRecargas;
    if (ordenacao === "saldoAtual") return b.metricas.saldoAtual - a.metricas.saldoAtual;
    if (ordenacao === "pedidos") return b.metricas.totalPedidos - a.metricas.totalPedidos;

    return normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome));
  });
}

function renderizarRelatorioRestaurantes() {
  const { inicio, fim } = obterPeriodoSelecionado();

  const busca = normalizarTexto(
    document.getElementById("buscaRestauranteRelatorio")?.value
  );

  const statusFiltro = document.getElementById("statusRestauranteRelatorio")?.value || "todos";
  const ordenacao = document.getElementById("ordenacaoRestauranteRelatorio")?.value || "nome";

  let restaurantes = estado.restaurantes
    .filter((r) => passaFiltroStatusRestaurante(r, statusFiltro))
    .filter((r) => {
      if (!busca) return true;

      return normalizarTexto(r.nome).includes(busca)
        || normalizarTexto(r.email).includes(busca)
        || normalizarTexto(r.telefone).includes(busca);
    })
    .map((r) => ({
      ...r,
      metricas: calcularDadosRestaurante(r, inicio, fim)
    }));

  restaurantes = ordenarRestaurantes(restaurantes, ordenacao);

  if (!restaurantes.length) {
    setHtml(
      "relatorioRestaurantes",
      `<div class="empty">Nenhum restaurante encontrado para o filtro informado.</div>`
    );
    return;
  }

  const totalCreditoUsado = soma(restaurantes, (r) => r.metricas.creditoUsado);
  const totalRecargas = soma(restaurantes, (r) => r.metricas.totalRecargas);
  const totalPedidos = soma(restaurantes, (r) => r.metricas.totalPedidos);

  const resumo = `
    <div class="list-card">
      <div>
        <strong>Resumo dos restaurantes filtrados</strong>
        <p>Restaurantes encontrados: ${restaurantes.length}</p>
        <p>Crédito usado no período: ${dinheiro(totalCreditoUsado)}</p>
        <p>Recargas aprovadas no período: ${dinheiro(totalRecargas)}</p>
        <p>Pedidos no período: ${totalPedidos}</p>
      </div>
    </div>
  `;

  const cards = restaurantes.map((restaurante) => {
    const m = restaurante.metricas;

    return `
      <div class="list-card">
        <div>
          <strong>${restaurante.nome || "Restaurante sem nome"}</strong>

          <p>Período: ${inicio.toLocaleDateString("pt-BR")} até ${fim.toLocaleDateString("pt-BR")}</p>
          <p>Crédito usado no período: ${dinheiro(m.creditoUsado)}</p>
          <p>Recargas aprovadas no período: ${dinheiro(m.totalRecargas)}</p>
          <p>Saldo atual: ${dinheiro(m.saldoAtual)}</p>
          <p>Pedidos criados no período: ${m.totalPedidos}</p>
          <p>E-mail: ${restaurante.email || "Não informado"}</p>
          <p>Telefone: ${restaurante.telefone || "Não informado"}</p>

          <div class="status-row">
            <span class="badge ${restaurante.ativo !== false ? "green" : "gray"}">
              ${restaurante.ativo !== false ? "Ativo" : "Inativo"}
            </span>

            <span class="badge ${restaurante.bloqueado ? "red" : "green"}">
              ${restaurante.bloqueado ? "Bloqueado" : "Liberado"}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  setHtml("relatorioRestaurantes", resumo + cards);
}

function calcularDadosMotoboy(motoboy, inicio, fim) {
  const motoboyId = motoboy.id;

  const entregasPeriodo = estado.ledgerMotoboy.filter((l) => {
    return l.motoboyId === motoboyId
      && l.tipo === "entrega"
      && timestampDentroPeriodo(l.createdAt, inicio, fim);
  });

  const pagamentosPeriodo = estado.pagamentosMotoboy.filter((p) => {
    return p.motoboyId === motoboyId
      && timestampDentroPeriodo(p.pagoAt || p.createdAt, inicio, fim);
  });

  const valorGerado = soma(entregasPeriodo, (l) => l.valor || 0);
  const valorPago = soma(pagamentosPeriodo, (p) => p.valorTotalSemana || 0);
  const valorAberto = soma(
    entregasPeriodo.filter((l) => l.pago !== true),
    (l) => l.valor || 0
  );

  const entregasPagas = entregasPeriodo.filter((l) => l.pago === true).length;
  const entregasAbertas = entregasPeriodo.filter((l) => l.pago !== true).length;

  return {
    valorGerado,
    valorPago,
    valorAberto,
    totalEntregas: entregasPeriodo.length,
    entregasPagas,
    entregasAbertas
  };
}

function passaFiltroStatusMotoboy(motoboy, status) {
  if (status === "todos") return true;
  if (status === "online") return motoboy.online === true;
  if (status === "offline") return motoboy.online !== true;
  if (status === "aprovado") return motoboy.aprovado === true;
  if (status === "pendente") return motoboy.aprovado !== true || motoboy.statusCadastro === "pendente";
  if (status === "bloqueado") return motoboy.bloqueado === true;
  if (status === "liberado") return motoboy.bloqueado !== true;
  return true;
}

function ordenarMotoboys(lista, ordenacao) {
  return lista.sort((a, b) => {
    if (ordenacao === "valorGerado") return b.metricas.valorGerado - a.metricas.valorGerado;
    if (ordenacao === "valorPago") return b.metricas.valorPago - a.metricas.valorPago;
    if (ordenacao === "valorAberto") return b.metricas.valorAberto - a.metricas.valorAberto;
    if (ordenacao === "entregas") return b.metricas.totalEntregas - a.metricas.totalEntregas;

    return normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome));
  });
}

function renderizarRelatorioMotoboys() {
  const { inicio, fim } = obterPeriodoSelecionado();

  const busca = normalizarTexto(
    document.getElementById("buscaMotoboyRelatorio")?.value
  );

  const statusFiltro = document.getElementById("statusMotoboyRelatorio")?.value || "todos";
  const ordenacao = document.getElementById("ordenacaoMotoboyRelatorio")?.value || "nome";

  let motoboys = estado.motoboys
    .filter((m) => passaFiltroStatusMotoboy(m, statusFiltro))
    .filter((m) => {
      if (!busca) return true;

      return normalizarTexto(m.nome).includes(busca)
        || normalizarTexto(m.cpf).includes(busca)
        || normalizarTexto(m.telefone).includes(busca);
    })
    .map((m) => ({
      ...m,
      metricas: calcularDadosMotoboy(m, inicio, fim)
    }));

  motoboys = ordenarMotoboys(motoboys, ordenacao);

  if (!motoboys.length) {
    setHtml(
      "relatorioMotoboys",
      `<div class="empty">Nenhum motoboy encontrado para o filtro informado.</div>`
    );
    return;
  }

  const totalGerado = soma(motoboys, (m) => m.metricas.valorGerado);
  const totalPago = soma(motoboys, (m) => m.metricas.valorPago);
  const totalAberto = soma(motoboys, (m) => m.metricas.valorAberto);
  const totalEntregas = soma(motoboys, (m) => m.metricas.totalEntregas);

  const resumo = `
    <div class="list-card">
      <div>
        <strong>Resumo dos motoboys filtrados</strong>
        <p>Motoboys encontrados: ${motoboys.length}</p>
        <p>Valor gerado no período: ${dinheiro(totalGerado)}</p>
        <p>Valor pago no período: ${dinheiro(totalPago)}</p>
        <p>Valor em aberto no período: ${dinheiro(totalAberto)}</p>
        <p>Entregas no período: ${totalEntregas}</p>
      </div>
    </div>
  `;

  const cards = motoboys.map((motoboy) => {
    const m = motoboy.metricas;

    return `
      <div class="list-card">
        <div>
          <strong>${motoboy.nome || "Motoboy sem nome"}</strong>

          <p>Período: ${inicio.toLocaleDateString("pt-BR")} até ${fim.toLocaleDateString("pt-BR")}</p>
          <p>Valor gerado em entregas: ${dinheiro(m.valorGerado)}</p>
          <p>Valor pago no período: ${dinheiro(m.valorPago)}</p>
          <p>Valor em aberto no período: ${dinheiro(m.valorAberto)}</p>
          <p>Saldo atual no cadastro: ${dinheiro(motoboy.saldo)}</p>
          <p>Entregas no período: ${m.totalEntregas}</p>
          <p>Entregas pagas: ${m.entregasPagas}</p>
          <p>Entregas em aberto: ${m.entregasAbertas}</p>
          <p>CPF: ${motoboy.cpf || "Não informado"}</p>
          <p>Telefone: ${motoboy.telefone || "Não informado"}</p>

          <div class="status-row">
            <span class="badge ${motoboy.online ? "green" : "gray"}">
              ${motoboy.online ? "Online" : "Offline"}
            </span>

            <span class="badge ${motoboy.aprovado === true ? "green" : "yellow"}">
              ${motoboy.aprovado === true ? "Aprovado" : "Pendente"}
            </span>

            <span class="badge ${motoboy.bloqueado ? "red" : "green"}">
              ${motoboy.bloqueado ? "Bloqueado" : "Liberado"}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  setHtml("relatorioMotoboys", resumo + cards);
}

function renderizarRelatorios() {
  renderizarRelatorioRestaurantes();
  renderizarRelatorioMotoboys();
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

function renderizarTudo() {
  renderizarResumo();
  renderizarRelatorios();
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

      renderizarTudo();
    },
    (erro) => {
      console.error(`Erro ao carregar ${nomeColecao}:`, erro);
    }
  );
}

function configurarFiltros() {
  preencherDatasPadrao();

  const ids = [
    "btnAplicarRelatorio",
    "buscaRestauranteRelatorio",
    "statusRestauranteRelatorio",
    "ordenacaoRestauranteRelatorio",
    "buscaMotoboyRelatorio",
    "statusMotoboyRelatorio",
    "ordenacaoMotoboyRelatorio",
    "dataInicioRelatorio",
    "dataFimRelatorio"
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);

    if (!el) return;

    el.addEventListener("input", renderizarRelatorios);
    el.addEventListener("change", renderizarRelatorios);
    el.addEventListener("click", () => {
      if (id === "btnAplicarRelatorio") {
        renderizarRelatorios();
      }
    });
  });
}

export function carregarDashboardAdmin() {
  setHtml("resumoAdmin", `<div class="empty">Carregando resumo...</div>`);
  setHtml("alertasAdmin", `<div class="empty">Carregando alertas...</div>`);
  setHtml("relatorioRestaurantes", `<div class="empty">Carregando restaurantes...</div>`);
  setHtml("relatorioMotoboys", `<div class="empty">Carregando motoboys...</div>`);

  configurarFiltros();

  escutarColecao("motoboys", "motoboys");
  escutarColecao("restaurantes", "restaurantes");
  escutarColecao("pedidos", "pedidos");
  escutarColecao("recargas_restaurante", "recargas");
  escutarColecao("ledger_motoboy", "ledgerMotoboy");
  escutarColecao("ledger_restaurante", "ledgerRestaurante");
  escutarColecao("pagamentos_motoboy", "pagamentosMotoboy");
}
