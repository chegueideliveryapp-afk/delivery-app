import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function limparNumero(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function cpfParaEmail(cpf) {
  return `${limparNumero(cpf)}@app.com`;
}

function mostrarMensagem(texto, tipo = "erro") {
  const msg = document.getElementById("mensagem");
  if (!msg) return;

  msg.className = tipo;
  msg.innerText = texto;
}

function limparFormularioCadastro() {
  [
    "cpfCadastro",
    "nomeCadastro",
    "telefoneCadastro",
    "nascimentoCadastro",
    "senhaCadastro"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const btnCadastro = document.getElementById("btnCadastro");

  if (!btnCadastro) return;

  btnCadastro.addEventListener("click", async () => {
    const cpf = limparNumero(document.getElementById("cpfCadastro").value);
    const nome = document.getElementById("nomeCadastro").value.trim();
    const telefone = limparNumero(document.getElementById("telefoneCadastro").value);
    const nascimento = document.getElementById("nascimentoCadastro").value;
    const senha = document.getElementById("senhaCadastro").value;

    if (cpf.length !== 11) {
      mostrarMensagem("CPF inválido.");
      return;
    }

    if (!nome) {
      mostrarMensagem("Informe seu nome completo.");
      return;
    }

    if (telefone.length < 10) {
      mostrarMensagem("Telefone inválido.");
      return;
    }

    if (!nascimento) {
      mostrarMensagem("Informe sua data de nascimento.");
      return;
    }

    if (!senha || senha.length < 6) {
      mostrarMensagem("Senha deve ter pelo menos 6 caracteres.");
      return;
    }

    btnCadastro.disabled = true;
    btnCadastro.innerText = "Criando conta...";

    try {
      const email = cpfParaEmail(cpf);

      const credencial = await createUserWithEmailAndPassword(
        auth,
        email,
        senha
      );

      const uid = credencial.user.uid;

      await setDoc(doc(db, "users", uid), {
        nome,
        email,
        role: "motoboy",
        ativo: true,
        bloqueado: false,
        refId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await setDoc(doc(db, "motoboys", uid), {
        nome,
        cpf,
        telefone,
        nascimento,
        email,

        aprovado: false,
        statusCadastro: "pendente",

        ativo: true,
        bloqueado: false,

        online: false,

        location: {
          lat: null,
          lng: null
        },

        accuracy: null,
        ultimaLocalizacaoAt: null,

        saldo: 0,
        totalRecebido: 0,
        totalEntregas: 0,
        totalRecusas: 0,

        appVersion: "1.0.0",
        platform: "android",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await signOut(auth);

      mostrarMensagem("Conta criada! Aguarde aprovação do administrador.", "sucesso");
      limparFormularioCadastro();
    } catch (erro) {
      console.error(erro);

      if (erro.code === "auth/email-already-in-use") {
        mostrarMensagem("CPF já cadastrado.");
      } else if (erro.code === "auth/weak-password") {
        mostrarMensagem("Senha fraca.");
      } else {
        mostrarMensagem("Erro ao criar conta.");
      }
    }

    btnCadastro.disabled = false;
    btnCadastro.innerText = "Criar conta";
  });
});
