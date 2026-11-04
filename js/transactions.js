/* transactions.js: daftar transaksi, serta tambah, ubah, duplikat, dan hapus.
   HP: daftar per tanggal dengan swipe. PC: tabel yang bisa diurutkan.
   Aksi bisa dicapai dari tombol titik tiga, klik kanan, tekan lama, dan halaman detail. */

import { ApiError, api, isDemoMode } from "./api.js";
import { t, tError, formatCurrency, formatDate, formatNumber, formatTime, getLanguage, localizedName, parseAmount } from "./i18n.js";
import { categoryOrFallback, createId, deleteTransaction, fundOrFallback, getCategories, getFunds, getTransactions, isUnsynced, restoreTransaction, saveTransaction } from "./store.js";
import { enqueuePhoto } from "./offline.js";
import { exportImage, imageDataUrl, isImageFile, openImage } from "./image.js";
import { openRangePicker } from "./range-picker.js";
import { glyph, tile } from "./icons.js";
import { bindAmountInput, bindSegmented, closeSheet, escapeHtml, haptic, initSwipeRow, openMenu, replayAnimation, segmented, sheetHeader, showSheet, toast } from "./ui.js";

const PAGE_SIZE = 60;
const TYPES = ["ALL", "IN", "OUT", "TRANSFER"];
const METHODS = ["MANUAL", "SCAN", "SCHEDULED"];
const TRANSFER_ICON = "lucide:arrow-left-right";
const TRANSFER_COLOR = "#5856d6";
const REMOVE_DURATION = 240;
const FLASH_DURATION = 1500;
const isWideLayout = () => window.matchMedia("(min-width: 1024px)").matches;

const EMPTY_FILTER = { query: "", type: "ALL", category: "", fund: "", day: "", from: "", to: "", minAmount: 0, maxAmount: 0, method: "" };
const view = { ...EMPTY_FILTER, sort: { key: "date", direction: "desc" }, limit: PAGE_SIZE };
let context = { today: "", firstDay: 1 };
let flashId = "";

/* Dipanggil saat app dimulai, karena form bisa dibuka dari halaman mana pun. */
export function setToday(today, firstDay = 1) {
  context = { today, firstDay };
}

export function setTransactionFilter(filter) {
  Object.assign(view, EMPTY_FILTER, { limit: PAGE_SIZE }, filter);
}

function tileFor(item, size) {
  if (item.type === "TRANSFER") return tile(TRANSFER_ICON, TRANSFER_COLOR, size);
  const category = categoryOrFallback(item.category);
  return tile(category.icon, category.color, size);
}

function categoryLabel(item) {
  if (item.type === "TRANSFER") return t("enum.TRANSFER");
  const name = localizedName(categoryOrFallback(item.category));
  return item.subCategory ? `${name}, ${localizedName(categoryOrFallback(item.subCategory))}` : name;
}

function fundLabel(item) {
  const from = fundOrFallback(item.fund).name;
  if (item.type !== "TRANSFER") return from;
  return t("tx.transfer_route", { from, to: fundOrFallback(item.toFund).name });
}

function amountText(item) {
  if (item.type === "IN") return formatCurrency(item.amount, { signed: true });
  return formatCurrency(item.type === "OUT" ? -item.amount : item.amount);
}

function amountClass(item) {
  if (item.type === "IN") return "text-income";
  return item.type === "TRANSFER" ? "text-transfer" : "";
}

