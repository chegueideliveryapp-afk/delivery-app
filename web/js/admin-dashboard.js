import { db } from "./firebase.js";

import {
  collection,
  onSnapshot,
  query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let motoboysCache = [];
let restaurantesCache = [];
let pedidosCache = [];
let recargasCache = [];
let pagamentosCache = [];
let ledgerCache = [];

let graficoFinanceiro = null;
let graficoPedidos = null;

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

function pedidoFoiEstornado(pedido) {
  return (
    pedido.estornado === true ||
    pedido.pagamentoMotoboyEstornado === true ||
    pedido.pagamentoMotoboyStatus === "estornado" ||
    pedido.statusFinanceiroMotoboy === "estornado"
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
    !pedidoFoiEstornado(pedido) &&
    !pedidoFoiPagoAoMotoboy(pedido)
  );
}

function pedidoValidoParaBI(pedido) {
  return (
    pedido.status === "entregue" &&
    !pedidoFoiEstornado(pedido)
  );
}

function pedidoContaComoOperacao(pedido) {
  return [
    "pendente",
    "buscando_motoboy",
    "sem_motoboy",
    "aceito",
    "no_restaurante",
    "coletado",
    "no_cliente",
    "entregue"
  ].includes(pedido.status);
}

function calcularResumo() {
  const totalMotoboys = motoboysCache.length;

  const motoboysOnline = motoboysCache.filter((m) => m.online === true).length;

  const motoboysPendentes = motoboysCache.filter((m) => {
    return (
      m.statusCadastro === "pendente" ||
      m.aprovado === false
    );
  }).length;

  const restaurantesAtivos = restaurantesCache.filter((r) => {
    return r.ativo !== false && r.bloqueado !== true;
  }).length;

  const saldoRestaurantes = restaurantesCache.reduce((acc, r) => {
    return acc + numero(r.saldoPrePago, 0);
  }, 0);

  const pedidosPendentes = pedidosCache.filter((p) => {
    return ["pendente", "buscando_motoboy", "sem_motoboy"].includes(p.status);
  }).length;

  const pedidosAceitos = pedidosCache.filter((p) => {
    return ["aceito", "no_restaurante", "coletado", "no_cliente"].includes(p.status);
  }).length;

  const pedidosEntregues = pedidosCache.filter((p) => {
    return p.status === "entregue" && !pedidoFoiEstornado(p);
  }).length;

  const recargasPendentes = recargasCache.filter((r) => {
    return r.status === "pendente";
  }).length;

  const valorPagarMotoboys = pedidosCache
    .filter(pedidoPendentePagamentoMotoboy)
    .reduce((acc, pedido) => acc + numero(pedido.valorMotoboy, 0), 0);

  const pedidosValidosBI = pedidosCache.filter(pedidoValidoParaBI);
  const pedidosEstornados = pedidosCache.filter(pedidoFoiEstornado);

  const biTotalCobrado = pedidosValidosBI.reduce((acc, pedido) => {
    return acc + numero(pedido.valorTotal, 0);
  }, 0);

  const biReceitaPlataforma = pedidosValidosBI.reduce((acc, pedido) => {
    return acc + numero(pedido.taxaSistema, 0);
  }, 0);

  const biValorMotoboys = pedidosValidosBI.reduce((acc, pedido) => {
    return acc + numero(pedido.valorMotoboy, 0);
  }, 0);

  const biValorEstornado = pedidosEstornados.reduce((acc, pedido) => {
    return acc + numero(pedido.valorTotal, 0);
  }, 0);

  return {
    totalMotoboys,
    motoboysOnline,
    motoboysPendentes,
    restaurantesAtivos,
    saldoRestaurantes,
    pedidosPendentes,
    pedidosAceitos,
    pedidosEntregues,
    recargasPendentes,
    valorPagarMotoboys,
    biTotalCobrado,
    biReceitaPlataforma,
    biValorMotoboys,
    biValorEstornado
  };
}

function atualizarCards() {
  const resumo = calcularResumo();

  setText("totalMotoboys", resumo.totalMotoboys);
  setText("motoboysOnline", resumo.motoboysOnline);
  setText("motoboysPendentes", resumo.motoboysPendentes);
  setText("restaurantesAtivos", resumo.restaurantesAtivos);
  setText("saldoRestaurantes", dinheiro(resumo.saldoRestaurantes));
  setText("pedidosPendentes", resumo.pedidosPendentes);
  setText("pedidosAceitos", resumo.pedidosAceitos);
  setText("pedidosEntregues", resumo.pedidosEntregues);
  setText("recargasPendentes", resumo.recargasPendentes);
  setText("valorPagarMotoboys", dinheiro(resumo.valorPagarMotoboys));

  setText("biTotalCobrado", dinheiro(resumo.biTotalCobrado));
  setText("biReceitaPlataforma", dinheiro(resumo.biReceitaPlataforma));
  setText("biValorMotoboys", dinheiro(resumo.biValorMotoboys));
  setText("biValorEstornado", dinheiro(resumo.biValorEstornado));

  atualizarAlertas(resumo);
  atualizarGraficos(resumo);
}

function atualizarAlertas(resumo) {
  const lista = document.getElementById("listaAlertasAdmin");
  if (!lista) return;

  const alertas = [];

  if (resumo.recargasPendentes > 0) {
    alertas.push({
      titulo: `${resumo.recargasPendentes} recarga(s) Pix pendente(s)`,
      texto: "Confira comprovantes e aprove manualmente.",
      badge: "Financeiro",
      classe: "yellow",
      link: "./recargas.html"
    });
  }

  if (resumo.pedidosAceitos > 0) {
    alertas.push({
      titulo: `${resumo.pedidosAceitos} corrida(s) em andamento`,
      texto: "Acompanhe pedidos aceitos e motoboys em rota.",
      badge: "Em rota",
      classe: "green",
      link: "./mapa.html"
    });
  }

  if (resumo.valorPagarMotoboys > 0) {
    alertas.push({
      titulo: `${dinheiro(resumo.valorPagarMotoboys)} em aberto para motoboys`,
      texto: "Valores acumulados para pagamento semanal, ja descontando estornos.",
      badge: "Pagamento segunda-feira",
      classe: "yellow",
      link: "./pagamentos.html"
    });
  }

  if (resumo.biValorEstornado > 0) {
    alertas.push({
      titulo: `${dinheiro(resumo.biValorEstornado)} em entregas estornadas`,
      texto: "Valores devolvidos a restaurantes e removidos de pagamentos dos motoboys.",
      badge: "Estornos",
      classe: "red",
      link: "./pagamentos.html"
    });
  }

  if (alertas.length === 0) {
    lista.innerHTML = `<div class="empty">Nenhum alerta operacional no momento.</div>`;
    return;
  }

  lista.innerHTML = alertas.map((alerta) => {
    return `
      <div class="list-card">
        <div>
          <strong>${alerta.titulo}</strong>
          <p>${alerta.texto}</p>
          <div class="status-row">
            <span class="badge ${alerta.classe}">${alerta.badge}</span>
          </div>
        </div>

        <div class="actions">
          <a class="action-link" href="${alerta.link}">Ver</a>
        </div>
      </div>
    `;
  }).join("");
}

function destruirGrafico(grafico) {
  if (grafico) {
    grafico.destroy();
  }
}

function atualizarGraficos(resumo) {
  if (!window.Chart) return;

  const financeiroCanvas = document.getElementById("graficoFinanceiro");
  const pedidosCanvas = document.getElementById("graficoPedidos");

  if (financeiroCanvas) {
    destruirGrafico(graficoFinanceiro);

    graficoFinanceiro = new Chart(financeiroCanvas, {
      type: "bar",
      data: {
        labels: [
          "Cobrado",
          "Plataforma",
          "Motoboys",
          "Estornado"
        ],
        datasets: [{
          label: "Valores",
          data: [
            resumo.biTotalCobrado,
            resumo.biReceitaPlataforma,
            resumo.biValorMotoboys,
            resumo.biValorEstornado
          ],
          backgroundColor: [
            "#dbeafe",
            "#dcfce7",
            "#fef3c7",
            "#fee2e2"
          ],
          borderColor: [
            "#2563eb",
            "#166534",
            "#92400e",
            "#991b1b"
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }

  if (pedidosCanvas) {
    destruirGrafico(graficoPedidos);

    const pendentes = pedidosCache.filter((p) => {
      return ["pendente", "buscando_motoboy", "sem_motoboy"].includes(p.status);
    }).length;

    const andamento = pedidosCache.filter((p) => {
      return ["aceito", "no_restaurante", "coletado", "no_cliente"].includes(p.status);
    }).length;

    const entreguesValidos = pedidosCache.filter((p) => {
      return p.status === "entregue" && !pedidoFoiEstornado(p);
    }).length;

    const estornados = pedidosCache.filter(pedidoFoiEstornado).length;

    graficoPedidos = new Chart(pedidosCanvas, {
      type: "doughnut",
      data: {
        labels: [
          "Pendentes",
          "Em andamento",
          "Entregues",
          "Estornados"
        ],
        datasets: [{
          data: [
            pendentes,
            andamento,
            entreguesValidos,
            estornados
          ],
          backgroundColor: [
            "#fef3c7",
            "#dbeafe",
            "#dcfce7",
            "#fee2e2"
          ],
          borderColor: [
            "#92400e",
            "#2563eb",
            "#166534",
            "#991b1b"
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true
      }
    });
  }
}

function escutarMotoboys() {
  onSnapshot(query(collection(db, "motoboys")), (snapshot) => {
    motoboysCache = [];

    snapshot.forEach((docSnap) => {
      motoboysCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    atualizarCards();
  });
}

function escutarRestaurantes() {
  onSnapshot(query(collection(db, "restaurantes")), (snapshot) => {
    restaurantesCache = [];

    snapshot.forEach((docSnap) => {
      restaurantesCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    atualizarCards();
  });
}

function escutarPedidos() {
  onSnapshot(query(collection(db, "pedidos")), (snapshot) => {
    pedidosCache = [];

    snapshot.forEach((docSnap) => {
      const pedido = {
        id: docSnap.id,
        ...docSnap.data()
      };

      if (pedidoContaComoOperacao(pedido)) {
        pedidosCache.push(pedido);
      }
    });

    atualizarCards();
  });
}

function escutarRecargas() {
  onSnapshot(query(collection(db, "recargas_restaurante")), (snapshot) => {
    recargasCache = [];

    snapshot.forEach((docSnap) => {
      recargasCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    atualizarCards();
  });
}

function escutarPagamentos() {
  onSnapshot(query(collection(db, "pagamentos_motoboy")), (snapshot) => {
    pagamentosCache = [];

    snapshot.forEach((docSnap) => {
      pagamentosCache.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    atualizarCards();
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

    atualizarCards();
  });
}

export function carregarDashboardAdmin() {
  escutarMotoboys();
  escutarRestaurantes();
  escutarPedidos();
  escutarRecargas();
  escutarPagamentos();
  escutarLedgerMotoboy();
}
