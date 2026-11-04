/* auth.js: login Google, kode pasangan, sesi, dan kunci PIN.

   Sesi berlaku 30 hari dan disimpan di perangkat. PIN hanya mengunci tampilan di
   perangkat ini, bukan mengenkripsi data, dan disimpan sebagai hash PBKDF2. */

import { ApiError, api, isDemoMode, setSessionToken } from "./api.js";
import { getLanguage, setLanguage, t, tError } from "./i18n.js";
import { glyph } from "./icons.js";
import { bindSegmented, escapeHtml, haptic, segmented } from "./ui.js";

const SESSION_KEY = "mt.session";
const PIN_KEY = "mt.pin";
const PIN_FAILS_KEY = "mt.pin.fails";
const PIN_ITERATIONS = 150000;
const PIN_MAX_FAILS = 5;
const PIN_WAIT_MS = 30000;
const LOCK_AFTER_HIDDEN_MS = 300000;
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Penyimpanan diblokir: sesi tetap berlaku sampai halaman ditutup. */
  }
}

/* --- Sesi --- */

export function getSession() {
  if (isDemoMode()) return { email: "demo", sessionToken: "", expiresAt: "" };
  const session = readJson(SESSION_KEY);
  if (!session?.sessionToken || Date.parse(session.expiresAt) <= Date.now()) return null;
  setSessionToken(session.sessionToken);
  return session;
}

function saveSession(session) {
  writeJson(SESSION_KEY, session);
  setSessionToken(session.sessionToken);
}

export function clearSession() {
  writeJson(SESSION_KEY, null);
  setSessionToken("");
}

/* --- Layar login --- */

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

function gateShell(content) {
  return `
    <div class="gate__card">
      <span class="brand__logo gate__logo">${glyph("trending-up")}</span>
      <h1 class="t-title-3">Money Tracker</h1>
      ${content}
    </div>`;
}

/* Saat bahasa diganti, kartu masuk tidak dibuat ulang: teks diganti di tempat lewat
   data-i18n, dan tombol Google versi bahasa baru disiapkan di belakang tombol lama lalu
   ditukar setelah siap. Dengan begitu kapsul bahasa tetap bergeser mulus dan tombol
   Google tidak sempat kosong, terutama di HP yang koneksinya lebih lambat. */
const GOOGLE_SWAP_DELAY_MS = 150;
const GOOGLE_SWAP_TIMEOUT_MS = 2500;

