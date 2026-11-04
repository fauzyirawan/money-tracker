/* scheduled.js: halaman Terjadwal. Daftar jadwal, kalender jatuh tempo,
   konfirmasi yang menunggu, dan editor jadwal. */

import { ApiError } from "./api.js";
import { t, tError, formatCurrency, formatDate, formatNumber, localizedName, parseAmount, weekdayNames } from "./i18n.js";
import { createId, deactivateSchedule, getCategories, getFunds, getPending, getSchedules, categoryOrFallback, resolvePending, saveSchedule } from "./store.js";
import { daysBetween, monthEnd, shiftMonth, toDate } from "./stats.js";
import { occurrences } from "./schedule-math.js";
import { glyph, tile } from "./icons.js";
import { bindAmountInput, bindSegmented, closeSheet, escapeHtml, haptic, replayAnimation, segmented, sheetHeader, showSheet, toast } from "./ui.js";

const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "EVERY_N_DAYS"];
const TRANSFER_ICON = "lucide:arrow-left-right";
const TRANSFER_COLOR = "#5856d6";

const view = { mode: "list", monthOffset: 0, day: "" };
let context = { today: "", firstDay: 1 };

function scheduleTile(schedule, size = "md") {
  if (schedule.type === "TRANSFER") return tile(TRANSFER_ICON, TRANSFER_COLOR, size);
  const category = categoryOrFallback(schedule.category);
  return tile(category.icon, category.color, size);
}

function progressText(schedule) {
  if (schedule.maxRuns) return t("sched.installment_progress", { current: Math.min(schedule.runCount + 1, schedule.maxRuns), total: schedule.maxRuns });
  return t(`sched.frequency_${schedule.frequency}`);
}

function dueText(schedule) {
  if (!schedule.active || !schedule.nextDate) return t("common.inactive");
  const days = daysBetween(context.today, schedule.nextDate);
  if (days === 0) return t("common.today");
  return days > 0 ? t("sched.due_in", { count: days }) : t("sched.overdue", { count: -days });
}

/* Kiri: nama, frekuensi, dan cara mencatat. Kanan: nominal, lalu tanggal jatuh tempo.
   Kolom kanan rata kanan supaya nominal dan tanggal setiap baris segaris. */
function scheduleRow(schedule) {
  const tone = schedule.type === "IN" ? "text-income" : schedule.type === "TRANSFER" ? "text-transfer" : "";
  const scheduled = Boolean(schedule.nextDate && schedule.active);
  const overdue = scheduled && schedule.nextDate < context.today;
  const relative = `<span class="${overdue ? "text-warning" : ""}">${escapeHtml(dueText(schedule))}</span>`;
  /* Di layar sempit "2 hari lagi" pindah ke kiri supaya nama tidak terpotong. */
  return `
    <button type="button" class="row sched-row" data-edit-schedule="${escapeHtml(schedule.id)}">
      ${scheduleTile(schedule)}
      <span class="row__body">
        <span class="row__title">${escapeHtml(schedule.name)}</span>
        <span class="row__meta">${scheduled ? `<span class="sched-row__relative sched-row__relative--start">${relative} · </span>` : ""}${escapeHtml(progressText(schedule))} · ${escapeHtml(t(`sched.mode_${schedule.mode}`))}</span>
      </span>
      <span class="sched-row__side">
        <span class="row__amount ${tone}">${escapeHtml(formatCurrency(schedule.amount))}</span>
        <span class="row__meta">${scheduled ? `${escapeHtml(formatDate(schedule.nextDate, "medium"))}<span class="sched-row__relative sched-row__relative--end"> · ${relative}</span>` : relative}</span>
      </span>
    </button>`;
}

