/* categories.js: kelola kategori dan sumber dana, termasuk ikon dan warnanya.
   Keduanya memakai editor yang sama, supaya cara mengganti ikon selalu sama. */

import { ApiError } from "./api.js";
import { t, tError, formatCurrency, formatNumber, localizedName, parseAmount } from "./i18n.js";
import { createId, getCategories, getFunds, getTransactions, isCategoryUsed, isFundUsed, mergeCategories, reorder, saveCategory, saveFund } from "./store.js";
import { addDays, balanceSeries, fundBalances, scopeToFund } from "./stats.js";
import { sparkline } from "./dashboard.js";
import { COLOR_CHOICES, EMOJI_CHOICES, ICON_GROUPS, glyph, imageFileToIcon, parseIcon, tile } from "./icons.js";
import { bindAmountInput, bindSegmented, closeSheet, escapeHtml, haptic, initReorder, replayAnimation, segmented, sheetHeader, showSheet, toast } from "./ui.js";

const FUND_KINDS = ["BANK", "EWALLET", "CASH"];

const errorText = (error) => tError(error instanceof ApiError ? error.code : "INTERNAL_ERROR");

function listRow(id, icon, color, title, meta, active, { child = false, sortable = true } = {}) {
  const status = active ? "" : `<span class="row__meta">${escapeHtml(t("common.inactive"))}</span>`;
  return `
    <div class="row ${child ? "row--child" : ""}" ${sortable ? `data-reorder-item="${escapeHtml(id)}"` : ""}>
      <button type="button" class="row-button" data-edit="${escapeHtml(id)}">
        ${tile(icon, color, child ? "sm" : "md")}
        <span class="row__body">
          <span class="row__title">${escapeHtml(title)}</span>
          ${meta ? `<span class="row__meta">${escapeHtml(meta)}</span>` : ""}
          ${status}
        </span>
      </button>
      ${sortable ? `<button type="button" class="btn-round drag-handle" data-reorder-handle aria-label="${escapeHtml(t("cat.reorder", { name: title }))}">${glyph("grip-vertical")}</button>` : ""}
    </div>`;
}

/* Urutan disimpan setelah selesai menyeret. Kalau gagal, daftar digambar ulang dari data. */
function saveOrder(kind, ids, rerender) {
  reorder(kind, ids).catch((error) => {
    toast(errorText(error));
    rerender();
  });
}

export function renderCategories(root) {
  const section = (type, title) => {
    const all = getCategories(type);
    const rows = all
      .filter((category) => !category.parentId)
      .map((category) => {
        const meta = category.budget ? t("cat.budget_value", { amount: formatCurrency(category.budget) }) : "";
        const children = all
          .filter((child) => child.parentId === category.id)
          .map((child) => listRow(child.id, child.icon, child.color, localizedName(child), "", child.active, { child: true, sortable: false }))
          .join("");
        return listRow(category.id, category.icon, category.color, localizedName(category), meta, category.active) + children;
      })
      .join("");
    return `
      <section class="section">
        <h2 class="list__header">${escapeHtml(title)}</h2>
        <div class="list" data-reorder-list="${type}">${rows}</div>
      </section>`;
  };

  root.innerHTML = `
    <div class="view view--narrow">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.categories"))}</h1>
      <p class="t-footnote text-2">${escapeHtml(t("cat.reorder_hint"))}</p>
      ${section("OUT", t("enum.OUT"))}
      ${section("IN", t("enum.IN"))}
    </div>`;

  root.querySelector(".view").addEventListener("click", (event) => {
    const row = event.target.closest("[data-edit]");
    if (row) openCategoryEditor(getCategories().find((item) => item.id === row.dataset.edit));
  });
  root.querySelectorAll("[data-reorder-list]").forEach((list) => {
    initReorder(list, () => {
      const ordered = [...root.querySelectorAll("[data-reorder-item]")].map((row) => row.dataset.reorderItem);
      const children = getCategories().filter((item) => item.parentId).map((item) => item.id);
      saveOrder("categories", ordered.concat(children), () => renderCategories(root));
    });
  });
}

const FUND_TREND_DAYS = 90;
const FUND_CHANGE_DAYS = 30;
const FUND_SPARK_POINTS = 13;

/* Saldo satu sumber dana selama 90 hari terakhir, diambil 13 titik supaya garisnya halus. */
function fundTrend(transactions, fund, today) {
  const series = balanceSeries(scopeToFund(transactions, fund.id), [fund], addDays(today, -(FUND_TREND_DAYS - 1)), today);
  const step = (series.length - 1) / (FUND_SPARK_POINTS - 1);
  return Array.from({ length: FUND_SPARK_POINTS }, (_, index) => series[Math.round(index * step)].value);
}

