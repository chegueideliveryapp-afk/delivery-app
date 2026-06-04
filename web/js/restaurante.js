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
  setDoc,
  serverTimestamp,
  query,
  where,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const GOOGLE_MAPS_API_KEY = "AIzaSyApRas85TE6FYQRzKMxjY2mTPs-XplM0u4";

let restauranteLogado = null;
let configApp = null;
let pedidoCalculado = null;
let googleMapsPromise = null;
let placesService = null;
let autocompleteService = null;
let placesContainer = null;

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

function mostrarMensagem(texto, sucesso = false) {
  const msg = document.getElementById("mensagem");

  if (!msg) return;

  msg.innerText = texto || "";
  msg.style.color = sucesso ? "#166534" : "#c02626";
}

function numero(valor, padrao = 0) {
  const n = Number(valor || padrao);
  return Number.isFinite(n) ? n : padrao;
}

function arredondar2(valor) {
  return Math.round((Number(valor || 0) + Number.EPSILON) * 100) / 100;
}

function limparTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const raioTerraKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return raioTerraKm * c;
}

function carregarGoogleMapsPlaces() {
  if (window.google?.maps?.places?.PlacesService) {
    return Promise.resolve(window.google.maps);
  }

  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = `initGoogleMapsPlacesCheguei_${Date.now()}`;

    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Erro ao carregar Google Maps Places."));

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

async function obterPlacesServices() {
  const maps = await carregarGoogleMapsPlaces();

  if (!placesContainer) {
    placesContainer = document.createElement("div");
    placesContainer.style.display = "none";
    document.body.appendChild(placesContainer);
  }

  if (!placesService) {
    placesService = new maps.places.PlacesService(placesContainer);
  }

  if (!autocompleteService) {
    autocompleteService = new maps.places.AutocompleteService();
  }

  return {
    maps,
    placesService,
    autocompleteService
  };
}

async function buscarEnderecoNoCache(cacheId) {
  const opcoesColecao = [
    "geocoding_cache",
    "enderecos_cache",
    "cache_enderecos"
  ];

  for (const nomeColecao of opcoesColecao) {
    const ref = doc(db, nomeColecao, cacheId);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      return snap.data();
    }
  }

  return null;
}