function pendingSection() {
  const items = getPending();
  if (!items.length) return "";
  const schedules = getSchedules();
  const rows = items
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((item) => {
      const schedule = schedules.find((row) => row.id === item.scheduleId) ?? { name: "-", type: "OUT", category: "" };
      return `
        <div class="pending" data-pending="${escapeHtml(item.id)}">
          <div class="row row--static">
            ${scheduleTile(schedule, "sm")}
            <span class="row__body">
              <span class="row__title">${escapeHtml(schedule.name)}</span>
              <span class="row__meta">${escapeHtml(formatDate(item.dueDate, "long"))}</span>
            </span>
            <span class="row__amount">${escapeHtml(formatCurrency(item.amount))}</span>
          </div>
          <div class="pending__actions">
            <button type="button" class="btn btn--primary" data-resolve="CONFIRM">${escapeHtml(t("sched.confirm"))}</button>
            <button type="button" class="btn btn--secondary" data-resolve="EDIT">${escapeHtml(t("sched.change_amount"))}</button>
            <button type="button" class="btn btn--secondary" data-resolve="SKIP">${escapeHtml(t("sched.skip"))}</button>
          </div>
        </div>`;
    })
    .join("");
  return `
    <section class="section">
      <h2 class="t-headline section__title">${escapeHtml(t("sched.pending_title", { count: items.length }))}</h2>
      <div class="list">${rows}</div>
    </section>`;
}

function listView() {
  const schedules = getSchedules();
  const active = schedules.filter((row) => row.active).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const inactive = schedules.filter((row) => !row.active);
  if (!schedules.length) {
    return `
      <div class="list empty-state">
        ${glyph("calendar-clock")}
        <p class="t-headline">${escapeHtml(t("sched.empty_title"))}</p>
        <p class="t-footnote">${escapeHtml(t("sched.empty_body"))}</p>
        <button type="button" class="btn btn--primary" data-new-schedule>${escapeHtml(t("sched.new"))}</button>
      </div>`;
  }
  return `
    ${active.length ? `<div class="list">${active.map(scheduleRow).join("")}</div>` : ""}
    ${
      inactive.length
        ? `<details class="section">
            <summary class="list__header">${escapeHtml(t("sched.inactive_title", { count: inactive.length }))}</summary>
            <div class="list">${inactive.map(scheduleRow).join("")}</div>
          </details>`
        : ""
    }`;
}

function calendarView() {
  const anchor = shiftMonth(context.today, view.monthOffset);
  const month = anchor.slice(0, 7);
  const last = monthEnd(anchor);
  const byDate = {};
  getSchedules().forEach((schedule) => {
    occurrences(schedule, `${month}-01`, last).forEach((date) => {
      (byDate[date] ??= []).push(schedule);
    });
  });

  const blanks = (toDate(`${month}-01`).getUTCDay() - context.firstDay + 7) % 7;
  const cells = Array.from({ length: blanks }, () => "<span></span>");
  for (let day = 1; day <= Number(last.slice(8)); day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const items = byDate[date] ?? [];
    const dots = items.slice(0, 3).map((schedule) => `<i style="background:${escapeHtml(categoryOrFallback(schedule.category).color)}"></i>`).join("");
    const label = `${formatDate(date, "long")}: ${items.map((item) => item.name).join(", ") || t("sched.nothing_due")}`;
    cells.push(`
      <button type="button" class="cal-day ${date === context.today ? "cal-day--today" : ""}" style="--i:${day}" data-day="${date}" aria-pressed="${date === view.day}" aria-label="${escapeHtml(label)}">
        <span>${day}</span><span class="cal-day__dots">${dots}</span>
      </button>`);
  }

  const selected = view.day && view.day.startsWith(month) ? byDate[view.day] ?? [] : [];
  const weekdays = weekdayNames(context.firstDay, "narrow").map((name) => `<span class="heat__weekday" aria-hidden="true">${escapeHtml(name)}</span>`).join("");
  return `
    <div class="panel">
      <div class="heat__nav">
        <button type="button" class="btn-round" data-month-step="-1" aria-label="${escapeHtml(t("dashboard.month_previous"))}">${glyph("chevron-left")}</button>
        <span aria-live="polite">${escapeHtml(formatDate(anchor, "monthYear"))}</span>
        <button type="button" class="btn-round" data-month-step="1" aria-label="${escapeHtml(t("dashboard.month_next"))}">${glyph("chevron-right")}</button>
      </div>
      <div class="cal">${weekdays}${cells.join("")}</div>
    </div>
    ${
      view.day
        ? `<section class="section">
            <h2 class="list__header">${escapeHtml(formatDate(view.day, "full"))}</h2>
            ${selected.length ? `<div class="list">${selected.map(scheduleRow).join("")}</div>` : `<p class="t-footnote text-2 section__title">${escapeHtml(t("sched.nothing_due"))}</p>`}
          </section>`
        : ""
    }`;
}

