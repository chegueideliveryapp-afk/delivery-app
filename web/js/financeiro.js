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

export function carregarRecargasAdmin() {
  const lista = document.getElementById("listaRecargasAdmin");

  if (!lista) return;

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
            <strong>${recarga.restauranteNome || "Restaurante"}</strong>
            <p>Valor: ${dinheiro(recarga.valor)}</p>
            <p>Método: ${recarga.metodo || "pix"}</p>
            <p>Chave Pix: ${recarga.chavePixUsada || "Não informada"}</p>
            <p>Observação: ${recarga.observacao || "Sem observação"}</p>
            <p>
              <span class="badge ${classeStatus(recarga.status)}">
                ${statusTexto(recarga.status)}
              </span>
            </p>
          </div>
        `;

        lista.appendChild(card);
      });
    },
    (erro) => {
      console.error(erro);
      lista.innerHTML = `<div class="empty">Erro ao carregar recargas.</div>`;
    }
  );
}
