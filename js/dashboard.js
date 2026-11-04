/* dashboard.js: halaman Beranda untuk memantau keuangan.
   Urutannya: filter, skor kesehatan, temuan utama, lalu grafik.
   Semua angka dari stats.js, semua grafik dari charts.js. */

import { t, formatCompact, formatCurrency, formatDate, formatNumber, formatPercent, localizedName, monthNames, weekdayNames } from "./i18n.js";
import { categoryOrFallback, fundOrFallback, getCategories, getFunds, getSchedules, getTransactions } from "./store.js";
import * as stats from "./stats.js";
import { balanceChart, cashflowChart, categoryDonut, compareChart, destroyCharts } from "./charts.js";
import { glyph, tile } from "./icons.js";
import { animateNumbers, cancelNumber, escapeHtml } from "./ui.js";

const PERIODS = ["week", "month", "quarter", "year"];
const UPCOMING_DAYS = 7;
const SEVERITY_ICONS = { critical: "triangle-alert", warning: "eye", info: "info", positive: "circle-check" };

/* Bulan yang ditampilkan kalender, dihitung mundur dari bulan ini. */
let heatOffset = 0;

/* Format angka yang menghitung naik, dipilih lewat atribut data-count-format. */
const NUMBER_FORMATS = {
  money: (value) => formatCurrency(value),
  percent: (value) => formatPercent(Math.round(value)),
  int: (value) => formatNumber(Math.round(value)),
  findingPercent: (value) => findingValue({ type: "percent", amount: value }),
  findingMonths: (value) => findingValue({ type: "months", amount: value }),
};

function countAttributes(key, value, format) {
  return `data-count-key="${escapeHtml(key)}" data-count="${value}" data-count-format="${format}"`;
}

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function scoreColor(score) {
  if (score >= 80) return "var(--income)";
  return score >= 60 ? "var(--warning)" : "var(--expense)";
}

/* --- Filter --- */

function selectField(label, name, value, options) {
  const items = options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
  return `
    <label class="field">
      <span class="field__label">${escapeHtml(label)}</span>
      <select class="field__control" name="${name}">${items}</select>
    </label>`;
}

function filterCard({ period, fund, category, range }) {
  const funds = [{ value: "", label: t("dashboard.all_funds") }, ...getFunds().filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))];
  const categories = [{ value: "", label: t("dashboard.all_categories") }, ...getCategories("OUT").filter((item) => item.active).map((item) => ({ value: item.id, label: localizedName(item) }))];
  const chip = (value, label, badge) => `
    <button type="button" class="period" data-period="${value}" aria-pressed="${value === period}">${escapeHtml(label)}${value === period ? `<span class="period__badge">${escapeHtml(badge)}</span>` : ""}</button>`;
  const chips = PERIODS.map((value) => chip(value, t(`period.${value}`), t(`period.badge_${value}`))).join("");
  const customChip = chip("custom", t("period.custom"), t("period.badge_custom", { count: stats.daysBetween(range.from, range.to) + 1 }));

  return `
    <section class="filters">
      <div class="filters__fields">
        ${selectField(t("tx.fund"), "filter-fund", fund, funds)}
        ${selectField(t("tx.category"), "filter-category", category, categories)}
        <div class="field field--range">
          <span class="field__label" id="range-label">${escapeHtml(t("dashboard.range"))}</span>
          <button type="button" class="field__control field__button" data-open-range aria-labelledby="range-label range-value" aria-haspopup="dialog">
            <span id="range-value">${escapeHtml(`${formatDate(range.from, "short")} - ${formatDate(range.to, "short")}`)}</span>
            ${glyph("calendar")}
          </button>
        </div>
      </div>
      <div class="filters__row">
        <span class="filters__label">${escapeHtml(t("dashboard.period"))}</span>
        ${chips}${customChip}
      </div>
    </section>`;
}

/* --- Skor kesehatan --- */

