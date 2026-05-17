import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let restauranteLogado = null;
let configApp = null;

let restaurantePedido = null;
let configPedido = null;
let pedidoCalculado = null;

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function arredondarDinheiro(valor) {
  return Math.round(Number(valor || 0) * 100) / 100;
}

function setText(id, texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function mostrarMensagem(texto) {
  const msg = document.getElementById("mensagem");
  if (msg) msg.innerText = texto;
}

function mostrarErroDashboard(texto) {
  setText("nomeRestaurante", "Erro ao carregar");
  setText("statusConta", "Atenção");
  setText("statusDescricao", texto);
}

function limparTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function montarWhatsappSuporte(numero, restauranteNome) {
  const numeroLimpo = limparTelefone(numero);

  if (!numeroLimpo) return "#";

  const telefone = numeroLimpo.startsWith("55")
    ? numeroLimpo
    : `55${numeroLimpo}`;

  const texto = encodeURIComponent(
    `Olá, sou do restaurante ${restauranteNome || ""}. Enviei um comprovante Pix para recarga.`
  );

  return `https://wa.me/${telefone}?text=${texto}`;
}

function statusRecargaTexto(status) {
  if (status === "aprovada") return "Aprovada";
  if (status === "recusada") return "Recusada";
  return "Pendente";
}

function calcularValorMotoboy(distanciaKm, config) {
  const taxaBase = Number(config.taxaBaseMotoboy || 0);
  const valorKm = Number(config.valorKmMotoboy || 0);
  const minimo = Number(config.valorMinimoMotoboy || 0);

  const adicionalChuva = Number(config.adicionalChuva || 0);
  const adicionalEvento = Number(config.adicionalEvento || 0);
  const adicionalFimAno = Number(config.adicionalFimAno || 0);

  const calculado =
    taxaBase +
    (Number(distanciaKm || 0) * valorKm) +
    adicionalChuva +
    adicionalEvento +
    adicionalFimAno;

  return arredondarDinheiro(Math.max(calculado, minimo));
}

export async function loginRestaurante() {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  const btn = document.getElementById("btnLogin");

  mostrarMensagem("");

  if (!email || !senha) {
    mostrarMensagem("Preencha e-mail e senha.");
    return;
  }

  btn.disabled = true;
  btn.innerText = "Entrando...";

  try {
    const credencial = await signInWithEmailAndPassword(auth, email, senha);
    const uid = credencial.user.uid;

    const userSnap = await getDoc(doc(db, "users", uid));

    if (!userSnap.exists()) {
      await signOut(auth);
      mostrarMensagem("Usuário sem perfil.");
      return;
    }

    const perfil = userSnap.data();

    if (perfil.role !== "restaurante") {
      await signOut(auth);
      mostrarMensagem("Este usuário não é um restaurante.");
      return;
    }

    if (perfil.ativo !== true) {
      await signOut(auth);
      mostrarMensagem("Conta inativa.");
      return;
    }

    if (perfil.bloqueado === true) {
      await signOut(auth);
      mostrarMensagem("Conta bloqueada.");
      return;
    }

    window.location.href = "./dashboard.html";
  } catch (erro) {
    console.error(erro);
    mostrarMensagem("E-mail ou senha inválidos.");
  }

  btn.disabled = false;
  btn.innerText = "Acessar painel";
}

export function protegerRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));

      if (!userSnap.exists() || userSnap.data().role !== "restaurante") {
        await signOut(auth);
        window.location.href = "./login.html";
      }
    } catch (erro) {
      console.error(erro);
      await signOut(auth);
      window.location.href = "./login.html";
    }
  });
}

export function carregarDashboardRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const restauranteRef = doc(db, "restaurantes", user.uid);

    onSnapshot(
      restauranteRef,
      (snap) => {
        if (!snap.exists()) {
          mostrarErroDashboard("Cadastro do restaurante não encontrado. Verifique se o UID do Authentication é igual ao ID do documento em restaurantes.");
          return;
        }

        const r = snap.data();

        setText("nomeRestaurante", r.nome || "Restaurante");
        setText("saldoPrePago", dinheiro(r.saldoPrePago));

        const lat = r.location?.lat ?? "---";
        const lng = r.location?.lng ?? "---";
        setText("localizacaoRestaurante", `${lat}, ${lng}`);

        if (r.bloqueado) {
          setText("statusConta", "Bloqueado");
          setText("statusDescricao", "Entre em contato com a administração.");
          return;
        }

        if (r.ativo === false) {
          setText("statusConta", "Inativo");
          setText("statusDescricao", "Sua conta está inativa no momento.");
          return;
        }

        setText("statusConta", "Ativo");
        setText("statusDescricao", "Você já pode solicitar entregas com saldo disponível.");
      },
      (erro) => {
        console.error(erro);
        mostrarErroDashboard("Sem permissão para carregar o restaurante. Confira as regras do Firestore.");
      }
    );
  });
}

