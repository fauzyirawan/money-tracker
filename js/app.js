/* app.js: titik awal aplikasi.
   Urutan: muat salinan di perangkat -> login (kalau perlu) -> PIN (kalau ada) -> app.
   Juga mengatur navigasi, status sinkron, pintasan keyboard, dan pembaruan versi. */

import { configProblem, isDemoMode, onSessionRejected, setApiLanguage } from "./api.js";
import { getLanguage, getTimeZone, initI18n, localizedName, onLanguageChange, setLanguage, setTimeZone, t, tError } from "./i18n.js";
import { categoryOrFallback, clearLocalData, getSettings, loadStore, onStoreChange } from "./store.js";
import { clearQueue, loadQueue, onSyncError, onSyncStatus, startSync, stopSync, syncNow, syncStatus } from "./offline.js";
import { clearSession, getSession, hasPin, lockScreen, markUnlocked, removePin, renderLogin, watchLock } from "./auth.js";
import { customRange, periodRange } from "./stats.js";
import { renderDashboard } from "./dashboard.js";
import { destroyCharts } from "./charts.js";
import { openForm, renderTransactions, setToday, setTransactionFilter } from "./transactions.js";
import { openCategoryEditor, openFundEditor, renderCategories, renderFunds } from "./categories.js";
import { imagesFromClipboard, renderScan, scanFiles, setScanContext } from "./scan.js";
import { openScheduleEditor, renderScheduled } from "./scheduled.js";
import { openExportChooser, renderReports, setReportToday } from "./reports.js";
import { renderBudget } from "./budget.js";
import { renderMore, renderSettings, setSettingsHandlers } from "./settings.js";
import { maybeShowIosGuide, showInstallGuide } from "./install.js";
import { openRangePicker } from "./range-picker.js";
import { glyph } from "./icons.js";
import { closeSheet, escapeHtml, haptic, initSheet, replayAnimation, toast, transition } from "./ui.js";

const ENTER_DURATION = 1100;

/* Tab di HP */
const TABS = [
  { view: "home", icon: "house", label: "nav.home" },
  { view: "transactions", icon: "list", label: "nav.transactions_short" },
  { view: "scan", icon: "scan-line", label: "nav.scan" },
  { view: "scheduled", icon: "calendar-clock", label: "nav.scheduled" },
  { view: "more", icon: "ellipsis", label: "nav.more" },
];

/* Tab di tablet dan PC */
const NAV_TABS = [
  { view: "home", label: "nav.home" },
  { view: "transactions", label: "nav.transactions" },
  { view: "scan", label: "nav.scan" },
  { view: "scheduled", label: "nav.scheduled" },
  { view: "budget", label: "nav.budget" },
  { view: "reports", label: "nav.reports" },
  { view: "categories", label: "nav.categories" },
  { view: "funds", label: "nav.funds" },
];

/* Halaman di bawah menu Lainnya */
const CHILD_VIEWS = { budget: "more", reports: "more", categories: "more", funds: "more", settings: "more" };

const state = { view: "home", period: "quarter", custom: null, fund: "", category: "", today: "", started: false, launchAction: "" };
let appliedSettings = null;

const select = (selector) => document.querySelector(selector);

function todayInTimeZone() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: getTimeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function refreshToday() {
  state.today = todayInTimeZone();
  setToday(state.today, getSettings().firstDay);
  setScanContext({ today: state.today });
  setReportToday(state.today);
}

/* Rentang yang sedang aktif di dashboard dan ekspor. */
function activeRange() {
  if (state.period === "custom" && state.custom) return customRange(state.custom.from, state.custom.to);
  return periodRange(state.period, state.today, getSettings().cycleStartDay);
}

/* --- Pengaturan yang tersimpan di Sheets dipakai juga di perangkat ini --- */

function applyServerSettings() {
  const settings = getSettings();
  const previous = appliedSettings;
  appliedSettings = { ...settings };
  if (!previous) return;
  if (settings.language !== previous.language && settings.language !== getLanguage()) setLanguage(settings.language).catch(() => {});
  if (settings.timeZone !== previous.timeZone) {
    setTimeZone(settings.timeZone);
    refreshToday();
  }
  const display = {};
  ["theme", "reduceTransparency", "increaseContrast"].forEach((key) => {
    if (settings[key] !== previous[key]) display[key] = settings[key];
  });
  if (Object.keys(display).length) window.MTTheme.set(display);
}

/* --- Bilah atas dan navigasi --- */