function healthEmptyCard() {
  return `
    <section class="health health--empty" aria-label="${escapeHtml(t("health.title"))}">
      <div class="health__main">
        <span class="finding__badge">${glyph("info")}</span>
        <div>
          <h2 class="health__status">${escapeHtml(t("health.empty_title"))}</h2>
          <p class="health__summary">${escapeHtml(t("health.empty_body"))}</p>
        </div>
      </div>
    </section>`;
}

function healthCard(health, items) {
  const color = scoreColor(health.score);
  const count = (severity) => items.filter((item) => item.severity === severity).length;
  const pills = [];
  if (count("critical")) pills.push(["critical", t("health.critical_count", { count: count("critical") })]);
  if (count("warning")) pills.push(["warning", t("health.warning_count", { count: count("warning") })]);
  if (count("positive")) pills.push(["positive", t("health.positive_count", { count: count("positive") })]);
  pills.push(["neutral", t("health.basis")]);
  const pillMarkup = pills.map(([tone, text], index) => `<span class="pill pill--${tone}" style="--i:${index}">${escapeHtml(text)}</span>`).join("");

  const parts = health.parts
    .map(
      (part) => `
      <div class="part">
        <span class="part__name">${escapeHtml(t(`health.part_${part.key}`))}</span>
        <span class="part__bar"><span class="part__fill" style="--_value:${part.score}%;--_color:${scoreColor(part.score)}"></span></span>
        <span class="part__score" ${countAttributes(`part-${part.key}`, part.score, "int")}>${part.score}</span>
      </div>`
    )
    .join("");

  return `
    <section class="health" aria-label="${escapeHtml(t("health.title"))}">
      <div class="health__main">
        <div class="ring" role="img" aria-label="${escapeHtml(t("health.score_label", { score: health.score }))}">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="ring__track" cx="60" cy="60" r="54"></circle>
            <circle class="ring__value" cx="60" cy="60" r="54" style="--_color:${color};--_filled:${(health.score / 100) * 339.3}"></circle>
          </svg>
          <div class="ring__center">
            <span class="ring__score" ${countAttributes("score", health.score, "int")}>${health.score}</span>
            <span class="ring__out-of">${escapeHtml(t("health.out_of"))}</span>
          </div>
        </div>
        <div>
          <h2 class="health__status">${escapeHtml(t(`health.status_${health.status}`))}</h2>
          <p class="health__summary">${escapeHtml(t(`health.summary_${health.status}`, { score: health.score, rate: Math.round(health.facts.savingRate), months: Math.round(health.facts.emergencyMonths * 10) / 10 }))}</p>
          <div class="pill-row">${pillMarkup}</div>
        </div>
      </div>
      <div class="health__parts">${parts}</div>
    </section>`;
}

/* --- Temuan utama --- */

export function sparkline(values) {
  if (values.length < 2) return "";
  const width = 96;
  const height = 40;
  const pad = 3;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values.map((value, index) => [
    pad + (index / (values.length - 1)) * (width - pad * 2),
    height - pad - ((value - min) / span) * (height - pad * 2),
  ]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  const area = `${pad},${height} ${line} ${lastX.toFixed(1)},${height}`;
  return `
    <svg class="spark" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <polygon class="spark__area" points="${area}"></polygon>
      <polyline class="spark__line" points="${line}"></polyline>
      <circle class="spark__end" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.6"></circle>
    </svg>`;
}

function findingValue({ type, amount }) {
  if (type === "percent") return formatPercent(amount >= 100 ? Math.round(amount) : Math.round(amount * 10) / 10);
  if (type === "money") return formatCurrency(amount);
  if (type === "months") return t("finding.months_value", { count: formatNumber(Math.round(amount * 10) / 10) });
  return formatNumber(amount);
}

function findingVars(vars) {
  const output = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key === "category") output.category = localizedName(categoryOrFallback(value));
    else if (key === "fund") output.fund = fundOrFallback(value).name;
    else if (key === "amount" || key === "limit") output[key] = formatCurrency(value);
    else output[key] = value;
  }
  return output;
}

const FINDING_FORMATS = { money: "money", percent: "findingPercent", months: "findingMonths" };

