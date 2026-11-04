/* stats.js: semua rumus dashboard, satu-satunya tempat angka dihitung.
   Tidak menyentuh tampilan, jadi hasilnya bisa dicocokkan dengan Google Sheets.
   Tanggal selalu teks "YYYY-MM-DD". Transaksi berbentuk:
   { id, date, time, type, name, category, fund, toFund, amount, note } */

const DAY_MS = 86400000;

export function toDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(from, to) {
  return Math.round((toDate(to) - toDate(from)) / DAY_MS);
}

function monthStart(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function addMonths(iso, months) {
  const date = toDate(iso);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return toIso(target);
}

export function shiftMonth(iso, months) {
  return addMonths(monthStart(iso), months);
}

export function monthEnd(iso) {
  const date = toDate(iso);
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

/* Siklus bulanan yang dimulai dari tanggal gajian. Tanggal 1 berarti bulan kalender.
   Tanggal 29-31 di bulan yang lebih pendek menjadi tanggal terakhir bulan itu. */
export function cycleBounds(today, cycleDay = 1) {
  if (cycleDay <= 1) return { from: monthStart(today), to: monthEnd(today) };
  const date = toDate(today);
  const startOf = (offset) => {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(cycleDay, last));
    return toIso(target);
  };
  const thisStart = startOf(0);
  const from = today >= thisStart ? thisStart : startOf(-1);
  const to = addDays(today >= thisStart ? startOf(1) : thisStart, -1);
  return { from, to };
}

/* Rentang periode dan pembandingnya yang sama panjang. */
export function periodRange(period, today, cycleDay = 1) {
  if (period === "week") {
    const from = addDays(today, -6);
    return { from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(today, -7) };
  }
  if (period === "quarter") {
    const from = addMonths(monthStart(today), -2);
    return { from, to: today, prevFrom: addMonths(from, -3), prevTo: addMonths(today, -3) };
  }
  if (period === "year") {
    const from = `${today.slice(0, 4)}-01-01`;
    return { from, to: today, prevFrom: addMonths(from, -12), prevTo: addMonths(today, -12) };
  }
  const from = cycleBounds(today, cycleDay).from;
  return { from, to: today, prevFrom: addMonths(from, -1), prevTo: addMonths(today, -1) };
}

/* Rentang pilihan sendiri. Pembandingnya rentang sama panjang tepat sebelumnya. */
export function customRange(from, to) {
  const span = daysBetween(from, to) + 1;
  return { from, to, prevFrom: addDays(from, -span), prevTo: addDays(from, -1) };
}

function inRange(item, from, to) {
  return item.date >= from && item.date <= to;
}

export function summarize(transactions, from, to) {
  let income = 0;
  let expense = 0;
  for (const item of transactions) {
    if (!inRange(item, from, to)) continue;
    if (item.type === "IN") income += item.amount;
    if (item.type === "OUT") expense += item.amount;
  }
  const net = income - expense;
  return { income, expense, net, savingRate: income > 0 ? (net / income) * 100 : 0 };
}

export function percentChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/* Saldo = saldo awal + masuk - keluar, ditambah atau dikurangi transfer. */
export function fundBalances(transactions, funds, until = "9999-12-31") {
  const balances = new Map(funds.map((fund) => [fund.id, fund.openingBalance]));
  const change = (id, amount) => {
    if (balances.has(id)) balances.set(id, balances.get(id) + amount);
  };
  for (const item of transactions) {
    if (item.date > until) continue;
    if (item.type === "IN") change(item.fund, item.amount);
    if (item.type === "OUT") change(item.fund, -item.amount);
    if (item.type === "TRANSFER") {
      change(item.fund, -item.amount);
      change(item.toFund, item.amount);
    }
  }
  return balances;
}

export function totalBalance(transactions, funds, until) {
  return [...fundBalances(transactions, funds, until).values()].reduce((sum, value) => sum + value, 0);
}

/* Hanya transaksi yang menyentuh satu sumber dana. Kosong berarti semua. */
export function scopeToFund(transactions, fundId) {
  if (!fundId) return transactions;
  return transactions.filter((item) => item.fund === fundId || item.toFund === fundId);
}

/* Saldo total di akhir setiap hari dalam rentang. Transfer antar sumber dana yang sama-sama
   dihitung saling meniadakan, jadi saldo gabungan tidak berubah. */
export function balanceSeries(transactions, funds, from, to) {
  const included = new Set(funds.map((fund) => fund.id));
  const netByDay = new Map();
  const change = (date, delta) => netByDay.set(date, (netByDay.get(date) ?? 0) + delta);
  for (const item of transactions) {
    if (item.type === "IN" && included.has(item.fund)) change(item.date, item.amount);
    if (item.type === "OUT" && included.has(item.fund)) change(item.date, -item.amount);
    if (item.type === "TRANSFER") {
      if (included.has(item.fund)) change(item.date, -item.amount);
      if (included.has(item.toFund)) change(item.date, item.amount);
    }
  }
  let balance = totalBalance(transactions, funds, addDays(from, -1));
  const series = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    balance += netByDay.get(date) ?? 0;
    series.push({ date, value: balance });
  }
  return series;
}

