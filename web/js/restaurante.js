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
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let restauranteLogado = null;
let configApp = null;
let pedidoCalculado = null;
let entregaSelecionada = null;
let mapaEntrega = null;
let camadaRota = null;
let marcadorRestaurante = null;
let marcadorEntrega = null;

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

function mostrarMensagem(texto) {
  const msg = document.getElementById("mensagem");
  if (msg) msg.innerText = texto;
}

function numero(valor, padrao = 0) {
  const n = Number(valor || padrao);
  return Number.isFinite(n) ? n : padrao;
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

function mostrarErroDashboard(texto) {
  setText("nomeRestaurante", "Erro ao carregar");
  setText("statusConta", "Atenção");
  setText("statusDescricao", texto);
}

function montarEnderecoEntrega() {
  const rua = document.getElementById("enderecoRua")?.value.trim() || "";
  const numeroEndereco = document.getElementById("enderecoNumero")?.value.trim() || "";
  const bairro = document.getElementById("enderecoBairro")?.value.trim() || "";
  const cidadeDigitada = document.getElementById("enderecoCidade")?.value.trim() || "";
  const complemento = document.getElementById("enderecoComplemento")?.value.trim() || "";

  const cidadeRestaurante =
    restauranteLogado?.cidade ||
    restauranteLogado?.municipio ||
    "";

  const cidade = cidadeDigitada || cidadeRestaurante;

  const enderecoCompleto = [
    rua,
    numeroEndereco,
    bairro,
    cidade,
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

  setText(
    "retornoResumo",
    precisaRetorno
      ? "Com retorno ao restaurante."
      : "Sem retorno ao restaurante."
  );
}

function calcularValoresPedido() {
  const distanciaKm = entregaSelecionada?.distanciaKm || 0;
  const precisaRetorno = document.getElementById("precisaRetorno")?.checked === true;

  const taxaBaseMotoboy = numero(configApp?.taxaBaseMotoboy, 0);
  const valorKmMotoboy = numero(configApp?.valorKmMotoboy, 0);
  const valorMinimoMotoboy = numero(configApp?.valorMinimoMotoboy, 0);

  const taxaRetornoMotoboy = precisaRetorno
    ? numero(configApp?.taxaRetornoMotoboy, 0)
    : 0;

  const taxaSistema = numero(
    restauranteLogado?.taxaSistemaPadrao,
    numero(configApp?.taxaSistemaPadrao, 5)
  );

  const valorCalculadoMotoboy = taxaBaseMotoboy + (distanciaKm * valorKmMotoboy);
  const valorMotoboy = Math.max(valorMinimoMotoboy, valorCalculadoMotoboy) + taxaRetornoMotoboy;
  const valorTotal = valorMotoboy + taxaSistema;

  return {
    distanciaKm,
    valorMotoboy,
    taxaSistema,
    taxaRetornoMotoboy,
    valorTotal
  };
}

function limparSugestoes() {
  const lista = document.getElementById("sugestoesEndereco");
  if (lista) lista.innerHTML = "";
}

function mostrarSugestaoMensagem(texto) {
  const lista = document.getElementById("sugestoesEndereco");
  if (!lista) return;

  lista.innerHTML = `
    <div class="address-suggestion muted">
      ${texto}
    </div>
  `;
}

function formatarEnderecoPhoton(feature) {
  const p = feature.properties || {};

  if (p.display_name) return p.display_name;

  return [
    p.name,
    p.street,
    p.housenumber,
    p.district,
    p.suburb,
    p.city,
    p.state
  ].filter(Boolean).join(", ");
}

async function buscarEnderecoPhoton(endereco) {
  const params = new URLSearchParams({
    q: endereco.enderecoCompleto,
    limit: "5",
    lang: "pt"
  });

  if (restauranteLogado?.location?.lat && restauranteLogado?.location?.lng) {
    params.set("lat", restauranteLogado.location.lat);
    params.set("lon", restauranteLogado.location.lng);
  }

  const resposta = await fetch(`https://photon.komoot.io/api/?${params.toString()}`);

  if (!resposta.ok) {
    throw new Error("Photon indisponível.");
  }

  const dados = await resposta.json();

  return dados.features || [];
}

async function buscarEnderecoNominatim(endereco) {
  const params = new URLSearchParams({
    q: endereco.enderecoCompleto,
    format: "geojson",
    limit: "5",
    countrycodes: "br",
    addressdetails: "1"
  });

  const resposta = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);

  if (!resposta.ok) {
    throw new Error("Nominatim indisponível.");
  }

  const dados = await resposta.json();

  return (dados.features || []).map((feature) => {
    const props = feature.properties || {};
    const address = props.address || {};

    return {
      geometry: feature.geometry,
      properties: {
        name: props.name || address.road || props.display_name,
        street: address.road,
        housenumber: address.house_number,
        district: address.neighbourhood || address.suburb,
        suburb: address.suburb,
        city: address.city || address.town || address.village || address.municipality,
        state: address.state,
        display_name: props.display_name
      }
    };
  });
}

async function calcularRotaOSRM(origem, destino) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origem.lng},${origem.lat};${destino.lng},${destino.lat}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;

  const resposta = await fetch(url);

  if (!resposta.ok) {
    throw new Error("Erro ao consultar rota.");
  }

  const dados = await resposta.json();

  if (dados.code !== "Ok" || !dados.routes?.length) {
    throw new Error("Não foi possível calcular a rota para esse endereço.");
  }

  const rota = dados.routes[0];

  return {
    distanciaKm: Number((rota.distance / 1000).toFixed(2)),
    duracaoMinutos: Math.round(rota.duration / 60),
    geometry: rota.geometry
  };
}

