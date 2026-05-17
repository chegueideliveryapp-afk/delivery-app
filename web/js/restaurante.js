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
let entregaLocation = null;
let timerBuscaEndereco = null;
let novoPedidoConfigurado = false;

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

function mostrarErroDashboard(texto) {
  setText("nomeRestaurante", "Erro ao carregar");
  setText("statusConta", "Atenção");
  setText("statusDescricao", texto);
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

function distanciaLinhaRetaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function buscarSugestoesEndereco(endereco) {
  const url = new URL("https://nominatim.openstreetmap.org/search");

  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("q", endereco);

  const resposta = await fetch(url.toString());
  const dados = await resposta.json();

  return dados.map((item) => ({
    lat: Number(item.lat),
    lng: Number(item.lon),
    displayName: item.display_name,
    address: item.address || {}
  }));
}

async function calcularRotaKm(origem, destino) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origem.lng},${origem.lat};${destino.lng},${destino.lat}` +
    `?overview=false`;

  const resposta = await fetch(url);
  const dados = await resposta.json();

  if (!dados.routes?.length) {
    return distanciaLinhaRetaKm(origem.lat, origem.lng, destino.lat, destino.lng);
  }

  return dados.routes[0].distance / 1000;
}

function montarEnderecoEntrega() {
  const rua = document.getElementById("enderecoRua")?.value.trim() || "";
  const numeroEndereco = document.getElementById("enderecoNumero")?.value.trim() || "";
  const bairro = document.getElementById("enderecoBairro")?.value.trim() || "";
  const cidade = document.getElementById("enderecoCidade")?.value.trim() || "";
  const complemento = document.getElementById("enderecoComplemento")?.value.trim() || "";

  return {
    rua,
    numeroEndereco,
    bairro,
    cidade,
    complemento,
    enderecoCompleto: [rua, numeroEndereco, bairro, cidade]
      .filter(Boolean)
      .join(", ")
  };
}

function esconderSugestoesEndereco() {
  const box = document.getElementById("enderecoSugestoes");

  if (!box) return;

  box.innerHTML = "";
  box.classList.add("hidden");
}

function preencherEnderecoPorSugestao(sugestao) {
  entregaLocation = {
    lat: sugestao.lat,
    lng: sugestao.lng,
    displayName: sugestao.displayName
  };

  const address = sugestao.address || {};

  const rua =
    address.road ||
    address.pedestrian ||
    address.residential ||
    "";

  const bairro =
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    address.quarter ||
    "";

  const cidade =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    "";

  if (rua) document.getElementById("enderecoRua").value = rua;
  if (bairro) document.getElementById("enderecoBairro").value = bairro;
  if (cidade) document.getElementById("enderecoCidade").value = cidade;

  esconderSugestoesEndereco();
  calcularDistanciaComLocationSelecionada();
}

async function mostrarSugestoesEndereco() {
  const msg = document.getElementById("mensagem");
  const box = document.getElementById("enderecoSugestoes");
  const endereco = montarEnderecoEntrega();

  if (!box) return;

  if (!endereco.rua || !endereco.bairro || !endereco.cidade) {
    esconderSugestoesEndereco();
    return;
  }

  try {
    const sugestoes = await buscarSugestoesEndereco(endereco.enderecoCompleto);

    box.innerHTML = "";

    if (!sugestoes.length) {
      box.innerHTML = `
        <div class="address-suggestion muted">
          Nenhum endereço encontrado. Confira rua, bairro e cidade.
        </div>
      `;
      box.classList.remove("hidden");
      return;
    }

    sugestoes.forEach((sugestao) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "address-suggestion";
      item.innerText = sugestao.displayName;

      item.addEventListener("click", () => {
        preencherEnderecoPorSugestao(sugestao);
      });

      box.appendChild(item);
    });

    box.classList.remove("hidden");
  } catch (erro) {
    console.error(erro);

    if (msg) {
      msg.innerText = "Erro ao buscar sugestões de endereço.";
    }
  }
}

async function calcularDistanciaComLocationSelecionada() {
  const msg = document.getElementById("mensagem");

  if (msg) msg.innerText = "";

  if (!restauranteLogado?.location?.lat || !restauranteLogado?.location?.lng) {
    if (msg) msg.innerText = "Restaurante sem localização fixa cadastrada.";
    return;
  }

  if (!entregaLocation?.lat || !entregaLocation?.lng) {
    if (msg) msg.innerText = "Selecione um endereço válido.";
    return;
  }

  try {
    const origem = {
      lat: Number(restauranteLogado.location.lat),
      lng: Number(restauranteLogado.location.lng)
    };

    const distanciaKm = await calcularRotaKm(origem, entregaLocation);

    document.getElementById("distanciaEntregaKm").value = distanciaKm.toFixed(2);
    setText("distanciaResumoPedido", `${distanciaKm.toFixed(2)} km`);

    calcularPedido();
  } catch (erro) {
    console.error(erro);

    if (msg) {
      msg.innerText = "Não consegui calcular a distância desse endereço.";
    }
  }
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

function configurarBuscaAutomaticaEndereco() {
  if (novoPedidoConfigurado) return;

  novoPedidoConfigurado = true;

  [
    "enderecoRua",
    "enderecoNumero",
    "enderecoBairro",
    "enderecoCidade"
  ].forEach((id) => {
    const campo = document.getElementById(id);

    if (!campo) return;

    campo.addEventListener("input", () => {
      entregaLocation = null;

      const distancia = document.getElementById("distanciaEntregaKm");
      if (distancia) distancia.value = "";

      setText("distanciaResumoPedido", "---");

      clearTimeout(timerBuscaEndereco);

      timerBuscaEndereco = setTimeout(() => {
        mostrarSugestoesEndereco();
      }, 700);
    });
  });

  const formaPagamento = document.getElementById("formaPagamento");
  if (formaPagamento) {
    formaPagamento.addEventListener("change", calcularPedido);
  }

  const precisaRetorno = document.getElementById("precisaRetorno");
  if (precisaRetorno) {
    precisaRetorno.addEventListener("change", (event) => {
      document.getElementById("valorTroco")?.classList.toggle(
        "hidden",
        !event.target.checked
      );

      calcularPedido();
    });
  }

  document.addEventListener("click", (event) => {
    const box = document.getElementById("enderecoSugestoes");

    if (!box) return;

    if (!box.contains(event.target)) {
      esconderSugestoesEndereco();
    }
  });
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

    configurarBuscaAutomaticaEndereco();

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

        calcularPedido();
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

export async function buscarDistanciaEntrega() {
  const msg = document.getElementById("mensagem");
  const btn = document.getElementById("btnBuscarDistancia");
  const endereco = montarEnderecoEntrega();

  if (msg) msg.innerText = "";

  if (!restauranteLogado) {
    if (msg) msg.innerText = "Restaurante ainda não carregado.";
    return;
  }

  if (!endereco.rua || !endereco.bairro || !endereco.cidade) {
    if (msg) msg.innerText = "Informe pelo menos rua, bairro e cidade.";
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Buscando endereço...";
  }

  try {
    const sugestoes = await buscarSugestoesEndereco(endereco.enderecoCompleto);

    if (!sugestoes.length) {
      throw new Error("Endereço não encontrado.");
    }

    preencherEnderecoPorSugestao(sugestoes[0]);
  } catch (erro) {
    console.error(erro);

    if (msg) {
      msg.innerText = "Não encontrei esse endereço. Tente informar rua, número, bairro e cidade.";
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerText = "Calcular distância agora";
  }
}

export function calcularPedido() {
  const msg = document.getElementById("mensagem");

  if (msg && msg.innerText === "Restaurante ainda não carregado.") {
    msg.innerText = "";
  }

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

  if (!endereco.rua || !endereco.numeroEndereco || !endereco.bairro || !endereco.cidade) {
    if (msg) msg.innerText = "Informe rua, número, bairro e cidade.";
    return;
  }

  if (!pedidoCalculado || !pedidoCalculado.distanciaKm) {
    if (msg) msg.innerText = "Selecione uma sugestão de endereço para calcular a distância.";
    return;
  }

  if (!entregaLocation) {
    if (msg) msg.innerText = "Localização da entrega não encontrada.";
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

        enderecoEntrega: endereco.enderecoCompleto,
        enderecoRua: endereco.rua,
        enderecoNumero: endereco.numeroEndereco,
        enderecoBairro: endereco.bairro,
        enderecoCidade: endereco.cidade,
        enderecoComplemento: endereco.complemento,

        entregaLocation: {
          lat: entregaLocation.lat,
          lng: entregaLocation.lng
        },

        entregaEnderecoEncontrado: entregaLocation.displayName || "",

        restauranteLocation: {
          lat: Number(restaurante.location.lat),
          lng: Number(restaurante.location.lng)
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
    document.getElementById("enderecoCidade").value = "";
    document.getElementById("enderecoComplemento").value = "";
    document.getElementById("distanciaEntregaKm").value = "";
    document.getElementById("observacaoPedido").value = "";
    document.getElementById("precisaRetorno").checked = false;
    document.getElementById("valorTroco").value = "";
    document.getElementById("valorTroco").classList.add("hidden");

    esconderSugestoesEndereco();

    pedidoCalculado = null;
    entregaLocation = null;

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

export async function sairRestaurante() {
  await signOut(auth);
  window.location.href = "./login.html";
}