export function carregarRecargaRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const restauranteRef = doc(db, "restaurantes", user.uid);
    const configRef = doc(db, "config", "app");

    onSnapshot(restauranteRef, (snap) => {
      if (!snap.exists()) return;

      restauranteLogado = {
        id: user.uid,
        ...snap.data()
      };

      setText("saldoAtual", dinheiro(restauranteLogado.saldoPrePago));

      const link = document.getElementById("whatsappSuporte");
      if (link && configApp) {
        link.href = montarWhatsappSuporte(
          configApp.suporteWhatsapp,
          restauranteLogado.nome
        );
      }
    });

    onSnapshot(configRef, (snap) => {
      if (!snap.exists()) return;

      configApp = snap.data();

      setText("chavePix", configApp.chavePix || "Chave Pix não cadastrada");

      const link = document.getElementById("whatsappSuporte");
      if (link) {
        link.href = montarWhatsappSuporte(
          configApp.suporteWhatsapp,
          restauranteLogado?.nome
        );
      }
    });

    const q = query(
      collection(db, "recargas_restaurante"),
      where("restauranteId", "==", user.uid),
      orderBy("solicitadoAt", "desc")
    );

    onSnapshot(
      q,
      (snapshot) => {
        const lista = document.getElementById("listaRecargas");
        if (!lista) return;

        lista.innerHTML = "";

        if (snapshot.empty) {
          lista.innerHTML = `<div class="empty-mini">Nenhuma recarga solicitada ainda.</div>`;
          return;
        }

        snapshot.forEach((docSnap) => {
          const r = docSnap.data();

          const item = document.createElement("div");
          item.className = "recharge-item";

          item.innerHTML = `
            <div>
              <strong>${dinheiro(r.valor)}</strong>
              <p>${r.observacao || "Sem observação"}</p>
            </div>
            <span class="status-pill ${r.status || "pendente"}">
              ${statusRecargaTexto(r.status)}
            </span>
          `;

          lista.appendChild(item);
        });
      },
      (erro) => {
        console.error(erro);
        const lista = document.getElementById("listaRecargas");
        if (lista) {
          lista.innerHTML = `<div class="empty-mini">Erro ao carregar recargas.</div>`;
        }
      }
    );
  });
}

export async function solicitarRecarga() {
  const valor = Number(document.getElementById("valorRecarga").value || 0);
  const observacao = document.getElementById("observacaoRecarga").value.trim();
  const msg = document.getElementById("mensagem");
  const btn = document.getElementById("btnSolicitarRecarga");

  msg.innerText = "";

  if (!restauranteLogado) {
    msg.innerText = "Restaurante não carregado.";
    return;
  }

  if (!valor || valor <= 0) {
    msg.innerText = "Informe um valor válido.";
    return;
  }

  btn.disabled = true;
  btn.innerText = "Solicitando...";

  try {
    await addDoc(collection(db, "recargas_restaurante"), {
      restauranteId: restauranteLogado.id,
      restauranteNome: restauranteLogado.nome || "",
      valor,
      status: "pendente",
      metodo: "pix",
      chavePixUsada: configApp?.chavePix || "",
      observacao,
      solicitadoAt: serverTimestamp(),
      aprovadoAt: null,
      aprovadoPor: null,
      recusadoAt: null,
      recusadoPor: null,
      motivoRecusa: ""
    });

    document.getElementById("valorRecarga").value = "";
    document.getElementById("observacaoRecarga").value = "";
    msg.innerText = "Solicitação enviada. Envie o comprovante pelo WhatsApp.";
  } catch (erro) {
    console.error(erro);
    msg.innerText = "Erro ao solicitar recarga.";
  }

  btn.disabled = false;
  btn.innerText = "Solicitar recarga";
}

export function carregarNovoPedido() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const restauranteRef = doc(db, "restaurantes", user.uid);
    const configRef = doc(db, "config", "app");

    onSnapshot(restauranteRef, (snap) => {
      if (!snap.exists()) return;

      restaurantePedido = {
        id: user.uid,
        ...snap.data()
      };

      setText("saldoPedido", dinheiro(restaurantePedido.saldoPrePago));
    });

    onSnapshot(configRef, (snap) => {
      if (!snap.exists()) return;

      configPedido = snap.data();

      const raioInicial = configPedido.raiosBuscaKm?.[0] || 3;
      setText("raioInicialPedido", `${raioInicial} km`);
    });
  });
}

export function calcularPedido() {
  const enderecoEntrega = document.getElementById("enderecoEntrega").value.trim();
  const distanciaEntregaKm = Number(document.getElementById("distanciaEntregaKm").value || 0);
  const btnCriar = document.getElementById("btnCriarPedido");
  const msg = document.getElementById("mensagem");

  msg.innerText = "";

  if (!restaurantePedido) {
    msg.innerText = "Restaurante ainda não carregado.";
    return;
  }

  if (!configPedido) {
    msg.innerText = "Configuração do sistema ainda não carregada.";
    return;
  }

  if (!enderecoEntrega) {
    msg.innerText = "Informe o endereço de entrega.";
    return;
  }

  if (!distanciaEntregaKm || distanciaEntregaKm <= 0) {
    msg.innerText = "Informe uma distância válida.";
    return;
  }

  const taxaSistema = arredondarDinheiro(
    Number(restaurantePedido.taxaSistemaPadrao ?? configPedido.taxaSistemaPadrao ?? 0)
  );

  const valorMotoboy = calcularValorMotoboy(distanciaEntregaKm, configPedido);
  const valorTotal = arredondarDinheiro(valorMotoboy + taxaSistema);

  const raiosBuscaKm = configPedido.raiosBuscaKm || [3, 5, 10, 15];
  const raioAtualKm = raiosBuscaKm[0] || 3;

  pedidoCalculado = {
    enderecoEntrega,
    distanciaEntregaKm,
    taxaSistema,
    valorMotoboy,
    valorTotal
