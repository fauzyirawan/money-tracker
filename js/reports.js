/* reports.js: laporan bulanan dan ekspor CSV, Excel, PDF.
   Judul dan header kolom mengikuti bahasa aktif. Data lebih lama dari salinan di
   perangkat diambil dari backend. */

import { ApiError, api, isDemoMode } from "./api.js";
import { t, tError, formatCurrency, formatDate, formatPercent, getLanguage, localizedName } from "./i18n.js";
import { categoryOrFallback, fundOrFallback, getFunds, getMeta, getTransactions } from "./store.js";
import * as stats from "./stats.js";
import { glyph, tile } from "./icons.js";
import { closeSheet, escapeHtml, sheetHeader, showSheet, toast } from "./ui.js";
import { downloadBlob, loadScript, safeFileName } from "./utils.js";

const XLSX_LIBRARY = "vendor/xlsx-0.18.5.mini.min.js";
const PDF_LIBRARY = "vendor/jspdf-2.5.2.umd.min.js";
const PDF_TABLE_LIBRARY = "vendor/jspdf-autotable-3.8.4.min.js";

const view = { monthOffset: 0 };
const remoteMonths = new Map();
let context = { today: "" };

/* --- Data --- */

function monthRange(offset) {
  const from = stats.shiftMonth(context.today, offset);
  const end = stats.monthEnd(from);
  return { from, to: end > context.today ? context.today : end };
}

/* Bulan yang tidak tersimpan di perangkat diambil sekali dari backend. */
async function rowsFor(range) {
  const meta = getMeta();
  if (isDemoMode() || !meta.from || range.from >= meta.from) {
    return getTransactions().filter((row) => row.date >= range.from && row.date <= range.to);
  }
  const key = `${range.from}|${range.to}`;
  if (!remoteMonths.has(key)) {
    const { data } = await api("reports.range", range);
    remoteMonths.set(key, data.rows);
  }
  return remoteMonths.get(key);
}

function categoryLabel(row) {
  return row.type === "TRANSFER" ? t("enum.TRANSFER") : localizedName(categoryOrFallback(row.category));
}

function byCategory(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    if (row.type === "TRANSFER") return;
    const key = `${row.type}|${row.category}`;
    totals.set(key, (totals.get(key) ?? 0) + row.amount);
  });
  return [...totals]
    .map(([key, amount]) => {
      const [type, category] = key.split("|");
      return { type, category, amount };
    })
    .sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === "IN" ? -1 : 1));
}

function byFund(rows) {
  return getFunds()
    .map((fund) => {
      let income = 0;
      let expense = 0;
      rows.forEach((row) => {
        if (row.type === "IN" && row.fund === fund.id) income += row.amount;
        if (row.type === "OUT" && row.fund === fund.id) expense += row.amount;
        if (row.type === "TRANSFER" && row.toFund === fund.id) income += row.amount;
        if (row.type === "TRANSFER" && row.fund === fund.id) expense += row.amount;
      });
      return { fund, income, expense };
    })
    .filter((item) => item.income || item.expense);
}

/* --- Halaman --- */

function summaryBlock(summary) {
  const block = (label, value, tone = "") => `<div class="stat"><span class="stat__label">${escapeHtml(label)}</span><span class="stat__value ${tone}">${escapeHtml(value)}</span></div>`;
  return `
    <div class="stats">
      ${block(t("dashboard.total_income"), formatCurrency(summary.income), "text-income")}
      ${block(t("dashboard.total_expense"), formatCurrency(summary.expense))}
      ${block(t("dashboard.net_cashflow"), formatCurrency(summary.net))}
      ${block(t("dashboard.saving_rate"), formatPercent(Math.round(summary.savingRate)))}
    </div>`;
}

function categoryTable(rows, summary) {
  const items = byCategory(rows);
  if (!items.length) return "";
  const body = items
    .map((item) => {
      const category = categoryOrFallback(item.category);
      const total = item.type === "IN" ? summary.income : summary.expense;
      return `
        <div class="row row--static">
          ${tile(category.icon, category.color, "sm")}
          <span class="row__body">
            <span class="row__title">${escapeHtml(localizedName(category))}</span>
            <span class="row__meta">${escapeHtml(t(`enum.${item.type}`))}, ${escapeHtml(formatPercent(Math.round((item.amount / (total || 1)) * 100)))}</span>
          </span>
          <span class="row__amount ${item.type === "IN" ? "text-income" : ""}">${escapeHtml(formatCurrency(item.amount))}</span>
        </div>`;
    })
    .join("");
  return `<section class="section"><h2 class="t-headline section__title">${escapeHtml(t("report.by_category"))}</h2><div class="list">${body}</div></section>`;
}