function findingCard(item, index) {
  const vars = findingVars(item.vars);
  return `
    <article class="finding finding--${item.severity}" style="--i:${index}">
      <div class="finding__head">
        <span class="finding__badge">${glyph(SEVERITY_ICONS[item.severity])}</span>
        <span>
          <span class="finding__severity">${escapeHtml(t(`finding.severity_${item.severity}`))}</span>
          <span class="finding__area">${escapeHtml(t(`health.part_${item.area}`))}</span>
        </span>
      </div>
      <h3 class="finding__title">${escapeHtml(t(`finding.${item.key}_title`, vars))}</h3>
      <div class="finding__figure">
        <div>
          <span class="finding__value" ${countAttributes(`finding-${item.key}`, item.value.amount, FINDING_FORMATS[item.value.type])}>${escapeHtml(findingValue(item.value))}</span>
          <span class="finding__label">${escapeHtml(t(`finding.${item.key}_label`, vars))}</span>
        </div>
        ${sparkline(item.spark)}
      </div>
      <p class="finding__body">${escapeHtml(t(`finding.${item.key}_body`, vars))}</p>
    </article>`;
}

/* --- Panel --- */

function changeLabel(current, previous) {
  const change = stats.percentChange(current, previous);
  if (change === null) return `<span class="stat__delta">${escapeHtml(t("dashboard.no_comparison"))}</span>`;
  const icon = change >= 0 ? "arrow-up" : "arrow-down";
  return `<span class="stat__delta">${glyph(icon)}${escapeHtml(formatPercent(Math.round(Math.abs(change) * 10) / 10))}</span>`;
}

function statBlock(key, label, value, format, comparison, tone = "") {
  return `
    <div class="stat">
      <span class="stat__label">${escapeHtml(label)}</span>
      <span class="stat__value ${tone}" ${countAttributes(`stat-${key}`, value, format)}>${escapeHtml(NUMBER_FORMATS[format](value))}</span>
      ${comparison}
    </div>`;
}

function statsStrip(current, previous) {
  return `
    <div class="stats dash__wide">
      ${statBlock("income", t("dashboard.total_income"), current.income, "money", changeLabel(current.income, previous.income), "text-income")}
      ${statBlock("expense", t("dashboard.total_expense"), current.expense, "money", changeLabel(current.expense, previous.expense))}
      ${statBlock("net", t("dashboard.net_cashflow"), current.net, "money", changeLabel(current.net, previous.net))}
      ${statBlock("saving", t("dashboard.saving_rate"), Math.round(current.savingRate), "percent", changeLabel(current.savingRate, previous.savingRate))}
    </div>`;
}

function legend(items) {
  return `<div class="legend">${items
    .map((item) => `<span class="legend__item"><i class="swatch" style="--_color:${item.color}"></i>${escapeHtml(item.label)}</span>`)
    .join("")}</div>`;
}

function panel(title, caption, body, className = "") {
  return `
    <section class="panel ${className}">
      <div class="panel__head">
        <h2 class="t-headline">${escapeHtml(title)}</h2>
        ${caption ? `<span class="panel__caption">${escapeHtml(caption)}</span>` : ""}
      </div>
      ${body}
    </section>`;
}

function categoryRank(breakdown) {
  const rows = breakdown.top.map(({ category, amount }) => {
    const info = categoryOrFallback(category);
    return `
      <button type="button" class="rank__item" data-open-category="${escapeHtml(category)}">
        <i class="swatch" style="--_color:${escapeHtml(info.color)}"></i>
        <span class="rank__name">${escapeHtml(localizedName(info))}</span>
        <span class="rank__amount">${escapeHtml(formatCurrency(amount))}</span>
        <span class="rank__share">${escapeHtml(formatPercent(Math.round((amount / breakdown.total) * 100)))}</span>
      </button>`;
  });
  if (breakdown.rest > 0) {
    rows.push(`
      <div class="rank__item">
        <i class="swatch" style="--_color:${token("--neutral-mark")}"></i>
        <span class="rank__name">${escapeHtml(t("dashboard.other_categories"))}</span>
        <span class="rank__amount">${escapeHtml(formatCurrency(breakdown.rest))}</span>
        <span class="rank__share">${escapeHtml(formatPercent(Math.round((breakdown.rest / breakdown.total) * 100)))}</span>
      </div>`);
  }
  return `<div class="rank">${rows.join("")}</div>`;
}

