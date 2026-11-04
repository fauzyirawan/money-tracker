/* api.js: satu-satunya jalan ke backend Apps Script.
   Permintaan memakai text/plain agar browser tidak mengirim preflight CORS.
   Kesalahan selalu berupa ApiError dengan kode, supaya pesan bisa diterjemahkan. */

const REQUEST_TIMEOUT_MS = 30000;
const SCAN_TIMEOUT_MS = 90000;
const SLOW_ACTIONS = ["scan.extract", "scan.test", "receipts.upload", "receipts.get", "sync.bootstrap"];

let sessionToken = "";
let currentLanguage = "id";
const sessionListeners = new Set();

export class ApiError extends Error {
  constructor(code, details = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export function apiUrl() {
  return window.MT_CONFIG?.apiUrl?.trim() ?? "";
}

export function isDemoMode() {
  return !apiUrl();
}

export function setSessionToken(token) {
  sessionToken = token;
}

export function setApiLanguage(language) {
  currentLanguage = language;
}

/* Dipanggil saat backend menolak sesi, supaya app kembali ke layar login. */
export function onSessionRejected(listener) {
  sessionListeners.add(listener);
}

const SESSION_ERRORS = ["UNAUTHORIZED", "SESSION_EXPIRED", "EMAIL_NOT_ALLOWED"];

export async function api(action, data = {}) {
  if (isDemoMode()) throw new ApiError("NOT_CONFIGURED");
  if (!navigator.onLine) throw new ApiError("OFFLINE");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SLOW_ACTIONS.includes(action) ? SCAN_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: sessionToken, lang: currentLanguage, data }),
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR");
  } finally {
    window.clearTimeout(timeout);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("NETWORK_ERROR");
  }
  if (body.ok) return { data: body.data, serverTime: body.serverTime };

  const error = new ApiError(body.error?.code ?? "INTERNAL_ERROR", body.error?.details ?? null);
  if (SESSION_ERRORS.includes(error.code) && action !== "auth.login" && action !== "auth.redeemPairingCode") {
    sessionListeners.forEach((listener) => listener(error.code));
  }
  throw error;
}

/* Kesalahan jaringan yang boleh dicoba lagi nanti, bukan kesalahan data. */
export function isRetryable(error) {
  return ["OFFLINE", "NETWORK_ERROR", "TIMEOUT", "LOCK_TIMEOUT", "INTERNAL_ERROR", "RATE_LIMITED"].includes(error?.code);
}