function fundTable(rows) {
  const items = byFund(rows);
  if (!items.length) return "";
  const body = items
    .map(
      ({ fund, income, expense }) => `
      <div class="row row--static">
        ${tile(fund.icon, fund.color, "sm")}
        <span class="row__body">
          <span class="row__title">${escapeHtml(fund.name)}</span>
          <span class="row__meta">${escapeHtml(t("report.in_out", { income: formatCurrency(income), expense: formatCurrency(expense) }))}</span>
        </span>
        <span class="row__amount">${escapeHtml(formatCurrency(income - expense, { signed: true }))}</span>
      </div>`
    )
    .join("");
  return `<section class="section"><h2 class="t-headline section__title">${escapeHtml(t("report.by_fund"))}</h2><div class="list">${body}</div></section>`;
}

/* Tanggal hari ini dipakai juga oleh ekspor dari bilah atas, sebelum halaman Laporan pernah dibuka. */
export function setReportToday(today) {
  context = { ...context, today };
}

export async function renderReports(root, options) {
  context = { ...context, ...options };
  const range = monthRange(view.monthOffset);
  const title = formatDate(range.from, "monthYear");
  const sheetUrl = getMeta().spreadsheetUrl;

  root.innerHTML = `
    <div class="view view--narrow">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.reports"))}</h1>
      <div class="panel">
        <div class="heat__nav">
          <button type="button" class="btn-round" data-month-step="-1" aria-label="${escapeHtml(t("dashboard.month_previous"))}">${glyph("chevron-left")}</button>
          <span class="t-headline" aria-live="polite">${escapeHtml(title)}</span>
          <button type="button" class="btn-round" data-month-step="1" aria-label="${escapeHtml(t("dashboard.month_next"))}" ${view.monthOffset >= 0 ? "disabled" : ""}>${glyph("chevron-right")}</button>
        </div>
      </div>
      <div data-report-body><p class="t-footnote text-2">${escapeHtml(t("common.loading"))}</p></div>
      <div class="button-row button-row--start">
        <button type="button" class="btn btn--secondary" data-export="csv">${glyph("download")}<span>CSV</span></button>
        <button type="button" class="btn btn--secondary" data-export="xlsx">${glyph("download")}<span>Excel</span></button>
        <button type="button" class="btn btn--secondary" data-export="pdf">${glyph("download")}<span>PDF</span></button>
        ${sheetUrl ? `<a class="btn btn--secondary" href="${escapeHtml(sheetUrl)}" target="_blank" rel="noopener">${glyph("chart-line")}<span>${escapeHtml(t("report.open_sheets"))}</span></a>` : ""}
      </div>
    </div>`;

  root.querySelectorAll("[data-month-step]").forEach((button) => {
    button.addEventListener("click", () => {
      view.monthOffset += Number(button.dataset.monthStep);
      renderReports(root, context);
    });
  });

  let rows;
  try {
    rows = await rowsFor(range);
  } catch (error) {
    root.querySelector("[data-report-body]").innerHTML = `<p class="form-error">${escapeHtml(tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR"))}</p>`;
    return;
  }
  const summary = stats.summarize(rows, range.from, range.to);
  root.querySelector("[data-report-body]").innerHTML = rows.length
    ? `${summaryBlock(summary)}${categoryTable(rows, summary)}${fundTable(rows)}`
    : `<div class="list empty-state">${glyph("chart-pie")}<p class="t-headline">${escapeHtml(t("report.empty"))}</p></div>`;

  root.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", () => exportRows(rows, range, button.dataset.export));
  });
}

/* --- Ekspor --- */

const HEADER_KEYS = ["tx.date", "tx.time", "tx.type", "tx.name", "tx.category", "tx.from_fund", "tx.to_fund", "tx.amount", "scan.merchant", "tx.note"];

function exportTable(rows) {
  const sorted = [...rows].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return sorted.map((row) => [row.date, row.time, t(`enum.${row.type}`), row.name, categoryLabel(row), fundOrFallback(row.fund).name, row.toFund ? fundOrFallback(row.toFund).name : "", row.amount, row.merchant ?? "", row.note ?? ""]);
}

function reportTitle(range) {
  return t("report.title", { from: formatDate(range.from, "short"), to: formatDate(range.to, "short") });
}

function exportName(range, extension) {
  return `${safeFileName(`money-tracker_${range.from}_${range.to}_${getLanguage()}`)}.${extension}`;
}