function fundsPanel(transactions) {
  const balances = stats.fundBalances(transactions, getFunds());
  const rows = getFunds()
    .filter((fund) => fund.active)
    .map(
      (fund) => `
      <button type="button" class="row" data-go="funds">
        ${tile(fund.icon, fund.color, "sm")}
        <span class="row__body">${escapeHtml(fund.name)}</span>
        <span class="row__amount">${escapeHtml(formatCurrency(balances.get(fund.id)))}</span>
        ${glyph("chevron-right", "icon row__chevron")}
      </button>`
    )
    .join("");
  return `
    <section class="section">
      <h2 class="t-headline section__title">${escapeHtml(t("dashboard.funds"))}</h2>
      <div class="list">${rows}</div>
    </section>`;
}

function budgetFill(percent) {
  if (percent > 100) return "var(--expense)";
  return percent >= 75 ? "var(--warning)" : "var(--income)";
}

function budgetPanel(budgets, today, cycleDay) {
  const safe = stats.safeDailySpend(budgets, today, cycleDay);
  const rows = budgets
    .map(({ category, used, limit, percent }) => {
      const remaining = limit - used;
      const note =
        remaining >= 0
          ? `<span class="text-2 tabular">${escapeHtml(t("dashboard.budget_left", { amount: formatCurrency(remaining) }))}</span>`
          : `<span class="text-expense tabular">${escapeHtml(t("dashboard.budget_over", { amount: formatCurrency(-remaining) }))}</span>`;
      return `
        <div class="budget">
          <div class="budget__head"><span>${escapeHtml(localizedName(category))}</span>${note}</div>
          <span class="budget__bar"><span class="budget__fill" style="--_percent:${Math.min(percent, 100)}%;--_fill:${budgetFill(percent)}"></span></span>
        </div>`;
    })
    .join("");
  /* Keterangan mengikuti siklus gajian: nama bulan kalau siklus mulai tanggal 1, rentang tanggal kalau tidak. */
  const cycle = stats.cycleBounds(today, cycleDay);
  const caption = cycleDay > 1 ? `${formatDate(cycle.from, "short")} - ${formatDate(cycle.to, "short")}` : monthNames()[Number(today.slice(5, 7)) - 1];
  const manage = `<button type="button" class="btn btn--secondary btn--small panel__action" data-go="budget">${glyph("settings")}<span>${escapeHtml(t("budget.manage"))}</span></button>`;
  const content = budgets.length
    ? `${rows}<p class="t-footnote text-2">${escapeHtml(t("dashboard.safe_daily", { amount: formatCurrency(safe.perDay) }))}</p>`
    : `<p class="t-footnote text-2">${escapeHtml(t("budget.empty_body"))}</p>`;
  return `
    <section class="panel">
      <div class="panel__head">
        <h2 class="t-headline">${escapeHtml(t("dashboard.budget"))}</h2>
        <span class="panel__caption">${escapeHtml(caption)}</span>
        ${manage}
      </div>
      ${content}
    </section>`;
}

