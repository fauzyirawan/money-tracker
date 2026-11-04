/* charts.js: semua grafik dashboard, memakai Chart.js.
   Warna dibaca dari tokens.css, jadi otomatis mengikuti tema. Setiap grafik punya
   satu sumbu saja, dan warna mengikuti kategori, bukan urutan peringkatnya. */

/* global Chart */

import { formatCompact, formatCurrency } from "./i18n.js";
import { escapeHtml } from "./ui.js";

const charts = new Set();

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function motion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 600, easing: "easeOutQuart" };
}

function theme() {
  return {
    text: token("--text"),
    muted: token("--text-2"),
    grid: token("--separator"),
    surface: token("--chart-gap"),
    font: getComputedStyle(document.body).fontFamily,
  };
}

function register(chart) {
  charts.add(chart);
  return chart;
}

export function destroyCharts() {
  charts.forEach((chart) => chart.destroy());
  charts.clear();
}

/* Tooltip HTML yang menempel pada wadah grafik. */
function externalTooltip(renderBody) {
  return ({ chart, tooltip }) => {
    const parent = chart.canvas.parentElement;
    let element = parent.querySelector(".chart-tip");
    if (!element) {
      element = document.createElement("div");
      element.className = "chart-tip";
      parent.append(element);
    }
    if (tooltip.opacity === 0) {
      element.style.opacity = 0;
      return;
    }
    element.innerHTML = renderBody(tooltip);
    const maxLeft = parent.clientWidth - element.offsetWidth;
    element.style.left = `${Math.max(0, Math.min(tooltip.caretX - element.offsetWidth / 2, maxLeft))}px`;
    element.style.top = `${Math.max(0, tooltip.caretY - element.offsetHeight - 12)}px`;
    element.style.opacity = 1;
  };
}

function tipRows(title, rows) {
  return `
    <div class="chart-tip__title">${escapeHtml(title)}</div>
    ${rows
      .map(
        (row) => `
      <div class="chart-tip__row">
        <span class="legend__item"><i class="swatch" style="--_color:${escapeHtml(row.color)}"></i>${escapeHtml(row.label)}</span>
        <span>${escapeHtml(formatCurrency(row.value))}</span>
      </div>`
      )
      .join("")}`;
}

function amountAxis(colors) {
  return {
    position: "right",
    border: { display: false },
    grid: { color: colors.grid, lineWidth: 0.5, drawTicks: false },
    ticks: {
      color: colors.muted,
      font: { family: colors.font, size: 11 },
      padding: 6,
      maxTicksLimit: 4,
      callback: (value) => formatCompact(value),
    },
  };
}

function labelAxis(colors) {
  return {
    border: { display: false },
    grid: { display: false },
    ticks: {
      color: colors.muted,
      font: { family: colors.font, size: 11 },
      maxRotation: 0,
      autoSkipPadding: 12,
    },
  };
}

/* Grafik saldo: garis selebar layar yang bisa digeser jari. onScrub menerima titik
   yang sedang dipilih, atau null saat jari dilepas. */