function iniciarMapaSeNecessario(origem) {
  const box = document.getElementById("mapaEntregaBox");
  const mapEl = document.getElementById("mapaEntrega");

  if (!box || !mapEl) return;

  box.classList.remove("hidden");

  if (!mapaEntrega) {
    mapaEntrega = L.map("mapaEntrega").setView([origem.lat, origem.lng], 14);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(mapaEntrega);
  }

  setTimeout(() => {
    mapaEntrega.invalidateSize();
  }, 120);
}

function desenharRotaNoMapa(origem, destino, geometry) {
  iniciarMapaSeNecessario(origem);

  if (!mapaEntrega) return;

  if (camadaRota) mapaEntrega.removeLayer(camadaRota);
  if (marcadorRestaurante) mapaEntrega.removeLayer(marcadorRestaurante);
  if (marcadorEntrega) mapaEntrega.removeLayer(marcadorEntrega);

  marcadorRestaurante = L.marker([origem.lat, origem.lng])
    .addTo(mapaEntrega)
    .bindPopup("Restaurante");

  marcadorEntrega = L.marker([destino.lat, destino.lng])
    .addTo(mapaEntrega)
    .bindPopup("Entrega");

  camadaRota = L.geoJSON(geometry, {
    style: {
      color: "#ea1d2c",
      weight: 5,
      opacity: 0.9
    }
  }).addTo(mapaEntrega);

  mapaEntrega.fitBounds(camadaRota.getBounds(), {
    padding: [28, 28]
  });
}

async function selecionarEndereco(feature) {
  try {
    mostrarMensagem("Calculando rota...");

    if (!restauranteLogado?.location?.lat || !restauranteLogado?.location?.lng) {
      mostrarMensagem("Restaurante sem localização fixa cadastrada.");
      return;
    }

    const destino = {
      lat: feature.geometry.coordinates[1],
      lng: feature.geometry.coordinates[0]
    };

    const origem = {
      lat: Number(restauranteLogado.location.lat),
      lng: Number(restauranteLogado.location.lng)
    };

    const rota = await calcularRotaOSRM(origem, destino);

    entregaSelecionada = {
      enderecoFormatado: formatarEnderecoPhoton(feature),
      location: destino,
      distanciaKm: rota.distanciaKm,
      duracaoMinutos: rota.duracaoMinutos
    };

    const distanciaInput = document.getElementById("distanciaEntregaKm");
    if (distanciaInput) {
      distanciaInput.value = `${rota.distanciaKm.toFixed(2)} km`;
    }

    desenharRotaNoMapa(origem, destino, rota.geometry);
    limparSugestoes();
    calcularPedido();

    mostrarMensagem("");
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(erro.message || "Erro ao calcular rota.");
  }
}

