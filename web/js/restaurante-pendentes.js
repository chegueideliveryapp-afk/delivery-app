import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp
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
  if (status === "pendente") return "Buscando motoboy";
  if (status === "sem_motoboy") return "Sem motoboy";
  if (status === "aceito") return "Aceito";
  if (status === "entregue") return "Entregue";
  return status || "Pendente";
}

function statusClasse(status) {
  if (status === "sem_motoboy") return "recusada";
  if (status === "aceito") return "aprovada";
  return "pendente";
}

function pagamentoTexto(forma) {
  if (forma === "cartao") return "Cartão";
  if (forma === "dinheiro") return "Dinheiro";
  return "Pix";
}

function renderPedido(id, pedido) {
  const podeTentarNovamente = pedido.status === "sem_motoboy";

  return `
    <div class="pending-order-item">
      <div class="pending-order-main">
        <div class="pending-order-top">
          <strong>${pedido.enderecoEntrega || "Endereço não informado"}</strong>

          <span class="status-pill ${statusClasse(pedido.status)}">
            ${statusTexto(pedido.status)}
          </span>
        </div>

        <p><b>Status:</b> ${statusTexto(pedido.status)}</p>
        <p><b>Pagamento:</b> ${pagamentoTexto(pedido.formaPagamento)}</p>
        <p><b>Retorno:</b> ${pedido.precisaRetorno ? "Sim" : "Não"}</p>
        <p><b>Distância:</b> ${Number(pedido.distanciaKm || 0).toFixed(2)} km</p>
        <p><b>Raio atual:</b> ${pedido.raioAtualKm || 3} km</p>
        <p><b>Motoboy:</b> ${pedido.motoboyNome || "Ainda não aceito"}</p>
        <p><b>Valor motoboy:</b> ${dinheiro(pedido.valorMotoboy)}</p>
        <p><b>Taxa Cheguei:</b> ${dinheiro(pedido.taxaSistema)}</p>
        <p><b>Total debitado:</b> ${dinheiro(pedido.valorTotal)}</p>
        <p><b>Criado em:</b> ${dataTexto(pedido.createdAt)}</p>

        ${
          pedido.observacao
            ? `<p><b>Observação:</b> ${pedido.observacao}</p>`
            : ""
        }
      </div>

      ${
        podeTentarNovamente
          ? `
            <button
              class="secondary-action retry-order-btn"
              type="button"
              data-action="tentarNovamente"
              data-id="${id}"
            >
              Tentar novamente
            </button>
          `
          : ""
      }
    </div>
  `;
}

async function tentarNovamente(pedidoId) {
  const pedidoRef = doc(db, "pedidos", pedidoId);

  await updateDoc(pedidoRef, {
    status: "pendente",
    motoboyId: "",
    motoboyNome: "",
    recusadoPor: [],
    raioAtualKm: 3,
    tentativaBusca: 0,
    semMotoboyAt: null,
    ultimaExpansaoAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function configurarBotoes() {
  document.querySelectorAll("[data-action='tentarNovamente']").forEach((button) => {
    button.addEventListener("click", async () => {
      const pedidoId = button.dataset.id;

      const confirmar = confirm("Deseja tentar buscar motoboy novamente para este pedido?");

      if (!confirmar) return;

      button.disabled = true;
      button.innerText = "Reiniciando busca...";

      try {
        await tentarNovamente(pedidoId);
      } catch (erro) {
        console.error(erro);
        alert("Erro ao tentar novamente.");
        button.disabled = false;
        button.innerText = "Tentar novamente";
      }
    });
  });
}

export function carregarPedidosPendentesRestaurante() {
  const lista = document.getElementById("listaPedidosPendentesRestaurante");

  if (!lista) {
    console.error("Elemento listaPedidosPendentesRestaurante não encontrado.");
    return;
  }

  lista.innerHTML = `<div class="empty-mini">Carregando pedidos pendentes...</div>`;

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      lista.innerHTML = `<div class="empty-mini">Faça login para ver os pedidos.</div>`;
      return;
    }

    const q = query(
      collection(db, "pedidos"),
      where("restauranteId", "==", user.uid)
    );

    onSnapshot(
      q,
      (snapshot) => {
        const pedidos = [];

        snapshot.forEach((docSnap) => {
          const pedido = docSnap.data();

          if (
            pedido.status === "pendente" ||
            pedido.status === "sem_motoboy"
          ) {
            pedidos.push({
              id: docSnap.id,
              ...pedido
            });
          }
        });

        pedidos.sort((a, b) => {
          const dataA = a.createdAt?.toMillis?.() || 0;
          const dataB = b.createdAt?.toMillis?.() || 0;
          return dataB - dataA;
        });

        if (!pedidos.length) {
          lista.innerHTML = `
            <div class="empty-mini">
              Nenhum pedido pendente no momento.
            </div>
          `;
          return;
        }

        lista.innerHTML = pedidos
          .map((pedido) => renderPedido(pedido.id, pedido))
          .join("");

        configurarBotoes();
      },
      (erro) => {
        console.error("Erro ao carregar pedidos pendentes:", erro);

        lista.innerHTML = `
          <div class="empty-mini">
            Erro ao carregar pedidos pendentes: ${erro.message}
          </div>
        `;
      }
    );
  });
}
