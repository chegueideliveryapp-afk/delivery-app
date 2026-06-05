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

function texto(valor) {
  return String(valor || "").toLowerCase().trim();
}

function dataInputHojeMenosDias(dias) {
  const data = new Date();
  data.setDate(data.getDate() - dias);

  return formatarDataInput(data);
}

function formatarDataInput(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
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

function dataDaRecarga(recarga) {
  return (
    recarga.aprovadoAt?.toDate?.() ||
    recarga.solicitadoAt?.toDate?.() ||
    recarga.createdAt?.toDate?.() ||
    null
  );
}

function dentroDoPeriodo(data, inicio, fim) {
  if (!data) return true;
  if (inicio && data < inicio) return false;
  if (fim && data > fim) return false;

  return true;
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

function valorPagamentoHistorico(pagamento) {
  return numero(
    pagamento.valorTotal ??
    pagamento.valorTotalSemana ??
    pagamento.valorPago ??
    pagamento.valor,
    0
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

function renderizarResumo() {
  const alvo = document.getElementById("resumoAdmin");
  if (!alvo) return;

  const motoboysOnline = motoboys.filter((m) => m.online === true).length;

  const motoboysPendentes = motoboys.filter((m) => {
    return m.statusCadastro === "pendente" || m.aprovado !== true;
  }).length;

  const restaurantesAtivos = restaurantes.filter((r) => {
    return r.ativo !== false && r.bloqueado !== true;
  }).length;

  const pedidosPendentes = pedidos.filter((p) => {
    return p.status === "pendente" ||
      p.status === "buscando_motoboy" ||
      p.status === "sem_motoboy";
  }).length;

  const pedidosAceitos = pedidos.filter((p) => p.status === "aceito").length;
  const pedidosEntregues = pedidos.filter((p) => p.status === "entregue").length;

  const recargasPendentes = recargas.filter((r) => r.status === "pendente").length;

  const saldoRestaurantes = calcularSaldoRestaurantes();
  const aPagarMotoboys = calcularAPagarMotoboys();

  alvo.innerHTML = `
    <div class="menu-card">
      <div>
        <strong>${motoboys.length}</strong>
        <p>Motoboys cadastrados</p>
        <span class="badge gray">Base de entregadores</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${motoboysOnline}</strong>
        <p>Motoboys online</p>
        <span class="badge green">Disponíveis agora</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${motoboysPendentes}</strong>
        <p>Motoboys pendentes</p>
        <span class="badge green">Aguardando aprovação</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${restaurantesAtivos}</strong>
        <p>Restaurantes ativos</p>
        <span class="badge green">Operando na plataforma</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${dinheiro(saldoRestaurantes)}</strong>
        <p>Saldo dos restaurantes</p>
        <span class="badge green">Pré-pago disponível</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${pedidosPendentes}</strong>
        <p>Pedidos pendentes</p>
        <span class="badge gray">Buscando motoboy</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${pedidosAceitos}</strong>
        <p>Pedidos aceitos</p>
        <span class="badge gray">Em andamento</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${pedidosEntregues}</strong>
        <p>Pedidos entregues</p>
        <span class="badge green">Finalizados</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${recargasPendentes}</strong>
        <p>Recargas pendentes</p>
        <span class="badge yellow">Precisam aprovação</span>
      </div>
    </div>

    <div class="menu-card">
      <div>
        <strong>${dinheiro(aPagarMotoboys)}</strong>
        <p>A pagar motoboys</p>
        <span class="badge yellow">Entregas não pagas</span>
      </div>
    </div>
  `;

  renderizarAlertas(recargasPendentes, pedidosAceitos, aPagarMotoboys);
}

function renderizarAlertas(recargasPendentes, pedidosAceitos, aPagarMotoboys) {
  const lista = document.getElementById("alertasAdmin");
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

function filtrosRelatorio() {
  return {
    inicio: parseDataInicio(document.getElementById("dataInicioRelatorio")?.value),
    fim: parseDataFim(document.getElementById("dataFimRelatorio")?.value),

    buscaRestaurante: texto(document.getElementById("buscaRestauranteRelatorio")?.value),
    statusRestaurante: document.getElementById("statusRestauranteRelatorio")?.value || "todos",
    ordenacaoRestaurante: document.getElementById("ordenacaoRestauranteRelatorio")?.value || "nome",

    buscaMotoboy: texto(document.getElementById("buscaMotoboyRelatorio")?.value),
    statusMotoboy: document.getElementById("statusMotoboyRelatorio")?.value || "todos",
    ordenacaoMotoboy: document.getElementById("ordenacaoMotoboyRelatorio")?.value || "nome"
  };
}

function restaurantePassaFiltro(restaurante, filtros) {
  const busca = filtros.buscaRestaurante;

  if (busca) {
    const base = texto([
      restaurante.nome,
      restaurante.email,
      restaurante.telefone,
      restaurante.responsavel
    ].join(" "));

    if (!base.includes(busca)) return false;
  }

  if (filtros.statusRestaurante === "ativo" && restaurante.ativo === false) return false;
  if (filtros.statusRestaurante === "inativo" && restaurante.ativo !== false) return false;
  if (filtros.statusRestaurante === "bloqueado" && restaurante.bloqueado !== true) return false;
  if (filtros.statusRestaurante === "liberado" && restaurante.bloqueado === true) return false;

  return true;
}

function motoboyPassaFiltro(motoboy, filtros) {
  const busca = filtros.buscaMotoboy;

  if (busca) {
    const base = texto([
      motoboy.nome,
      motoboy.cpf,
      motoboy.telefone
    ].join(" "));

    if (!base.includes(busca)) return false;
  }

  if (filtros.statusMotoboy === "online" && motoboy.online !== true) return false;
  if (filtros.statusMotoboy === "offline" && motoboy.online === true) return false;
  if (filtros.statusMotoboy === "aprovado" && motoboy.aprovado !== true) return false;
  if (filtros.statusMotoboy === "pendente" && motoboy.aprovado === true) return false;
  if (filtros.statusMotoboy === "bloqueado" && motoboy.bloqueado !== true) return false;
  if (filtros.statusMotoboy === "liberado" && motoboy.bloqueado === true) return false;

  return true;
}

function renderizarRelatorioRestaurantes() {
  const alvo = document.getElementById("relatorioRestaurantes");
  if (!alvo) return;

  const filtros = filtrosRelatorio();

  const linhas = restaurantes
    .filter((restaurante) => restaurantePassaFiltro(restaurante, filtros))
    .map((restaurante) => {
      const pedidosPeriodo = pedidos.filter((pedido) => {
        return pedido.restauranteId === restaurante.id &&
          dentroDoPeriodo(dataDoPedido(pedido), filtros.inicio, filtros.fim);
      });

      const recargasPeriodo = recargas.filter((recarga) => {
        return recarga.restauranteId === restaurante.id &&
          recarga.status === "aprovada" &&
          dentroDoPeriodo(dataDaRecarga(recarga), filtros.inicio, filtros.fim);
      });

      const creditoUsado = pedidosPeriodo.reduce((total, pedido) => {
        return total + numero(pedido.valorTotal, 0);
      }, 0);

      const valorRecargas = recargasPeriodo.reduce((total, recarga) => {
        return total + numero(recarga.valor, 0);
      }, 0);

      return {
        restaurante,
        pedidos: pedidosPeriodo.length,
        creditoUsado,
        recargas: valorRecargas,
        saldoAtual: numero(restaurante.saldoPrePago, 0)
      };
    });

  linhas.sort((a, b) => {
    if (filtros.ordenacaoRestaurante === "creditoUsado") return b.creditoUsado - a.creditoUsado;
    if (filtros.ordenacaoRestaurante === "recargas") return b.recargas - a.recargas;
    if (filtros.ordenacaoRestaurante === "saldoAtual") return b.saldoAtual - a.saldoAtual;
    if (filtros.ordenacaoRestaurante === "pedidos") return b.pedidos - a.pedidos;

    return String(a.restaurante.nome || "").localeCompare(String(b.restaurante.nome || ""));
  });

  if (linhas.length === 0) {
    alvo.innerHTML = `<div class="empty">Nenhum restaurante encontrado.</div>`;
    return;
  }

  alvo.innerHTML = linhas.map((linha) => {
    const r = linha.restaurante;

    return `
      <div class="list-card">
        <div>
          <strong>${r.nome || "Restaurante sem nome"}</strong>
          <p>Restaurante ID: ${r.id}</p>
          <p>Telefone: ${r.telefone || "Não informado"}</p>
          <p>Pedidos no período: ${linha.pedidos}</p>
          <p>Crédito usado no período: <b>${dinheiro(linha.creditoUsado)}</b></p>
          <p>Recargas aprovadas no período: ${dinheiro(linha.recargas)}</p>
          <p>Saldo atual: ${dinheiro(linha.saldoAtual)}</p>
          <div class="status-row">
            <span class="badge ${r.ativo === false ? "red" : "green"}">${r.ativo === false ? "Inativo" : "Ativo"}</span>
            <span class="badge ${r.bloqueado === true ? "red" : "green"}">${r.bloqueado === true ? "Bloqueado" : "Liberado"}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderizarRelatorioMotoboys() {
  const alvo = document.getElementById("relatorioMotoboys");
  if (!alvo) return;

  const filtros = filtrosRelatorio();

  const linhas = motoboys
    .filter((motoboy) => motoboyPassaFiltro(motoboy, filtros))
    .map((motoboy) => {
      const entregasPeriodo = pedidos.filter((pedido) => {
        return pedido.motoboyId === motoboy.id &&
          pedido.status === "entregue" &&
          dentroDoPeriodo(dataDoPedido(pedido), filtros.inicio, filtros.fim);
      });

      const pagamentosPeriodo = pagamentosMotoboy.filter((pagamento) => {
        return pagamento.motoboyId === motoboy.id &&
          dentroDoPeriodo(dataDoPagamento(pagamento), filtros.inicio, filtros.fim);
      });

      const valorGerado = entregasPeriodo.reduce((total, pedido) => {
        return total + numero(pedido.valorMotoboy, 0);
      }, 0);

      const valorPago = pagamentosPeriodo.reduce((total, pagamento) => {
        return total + valorPagamentoHistorico(pagamento);
      }, 0);

      const valorAberto = pedidos
        .filter((pedido) => pedido.motoboyId === motoboy.id)
        .filter(pedidoPendentePagamentoMotoboy)
        .reduce((total, pedido) => {
          return total + numero(pedido.valorMotoboy, 0);
        }, 0);

      return {
        motoboy,
        entregas: entregasPeriodo.length,
        valorGerado,
        valorPago,
        valorAberto
      };
    });

  linhas.sort((a, b) => {
    if (filtros.ordenacaoMotoboy === "valorGerado") return b.valorGerado - a.valorGerado;
    if (filtros.ordenacaoMotoboy === "valorPago") return b.valorPago - a.valorPago;
    if (filtros.ordenacaoMotoboy === "valorAberto") return b.valorAberto - a.valorAberto;
    if (filtros.ordenacaoMotoboy === "entregas") return b.entregas - a.entregas;

    return String(a.motoboy.nome || "").localeCompare(String(b.motoboy.nome || ""));
  });

  if (linhas.length === 0) {
    alvo.innerHTML = `<div class="empty">Nenhum motoboy encontrado.</div>`;
    return;
  }

  alvo.innerHTML = linhas.map((linha) => {
    const m = linha.motoboy;

    return `
      <div class="list-card">
        <div>
          <strong>${m.nome || "Motoboy sem nome"}</strong>
          <p>Motoboy ID: ${m.id}</p>
          <p>Telefone: ${m.telefone || "Não informado"}</p>
          <p>Entregas no período: ${linha.entregas}</p>
          <p>Valor gerado no período: <b>${dinheiro(linha.valorGerado)}</b></p>
          <p>Valor pago no período: ${dinheiro(linha.valorPago)}</p>
          <p>Valor em aberto: ${dinheiro(linha.valorAberto)}</p>
          <p>Saldo atual no cadastro: ${dinheiro(m.saldo)}</p>
          <div class="status-row">
            <span class="badge ${m.online === true ? "green" : "gray"}">${m.online === true ? "Online" : "Offline"}</span>
            <span class="badge ${m.aprovado === true ? "green" : "yellow"}">${m.aprovado === true ? "Aprovado" : "Pendente"}</span>
            <span class="badge ${m.bloqueado === true ? "red" : "green"}">${m.bloqueado === true ? "Bloqueado" : "Liberado"}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderizarTudo() {
  renderizarResumo();
  renderizarRelatorioRestaurantes();
  renderizarRelatorioMotoboys();
}

function escutarColecao(nome, callback) {
  onSnapshot(
    query(collection(db, nome)),
    (snapshot) => {
      const itens = [];

      snapshot.forEach((docSnap) => {
        itens.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      callback(itens);
      renderizarTudo();
    },
    (erro) => {
      console.error(`Erro ao carregar ${nome}:`, erro);
    }
  );
}

function configurarRelatorio() {
  const dataInicio = document.getElementById("dataInicioRelatorio");
  const dataFim = document.getElementById("dataFimRelatorio");
  const btn = document.getElementById("btnAplicarRelatorio");

  if (dataInicio && !dataInicio.value) {
    dataInicio.value = dataInputHojeMenosDias(7);
  }

  if (dataFim && !dataFim.value) {
    dataFim.value = formatarDataInput(new Date());
  }

  if (btn) {
    btn.addEventListener("click", () => {
      renderizarRelatorioRestaurantes();
      renderizarRelatorioMotoboys();
    });
  }
}

export function carregarDashboardAdmin() {
  configurarRelatorio();

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