export function renderLogin(gate, { onSuccess, onInstallHelp }) {
  gate.innerHTML = gateShell(`
    <p class="t-subhead text-2" data-i18n="auth.subtitle">${escapeHtml(t("auth.subtitle"))}</p>
    <div class="gate__google" data-google>
      <span class="gate__google-status" data-google-status>${escapeHtml(t("auth.loading_google"))}</span>
    </div>
    <p class="form-error" role="alert" data-login-error></p>
    <details class="gate__pairing">
      <summary data-i18n="auth.have_code">${escapeHtml(t("auth.have_code"))}</summary>
      <p class="t-footnote text-2" data-i18n="auth.code_help">${escapeHtml(t("auth.code_help"))}</p>
      <form class="gate__code" data-code-form>
        <input class="field__control" name="code" maxlength="6" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="ABC123" aria-label="${escapeHtml(t("auth.code_label"))}" data-i18n-aria-label="auth.code_label" />
        <button type="submit" class="btn btn--primary" data-i18n="auth.code_submit">${escapeHtml(t("auth.code_submit"))}</button>
      </form>
    </details>
    <div class="gate__footer">
      ${segmented({ name: "login-language", label: t("settings.language"), value: getLanguage(), options: [{ value: "id", label: "Indonesia" }, { value: "en", label: "English" }] })}
      <button type="button" class="btn-plain" data-install-help data-i18n="install.how">${escapeHtml(t("install.how"))}</button>
    </div>`);
  gate.querySelector(".segmented").setAttribute("data-i18n-aria-label", "settings.language");

  const holder = gate.querySelector("[data-google]");
  const status = gate.querySelector("[data-google-status]");
  const error = gate.querySelector("[data-login-error]");
  let errorCode = "";
  let statusText = () => t("auth.loading_google");
  let googleReady = false;

  const showError = (code) => {
    errorCode = code;
    error.textContent = code ? tError(code) : "";
  };
  const showStatus = (text) => {
    statusText = text;
    status.textContent = text ? text() : "";
    status.hidden = !text;
  };
  const finish = async (action, data) => {
    showError("");
    try {
      const { data: session } = await api(action, data);
      saveSession(session);
      onSuccess(session);
    } catch (failure) {
      showError(failure instanceof ApiError ? failure.code : "INTERNAL_ERROR");
    }
  };

  /* Tombol baru dipasang di atas tombol lama dalam keadaan tak terlihat, lalu ditukar
     setelah bingkainya selesai dimuat. Tombol pertama langsung ditampilkan. */
  const renderGoogleButton = () => {
    const next = document.createElement("div");
    next.className = "gate__google-button";
    holder.append(next);
    window.google.accounts.id.renderButton(next, {
      theme: document.documentElement.dataset.theme === "dark" ? "filled_black" : "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      width: 280,
      locale: getLanguage(),
    });
    const previous = [...holder.querySelectorAll(".gate__google-button")].filter((element) => element !== next);
    let swapped = false;
    const swap = () => {
      if (swapped || !next.isConnected) return;
      swapped = true;
      previous.forEach((element) => element.remove());
      next.classList.add("is-ready");
    };
    const frame = next.querySelector("iframe");
    if (!previous.length || !frame) {
      swap();
      return;
    }
    /* Setelah bingkai dimuat, Google masih menyimpan tombol sementaranya sebentar. Tombol
       baru baru ditampilkan setelah hanya bingkainya yang tersisa. */
    const settled = () => [...(frame.parentElement?.children ?? [])].every((child) => child === frame || child.getBoundingClientRect().height === 0);
    const waitSettled = () => {
      if (swapped || !next.isConnected) return;
      if (settled()) window.setTimeout(swap, GOOGLE_SWAP_DELAY_MS);
      else window.setTimeout(waitSettled, 50);
    };
    frame.addEventListener("load", waitSettled, { once: true });
    window.setTimeout(swap, GOOGLE_SWAP_TIMEOUT_MS);
  };

  /* Teks bertanda data-i18n sudah diganti oleh setLanguage. Sisanya diganti di sini. */
  bindSegmented(gate, "login-language", (language) => {
    const refresh = () => {
      showError(errorCode);
      showStatus(status.hidden ? null : statusText);
      if (googleReady) renderGoogleButton();
    };
    setLanguage(language).then(refresh, refresh);
  });
  gate.querySelector("[data-install-help]").addEventListener("click", onInstallHelp);
  gate.querySelector("[data-code-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = event.target.elements.code.value.trim().toUpperCase();
    if (code.length === 6) finish("auth.redeemPairingCode", { code });
  });

  const clientId = window.MT_CONFIG?.googleClientId;
  loadGoogleScript()
    .then(() => {
      if (!holder.isConnected) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => finish("auth.login", { idToken: response.credential }),
        ux_mode: "popup",
        itp_support: true,
        /* Dikunci terang. Bawaannya mengikuti mode gelap sistem, dan kalau berbeda dengan
           bingkai tombol, browser memberi latar putih di sekeliling tombol. */
        color_scheme: "light",
      });
      showStatus(null);
      googleReady = true;
      renderGoogleButton();
    })
    .catch(() => {
      /* Tombol Google gagal dimuat (offline atau diblokir): arahkan ke kode pasangan. */
      if (!holder.isConnected) return;
      showStatus(() => (navigator.onLine ? t("auth.google_failed") : tError("OFFLINE")));
      gate.querySelector(".gate__pairing").open = true;
    });
  gate.hidden = false;
}

/* --- PIN --- */

const encoder = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g), (pair) => parseInt(pair, 16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PIN_ITERATIONS, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

export function hasPin() {
  return Boolean(readJson(PIN_KEY)?.hash);
}

export function pinLength() {
  return readJson(PIN_KEY)?.length ?? 4;
}

export async function setPin(pin) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  writeJson(PIN_KEY, { salt, hash: await hashPin(pin, salt), length: pin.length });
  writeJson(PIN_FAILS_KEY, null);
}

export function removePin() {
  writeJson(PIN_KEY, null);
  writeJson(PIN_FAILS_KEY, null);
}

async function checkPin(pin) {
  const stored = readJson(PIN_KEY);
  if (!stored) return true;
  const match = (await hashPin(pin, stored.salt)) === stored.hash;
  const fails = readJson(PIN_FAILS_KEY) ?? { count: 0, until: 0 };
  if (match) writeJson(PIN_FAILS_KEY, null);
  else {
    const count = fails.count + 1;
    writeJson(PIN_FAILS_KEY, { count, until: count % PIN_MAX_FAILS === 0 ? Date.now() + PIN_WAIT_MS : 0 });
  }
  return match;
}

function waitRemaining() {
  const fails = readJson(PIN_FAILS_KEY);
  return Math.max(0, (fails?.until ?? 0) - Date.now());
}