function fundCard(fund, { balance, total, change, trend }, index) {
  const share = total > 0 && balance > 0 ? Math.round((balance / total) * 100) : 0;
  const tone = change > 0 ? "positive" : change < 0 ? "critical" : "neutral";
  const changeText = change === 0 ? t("fund.change_none") : t("fund.change_30", { amount: `${change > 0 ? "+" : ""}${formatCurrency(change)}` });
  return `
    <article class="fund-card fund-card--${tone} ${fund.active ? "" : "is-inactive"}" style="--i:${index};--_fund:${escapeHtml(fund.color)}" data-reorder-item="${escapeHtml(fund.id)}">
      <button type="button" class="fund-card__main" data-edit="${escapeHtml(fund.id)}" aria-label="${escapeHtml(`${fund.name}, ${formatCurrency(balance)}`)}">
        <span class="fund-card__head">
          ${tile(fund.icon, fund.color, "md")}
          <span class="fund-card__names">
            <span class="fund-card__name">${escapeHtml(fund.name)}</span>
            <span class="fund-card__kind">${escapeHtml(fund.active ? t(`enum.${fund.kind}`) : `${t(`enum.${fund.kind}`)}, ${t("common.inactive")}`)}</span>
          </span>
        </span>
        <span class="fund-card__figure">
          <span>
            <span class="fund-card__balance tabular">${escapeHtml(formatCurrency(balance))}</span>
            <span class="fund-card__label">${escapeHtml(t("fund.share", { percent: share }))}</span>
          </span>
          ${sparkline(trend)}
        </span>
        <span class="fund-card__bar" aria-hidden="true"><span style="width:${share}%"></span></span>
        <span class="fund-card__change">${escapeHtml(changeText)}</span>
      </button>
      <button type="button" class="btn-round drag-handle fund-card__handle" data-reorder-handle aria-label="${escapeHtml(t("cat.reorder", { name: fund.name }))}">${glyph("grip-vertical")}</button>
    </article>`;
}

export function renderFunds(root, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const transactions = getTransactions();
  const funds = getFunds();
  const balances = fundBalances(transactions, funds);
  const before = fundBalances(transactions, funds, addDays(today, -FUND_CHANGE_DAYS));
  const total = funds.filter((fund) => fund.active).reduce((sum, fund) => sum + Math.max(balances.get(fund.id), 0), 0);
  const cards = funds
    .map((fund, index) =>
      fundCard(
        fund,
        {
          balance: balances.get(fund.id),
          total: fund.active ? total : 0,
          change: balances.get(fund.id) - before.get(fund.id),
          trend: fundTrend(transactions, fund, today),
        },
        index
      )
    )
    .join("");

  root.innerHTML = `
    <div class="view">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("nav.funds"))}</h1>
      <div class="fund-total">
        <span class="field__label">${escapeHtml(t("dashboard.total_balance"))}</span>
        <span class="fund-total__value tabular">${escapeHtml(formatCurrency(total))}</span>
      </div>
      <p class="t-footnote text-2">${escapeHtml(t("fund.reorder_hint"))}</p>
      <div class="fund-grid" data-reorder-list="funds" data-reorder-layout="grid">${cards}</div>
    </div>`;

  root.querySelector(".view").addEventListener("click", (event) => {
    const card = event.target.closest("[data-edit]");
    if (card) openFundEditor(getFunds().find((item) => item.id === card.dataset.edit));
  });
  initReorder(root.querySelector("[data-reorder-list]"), (ids) => saveOrder("funds", ids, () => renderFunds(root, { today })));
}

/* --- Pemilih ikon --- */

function colorRow(draft) {
  const dots = COLOR_CHOICES.map(
    (color) => `<button type="button" class="color-dot" style="--_color:${color}" data-color="${color}" aria-pressed="${draft.color === color}" aria-label="${color}"></button>`
  ).join("");
  return `
    <div class="color-row">
      ${dots}
      <label class="color-dot color-dot--custom" aria-pressed="${!COLOR_CHOICES.includes(draft.color)}">
        <span class="visually-hidden">${escapeHtml(t("icon.custom_color"))}</span>
        <input type="color" value="${escapeHtml(draft.color)}" data-custom-color />
      </label>
    </div>`;
}

