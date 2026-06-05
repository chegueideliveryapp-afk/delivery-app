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
  serverTimestamp,
  updateDoc,
  where
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

function atualizarBotaoOnline(motoboy) {
  const btnOnline = document.getElementById("btnOnline");
  if (!btnOnline) return;

  btnOnline.disabled = false;
  btnOnline.classList.remove("online-mode", "offline-mode");

  if (motoboy.online) {
    btnOnline.innerText = "Ficar offline";
    btnOnline.classList.add("offline-mode");
  } else {
    btnOnline.innerText = "Ficar online";
    btnOnline.classList.add("online-mode");
  }
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

  atualizarBotaoOnline(motoboy);

  if (motoboy.online === true && onlineSolicitado === false) {
    iniciarGpsOnline();
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

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
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

      onlineSolicitado = false;
      setText("gpsTexto", "Permita a localização para ficar online.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
}

function tocarSomNotificacao() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(620, ctx.currentTime);
    osc.frequency.setValueAtTime(420, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.7, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.75);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch (erro) {
    console.warn("Som de notificação não liberado.", erro);
  }
}

function mostrarNotificacaoEstorno(notificacao) {
  tocarSomNotificacao();

  if (navigator.vibrate) {
    navigator.vibrate([250, 100, 250]);
  }

  alert(`${notificacao.titulo}\n\n${notificacao.mensagem}`);
}

function escutarNotificacoesMotoboy() {
  if (!uid) return;

  const q = query(
    collection(db, "notificacoes_motoboy"),
    where("motoboyId", "==", uid),
    where("lida", "==", false)
  );

  onSnapshot(
    q,
    (snapshot) => {
      snapshot.forEach(async (docSnap) => {
        const notificacao = docSnap.data();

        mostrarNotificacaoEstorno(notificacao);

        await updateDoc(doc(db, "notificacoes_motoboy", docSnap.id), {
          lida: true,
          lidaAt: serverTimestamp()
        });
      });
    },
    (erro) => {
      console.error("Erro ao carregar notificações:", erro);
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
  escutarNotificacoesMotoboy();
});
