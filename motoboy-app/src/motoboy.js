import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let uid = null;
let motoboyAtual = null;
let watchId = null;
let onlineSolicitado = false;

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

function podeFicarOnline(motoboy) {
  return (
    motoboy &&
    motoboy.aprovado === true &&
    motoboy.ativo !== false &&
    motoboy.bloqueado !== true
  );
}

function atualizarTela(motoboy) {
  motoboyAtual = motoboy;

  setText("nomeMotoboy", motoboy.nome || "Motoboy");
  setText("saldoMotoboy", dinheiro(motoboy.saldo));
  setText("totalEntregas", motoboy.totalEntregas || 0);
  setText("totalRecusas", motoboy.totalRecusas || 0);
  setText("onlineTexto", motoboy.online ? "Online" : "Offline");

  const btnOnline = document.getElementById("btnOnline");

  if (motoboy.bloqueado) {
    setText("statusConta", "Conta bloqueada");
    setText("statusDescricao", "Entre em contato com a administração.");
    if (btnOnline) btnOnline.disabled = true;
    return;
  }

  if (motoboy.ativo === false) {
    setText("statusConta", "Conta inativa");
    setText("statusDescricao", "Sua conta está inativa no momento.");
    if (btnOnline) btnOnline.disabled = true;
    return;
  }

  if (motoboy.aprovado !== true) {
    setText("statusConta", "Aguardando aprovação");
    setText("statusDescricao", "Assim que a administração aprovar, você poderá ficar online.");
    if (btnOnline) btnOnline.disabled = true;
    return;
  }

  setText("statusConta", "Conta aprovada");
  setText("statusDescricao", "Você já pode ficar online para receber corridas próximas.");

  if (btnOnline) {
    btnOnline.disabled = false;
    btnOnline.innerText = motoboy.online ? "Ficar offline" : "Ficar online";
  }
}

async function marcarOffline() {
  if (!uid) return;

  onlineSolicitado = false;

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  await updateDoc(doc(db, "motoboys", uid), {
    online: false,
    updatedAt: serverTimestamp()
  });

  setText("gpsTexto", "Você está offline.");
}

async function iniciarGpsOnline() {
  if (!uid || !motoboyAtual) return;

  if (!podeFicarOnline(motoboyAtual)) {
    setText("gpsTexto", "Sua conta ainda não pode ficar online.");
    return;
  }

  if (!navigator.geolocation) {
    setText("gpsTexto", "GPS não suportado neste aparelho.");
    return;
  }

  onlineSolicitado = true;
  setText("gpsTexto", "Solicitando localização...");

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      if (!onlineSolicitado) return;

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy;

      await updateDoc(doc(db, "motoboys", uid), {
        online: true,
        location: {
          lat,
          lng
        },
        accuracy,
        ultimaLocalizacaoAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setText("gpsTexto", `GPS ativo. Precisão: ${Math.round(accuracy)}m`);
    },
    async (erro) => {
      console.error(erro);

      await updateDoc(doc(db, "motoboys", uid), {
        online: false,
        updatedAt: serverTimestamp()
      });

      setText("gpsTexto", "Permita a localização para ficar online.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
}

function configurarBotoes() {
  const btnOnline = document.getElementById("btnOnline");
  const btnSair = document.getElementById("btnSair");

  if (btnOnline) {
    btnOnline.addEventListener("click", async () => {
      if (!motoboyAtual) return;

      if (motoboyAtual.online) {
        await marcarOffline();
      } else {
        await iniciarGpsOnline();
      }
    });
  }

  if (btnSair) {
    btnSair.addEventListener("click", async () => {
      await marcarOffline();
      await signOut(auth);
      window.location.href = "./index.html";
    });
  }

  window.addEventListener("beforeunload", () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./index.html";
    return;
  }

  uid = user.uid;

  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists() || userSnap.data().role !== "motoboy") {
    await signOut(auth);
    window.location.href = "./index.html";
    return;
  }

  const motoboyRef = doc(db, "motoboys", uid);

  onSnapshot(motoboyRef, (snap) => {
    if (!snap.exists()) {
      signOut(auth);
      window.location.href = "./index.html";
      return;
    }

    atualizarTela(snap.data());
  });

  configurarBotoes();
});
