import { db } from "./firebase.js";

import {
  collection,
  onSnapshot,
  query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

function statusTexto(status) {
  const mapa = {
    pendente: "Pendente",
    sem_motoboy: "Sem motoboy",
    aceito: "Aceito",
    em_rota: "Em rota",
    entregue: "Entregue",
    cancelado: "Cancelado"
  };

  return mapa[status] || status || "Sem status";
}

function statusClasse(status) {
  const mapa = {
    pendente: "yellow",
    sem_motoboy: "red",
    aceito: "blue",
    em_rota: "blue",
    entregue: "green",
    cancelado: "red"
  };

  return mapa[status] || "yellow";
}

function pagamentoTexto(forma) {
  const mapa = {
    pix: "Pix",
    cartao: "Cartão",
    dinheiro: "Dinheiro"
  };

  return mapa[forma] || "Não informado";
}

function retornoTexto(pedido) {
  if (!pedido.precisaRetorno) return "Não";

  if (pedido.formaPagamento === "dinheiro" && pedido.valorTroco) {
    return `Sim - troco para ${dinheiro(pedido.valorTroco)}`;
  }

  return "Sim";
}

export function carregarPedidosAdmin() {
  const lista = document.getElementById("listaPedidosAdmin");
  const total = document.getElementById("totalPedidos");

  if (!lista) return;

  lista.innerHTML = `<div class="empty">Buscando pedidos...</div>`;

  const q = query(collection(db, "pedidos"));

  onSnapshot(
    q,
    (snapshot) => {
      lista.innerHTML = "";

      if (total) {
        total.innerText = `${snapshot.size} pedido(s)`;
      }

      if (snapshot.empty) {
        lista.innerHTML = `<div class="empty">Nenhum pedido criado ainda.</div>`;
        return;
      }

      const pedidos = [];

      snapshot.forEach((docSnap) => {
        pedidos.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      pedidos.sort((a, b) => {
        const dataA = a.createdAt?.toMillis?.() || 0;
        const dataB = b.createdAt?.toMillis?.() || 0;
        return dataB - dataA;
      });

      pedidos.forEach((pedido) => {
        const card = document.createElement("div");
        card.className = "list-card";

        card.innerHTML = `
          <div>
            <div class="list-title-row">
              <strong>${pedido.restauranteNome || "Restaurante não informado"}</strong>
              <span class="badge ${statusClasse(pedido.status)}">
                ${statusTexto(pedido.status)}
              </span>
            </div>

            <p><b>Endereço:</b> ${pedido.enderecoEntrega || "Não informado"}</p>
            <p><b>Complemento:</b> ${pedido.enderecoComplemento || "Sem complemento"}</p>
            <p><b>Distância:</b> ${Number(pedido.distanciaKm || 0).toFixed(2)} km</p>

            <p><b>Pagamento:</b> ${pagamentoTexto(pedido.formaPagamento)}</p>
            <p><b>Retorno:</b> ${retornoTexto(pedido)}</p>

            <p><b>Motoboy:</b> ${pedido.motoboyNome || pedido.motoboyId || "Ainda não aceito"}</p>

            <p><b>Valor motoboy:</b> ${dinheiro(pedido.valorMotoboy)}</p>
            <p><b>Taxa Cheguei:</b> ${dinheiro(pedido.taxaSistema)}</p>
            <p><b>Total:</b> ${dinheiro(pedido.valorTotal)}</p>

            <p><b>Raio atual:</b> ${pedido.raioAtualKm || 0} km</p>
            <p><b>Criado em:</b> ${dataTexto(pedido.createdAt)}</p>

            ${
              pedido.pedidoCopiado
                ? `<details>
                    <summary>Ver pedido copiado</summary>
                    <pre>${pedido.pedidoCopiado}</pre>
                  </details>`
                : ""
            }
          </div>
        `;

        lista.appendChild(card);
      });
    },
    (erro) => {
      console.error(erro);
      lista.innerHTML = `<div class="empty">Erro ao carregar pedidos: ${erro.message}</div>`;
    }
  );
}
