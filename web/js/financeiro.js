import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function statusTexto(status) {
  if (status === "aprovada") return "Aprovada";
  if (status === "recusada") return "Recusada";
  return "Pendente";
}

function classeStatus(status) {
  if (status === "aprovada") return "green";
  if (status === "recusada") return "red";
  return "yellow";
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Data não informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

export function carregarRecargasAdmin() {
  const lista = document.getElementById("listaRecargasAdmin");

  if (!lista) {
    console.error("Elemento listaRecargasAdmin não encontrado.");
    return;
  }

  lista.innerHTML = `<div class="empty">Buscando recargas...</div>`;

  const q = query(collection(db, "recargas_restaurante"));

  onSnapshot(
    q,
    (snapshot) => {
      lista.innerHTML = "";

      if (snapshot.empty) {
        lista.innerHTML = `<div class="empty">Nenhuma solicitação de recarga.</div>`;
        return;
      }

      const recargas = [];

      snapshot.forEach((docSnap) => {
        recargas.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      recargas.sort((a, b) => {
        const dataA = a.solicitadoAt?.toMillis?.() || 0;
        const dataB = b.solicitadoAt?.toMillis?.() || 0;
        return dataB - dataA;
      });

      recargas.forEach((recarga) => {
        const card = document.createElement("div");
        card.className = "list-card";

        card.innerHTML = `
          <div>
            <strong>${recarga.restauranteNome || "Restaurante não informado"}</strong>
            <p>Valor: ${dinheiro(recarga.valor)}</p>
            <p>Status:
              <span class="badge ${classeStatus(recarga.status)}">
                ${statusTexto(recarga.status)}
              </span>
            </p>
            <p>Método: ${recarga.metodo || "pix"}</p>
            <p>Chave Pix: ${recarga.chavePixUsada || "Não informada"}</p>
            <p>Observação: ${recarga.observacao || "Sem observação"}</p>
            <p>Solicitada em: ${dataTexto(recarga.solicitadoAt)}</p>
          </div>

          <div class="actions">
            ${
              recarga.status === "pendente"
                ? `<button data-action="aprovarRecarga" data-id="${recarga.id}">
                    Aprovar
                  </button>`
                : ""
            }
          </div>
        `;

        lista.appendChild(card);
      });

      lista.querySelectorAll("button[data-action='aprovarRecarga']").forEach((button) => {
        button.addEventListener("click", async () => {
          const recargaId = button.dataset.id;

          const confirmar = confirm("Confirmar aprovação desta recarga?");

          if (!confirmar) return;

          button.disabled = true;
          button.innerText = "Aprovando...";

          try {
            await aprovarRecarga(recargaId);
          } catch (erro) {
            console.error(erro);
            alert("Erro ao aprovar recarga.");
            button.disabled = false;
            button.innerText = "Aprovar";
          }
        });
      });
    },
    (erro) => {
      console.error("Erro ao carregar recargas:", erro);
      lista.innerHTML = `<div class="empty">Erro ao carregar recargas: ${erro.message}</div>`;
    }
  );
}

async function aprovarRecarga(recargaId) {
  const uidAdmin = auth.currentUser?.uid;

  if (!uidAdmin) {
    throw new Error("Admin não autenticado.");
  }

  const recargaRef = doc(db, "recargas_restaurante", recargaId);

  await runTransaction(db, async (transaction) => {
    const recargaSnap = await transaction.get(recargaRef);

    if (!recargaSnap.exists()) {
      throw new Error("Recarga não encontrada.");
    }

    const recarga = recargaSnap.data();

    if (recarga.status !== "pendente") {
      throw new Error("Recarga já processada.");
    }

    const restauranteRef = doc(db, "restaurantes", recarga.restauranteId);
    const restauranteSnap = await transaction.get(restauranteRef);

    if (!restauranteSnap.exists()) {
      throw new Error("Restaurante não encontrado.");
    }

    const restaurante = restauranteSnap.data();

    const valor = Number(recarga.valor || 0);
    const saldoAntes = Number(restaurante.saldoPrePago || 0);
    const saldoDepois = saldoAntes + valor;

    const ledgerRef = doc(collection(db, "ledger_restaurante"));

    transaction.update(restauranteRef, {
      saldoPrePago: saldoDepois,
      updatedAt: serverTimestamp()
    });

    transaction.update(recargaRef, {
      status: "aprovada",
      aprovadoAt: serverTimestamp(),
      aprovadoPor: uidAdmin
    });

    transaction.set(ledgerRef, {
      restauranteId: recarga.restauranteId,
      restauranteNome: recarga.restauranteNome || restaurante.nome || "",
      tipo: "recarga",
      valor,
      saldoAntes,
      saldoDepois,
      recargaId,
      pedidoId: null,
      descricao: "Recarga Pix aprovada",
      createdAt: serverTimestamp(),
      criadoPor: uidAdmin
    });
  });
}
