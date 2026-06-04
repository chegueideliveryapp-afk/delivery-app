import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
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
let googlePlacesCarregado = false;
let autocompleteService = null;
let placesService = null;

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

function removerAcentos(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarTexto(texto) {
  return removerAcentos(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function criarCacheId(enderecoCompleto) {
  const chave = normalizarTexto(enderecoCompleto);
  return chave.slice(0, 260) || `endereco-${Date.now()}`;
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

function calcularDistanciaEstimativa(entregaLocation) {
  const origem = restauranteLogado?.location;

  if (!origem?.lat || !origem?.lng || !entregaLocation?.lat || !entregaLocation?.lng) {
    return {
      distanciaLinhaRetaKm: 0,
      distanciaKm: 0,
      multiplicadorDistancia: numero(configApp?.multiplicadorDistancia, 1.35)
    };
  }

  const distanciaLinhaRetaKm = calcularDistanciaKm(
    Number(origem.lat),
    Number(origem.lng),
    Number(entregaLocation.lat),
    Number(entregaLocation.lng)
  );

  const multiplicadorDistancia = numero(configApp?.multiplicadorDistancia, 1.35);
  const distanciaMinimaKm = numero(configApp?.distanciaMinimaKm, 1);

  const distanciaKm = Math.max(
    distanciaLinhaRetaKm * multiplicadorDistancia,
    distanciaMinimaKm
  );

  return {
    distanciaLinhaRetaKm: Number(distanciaLinhaRetaKm.toFixed(2)),
    distanciaKm: Number(distanciaKm.toFixed(2)),
    multiplicadorDistancia
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

function mostrarEnderecoSelecionado(endereco, origem) {
  const box = document.getElementById("enderecoSelecionadoBox");

  if (box) box.classList.remove("hidden");

  setText("enderecoSelecionadoResumo", endereco);
  setText("origemEnderecoResumo", origem);
}

function resetarCalculoEndereco() {
  entregaSelecionada = null;
  pedidoCalculado = null;

  const distanciaInput = document.getElementById("distanciaEntregaKm");
  if (distanciaInput) distanciaInput.value = "";

  const box = document.getElementById("enderecoSelecionadoBox");
  if (box) box.classList.add("hidden");

  setText("valorTotalPedido", dinheiro(0));
  setText("valorMotoboyPedido", dinheiro(0));
  setText("taxaSistemaPedido", dinheiro(0));
  setText("taxaRetornoPedido", dinheiro(0));
  setText("distanciaResumoPedido", "---");
}

function usarEnderecoEncontrado(dados, origemTexto) {
  const estimativa = calcularDistanciaEstimativa({
    lat: Number(dados.lat),
    lng: Number(dados.lng)
  });

  entregaSelecionada = {
    enderecoFormatado: dados.enderecoFormatado,
    location: {
      lat: Number(dados.lat),
      lng: Number(dados.lng)
    },
    distanciaKm: estimativa.distanciaKm,
    distanciaLinhaRetaKm: estimativa.distanciaLinhaRetaKm,
    multiplicadorDistancia: estimativa.multiplicadorDistancia,
    placeId: dados.placeId || null,
    origemEndereco: origemTexto
  };

  const distanciaInput = document.getElementById("distanciaEntregaKm");
  if (distanciaInput) {
    distanciaInput.value = `${estimativa.distanciaKm.toFixed(2)} km`;
  }

  mostrarEnderecoSelecionado(
    dados.enderecoFormatado,
    origemTexto
  );

  limparSugestoes();
  calcularPedido();
  mostrarMensagem("");
}

function carregarScriptGoogle(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }

    const existente = document.querySelector("script[data-google-places='true']");
    if (existente) {
      existente.addEventListener("load", resolve);
      existente.addEventListener("error", reject);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=pt-BR&region=BR`;
    script.async = true;
    script.defer = true;
    script.dataset.googlePlaces = "true";

    script.onload = resolve;
    script.onerror = reject;

    document.head.appendChild(script);
  });
}

export async function carregarGooglePlaces(apiKey) {
  try {
    await carregarScriptGoogle(apiKey);

    autocompleteService = new google.maps.places.AutocompleteService();
    placesService = new google.maps.places.PlacesService(document.createElement("div"));
    googlePlacesCarregado = true;
  } catch (erro) {
    console.error(erro);
    googlePlacesCarregado = false;
  }
}

function buscarPredicoesGoogle(enderecoCompleto) {
  return new Promise((resolve, reject) => {
    if (!autocompleteService) {
      reject(new Error("Google Places ainda não carregou."));
      return;
    }

    const request = {
      input: enderecoCompleto,
      componentRestrictions: {
        country: "br"
      },
      types: ["address"]
    };

    autocompleteService.getPlacePredictions(request, (predictions, status) => {
      if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        resolve([]);
        return;
      }

      if (status !== google.maps.places.PlacesServiceStatus.OK) {
        reject(new Error(`Erro Google Places: ${status}`));
        return;
      }

      resolve(predictions || []);
    });
  });
}

function buscarDetalhesGoogle(placeId) {
  return new Promise((resolve, reject) => {
    if (!placesService) {
      reject(new Error("Google Places ainda não carregou."));
      return;
    }

    placesService.getDetails(
      {
        placeId,
        fields: ["place_id", "formatted_address", "geometry", "name"]
      },
      (place, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) {
          reject(new Error(`Erro ao buscar detalhes do endereço: ${status}`));
          return;
        }

        resolve(place);
      }
    );
  });
}

async function selecionarPredicaoGoogle(prediction, cacheId, enderecoOriginal) {
  try {
    mostrarMensagem("Confirmando endereço...");

    const place = await buscarDetalhesGoogle(prediction.place_id);

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    const dadosCache = {
      enderecoOriginal,
      enderecoFormatado: place.formatted_address || prediction.description,
      lat,
      lng,
      placeId: place.place_id || prediction.place_id,
      origem: "google_places",
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, "enderecos_cache", cacheId), dadosCache);

    usarEnderecoEncontrado(
      {
        ...dadosCache,
        lat,
        lng
      },
      "Encontrado pelo Google e salvo no cache."
    );
  } catch (erro) {
    console.error(erro);
    mostrarMensagem(erro.message || "Erro ao confirmar endereço.");
  }
}

export async function buscarEnderecoEntrega() {
  const endereco = montarEnderecoEntrega();

  resetarCalculoEndereco();

  if (!endereco.rua || !endereco.numeroEndereco || !endereco.bairro || !endereco.cidade) {
    mostrarMensagem("Informe rua, número, bairro e cidade.");
    return;
  }

  if (!restauranteLogado) {
    mostrarMensagem("Restaurante ainda não carregado.");
    return;
  }

  if (!restauranteLogado?.location?.lat || !restauranteLogado?.location?.lng) {
    mostrarMensagem("Restaurante sem localização fixa cadastrada.");
    return;
  }

  const cacheId = criarCacheId(endereco.enderecoCompleto);
  const cacheRef = doc(db, "enderecos_cache", cacheId);

  mostrarMensagem("");
  mostrarSugestaoMensagem("Verificando cache de endereços...");

  try {
    const cacheSnap = await getDoc(cacheRef);

    if (cacheSnap.exists()) {
      usarEnderecoEncontrado(
        cacheSnap.data(),
        "Endereço recuperado do cache. Google não foi chamado."
      );
      return;
    }

    if (!googlePlacesCarregado) {
      mostrarSugestaoMensagem("Google Places ainda está carregando. Tente novamente em alguns segundos.");
      return;
    }

    mostrarSugestaoMensagem("Buscando no Google Places...");

    const predictions = await buscarPredicoesGoogle(endereco.enderecoCompleto);

    if (!predictions.length) {
      mostrarSugestaoMensagem("Nenhum endereço encontrado. Confira rua, número, bairro e cidade.");
      return;
    }

    const lista = document.getElementById("sugestoesEndereco");
    if (!lista) return;

    lista.innerHTML = "";

    predictions.slice(0, 5).forEach((prediction) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "address-suggestion";
      botao.innerText = prediction.description;

      botao.addEventListener("click", () => {
        selecionarPredicaoGoogle(
          prediction,
          cacheId,
          endereco.enderecoCompleto
        );
      });

      lista.appendChild(botao);
    });
  } catch (erro) {
    console.error(erro);
    mostrarSugestaoMensagem("Erro ao buscar endereço. Confira as restrições da API Key.");
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
        distanciaLinhaRetaKm: entregaSelecionada.distanciaLinhaRetaKm || null,
        multiplicadorDistancia: entregaSelecionada.multiplicadorDistancia || null,
        distanciaCalculadaPor: "google_places_cache_haversine",

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

    resetarCalculoEndereco();
    limparSugestoes();

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
