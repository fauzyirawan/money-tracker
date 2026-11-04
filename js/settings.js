/* settings.js: halaman Lainnya dan Pengaturan. */

import { ApiError, api, isDemoMode } from "./api.js";
import { t, tError, formatDate, formatTime, getLanguage, setLanguage, setTimeZone } from "./i18n.js";
import { getMeta, getSettings, resetDemo, updateSettings } from "./store.js";
import { syncNow, syncStatus } from "./offline.js";
import { createPairingCode, hasPin, logoutAllDevices, pinSetup, removePin } from "./auth.js";
import { canPromptInstall, isStandalone, promptInstall, showInstallGuide } from "./install.js";
import { glyph, tile } from "./icons.js";
import { bindSegmented, closeSheet, escapeHtml, segmented, sheetHeader, showSheet, toast } from "./ui.js";

export const APP_VERSION = "1.0.8";

const TIME_ZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "Europe/Amsterdam", "America/New_York", "America/Los_Angeles", "UTC"];

let handlers = { onLogout: () => {} };

export function setSettingsHandlers(value) {
  handlers = { ...handlers, ...value };
}

/* --- Lainnya (HP) --- */

export function renderMore(root) {
  const link = (view, icon, color, label) => `
    <button type="button" class="row" data-go="${view}">
      ${tile(`lucide:${icon}`, color, "sm")}
      <span class="row__body">${escapeHtml(t(label))}</span>
      ${glyph("chevron-right", "icon row__chevron")}
    </button>`;

  root.innerHTML = `
    <div class="view view--narrow">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.more"))}</h1>
      <div class="list">
        ${link("budget", "piggy-bank", "#ff2d55", "nav.budget")}
        ${link("reports", "chart-pie", "#34c759", "nav.reports")}
        ${link("categories", "shapes", "#ff9500", "nav.categories")}
        ${link("funds", "wallet", "#007aff", "nav.funds")}
      </div>
      <div class="list">
        ${link("settings", "settings", "#8e8e93", "nav.settings")}
      </div>
    </div>`;
}

/* --- Pengaturan --- */

function applyDisplay(patch) {
  const display = {};
  if ("theme" in patch) display.theme = patch.theme;
  if ("reduceTransparency" in patch) display.reduceTransparency = patch.reduceTransparency;
  if ("increaseContrast" in patch) display.increaseContrast = patch.increaseContrast;
  if (Object.keys(display).length) window.MTTheme.set(display);
}

function change(patch) {
  updateSettings(patch);
  applyDisplay(patch);
  if (patch.timeZone) setTimeZone(patch.timeZone);
}

function row(label, control, meta = "") {
  return `
    <div class="row row--static">
      <span class="row__body"><span class="row__title">${escapeHtml(label)}</span>${meta ? `<span class="row__meta">${escapeHtml(meta)}</span>` : ""}</span>
      <span class="row__control">${control}</span>
    </div>`;
}

function actionRow(action, icon, label, meta = "", tone = "") {
  return `
    <button type="button" class="row ${tone}" data-action="${action}">
      ${glyph(icon)}
      <span class="row__body"><span class="row__title">${escapeHtml(label)}</span>${meta ? `<span class="row__meta">${escapeHtml(meta)}</span>` : ""}</span>
      ${glyph("chevron-right", "icon row__chevron")}
    </button>`;
}

function syncText() {
  const status = syncStatus();
  if (isDemoMode()) return t("settings.demo_mode");
  if (!status.online) return t("sync.offline", { count: status.unsynced });
  if (status.unsynced) return t("sync.unsynced", { count: status.unsynced });
  if (!status.lastSync) return t("sync.never");
  return t("sync.last", { time: `${formatDate(status.lastSync, "medium")} ${formatTime(status.lastSync)}` });
}