export function renderScheduled(root, options) {
  context = { ...context, ...options };
  root.innerHTML = `
    <div class="view view--narrow">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.scheduled"))}</h1>
      ${pendingSection()}
      ${segmented({ name: "sched-mode", label: t("sched.view"), value: view.mode, options: [{ value: "list", label: t("sched.view_list") }, { value: "calendar", label: t("sched.view_calendar") }] })}
      <div data-sched-body>${view.mode === "list" ? listView() : calendarView()}</div>
    </div>`;

  bindSegmented(root, "sched-mode", (mode) => {
    view.mode = mode;
    renderScheduled(root, context);
  });

  root.querySelector(".view").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-schedule]");
    if (edit) openScheduleEditor(getSchedules().find((row) => row.id === edit.dataset.editSchedule));
    if (event.target.closest("[data-new-schedule]")) openScheduleEditor();

    const step = event.target.closest("[data-month-step]");
    if (step) {
      view.monthOffset += Number(step.dataset.monthStep);
      renderScheduled(root, context);
    }
    const day = event.target.closest("[data-day]");
    if (day) {
      view.day = day.dataset.day;
      renderScheduled(root, context);
    }

    const action = event.target.closest("[data-resolve]");
    if (action) {
      const pendingId = action.closest("[data-pending]").dataset.pending;
      const pending = getPending().find((row) => row.id === pendingId);
      if (action.dataset.resolve === "EDIT") openAmountEditor(pending);
      else await resolve(pendingId, action.dataset.resolve, undefined, action);
    }
  });
}

