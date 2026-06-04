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

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function dataTexto(timestamp) {
  if (!timestamp?.toDate) return "Data não informada";

  return timestamp.toDate().toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function renderizarMovimento(movimento) {
  const pago = movimento.pago === true;

  return `
    <div class="finance-item">
      <div>
        <strong>${dinheiro(movimento.valor)}</strong>
        <p>${movimento.restauranteNome || "Restaurante não informado"}</p>
        <p>${movimento.descricao || "Entrega finalizada"}</p>
        <p>${dataTexto(movimento.createdAt)}</p>
      </div>

      <span class="finance-status ${pago ? "paid" : "open"}">
        ${pago ? "Pago" : "A receber"}
      </span>
    </div>
  `;
}

function carregarFinanceiro(uid) {
  const motoboyRef = doc(db, "motoboys", uid);

  onSnapshot(motoboyRef, (snap) => {
    if (!snap.exists()) return;

    const motoboy = snap.data();

    setText("saldoFinanceiro", dinheiro(motoboy.saldo));
    setText("totalEntregasFinanceiro", motoboy.totalEntregas || 0);
  });

  const q = query(
    collection(db, "ledger_motoboy"),
    where("motoboyId", "==", uid)
  );

  onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        setText("totalAbertoFinanceiro", dinheiro(0));
        setHtml(
          "listaHistoricoFinanceiro",
          `<div class="empty-state">Nenhuma entrega finalizada ainda.</div>`
        );
        return;
      }

      const movimentos = [];

      snapshot.forEach((docSnap) => {
        movimentos.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      movimentos.sort((a, b) => {
        const dataA = a.createdAt?.toMillis?.() || 0;
        const dataB = b.createdAt?.toMillis?.() || 0;
        return dataB - dataA;
      });

      const totalAberto = movimentos
        .filter((movimento) => movimento.pago !== true)
        .reduce((total, movimento) => total + Number(movimento.valor || 0), 0);

      setText("totalAbertoFinanceiro", dinheiro(totalAberto));

      setHtml(
        "listaHistoricoFinanceiro",
        movimentos.map(renderizarMovimento).join("")
      );
    },
    (erro) => {
      console.error(erro);

      setHtml(
        "listaHistoricoFinanceiro",
        `<div class="empty-state">Erro ao carregar histórico financeiro.</div>`
      );
    }
  );
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./index.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists() || userSnap.data().role !== "motoboy") {
    await signOut(auth);
    window.location.href = "./index.html";
    return;
  }

  carregarFinanceiro(user.uid);
});
