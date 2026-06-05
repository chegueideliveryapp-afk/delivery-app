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
  runTransaction,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let restauranteLogado = null;
let configApp = null;
let pedidoCalculado = null;
let enderecoEncontrado = null;
let timersBuscaMotoboy = {};
let novoPedidoConfigurado = false;

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function numero(valor, padrao = 0) {
  const n = Number(valor ?? padrao);
  return Number.isFinite(n) ? n : padrao;
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

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const nLat1 = Number(lat1);
  const nLng1 = Number(lng1);
  const nLat2 = Number(lat2);
  const nLng2 = Number(lng2);

  if (
    !Number.isFinite(nLat1) ||
    !Number.isFinite(nLng1) ||
    !Number.isFinite(nLat2) ||
    !Number.isFinite(nLng2)
  ) {
    return 0;
  }

  const R = 6371;
  const dLat = (nLat2 - nLat1) * Math.PI / 180;
  const dLng = (nLng2 - nLng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(nLat1 * Math.PI / 180) *
    Math.cos(nLat2 * Math.PI / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function montarEnderecoEntrega() {
  const rua = document.getElementById("enderecoRua")?.value.trim() || "";
  const numeroEndereco = document.getElementById("enderecoNumero")?.value.trim() || "";
  const bairro = document.getElementById("enderecoBairro")?.value.trim() || "";
  const cidade = document.getElementById("enderecoCidade")?.value.trim() || "";
  const complemento = document.getElementById("enderecoComplemento")?.value.trim() || "";

  const enderecoCompleto = [
    rua,
    numeroEndereco,
    bairro,
    cidade,
    "SP",
    "Brasil"
  ].filter(Boolean).join(", ");

  return {
    rua,
    numeroEndereco,
    bairro,
    cidade,
    complemento,
    enderecoCompleto
  };
}

function atualizarResumoPagamento() {
  const forma = document.getElementById("formaPagamento")?.value || "pix";
  const precisaRetorno = document.getElementById("precisaRetorno")?.checked === true;

  const pagamentoTexto = {
    pix: "Pix",
    cartao: "Cartão",
    dinheiro: "Dinheiro"
  };

  setText("pagamentoResumo", pagamentoTexto[forma] || "Pix");

  if (precisaRetorno) {
    setText("retornoResumo", "Com retorno ao restaurante.");
  } else {
    setText("retornoResumo", "Sem retorno ao restaurante.");
  }
}

function calcularValoresPedido() {
  const distanciaKm = numero(document.getElementById("distanciaEntregaKm")?.value, 0);
  const precisaRetorno = document.getElementById("precisaRetorno")?.checked === true;

  const taxaBaseMotoboy = numero(configApp?.taxaBaseMotoboy, 7);
  const valorKmMotoboy = numero(configApp?.valorKmMotoboy, 1.5);
  const valorMinimoMotoboy = numero(configApp?.valorMinimoMotoboy, 5);

  const taxaRetornoMotoboy = precisaRetorno
    ? numero(configApp?.taxaRetornoMotoboy, 0)
    : 0;

  const taxaSistema = numero(configApp?.taxaSistemaPadrao, 2);
  const multiplicador = numero(configApp?.multiplicadorDemanda, 1);

  const valorCalculadoMotoboy =
    (taxaBaseMotoboy + (distanciaKm * valorKmMotoboy)) * multiplicador;

  const valorMotoboy =
    Math.max(valorMinimoMotoboy, valorCalculadoMotoboy) + taxaRetornoMotoboy;

  const valorTotal = valorMotoboy + taxaSistema;

  return {
    distanciaKm,
    valorMotoboy,
    taxaSistema,
    taxaRetornoMotoboy,
    valorTotal,
    taxaBaseMotoboy,
    valorKmMotoboy,
    valorMinimoMotoboy,
    multiplicador
  };
}

function configurarNovoPedidoUmaVez() {
  if (novoPedidoConfigurado) return;

  novoPedidoConfigurado = true;

  const distancia = document.getElementById("distanciaEntregaKm");
  if (distancia) {
    distancia.addEventListener("input", calcularPedido);
  }

  const formaPagamento = document.getElementById("formaPagamento");
  if (formaPagamento) {
    formaPagamento.addEventListener("change", calcularPedido);
  }

  const precisaRetorno = document.getElementById("precisaRetorno");
  if (precisaRetorno) {
    precisaRetorno.addEventListener("change", () => {
      calcularPedido();
    });
  }
}

function timestampParaMillis(timestamp) {
  if (!timestamp) return Date.now();
  if (timestamp.toMillis) return timestamp.toMillis();
  if (timestamp.toDate) return timestamp.toDate().getTime();
  return Date.now();
}

function statusPedidoTexto(status) {
  if (status === "pendente") return "Buscando motoboy";
  if (status === "buscando_motoboy") return "Buscando motoboy";
  if (status === "sem_motoboy") return "Sem motoboy disponível";
  if (status === "aceito") return "Aceito";
  if (status === "entregue") return "Entregue";
  return status || "Pendente";
}

function classeStatusPedido(status) {
  if (status === "sem_motoboy") return "recusada";
  if (status === "aceito") return "aprovada";
  if (status === "entregue") return "aprovada";
  return "pendente";
}

function limparTimersBuscaMotoboy() {
  Object.values(timersBuscaMotoboy).forEach((timerId) => {
    clearTimeout(timerId);
  });

  timersBuscaMotoboy = {};
}

async function avancarRaioOuMarcarSemMotoboy(pedidoId, pedido) {
  const raios = Array.isArray(pedido.raiosBuscaKm) && pedido.raiosBuscaKm.length > 0
    ? pedido.raiosBuscaKm.map(Number)
    : [3, 5, 10, 15];

  const tentativaAtual = Number(pedido.tentativaBusca || 0);
  const proximaTentativa = tentativaAtual + 1;

  const pedidoRef = doc(db, "pedidos", pedidoId);

  if (proximaTentativa >= raios.length) {
    await updateDoc(pedidoRef, {
      status: "sem_motoboy",
      semMotoboyAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return;
  }

  await updateDoc(pedidoRef, {
    status: "buscando_motoboy",
    tentativaBusca: proximaTentativa,
    raioAtualKm: raios[proximaTentativa],
    ultimaExpansaoAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function programarExpansaoDoPedido(pedidoId, pedido) {
  if (timersBuscaMotoboy[pedidoId]) {
    clearTimeout(timersBuscaMotoboy[pedidoId]);
  }

  const statusBusca =
    pedido.status === "pendente" ||
    pedido.status === "buscando_motoboy";

  if (!statusBusca) return;
  if (pedido.motoboyId) return;

  const tempoPorRaioSegundos = Number(
    pedido.tempoPorRaioSegundos ||
    configApp?.tempoPorRaioSegundos ||
    15
  );

  const atualizadoEm = timestampParaMillis(pedido.updatedAt || pedido.createdAt);
  const agora = Date.now();
  const tempoPassado = agora - atualizadoEm;
  const tempoTotal = tempoPorRaioSegundos * 1000;
  const tempoRestante = Math.max(1000, tempoTotal - tempoPassado);

  timersBuscaMotoboy[pedidoId] = setTimeout(async () => {
    try {
      await avancarRaioOuMarcarSemMotoboy(pedidoId, pedido);
    } catch (erro) {
      console.error("Erro ao avançar raio do pedido:", erro);
    }
  }, tempoRestante);
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
          mostrarErroDashboard("Cadastro do restaurante não encontrado.");
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
        mostrarErroDashboard("Sem permissão para carregar o restaurante.");
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
      where("restauranteId", "==", user.uid)
    );

    onSnapshot(q, (snapshot) => {
      const lista = document.getElementById("listaRecargas");
      if (!lista) return;

      lista.innerHTML = "";

      if (snapshot.empty) {
        lista.innerHTML = `<div class="empty-mini">Nenhuma recarga solicitada ainda.</div>`;
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

      recargas.forEach((r) => {
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
    });
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

export function carregarNovoPedidoRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./login.html";
      return;
    }

    configurarNovoPedidoUmaVez();

    const restauranteRef = doc(db, "restaurantes", user.uid);
    const configRef = doc(db, "config", "app");

    onSnapshot(restauranteRef, (snap) => {
      if (!snap.exists()) {
        setText("saldoPrePago", "Cadastro não encontrado");
        mostrarMensagem("Restaurante não encontrado no Firestore.");
        return;
      }

      restauranteLogado = {
        id: user.uid,
        ...snap.data()
      };

      setText("saldoPrePago", dinheiro(restauranteLogado.saldoPrePago));

      if (!document.getElementById("enderecoCidade")?.value && restauranteLogado.cidade) {
        document.getElementById("enderecoCidade").value = restauranteLogado.cidade;
      }

      calcularPedido();
    });

    onSnapshot(configRef, (snap) => {
      if (!snap.exists()) {
        mostrarMensagem("Configuração do app não encontrada.");
        return;
      }

      configApp = snap.data();

      const raios = configApp.raiosBuscaKm || [3, 5, 10, 15];
      setText("raioInicialPedido", `${raios[0] || 3} km`);

      calcularPedido();
    });
  });
}

export async function buscarEnderecoEntrega() {
  const msg = document.getElementById("mensagem");
  const btn = document.getElementById("btnBuscarEndereco");
  const distanciaInput = document.getElementById("distanciaEntregaKm");
  const enderecoBox = document.getElementById("enderecoConfirmadoBox");

  if (msg) msg.innerText = "";

  if (!restauranteLogado) {
    if (msg) msg.innerText = "Restaurante ainda não carregado.";
    return;
  }

  if (!restauranteLogado.location?.lat || !restauranteLogado.location?.lng) {
    if (msg) msg.innerText = "Restaurante sem localização fixa cadastrada.";
    return;
  }

  const endereco = montarEnderecoEntrega();

  if (!endereco.rua || !endereco.numeroEndereco || !endereco.bairro || !endereco.cidade) {
    if (msg) msg.innerText = "Informe rua, número, bairro e cidade.";
    return;
  }

  if (!window.google?.maps?.places) {
    if (msg) msg.innerText = "Google Places não carregou. Confira a API Key.";
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Buscando endereço...";
  }

  try {
    const service = new google.maps.places.PlacesService(document.createElement("div"));

    const request = {
      query: endereco.enderecoCompleto,
      fields: ["name", "formatted_address", "geometry"]
    };

    service.findPlaceFromQuery(request, (results, status) => {
      if (btn) {
        btn.disabled = false;
        btn.innerText = "Buscar endereço";
      }

      if (status !== google.maps.places.PlacesServiceStatus.OK || !results || !results[0]) {
        if (msg) msg.innerText = "Erro ao buscar endereço. Confira rua, número, bairro e cidade.";
        return;
      }

      const place = results[0];
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();

      const distancia = calcularDistanciaKm(
        restauranteLogado.location.lat,
        restauranteLogado.location.lng,
        lat,
        lng
      );

      enderecoEncontrado = {
        enderecoFormatado: place.formatted_address || endereco.enderecoCompleto,
        lat,
        lng,
        distanciaKm: distancia
      };

      if (distanciaInput) {
        distanciaInput.value = distancia.toFixed(1);
      }

      setText("enderecoConfirmadoTexto", enderecoEncontrado.enderecoFormatado);

      if (enderecoBox) {
        enderecoBox.classList.remove("hidden");
      }

      calcularPedido();
    });
  } catch (erro) {
    console.error(erro);

    if (btn) {
      btn.disabled = false;
      btn.innerText = "Buscar endereço";
    }

    if (msg) msg.innerText = "Erro ao buscar endereço.";
  }
}

export function calcularPedido() {
  atualizarResumoPagamento();

  if (!configApp || !restauranteLogado) {
    return;
  }

  const valores = calcularValoresPedido();

  pedidoCalculado = valores;

  setText("valorTotalPedido", dinheiro(valores.valorTotal));
  setText("valorMotoboyPedido", dinheiro(valores.valorMotoboy));
  setText("taxaSistemaPedido", dinheiro(valores.taxaSistema));
  setText("taxaRetornoPedido", dinheiro(valores.taxaRetornoMotoboy));

  if (valores.distanciaKm > 0) {
    setText("distanciaResumoPedido", `${valores.distanciaKm.toFixed(2)} km`);
  } else {
    setText("distanciaResumoPedido", "---");
  }
}

export async function criarPedido() {
  const msg = document.getElementById("mensagem");
  const btn = document.getElementById("btnCriarPedido");

  const pedidoCopiado = document.getElementById("pedidoCopiado")?.value.trim() || "";
  const endereco = montarEnderecoEntrega();
  const observacao = document.getElementById("observacaoPedido")?.value.trim() || "";
  const formaPagamento = document.getElementById("formaPagamento")?.value || "pix";
  const precisaRetorno = document.getElementById("precisaRetorno")?.checked === true;
  const valorTroco = numero(document.getElementById("valorTroco")?.value, 0);

  if (msg) msg.innerText = "";

  if (!restauranteLogado) {
    if (msg) msg.innerText = "Restaurante não carregado.";
    return;
  }

  if (!enderecoEncontrado) {
    if (msg) msg.innerText = "Busque e confirme o endereço antes de criar o pedido.";
    return;
  }

  if (!pedidoCalculado || !pedidoCalculado.distanciaKm) {
    if (msg) msg.innerText = "Calcule a distância antes de criar o pedido.";
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Criando pedido...";
  }

  try {
    const restauranteRef = doc(db, "restaurantes", restauranteLogado.id);
    const pedidoRef = doc(collection(db, "pedidos"));
    const ledgerRef = doc(collection(db, "ledger_restaurante"));

    await runTransaction(db, async (transaction) => {
      const restauranteSnap = await transaction.get(restauranteRef);

      if (!restauranteSnap.exists()) {
        throw new Error("Restaurante não encontrado.");
      }

      const restaurante = restauranteSnap.data();

      if (restaurante.ativo === false) {
        throw new Error("Restaurante inativo.");
      }

      if (restaurante.bloqueado === true) {
        throw new Error("Restaurante bloqueado.");
      }

      const saldoAntes = numero(restaurante.saldoPrePago, 0);
      const valorTotal = numero(pedidoCalculado.valorTotal, 0);

      if (saldoAntes < valorTotal) {
        throw new Error("Saldo insuficiente.");
      }

      const saldoDepois = saldoAntes - valorTotal;
      const raiosBuscaKm = configApp?.raiosBuscaKm || [3, 5, 10, 15];

      transaction.set(pedidoRef, {
        restauranteId: restauranteLogado.id,
        restauranteNome: restaurante.nome || restauranteLogado.nome || "",

        pedidoCopiado,

        enderecoEntrega: enderecoEncontrado.enderecoFormatado,
        enderecoRua: endereco.rua,
        enderecoNumero: endereco.numeroEndereco,
        enderecoBairro: endereco.bairro,
        enderecoCidade: endereco.cidade,
        enderecoComplemento: endereco.complemento,

        lat: Number(restaurante.location.lat),
        lng: Number(restaurante.location.lng),

        location: {
          lat: Number(restaurante.location.lat),
          lng: Number(restaurante.location.lng)
        },

        restauranteLocation: {
          lat: Number(restaurante.location.lat),
          lng: Number(restaurante.location.lng)
        },

        entregaLocation: {
          lat: Number(enderecoEncontrado.lat),
          lng: Number(enderecoEncontrado.lng)
        },

        distanciaKm: pedidoCalculado.distanciaKm,

        formaPagamento,
        precisaRetorno,
        valorTroco,
        observacao,

        valorMotoboy: pedidoCalculado.valorMotoboy,
        taxaSistema: pedidoCalculado.taxaSistema,
        taxaRetornoMotoboy: pedidoCalculado.taxaRetornoMotoboy,
        valorTotal: pedidoCalculado.valorTotal,

        taxaBaseMotoboyUsada: pedidoCalculado.taxaBaseMotoboy,
        valorKmMotoboyUsado: pedidoCalculado.valorKmMotoboy,
        valorMinimoMotoboyUsado: pedidoCalculado.valorMinimoMotoboy,
        multiplicadorDemandaUsado: pedidoCalculado.multiplicador,
        motivoMultiplicador: configApp?.motivoMultiplicador || "",

        status: "buscando_motoboy",
        motoboyId: "",
        motoboyNome: "",
        recusadoPor: [],

        raioAtualKm: raiosBuscaKm[0] || 3,
        raiosBuscaKm,
        tentativaBusca: 0,
        tempoPorRaioSegundos: numero(configApp?.tempoPorRaioSegundos, 15),

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        aceitoAt: null,
        entregueAt: null
      });

      transaction.update(restauranteRef, {
        saldoPrePago: saldoDepois,
        totalPedidos: numero(restaurante.totalPedidos, 0) + 1,
        totalGasto: numero(restaurante.totalGasto, 0) + valorTotal,
        ultimoPedidoAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      transaction.set(ledgerRef, {
        restauranteId: restauranteLogado.id,
        restauranteNome: restaurante.nome || restauranteLogado.nome || "",
        tipo: "debito_pedido",
        valor: -valorTotal,
        saldoAntes,
        saldoDepois,
        pedidoId: pedidoRef.id,
        recargaId: null,
        descricao: "Pedido criado e valor debitado do saldo pré-pago",
        createdAt: serverTimestamp()
      });
    });

    document.getElementById("pedidoCopiado").value = "";
    document.getElementById("enderecoRua").value = "";
    document.getElementById("enderecoNumero").value = "";
    document.getElementById("enderecoBairro").value = "";
    document.getElementById("enderecoComplemento").value = "";
    document.getElementById("distanciaEntregaKm").value = "";
    document.getElementById("observacaoPedido").value = "";
    document.getElementById("precisaRetorno").checked = false;
    document.getElementById("valorTroco").value = "";
    document.getElementById("valorTroco").classList.add("hidden");
    document.getElementById("enderecoConfirmadoBox")?.classList.add("hidden");

    enderecoEncontrado = null;
    pedidoCalculado = null;

    setText("valorTotalPedido", dinheiro(0));
    setText("valorMotoboyPedido", dinheiro(0));
    setText("taxaSistemaPedido", dinheiro(0));
    setText("taxaRetornoPedido", dinheiro(0));
    setText("distanciaResumoPedido", "---");

    if (msg) msg.innerText = "Pedido criado com sucesso.";
  } catch (erro) {
    console.error(erro);

    if (msg) {
      msg.innerText = erro.message || "Erro ao criar pedido.";
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerText = "Criar pedido";
  }
}

export async function tentarNovamentePedido(pedidoId) {
  if (!pedidoId) return;

  const pedidoRef = doc(db, "pedidos", pedidoId);
  const pedidoSnap = await getDoc(pedidoRef);

  if (!pedidoSnap.exists()) {
    alert("Pedido não encontrado.");
    return;
  }

  const pedido = pedidoSnap.data();

  const raios = Array.isArray(pedido.raiosBuscaKm) && pedido.raiosBuscaKm.length > 0
    ? pedido.raiosBuscaKm.map(Number)
    : [3, 5, 10, 15];

  await updateDoc(pedidoRef, {
    status: "buscando_motoboy",
    motoboyId: "",
    motoboyNome: "",
    raioAtualKm: raios[0] || 3,
    tentativaBusca: 0,
    recusadoPor: [],
    ultimaExpansaoAt: serverTimestamp(),
    semMotoboyAt: null,
    updatedAt: serverTimestamp()
  });

  alert("Busca reiniciada. O sistema tentará encontrar motoboys novamente.");
}

export function carregarPedidosPendentesRestaurante() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const lista = document.getElementById("listaPedidosPendentes");
    if (!lista) return;

    const q = query(
      collection(db, "pedidos"),
      where("restauranteId", "==", user.uid)
    );

    onSnapshot(
      q,
      (snapshot) => {
        limparTimersBuscaMotoboy();

        const pedidos = [];

        snapshot.forEach((docSnap) => {
          const pedido = {
            id: docSnap.id,
            ...docSnap.data()
          };

          const deveAparecer =
            pedido.status === "pendente" ||
            pedido.status === "buscando_motoboy" ||
            pedido.status === "sem_motoboy";

          if (deveAparecer) {
            pedidos.push(pedido);
          }
        });

        pedidos.sort((a, b) => {
          const dataA = timestampParaMillis(a.createdAt);
          const dataB = timestampParaMillis(b.createdAt);
          return dataB - dataA;
        });

        lista.innerHTML = "";

        if (pedidos.length === 0) {
          lista.innerHTML = `
            <div class="empty-mini">
              Nenhum pedido pendente no momento.
            </div>
          `;
          return;
        }

        pedidos.forEach((pedido) => {
          programarExpansaoDoPedido(pedido.id, pedido);

          const card = document.createElement("div");
          card.className = "pending-order-card";

          const statusClasse = classeStatusPedido(pedido.status);
          const statusTexto = statusPedidoTexto(pedido.status);

          card.innerHTML = `
            <div class="pending-order-top">
              <div>
                <span>Aguardando motoboy</span>
                <strong>${pedido.enderecoEntrega || "Endereço não informado"}</strong>
              </div>

              <span class="status-pill ${statusClasse}">
                ${statusTexto}
              </span>
            </div>

            <div class="pending-order-info">
              <p><b>Pagamento:</b> ${pedido.formaPagamento || "pix"}</p>
              <p><b>Retorno:</b> ${pedido.precisaRetorno ? "Sim" : "Não"}</p>
              <p><b>Distância:</b> ${Number(pedido.distanciaKm || 0).toFixed(2)} km</p>
              <p><b>Raio atual:</b> ${pedido.raioAtualKm || 3} km</p>
              <p><b>Motoboy:</b> ${pedido.motoboyNome || "Ainda não aceito"}</p>
              <p><b>Valor motoboy:</b> ${dinheiro(pedido.valorMotoboy)}</p>
              <p><b>Taxa Cheguei:</b> ${dinheiro(pedido.taxaSistema)}</p>
              <p><b>Total debitado:</b> ${dinheiro(pedido.valorTotal)}</p>
            </div>

            ${
              pedido.status === "sem_motoboy"
                ? `
                  <button class="secondary-action retry-order-btn" data-tentar-novamente="${pedido.id}">
                    Tentar novamente
                  </button>
                `
                : `
                  <div class="search-progress">
                    Buscando motoboy no raio de ${pedido.raioAtualKm || 3} km...
                  </div>
                `
            }
          `;

          lista.appendChild(card);
        });

        lista.querySelectorAll("button[data-tentar-novamente]").forEach((button) => {
          button.addEventListener("click", async () => {
            const pedidoId = button.dataset.tentarNovamente;

            button.disabled = true;
            button.innerText = "Reiniciando busca...";

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
      },
      (erro) => {
        console.error("Erro ao carregar pedidos pendentes:", erro);

        lista.innerHTML = `
          <div class="empty-mini">
            Erro ao carregar pedidos pendentes.
          </div>
        `;
      }
    );
  });
}

export async function sairRestaurante() {
  await signOut(auth);
  window.location.href = "./login.html";
}