function renderChrome() {
  select("[data-tagline]").textContent = t("app.tagline");
  select("[data-settings-button]").setAttribute("aria-label", t("nav.settings"));
  select("[data-export]").innerHTML = `${glyph("download")}<span>${escapeHtml(t("common.export"))}</span>`;

  select("[data-navtabs]").setAttribute("aria-label", t("nav.main"));
  select("[data-navtabs]").innerHTML = `<span class="nav-pill" data-pill></span>${NAV_TABS.map(
    (item) => `<button type="button" class="navtabs__item" data-go="${item.view}">${escapeHtml(t(item.label))}</button>`
  ).join("")}`;

  select("[data-tabbar]").setAttribute("aria-label", t("nav.main"));
  select("[data-tabbar]").innerHTML = `<span class="nav-pill" data-pill></span>${TABS.map(
    (item) => `<button type="button" class="tabbar__item" data-go="${item.view}">${glyph(item.icon)}<span class="tabbar__label">${escapeHtml(t(item.label))}</span></button>`
  ).join("")}`;

  renderThemeButton();
  renderSyncPill(syncStatus());
}

function renderThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  const button = select("[data-theme-toggle]");
  button.innerHTML = glyph(dark ? "sun" : "moon");
  button.setAttribute("aria-label", t("settings.switch_theme"));
}

/* Penanda kecil di bilah atas: mode demo, offline, atau data yang belum terkirim. */
function renderSyncPill(status) {
  const pill = select("[data-sync-pill]");
  let text = "";
  let tone = "neutral";
  let icon = "info";
  let count = 0;
  if (isDemoMode()) text = t("settings.demo_mode");
  else if (!status.online) {
    text = status.unsynced ? t("sync.offline", { count: status.unsynced }) : t("sync.offline_short");
    tone = "warning";
    icon = "cloud-off";
    count = status.unsynced;
  } else if (status.syncing) {
    text = t("sync.syncing");
    icon = "repeat";
  } else if (status.unsynced) {
    text = t("sync.unsynced", { count: status.unsynced });
    tone = "warning";
    icon = "upload";
    count = status.unsynced;
  } else if (status.failed) {
    text = t("sync.failed");
    tone = "critical";
    icon = "triangle-alert";
  }
  pill.hidden = !text;
  pill.className = `pill pill--${tone} sync-pill`;
  /* Di HP hanya ikon dan jumlah yang tampil; teks lengkap tetap dibacakan dan muncul saat disentuh lama. */
  pill.innerHTML = `${glyph(icon)}<span class="sync-pill__label">${escapeHtml(text)}</span>${count ? `<span class="sync-pill__count tabular" aria-hidden="true">${count}</span>` : ""}`;
  pill.title = text;
  pill.setAttribute("aria-label", text);
}

/* Kapsul penanda tab meluncur ke tab yang aktif. */
function movePill(list) {
  const pill = list.querySelector("[data-pill]");
  if (!pill) return;
  const active = list.querySelector('[aria-current="page"]');
  pill.style.opacity = active ? 1 : 0;
  if (!active) return;
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.height = `${active.offsetHeight}px`;
  pill.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
}