async function salvarEnderecoNoCache(cacheId, dados) {
  await setDoc(
    doc(db, "geocoding_cache", cacheId),
    {
      ...dados,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function pontuarPredicao(prediction, endereco) {
  const descricao = normalizarTexto(prediction.description || "");
  const rua = normalizarTexto(endereco.rua);
  const numeroEndereco = normalizarTexto(endereco.numeroEndereco);
  const bairro = normalizarTexto(endereco.bairro);
  const cidade = normalizarTexto(endereco.cidade);

  let pontos = 0;

  if (cidade && descricao.includes(cidade)) pontos += 40;
  if (bairro && descricao.includes(bairro)) pontos += 30;
  if (rua && descricao.includes(rua)) pontos += 30;
  if (numeroEndereco && descricao.includes(numeroEndereco)) pontos += 15;

  if (descricao.includes("brasil")) pontos += 5;
  if (descricao.includes("sp")) pontos += 5;

  return pontos;
}

async function buscarPredicoesEndereco(endereco) {
  const { maps, autocompleteService } = await obterPlacesServices();

  const input = [
    endereco.rua,
    endereco.numeroEndereco,
    endereco.bairro,
    endereco.cidade,
    "SP",
    "Brasil"
  ].filter(Boolean).join(", ");

  return new Promise((resolve, reject) => {
    autocompleteService.getPlacePredictions(
      {
        input,
        componentRestrictions: {
          country: "br"
        },
        location: restauranteLogado?.location
          ? new maps.LatLng(
              Number(restauranteLogado.location.lat),
              Number(restauranteLogado.location.lng)
            )
          : undefined,
        radius: 50000,
        types: ["address"]
      },
      (predictions, status) => {
        const statusOk = window.google.maps.places.PlacesServiceStatus.OK;

        if (status !== statusOk || !predictions?.length) {
          reject(new Error(`Nenhum endereço encontrado. Status: ${status}`));
          return;
        }

        const ordenadas = predictions
          .map((prediction) => ({
            ...prediction,
            pontos: pontuarPredicao(prediction, endereco)
          }))
          .sort((a, b) => b.pontos - a.pontos);

        resolve(ordenadas);
      }
    );
  });
}

async function buscarDetalhesPlace(placeId) {
  const { placesService } = await obterPlacesServices();

  return new Promise((resolve, reject) => {
    placesService.getDetails(
      {
        placeId,
        fields: [
          "place_id",
          "name",
          "formatted_address",
          "geometry"
        ]
      },
      (place, status) => {
        const statusOk = window.google.maps.places.PlacesServiceStatus.OK;

        if (status !== statusOk || !place) {
          reject(new Error(`Erro ao carregar detalhes do endereço. Status: ${status}`));
          return;
        }

        if (!place.geometry?.location) {
          reject(new Error("Endereço encontrado sem localização."));
          return;
        }

        resolve({
          placeId: place.place_id || placeId,
          enderecoFormatado: place.formatted_address || place.name || "",
          location: {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng()
          },
          provider: "google_places_autocomplete"
        });
      }
    );
  });
}

async function aplicarEnderecoEncontrado(cacheId, endereco, dadosEndereco) {
  const origemLat = Number(restauranteLogado.location.lat);
  const origemLng = Number(restauranteLogado.location.lng);
  const destinoLat = Number(dadosEndereco.location.lat);
  const destinoLng = Number(dadosEndereco.location.lng);

  const distanciaKm = calcularDistanciaKm(
    origemLat,
    origemLng,
    destinoLat,
    destinoLng
  );

  const distanciaComMargem = arredondar2(distanciaKm * 1.25);

  document.getElementById("distanciaEntregaKm").value = distanciaComMargem;

  await salvarEnderecoNoCache(cacheId, {
    cacheId,
    enderecoDigitado: endereco.enderecoCompleto,
    enderecoFormatado: dadosEndereco.enderecoFormatado,
    placeId: dadosEndereco.placeId || "",
    location: dadosEndereco.location,
    provider: dadosEndereco.provider,
    createdAt: serverTimestamp()
  });

  setHtml(
    "resultadoEndereco",
    `
      <div class="address-suggestion muted">
        Endereço selecionado:<br>
        <strong>${dadosEndereco.enderecoFormatado || endereco.enderecoCompleto}</strong><br>
        Distância estimada para cobrança: ${distanciaComMargem.toFixed(2)} km
      </div>
    `
  );

  calcularPedido();

  mostrarMensagem("Endereço selecionado e distância calculada.", true);
}

function renderizarOpcoesEndereco(cacheId, endereco, predicoes) {
  const lista = predicoes.slice(0, 5);

  const html = lista.map((prediction, index) => {
    return `
      <button
        type="button"
        class="address-suggestion"
        data-place-id="${prediction.place_id}"
        data-cache-id="${cacheId}"
      >
        ${index === 0 ? "Melhor opção: " : ""}
        ${prediction.description}
      </button>
    `;
  }).join("");

  setHtml(
    "resultadoEndereco",
    `
      <div class="address-suggestion muted">
        Confira o endereço antes de criar o pedido. Clique na opção correta:
      </div>
      ${html}
    `
  );

  document.querySelectorAll("button[data-place-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.innerText = "Selecionando endereço...";

      try {
        const detalhes = await buscarDetalhesPlace(button.dataset.placeId);
        await aplicarEnderecoEncontrado(button.dataset.cacheId, endereco, detalhes);
      } catch (erro) {
        console.error(erro);
        mostrarMensagem(erro.message || "Erro ao selecionar endereço.");
        button.disabled = false;
      }
    });
  });
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

  const taxaBaseMotoboy = numero(configApp?.taxaBaseMotoboy, 0);
  const valorKmMotoboy = numero(configApp?.valorKmMotoboy, 0);
  const valorMinimoMotoboy = numero(configApp?.valorMinimoMotoboy, 0);
  const multiplicadorDemanda = numero(configApp?.multiplicadorDemanda, 1);

  const taxaRetornoMotoboy = precisaRetorno
    ? numero(configApp?.taxaRetornoMotoboy, 0)
    : 0;

  const taxaSistema = numero(configApp?.taxaSistemaPadrao, 5);

  const valorPorDistancia = distanciaKm * valorKmMotoboy * multiplicadorDemanda;
  const valorCalculadoMotoboy = taxaBaseMotoboy + valorPorDistancia;

  const valorMotoboy = arredondar2(
    Math.max(valorMinimoMotoboy, valorCalculadoMotoboy) + taxaRetornoMotoboy
  );

  const taxaSistemaFinal = arredondar2(taxaSistema);
  const taxaRetornoFinal = arredondar2(taxaRetornoMotoboy);
  const valorTotal = arredondar2(valorMotoboy + taxaSistemaFinal);

  return {
    distanciaKm: arredondar2(distanciaKm),
    valorMotoboy,
    taxaSistema: taxaSistemaFinal,
    taxaRetornoMotoboy: taxaRetornoFinal,
    valorTotal
  };
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
          setText("nomeRestaurante", "Erro ao carregar");
          setText("statusConta", "Atenção");
          setText("statusDescricao", "Cadastro do restaurante não encontrado.");
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
        setText("nomeRestaurante", "Erro ao carregar");
        setText("statusConta", "Atenção");
        setText("statusDescricao", "Sem permissão para carregar o restaurante.");
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
  const valor = arredondar2(document.getElementById("valorRecarga").value || 0);
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

    onSnapshot(
      restauranteRef,
      (snap) => {
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

        if (restauranteLogado.location?.lat && restauranteLogado.location?.lng) {
          calcularPedido();
        }
      },
      (erro) => {
        console.error(erro);
        setText("saldoPrePago", "Erro");
        mostrarMensagem("Erro ao carregar saldo do restaurante.");
      }
    );

    onSnapshot(
      configRef,
      (snap) => {
        if (!snap.exists()) {
          mostrarMensagem("Configuração do app não encontrada.");
          return;
        }

        configApp = snap.data();

        const raios = configApp.raiosBuscaKm || [3, 5, 10, 15];
        setText("raioInicialPedido", `${raios[0] || 3} km`);

        calcularPedido();
      },
      (erro) => {
        console.error(erro);
        mostrarMensagem("Erro ao carregar configurações do app.");
      }
    );
  });
}