export async function buscarEnderecoEntrega() {
  const endereco = montarEnderecoEntrega();

  entregaSelecionada = null;
  pedidoCalculado = null;

  setText("valorTotalPedido", dinheiro(0));
  setText("valorMotoboyPedido", dinheiro(0));
  setText("taxaSistemaPedido", dinheiro(0));
  setText("taxaRetornoPedido", dinheiro(0));
  setText("distanciaResumoPedido", "---");

  const distanciaInput = document.getElementById("distanciaEntregaKm");
  if (distanciaInput) distanciaInput.value = "";

  if (!endereco.rua || !endereco.numeroEndereco || !endereco.bairro || !endereco.cidade) {
    mostrarMensagem("Informe rua, número, bairro e cidade.");
    return;
  }

  mostrarMensagem("");
  mostrarSugestaoMensagem("Buscando endereço...");

  try {
    let features = [];

    try {
      features = await buscarEnderecoPhoton(endereco);
    } catch (erroPhoton) {
      console.warn("Photon falhou. Tentando Nominatim...", erroPhoton);
      features = await buscarEnderecoNominatim(endereco);
    }

    if (!features.length) {
      mostrarSugestaoMensagem("Nenhum endereço encontrado. Confira rua, número, bairro e cidade.");
      return;
    }

    const lista = document.getElementById("sugestoesEndereco");
    if (!lista) return;

    lista.innerHTML = "";

    features.forEach((feature) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "address-suggestion";
      botao.innerText =
        formatarEnderecoPhoton(feature) ||
        feature.properties?.display_name ||
        endereco.enderecoCompleto;

      botao.addEventListener("click", () => {
        selecionarEndereco(feature);
      });

      lista.appendChild(botao);
    });
  } catch (erro) {
    console.error(erro);
    mostrarSugestaoMensagem("Erro ao buscar endereço. Tente novamente em alguns segundos.");
  }
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

      const cidadeInput = document.getElementById("enderecoCidade");
      if (cidadeInput && !cidadeInput.value) {
        cidadeInput.value =
          restauranteLogado.cidade ||
          restauranteLogado.municipio ||
          "";
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

export function calcularPedido() {
  atualizarResumoPagamento();

  if (!configApp || !restauranteLogado) return;

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

  if (!entregaSelecionada) {
    if (msg) msg.innerText = "Busque e selecione o endereço de entrega antes de criar o pedido.";
    return;
  }

  if (!pedidoCalculado || !pedidoCalculado.distanciaKm) {
    if (msg) msg.innerText = "A distância ainda não foi calculada.";
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
      const taxaSistema = numero(pedidoCalculado.taxaSistema, 0);

      if (saldoAntes < taxaSistema) {
        throw new Error("Saldo insuficiente para a taxa Cheguei.");
      }

      const saldoDepois = saldoAntes - taxaSistema;
      const raiosBuscaKm = configApp?.raiosBuscaKm || [3, 5, 10, 15];

      transaction.set(pedidoRef, {
        restauranteId: restauranteLogado.id,
        restauranteNome: restaurante.nome || restauranteLogado.nome || "",

        pedidoCopiado,

        enderecoEntrega: entregaSelecionada.enderecoFormatado || endereco.enderecoCompleto,
        enderecoRua: endereco.rua,
        enderecoNumero: endereco.numeroEndereco,
        enderecoBairro: endereco.bairro,
        enderecoCidade: endereco.cidade,
        enderecoComplemento: endereco.complemento,

        restauranteLocation: {
          lat: Number(restaurante.location.lat),
          lng: Number(restaurante.location.lng)
        },

        entregaLocation: {
          lat: entregaSelecionada.location.lat,
          lng: entregaSelecionada.location.lng
        },

        distanciaKm: pedidoCalculado.distanciaKm,
        duracaoMinutos: entregaSelecionada.duracaoMinutos || null,
        distanciaCalculadaPor: "photon_nominatim_osrm",

        formaPagamento,
        precisaRetorno,
        valorTroco,
        observacao,

        valorMotoboy: pedidoCalculado.valorMotoboy,
        taxaSistema: pedidoCalculado.taxaSistema,
        taxaRetornoMotoboy: pedidoCalculado.taxaRetornoMotoboy,
        valorTotal: pedidoCalculado.valorTotal,

        status: "pendente",
        motoboyId: "",
        motoboyNome: "",
        recusadoPor: [],

        raioAtualKm: raiosBuscaKm[0] || 3,
        raiosBuscaKm,
        tentativaBusca: 0,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        aceitoAt: null,
        entregueAt: null
      });

      transaction.update(restauranteRef, {
        saldoPrePago: saldoDepois,
        totalPedidos: numero(restaurante.totalPedidos, 0) + 1,
        totalGasto: numero(restaurante.totalGasto, 0) + taxaSistema,
        updatedAt: serverTimestamp()
      });

      transaction.set(ledgerRef, {
        restauranteId: restauranteLogado.id,
        restauranteNome: restaurante.nome || restauranteLogado.nome || "",
        tipo: "debito_pedido",
        valor: -taxaSistema,
        saldoAntes,
        saldoDepois,
        pedidoId: pedidoRef.id,
        recargaId: null,
        descricao: "Taxa Cheguei debitada na criação do pedido",
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

    entregaSelecionada = null;
    pedidoCalculado = null;
    limparSugestoes();

    setText("valorTotalPedido", dinheiro(0));
    setText("valorMotoboyPedido", dinheiro(0));
    setText("taxaSistemaPedido", dinheiro(0));
    setText("taxaRetornoPedido", dinheiro(0));
    setText("distanciaResumoPedido", "---");

    if (msg) msg.innerText = "Pedido criado com sucesso.";
  } catch (erro) {
    console.error(erro);
    if (msg) msg.innerText = erro.message || "Erro ao criar pedido.";
  }

  if (btn) {
    btn.disabled = false;
    btn.innerText = "Criar pedido";
  }
}

export async function sairRestaurante() {
  await signOut(auth);
  window.location.href = "./login.html";
}