function syncNavigation() {
  const activeTab = CHILD_VIEWS[state.view] ?? state.view;
  document.querySelectorAll(".tabbar [data-go]").forEach((button) => {
    if (button.dataset.go === activeTab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".navtabs [data-go]").forEach((button) => {
    if (button.dataset.go === state.view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  movePill(select("[data-tabbar]"));
  movePill(select("[data-navtabs]"));
}

/* Tombol utama mengikuti halaman yang aktif. */
function pageAction() {
  if (state.view === "categories") return { label: "cat.new", run: () => openCategoryEditor() };
  if (state.view === "funds") return { label: "fund.new", run: () => openFundEditor() };
  if (state.view === "scheduled") return { label: "sched.new", run: () => openScheduleEditor() };
  return { label: "tx.new", run: () => openForm() };
}

function renderPageAction() {
  const action = pageAction();
  const button = select("[data-page-action]");
  button.innerHTML = `${glyph("plus")}<span>${escapeHtml(t(action.label))}</span>`;
  button.setAttribute("aria-label", t(action.label));
  button.onclick = action.run;

  const fab = select("[data-fab]");
  fab.hidden = ["scan", "more", "settings", "reports"].includes(state.view);
  fab.onclick = action.run;
  fab.setAttribute("aria-label", t(action.label));
}

/* --- Halaman --- */

function viewOptions() {
  const settings = getSettings();
  const options = {
    today: state.today,
    period: state.period,
    range: activeRange(),
    fund: state.fund,
    category: state.category,
    firstDay: settings.firstDay,
    cycleDay: settings.cycleStartDay,
    onFilterChange(filter) {
      Object.assign(state, filter);
      const y = window.scrollY;
      const focused = document.activeElement?.name;
      renderView();
      window.scrollTo(0, y);
      if (focused) select(`[name="${focused}"]`)?.focus();
    },
    onOpenRange(range) {
      openRangePicker({
        from: range.from,
        to: range.to,
        today: state.today,
        firstDay: settings.firstDay,
        onApply(custom) {
          options.onFilterChange({ period: "custom", custom });
        },
      });
    },
    onOpenCategory(category) {
      setTransactionFilter({ category });
      go("transactions");
    },
    onOpenDay(day) {
      setTransactionFilter({ day });
      go("transactions");
    },
  };
  return options;
}

const RENDERERS = {
  home: renderDashboard,
  transactions: renderTransactions,
  scan: renderScan,
  scheduled: renderScheduled,
  budget: renderBudget,
  reports: renderReports,
  more: renderMore,
  categories: renderCategories,
  funds: renderFunds,
  settings: renderSettings,
};

function renderView() {
  if (!state.started) return;
  const root = select("[data-root]");
  destroyCharts();
  RENDERERS[state.view](root, viewOptions());

  const parent = CHILD_VIEWS[state.view];
  if (parent) {
    root.querySelector(".view").insertAdjacentHTML(
      "afterbegin",
      `<button type="button" class="backlink" data-go="${parent}">${glyph("chevron-left")}<span>${escapeHtml(t(`nav.${parent}`))}</span></button>`
    );
  }
  renderPageAction();
  syncNavigation();
}

function renderAll() {
  renderChrome();
  renderView();
}

/* Isi halaman muncul berurutan, hanya saat halaman baru dibuka. */
function playEnter() {
  const root = select("[data-root]");
  root.classList.add("is-enter");
  window.clearTimeout(playEnter.timer);
  playEnter.timer = window.setTimeout(() => root.classList.remove("is-enter"), ENTER_DURATION);
}

/* Pindah halaman tidak memakai transisi "foto layar" bawaan browser. Transisi itu memotret
   seluruh layar termasuk bilah tab, sehingga kapsul tab lama dan baru sempat tampil
   bersamaan dan ketukan berikutnya bisa tertahan. Yang dianimasikan hanya isi halaman. */
function show(view) {
  state.view = view;
  window.scrollTo(0, 0);
  playEnter();
  renderView();
  const target = select("[data-root] .view");
  if (!target) return;
  target.classList.remove("is-entering");
  void target.offsetWidth;
  target.classList.add("is-entering");
}

function go(view) {
  if (!RENDERERS[view]) return;
  if (view === state.view) {
    if (view === "transactions") renderView();
    return;
  }
  haptic();
  history.pushState({ view }, "");
  show(view);
}

/* --- Masuk, kunci, dan keluar --- */

function gate() {
  return select("[data-gate]");
}

function showApp() {
  gate().hidden = true;
  gate().innerHTML = "";
  document.body.classList.remove("is-gated");
}

function hideApp() {
  document.body.classList.add("is-gated");
}

async function logout(reason) {
  stopSync();
  clearSession();
  removePin();
  await clearQueue();
  await clearLocalData();
  state.started = false;
  closeSheet();
  select("[data-root]").innerHTML = "";
  showLogin();
  if (reason) toast(tError(reason));
}

function showLogin() {
  hideApp();
  renderLogin(gate(), {
    async onSuccess() {
      await loadStore(state.today);
      enterApp({ firstLogin: true });
    },
    onInstallHelp: showInstallGuide,
  });
}

function enterApp({ firstLogin = false } = {}) {
  showApp();
  markUnlocked();
  appliedSettings = { ...getSettings() };
  state.started = true;
  playEnter();
  renderAll();
  if (!isDemoMode()) {
    startSync();
    if (firstLogin) {
      toast(t("sync.loading_first"));
      syncNow({ full: true });
    }
  }
  maybeShowIosGuide();
  runLaunchAction();
}

/* Pintasan dari ikon app (tekan lama ikon di HP): ?action=new atau ?action=scan.
   Dijalankan sekali setelah app terbuka, lalu dihapus dari alamat. */
function runLaunchAction() {
  const action = state.launchAction;
  state.launchAction = "";
  if (action === "new") openForm();
  if (action === "scan") go("scan");
}

function unlockThen(next) {
  if (!hasPin()) {
    next();
    return;
  }
  hideApp();
  lockScreen(gate(), { onUnlock: next, onForgot: () => logout() });
}

/* --- Pembaruan versi lewat service worker --- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const localhost = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (location.protocol !== "https:" && !localhost) return;
  navigator.serviceWorker
    .register("service-worker.js")
    .then((registration) => {
      if (!registration) return;
      const offer = (worker) => {
        toast(t("app.update_ready"), {
          actionLabel: t("app.update_reload"),
          onAction: () => worker.postMessage("skip-waiting"),
        });
      };
      if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
        });
      });
    })
    .catch(() => {
      /* Browser menolak service worker (misalnya mode privat Firefox): app tetap jalan, hanya tanpa cache offline. */
    });
  /* Muat ulang hanya saat versi lama diganti versi baru. Pada kunjungan pertama
     service worker juga mengambil alih halaman, dan itu tidak perlu muat ulang. */
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

/* --- Kejadian global --- */

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-go]");
    if (target) {
      if (target.dataset.go === "transactions") setTransactionFilter({});
      go(target.dataset.go);
    }
  });

  select("[data-export]").addEventListener("click", () => {
    openExportChooser(activeRange(), (row) => (!state.fund || row.fund === state.fund || row.toFund === state.fund) && (!state.category || row.category === state.category));
  });

  select("[data-sync-pill]").addEventListener("click", () => syncNow());

  select("[data-theme-toggle]").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const dark = document.documentElement.dataset.theme === "dark";
    transition(() => {
      window.MTTheme.set({ theme: dark ? "light" : "dark" });
      renderThemeButton();
    });
    button.classList.add("is-theme-spin");
    replayAnimation(button.querySelector(".icon"));
  });

  window.addEventListener("popstate", (event) => {
    const view = event.state?.view;
    if (view && view !== state.view && state.started) show(view);
  });

  document.addEventListener("keydown", (event) => {
    const typing = event.target.closest("input, textarea, select, [contenteditable]");
    if (!state.started || typing || event.metaKey || event.ctrlKey || event.altKey || select("dialog").open) return;
    const key = event.key.toLowerCase();
    if (key === "n") openForm();
    if (key === "s") go("scan");
    if (key === "/") {
      event.preventDefault();
      go("transactions");
      requestAnimationFrame(() => select("[data-search]")?.focus());
    }
  });

  /* Tempel screenshot bukti transfer dari mana saja: langsung ke alur scan. */
  document.addEventListener("paste", (event) => {
    if (!state.started || select("dialog").open || event.target.closest("input, textarea")) return;
    const images = imagesFromClipboard(event);
    if (!images.length) return;
    event.preventDefault();
    go("scan");
    scanFiles(images);
  });

  window.matchMedia("(min-width: 1024px)").addEventListener("change", () => {
    if (state.view === "transactions") renderView();
  });
  window.addEventListener("resize", syncNavigation);
  document.fonts?.ready.then(syncNavigation);

  /* Warna grafik dibaca dari tema, jadi grafik digambar ulang saat tema berganti. */
  new MutationObserver(() => {
    renderThemeButton();
    if (state.view === "home") renderView();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });

  /* Hari berganti saat app terbuka semalaman. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !state.started) return;
    const before = state.today;
    refreshToday();
    if (before !== state.today) renderView();
  });

  onLanguageChange((language) => {
    setApiLanguage(language);
    if (state.started) renderAll();
  });

  /* Dashboard tidak digambar ulang di bawah lembar yang sedang terbuka (misalnya pemilih rentang),
     tapi ditunda sampai lembar itu tertutup, supaya angkanya tetap terbaru. */
  let renderTimer = 0;
  let renderAfterSheet = false;
  select("dialog").addEventListener("close", () => {
    if (!renderAfterSheet) return;
    renderAfterSheet = false;
    renderView();
  });
  onStoreChange(() => {
    applyServerSettings();
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      if (select("dialog").open && state.view === "home") {
        renderAfterSheet = true;
        return;
      }
      renderView();
    }, 60);
  });
  onSyncStatus(renderSyncPill);
  onSyncError((rejection) => {
    const name = rejection.transaction?.name;
    toast(name ? t("sync.rejected", { name, reason: tError(rejection.code) }) : tError(rejection.code));
  });
  onSessionRejected((code) => logout(code));

  setScanContext({
    onSaved(row) {
      setTransactionFilter({});
      toast(t("scan.saved_as", { name: row.name, category: row.category ? localizedName(categoryOrFallback(row.category)) : t("enum.TRANSFER") }));
    },
  });
  setSettingsHandlers({ onLogout: () => logout() });
}

async function start() {
  await loadQueue();
  const hasData = await loadStore(new Date().toISOString().slice(0, 10));
  const settings = getSettings();
  await initI18n({ timeZone: settings.timeZone });
  setApiLanguage(getLanguage());
  refreshToday();
  state.launchAction = new URLSearchParams(location.search).get("action") ?? "";
  history.replaceState({ view: state.view }, "", location.pathname);
  initSheet(select("#sheet"));
  bindEvents();
  renderChrome();
  registerServiceWorker();
  watchLock(gate(), { onUnlock: showApp, onForgot: () => logout() });
  const problem = configProblem();
  if (problem) toast(t(`app.config_${problem}`), { duration: 15000 });

  const session = getSession();
  if (!isDemoMode() && !session) {
    if (hasData) await clearLocalData();
    showLogin();
    return;
  }
  unlockThen(() => enterApp({ firstLogin: !isDemoMode() && !hasData }));
}

start();