/* Papan angka PIN. onComplete menerima PIN yang sudah lengkap. */
function pinPad({ title, hint, length, onComplete, extra = "" }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"]
    .map((key) => {
      if (!key) return "<span></span>";
      if (key === "back") return `<button type="button" class="pin__key pin__key--plain" data-key="back" aria-label="${escapeHtml(t("auth.pin_delete"))}">${glyph("chevron-left")}</button>`;
      return `<button type="button" class="pin__key" data-key="${key}">${key}</button>`;
    })
    .join("");
  const dots = Array.from({ length }, () => '<span class="pin__dot"></span>').join("");

  const element = document.createElement("div");
  element.className = "pin";
  element.innerHTML = `
    <p class="t-headline" data-pin-title>${escapeHtml(title)}</p>
    <p class="t-footnote text-2" role="status" data-pin-hint>${escapeHtml(hint)}</p>
    <div class="pin__dots" data-dots aria-hidden="true">${dots}</div>
    <div class="pin__pad">${keys}</div>
    ${extra}`;

  let value = "";
  const paint = () => {
    element.querySelectorAll(".pin__dot").forEach((dot, index) => dot.classList.toggle("is-filled", index < value.length));
  };
  const press = async (key) => {
    if (key === "back") value = value.slice(0, -1);
    else if (value.length < length) value += key;
    paint();
    haptic();
    if (value.length === length) {
      const entered = value;
      value = "";
      const accepted = await onComplete(entered);
      if (!accepted) {
        element.querySelector("[data-dots]").classList.remove("is-wrong");
        void element.offsetWidth;
        element.querySelector("[data-dots]").classList.add("is-wrong");
        haptic(60);
      }
      paint();
    }
  };
  element.querySelectorAll("[data-key]").forEach((button) => button.addEventListener("click", () => press(button.dataset.key)));
  element.addEventListener("keydown", (event) => {
    if (/^\d$/.test(event.key)) press(event.key);
    if (event.key === "Backspace") press("back");
  });
  element.tabIndex = -1;
  return {
    element,
    setHint(text) {
      element.querySelector("[data-pin-hint]").textContent = text;
    },
    setTitle(text) {
      element.querySelector("[data-pin-title]").textContent = text;
    },
  };
}

let unlocked = false;
let hiddenAt = 0;

/* Menampilkan layar PIN dan menunggu sampai benar. onForgot dipanggil kalau lupa PIN. */
export function lockScreen(gate, { onUnlock, onForgot }) {
  unlocked = false;
  gate.hidden = false;
  gate.innerHTML = gateShell("");
  const pad = pinPad({
    title: t("auth.pin_enter"),
    hint: "",
    length: pinLength(),
    extra: `<button type="button" class="btn-plain" data-forgot>${escapeHtml(t("auth.pin_forgot"))}</button>`,
    async onComplete(pin) {
      const wait = waitRemaining();
      if (wait) {
        pad.setHint(t("auth.pin_wait", { count: Math.ceil(wait / 1000) }));
        return false;
      }
      if (await checkPin(pin)) {
        unlocked = true;
        gate.hidden = true;
        gate.innerHTML = "";
        onUnlock();
        return true;
      }
      pad.setHint(waitRemaining() ? t("auth.pin_wait", { count: Math.ceil(waitRemaining() / 1000) }) : t("auth.pin_wrong"));
      return false;
    },
  });
  gate.querySelector(".gate__card").append(pad.element);
  pad.element.querySelector("[data-forgot]").addEventListener("click", onForgot);
  pad.element.focus();
}

/* PIN diminta lagi kalau app ditinggal lebih dari 5 menit. */
export function watchLock(gate, handlers) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (hasPin() && unlocked && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_HIDDEN_MS) lockScreen(gate, handlers);
  });
}

export function markUnlocked() {
  unlocked = true;
}

/* Membuat PIN baru: ketik dua kali. Panjang PIN dipilih dulu. */
export function pinSetup(container, { length, onDone }) {
  let first = "";
  const pad = pinPad({
    title: t("auth.pin_new"),
    hint: t("auth.pin_new_hint", { count: length }),
    length,
    async onComplete(pin) {
      if (!first) {
        first = pin;
        pad.setTitle(t("auth.pin_confirm"));
        pad.setHint("");
        return true;
      }
      if (pin !== first) {
        first = "";
        pad.setTitle(t("auth.pin_new"));
        pad.setHint(t("auth.pin_mismatch"));
        return false;
      }
      await setPin(pin);
      onDone();
      return true;
    },
  });
  container.append(pad.element);
  pad.element.focus();
}

/* Membuka kode pasangan untuk perangkat lain, misalnya app iPhone yang belum bisa login. */
export async function createPairingCode() {
  const { data } = await api("auth.createPairingCode", {});
  return data;
}

export async function logoutAllDevices() {
  await api("auth.logoutAll", {});
}
