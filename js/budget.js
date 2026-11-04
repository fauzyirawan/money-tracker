/* budget.js: halaman Budget. Budget berlaku per kategori pengeluaran utama dan dihitung
   per siklus bulanan (mulai tanggal gajian di Pengaturan). Sub-kategori ikut dihitung
   ke kategori induknya, karena transaksi menyimpan kategori induk. */

import { ApiError } from "./api.js";
import { t, tError, formatCurrency, formatDate, formatNumber, localizedName, parseAmount } from "./i18n.js";
import { getCategories, getTransactions, saveCategory } from "./store.js";
import { addDays, cycleBounds, expenseTotals, safeDailySpend } from "./stats.js";
import { glyph, tile } from "./icons.js";
import { bindAmountInput, closeSheet, escapeHtml, haptic, replayAnimation, sheetHeader, showSheet, toast } from "./ui.js";

const AVERAGE_CYCLES = 3;
const NEAR_PERCENT = 75;

let context = { today: "", cycleDay: 1 };

/* Kategori pengeluaran utama yang aktif. */
function budgetCategories() {
  return getCategories("OUT").filter((category) => category.active && !category.parentId);
}

/* Pengeluaran per kategori di siklus ini dan rata-rata tiga siklus sebelumnya. */
function spending(transactions) {
  const current = cycleBounds(context.today, context.cycleDay);
  const now = expenseTotals(transactions, current.from, context.today);
  const past = [];
  let bounds = current;
  for (let offset = 1; offset <= AVERAGE_CYCLES; offset += 1) {
    bounds = cycleBounds(addDays(bounds.from, -1), context.cycleDay);
    past.push(expenseTotals(transactions, bounds.from, bounds.to));
  }
  const average = (id) => Math.round(past.reduce((sum, totals) => sum + (totals.get(id) ?? 0), 0) / AVERAGE_CYCLES);
  const last = (id) => past[0].get(id) ?? 0;
  return { current, used: (id) => now.get(id) ?? 0, average, last };
}

function tone(percent) {
  if (percent > 100) return "critical";
  return percent >= NEAR_PERCENT ? "warning" : "positive";
}

function fillColor(percent) {
  if (percent > 100) return "var(--expense)";
  return percent >= NEAR_PERCENT ? "var(--warning)" : "var(--income)";
}

function summaryCard(items, current) {
  const total = items.reduce((sum, item) => sum + item.limit, 0);
  const used = items.reduce((sum, item) => sum + item.used, 0);
  const percent = total ? (used / total) * 100 : 0;
  const over = items.filter((item) => item.used > item.limit).length;
  const safe = safeDailySpend(items, context.today, context.cycleDay);
  const remaining = total - used;
  return `
    <section class="budget-summary budget-summary--${tone(percent)}">
      <div class="budget-summary__head">
        <span>
          <span class="field__label">${escapeHtml(t("budget.this_cycle"))}</span>
          <span class="budget-summary__range">${escapeHtml(`${formatDate(current.from, "short")} - ${formatDate(current.to, "short")}`)}</span>
        </span>
        ${over ? `<span class="pill pill--critical">${escapeHtml(t("budget.over_count", { count: over }))}</span>` : `<span class="pill pill--positive">${escapeHtml(t("budget.all_safe"))}</span>`}
      </div>
      <div class="budget-summary__figures">
        <div>
          <span class="budget-summary__label">${escapeHtml(t("budget.used"))}</span>
          <span class="budget-summary__value tabular">${escapeHtml(formatCurrency(used))}</span>
          <span class="budget-summary__label">${escapeHtml(t("budget.of_total", { amount: formatCurrency(total) }))}</span>
        </div>
        <div class="budget-summary__side">
          <span class="budget-summary__label">${escapeHtml(t(remaining >= 0 ? "budget.remaining" : "budget.over_total"))}</span>
          <span class="budget-summary__value tabular ${remaining >= 0 ? "" : "text-expense"}">${escapeHtml(formatCurrency(Math.abs(remaining)))}</span>
          <span class="budget-summary__label">${escapeHtml(t("budget.days_left", { count: safe.daysLeft }))}</span>
        </div>
      </div>
      <span class="budget__bar budget-summary__bar"><span class="budget__fill" style="--_percent:${Math.min(percent, 100)}%;--_fill:${fillColor(percent)}"></span></span>
      <p class="budget-summary__note">${glyph("lightbulb")}<span>${escapeHtml(t("dashboard.safe_daily", { amount: formatCurrency(safe.perDay) }))}</span></p>
    </section>`;
}

