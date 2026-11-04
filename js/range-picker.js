/* range-picker.js: kalender untuk memilih rentang tanggal.
   Kotak Dari dan Sampai bisa diketuk untuk memilih ujung mana yang diubah, jadi
   cukup mengubah salah satunya saja. Setelah tanggal Dari dipilih, pilihan pindah
   ke Sampai, sehingga dua ketukan berurutan tetap memilih rentang baru.
   Kalau tanggal yang dipilih membuat rentang terbalik, ujung lainnya ikut digeser. */

import { t, formatDate, weekdayNames } from "./i18n.js";
import { daysBetween, monthEnd, shiftMonth, toDate } from "./stats.js";
import { glyph } from "./icons.js";
import { closeSheet, escapeHtml, haptic, sheetHeader, showSheet } from "./ui.js";

function dayClass(date, { from, to, today }) {
  const classes = ["range-day"];
  if (date === from) classes.push("is-start");
  if (date === to) classes.push("is-end");
  if (from && to && date > from && date < to) classes.push("is-between");
  if (date === today) classes.push("is-today");
  return classes.join(" ");
}

function monthGrid(month, selection, firstDay) {
  const start = `${month}-01`;
  const lastDay = Number(monthEnd(start).slice(8));
  const blanks = (toDate(start).getUTCDay() - firstDay + 7) % 7;
  const cells = Array.from({ length: blanks }, () => "<span></span>");

  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const selected = date === selection.from || date === selection.to;
    cells.push(`
      <button type="button" class="${dayClass(date, selection)}" style="--i:${day}" data-date="${date}" aria-label="${escapeHtml(formatDate(date, "long"))}" aria-pressed="${selected}" ${date > selection.today ? "disabled" : ""}>${day}</button>`);
  }
  return cells.join("");
}

function summaryValue(date) {
  return date ? formatDate(date, "short") : t("range.pick");
}

/* onApply menerima { from, to } setelah tombol Terapkan ditekan. */
export function openRangePicker({ from, to, today, firstDay, onApply }) {
  const selection = { from, to, today };
  let active = "from";
  let month = from.slice(0, 7);

  showSheet((body) => {
    body.innerHTML = `
      ${sheetHeader({
        title: t("range.title"),
        leading: `<button type="button" class="btn-plain" data-sheet-dismiss>${escapeHtml(t("common.cancel"))}</button>`,
        trailing: `<button type="button" class="btn-plain btn-plain--strong" data-apply>${escapeHtml(t("range.apply"))}</button>`,
      })}
      <div class="sheet__body">
        <div class="range-summary" role="group" aria-label="${escapeHtml(t("range.title"))}">
          <button type="button" class="range-summary__item" data-end="from"></button>
          <span class="range-summary__arrow">${glyph("chevron-right")}</span>
          <button type="button" class="range-summary__item" data-end="to"></button>
        </div>
        <p class="form-note" role="status" data-range-hint></p>
        <div class="panel range-calendar">
          <div class="heat__nav">
            <button type="button" class="btn-round" data-step="-1" aria-label="${escapeHtml(t("dashboard.month_previous"))}">${glyph("chevron-left")}</button>
            <span aria-live="polite" data-month-label></span>
            <button type="button" class="btn-round" data-step="1" aria-label="${escapeHtml(t("dashboard.month_next"))}">${glyph("chevron-right")}</button>
          </div>
          <div class="range-grid range-grid--weekdays" aria-hidden="true">
            ${weekdayNames(firstDay, "narrow").map((name) => `<span class="heat__weekday">${escapeHtml(name)}</span>`).join("")}
          </div>
          <div class="range-grid" data-days></div>
        </div>
      </div>`;

    const grid = body.querySelector("[data-days]");
    const hint = body.querySelector("[data-range-hint]");
    const applyButton = body.querySelector("[data-apply]");
    const nextButton = body.querySelector('[data-step="1"]');
    const summaryItem = (end) => body.querySelector(`[data-end="${end}"]`);

    const paintSummary = () => {
      for (const end of ["from", "to"]) {
        const item = summaryItem(end);
        item.innerHTML = `
          <span class="field__label">${escapeHtml(t(`range.${end}`))}</span>
          <span class="range-summary__value">${escapeHtml(summaryValue(selection[end]))}</span>`;
        item.classList.toggle("is-active", end === active);
        item.setAttribute("aria-pressed", String(end === active));
      }
      const days = t("range.days", { count: daysBetween(selection.from, selection.to) + 1 });
      hint.textContent = `${days}. ${t(active === "from" ? "range.editing_from" : "range.editing_to")}`;
    };

    const paintDays = (direction = "") => {
      grid.className = `range-grid ${direction}`;
      grid.innerHTML = monthGrid(month, selection, firstDay);
      body.querySelector("[data-month-label]").textContent = formatDate(`${month}-01`, "monthYear");
      nextButton.disabled = month >= today.slice(0, 7);
    };

    /* Mengetuk Dari atau Sampai: ujung itu yang akan diubah, dan kalender pindah ke bulannya. */
    ["from", "to"].forEach((end) => {
      summaryItem(end).addEventListener("click", () => {
        active = end;
        const target = selection[end].slice(0, 7);
        const direction = target === month ? "" : target > month ? "is-slide-next" : "is-slide-prev";
        month = target;
        haptic();
        paintDays(direction);
        paintSummary();
      });
    });

    grid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-date]");
      if (!button || button.disabled) return;
      const date = button.dataset.date;
      if (active === "from") {
        selection.from = date;
        if (date > selection.to) selection.to = date;
        active = "to";
      } else {
        selection.to = date;
        if (date < selection.from) selection.from = date;
      }
      haptic();
      paintDays();
      paintSummary();
    });

    body.querySelectorAll("[data-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const step = Number(button.dataset.step);
        month = shiftMonth(`${month}-01`, step).slice(0, 7);
        paintDays(step > 0 ? "is-slide-next" : "is-slide-prev");
      });
    });

    body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
    applyButton.addEventListener("click", () => {
      closeSheet();
      onApply({ from: selection.from, to: selection.to });
    });

    paintDays();
    paintSummary();
  });
}
