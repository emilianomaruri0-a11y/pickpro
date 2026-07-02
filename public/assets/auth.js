"use strict";

const form = document.querySelector("#authForm");
const tabs = document.querySelectorAll("[data-mode]");
const message = document.querySelector("#authMessage");
const submit = document.querySelector(".auth-submit");
const password = document.querySelector("#password");
const passwordField = document.querySelector("#passwordField");
const passwordLabel = document.querySelector("#passwordLabel");
const togglePassword = document.querySelector("#togglePassword");
const authLaunchScreen = document.querySelector("#authLaunchScreen");
const authLaunchAction = document.querySelector("#authLaunchAction");
let mode = "login";
let recoveryStep = "start";
let existingSession = false;

function setAuthLaunchReady() {
  if (!authLaunchAction) return;
  document.body.classList.add("launch-ready");
  authLaunchAction.innerHTML = `
    <button class="launch-start-button" id="authLaunchStartButton" type="button" aria-label="Comenzar">
      <span class="launch-bolt" aria-hidden="true">+</span>
      <strong>COMENZAR</strong>
      <span aria-hidden="true">></span>
    </button>`;
  document.querySelector("#authLaunchStartButton")?.addEventListener("click", () => {
    if (existingSession) {
      window.location.href = "/";
      return;
    }
    document.body.classList.add("auth-entered");
    document.body.classList.remove("auth-booting");
    authLaunchScreen?.setAttribute("aria-hidden", "true");
  });
}

async function prepareAuthLaunch() {
  try {
    const response = await fetch("/api/me", { headers: { accept: "application/json" } });
    existingSession = response.ok;
  } catch {
    existingSession = false;
  } finally {
    window.setTimeout(setAuthLaunchReady, 700);
  }
}

function setMessage(text, kind = "info") {
  message.textContent = text;
  message.dataset.kind = kind;
}

function setVisible(selector, visible) {
  document.querySelectorAll(selector).forEach((item) => {
    item.hidden = !visible;
  });
}

function setMode(nextMode) {
  mode = nextMode;
  recoveryStep = "start";
  tabs.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  setVisible(".register-only", mode === "register");
  setVisible(".login-only", mode === "login");
  setVisible(".recover-only", mode === "recover");
  setVisible(".recover-code-only", false);
  passwordField.hidden = mode === "recover";
  passwordLabel.textContent = mode === "recover" ? "Nueva contrasena" : "Contrasena";
  submit.textContent = mode === "register" ? "Crear cuenta" : mode === "recover" ? "Enviar codigo" : "Entrar";
  password.autocomplete = mode === "register" || mode === "recover" ? "new-password" : "current-password";
  setMessage("");
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo completar la solicitud.");
  return data;
}

function registrationPayload(data) {
  return {
    firstNames: data.firstNames,
    lastNames: data.lastNames,
    handle: data.handle,
    email: data.email,
    phone: data.phone,
    password: data.password
  };
}

tabs.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

togglePassword.addEventListener("click", () => {
  const visible = password.type === "text";
  password.type = visible ? "password" : "text";
  togglePassword.textContent = visible ? "Ver" : "Ocultar";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  submit.disabled = true;

  try {
    if (mode === "register") {
      setMessage("Creando cuenta...");
      await postJson("/api/register", registrationPayload(data));
      window.location.href = "/";
      return;
    }

    if (mode === "recover") {
      if (recoveryStep === "start") {
        setMessage("Enviando codigo de verificacion...");
        const result = await postJson("/api/recovery/start", { account: data.account });
        recoveryStep = "confirm";
        setVisible(".recover-code-only", true);
        passwordField.hidden = false;
        submit.textContent = "Cambiar contrasena";
        setMessage(result.message || "Codigo enviado.");
        return;
      }
      const result = await postJson("/api/recovery/confirm", {
        account: data.account,
        code: data.code,
        newPassword: data.password
      });
      setMessage(result.message || "Contrasena actualizada.");
      setTimeout(() => setMode("login"), 1000);
      return;
    }

    setMessage("Verificando acceso...");
    await postJson("/api/login", { username: data.username, password: data.password });
    window.location.href = "/";
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

prepareAuthLaunch();