/* Isi sel yang diawali = + - @ diberi tanda kutip agar tidak terbaca sebagai rumus. */
function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportCsv(rows, range) {
  const lines = [HEADER_KEYS.map(t), ...exportTable(rows)].map((line) => line.map(csvCell).join(","));
  downloadBlob(new Blob(["﻿", lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), exportName(range, "csv"));
}

async function exportXlsx(rows, range) {
  await loadScript(XLSX_LIBRARY);
  const XLSX = window.XLSX;
  const summary = stats.summarize(rows, range.from, range.to);
  const book = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet([
    [reportTitle(range)],
    [],
    [t("dashboard.total_income"), summary.income],
    [t("dashboard.total_expense"), summary.expense],
    [t("dashboard.net_cashflow"), summary.net],
    [t("dashboard.saving_rate"), Math.round(summary.savingRate) / 100],
    [],
    [t("report.by_category"), t("tx.type"), t("tx.amount")],
    ...byCategory(rows).map((item) => [localizedName(categoryOrFallback(item.category)), t(`enum.${item.type}`), item.amount]),
  ]);
  const data = exportTable(rows).map((line) => line.map((cell) => (typeof cell === "string" && /^[=+\-@]/.test(cell) ? `'${cell}` : cell)));
  const transactionSheet = XLSX.utils.aoa_to_sheet([HEADER_KEYS.map(t), ...data]);
  transactionSheet["!cols"] = [{ wch: 11 }, { wch: 6 }, { wch: 10 }, { wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(book, summarySheet, t("report.sheet_summary").slice(0, 31));
  XLSX.utils.book_append_sheet(book, transactionSheet, t("nav.transactions").slice(0, 31));
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" });
  downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), exportName(range, "xlsx"));
}

/* Font bawaan PDF tidak punya tanda minus khusus dan spasi tak terputus. */
function pdfText(value) {
  return String(value).replace(/−/g, "-").replace(/ /g, " ");
}

async function exportPdf(rows, range) {
  await loadScript(PDF_LIBRARY);
  await loadScript(PDF_TABLE_LIBRARY);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const summary = stats.summarize(rows, range.from, range.to);
  pdf.setFontSize(16);
  pdf.text(pdfText(reportTitle(range)), 40, 48);
  pdf.setFontSize(10);
  pdf.text(pdfText(t("report.generated", { date: formatDate(context.today, "long") })), 40, 66);

  pdf.autoTable({
    startY: 84,
    head: [[pdfText(t("report.sheet_summary")), ""]],
    body: [
      [t("dashboard.total_income"), formatCurrency(summary.income)],
      [t("dashboard.total_expense"), formatCurrency(summary.expense)],
      [t("dashboard.net_cashflow"), formatCurrency(summary.net)],
      [t("dashboard.saving_rate"), formatPercent(Math.round(summary.savingRate))],
    ].map((line) => line.map(pdfText)),
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });
  pdf.autoTable({
    head: [[t("report.by_category"), t("tx.type"), t("tx.amount")].map(pdfText)],
    body: byCategory(rows).map((item) => [localizedName(categoryOrFallback(item.category)), t(`enum.${item.type}`), formatCurrency(item.amount)].map(pdfText)),
    theme: "grid",
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 2: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });
  pdf.autoTable({
    head: [["tx.date", "tx.name", "tx.category", "tx.fund", "tx.amount"].map((key) => pdfText(t(key)))],
    body: exportTable(rows).map((line) => [formatDate(line[0], "short"), line[3], line[4], line[5], formatCurrency(line[7])].map(pdfText)),
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 4: { halign: "right" } },
    styles: { fontSize: 8 },
    margin: { left: 40, right: 40 },
  });
  downloadBlob(pdf.output("blob"), exportName(range, "pdf"));
}

export async function exportRows(rows, range, format) {
  try {
    if (format === "csv") exportCsv(rows, range);
    if (format === "xlsx") await exportXlsx(rows, range);
    if (format === "pdf") await exportPdf(rows, range);
    toast(t("common.exported", { count: rows.length }));
  } catch (error) {
    console.error("[export]", error);
    toast(tError(navigator.onLine ? "INTERNAL_ERROR" : "OFFLINE"));
  }
}

/* Tombol Ekspor di bilah atas: memilih format untuk rentang di dashboard. */
export function openExportChooser(range, filter) {
  const rows = getTransactions().filter((row) => row.date >= range.from && row.date <= range.to && filter(row));
  showSheet(
    (body) => {
      body.innerHTML = `
        ${sheetHeader({ title: t("common.export") })}
        <div class="sheet__body">
          <p class="t-subhead text-2">${escapeHtml(reportTitle(range))}, ${escapeHtml(t("tx.count", { count: rows.length }))}</p>
          <div class="list">
            ${[["csv", "report.format_csv"], ["xlsx", "report.format_xlsx"], ["pdf", "report.format_pdf"]]
              .map(([format, label]) => `<button type="button" class="row" data-format="${format}">${glyph("download")}<span class="row__body">${escapeHtml(t(label))}</span>${glyph("chevron-right", "icon row__chevron")}</button>`)
              .join("")}
          </div>
        </div>`;
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
      body.querySelectorAll("[data-format]").forEach((button) => {
        button.addEventListener("click", async () => {
          closeSheet();
          await exportRows(rows, range, button.dataset.format);
        });
      });
    },
    { detent: "half" }
  );
}