/* Pemasukan dan pengeluaran per hari, minggu, atau bulan sesuai panjang periode. */
export function cashflowBuckets(transactions, from, to) {
  const span = daysBetween(from, to);
  const unit = span <= 14 ? "day" : span <= 100 ? "week" : "month";
  const buckets = [];
  let start = from;
  while (start <= to) {
    let end = start;
    if (unit === "week") end = addDays(start, 6);
    if (unit === "month") end = monthEnd(start);
    if (end > to) end = to;
    buckets.push({ unit, from: start, to: end, ...summarize(transactions, start, end) });
    start = addDays(end, 1);
  }
  return buckets;
}

export function expenseTotals(transactions, from, to) {
  const totals = new Map();
  for (const item of transactions) {
    if (item.type !== "OUT" || !inRange(item, from, to)) continue;
    totals.set(item.category, (totals.get(item.category) ?? 0) + item.amount);
  }
  return totals;
}

/* Pengeluaran per kategori. Donat dibatasi 5 kategori + "lainnya" agar tetap terbaca. */
export function expenseByCategory(transactions, from, to, limit = 5) {
  const sorted = [...expenseTotals(transactions, from, to)]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((sum, item) => sum + item.amount, 0);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, item) => sum + item.amount, 0);
  return { total, top, rest, all: sorted };
}

export function compareCategories(transactions, range, limit = 5) {
  const current = expenseTotals(transactions, range.from, range.to);
  const previous = expenseTotals(transactions, range.prevFrom, range.prevTo);
  return [...current]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, amount]) => ({ category, current: amount, previous: previous.get(category) ?? 0 }));
}

export function dailyExpense(transactions, month) {
  const totals = new Map();
  for (const item of transactions) {
    if (item.type === "OUT" && item.date.startsWith(month)) {
      totals.set(item.date, (totals.get(item.date) ?? 0) + item.amount);
    }
  }
  return totals;
}

/* Lima tingkat warna heatmap: 0 = tidak ada, 1-4 = kuartil hari yang ada belanja. */
export function heatLevels(totals) {
  const values = [...totals.values()].sort((a, b) => a - b);
  const quartile = (fraction) => values[Math.floor((values.length - 1) * fraction)];
  const cuts = [quartile(0.25), quartile(0.5), quartile(0.75)];
  return (amount) => {
    if (!amount) return 0;
    return 1 + cuts.filter((cut) => amount > cut).length;
  };
}

export function budgetStatus(transactions, categories, today, cycleDay = 1) {
  const from = cycleBounds(today, cycleDay).from;
  const spent = expenseTotals(transactions, from, today);
  return categories
    .filter((category) => category.budget > 0 && category.active)
    .map((category) => {
      const used = spent.get(category.id) ?? 0;
      return { category, used, limit: category.budget, percent: (used / category.budget) * 100 };
    })
    .sort((a, b) => b.percent - a.percent);
}

/* Batas aman per hari sampai akhir bulan, hanya dari kategori yang punya budget. */
export function safeDailySpend(budgets, today, cycleDay = 1) {
  const daysLeft = daysBetween(today, cycleBounds(today, cycleDay).to) + 1;
  const remaining = budgets.reduce((sum, item) => sum + Math.max(item.limit - item.used, 0), 0);
  return { remaining, daysLeft, perDay: Math.floor(remaining / daysLeft) };
}

/* Proyeksi = yang sudah keluar + rata-rata harian 30 hari terakhir untuk sisa bulan
   + tagihan terjadwal yang belum jatuh tempo. Tagihan terjadwal tidak ikut dirata-rata,
   supaya sewa di awal bulan tidak melambungkan proyeksi. */