function budgetCard({ category, used, limit, percent }, index) {
  const remaining = limit - used;
  const state = tone(percent);
  return `
    <button type="button" class="budget-card budget-card--${state}" style="--i:${index}" data-budget="${escapeHtml(category.id)}">
      <span class="budget-card__head">
        ${tile(category.icon, category.color, "md")}
        <span class="budget-card__name">${escapeHtml(localizedName(category))}</span>
      </span>
      <span class="budget-card__figure">
        <span class="budget-card__used tabular">${escapeHtml(formatCurrency(used))}</span>
        <span class="budget-card__limit">${escapeHtml(t("budget.of_total", { amount: formatCurrency(limit) }))}</span>
      </span>
      <span class="budget__bar"><span class="budget__fill" style="--_percent:${Math.min(percent, 100)}%;--_fill:${fillColor(percent)}"></span></span>
      <span class="budget-card__foot">
        <span class="budget-card__note tabular">${escapeHtml(remaining >= 0 ? t("dashboard.budget_left", { amount: formatCurrency(remaining) }) : t("dashboard.budget_over", { amount: formatCurrency(-remaining) }))}</span>
        <span class="budget-card__percent tabular">${escapeHtml(`${Math.round(percent)}%`)}</span>
      </span>
    </button>`;
}

function unbudgetedRow(category, average) {
  return `
    <button type="button" class="row" data-budget="${escapeHtml(category.id)}">
      ${tile(category.icon, category.color, "md")}
      <span class="row__body">
        <span class="row__title">${escapeHtml(localizedName(category))}</span>
        <span class="row__meta">${escapeHtml(average ? t("budget.average_value", { amount: formatCurrency(average) }) : t("budget.no_spending"))}</span>
      </span>
      <span class="btn btn--secondary btn--small">${glyph("plus")}<span>${escapeHtml(t("budget.set"))}</span></span>
    </button>`;
}

export function renderBudget(root, options = {}) {
  context = { ...context, ...options };
  const numbers = spending(getTransactions());
  const categories = budgetCategories();
  const items = categories
    .filter((category) => category.budget > 0)
    .map((category) => {
      const used = numbers.used(category.id);
      return { category, used, limit: category.budget, percent: (used / category.budget) * 100 };
    })
    .sort((a, b) => b.percent - a.percent);
  const without = categories.filter((category) => !(category.budget > 0)).sort((a, b) => numbers.average(b.id) - numbers.average(a.id));

  const budgeted = items.length
    ? `${summaryCard(items, numbers.current)}
       <section class="section">
         <h2 class="t-headline section__title">${escapeHtml(t("budget.with_budget"))}</h2>
         <div class="budget-grid">${items.map(budgetCard).join("")}</div>
       </section>`
    : `<div class="list empty-state">
         ${glyph("piggy-bank")}
         <p class="t-headline">${escapeHtml(t("budget.empty_title"))}</p>
         <p class="t-footnote">${escapeHtml(t("budget.empty_body"))}</p>
       </div>`;

  root.innerHTML = `
    <div class="view">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.budget"))}</h1>
      <p class="t-footnote text-2">${escapeHtml(t("budget.intro"))}</p>
      ${budgeted}
      ${
        without.length
          ? `<section class="section">
               <h2 class="t-headline section__title">${escapeHtml(t("budget.without_budget"))}</h2>
               <div class="list">${without.map((category) => unbudgetedRow(category, numbers.average(category.id))).join("")}</div>
             </section>`
          : ""
      }
    </div>`;

  root.querySelector(".view").addEventListener("click", (event) => {
    const button = event.target.closest("[data-budget]");
    if (!button) return;
    const category = categories.find((item) => item.id === button.dataset.budget);
    if (category) openBudgetEditor(category, { onSaved: () => renderBudget(root, context) });
  });
}