function iconTab(draft) {
  const current = parseIcon(draft.icon);
  const groups = ICON_GROUPS.map(
    (group) => `
    <div class="icon-group">
      <h4 class="list__header">${escapeHtml(t(`icon.group_${group.key}`))}</h4>
      <div class="icon-grid">
        ${group.icons
          .map((name) => `<button type="button" class="icon-option" data-icon-value="lucide:${name}" aria-pressed="${current.type === "lucide" && current.data === name}" aria-label="${name}">${glyph(name)}</button>`)
          .join("")}
      </div>
    </div>`
  ).join("");
  return `<div class="icon-grid-wrap">${groups}</div>`;
}

function emojiTab(draft) {
  const current = parseIcon(draft.icon);
  const options = EMOJI_CHOICES.map(
    (emoji) => `<button type="button" class="icon-option" data-icon-value="emoji:${emoji}" aria-pressed="${current.type === "emoji" && current.data === emoji}">${emoji}</button>`
  ).join("");
  return `
    <div class="form-group">
      <label class="form-row">
        <span class="form-row__label">${escapeHtml(t("icon.emoji_own"))}</span>
        <input type="text" maxlength="8" data-emoji-input value="${current.type === "emoji" ? escapeHtml(current.data) : ""}" placeholder="🙂" />
      </label>
    </div>
    <div class="icon-grid-wrap"><div class="icon-grid">${options}</div></div>`;
}

function imageTab(draft) {
  const hasImage = parseIcon(draft.icon).type === "image";
  return `
    <div class="panel" data-image-panel>
      <p class="t-footnote text-2">${escapeHtml(t("icon.image_hint"))}</p>
      <label class="btn btn--secondary btn--block">
        ${glyph("upload")}<span>${escapeHtml(t(hasImage ? "icon.image_replace" : "icon.image_choose"))}</span>
        <input type="file" accept="image/*" class="visually-hidden" data-image-file />
      </label>
      <p class="form-error" role="alert" data-image-error></p>
    </div>`;
}

const TAB_RENDERERS = { lucide: iconTab, emoji: emojiTab, image: imageTab };

function bindIconPicker(body, draft) {
  const preview = body.querySelector("[data-preview]");
  const colors = body.querySelector("[data-colors]");
  const panel = body.querySelector("[data-icon-panel]");
  let tab = parseIcon(draft.icon).type;

  const paint = () => {
    preview.innerHTML = tile(draft.icon, draft.color, "lg");
    colors.innerHTML = colorRow(draft);
  };
  const paintPanel = () => {
    panel.innerHTML = TAB_RENDERERS[tab](draft);
    paint();
  };

  bindSegmented(body, "icon-source", (value) => {
    tab = value;
    paintPanel();
  });

  colors.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-color]");
    if (!dot) return;
    draft.color = dot.dataset.color;
    paint();
    haptic();
  });
  colors.addEventListener("change", (event) => {
    if (!event.target.matches("[data-custom-color]")) return;
    draft.color = event.target.value;
    paint();
  });

  panel.addEventListener("click", (event) => {
    const option = event.target.closest("[data-icon-value]");
    if (!option) return;
    draft.icon = option.dataset.iconValue;
    panel.querySelectorAll('[aria-pressed="true"]').forEach((element) => element.setAttribute("aria-pressed", "false"));
    option.setAttribute("aria-pressed", "true");
    paint();
    haptic();
  });

  panel.addEventListener("input", (event) => {
    if (!event.target.matches("[data-emoji-input]")) return;
    const value = event.target.value.trim();
    if (value) {
      draft.icon = `emoji:${value}`;
      paint();
    }
  });

  panel.addEventListener("change", async (event) => {
    if (!event.target.matches("[data-image-file]")) return;
    const [file] = event.target.files;
    if (!file) return;
    try {
      draft.icon = await imageFileToIcon(file);
      paintPanel();
    } catch {
      panel.querySelector("[data-image-error]").textContent = t("icon.image_error");
    }
  });

  paintPanel();
}

function iconSection(draft) {
  const source = parseIcon(draft.icon).type;
  return `
    <div class="section">
      <h3 class="list__header">${escapeHtml(t("icon.color"))}</h3>
      <div data-colors></div>
    </div>
    <div class="section">
      <h3 class="list__header">${escapeHtml(t("icon.title"))}</h3>
      ${segmented({
        name: "icon-source",
        label: t("icon.title"),
        value: source,
        options: [
          { value: "lucide", label: t("icon.tab_icon") },
          { value: "emoji", label: t("icon.tab_emoji") },
          { value: "image", label: t("icon.tab_image") },
        ],
      })}
      <div class="section" data-icon-panel></div>
    </div>`;
}

