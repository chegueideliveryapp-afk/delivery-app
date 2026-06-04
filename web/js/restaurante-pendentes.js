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

function renderizarPedido(pedido) {
  const semMotoboy = pedido.status === "sem_motoboy";

  return `
    <div class="recharge-item order-history-item">
      <div>
        <strong>${pedido.enderecoEntrega || "Endereço não informado"}</strong>

        <p>Status: ${semMotoboy ? "sem motoboy encontrado" : "aguardando motoboy"}</p>
        <p>Pagamento: ${pagamentoTexto(pedido.formaPagamento)}</p>
        <p>Retorno: ${pedido.precisaRetorno ? "Sim" : "Não"}</p>
        <p>Distância: ${Number(pedido.distanciaKm || 0).toFixed(2)} km</p>
        <p>Motoboy: ainda não aceito</p>

        <p>Valor total: ${dinheiro(pedido.valorTotal)}</p>
        <p>Taxa Cheguei: ${dinheiro(pedido.taxaSistema)}</p>
        <p>Valor motoboy: ${dinheiro(pedido.valorMotoboy)}</p>

        ${
          pedido.raioAtualKm
            ? `<p>Raio inicial: ${pedido.raioAtualKm} km</p>`
            : ""
        }

        ${
          pedido.observacao
            ? `<p>Observação: ${pedido.observacao}</p>`
            : ""
        }

        <p>Criado em: ${dataTexto(pedido.createdAt)}</p>

        ${
          semMotoboy
            ? `<p>Encerrado em: ${dataTexto(pedido.semMotoboyAt)}</p>
               <p>Motivo: ${pedido.motivoSemMotoboy || "Nenhum motoboy aceitou dentro dos raios configurados."}</p>`
            : ""
        }

        ${
          semMotoboy
            ? `<button class="support-link" data-action="tentarNovamente" data-id="${pedido.id}">
                Tentar novamente
              </button>`
            : ""
        }
      </div>

      <span class="status-pill ${semMotoboy ? "recusada" : "pendente"}">
        ${semMotoboy ? "Sem motoboy" : "Pendente"}
      </span>
    </div>
  `;
}

async function tentarNovamentePedido(pedidoId) {
  const pedidoRef = doc(db, "pedidos", pedidoId);

  await updateDoc(pedidoRef, {
    status: "pendente",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    recusadoPor: [],
    raioAtualKm: 3,
    tentativaBusca: 0,
    motoboyId: "",
    motoboyNome: "",
    aceitoAt: null,
    entregueAt: null,
    semMotoboyAt: null,
    motivoSemMotoboy: ""
  });
}

function configurarBotoes() {
  document.querySelectorAll("button[data-action='tentarNovamente']").forEach((button) => {
    button.addEventListener("click", async () => {
      const pedidoId = button.dataset.id;

      const confirmar = confirm(
        "Tentar buscar motoboy novamente para este pedido?"
      );

      if (!confirmar) return;

      button.disabled = true;
      button.innerText = "Tentando...";

      try {
        await tentarNovamentePedido(pedidoId);
      } catch (erro) {
        console.error(erro);
        alert("Erro ao tentar novamente.");
        button.disabled = false;
        button.innerText = "Tentar novamente";
      }
    });
  });
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
      where("restauranteId", "==", user.uid)
    );

    onSnapshot(
      q,
      (snapshot) => {
        const pedidos = [];

        snapshot.forEach((docSnap) => {
          const pedido = {
            id: docSnap.id,
            ...docSnap.data()
          };

          if (
            pedido.status === "pendente" ||
            pedido.status === "sem_motoboy"
          ) {
            pedidos.push(pedido);
          }
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
          pedidos.map(renderizarPedido).join("")
        );

        configurarBotoes();
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
