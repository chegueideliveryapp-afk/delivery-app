import { db } from "./firebase.js";

import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const configRef = doc(db, "config", "app");

function valor(id) {
  return document.getElementById(id)?.value.trim() || "";
}

function numero(id, padrao = 0) {
  const n = Number(document.getElementById(id)?.value || padrao);
  return Number.isFinite(n) ? n : padrao;
}

function setValor(id, valorCampo) {
  const el = document.getElementById(id);
  if (el) el.value = valorCampo ?? "";
}

function setMensagem(texto, sucesso = false) {
  const msg = document.getElementById("mensagem");

  if (!msg) return;

  msg.innerText = texto;
  msg.style.color = sucesso ? "#166534" : "#c02626";
  msg.style.fontWeight = "900";
}

function parseRaios(texto) {
  const raios = String(texto || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((numero) => Number.isFinite(numero) && numero > 0);

  if (!raios.length) {
    return [3, 5, 10, 15];
  }

  return raios;
}

export function carregarConfiguracoesAdmin() {
  onSnapshot(
    configRef,
    (snap) => {
      if (!snap.exists()) {
        setValor("taxaSistemaPadrao", 5);
        setValor("taxaBaseMotoboy", 5);
        setValor("valorKmMotoboy", 1.5);
        setValor("valorMinimoMotoboy", 10);
        setValor("taxaRetornoMotoboy", 5);
        setValor("multiplicadorDemanda", 1);

        setValor("raiosBuscaKm", "3,5,10,15");
        setValor("tempoPorRaioSegundos", 15);
        setValor("timeoutAceiteSegundos", 15);
        setValor("raioKm", 10);

        setValor("chavePix", "");
        setValor("suporteWhatsapp", "");
        setValor("appMotoboyMinVersion", "1.0.0");
        setValor("motivoMultiplicador", "");

        setMensagem("Configuração ainda não existe. Preencha e salve.", false);
        return;
      }

      const c = snap.data();

      setValor("taxaSistemaPadrao", c.taxaSistemaPadrao ?? 5);
      setValor("taxaBaseMotoboy", c.taxaBaseMotoboy ?? 5);
      setValor("valorKmMotoboy", c.valorKmMotoboy ?? 1.5);
      setValor("valorMinimoMotoboy", c.valorMinimoMotoboy ?? 10);
      setValor("taxaRetornoMotoboy", c.taxaRetornoMotoboy ?? 5);
      setValor("multiplicadorDemanda", c.multiplicadorDemanda ?? 1);

      setValor(
        "raiosBuscaKm",
        Array.isArray(c.raiosBuscaKm) ? c.raiosBuscaKm.join(",") : "3,5,10,15"
      );

      setValor("tempoPorRaioSegundos", c.tempoPorRaioSegundos ?? 15);
      setValor("timeoutAceiteSegundos", c.timeoutAceiteSegundos ?? 15);
      setValor("raioKm", c.raioKm ?? 10);

      setValor("chavePix", c.chavePix ?? "");
      setValor("suporteWhatsapp", c.suporteWhatsapp ?? "");
      setValor("appMotoboyMinVersion", c.appMotoboyMinVersion ?? "1.0.0");
      setValor("motivoMultiplicador", c.motivoMultiplicador ?? "");

      setMensagem("Configurações carregadas.", true);
    },
    (erro) => {
      console.error(erro);
      setMensagem("Erro ao carregar configurações.");
    }
  );
}

export async function salvarConfiguracoesAdmin() {
  const btn = document.getElementById("btnSalvarConfig");

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Salvando...";
  }

  setMensagem("");

  try {
    const dados = {
      taxaSistemaPadrao: numero("taxaSistemaPadrao", 5),

      taxaBaseMotoboy: numero("taxaBaseMotoboy", 5),
      valorKmMotoboy: numero("valorKmMotoboy", 1.5),
      valorMinimoMotoboy: numero("valorMinimoMotoboy", 10),
      taxaRetornoMotoboy: numero("taxaRetornoMotoboy", 5),

      multiplicadorDemanda: numero("multiplicadorDemanda", 1),
      motivoMultiplicador: valor("motivoMultiplicador"),

      raiosBuscaKm: parseRaios(valor("raiosBuscaKm")),
      tempoPorRaioSegundos: numero("tempoPorRaioSegundos", 15),
      timeoutAceiteSegundos: numero("timeoutAceiteSegundos", 15),
      raioKm: numero("raioKm", 10),

      chavePix: valor("chavePix"),
      suporteWhatsapp: valor("suporteWhatsapp"),
      appMotoboyMinVersion: valor("appMotoboyMinVersion") || "1.0.0",

      updatedAt: serverTimestamp()
    };

    if (!dados.taxaSistemaPadrao || dados.taxaSistemaPadrao < 0) {
      throw new Error("Taxa Cheguei inválida.");
    }

    if (!dados.valorKmMotoboy || dados.valorKmMotoboy < 0) {
      throw new Error("Valor por km inválido.");
    }

    if (!dados.valorMinimoMotoboy || dados.valorMinimoMotoboy < 0) {
      throw new Error("Valor mínimo do motoboy inválido.");
    }

    if (!dados.multiplicadorDemanda || dados.multiplicadorDemanda <= 0) {
      throw new Error("Multiplicador de demanda inválido.");
    }

    await setDoc(
      configRef,
      {
        ...dados,
        createdAt: serverTimestamp()
      },
      { merge: true }
    );

    setMensagem("Configurações salvas com sucesso.", true);
  } catch (erro) {
    console.error(erro);
    setMensagem(erro.message || "Erro ao salvar configurações.");
  }

  if (btn) {
    btn.disabled = false;
    btn.innerText = "Salvar configurações";
  }
}