export function balanceChart(canvas, { labels, values, ariaLabel, onScrub }) {
  const colors = theme();
  const accent = token("--accent");
  const isPhone = window.matchMedia("(max-width: 639.98px)").matches;
  let activeIndex = null;

  const crosshair = {
    id: "crosshair",
    afterDatasetsDraw(chart) {
      if (activeIndex === null) return;
      const point = chart.getDatasetMeta(0).data[activeIndex];
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.strokeStyle = colors.surface;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  };

  const areaFill = (context) => {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return "transparent";
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, `${accent}2e`);
    gradient.addColorStop(1, `${accent}00`);
    return gradient;
  };

  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", ariaLabel);

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data: values, borderColor: accent, borderWidth: 2, backgroundColor: areaFill, fill: true, pointRadius: 0, tension: 0.25, clip: 4 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: [],
      layout: { padding: { top: 8, bottom: 0, left: 0, right: 0 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { ...labelAxis(colors), ticks: { ...labelAxis(colors).ticks, maxTicksLimit: 5, padding: 4, align: "inner" } },
        y: { ...amountAxis(colors), grace: "12%", ticks: { ...amountAxis(colors).ticks, mirror: isPhone, padding: isPhone ? -6 : 6, z: 2 } },
      },
    },
    plugins: [crosshair],
  });

  const select = (clientX) => {
    const area = chart.chartArea;
    const x = clientX - canvas.getBoundingClientRect().left;
    const ratio = Math.min(1, Math.max(0, (x - area.left) / (area.right - area.left)));
    activeIndex = Math.round(ratio * (values.length - 1));
    chart.draw();
    onScrub(activeIndex);
  };

  const release = () => {
    activeIndex = null;
    chart.draw();
    onScrub(null);
  };

  const wrapper = canvas.parentElement;
  const handlers = {
    pointerdown: (event) => select(event.clientX),
    pointermove: (event) => {
      if (event.pointerType === "mouse" || event.buttons) select(event.clientX);
    },
    pointerleave: release,
    pointerup: (event) => {
      if (event.pointerType !== "mouse") release();
    },
    pointercancel: release,
  };
  Object.entries(handlers).forEach(([name, handler]) => wrapper.addEventListener(name, handler));
  const destroy = chart.destroy.bind(chart);
  chart.destroy = () => {
    Object.entries(handlers).forEach(([name, handler]) => wrapper.removeEventListener(name, handler));
    destroy();
  };

  return register(chart);
}

/* Pemasukan dan pengeluaran berdampingan pada satu sumbu. */
export function cashflowChart(canvas, { labels, income, expense, titles, names, ariaLabel }) {
  const colors = theme();
  const incomeColor = token("--income");
  const expenseColor = token("--expense");

  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", ariaLabel);

  const dataset = (data, color, label) => ({ label, data, backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 18, categoryPercentage: 0.7, barPercentage: 0.86 });

  return register(
    new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [dataset(income, incomeColor, names.income), dataset(expense, expenseColor, names.expense)] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: motion(),
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: externalTooltip((tooltip) =>
              tipRows(titles[tooltip.dataPoints[0].dataIndex], tooltip.dataPoints.map((point) => ({ label: point.dataset.label, value: point.raw, color: point.dataset.backgroundColor })))
            ),
          },
        },
        scales: { x: labelAxis(colors), y: { ...amountAxis(colors), beginAtZero: true } },
      },
    })
  );
}

/* Donat maksimal enam segmen, dipisah celah warna latar. */
export function categoryDonut(canvas, { items, ariaLabel, onSelect }) {
  const colors = theme();
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", ariaLabel);

  return register(
    new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: items.map((item) => item.label),
        datasets: [{ data: items.map((item) => item.amount), backgroundColor: items.map((item) => item.color), borderColor: colors.surface, borderWidth: 2, hoverOffset: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "72%",
        animation: motion(),
        layout: { padding: 4 },
        onClick: (event, elements) => {
          if (elements.length) onSelect(items[elements[0].index]);
        },
        onHover: (event, elements) => {
          canvas.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    })
  );
}

/* Periode ini (warna aksen) dibanding periode lalu (abu-abu). */
export function compareChart(canvas, { labels, current, previous, names, ariaLabel }) {
  const colors = theme();
  const accent = token("--accent");
  const neutral = token("--neutral-mark");

  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", ariaLabel);

  const dataset = (data, color, label) => ({ label, data, backgroundColor: color, borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "left", maxBarThickness: 12, categoryPercentage: 0.72, barPercentage: 0.88 });

  return register(
    new Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [dataset(previous, neutral, names.previous), dataset(current, accent, names.current)] },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: motion(),
        interaction: { mode: "index", intersect: false, axis: "y" },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: externalTooltip((tooltip) =>
              tipRows(tooltip.title[0], tooltip.dataPoints.map((point) => ({ label: point.dataset.label, value: point.raw, color: point.dataset.backgroundColor })))
            ),
          },
        },
        scales: {
          x: { ...amountAxis(colors), position: "bottom", beginAtZero: true },
          y: { ...labelAxis(colors), ticks: { color: colors.text, font: { family: colors.font, size: 12 }, autoSkip: false } },
        },
      },
    })
  );
}