export async function buscarEnderecoEntrega() {
  const resultado = document.getElementById("resultadoEndereco");
  const btn = document.getElementById("btnBuscarEndereco");

  mostrarMensagem("");

  if (resultado) resultado.innerHTML = "";

  if (!restauranteLogado) {
    mostrarMensagem("Restaurante ainda não carregado.");
    return;
  }

  if (!restauranteLogado.location?.lat || !restauranteLogado.location?.lng) {
    mostrarMensagem("Restaurante sem localização fixa cadastrada.");
    return;
  }

  const endereco = montarEnderecoEntrega();

  if (!endereco.rua || !endereco.numeroEndereco || !endereco.bairro || !endereco.cidade) {
    mostrarMensagem("Informe rua, número, bairro e cidade.");
    return;
  }

  const cacheId = normalizarTexto(`places-v2-${endereco.enderecoCompleto}`);

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Buscando...";
  }

  try {
    const cache = await buscarEnderecoNoCache(cacheId);

    if (cache?.location?.lat && cache?.location?.lng) {
      await aplicarEnderecoEncontrado(cacheId, endereco, cache);

      if (btn) {
        btn.disabled = false;
        btn.innerText = "Buscar endereço";
      }

      return;
    }

    const predicoes = await buscarPredicoesEndereco(endereco);

    if (!predicoes.length) {
      throw new Error("Nenhum endereço encontrado.");
    }

    renderizarOpcoesEndereco(cacheId, endereco, predicoes);

    const melhor = predicoes[0];

    if (melhor.pontos >= 70) {
      const detalhes = await buscarDetalhesPlace(melhor.place_id);
      await aplicarEnderecoEncontrado(cacheId, endereco, detalhes);
    } else {
      mostrarMensagem("Confira e selecione o endereço correto na lista.", true);
    }
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(erro.message || "Erro ao buscar endereço.");
  }

  if (btn) {
    btn.disabled = false;
    btn.innerText = "Buscar endereço";
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
  const btn = document.getElementById("btnCriarPedido");

  const pedidoCopiado = document.getElementById("pedidoCopiado")?.value.trim() || "";
  const endereco = montarEnderecoEntrega();
  const observacao = document.getElementById("observacaoPedido")?.value.trim() || "";
  const formaPagamento = document.getElementById("formaPagamento")?.value || "pix";
  const precisaRetorno = document.getElementById("precisaRetorno")?.checked === true;
  const valorTroco = arredondar2(document.getElementById("valorTroco")?.value || 0);

  mostrarMensagem("");

  if (!restauranteLogado) {
    mostrarMensagem("Restaurante não carregado.");
    return;
  }

  if (!configApp) {
    mostrarMensagem("Configurações do app não carregadas.");
    return;
  }

  if (!endereco.rua || !endereco.numeroEndereco || !endereco.bairro || !endereco.cidade) {
    mostrarMensagem("Informe rua, número, bairro e cidade.");
    return;
  }

  if (!pedidoCalculado || !pedidoCalculado.distanciaKm) {
    mostrarMensagem("Busque o endereço antes de criar o pedido.");
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

      const saldoAntes = arredondar2(restaurante.saldoPrePago || 0);
      const valorTotalPedido = arredondar2(pedidoCalculado.valorTotal);
      const taxaSistema = arredondar2(pedidoCalculado.taxaSistema);
      const valorMotoboy = arredondar2(pedidoCalculado.valorMotoboy);
      const taxaRetornoMotoboy = arredondar2(pedidoCalculado.taxaRetornoMotoboy);

      if (saldoAntes < valorTotalPedido) {
        throw new Error(`Saldo insuficiente. Este pedido custa ${dinheiro(valorTotalPedido)} e seu saldo é ${dinheiro(saldoAntes)}.`);
      }

      const saldoDepois = arredondar2(saldoAntes - valorTotalPedido);
      const raiosBuscaKm = configApp?.raiosBuscaKm || [3, 5, 10, 15];

      transaction.set(pedidoRef, {
        restauranteId: restauranteLogado.id,
        restauranteNome: restaurante.nome || restauranteLogado.nome || "",

        pedidoCopiado,

        enderecoEntrega: endereco.enderecoCompleto,
        enderecoRua: endereco.rua,
        enderecoNumero: endereco.numeroEndereco,
        enderecoBairro: endereco.bairro,
        enderecoCidade: endereco.cidade,
        enderecoComplemento: endereco.complemento,

        restauranteLocation: {
          lat: Number(restaurante.location.lat),
          lng: Number(restaurante.location.lng)
        },

        distanciaKm: pedidoCalculado.distanciaKm,

        formaPagamento,
        precisaRetorno,
        valorTroco,
        observacao,

        valorMotoboy,
        taxaSistema,
        taxaRetornoMotoboy,
        valorTotal: valorTotalPedido,

        taxaBaseMotoboyUsada: arredondar2(configApp?.taxaBaseMotoboy || 0),
        valorKmMotoboyUsado: arredondar2(configApp?.valorKmMotoboy || 0),
        valorMinimoMotoboyUsado: arredondar2(configApp?.valorMinimoMotoboy || 0),
        multiplicadorDemandaUsado: numero(configApp?.multiplicadorDemanda, 1),
        motivoMultiplicador: configApp?.motivoMultiplicador || "",

        status: "pendente",
        motoboyId: "",
        motoboyNome: "",
        recusadoPor: [],

        raioAtualKm: raiosBuscaKm[0] || 3,
        raiosBuscaKm,
        tempoPorRaioSegundos: numero(configApp?.tempoPorRaioSegundos, 15),
        tentativaBusca: 0,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        aceitoAt: null,
        entregueAt: null
      });

      transaction.update(restauranteRef, {
        saldoPrePago: saldoDepois,
        totalPedidos: Number(restaurante.totalPedidos || 0) + 1,
        totalGasto: arredondar2(Number(restaurante.totalGasto || 0) + valorTotalPedido),
        updatedAt: serverTimestamp()
      });

      transaction.set(ledgerRef, {
        restauranteId: restauranteLogado.id,
        restauranteNome: restaurante.nome || restauranteLogado.nome || "",
        tipo: "debito_pedido",
        valor: -valorTotalPedido,
        valorMotoboy,
        taxaSistema,
        taxaRetornoMotoboy,
        saldoAntes,
        saldoDepois,
        pedidoId: pedidoRef.id,
        recargaId: null,
        descricao: "Valor total do pedido debitado do saldo pré-pago",
        createdAt: serverTimestamp()
      });
    });

    document.getElementById("pedidoCopiado").value = "";
    document.getElementById("enderecoRua").value = "";
    document.getElementById("enderecoNumero").value = "";
    document.getElementById("enderecoBairro").value = "";
    document.getElementById("enderecoCidade").value = "";
    document.getElementById("enderecoComplemento").value = "";
    document.getElementById("distanciaEntregaKm").value = "";
    document.getElementById("observacaoPedido").value = "";
    document.getElementById("precisaRetorno").checked = false;
    document.getElementById("valorTroco").value = "";
    document.getElementById("valorTroco").classList.add("hidden");

    setHtml("resultadoEndereco", "");

    pedidoCalculado = null;

    setText("valorTotalPedido", dinheiro(0));
    setText("valorMotoboyPedido", dinheiro(0));
    setText("taxaSistemaPedido", dinheiro(0));
    setText("taxaRetornoPedido", dinheiro(0));
    setText("distanciaResumoPedido", "---");

    mostrarMensagem("Pedido criado com sucesso.", true);
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(erro.message || "Erro ao criar pedido.");
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