function heatPanel(transactions, today, firstDay, slide = "") {
  const anchor = stats.shiftMonth(today, heatOffset);
  const month = anchor.slice(0, 7);
  const totals = stats.dailyExpense(transactions, month);
  const levelOf = stats.heatLevels(totals);
  const lastDay = Number(stats.monthEnd(anchor).slice(8));
  const startWeekday = stats.toDate(`${month}-01`).getUTCDay();
  const blanks = (startWeekday - firstDay + 7) % 7;

  const cells = [];
  for (let index = 0; index < blanks; index += 1) cells.push("<span></span>");
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const amount = totals.get(date) ?? 0;
    const label = `${formatDate(date, "long")}: ${formatCurrency(amount)}`;
    cells.push(`
      <button type="button" class="heat__day ${date === today ? "heat__day--today" : ""}" style="--i:${day}" data-level="${levelOf(amount)}" data-open-day="${date}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${day}</button>`);
  }

  const weekdays = weekdayNames(firstDay, "narrow").map((name) => `<span class="heat__weekday" aria-hidden="true">${escapeHtml(name)}</span>`).join("");
  const scale = [0, 1, 2, 3, 4].map((level) => `<i style="background:var(--heat-${level})"></i>`).join("");

  return `
    <h2 class="t-headline">${escapeHtml(t("dashboard.calendar"))}</h2>
    <div class="heat__nav">
      <button type="button" class="btn-round" data-heat-step="-1" aria-label="${escapeHtml(t("dashboard.month_previous"))}">${glyph("chevron-left")}</button>
      <span aria-live="polite">${escapeHtml(formatDate(anchor, "monthYear"))}</span>
      <button type="button" class="btn-round" data-heat-step="1" aria-label="${escapeHtml(t("dashboard.month_next"))}" ${heatOffset >= 0 ? "disabled" : ""}>${glyph("chevron-right")}</button>
    </div>
    <div class="heat ${slide}">${weekdays}${cells.join("")}</div>
    <div class="heat__scale"><span>${escapeHtml(t("dashboard.scale_low"))}</span>${scale}<span>${escapeHtml(t("dashboard.scale_high"))}</span></div>`;
}

function bindHeatPanel(container, { transactions, today, firstDay, onOpenDay }) {
  const paint = (slide) => {
    container.innerHTML = heatPanel(transactions, today, firstDay, slide);
    container.querySelectorAll("[data-open-day]").forEach((button) => {
      button.addEventListener("click", () => onOpenDay(button.dataset.openDay));
    });
    container.querySelectorAll("[data-heat-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const step = Number(button.dataset.heatStep);
        heatOffset += step;
        paint(step > 0 ? "is-slide-next" : "is-slide-prev");
      });
    });
  };
  paint();
}

function merchantsPanel(transactions, range) {
  const rows = stats
    .topMerchants(transactions, range.from, range.to)
    .map(
      (merchant) => `
      <div class="rank__item">
        <span class="rank__name">${escapeHtml(merchant.name)}</span>
        <span class="rank__amount">${escapeHtml(formatCurrency(merchant.amount))}</span>
      </div>`
    )
    .join("");
  return panel(t("dashboard.top_merchants"), "", `<div class="rank">${rows}</div>`);
}

function upcomingPanel(today) {
  const limit = stats.addDays(today, UPCOMING_DAYS);
  const items = getSchedules()
    .filter((item) => item.nextDate >= today && item.nextDate <= limit)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  if (!items.length) return "";
  const rows = items
    .map((item) => {
      const category = categoryOrFallback(item.category);
      return `
      <button type="button" class="row" data-go="scheduled">
        ${tile(category.icon, category.color, "sm")}
        <span class="row__body">
          <span class="row__title">${escapeHtml(item.name)}</span>
          <span class="row__meta">${escapeHtml(formatDate(item.nextDate, "medium"))}</span>
        </span>
        <span class="row__amount">${escapeHtml(formatCurrency(item.amount))}</span>
        ${glyph("chevron-right", "icon row__chevron")}
      </button>`;
    })
    .join("");
  return `
    <section class="section">
      <h2 class="t-headline section__title">${escapeHtml(t("sched.upcoming"))}</h2>
      <div class="list">${rows}</div>
    </section>`;
}

function bucketLabel(bucket) {
  if (bucket.unit === "month") return monthNames("short")[Number(bucket.from.slice(5, 7)) - 1];
  return formatDate(bucket.from, "medium");
}