/* Lembar untuk mengatur budget satu kategori, dengan saran dari pengeluaran sebelumnya. */
export function openBudgetEditor(category, { onSaved } = {}) {
  const numbers = spending(getTransactions());
  const average = numbers.average(category.id);
  const last = numbers.last(category.id);
  const used = numbers.used(category.id);
  const suggestions = [
    { key: "budget.suggest_average", amount: average },
    { key: "budget.suggest_last", amount: last },
  ].filter((item, index, list) => item.amount > 0 && list.findIndex((other) => other.amount === item.amount) === index);

  showSheet(
    (body) => {
      body.innerHTML = `
        ${sheetHeader({
          title: localizedName(category),
          leading: `<button type="button" class="btn-plain" data-sheet-dismiss>${escapeHtml(t("common.cancel"))}</button>`,
          trailing: `<button type="button" class="btn-plain btn-plain--strong" data-save>${escapeHtml(t("common.save"))}</button>`,
        })}
        <form class="sheet__body" novalidate>
          <div class="budget-editor__head">
            ${tile(category.icon, category.color, "lg")}
            <p class="t-subhead text-2">${escapeHtml(t("budget.editor_help"))}</p>
          </div>
          <div class="amount-input">
            <span class="amount-input__prefix" aria-hidden="true">Rp</span>
            <input type="text" inputmode="numeric" autocomplete="off" placeholder="0" name="budget" aria-label="${escapeHtml(t("budget.amount_label"))}" value="${category.budget ? escapeHtml(formatNumber(category.budget)) : ""}" />
          </div>
          ${
            suggestions.length
              ? `<div class="chips chips--wrap budget-editor__suggestions">
                   ${suggestions.map((item) => `<button type="button" class="chip" data-suggest="${item.amount}">${escapeHtml(t(item.key, { amount: formatCurrency(item.amount) }))}</button>`).join("")}
                 </div>`
              : ""
          }
          <div class="list">
            <div class="row row--static"><span class="row__body">${escapeHtml(t("budget.used_this_cycle"))}</span><span class="row__amount">${escapeHtml(formatCurrency(used))}</span></div>
            <div class="row row--static"><span class="row__body">${escapeHtml(t("budget.average_3"))}</span><span class="row__amount">${escapeHtml(formatCurrency(average))}</span></div>
          </div>
          <p class="form-error" role="alert" data-error></p>
          ${category.budget > 0 ? `<button type="button" class="btn btn--destructive btn--block" data-remove>${glyph("trash-2")}<span>${escapeHtml(t("budget.remove"))}</span></button>` : ""}
        </form>`;

      const form = body.querySelector("form");
      const input = form.elements.budget;
      const error = form.querySelector("[data-error]");
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);

      bindAmountInput(input);
      form.querySelectorAll("[data-suggest]").forEach((button) => {
        button.addEventListener("click", () => {
          input.value = formatNumber(Number(button.dataset.suggest));
          haptic();
          replayAnimation(input);
        });
      });

      const save = async (budget) => {
        body.querySelectorAll("[data-save], [data-remove]").forEach((button) => (button.disabled = true));
        try {
          await saveCategory({ ...category, budget });
          closeSheet();
          toast(t(budget ? "budget.saved" : "budget.removed"));
          onSaved?.();
        } catch (failure) {
          error.textContent = tError(failure instanceof ApiError ? failure.code : "INTERNAL_ERROR");
          body.querySelectorAll("[data-save], [data-remove]").forEach((button) => (button.disabled = false));
        }
      };

      const submit = () => {
        const amount = parseAmount(input.value) ?? 0;
        if (amount <= 0) {
          error.textContent = t("budget.error_amount");
          replayAnimation(error);
          return;
        }
        save(amount);
      };
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
      });
      body.querySelector("[data-save]").addEventListener("click", submit);
      body.querySelector("[data-remove]")?.addEventListener("click", () => save(0));
    },
    { detent: "full" }
  );
}