function editorShell(body, { title, fields, draft, onSave, onToggleActive, isNew, extra = "" }) {
  body.innerHTML = `
    ${sheetHeader({
      title,
      leading: `<button type="button" class="btn-plain" data-sheet-dismiss>${escapeHtml(t("common.cancel"))}</button>`,
      trailing: `<button type="button" class="btn-plain btn-plain--strong" data-save>${escapeHtml(t("common.save"))}</button>`,
    })}
    <form class="sheet__body" novalidate>
      <div class="icon-preview" data-preview></div>
      <div class="form-group">${fields}</div>
      <p class="form-error" role="alert" data-error></p>
      ${iconSection(draft)}
      ${extra}
      ${
        isNew
          ? ""
          : `<button type="button" class="btn ${draft.active ? "btn--destructive" : "btn--secondary"} btn--block" data-toggle-active>${escapeHtml(t(draft.active ? "common.deactivate" : "common.activate"))}</button>`
      }
    </form>`;

  const form = body.querySelector("form");
  bindIconPicker(body, draft);
  body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
  const error = body.querySelector("[data-error]");
  const showError = (text) => {
    error.textContent = text;
    replayAnimation(error);
  };
  body.querySelector("[data-toggle-active]")?.addEventListener("click", async () => {
    try {
      await onToggleActive();
    } catch (failure) {
      showError(errorText(failure));
    }
  });

  /* onSave mengembalikan key pesan kalau isian salah, atau melempar error dari server. */
  const submit = async () => {
    const save = body.querySelector("[data-save]");
    save.disabled = true;
    try {
      const problem = await onSave(form);
      if (problem) showError(t(problem));
      else closeSheet();
    } catch (failure) {
      showError(errorText(failure));
    } finally {
      save.disabled = false;
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  body.querySelector("[data-save]").addEventListener("click", submit);
}

function textRow(label, name, value, placeholder = "") {
  return `
    <label class="form-row">
      <span class="form-row__label">${escapeHtml(label)}</span>
      <input type="text" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
    </label>`;
}

function amountRow(label, name, value) {
  return `
    <label class="form-row">
      <span class="form-row__label">${escapeHtml(label)}</span>
      <input type="text" inputmode="numeric" name="${name}" value="${value ? escapeHtml(formatNumber(value)) : ""}" placeholder="0" autocomplete="off" />
    </label>`;
}

function bindAmountRows(body) {
  body.querySelectorAll('input[inputmode="numeric"]').forEach((input) => {
    bindAmountInput(input);
  });
}

export function openCategoryEditor(category) {
  const isNew = !category;
  const draft = {
    id: createId(),
    nameId: "",
    nameEn: "",
    type: "OUT",
    icon: "lucide:tag",
    color: "#007aff",
    budget: 0,
    active: true,
    ...category,
  };

  const parentOptions = () => {
    const hasChildren = getCategories().some((item) => item.parentId === draft.id);
    if (hasChildren) return "";
    const options = getCategories(draft.type)
      .filter((item) => !item.parentId && item.id !== draft.id && item.active)
      .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === draft.parentId ? "selected" : ""}>${escapeHtml(localizedName(item))}</option>`)
      .join("");
    return `
      <label class="form-row">
        <span class="form-row__label">${escapeHtml(t("cat.parent"))}</span>
        <select name="parentId"><option value="">${escapeHtml(t("cat.parent_none"))}</option>${options}</select>
      </label>`;
  };

  showSheet((body) => {
    const render = () => {
      const typeRow = isNew
        ? `<div class="form-row form-row--stacked">${segmented({ name: "category-type", label: t("tx.type"), value: draft.type, options: ["OUT", "IN"].map((value) => ({ value, label: t(`enum.${value}`) })) })}</div>`
        : "";
      const merge = isNew || !draft.active ? "" : `<button type="button" class="btn btn--secondary btn--block" data-merge>${glyph("merge")}<span>${escapeHtml(t("cat.merge"))}</span></button>`;

      editorShell(body, {
        title: t(isNew ? "cat.new" : "cat.edit"),
        draft,
        isNew,
        extra: merge,
        fields: `
          ${typeRow}
          ${textRow(t("cat.name_id"), "nameId", draft.nameId, t("cat.name_placeholder"))}
          ${textRow(t("cat.name_en"), "nameEn", draft.nameEn, t("common.optional"))}
          ${parentOptions()}
          ${draft.type === "OUT" && !draft.parentId ? amountRow(t("cat.budget"), "budget", draft.budget) : ""}`,
        async onSave(form) {
          draft.nameId = form.elements.nameId.value.trim();
          draft.nameEn = form.elements.nameEn.value.trim();
          draft.parentId = form.elements.parentId?.value ?? draft.parentId ?? "";
          /* Budget hanya berlaku untuk kategori pengeluaran utama; sub-kategori ikut dihitung ke induknya. */
          draft.budget = form.elements.budget && !draft.parentId ? parseAmount(form.elements.budget.value) ?? 0 : 0;
          if (!draft.nameId && !draft.nameEn) return "cat.error_name";
          await saveCategory({ ...draft });
          toast(t("cat.saved"));
          return null;
        },
        async onToggleActive() {
          await saveCategory({ ...draft, active: !draft.active });
          closeSheet();
          toast(t(draft.active ? (isCategoryUsed(draft.id) ? "cat.deactivated_used" : "cat.deactivated") : "cat.activated"));
        },
      });

      if (isNew) {
        bindSegmented(body, "category-type", (type) => {
          draft.type = type;
          draft.parentId = "";
          const values = { nameId: body.querySelector("[name=nameId]").value, nameEn: body.querySelector("[name=nameEn]").value };
          render();
          body.querySelector("[name=nameId]").value = values.nameId;
          body.querySelector("[name=nameEn]").value = values.nameEn;
        });
      }
      body.querySelector("[data-merge]")?.addEventListener("click", () => openMerge(draft));
      bindAmountRows(body);
    };
    render();
  });
}

/* Gabungkan: semua transaksi kategori ini pindah ke kategori lain, lalu yang ini nonaktif. */
function openMerge(source) {
  const targets = getCategories(source.type).filter((item) => item.id !== source.id && item.active);
  showSheet((body) => {
    body.innerHTML = `
      ${sheetHeader({ title: t("cat.merge") })}
      <div class="sheet__body">
        <p class="t-subhead text-2">${escapeHtml(t("cat.merge_help", { name: localizedName(source) }))}</p>
        <div class="list">${targets
          .map((item) => `
            <button type="button" class="row" data-target="${escapeHtml(item.id)}">
              ${tile(item.icon, item.color, "sm")}
              <span class="row__body">${escapeHtml(localizedName(item))}</span>
              ${glyph("chevron-right", "icon row__chevron")}
            </button>`)
          .join("")}</div>
        <p class="form-error" role="alert" data-error></p>
      </div>`;
    body.querySelector("[data-sheet-dismiss]").addEventListener("click", closeSheet);
    body.querySelectorAll("[data-target]").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = targets.find((item) => item.id === button.dataset.target);
        if (!window.confirm(t("cat.merge_confirm", { from: localizedName(source), to: localizedName(target) }))) return;
        try {
          const moved = await mergeCategories(source.id, target.id);
          closeSheet();
          toast(t("cat.merged", { count: moved }));
        } catch (error) {
          body.querySelector("[data-error]").textContent = errorText(error);
        }
      });
    });
  });
}

export function openFundEditor(fund) {
  const isNew = !fund;
  const draft = {
    id: createId(),
    name: "",
    kind: "BANK",
    openingBalance: 0,
    icon: "lucide:wallet",
    color: "#007aff",
    active: true,
    ...fund,
  };

  showSheet((body) => {
    editorShell(body, {
      title: t(isNew ? "fund.new" : "fund.edit"),
      draft,
      isNew,
      fields: `
        <div class="form-row form-row--stacked">${segmented({ name: "fund-kind", label: t("fund.kind"), value: draft.kind, options: FUND_KINDS.map((value) => ({ value, label: t(`enum.${value}`) })) })}</div>
        ${textRow(t("fund.name"), "name", draft.name, t("fund.name_placeholder"))}
        ${amountRow(t("fund.opening"), "openingBalance", draft.openingBalance)}`,
      async onSave(form) {
        draft.name = form.elements.name.value.trim();
        draft.openingBalance = parseAmount(form.elements.openingBalance.value) ?? 0;
        if (!draft.name) return "fund.error_name";
        await saveFund({ ...draft });
        toast(t("fund.saved"));
        return null;
      },
      async onToggleActive() {
        await saveFund({ ...draft, active: !draft.active });
        closeSheet();
        toast(t(draft.active ? (isFundUsed(draft.id) ? "fund.deactivated_used" : "fund.deactivated") : "fund.activated"));
      },
    });

    bindSegmented(body, "fund-kind", (kind) => { draft.kind = kind; });
    bindAmountRows(body);
  });
}