function addDay(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(date) {
  if (date === context.today) return t("common.today");
  if (date === addDay(context.today, -1)) return t("common.yesterday");
  return formatDate(date, "long");
}

function activeFilterCount() {
  return ["fund", "from", "minAmount", "maxAmount", "method"].filter((key) => view[key]).length;
}

function filtered() {
  const query = view.query.trim().toLowerCase();
  return getTransactions().filter((item) => {
    if (view.type !== "ALL" && item.type !== view.type) return false;
    if (view.category && item.category !== view.category && item.subCategory !== view.category) return false;
    if (view.fund && item.fund !== view.fund && item.toFund !== view.fund) return false;
    if (view.day && item.date !== view.day) return false;
    if (view.from && (item.date < view.from || item.date > view.to)) return false;
    if (view.minAmount && item.amount < view.minAmount) return false;
    if (view.maxAmount && item.amount > view.maxAmount) return false;
    if (view.method && item.inputMethod !== view.method) return false;
    if (!query) return true;
    return [item.name, item.merchant, item.note, categoryLabel(item)].some((text) => text?.toLowerCase().includes(query));
  });
}

const SORTERS = {
  date: (a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`),
  name: (a, b) => a.name.localeCompare(b.name),
  category: (a, b) => categoryLabel(a).localeCompare(categoryLabel(b)),
  fund: (a, b) => fundLabel(a).localeCompare(fundLabel(b)),
  amount: (a, b) => a.amount - b.amount,
};

function sorted(items) {
  const compare = SORTERS[view.sort.key];
  const direction = view.sort.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => compare(a, b) * direction);
}

/* Transaksi yang baru disimpan disorot sebentar agar mudah ditemukan. */
function flash(id) {
  flashId = id;
  window.setTimeout(() => {
    if (flashId === id) flashId = "";
  }, FLASH_DURATION);
}

const flashClass = (item) => (item.id === flashId ? "is-flash" : "");

function unsyncedBadge(item) {
  return isUnsynced(item.id) ? `<span class="badge" title="${escapeHtml(t("tx.unsynced"))}">${glyph("cloud-off")}<span class="visually-hidden">${escapeHtml(t("tx.unsynced"))}</span></span>` : "";
}

function rowHtml(item) {
  return `
    <div class="row-shell ${flashClass(item)}" data-tx="${escapeHtml(item.id)}">
      <div class="row">
        <button type="button" class="row-button" data-tx-open>
          ${tileFor(item, "md")}
          <span class="row__body">
            <span class="row__title">${escapeHtml(item.name)}</span>
            <span class="row__meta">${unsyncedBadge(item)}${escapeHtml(categoryLabel(item))}, ${escapeHtml(fundLabel(item))}</span>
          </span>
          <span class="row__amount ${amountClass(item)}">${escapeHtml(amountText(item))}</span>
        </button>
        <button type="button" class="btn-round" data-tx-menu aria-label="${escapeHtml(t("tx.actions"))}">${glyph("ellipsis")}</button>
        <div class="row__actions">
          <button type="button" class="row__action row__action--edit" data-tx-edit>${glyph("pencil")}${escapeHtml(t("common.edit"))}</button>
          <button type="button" class="row__action row__action--delete" data-tx-delete>${glyph("trash-2")}${escapeHtml(t("common.delete"))}</button>
        </div>
      </div>
    </div>`;
}

/* --- Pemisah per bulan ---
   Bulan terbaru di atas, kecuali saat diurutkan tanggal dari yang terlama.
   Urutan lain (nominal, nama) berlaku di dalam setiap bulan. */

function byMonth(items) {
  const direction = view.sort.key === "date" && view.sort.direction === "asc" ? 1 : -1;
  const months = new Map();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(item);
  }
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b) * direction).flatMap(([, group]) => group);
}

/* Total dihitung dari semua transaksi bulan itu yang lolos filter, bukan hanya yang sudah dimuat. */
function monthTotals(items) {
  const totals = new Map();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    const entry = totals.get(key) ?? { income: 0, expense: 0, count: 0 };
    if (item.type === "IN") entry.income += item.amount;
    if (item.type === "OUT") entry.expense += item.amount;
    entry.count += 1;
    totals.set(key, entry);
  }
  return totals;
}

function monthDivider(month, totals, tag = "div") {
  const { income, expense, count } = totals.get(month);
  return `
    <${tag} class="month-divider">
      <span class="month-divider__name">
        <span class="month-divider__title">${escapeHtml(formatDate(`${month}-01`, "monthYear"))}</span>
        <span class="month-divider__count">${escapeHtml(t("tx.count", { count }))}</span>
      </span>
      <span class="month-divider__totals tabular">
        ${income ? `<span class="text-income" aria-label="${escapeHtml(t("dashboard.total_income"))}">${escapeHtml(formatCurrency(income, { signed: true }))}</span>` : ""}
        ${expense ? `<span class="text-expense" aria-label="${escapeHtml(t("dashboard.total_expense"))}">${escapeHtml(formatCurrency(-expense))}</span>` : ""}
      </span>
    </${tag}>`;
}

function listHtml(items, totals) {
  const months = [...new Set(items.map((item) => item.date.slice(0, 7)))];
  return months
    .map((month) => {
      const inMonth = items.filter((item) => item.date.slice(0, 7) === month);
      const days = [...new Set(inMonth.map((item) => item.date))];
      const dayGroups = days
        .map((date) => {
          const group = inMonth.filter((item) => item.date === date);
          const total = group.reduce((sum, item) => {
            if (item.type === "IN") return sum + item.amount;
            return item.type === "OUT" ? sum - item.amount : sum;
          }, 0);
          return `
            <section class="section">
              <h3 class="list__header"><span>${escapeHtml(dayLabel(date))}</span><span class="tabular">${escapeHtml(formatCurrency(total, { signed: true }))}</span></h3>
              <div class="list">${group.map(rowHtml).join("")}</div>
            </section>`;
        })
        .join("");
      return `
        <section class="month-group">
          ${monthDivider(month, totals, "h2")}
          ${dayGroups}
        </section>`;
    })
    .join("");
}

function sortHeader(key, label) {
  const active = view.sort.key === key;
  const ariaSort = active ? (view.sort.direction === "asc" ? "ascending" : "descending") : "none";
  const arrow = active ? glyph(view.sort.direction === "asc" ? "arrow-up" : "arrow-down") : "";
  return `<th aria-sort="${ariaSort}"><button type="button" class="ledger__sort" data-sort="${key}">${escapeHtml(label)}${arrow}</button></th>`;
}

function tableHtml(items, totals) {
  const rowFor = (item) => `
      <tr class="${flashClass(item)}" data-tx="${escapeHtml(item.id)}" data-tx-open>
        <td class="tabular">${escapeHtml(formatDate(item.date, "short"))}</td>
        <td><span class="ledger__name">${tileFor(item, "sm")}<span class="row__title">${escapeHtml(item.name)}</span>${unsyncedBadge(item)}</span></td>
        <td>${escapeHtml(categoryLabel(item))}</td>
        <td>${escapeHtml(fundLabel(item))}</td>
        <td class="ledger__amount ${amountClass(item)}">${escapeHtml(amountText(item))}</td>
        <td class="ledger__menu"><button type="button" class="btn-round" data-tx-menu aria-label="${escapeHtml(t("tx.actions"))}">${glyph("ellipsis")}</button></td>
      </tr>`;
  const months = [...new Set(items.map((item) => item.date.slice(0, 7)))];
  const rows = months
    .map(
      (month) => `
      <tbody class="ledger__group">
        <tr class="ledger__month"><th colspan="6" scope="colgroup">${monthDivider(month, totals)}</th></tr>
        ${items.filter((item) => item.date.slice(0, 7) === month).map(rowFor).join("")}
      </tbody>`
    )
    .join("");
  return `
    <div class="list">
      <table class="ledger">
        <thead><tr>
          ${sortHeader("date", t("tx.date"))}
          ${sortHeader("name", t("tx.name"))}
          ${sortHeader("category", t("tx.category"))}
          ${sortHeader("fund", t("tx.fund"))}
          ${sortHeader("amount", t("tx.amount"))}
          <th><span class="visually-hidden">${escapeHtml(t("tx.actions"))}</span></th>
        </tr></thead>
        ${rows}
      </table>
    </div>`;
}

function emptyHtml() {
  return `
    <div class="list empty-state">
      ${glyph("search")}
      <p class="t-headline">${escapeHtml(t("tx.empty_title"))}</p>
      <p class="t-footnote">${escapeHtml(t("tx.empty_body"))}</p>
      <button type="button" class="btn btn--primary" data-tx-new>${escapeHtml(t("tx.new"))}</button>
    </div>`;
}

function renderResults(root, { animate = false } = {}) {
  const items = byMonth(sorted(filtered()));
  const shown = items.slice(0, view.limit);
  const totals = monthTotals(items);
  const results = root.querySelector("[data-results]");
  root.querySelector("[data-count]").textContent = t("tx.count", { count: items.length });

  if (!items.length) results.innerHTML = emptyHtml();
  else results.innerHTML = isWideLayout() ? tableHtml(shown, totals) : listHtml(shown, totals);
  if (animate) replayAnimation(results);

  results.querySelectorAll(".row-shell").forEach((shell) => {
    initSwipeRow(shell, (point) => openMenu(point, menuItems(find(shell.dataset.tx))));
  });

  root.querySelector("[data-sentinel]").hidden = shown.length >= items.length;
}

function find(id) {
  return getTransactions().find((item) => item.id === id);
}

function menuItems(item) {
  return [
    { label: t("common.edit"), icon: "pencil", onSelect: () => openForm({ item }) },
    { label: t("common.duplicate"), icon: "copy", onSelect: () => openForm({ item, duplicate: true }) },
    { label: t("common.delete"), icon: "trash-2", destructive: true, onSelect: () => removeTransaction(item.id) },
  ];
}

function deleteNow(id) {
  const removed = deleteTransaction(id);
  if (!removed) return;
  toast(t("tx.deleted"), {
    actionLabel: t("common.undo"),
    onAction() {
      flash(removed.id);
      restoreTransaction(removed);
      toast(t("tx.restored"));
    },
  });
}

/* Baris menutup dulu dengan animasi, baru datanya dihapus. */
export function removeTransaction(id) {
  haptic(20);
  closeSheet();
  const holder = document.querySelector(`[data-root] [data-tx="${CSS.escape(id)}"]`);
  if (!holder) {
    deleteNow(id);
    return;
  }
  holder.style.height = `${holder.offsetHeight}px`;
  void holder.offsetHeight;
  holder.classList.add("is-removing");
  window.setTimeout(() => deleteNow(id), REMOVE_DURATION);
}

function filterChips() {
  const chips = TYPES.map((type) => {
    const label = type === "ALL" ? t("tx.filter_all") : t(`enum.${type}`);
    return `<button type="button" class="chip" data-type="${type}" aria-pressed="${view.type === type}">${escapeHtml(label)}</button>`;
  });
  const count = activeFilterCount();
  chips.push(`<button type="button" class="chip" data-open-filters aria-pressed="${count > 0}">${glyph("chart-line")}${escapeHtml(count ? t("tx.filters_count", { count }) : t("tx.filters"))}</button>`);
  if (view.category) {
    chips.push(`<button type="button" class="chip" data-clear="category" aria-pressed="true">${escapeHtml(localizedName(categoryOrFallback(view.category)))}${glyph("x")}</button>`);
  }
  if (view.day) {
    chips.push(`<button type="button" class="chip" data-clear="day" aria-pressed="true">${escapeHtml(formatDate(view.day, "medium"))}${glyph("x")}</button>`);
  }
  return `<div class="chips" role="group" aria-label="${escapeHtml(t("tx.filter"))}">${chips.join("")}</div>`;
}

export function renderTransactions(root, options = {}) {
  context = { ...context, ...options };
  root.innerHTML = `
    <div class="view">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.transactions"))}</h1>
      <label class="search">
        ${glyph("search")}
        <span class="visually-hidden">${escapeHtml(t("tx.search_placeholder"))}</span>
        <input type="search" data-search value="${escapeHtml(view.query)}" placeholder="${escapeHtml(t("tx.search_placeholder"))}" />
      </label>
      <div data-chips>${filterChips()}</div>
      <p class="t-footnote text-2" data-count></p>
      <div class="section results-fade" data-results></div>
      <div data-sentinel></div>
    </div>`;

  renderResults(root);

  root.querySelector("[data-search]").addEventListener("input", (event) => {
    view.query = event.target.value;
    view.limit = PAGE_SIZE;
    renderResults(root, { animate: true });
  });

  root.querySelector(".view").addEventListener("click", (event) => handleClick(event, root));
  root.querySelector(".view").addEventListener("contextmenu", (event) => {
    const holder = event.target.closest("[data-tx]");
    if (!holder) return;
    event.preventDefault();
    openMenu({ x: event.clientX + 200, y: event.clientY }, menuItems(find(holder.dataset.tx)));
  });

  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    view.limit += PAGE_SIZE;
    renderResults(root);
  }).observe(root.querySelector("[data-sentinel]"));
}

function refreshFilters(root) {
  view.limit = PAGE_SIZE;
  root.querySelector("[data-chips]").innerHTML = filterChips();
  renderResults(root, { animate: true });
}

function handleClick(event, root) {
  const target = event.target;
  const holder = target.closest("[data-tx]");
  const item = holder ? find(holder.dataset.tx) : null;

  const typeChip = target.closest("[data-type]");
  if (typeChip) {
    view.type = typeChip.dataset.type;
    refreshFilters(root);
    return;
  }
  if (target.closest("[data-open-filters]")) {
    openFilters(root);
    return;
  }
  const clearChip = target.closest("[data-clear]");
  if (clearChip) {
    view[clearChip.dataset.clear] = "";
    refreshFilters(root);
    return;
  }
  const sortButton = target.closest("[data-sort]");
  if (sortButton) {
    const key = sortButton.dataset.sort;
    const same = view.sort.key === key;
    view.sort = { key, direction: same && view.sort.direction === "desc" ? "asc" : "desc" };
    renderResults(root, { animate: true });
    return;
  }
  if (target.closest("[data-tx-new]")) {
    openForm();
    return;
  }
  if (!item) return;

  const menuButton = target.closest("[data-tx-menu]");
  if (menuButton) {
    const box = menuButton.getBoundingClientRect();
    openMenu({ x: box.right, y: box.bottom }, menuItems(item));
    return;
  }
  if (target.closest("[data-tx-edit]")) openForm({ item });
  else if (target.closest("[data-tx-delete]")) removeTransaction(item.id);
  else if (target.closest("[data-tx-open]")) openDetail(item);
}

/* --- Filter lengkap --- */

function openFilters(root) {
  const draft = { fund: view.fund, from: view.from, to: view.to, minAmount: view.minAmount, maxAmount: view.maxAmount, method: view.method };
  showSheet((body) => {
    const render = () => {
      const fundChips = [`<button type="button" class="chip" data-filter-fund="" aria-pressed="${!draft.fund}">${escapeHtml(t("tx.filter_all"))}</button>`]
        .concat(getFunds().map((fund) => `<button type="button" class="chip" data-filter-fund="${escapeHtml(fund.id)}" aria-pressed="${draft.fund === fund.id}">${escapeHtml(fund.name)}</button>`))
        .join("");
      const methodChips = [`<button type="button" class="chip" data-filter-method="" aria-pressed="${!draft.method}">${escapeHtml(t("tx.filter_all"))}</button>`]
        .concat(METHODS.map((method) => `<button type="button" class="chip" data-filter-method="${method}" aria-pressed="${draft.method === method}">${escapeHtml(t(`tx.method_${method}`))}</button>`))
        .join("");
      body.innerHTML = `
        ${sheetHeader({
          title: t("tx.filters"),
          leading: `<button type="button" class="btn-plain" data-reset>${escapeHtml(t("tx.filters_reset"))}</button>`,
          trailing: `<button type="button" class="btn-plain btn-plain--strong" data-apply>${escapeHtml(t("range.apply"))}</button>`,
        })}
        <div class="sheet__body">
          <section class="section"><h3 class="list__header">${escapeHtml(t("tx.fund"))}</h3><div class="chips chips--wrap">${fundChips}</div></section>
          <section class="section">
            <h3 class="list__header">${escapeHtml(t("dashboard.range"))}</h3>
            <button type="button" class="field__control field__button" data-pick-range>
              <span>${escapeHtml(draft.from ? `${formatDate(draft.from, "short")} - ${formatDate(draft.to, "short")}` : t("tx.filter_any_date"))}</span>${glyph("calendar")}
            </button>
          </section>
          <section class="section">
            <h3 class="list__header">${escapeHtml(t("tx.filter_amount"))}</h3>
            <div class="form-group">
              <label class="form-row"><span class="form-row__label">${escapeHtml(t("tx.filter_min"))}</span><input inputmode="numeric" name="minAmount" value="${draft.minAmount ? escapeHtml(formatNumber(draft.minAmount)) : ""}" placeholder="0" /></label>
              <label class="form-row"><span class="form-row__label">${escapeHtml(t("tx.filter_max"))}</span><input inputmode="numeric" name="maxAmount" value="${draft.maxAmount ? escapeHtml(formatNumber(draft.maxAmount)) : ""}" placeholder="-" /></label>
            </div>
          </section>
          <section class="section"><h3 class="list__header">${escapeHtml(t("tx.method"))}</h3><div class="chips chips--wrap">${methodChips}</div></section>
        </div>`;
      body.querySelectorAll("[name=minAmount], [name=maxAmount]").forEach((input) => {
        bindAmountInput(input, { onChange: (amount) => (draft[input.name] = amount) });
      });
      body.querySelector("[data-reset]").addEventListener("click", () => {
        Object.assign(draft, { fund: "", from: "", to: "", minAmount: 0, maxAmount: 0, method: "" });
        render();
      });
      body.querySelector("[data-apply]").addEventListener("click", () => {
        Object.assign(view, draft);
        closeSheet();
        refreshFilters(root);
      });
      body.querySelector("[data-pick-range]").addEventListener("click", () => {
        const backup = { ...draft };
        openRangePicker({
          from: draft.from || addDay(context.today, -29),
          to: draft.to || context.today,
          today: context.today,
          firstDay: context.firstDay,
          onApply(range) {
            Object.assign(view, backup, range);
            refreshFilters(root);
          },
        });
      });
      body.querySelector(".sheet__body").addEventListener("click", (event) => {
        const fund = event.target.closest("[data-filter-fund]");
        if (fund) {
          draft.fund = fund.dataset.filterFund;
          render();
        }
        const method = event.target.closest("[data-filter-method]");
        if (method) {
          draft.method = method.dataset.filterMethod;
          render();
        }
      });
    };
    render();
  });
}

/* --- Detail --- */

function detailRow(label, value) {
  return `
    <div class="row row--static">
      <span class="row__body text-2">${escapeHtml(label)}</span>
      <span class="row__amount">${escapeHtml(value)}</span>
    </div>`;
}

async function showReceipt(item, holder) {
  holder.innerHTML = `<p class="t-footnote text-2">${escapeHtml(t("common.loading"))}</p>`;
  try {
    const { data } = await api("receipts.get", { transactionId: item.id });
    holder.innerHTML = `<div class="scan-photo" data-zoom tabindex="0" role="button" aria-label="${escapeHtml(t("scan.zoom"))}"><img src="data:${escapeHtml(data.mime)};base64,${data.imageBase64}" alt="${escapeHtml(t("scan.photo_alt"))}" /></div>`;
    holder.querySelector("[data-zoom]").addEventListener("click", (event) => event.currentTarget.classList.toggle("is-zoomed"));
  } catch (error) {
    holder.innerHTML = `<p class="form-error">${escapeHtml(tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR"))}</p>`;
  }
}

function openDetail(item) {
  showSheet(
    (body) => {
      const rows = [
        detailRow(t("tx.category"), categoryLabel(item)),
        detailRow(t("tx.fund"), fundLabel(item)),
        detailRow(t("tx.time"), formatTime(`${item.date}T${item.time}:00+08:00`)),
        detailRow(t("tx.method"), t(`tx.method_${item.inputMethod || "MANUAL"}`)),
      ];
      if (item.merchant && item.merchant !== item.name) rows.push(detailRow(t("scan.merchant"), item.merchant));
      if (item.referenceNo) rows.push(detailRow(t("scan.reference"), item.referenceNo));
      if (item.note) rows.push(detailRow(t("tx.note"), item.note));
      const items = item.details?.items ?? [];
      body.innerHTML = `
        ${sheetHeader({ title: t("tx.detail") })}
        <div class="sheet__body">
          <div class="detail-hero">
            ${tileFor(item, "md")}
            <p class="detail-hero__amount ${amountClass(item)}">${escapeHtml(amountText(item))}</p>
            <p class="t-headline">${escapeHtml(item.name)}</p>
            <p class="t-footnote text-2">${escapeHtml(formatDate(item.date, "full"))}</p>
            ${isUnsynced(item.id) ? `<p class="badge">${glyph("cloud-off")}${escapeHtml(t("tx.unsynced"))}</p>` : ""}
          </div>
          <div class="detail-actions">
            <button type="button" class="btn btn--secondary" data-action="edit">${glyph("pencil")}${escapeHtml(t("common.edit"))}</button>
            <button type="button" class="btn btn--secondary" data-action="duplicate">${glyph("copy")}${escapeHtml(t("common.duplicate"))}</button>
            <button type="button" class="btn btn--destructive" data-action="delete">${glyph("trash-2")}${escapeHtml(t("common.delete"))}</button>
          </div>
          <div class="list list--plain">${rows.join("")}</div>
          ${
            items.length
              ? `<section class="section"><h3 class="list__header">${escapeHtml(t("scan.items", { count: items.length }))}</h3>
                  <div class="list list--plain">${items.map((entry) => detailRow(`${entry.name} x${formatNumber(entry.quantity)}`, formatCurrency(entry.price))).join("")}</div></section>`
              : ""
          }
          ${item.receiptLink ? `<button type="button" class="btn btn--secondary btn--block" data-receipt>${glyph("image")}<span>${escapeHtml(t("tx.show_receipt"))}</span></button><div data-receipt-holder></div>` : ""}
        </div>`;
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
      body.querySelector('[data-action="edit"]').addEventListener("click", () => openForm({ item }));
      body.querySelector('[data-action="duplicate"]').addEventListener("click", () => openForm({ item, duplicate: true }));
      body.querySelector('[data-action="delete"]').addEventListener("click", () => removeTransaction(item.id));
      body.querySelector("[data-receipt]")?.addEventListener("click", (event) => {
        event.currentTarget.remove();
        showReceipt(item, body.querySelector("[data-receipt-holder]"));
      });
    },
    { detent: "half" }
  );
}

/* --- Form --- */

/* Menerima "25000+15000" dan pemisah ribuan sesuai bahasa aktif. */
function evaluateAmount(text) {
  const parts = String(text).replace(/\s/g, "").match(/[+-]?[^+-]+/g);
  if (!parts) return null;
  let total = 0;
  for (const part of parts) {
    const negative = part.startsWith("-");
    const value = parseAmount(part.replace(/^[+-]/, ""));
    if (value === null) return null;
    total += negative ? -value : value;
  }
  return total;
}

function choiceButton(key, value, label, icon, color, selected) {
  return `
    <button type="button" class="choice" data-${key}="${escapeHtml(value)}" aria-pressed="${selected}">
      ${tile(icon, color, "sm")}<span>${escapeHtml(label)}</span>
    </button>`;
}

function renderChoices(form, draft) {
  const fundChoices = (key, selected) =>
    getFunds()
      .filter((fund) => fund.active || fund.id === selected)
      .map((fund) => choiceButton(key, fund.id, fund.name, fund.icon, fund.color, fund.id === selected))
      .join("");

  const isTransfer = draft.type === "TRANSFER";
  const parents = getCategories(draft.type).filter((category) => !category.parentId && (category.active || category.id === draft.category));
  const children = getCategories(draft.type).filter((category) => category.parentId && category.parentId === draft.category && (category.active || category.id === draft.subCategory));
  const categories = isTransfer
    ? ""
    : `
      <div class="section">
        <h3 class="list__header">${escapeHtml(t("tx.category"))}</h3>
        <div class="choice-grid">${parents.map((category) => choiceButton("category", category.id, localizedName(category), category.icon, category.color, category.id === draft.category)).join("")}</div>
      </div>
      ${
        children.length
          ? `<div class="section">
              <h3 class="list__header">${escapeHtml(t("cat.sub"))}</h3>
              <div class="chips chips--wrap">
                <button type="button" class="chip" data-sub-category="" aria-pressed="${!draft.subCategory}">${escapeHtml(t("cat.sub_none"))}</button>
                ${children.map((category) => `<button type="button" class="chip" data-sub-category="${escapeHtml(category.id)}" aria-pressed="${draft.subCategory === category.id}">${escapeHtml(localizedName(category))}</button>`).join("")}
              </div>
            </div>`
          : ""
      }`;

  form.querySelector("[data-choices]").innerHTML = `
    ${categories}
    <div class="section">
      <h3 class="list__header">${escapeHtml(isTransfer ? t("tx.from_fund") : t("tx.fund"))}</h3>
      <div class="choice-grid">${fundChoices("fund", draft.fund)}</div>
    </div>
    ${
      isTransfer
        ? `<div class="section">
            <h3 class="list__header">${escapeHtml(t("tx.to_fund"))}</h3>
            <div class="choice-grid">${fundChoices("to-fund", draft.toFund)}</div>
          </div>`
        : ""
    }`;
}

function validate(draft) {
  if (!draft.amount || draft.amount <= 0) return "tx.error_amount";
  if (!draft.name) return "tx.error_name";
  if (!draft.date) return "tx.error_date";
  if (draft.type !== "TRANSFER" && !draft.category) return "tx.error_category";
  if (!draft.fund) return "tx.error_fund";
  if (draft.type === "TRANSFER" && (!draft.toFund || draft.toFund === draft.fund)) return "tx.error_transfer";
  return null;
}

function photoPreview(photo) {
  if (!photo) return `<label class="btn btn--secondary btn--block">${glyph("camera")}<span>${escapeHtml(t("tx.attach_photo"))}</span><input type="file" accept="image/*,.heic,.heif" class="visually-hidden" data-photo-input /></label>`;
  return `
    <div class="attached-photo">
      <img src="${imageDataUrl(photo)}" alt="${escapeHtml(t("scan.photo_alt"))}" />
      <button type="button" class="btn btn--secondary" data-photo-remove>${glyph("x")}<span>${escapeHtml(t("tx.remove_photo"))}</span></button>
    </div>`;
}

/* Satu form untuk tambah, ubah, dan duplikat. photo: foto struk yang sudah disiapkan. */
export function openForm({ item, duplicate = false, defaults = {}, photo = null } = {}) {
  const editing = Boolean(item) && !duplicate;
  const now = new Date();
  const draft = {
    type: "OUT",
    amount: 0,
    name: "",
    category: "",
    subCategory: "",
    fund: getFunds().find((fund) => fund.active)?.id ?? "",
    toFund: "",
    date: context.today,
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    note: "",
    ...item,
    ...defaults,
    id: editing ? item.id : createId(),
  };
  if (duplicate) {
    draft.date = context.today;
    draft.receiptLink = "";
    draft.referenceNo = "";
    draft.scheduleId = "";
    draft.scheduleDueDate = "";
    draft.inputMethod = "MANUAL";
  }
  let attached = photo;

  const title = editing ? t("tx.edit") : duplicate ? t("tx.duplicate") : t("tx.new");
  const names = [...new Set(getTransactions().map((entry) => entry.name))].slice(0, 200);

  showSheet((body) => {
    body.innerHTML = `
      ${sheetHeader({
        title,
        leading: `<button type="button" class="btn-plain" data-sheet-dismiss>${escapeHtml(t("common.cancel"))}</button>`,
        trailing: `<button type="button" class="btn-plain btn-plain--strong" data-save>${escapeHtml(t("common.save"))}</button>`,
      })}
      <form class="sheet__body" novalidate>
        ${segmented({ name: "tx-type", label: t("tx.type"), value: draft.type, options: ["IN", "OUT", "TRANSFER"].map((value) => ({ value, label: t(`enum.${value}`) })) })}

        <div class="amount-input">
          <span class="amount-input__prefix" aria-hidden="true">Rp</span>
          <input type="text" inputmode="numeric" autocomplete="off" placeholder="0" name="amount" aria-label="${escapeHtml(t("tx.amount"))}" value="${draft.amount ? escapeHtml(formatNumber(draft.amount)) : ""}" />
        </div>

        <div class="form-group">
          <label class="form-row">
            <span class="form-row__label">${escapeHtml(t("tx.name"))}</span>
            <input type="text" name="name" list="tx-names" autocomplete="off" value="${escapeHtml(draft.name)}" placeholder="${escapeHtml(t("tx.name_placeholder"))}" />
            <datalist id="tx-names">${names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
          </label>
          <label class="form-row">
            <span class="form-row__label">${escapeHtml(t("tx.date"))}</span>
            <input type="date" name="date" value="${escapeHtml(draft.date)}" lang="${getLanguage()}" />
          </label>
          <label class="form-row">
            <span class="form-row__label">${escapeHtml(t("tx.time"))}</span>
            <input type="time" name="time" value="${escapeHtml(draft.time)}" />
          </label>
          <label class="form-row">
            <span class="form-row__label">${escapeHtml(t("tx.note"))}</span>
            <input type="text" name="note" value="${escapeHtml(draft.note)}" placeholder="${escapeHtml(t("tx.note_placeholder"))}" />
          </label>
          <label class="form-row">
            <span class="form-row__label">${escapeHtml(t("tx.tags"))}</span>
            <input type="text" name="tags" value="${escapeHtml(draft.tags ?? "")}" placeholder="${escapeHtml(t("tx.tags_placeholder"))}" />
          </label>
        </div>

        <p class="form-error" role="alert" data-error></p>
        <div class="section" data-choices style="gap:var(--s-4)"></div>
        ${editing && draft.receiptLink ? "" : `<div data-photo>${photoPreview(attached)}</div>`}
      </form>`;

    const form = body.querySelector("form");
    const amountInput = form.elements.amount;
    const error = form.querySelector("[data-error]");
    renderChoices(form, draft);

    body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);

    bindSegmented(form, "tx-type", (type) => {
      draft.type = type;
      if (categoryOrFallback(draft.category).type !== type) {
        draft.category = "";
        draft.subCategory = "";
      }
      if (type !== "TRANSFER") draft.toFund = "";
      renderChoices(form, draft);
    });

    /* Saat ada + atau -, isian dibiarkan apa adanya untuk kalkulator; hasilnya dihitung saat keluar dari isian. */
    bindAmountInput(amountInput, { skip: (value) => /[+-]/.test(value) });
    amountInput.addEventListener("blur", () => {
      const value = evaluateAmount(amountInput.value);
      if (value !== null) amountInput.value = formatNumber(value);
    });

    const bindPhoto = () => {
      const holder = form.querySelector("[data-photo]");
      if (!holder) return;
      holder.querySelector("[data-photo-input]")?.addEventListener("change", async (event) => {
        const [file] = event.target.files;
        if (!file || !isImageFile(file)) return;
        try {
          attached = await exportImage(await openImage(file));
        } catch {
          toast(t("scan.not_image"));
          return;
        }
        holder.innerHTML = photoPreview(attached);
        bindPhoto();
      });
      holder.querySelector("[data-photo-remove]")?.addEventListener("click", () => {
        attached = null;
        holder.innerHTML = photoPreview(null);
        bindPhoto();
      });
    };
    bindPhoto();

    form.addEventListener("click", (event) => {
      const button = event.target.closest(".choice, [data-sub-category]");
      if (!button) return;
      const { category, fund, toFund, subCategory } = button.dataset;
      if (category) {
        draft.category = category;
        draft.subCategory = "";
      }
      if (subCategory !== undefined) draft.subCategory = subCategory;
      if (fund) draft.fund = fund;
      if (toFund) draft.toFund = toFund;
      renderChoices(form, draft);
      haptic();
    });

    const submit = () => {
      Object.assign(draft, {
        amount: evaluateAmount(amountInput.value),
        name: form.elements.name.value.trim(),
        date: form.elements.date.value,
        time: form.elements.time.value || "00:00",
        note: form.elements.note.value.trim(),
        tags: form.elements.tags.value.trim(),
      });
      if (draft.type === "TRANSFER") {
        draft.category = "";
        draft.subCategory = "";
      }
      const problem = validate(draft);
      error.textContent = problem ? t(problem) : "";
      if (problem) {
        replayAnimation(error);
        error.scrollIntoView({ block: "center" });
        return;
      }
      flash(draft.id);
      const saved = saveTransaction({ ...draft });
      if (attached && !isDemoMode()) enqueuePhoto(saved.id, attached);
      closeSheet();
      toast(editing ? t("tx.updated") : t("tx.saved"));
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    body.querySelector("[data-save]").addEventListener("click", submit);
  });
}