function bucketTitle(bucket) {
  if (bucket.unit === "day") return formatDate(bucket.from, "long");
  if (bucket.unit === "month") return formatDate(bucket.from, "monthYear");
  return `${formatDate(bucket.from, "medium")} - ${formatDate(bucket.to, "medium")}`;
}

/* --- Halaman --- */

export function renderDashboard(root, { today, period, range, fund, category, firstDay, cycleDay = 1, onFilterChange, onOpenRange, onOpenCategory, onOpenDay }) {
  destroyCharts();

  const everything = getTransactions();
  const allFunds = getFunds();
  const scoped = stats.scopeToFund(everything, fund);
  const funds = fund ? allFunds.filter((item) => item.id === fund) : allFunds;
  const flows = category ? scoped.filter((item) => item.category === category) : scoped;

  const current = stats.summarize(flows, range.from, range.to);
  const previous = stats.summarize(flows, range.prevFrom, range.prevTo);
  const series = stats.balanceSeries(scoped, funds, range.from, range.to);
  const latest = series[series.length - 1];
  const buckets = stats.cashflowBuckets(flows, range.from, range.to);
  const breakdown = stats.expenseByCategory(flows, range.from, range.to);
  const comparison = stats.compareCategories(flows, range);
  const budgets = stats.budgetStatus(everything, getCategories(), today, cycleDay);
  const health = stats.financialHealth({ transactions: everything, funds: allFunds, categories: getCategories(), today, cycleDay });
  const items = health.hasData ? stats.findings({ transactions: everything, funds: allFunds, categories: getCategories(), scheduled: getSchedules(), today, cycleDay }) : [];

  const periodChange = latest.value - series[0].value;
  const defaultDelta = t("dashboard.change_period", {
    amount: formatCurrency(periodChange, { signed: true }),
    period: t(`period.${period}_label`).toLowerCase(),
  });
  const previousName = t(`period.${period}_previous`);
  const currentName = t(`period.${period}_label`);

  root.innerHTML = `
    <div class="view">
      <h1 class="visually-hidden" data-title>${escapeHtml(t("nav.home"))}</h1>
      ${filterCard({ period, fund, category, range })}
      ${health.hasData ? healthCard(health, items) : healthEmptyCard()}

      ${
        items.length
          ? `<section class="section">
        <div class="section__head">
          <h2 class="t-title-3">${escapeHtml(t("finding.title"))}</h2>
          <span class="panel__caption">${escapeHtml(t("finding.caption"))}</span>
        </div>
        <div class="findings">${items.map(findingCard).join("")}</div>
      </section>`
          : ""
      }

      <div class="dash">
        <section class="balance dash__wide">
          <p class="balance__label" data-hero-label>${escapeHtml(t("dashboard.total_balance"))}</p>
          <p class="balance__value" data-hero-value ${countAttributes("balance", latest.value, "money")}>${escapeHtml(formatCurrency(latest.value))}</p>
          <p class="balance__delta ${periodChange >= 0 ? "text-income" : "text-expense"}" data-hero-delta>${escapeHtml(defaultDelta)}</p>
          <div class="balance__chart"><canvas data-chart="balance"></canvas></div>
        </section>

        ${statsStrip(current, previous)}

        <div class="dash__column">
          ${panel(t("dashboard.cashflow"), "", `
            ${legend([{ label: t("enum.IN"), color: token("--income") }, { label: t("enum.OUT"), color: token("--expense") }])}
            <div class="chart chart--bars"><canvas data-chart="cashflow"></canvas></div>`)}

          ${
            breakdown.total > 0
              ? panel(t("dashboard.by_category"), "", `
            <div class="donut">
              <div class="donut__ring">
                <canvas data-chart="donut"></canvas>
                <div class="donut__center">
                  <span class="t-caption text-2">${escapeHtml(t("dashboard.total_expense"))}</span>
                  <span class="donut__total">${escapeHtml(formatCompact(breakdown.total))}</span>
                </div>
              </div>
              ${categoryRank(breakdown)}
            </div>`, "panel--donut")
              : ""
          }

          ${
            comparison.length
              ? panel(t("dashboard.compare"), "", `
            ${legend([{ label: previousName, color: token("--neutral-mark") }, { label: currentName, color: token("--accent") }])}
            <div class="chart chart--compare"><canvas data-chart="compare"></canvas></div>`)
              : ""
          }

          ${merchantsPanel(flows, range)}
        </div>

        <div class="dash__column">
          ${fundsPanel(everything)}
          ${upcomingPanel(today)}
          ${budgetPanel(budgets, today, cycleDay)}
          <section class="panel" data-heat-panel></section>
        </div>
      </div>
    </div>`;

  root.querySelectorAll("[data-period]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.period === "custom") onOpenRange(range);
      else onFilterChange({ period: button.dataset.period });
    });
  });
  root.querySelector("[data-open-range]").addEventListener("click", () => onOpenRange(range));
  root.querySelector('[name="filter-fund"]').addEventListener("change", (event) => onFilterChange({ fund: event.target.value }));
  root.querySelector('[name="filter-category"]').addEventListener("change", (event) => onFilterChange({ category: event.target.value }));

  const heroLabel = root.querySelector("[data-hero-label]");
  const heroValue = root.querySelector("[data-hero-value]");
  const heroDelta = root.querySelector("[data-hero-delta]");

  balanceChart(root.querySelector('[data-chart="balance"]'), {
    labels: series.map((point) => formatDate(point.date, "medium")),
    values: series.map((point) => point.value),
    ariaLabel: t("chart.balance_summary", { from: formatCurrency(series[0].value), to: formatCurrency(latest.value) }),
    onScrub(index) {
      cancelNumber(heroValue);
      if (index === null) {
        heroLabel.textContent = t("dashboard.total_balance");
        heroValue.textContent = formatCurrency(latest.value);
        heroDelta.textContent = defaultDelta;
        heroDelta.style.visibility = "";
        return;
      }
      heroLabel.textContent = formatDate(series[index].date, "full");
      heroValue.textContent = formatCurrency(series[index].value);
      heroDelta.style.visibility = "hidden";
    },
  });

  cashflowChart(root.querySelector('[data-chart="cashflow"]'), {
    labels: buckets.map(bucketLabel),
    titles: buckets.map(bucketTitle),
    income: buckets.map((bucket) => bucket.income),
    expense: buckets.map((bucket) => bucket.expense),
    names: { income: t("enum.IN"), expense: t("enum.OUT") },
    ariaLabel: t("chart.cashflow_summary", { income: formatCurrency(current.income), expense: formatCurrency(current.expense) }),
  });

  const donutCanvas = root.querySelector('[data-chart="donut"]');
  if (donutCanvas) {
    const slices = breakdown.top.map(({ category: id, amount }) => {
      const info = categoryOrFallback(id);
      return { id, label: localizedName(info), color: info.color, amount };
    });
    if (breakdown.rest > 0) slices.push({ id: null, label: t("dashboard.other_categories"), color: token("--neutral-mark"), amount: breakdown.rest });
    categoryDonut(donutCanvas, {
      items: slices,
      ariaLabel: t("chart.category_summary", { names: slices.map((item) => item.label).join(", ") }),
      onSelect: (item) => item.id && onOpenCategory(item.id),
    });
  }

  const compareCanvas = root.querySelector('[data-chart="compare"]');
  if (compareCanvas) {
    compareChart(compareCanvas, {
      labels: comparison.map((item) => localizedName(categoryOrFallback(item.category))),
      current: comparison.map((item) => item.current),
      previous: comparison.map((item) => item.previous),
      names: { current: currentName, previous: previousName },
      ariaLabel: t("dashboard.compare"),
    });
  }

  root.querySelectorAll("[data-open-category]").forEach((button) => {
    button.addEventListener("click", () => onOpenCategory(button.dataset.openCategory));
  });
  bindHeatPanel(root.querySelector("[data-heat-panel]"), { transactions: flows, today, firstDay, onOpenDay });
  animateNumbers(root, NUMBER_FORMATS);
}