export function forecastExpense(transactions, scheduled, today, cycleDay = 1) {
  const { from, to: end } = cycleBounds(today, cycleDay);
  const spent = summarize(transactions, from, today).expense;
  const variable = transactions.filter((item) => !item.scheduleId);
  const dailyAverage = summarize(variable, addDays(today, -29), today).expense / 30;
  const upcoming = scheduled
    .filter((item) => item.type === "OUT" && item.nextDate > today && item.nextDate <= end)
    .reduce((sum, item) => sum + item.amount, 0);
  return { spent, projected: Math.round(spent + dailyAverage * daysBetween(today, end) + upcoming) };
}

export function topMerchants(transactions, from, to, limit = 5) {
  const totals = new Map();
  for (const item of transactions) {
    if (item.type !== "OUT" || !inRange(item, from, to)) continue;
    const entry = totals.get(item.name) ?? { name: item.name, amount: 0, count: 0 };
    entry.amount += item.amount;
    entry.count += 1;
    totals.set(item.name, entry);
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/* Kategori dengan kenaikan terbesar dibanding periode pembanding. */
export function biggestIncrease(comparison) {
  const rising = comparison
    .filter((item) => item.previous > 0 && item.current > item.previous)
    .map((item) => ({ ...item, percent: percentChange(item.current, item.previous) }))
    .sort((a, b) => b.current - b.previous - (a.current - a.previous));
  return rising[0] ?? null;
}

/* Ringkasan beberapa bulan terakhir, dari yang terlama. Bulan berjalan ikut di akhir. */
export function monthlyTotals(transactions, today, count) {
  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const from = shiftMonth(today, -offset);
    const end = monthEnd(from);
    const to = end > today ? today : end;
    months.push({ from, to, ...summarize(transactions, from, to) });
  }
  return months;
}

/* Grafik mini memakai bulan penuh saja, karena bulan berjalan selalu terlihat anjlok. */
function fullMonths(transactions, today) {
  return monthlyTotals(transactions, today, SPARK_MONTHS + 1).slice(0, SPARK_MONTHS);
}

function monthlyCategory(transactions, category, today) {
  return fullMonths(transactions.filter((item) => item.category === category), today).map((month) => month.expense);
}

const SPARK_MONTHS = 6;
const UPCOMING_DAYS = 7;
const clampScore = (value) => Math.round(Math.max(0, Math.min(100, value)));
const DEBT_CATEGORY = "installments";
const TARGET_SAVING_RATE = 20;
const TARGET_EMERGENCY_MONTHS = 6;
const MAX_DEBT_RATIO = 50;

/* Angka dasar dihitung dari 3 bulan penuh terakhir, supaya bulan berjalan tidak mengacaukan skor. */
function healthFacts({ transactions, funds, today }) {
  const months = monthlyTotals(transactions, today, 4).slice(0, 3);
  const income = months.reduce((sum, month) => sum + month.income, 0);
  const expense = months.reduce((sum, month) => sum + month.expense, 0);
  const debt = months.reduce((sum, month) => sum + monthlyDebt(transactions, month), 0);
  const positiveMonths = months.filter((month) => month.net > 0).length;
  return {
    months,
    savingRate: income > 0 ? ((income - expense) / income) * 100 : 0,
    emergencyMonths: expense > 0 ? totalBalance(transactions, funds) / (expense / 3) : 0,
    debtRatio: income > 0 ? (debt / income) * 100 : 0,
    positiveMonths,
  };
}

function monthlyDebt(transactions, { from, to }) {
  return transactions
    .filter((item) => item.type === "OUT" && item.category === DEBT_CATEGORY && item.date >= from && item.date <= to)
    .reduce((sum, item) => sum + item.amount, 0);
}

/* Skor 0-100 dari lima bagian dengan bobot sama. 70 ke atas sehat, 50-69 perlu perhatian. */
export function financialHealth({ transactions, funds, categories, today, cycleDay = 1 }) {
  const facts = healthFacts({ transactions, funds, today });
  const budgets = budgetStatus(transactions, categories, today, cycleDay);
  const withinBudget = budgets.filter((item) => item.used <= item.limit).length;
  const parts = [
    { key: "saving", score: clampScore((facts.savingRate / TARGET_SAVING_RATE) * 100) },
    { key: "budget", score: budgets.length ? clampScore((withinBudget / budgets.length) * 100) : 100 },
    { key: "cashflow", score: clampScore((facts.positiveMonths / 3) * 100) },
    { key: "emergency", score: clampScore((facts.emergencyMonths / TARGET_EMERGENCY_MONTHS) * 100) },
    { key: "debt", score: clampScore(((MAX_DEBT_RATIO - facts.debtRatio) / MAX_DEBT_RATIO) * 100) },
  ];
  const score = Math.round(parts.reduce((sum, part) => sum + part.score, 0) / parts.length);
  const status = score >= 70 ? "good" : score >= 50 ? "fair" : "poor";
  const hasData = facts.months.some((month) => month.income > 0 || month.expense > 0);
  return { score, status, parts, facts, hasData };
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, positive: 3 };
const MAX_FINDINGS = 8;

/* Temuan dihitung dari data. Teksnya dibuat di tampilan sesuai bahasa aktif. */
export function findings({ transactions, funds, categories, scheduled, today, cycleDay = 1 }) {
  const list = [];
  const add = (item) => list.push(item);
  const facts = healthFacts({ transactions, funds, today });
  const months = fullMonths(transactions, today);
  const budgets = budgetStatus(transactions, categories, today, cycleDay);

  budgets
    .filter((item) => item.used > item.limit)
    .slice(0, 2)
    .forEach(({ category, used, limit, percent }) => {
      add({
        key: "budget_over",
        severity: "critical",
        area: "budget",
        value: { type: "percent", amount: percent },
        spark: monthlyCategory(transactions, category.id, today),
        vars: { category: category.id, amount: used - limit, limit },
      });
    });

  const near = budgets.find((item) => item.percent >= 75 && item.used <= item.limit);
  if (near) {
    add({
      key: "budget_near",
      severity: "warning",
      area: "budget",
      value: { type: "percent", amount: near.percent },
      spark: monthlyCategory(transactions, near.category.id, today),
      vars: { category: near.category.id, amount: near.limit - near.used },
    });
  }

  const savingSeverity = facts.savingRate >= TARGET_SAVING_RATE ? "positive" : facts.savingRate >= 10 ? "warning" : "critical";
  add({
    key: savingSeverity === "positive" ? "saving_good" : "saving_low",
    severity: savingSeverity,
    area: "saving",
    value: { type: "percent", amount: facts.savingRate },
    spark: months.map((month) => month.savingRate),
    vars: { rate: Math.round(facts.savingRate), target: TARGET_SAVING_RATE },
  });

  const emergencySeverity = facts.emergencyMonths >= TARGET_EMERGENCY_MONTHS ? "positive" : facts.emergencyMonths >= 3 ? "info" : "warning";
  add({
    key: emergencySeverity === "positive" ? "emergency_good" : "emergency_low",
    severity: emergencySeverity,
    area: "emergency",
    value: { type: "months", amount: facts.emergencyMonths },
    spark: months.map((month) => totalBalance(transactions, funds, month.to)),
    vars: { target: TARGET_EMERGENCY_MONTHS },
  });

  add({
    key: facts.debtRatio <= 30 ? "debt_good" : "debt_high",
    severity: facts.debtRatio <= 30 ? "positive" : "warning",
    area: "debt",
    value: { type: "percent", amount: facts.debtRatio },
    spark: months.map((month) => monthlyDebt(transactions, month)),
    vars: { rate: Math.round(facts.debtRatio) },
  });

  add({
    key: facts.positiveMonths === 3 ? "cashflow_good" : "cashflow_low",
    severity: facts.positiveMonths === 3 ? "positive" : "warning",
    area: "cashflow",
    value: { type: "money", amount: facts.months.reduce((sum, month) => sum + month.net, 0) / 3 },
    spark: months.map((month) => month.net),
    vars: { count: facts.positiveMonths },
  });

  const rising = biggestIncrease(compareCategories(transactions, { from: addDays(today, -29), to: today, prevFrom: addDays(today, -59), prevTo: addDays(today, -30) }));
  if (rising && rising.percent >= 10) {
    add({
      key: "category_up",
      severity: "warning",
      area: "budget",
      value: { type: "percent", amount: rising.percent },
      spark: monthlyCategory(transactions, rising.category, today),
      vars: { category: rising.category, percent: Math.round(rising.percent) },
    });
  }

  const forecast = forecastExpense(transactions, scheduled, today, cycleDay);
  add({
    key: "forecast",
    severity: "info",
    area: "cashflow",
    value: { type: "money", amount: forecast.projected },
    spark: months.map((month) => month.expense),
    vars: { amount: forecast.spent },
  });

  const limit = addDays(today, UPCOMING_DAYS);
  const upcoming = scheduled.filter((item) => item.type === "OUT" && item.nextDate >= today && item.nextDate <= limit);
  if (upcoming.length) {
    add({
      key: "upcoming",
      severity: "info",
      area: "cashflow",
      value: { type: "money", amount: upcoming.reduce((sum, item) => sum + item.amount, 0) },
      spark: months.map((month) => month.expense),
      vars: { count: upcoming.length },
    });
  }

  return list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, MAX_FINDINGS);
}