async function resolve(id, decision, nominal, button) {
  if (button) button.disabled = true;
  try {
    await resolvePending(id, decision, nominal);
    haptic();
    toast(t(decision === "SKIP" ? "sched.skipped" : "sched.confirmed"));
  } catch (error) {
    if (button) button.disabled = false;
    toast(tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR"));
  }
}

function openAmountEditor(pending) {
  showSheet(
    (body) => {
      body.innerHTML = `
        ${sheetHeader({
          title: t("sched.change_amount"),
          leading: `<button type="button" class="btn-plain" data-sheet-dismiss>${escapeHtml(t("common.cancel"))}</button>`,
          trailing: `<button type="button" class="btn-plain btn-plain--strong" data-save>${escapeHtml(t("sched.confirm"))}</button>`,
        })}
        <div class="sheet__body">
          <div class="amount-input">
            <span class="amount-input__prefix" aria-hidden="true">Rp</span>
            <input type="text" inputmode="numeric" name="amount" value="${escapeHtml(formatNumber(pending.amount))}" aria-label="${escapeHtml(t("tx.amount"))}" />
          </div>
          <p class="form-error" role="alert" data-error></p>
        </div>`;
      const input = body.querySelector("[name=amount]");
      bindAmountInput(input);
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
      body.querySelector("[data-save]").addEventListener("click", async () => {
        const amount = parseAmount(input.value);
        if (!amount) {
          body.querySelector("[data-error]").textContent = t("tx.error_amount");
          return;
        }
        closeSheet();
        await resolve(pending.id, "CONFIRM", amount);
      });
    },
    { detent: "half" }
  );
}

/* --- Editor jadwal --- */

function stepper(name, value, min, max, label) {
  return `
    <div class="stepper" role="group" aria-label="${escapeHtml(label)}">
      <button type="button" class="btn-round" data-step="${name}" data-delta="-1" aria-label="${escapeHtml(t("common.decrease"))}">${glyph("minus")}</button>
      <output class="stepper__value tabular" data-value="${name}">${value}</output>
      <button type="button" class="btn-round" data-step="${name}" data-delta="1" aria-label="${escapeHtml(t("common.increase"))}">${glyph("plus")}</button>
    </div>`;
}

const LIMITS = { interval: [1, 365], dayOfMonth: [1, 31], reminderDays: [0, 30], maxRuns: [1, 600] };

export function openScheduleEditor(schedule) {
  const isNew = !schedule;
  const draft = {
    id: createId(),
    name: "",
    type: "OUT",
    category: "",
    amount: 0,
    fund: getFunds().find((row) => row.active)?.id ?? "",
    toFund: "",
    frequency: "MONTHLY",
    interval: 1,
    weekdays: String(toDate(context.today).getUTCDay()),
    dayOfMonth: Number(context.today.slice(8)),
    startDate: context.today,
    endDate: "",
    maxRuns: 0,
    mode: "CONFIRM",
    reminderDays: 1,
    active: true,
    ...schedule,
  };
  let endMode = draft.maxRuns ? "count" : draft.endDate ? "date" : "none";

  showSheet((body) => {
    const render = () => {
      const isTransfer = draft.type === "TRANSFER";
      const categories = getCategories(draft.type === "IN" ? "IN" : "OUT").filter((row) => row.active || row.id === draft.category);
      const fundChoices = (key, selected) =>
        getFunds()
          .filter((row) => row.active || row.id === selected)
          .map((row) => `<button type="button" class="choice" data-${key}="${escapeHtml(row.id)}" aria-pressed="${row.id === selected}">${tile(row.icon, row.color, "sm")}<span>${escapeHtml(row.name)}</span></button>`)
          .join("");
      const weekdays = weekdayNames(1, "short")
        .map((name, index) => {
          const day = (index + 1) % 7;
          const pressed = draft.weekdays.split(",").includes(String(day));
          return `<button type="button" class="chip" data-weekday="${day}" aria-pressed="${pressed}">${escapeHtml(name)}</button>`;
        })
        .join("");

      body.innerHTML = `
        ${sheetHeader({
          title: t(isNew ? "sched.new" : "sched.edit"),
          leading: `<button type="button" class="btn-plain" data-sheet-dismiss>${escapeHtml(t("common.cancel"))}</button>`,
          trailing: `<button type="button" class="btn-plain btn-plain--strong" data-save>${escapeHtml(t("common.save"))}</button>`,
        })}
        <form class="sheet__body" novalidate>
          ${segmented({ name: "sched-type", label: t("tx.type"), value: draft.type, options: ["OUT", "IN", "TRANSFER"].map((value) => ({ value, label: t(`enum.${value}`) })) })}
          <div class="amount-input">
            <span class="amount-input__prefix" aria-hidden="true">Rp</span>
            <input type="text" inputmode="numeric" name="amount" placeholder="0" value="${draft.amount ? escapeHtml(formatNumber(draft.amount)) : ""}" aria-label="${escapeHtml(t("tx.amount"))}" />
          </div>
          <div class="form-group">
            <label class="form-row"><span class="form-row__label">${escapeHtml(t("tx.name"))}</span><input name="name" value="${escapeHtml(draft.name)}" placeholder="${escapeHtml(t("sched.name_placeholder"))}" /></label>
          </div>
          <p class="form-error" role="alert" data-error></p>
          ${isTransfer ? "" : `<div class="section"><h3 class="list__header">${escapeHtml(t("tx.category"))}</h3><div class="choice-grid">${categories.map((row) => `<button type="button" class="choice" data-category="${escapeHtml(row.id)}" aria-pressed="${row.id === draft.category}">${tile(row.icon, row.color, "sm")}<span>${escapeHtml(localizedName(row))}</span></button>`).join("")}</div></div>`}
          <div class="section"><h3 class="list__header">${escapeHtml(isTransfer ? t("tx.from_fund") : t("tx.fund"))}</h3><div class="choice-grid">${fundChoices("fund", draft.fund)}</div></div>
          ${isTransfer ? `<div class="section"><h3 class="list__header">${escapeHtml(t("tx.to_fund"))}</h3><div class="choice-grid">${fundChoices("to-fund", draft.toFund)}</div></div>` : ""}

          <div class="section">
            <h3 class="list__header">${escapeHtml(t("sched.repeat"))}</h3>
            <div class="chips chips--wrap">${FREQUENCIES.map((value) => `<button type="button" class="chip" data-frequency="${value}" aria-pressed="${draft.frequency === value}">${escapeHtml(t(`sched.frequency_${value}`))}</button>`).join("")}</div>
            <div class="form-group">
              ${
                draft.frequency === "DAILY"
                  ? ""
                  : `<div class="form-row"><span class="form-row__label">${escapeHtml(t(`sched.interval_${draft.frequency}`))}</span><span class="row__control">${stepper("interval", draft.interval, ...LIMITS.interval, t("sched.interval"))}</span></div>`
              }
              ${draft.frequency === "WEEKLY" ? `<div class="form-row form-row--stacked"><span class="form-row__label">${escapeHtml(t("sched.weekdays"))}</span><div class="chips chips--wrap">${weekdays}</div></div>` : ""}
              ${draft.frequency === "MONTHLY" ? `<div class="form-row"><span class="form-row__label">${escapeHtml(t("sched.day_of_month"))}</span><span class="row__control">${stepper("dayOfMonth", draft.dayOfMonth || 1, ...LIMITS.dayOfMonth, t("sched.day_of_month"))}</span></div>` : ""}
              <label class="form-row"><span class="form-row__label">${escapeHtml(t("sched.start"))}</span><input type="date" name="startDate" value="${escapeHtml(draft.startDate)}" /></label>
            </div>
            ${draft.frequency === "MONTHLY" && draft.dayOfMonth > 28 ? `<p class="form-note">${escapeHtml(t("sched.short_month_note"))}</p>` : ""}
          </div>

          <div class="section">
            <h3 class="list__header">${escapeHtml(t("sched.ends"))}</h3>
            ${segmented({ name: "sched-end", label: t("sched.ends"), value: endMode, options: [{ value: "none", label: t("sched.ends_never") }, { value: "date", label: t("sched.ends_date") }, { value: "count", label: t("sched.ends_count") }] })}
            ${
              endMode === "date"
                ? `<div class="form-group"><label class="form-row"><span class="form-row__label">${escapeHtml(t("sched.end_date"))}</span><input type="date" name="endDate" value="${escapeHtml(draft.endDate)}" /></label></div>`
                : endMode === "count"
                  ? `<div class="form-group"><div class="form-row"><span class="form-row__label">${escapeHtml(t("sched.max_runs"))}</span><span class="row__control">${stepper("maxRuns", draft.maxRuns || 12, ...LIMITS.maxRuns, t("sched.max_runs"))}</span></div></div>`
                  : ""
            }
          </div>

          <div class="section">
            <h3 class="list__header">${escapeHtml(t("sched.mode"))}</h3>
            ${segmented({ name: "sched-run-mode", label: t("sched.mode"), value: draft.mode, options: ["CONFIRM", "AUTO"].map((value) => ({ value, label: t(`sched.mode_${value}`) })) })}
            <p class="form-note">${escapeHtml(t(`sched.mode_${draft.mode}_help`))}</p>
            <div class="form-group">
              <div class="form-row"><span class="form-row__label">${escapeHtml(t("sched.reminder"))}</span><span class="row__control">${stepper("reminderDays", draft.reminderDays, ...LIMITS.reminderDays, t("sched.reminder"))}</span></div>
            </div>
            <p class="form-note">${escapeHtml(t("sched.reminder_help"))}</p>
          </div>

          ${isNew ? "" : `<button type="button" class="btn ${draft.active ? "btn--destructive" : "btn--secondary"} btn--block" data-toggle-active>${escapeHtml(t(draft.active ? "common.deactivate" : "common.activate"))}</button>`}
        </form>`;
      bind();
    };

    const readForm = () => {
      const elements = body.querySelector("form").elements;
      draft.amount = parseAmount(elements.amount.value) ?? 0;
      draft.name = elements.name.value.trim();
      draft.startDate = elements.startDate.value;
      if (elements.endDate) draft.endDate = elements.endDate.value;
    };
    const rerender = () => {
      readForm();
      const scroll = body.querySelector(".sheet__body").scrollTop;
      render();
      body.querySelector(".sheet__body").scrollTop = scroll;
    };

    const bind = () => {
      body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
      bindAmountInput(body.querySelector("[name=amount]"));
      bindSegmented(body, "sched-type", (type) => {
        readForm();
        draft.type = type;
        if (categoryOrFallback(draft.category).type !== type) draft.category = "";
        rerender();
      });
      bindSegmented(body, "sched-end", (mode) => {
        readForm();
        endMode = mode;
        if (mode !== "count") draft.maxRuns = 0;
        else draft.maxRuns = draft.maxRuns || 12;
        if (mode !== "date") draft.endDate = "";
        rerender();
      });
      bindSegmented(body, "sched-run-mode", (mode) => {
        readForm();
        draft.mode = mode;
        rerender();
      });
      body.querySelector("form").addEventListener("click", (event) => {
        const choice = event.target.closest(".choice");
        if (choice) {
          readForm();
          if (choice.dataset.category) draft.category = choice.dataset.category;
          if (choice.dataset.fund) draft.fund = choice.dataset.fund;
          if (choice.dataset.toFund) draft.toFund = choice.dataset.toFund;
          rerender();
        }
        const frequency = event.target.closest("[data-frequency]");
        if (frequency) {
          readForm();
          draft.frequency = frequency.dataset.frequency;
          draft.interval = draft.frequency === "EVERY_N_DAYS" ? Math.max(draft.interval, 2) : 1;
          rerender();
        }
        const weekday = event.target.closest("[data-weekday]");
        if (weekday) {
          readForm();
          const days = new Set(draft.weekdays.split(",").filter(Boolean));
          if (days.has(weekday.dataset.weekday)) days.delete(weekday.dataset.weekday);
          else days.add(weekday.dataset.weekday);
          draft.weekdays = [...days].sort().join(",");
          rerender();
        }
        const step = event.target.closest("[data-step]");
        if (step) {
          const name = step.dataset.step;
          const [min, max] = LIMITS[name];
          draft[name] = Math.min(max, Math.max(min, (Number(draft[name]) || min) + Number(step.dataset.delta)));
          body.querySelector(`[data-value="${name}"]`).textContent = draft[name];
          haptic();
          if (name === "dayOfMonth") rerender();
        }
      });
      body.querySelector("[data-toggle-active]")?.addEventListener("click", async () => {
        try {
          if (draft.active) await deactivateSchedule(draft.id);
          else await saveSchedule({ ...draft, active: true });
          closeSheet();
          toast(t(draft.active ? "sched.deactivated" : "sched.activated"));
        } catch (error) {
          toast(tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR"));
        }
      });
      body.querySelector("[data-save]").addEventListener("click", save);
    };

    const validate = () => {
      if (!draft.amount) return "tx.error_amount";
      if (!draft.name) return "tx.error_name";
      if (!draft.startDate) return "tx.error_date";
      if (!draft.fund) return "tx.error_fund";
      if (draft.type === "TRANSFER" && (!draft.toFund || draft.toFund === draft.fund)) return "tx.error_transfer";
      if (draft.type !== "TRANSFER" && !draft.category) return "tx.error_category";
      if (draft.frequency === "WEEKLY" && !draft.weekdays) return "sched.error_weekdays";
      if (endMode === "date" && (!draft.endDate || draft.endDate < draft.startDate)) return "sched.error_end";
      return null;
    };

    const save = async () => {
      readForm();
      const error = body.querySelector("[data-error]");
      const problem = validate();
      error.textContent = problem ? t(problem) : "";
      if (problem) {
        replayAnimation(error);
        error.scrollIntoView({ block: "center" });
        return;
      }
      const payload = { ...draft, category: draft.type === "TRANSFER" ? "" : draft.category, toFund: draft.type === "TRANSFER" ? draft.toFund : "", dayOfMonth: draft.frequency === "MONTHLY" ? draft.dayOfMonth : 0 };
      body.querySelector("[data-save]").disabled = true;
      try {
        await saveSchedule(payload);
        closeSheet();
        toast(t("sched.saved"));
      } catch (failure) {
        body.querySelector("[data-save]").disabled = false;
        error.textContent = tError(failure instanceof ApiError ? failure.code : "INTERNAL_ERROR");
        replayAnimation(error);
      }
    };

    render();
  });
}

