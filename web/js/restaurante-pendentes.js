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

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function pagamentoTexto(forma) {
  if (forma === "pix") return "Pix";
  if (forma === "cartao") return "Cartão";
  if (forma === "dinheiro") return "Dinheiro";
  return "Não informado";
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

function renderizarPedidoPendente(pedido) {
  return `
    <div class="recharge-item order-history-item">
      <div>
        <strong>${pedido.enderecoEntrega || "Endereço não informado"}</strong>

        <p>Status: aguardando motoboy</p>
        <p>Pagamento: ${pagamentoTexto(pedido.formaPagamento)}</p>
        <p>Retorno: ${pedido.precisaRetorno ? "Sim" : "Não"}</p>
        <p>Distância: ${Number(pedido.distanciaKm || 0).toFixed(2)} km</p>
        <p>Motoboy: ainda não aceito</p>

        <p>Valor total: ${dinheiro(pedido.valorTotal)}</p>
        <p>Taxa Cheguei: ${dinheiro(pedido.taxaSistema)}</p>
        <p>Valor motoboy: ${dinheiro(pedido.valorMotoboy)}</p>

        ${
          pedido.raioAtualKm
            ? `<p>Raio atual de busca: ${pedido.raioAtualKm} km</p>`
            : ""
        }

        ${
          pedido.observacao
            ? `<p>Observação: ${pedido.observacao}</p>`
            : ""
        }

        <p>Criado em: ${dataTexto(pedido.createdAt)}</p>
      </div>

      <span class="status-pill pendente">
        Pendente
      </span>
    </div>
  `;
}

export function carregarPedidosPendentesNovoPedido() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    const valido = await validarRestaurante(user);

    if (!valido) return;

    const q = query(
      collection(db, "pedidos"),
      where("restauranteId", "==", user.uid),
      where("status", "==", "pendente")
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

        if (!pedidos.length) {
          setHtml(
            "listaPedidosPendentesNovoPedido",
            `<div class="empty-mini">Nenhum pedido pendente no momento.</div>`
          );
          return;
        }

        setHtml(
          "listaPedidosPendentesNovoPedido",
          pedidos.map(renderizarPedidoPendente).join("")
        );
      },
      (erro) => {
        console.error(erro);

        setHtml(
          "listaPedidosPendentesNovoPedido",
          `<div class="empty-mini">Erro ao carregar pedidos pendentes.</div>`
        );
      }
    );
  });
}
