/* install.js: memasang app ke layar utama.
   Android dan PC Chrome/Edge memakai tombol install asli lewat beforeinstallprompt.
   iPhone dan iPad tidak punya tombol itu, jadi ditampilkan panduan Share -> Add to Home Screen. */

import { t } from "./i18n.js";
import { glyph } from "./icons.js";
import { closeSheet, escapeHtml, sheetHeader, showSheet } from "./ui.js";

const GUIDE_SHOWN_KEY = "mt.installGuideShown";

let deferredPrompt = null;
const listeners = new Set();

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  listeners.forEach((listener) => listener());
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  listeners.forEach((listener) => listener());
});

export function onInstallChange(listener) {
  listeners.add(listener);
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function canPromptInstall() {
  return Boolean(deferredPrompt);
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((listener) => listener());
  return outcome === "accepted";
}

function steps(keys) {
  return keys.map((key, index) => `<li class="install-step"><span class="install-step__number">${index + 1}</span><span>${escapeHtml(t(key))}</span></li>`).join("");
}

export function showInstallGuide() {
  const ios = isIos();
  const android = /android/i.test(navigator.userAgent);
  const keys = ios ? ["install.ios_1", "install.ios_2", "install.ios_3"] : android ? ["install.android_1", "install.android_2"] : ["install.pc_1", "install.pc_2"];
  showSheet(
    (body) => {
      body.innerHTML = `
        ${sheetHeader({ title: t("install.title") })}
        <div class="sheet__body">
          <p class="t-subhead text-2">${escapeHtml(t("install.why"))}</p>
          ${canPromptInstall() ? `<button type="button" class="btn btn--primary btn--block" data-install-now>${glyph("download")}<span>${escapeHtml(t("install.button"))}</span></button>` : ""}
          <ol class="install-steps">${steps(keys)}</ol>
          ${ios ? `<p class="form-note">${escapeHtml(t("install.ios_note"))}</p>` : ""}
        </div>`;
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
      body.querySelector("[data-install-now]")?.addEventListener("click", async () => {
        closeSheet();
        await promptInstall();
      });
    },
    { detent: "half" }
  );
}

/* Di Safari iPhone yang belum terpasang, panduan muncul sekali. */
export function maybeShowIosGuide() {
  if (!isIos() || isStandalone()) return;
  try {
    if (localStorage.getItem(GUIDE_SHOWN_KEY)) return;
    localStorage.setItem(GUIDE_SHOWN_KEY, "1");
  } catch {
    return;
  }
  window.setTimeout(showInstallGuide, 1200);
}