export function renderSettings(root) {
  const settings = getSettings();
  const prefs = window.MTTheme.get();
  const meta = getMeta();
  const toggle = (key, checked) => `<input type="checkbox" role="switch" class="switch" data-toggle="${key}" ${checked ? "checked" : ""} aria-label="${escapeHtml(t(`settings.${key === "reduceTransparency" ? "reduce_transparency" : "increase_contrast"}`))}" />`;
  const zones = TIME_ZONES.includes(settings.timeZone) ? TIME_ZONES : [settings.timeZone, ...TIME_ZONES];
  const folder = settings.receiptFolderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(settings.receiptFolderId)}` : "";

  root.innerHTML = `
    <div class="view view--narrow">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.settings"))}</h1>

      <section class="section">
        <h2 class="list__header">${escapeHtml(t("settings.language"))}</h2>
        ${segmented({ name: "language", label: t("settings.language"), value: getLanguage(), options: [{ value: "id", label: "Indonesia" }, { value: "en", label: "English" }] })}
      </section>

      <section class="section">
        <h2 class="list__header">${escapeHtml(t("settings.display"))}</h2>
        ${segmented({ name: "theme", label: t("settings.theme"), value: prefs.theme, options: ["auto", "light", "dark"].map((value) => ({ value, label: t(`settings.theme_${value}`) })) })}
        <div class="list">
          ${row(t("settings.reduce_transparency"), toggle("reduceTransparency", prefs.reduceTransparency))}
          ${row(t("settings.increase_contrast"), toggle("increaseContrast", prefs.increaseContrast))}
        </div>
      </section>

      <section class="section">
        <h2 class="list__header">${escapeHtml(t("settings.calendar"))}</h2>
        <div class="list">
          ${row(t("settings.time_zone"), `<select class="field__control field__control--compact" data-select="timeZone" aria-label="${escapeHtml(t("settings.time_zone"))}">${zones.map((zone) => `<option value="${escapeHtml(zone)}" ${zone === settings.timeZone ? "selected" : ""}>${escapeHtml(zone)}</option>`).join("")}</select>`)}
          ${row(t("settings.cycle_start"), `<select class="field__control field__control--compact" data-select="cycleStartDay" aria-label="${escapeHtml(t("settings.cycle_start"))}">${Array.from({ length: 28 }, (_, index) => index + 1).map((day) => `<option value="${day}" ${day === settings.cycleStartDay ? "selected" : ""}>${day}</option>`).join("")}</select>`, t("settings.cycle_help"))}
        </div>
        ${segmented({ name: "first-day", label: t("settings.first_day"), value: String(settings.firstDay), options: [{ value: "1", label: t("settings.first_day_mon") }, { value: "0", label: t("settings.first_day_sun") }] })}
      </section>

      <section class="section">
        <h2 class="list__header">${escapeHtml(t("settings.security"))}</h2>
        <div class="list">
          ${actionRow("pin", "shield", t(hasPin() ? "settings.pin_change" : "settings.pin_set"), t("settings.pin_help"))}
          ${hasPin() ? actionRow("pin-remove", "x", t("settings.pin_remove")) : ""}
          ${isDemoMode() ? "" : actionRow("pairing", "smartphone", t("settings.pairing"), t("settings.pairing_help"))}
        </div>
      </section>

      ${
        isDemoMode()
          ? ""
          : `<section class="section">
              <h2 class="list__header">${escapeHtml(t("settings.notifications"))}</h2>
              <div class="form-group">
                <label class="form-row"><span class="form-row__label">${escapeHtml(t("settings.reminder_email"))}</span><input type="email" data-email value="${escapeHtml(settings.reminderEmail)}" placeholder="${escapeHtml(meta.email)}" /></label>
              </div>
              <p class="form-note">${escapeHtml(t("settings.reminder_help"))}</p>
            </section>`
      }

      <section class="section">
        <h2 class="list__header">${escapeHtml(t("settings.data"))}</h2>
        <div class="list">
          ${actionRow("sync", "repeat", t("settings.sync_now"), syncText())}
          ${meta.spreadsheetUrl ? actionRow("open-sheet", "chart-line", t("report.open_sheets")) : ""}
          ${folder ? actionRow("open-folder", "image", t("settings.receipt_folder")) : ""}
          ${isDemoMode() ? "" : actionRow("test-scan", "scan-line", t("settings.test_scan"))}
          ${isStandalone() ? "" : actionRow("install", "download", t(canPromptInstall() ? "install.button" : "install.how"))}
        </div>
      </section>

      <section class="section">
        <h2 class="list__header">${escapeHtml(t("settings.account"))}</h2>
        <div class="list">
          ${row(t("settings.signed_in_as"), `<span class="text-2">${escapeHtml(isDemoMode() ? t("settings.demo_mode") : meta.email)}</span>`)}
          ${row(t("settings.version"), `<span class="text-2 tabular">${APP_VERSION}</span>`)}
        </div>
        ${
          isDemoMode()
            ? `<button type="button" class="btn btn--destructive btn--block" data-action="reset-demo">${glyph("rotate-ccw")}<span>${escapeHtml(t("settings.reset_demo"))}</span></button>`
            : `<button type="button" class="btn btn--destructive btn--block" data-action="logout">${escapeHtml(t("settings.logout"))}</button>
               <button type="button" class="btn btn--secondary btn--block" data-action="logout-all">${escapeHtml(t("settings.logout_all"))}</button>`
        }
      </section>
    </div>`;

  bindSegmented(root, "language", async (language) => {
    try {
      await setLanguage(language);
    } catch {
      /* Kamus bahasa gagal dimuat: beri tahu, lalu tampilkan lagi pilihan yang sedang berlaku. */
      toast(tError(navigator.onLine ? "NETWORK_ERROR" : "OFFLINE"));
      renderSettings(root);
      return;
    }
    change({ language });
  });
  bindSegmented(root, "theme", (theme) => change({ theme }));
  bindSegmented(root, "first-day", (value) => change({ firstDay: Number(value) }));
  root.querySelectorAll("[data-toggle]").forEach((input) => {
    input.addEventListener("change", () => change({ [input.dataset.toggle]: input.checked }));
  });
  root.querySelectorAll("[data-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.select;
      change({ [key]: key === "cycleStartDay" ? Number(select.value) : select.value });
    });
  });
  root.querySelector("[data-email]")?.addEventListener("change", (event) => {
    const email = event.target.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast(t("settings.email_invalid"));
      return;
    }
    change({ reminderEmail: email });
    toast(t("settings.saved"));
  });

  root.querySelector(".view").addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action) runAction(action, root);
  });
}

async function runAction(action, root) {
  const meta = getMeta();
  const settings = getSettings();
  switch (action) {
    case "pin":
      openPinSetup(root);
      break;
    case "pin-remove":
      removePin();
      toast(t("settings.pin_removed"));
      renderSettings(root);
      break;
    case "pairing":
      openPairing();
      break;
    case "sync":
      if (isDemoMode()) return;
      await syncNow({ full: true });
      toast(syncStatus().failed ? tError("NETWORK_ERROR") : t("sync.done"));
      renderSettings(root);
      break;
    case "open-sheet":
      window.open(meta.spreadsheetUrl, "_blank", "noopener");
      break;
    case "open-folder":
      window.open(`https://drive.google.com/drive/folders/${encodeURIComponent(settings.receiptFolderId)}`, "_blank", "noopener");
      break;
    case "test-scan":
      testScan();
      break;
    case "install":
      if (canPromptInstall()) await promptInstall();
      else showInstallGuide();
      break;
    case "reset-demo":
      await resetDemo(new Date().toISOString().slice(0, 10));
      toast(t("settings.reset_done"));
      break;
    case "logout":
      handlers.onLogout();
      break;
    case "logout-all":
      try {
        await logoutAllDevices();
        handlers.onLogout();
      } catch (error) {
        toast(tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR"));
      }
      break;
    default:
      break;
  }
}

