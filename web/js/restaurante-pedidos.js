import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where
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

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function statusTexto(status) {
  if (status === "pendente") return "Pendente";
  if (status === "aceito") return "Aceito";
  if (status === "entregue") return "Entregue";
  if (status === "sem_motoboy") return "Sem motoboy";
  if (status === "cancelado") return "Cancelado";
  return status || "Não informado";
}

function statusClasse(status) {
  if (status === "entregue") return "aprovada";
  if (status === "aceito") return "andamento";
  if (status === "cancelado" || status === "sem_motoboy") return "recusada";
  return "pendente";
}

function pagamentoTexto(forma) {
  if (forma === "pix") return "Pix";
  if (forma === "cartao") return "Cartão";
  if (forma === "dinheiro") return "Dinheiro";
  return "Não informado";
}

function renderizarPedido(pedido) {
  const status = pedido.status || "pendente";
  const motoboyNome = pedido.motoboyNome || "Ainda não aceito";

  return `
    <div class="recharge-item order-history-item">
      <div>
        <strong>${pedido.enderecoEntrega || "Endereço não informado"}</strong>

        <p>Restaurante: ${pedido.restauranteNome || "Não informado"}</p>
        <p>Status: ${statusTexto(status)}</p>
        <p>Motoboy: ${motoboyNome}</p>
        <p>Pagamento: ${pagamentoTexto(pedido.formaPagamento)}</p>
        <p>Retorno: ${pedido.precisaRetorno ? "Sim" : "Não"}</p>
        <p>Distância: ${Number(pedido.distanciaKm || 0).toFixed(2)} km</p>

        <p>Valor total: ${dinheiro(pedido.valorTotal)}</p>
        <p>Taxa Cheguei: ${dinheiro(pedido.taxaSistema)}</p>

        ${
          pedido.observacao
            ? `<p>Observação: ${pedido.observacao}</p>`
            : ""
        }

        ${
          pedido.pedidoCopiado
            ? `<p>Pedido copiado: ${pedido.pedidoCopiado}</p>`
            : ""
        }

        <p>Criado em: ${dataTexto(pedido.createdAt)}</p>

        ${
          pedido.aceitoAt
            ? `<p>Aceito em: ${dataTexto(pedido.aceitoAt)}</p>`
            : ""
        }

        ${
          pedido.entregueAt
            ? `<p>Entregue em: ${dataTexto(pedido.entregueAt)}</p>`
            : ""
        }
      </div>

      <span class="status-pill ${statusClasse(status)}">
        ${statusTexto(status)}
      </span>
    </div>
  `;
}

async function validarRestaurante(user) {
  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists()) {
    await signOut(auth);
    window.location.href = "./login.html";
    return false;
  }

  const perfil = userSnap.data();

  if (
    perfil.role !== "restaurante" ||
    perfil.ativo !== true ||
    perfil.bloqueado === true
  ) {
    await signOut(auth);
    window.location.href = "./login.html";
    return false;
  }

  return true;
}

export function carregarPedidosRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    const valido = await validarRestaurante(user);

    if (!valido) return;

    const q = query(
      collection(db, "pedidos"),
      where("restauranteId", "==", user.uid)
    );

    onSnapshot(
      q,
      (snapshot) => {
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

        setText(
          "totalPedidosRestaurante",
          `${pedidos.length} pedido(s)`
        );

        if (!pedidos.length) {
          setHtml(
            "listaPedidosRestaurante",
            `<div class="empty-mini">Nenhum pedido criado ainda.</div>`
          );
          return;
        }

        setHtml(
          "listaPedidosRestaurante",
          pedidos.map(renderizarPedido).join("")
        );
      },
      (erro) => {
        console.error(erro);

        setText("totalPedidosRestaurante", "Erro");

        setHtml(
          "listaPedidosRestaurante",
          `<div class="empty-mini">Erro ao carregar pedidos. Confira as regras do Firestore.</div>`
        );
      }
    );
  });
}