async function testScan() {
  toast(t("settings.test_scan_running"));
  try {
    const { data } = await api("scan.test", {});
    toast(t("settings.test_scan_ok", { provider: data.provider, model: data.model, seconds: (data.latencyMs / 1000).toFixed(1) }));
  } catch (error) {
    toast(tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR"));
  }
}

function openPinSetup(root) {
  let length = 4;
  showSheet((body) => {
    const render = () => {
      body.innerHTML = `
        ${sheetHeader({ title: t("settings.pin_set") })}
        <div class="sheet__body">
          ${segmented({ name: "pin-length", label: t("settings.pin_length"), value: String(length), options: ["4", "6"].map((value) => ({ value, label: t("settings.pin_digits", { count: Number(value) }) })) })}
          <div data-pin-holder></div>
          <p class="form-note">${escapeHtml(t("settings.pin_note"))}</p>
        </div>`;
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
      bindSegmented(body, "pin-length", (value) => {
        length = Number(value);
        render();
      });
      pinSetup(body.querySelector("[data-pin-holder]"), {
        length,
        onDone() {
          closeSheet();
          toast(t("settings.pin_saved"));
          renderSettings(root);
        },
      });
    };
    render();
  });
}

function openPairing() {
  showSheet(
    async (body) => {
      body.innerHTML = `${sheetHeader({ title: t("settings.pairing") })}<div class="sheet__body"><p class="t-footnote text-2">${escapeHtml(t("common.loading"))}</p></div>`;
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
      try {
        const { code, expiresIn } = await createPairingCode();
        const until = Date.now() + expiresIn * 1000;
        body.querySelector(".sheet__body").innerHTML = `
          <p class="t-subhead text-2">${escapeHtml(t("settings.pairing_steps"))}</p>
          <p class="pairing-code tabular" aria-label="${escapeHtml(code.split("").join(" "))}">${escapeHtml(code)}</p>
          <p class="t-footnote text-2" role="timer" data-countdown></p>`;
        const countdown = body.querySelector("[data-countdown]");
        const tick = () => {
          const left = Math.max(0, Math.round((until - Date.now()) / 1000));
          countdown.textContent = left ? t("settings.pairing_expires", { minutes: Math.floor(left / 60), seconds: String(left % 60).padStart(2, "0") }) : t("settings.pairing_expired");
          if (left && countdown.isConnected) window.setTimeout(tick, 1000);
        };
        tick();
      } catch (error) {
        body.querySelector(".sheet__body").innerHTML = `<p class="form-error">${escapeHtml(tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR"))}</p>`;
      }
    },
    { detent: "half" }
  );
}
