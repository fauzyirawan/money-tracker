/* scan.js: alur scan struk.
   Foto -> potong dan putar -> dibaca AI -> halaman konfirmasi -> Simpan -> foto ke Drive.
   Tidak ada yang masuk Google Sheets sebelum kamu menekan Simpan.
   Tanpa koneksi, foto disimpan dulu di perangkat untuk di-scan nanti. */

import { ApiError, api, isDemoMode } from "./api.js";
import { dbDelete, dbGet, dbKeys, dbSet } from "./db.js";
import { t, tError, formatCurrency, formatDate, formatNumber, localizedName, parseAmount } from "./i18n.js";
import { exportImage, imageDataUrl, isImageFile, openImage, previewUrl } from "./image.js";
import { applyScanCommit, createId, getCategories, getCategory, getFunds } from "./store.js";
import { enqueuePhoto } from "./offline.js";
import { glyph, tile } from "./icons.js";
import { bindSegmented, closeSheet, escapeHtml, haptic, replayAnimation, segmented, sheetHeader, showSheet, toast } from "./ui.js";
import { openForm } from "./transactions.js";

const LOW_CONFIDENCE = 0.7;
const WAITING_PREFIX = "scanq:";
const TIPS = ["scan.tip_light", "scan.tip_flat", "scan.tip_full"];

let context = { today: "", onSaved: () => {} };

export function setScanContext(value) {
  context = { ...context, ...value };
}

/* --- Halaman Scan --- */

async function waitingPhotos() {
  const keys = await dbKeys(WAITING_PREFIX);
  const photos = await Promise.all(keys.map(async (key) => ({ key, ...(await dbGet(key)) })));
  return photos.filter((photo) => photo.data).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function renderWaiting(root) {
  const holder = root.querySelector("[data-waiting]");
  if (!holder) return;
  const photos = await waitingPhotos();
  if (!photos.length) {
    holder.innerHTML = "";
    return;
  }
  holder.innerHTML = `
    <section class="section">
      <div class="section__head">
        <h2 class="t-headline">${escapeHtml(t("scan.waiting_title", { count: photos.length }))}</h2>
        <button type="button" class="btn btn--primary" data-scan-waiting ${navigator.onLine ? "" : "disabled"}>${escapeHtml(t("scan.scan_now"))}</button>
      </div>
      <div class="scan-thumbs">${photos
        .map((photo) => `
          <div class="scan-thumb">
            <img src="${imageDataUrl(photo)}" alt="" />
            <button type="button" class="btn-circle" data-drop-waiting="${escapeHtml(photo.key)}" aria-label="${escapeHtml(t("common.delete"))}">${glyph("x")}</button>
          </div>`)
        .join("")}</div>
      <p class="t-footnote text-2">${escapeHtml(t(navigator.onLine ? "scan.waiting_ready" : "scan.waiting_offline"))}</p>
    </section>`;
  holder.querySelector("[data-scan-waiting]")?.addEventListener("click", async () => {
    for (const photo of await waitingPhotos()) {
      const done = await scanPrepared({ mime: photo.mime, data: photo.data });
      if (done !== "offline") await dbDelete(photo.key);
      if (done === "stop") break;
    }
    renderWaiting(root);
  });
  holder.querySelectorAll("[data-drop-waiting]").forEach((button) => {
    button.addEventListener("click", async () => {
      await dbDelete(button.dataset.dropWaiting);
      renderWaiting(root);
    });
  });
}

export function renderScan(root) {
  root.innerHTML = `
    <div class="view view--narrow">
      <h1 class="t-large-title view__title" data-title>${escapeHtml(t("scan.title"))}</h1>
      <div class="panel scan-drop" data-drop-zone>
        <div class="scan-visual" aria-hidden="true">${glyph("receipt-text")}<span class="scan-visual__beam"></span></div>
        <p class="t-headline">${escapeHtml(t("scan.prompt"))}</p>
        <p class="t-subhead text-2">${escapeHtml(t("scan.hint"))}</p>
        <div class="button-row">
          <label class="btn btn--primary">${glyph("camera")}<span>${escapeHtml(t("scan.take_photo"))}</span>
            <input type="file" accept="image/*" capture="environment" class="visually-hidden" data-scan-input />
          </label>
          <label class="btn btn--secondary">${glyph("image")}<span>${escapeHtml(t("scan.from_gallery"))}</span>
            <input type="file" accept="image/*,.heic,.heif" multiple class="visually-hidden" data-scan-input />
          </label>
        </div>
        <p class="t-footnote text-2 scan-drop__pc">${escapeHtml(t("scan.drop_hint"))}</p>
      </div>
      <div data-waiting></div>
      <div class="panel">
        <h2 class="t-headline">${escapeHtml(t("scan.tips_title"))}</h2>
        ${TIPS.map((key) => `<p class="note">${glyph("circle-check")}<span>${escapeHtml(t(key))}</span></p>`).join("")}
      </div>
    </div>`;

  root.querySelectorAll("[data-scan-input]").forEach((input) => {
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      scanFiles(files).then(() => renderWaiting(root));
    });
  });

  const zone = root.querySelector("[data-drop-zone]");
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("is-dragging");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-dragging"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
    scanFiles([...event.dataTransfer.files]).then(() => renderWaiting(root));
  });
  renderWaiting(root);
}

/* Foto diproses satu per satu: tiap foto selesai disimpan atau dibatalkan dulu. */
export async function scanFiles(files) {
  const images = files.filter(isImageFile);
  if (!images.length) {
    if (files.length) toast(t("scan.not_image"));
    return;
  }
  for (const file of images) {
    let opened;
    try {
      opened = await openImage(file);
    } catch {
      toast(t("scan.not_image"));
      continue;
    }
    const prepared = await editImage(opened);
    if (!prepared) continue;
    const done = await scanPrepared(prepared);
    if (done === "stop") break;
  }
}

/* --- Editor potong dan putar --- */

const MIN_CROP = 0.08;

function editImage(image) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };

    showSheet(
      (body) => {
        body.innerHTML = `
          ${sheetHeader({
            title: t("scan.edit_title"),
            leading: `<button type="button" class="btn-plain" data-cancel>${escapeHtml(t("common.cancel"))}</button>`,
            trailing: `<button type="button" class="btn-plain btn-plain--strong" data-go-scan>${escapeHtml(t("scan.scan"))}</button>`,
          })}
          <div class="sheet__body">
            <div class="crop" data-crop>
              <img alt="" data-crop-image />
              <div class="crop__box" data-crop-box>
                ${["nw", "ne", "sw", "se"].map((corner) => `<span class="crop__handle crop__handle--${corner}" data-handle="${corner}"></span>`).join("")}
              </div>
            </div>
            <div class="button-row">
              <button type="button" class="btn btn--secondary" data-rotate>${glyph("rotate-ccw")}<span>${escapeHtml(t("scan.rotate"))}</span></button>
              <button type="button" class="btn btn--secondary" data-reset-crop>${escapeHtml(t("scan.reset_crop"))}</button>
            </div>
            <p class="t-footnote text-2">${escapeHtml(t("scan.edit_hint"))}</p>
          </div>`;

        const img = body.querySelector("[data-crop-image]");
        const box = body.querySelector("[data-crop-box]");
        const paint = () => {
          const { x, y, width, height } = image.crop;
          box.style.left = `${x * 100}%`;
          box.style.top = `${y * 100}%`;
          box.style.width = `${width * 100}%`;
          box.style.height = `${height * 100}%`;
        };
        const refresh = () => {
          img.src = previewUrl(image);
          paint();
        };

        let drag = null;
        const startDrag = (event, handle) => {
          event.preventDefault();
          drag = { handle, startX: event.clientX, startY: event.clientY, crop: { ...image.crop }, rect: img.getBoundingClientRect() };
          event.target.setPointerCapture(event.pointerId);
        };
        box.addEventListener("pointerdown", (event) => startDrag(event, event.target.dataset.handle ?? "move"));
        box.addEventListener("pointermove", (event) => {
          if (!drag) return;
          const dx = (event.clientX - drag.startX) / drag.rect.width;
          const dy = (event.clientY - drag.startY) / drag.rect.height;
          const start = drag.crop;
          let { x, y, width, height } = start;
          if (drag.handle === "move") {
            x = Math.min(Math.max(start.x + dx, 0), 1 - start.width);
            y = Math.min(Math.max(start.y + dy, 0), 1 - start.height);
          } else {
            if (drag.handle.includes("w")) {
              x = Math.min(Math.max(start.x + dx, 0), start.x + start.width - MIN_CROP);
              width = start.x + start.width - x;
            }
            if (drag.handle.includes("e")) width = Math.min(Math.max(start.width + dx, MIN_CROP), 1 - start.x);
            if (drag.handle.includes("n")) {
              y = Math.min(Math.max(start.y + dy, 0), start.y + start.height - MIN_CROP);
              height = start.y + start.height - y;
            }
            if (drag.handle.includes("s")) height = Math.min(Math.max(start.height + dy, MIN_CROP), 1 - start.y);
          }
          image.crop = { x, y, width, height };
          paint();
        });
        const endDrag = () => {
          drag = null;
        };
        box.addEventListener("pointerup", endDrag);
        box.addEventListener("pointercancel", endDrag);

        body.querySelector("[data-rotate]").addEventListener("click", () => {
          image.rotation = (image.rotation + 270) % 360;
          image.crop = { x: 0, y: 0, width: 1, height: 1 };
          refresh();
          haptic();
        });
        body.querySelector("[data-reset-crop]").addEventListener("click", () => {
          image.crop = { x: 0, y: 0, width: 1, height: 1 };
          paint();
        });
        body.querySelector("[data-cancel]").addEventListener("click", () => {
          finish(null);
          closeSheet();
        });
        body.querySelector("[data-go-scan]").addEventListener("click", async (event) => {
          event.currentTarget.disabled = true;
          finish(await exportImage(image));
        });
        refresh();
      },
      { onClose: () => finish(null) }
    );
  });
}

/* --- Membaca struk --- */

function showScanning(image) {
  showSheet((body) => {
    body.innerHTML = `
      ${sheetHeader({ title: t("scan.scanning_title"), leading: "<span></span>" })}
      <div class="sheet__body">
        <div class="scanning" role="status" aria-live="polite">
          <img src="${imageDataUrl(image)}" alt="" />
          <span class="scanning__beam"></span>
        </div>
        <p class="t-headline scanning__text">${escapeHtml(t("scan.scanning"))}</p>
      </div>`;
  });
}

/* Hasil: "saved", "cancel", "offline", atau "stop" kalau antrean foto sebaiknya berhenti. */
async function scanPrepared(image) {
  if (isDemoMode()) {
    toast(tError("SCAN_DEMO"));
    closeSheet();
    return "stop";
  }
  if (!navigator.onLine) {
    await dbSet(WAITING_PREFIX + createId(), { ...image, createdAt: new Date().toISOString() });
    closeSheet();
    toast(t("scan.saved_for_later"));
    return "offline";
  }
  showScanning(image);
  try {
    const { data } = await api("scan.extract", { imageBase64: image.data, mime: image.mime });
    return await confirmDraft(data.draft, image, data.merchantMatched);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
    if (code === "OFFLINE" || code === "NETWORK_ERROR" || code === "TIMEOUT") {
      await dbSet(WAITING_PREFIX + createId(), { ...image, createdAt: new Date().toISOString() });
      closeSheet();
      toast(t("scan.saved_for_later"));
      return "offline";
    }
    return showScanError(code, error.details?.draft ?? null, image);
  }
}

function showScanError(code, draft, image) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };
    const showTips = ["SCAN_FAILED_BLURRY", "SCAN_FAILED_NOT_RECEIPT", "SCAN_INVALID_RESPONSE"].includes(code);
    showSheet(
      (body) => {
        body.innerHTML = `
          ${sheetHeader({ title: t("scan.failed_title") })}
          <div class="sheet__body">
            <div class="scan-error">
              <span class="finding__badge finding--critical">${glyph("triangle-alert")}</span>
              <p class="t-headline">${escapeHtml(tError(code))}</p>
            </div>
            ${showTips ? `<div class="panel">${TIPS.map((key) => `<p class="note">${glyph("lightbulb")}<span>${escapeHtml(t(key))}</span></p>`).join("")}</div>` : ""}
            <div class="detail-actions">
              <button type="button" class="btn btn--secondary" data-retry>${glyph("rotate-ccw")}${escapeHtml(t("scan.retry"))}</button>
              <button type="button" class="btn btn--secondary" data-manual>${glyph("pencil")}${escapeHtml(t("scan.manual"))}</button>
              <button type="button" class="btn btn--destructive" data-cancel>${glyph("x")}${escapeHtml(t("common.cancel"))}</button>
            </div>
          </div>`;
        body.querySelector("[data-sheet-dismiss]").addEventListener("click", () => {
          finish("cancel");
          closeSheet();
        });
        body.querySelector("[data-cancel]").addEventListener("click", () => {
          finish("cancel");
          closeSheet();
        });
        body.querySelector("[data-retry]").addEventListener("click", async () => finish(await scanPrepared(image)));
        body.querySelector("[data-manual]").addEventListener("click", () => {
          finish("cancel");
          openForm({ defaults: draftToDefaults(draft), photo: image });
        });
      },
      { onClose: () => finish("cancel") }
    );
  });
}

/* Data yang sempat terbaca dipakai untuk mengisi form manual. */
function draftToDefaults(draft) {
  if (!draft) return {};
  const defaults = { inputMethod: "SCAN" };
  if (draft.type) defaults.type = draft.type;
  if (draft.amount) defaults.amount = draft.amount;
  if (draft.name || draft.merchant) defaults.name = draft.name || draft.merchant;
  if (draft.merchant) defaults.merchant = draft.merchant;
  if (draft.date) defaults.date = draft.date;
  if (draft.time) defaults.time = draft.time;
  if (draft.category) defaults.category = draft.category;
  if (draft.fund) defaults.fund = draft.fund;
  if (draft.referenceNo) defaults.referenceNo = draft.referenceNo;
  return defaults;
}

/* --- Halaman konfirmasi --- */

function warnClass(value) {
  return value < LOW_CONFIDENCE ? "is-uncertain" : "";
}

function warnMark(value) {
  return value < LOW_CONFIDENCE ? `<span class="uncertain-mark" title="${escapeHtml(t("scan.low_confidence"))}">${glyph("triangle-alert")}<span class="visually-hidden">${escapeHtml(t("scan.low_confidence"))}</span></span>` : "";
}

function choiceButtons(key, rows, selected, nameOf) {
  return rows
    .filter((row) => row.active)
    .map((row) => `
      <button type="button" class="choice" data-${key}="${escapeHtml(row.id)}" aria-pressed="${row.id === selected}">
        ${tile(row.icon, row.color, "sm")}<span>${escapeHtml(nameOf(row))}</span>
      </button>`)
    .join("");
}

function itemRow(item, index) {
  return `
    <div class="scan-item" data-item="${index}">
      <input class="field__control" name="item-name" value="${escapeHtml(item.name)}" aria-label="${escapeHtml(t("scan.item_name"))}" />
      <input class="field__control" name="item-qty" inputmode="decimal" value="${escapeHtml(formatNumber(item.quantity))}" aria-label="${escapeHtml(t("scan.item_qty"))}" />
      <input class="field__control" name="item-price" inputmode="numeric" value="${escapeHtml(formatNumber(item.price))}" aria-label="${escapeHtml(t("scan.item_price"))}" />
      <button type="button" class="btn-round" data-remove-item="${index}" aria-label="${escapeHtml(t("common.delete"))}">${glyph("x")}</button>
    </div>`;
}

function splitRow(part, index, type) {
  const options = getCategories(type)
    .filter((row) => row.active)
    .map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === part.category ? "selected" : ""}>${escapeHtml(localizedName(row))}</option>`)
    .join("");
  return `
    <div class="scan-split" data-split="${index}">
      <select class="field__control" name="split-category" aria-label="${escapeHtml(t("tx.category"))}"><option value="">-</option>${options}</select>
      <input class="field__control" name="split-amount" inputmode="numeric" value="${part.amount ? escapeHtml(formatNumber(part.amount)) : ""}" placeholder="0" aria-label="${escapeHtml(t("tx.amount"))}" />
      <button type="button" class="btn-round" data-remove-split="${index}" aria-label="${escapeHtml(t("common.delete"))}">${glyph("x")}</button>
    </div>`;
}

function confirmDraft(draft, image, merchantMatched) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };

    const suggestion = { category: draft.category, fund: draft.fund };
    const state = {
      type: draft.type || "OUT",
      amount: draft.amount || 0,
      name: draft.name || draft.merchant || "",
      merchant: draft.merchant || "",
      date: draft.date || context.today,
      time: draft.time || "12:00",
      category: draft.category || "",
      fund: draft.fund || getFunds().find((row) => row.active)?.id || "",
      toFund: "",
      referenceNo: draft.referenceNo || "",
      note: "",
      items: draft.items.map((item) => ({ ...item })),
      split: false,
      parts: [],
      force: false,
    };
    const confidence = draft.confidence;

    showSheet(
      (body) => {
        const render = () => {
          const isTransfer = state.type === "TRANSFER";
          const categories = getCategories(state.type === "IN" ? "IN" : "OUT");
          const splitTotal = state.parts.reduce((total, part) => total + (part.amount || 0), 0);
          body.innerHTML = `
            ${sheetHeader({
              title: t("scan.confirm_title"),
              leading: `<button type="button" class="btn-plain" data-cancel>${escapeHtml(t("common.cancel"))}</button>`,
              trailing: `<button type="button" class="btn-plain btn-plain--strong" data-save>${escapeHtml(t("common.save"))}</button>`,
            })}
            <form class="sheet__body scan-confirm" novalidate>
              <div class="scan-photo" data-zoom tabindex="0" role="button" aria-label="${escapeHtml(t("scan.zoom"))}">
                <img src="${imageDataUrl(image)}" alt="${escapeHtml(t("scan.photo_alt"))}" />
              </div>
              <div class="scan-fields">
                <p class="t-footnote text-2">${escapeHtml(t(`scan.document_${draft.documentType}`))}${draft.sourceApp ? `, ${escapeHtml(draft.sourceApp)}` : ""}${merchantMatched ? `. ${escapeHtml(t("scan.from_memory"))}` : ""}</p>
                <div data-duplicate></div>
                ${segmented({ name: "scan-type", label: t("tx.type"), value: state.type, options: ["OUT", "IN", "TRANSFER"].map((value) => ({ value, label: t(`enum.${value}`) })) })}
                <div class="amount-input ${warnClass(confidence.amount)}">
                  <span class="amount-input__prefix" aria-hidden="true">Rp</span>
                  <input type="text" inputmode="numeric" name="amount" value="${state.amount ? escapeHtml(formatNumber(state.amount)) : ""}" aria-label="${escapeHtml(t("tx.amount"))}" />
                  ${warnMark(confidence.amount)}
                </div>
                <div class="form-group">
                  <label class="form-row"><span class="form-row__label">${escapeHtml(t("tx.name"))}</span><input name="name" value="${escapeHtml(state.name)}" /></label>
                  <label class="form-row ${warnClass(confidence.merchant)}"><span class="form-row__label">${escapeHtml(t("scan.merchant"))}${warnMark(confidence.merchant)}</span><input name="merchant" value="${escapeHtml(state.merchant)}" /></label>
                  <label class="form-row ${warnClass(confidence.date)}"><span class="form-row__label">${escapeHtml(t("tx.date"))}${warnMark(confidence.date)}</span><input type="date" name="date" value="${escapeHtml(state.date)}" /></label>
                  <label class="form-row"><span class="form-row__label">${escapeHtml(t("tx.time"))}</span><input type="time" name="time" value="${escapeHtml(state.time)}" /></label>
                  <label class="form-row"><span class="form-row__label">${escapeHtml(t("scan.reference"))}</span><input name="referenceNo" value="${escapeHtml(state.referenceNo)}" /></label>
                  <label class="form-row"><span class="form-row__label">${escapeHtml(t("tx.note"))}</span><input name="note" value="${escapeHtml(state.note)}" placeholder="${escapeHtml(t("tx.note_placeholder"))}" /></label>
                </div>
                <p class="form-error" role="alert" data-error></p>
                ${
                  isTransfer
                    ? ""
                    : `<div class="section ${state.split ? "" : warnClass(confidence.category)}">
                        <h3 class="list__header"><span>${escapeHtml(t("tx.category"))}${state.split ? "" : warnMark(confidence.category)}</span>
                          <label class="split-toggle"><input type="checkbox" role="switch" class="switch" data-split-toggle ${state.split ? "checked" : ""} /><span>${escapeHtml(t("scan.split"))}</span></label>
                        </h3>
                        ${
                          state.split
                            ? `<div class="panel">
                                ${state.parts.map((part, index) => splitRow(part, index, state.type)).join("")}
                                <div class="scan-split__foot">
                                  <button type="button" class="btn btn--secondary" data-add-split>${glyph("plus")}<span>${escapeHtml(t("scan.split_add"))}</span></button>
                                  <span class="t-footnote ${splitTotal === state.amount ? "text-income" : "text-warning"}">${escapeHtml(t("scan.split_left", { amount: formatCurrency(state.amount - splitTotal) }))}</span>
                                </div>
                              </div>`
                            : `<div class="choice-grid">${choiceButtons("category", categories, state.category, localizedName)}</div>`
                        }
                      </div>`
                }
                <div class="section">
                  <h3 class="list__header">${escapeHtml(isTransfer ? t("tx.from_fund") : t("tx.fund"))}</h3>
                  <div class="choice-grid">${choiceButtons("fund", getFunds(), state.fund, (row) => row.name)}</div>
                </div>
                ${isTransfer ? `<div class="section"><h3 class="list__header">${escapeHtml(t("tx.to_fund"))}</h3><div class="choice-grid">${choiceButtons("to-fund", getFunds(), state.toFund, (row) => row.name)}</div></div>` : ""}
                <div class="section">
                  <h3 class="list__header"><span>${escapeHtml(t("scan.items", { count: state.items.length }))}</span></h3>
                  <div class="panel scan-items">
                    ${state.items.length ? `<div class="scan-item scan-item--head"><span>${escapeHtml(t("scan.item_name"))}</span><span>${escapeHtml(t("scan.item_qty"))}</span><span>${escapeHtml(t("scan.item_price"))}</span><span></span></div>` : ""}
                    ${state.items.map(itemRow).join("")}
                    <button type="button" class="btn btn--secondary" data-add-item>${glyph("plus")}<span>${escapeHtml(t("scan.item_add"))}</span></button>
                  </div>
                </div>
                <div class="detail-actions detail-actions--two">
                  <button type="button" class="btn btn--secondary" data-rescan>${glyph("rotate-ccw")}${escapeHtml(t("scan.retry"))}</button>
                  <button type="button" class="btn btn--primary" data-save>${glyph("circle-check")}${escapeHtml(t("common.save"))}</button>
                </div>
              </div>
            </form>`;
          bind();
        };

        const form = () => body.querySelector("form");
        const readForm = () => {
          const elements = form().elements;
          state.amount = parseAmount(elements.amount.value) ?? 0;
          state.name = elements.name.value.trim();
          state.merchant = elements.merchant.value.trim();
          state.date = elements.date.value;
          state.time = elements.time.value || "12:00";
          state.referenceNo = elements.referenceNo.value.trim();
          state.note = elements.note.value.trim();
          body.querySelectorAll("[data-item]").forEach((row) => {
            const item = state.items[Number(row.dataset.item)];
            item.name = row.querySelector('[name="item-name"]').value.trim();
            item.quantity = Number(String(row.querySelector('[name="item-qty"]').value).replace(",", ".")) || 1;
            item.price = parseAmount(row.querySelector('[name="item-price"]').value) ?? 0;
          });
          body.querySelectorAll("[data-split]").forEach((row) => {
            const part = state.parts[Number(row.dataset.split)];
            part.category = row.querySelector('[name="split-category"]').value;
            part.amount = parseAmount(row.querySelector('[name="split-amount"]').value) ?? 0;
          });
        };
        const rerender = () => {
          readForm();
          const scroll = body.querySelector(".sheet__body").scrollTop;
          render();
          body.querySelector(".sheet__body").scrollTop = scroll;
        };

        const bind = () => {
          body.querySelector("[data-zoom]").addEventListener("click", (event) => event.currentTarget.classList.toggle("is-zoomed"));
          body.querySelector("[data-cancel]").addEventListener("click", () => {
            finish("cancel");
            closeSheet();
          });
          body.querySelector("[data-rescan]").addEventListener("click", async () => finish(await scanPrepared(image)));
          bindSegmented(body, "scan-type", (type) => {
            readForm();
            state.type = type;
            if (getCategory(state.category)?.type !== type) state.category = "";
            render();
          });
          body.querySelector("form").addEventListener("click", (event) => {
            const choice = event.target.closest(".choice");
            if (choice) {
              readForm();
              if (choice.dataset.category) state.category = choice.dataset.category;
              if (choice.dataset.fund) state.fund = choice.dataset.fund;
              if (choice.dataset.toFund) state.toFund = choice.dataset.toFund;
              render();
              haptic();
            }
            if (event.target.closest("[data-add-item]")) {
              readForm();
              state.items.push({ name: "", quantity: 1, price: 0 });
              rerender();
            }
            const removeItem = event.target.closest("[data-remove-item]");
            if (removeItem) {
              readForm();
              state.items.splice(Number(removeItem.dataset.removeItem), 1);
              rerender();
            }
            if (event.target.closest("[data-add-split]")) {
              readForm();
              state.parts.push({ category: "", amount: 0 });
              rerender();
            }
            const removeSplit = event.target.closest("[data-remove-split]");
            if (removeSplit) {
              readForm();
              state.parts.splice(Number(removeSplit.dataset.removeSplit), 1);
              rerender();
            }
          });
          body.querySelector("[data-split-toggle]")?.addEventListener("change", (event) => {
            readForm();
            state.split = event.target.checked;
            if (state.split && !state.parts.length) {
              state.parts = [{ category: state.category, amount: state.amount }, { category: "", amount: 0 }];
            }
            rerender();
          });
          body.querySelectorAll("[data-save]").forEach((button) => button.addEventListener("click", save));
          body.querySelector("form").addEventListener("submit", (event) => {
            event.preventDefault();
            save();
          });
        };

        const validate = () => {
          if (!state.amount || state.amount <= 0) return "tx.error_amount";
          if (!state.name) return "tx.error_name";
          if (!state.date) return "tx.error_date";
          if (!state.fund) return "tx.error_fund";
          if (state.type === "TRANSFER") return !state.toFund || state.toFund === state.fund ? "tx.error_transfer" : null;
          if (state.split) {
            if (state.parts.some((part) => !part.category || !part.amount)) return "scan.error_split_part";
            if (state.parts.reduce((total, part) => total + part.amount, 0) !== state.amount) return "scan.error_split_total";
            return null;
          }
          return state.category ? null : "tx.error_category";
        };

        const buildRows = () => {
          const details = {
            documentType: draft.documentType,
            sourceApp: draft.sourceApp,
            subtotal: draft.subtotal,
            discount: draft.discount,
            taxService: draft.taxService,
            adminFee: draft.adminFee,
            items: state.items.filter((item) => item.name),
          };
          const base = {
            date: state.date,
            time: state.time,
            type: state.type,
            name: state.name,
            merchant: state.merchant,
            fund: state.fund,
            toFund: state.type === "TRANSFER" ? state.toFund : "",
            referenceNo: state.referenceNo,
            note: state.note,
            inputMethod: "SCAN",
          };
          const parts = state.type !== "TRANSFER" && state.split ? state.parts : [{ category: state.type === "TRANSFER" ? "" : state.category, amount: state.amount }];
          return parts.map((part, index) => ({ ...base, id: createId(), category: part.category, amount: part.amount, details: index === 0 ? details : null }));
        };

        let rows = null;
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
          rows = rows && rows.length === (state.split ? state.parts.length : 1) ? rows.map((row, index) => ({ ...buildRows()[index], id: row.id })) : buildRows();
          const corrected = rows[0].category !== suggestion.category || rows[0].fund !== suggestion.fund;
          const correction = corrected && state.merchant ? { merchant: state.merchant, category: rows[0].category, fund: rows[0].fund } : null;
          body.querySelectorAll("[data-save]").forEach((button) => (button.disabled = true));
          try {
            const saved = await applyScanCommit(rows, { correction, force: state.force });
            enqueuePhoto(saved[0].id, image);
            closeSheet();
            toast(t("tx.saved"));
            context.onSaved(saved[0]);
            finish("saved");
          } catch (failure) {
            body.querySelectorAll("[data-save]").forEach((button) => (button.disabled = false));
            if (failure instanceof ApiError && failure.code === "DUPLICATE_RECEIPT") {
              showDuplicate(body, failure.details?.similar ?? [], () => {
                state.force = true;
                save();
              });
              return;
            }
            error.textContent = tError(failure instanceof ApiError ? failure.code : "INTERNAL_ERROR");
            replayAnimation(error);
          }
        };

        render();
      },
      { onClose: () => finish("cancel") }
    );
  });
}

function showDuplicate(body, similar, onForce) {
  const holder = body.querySelector("[data-duplicate]");
  holder.innerHTML = `
    <div class="duplicate" role="alert">
      <p class="note">${glyph("triangle-alert")}<span>${escapeHtml(t("scan.duplicate_warning"))}</span></p>
      <div class="list list--plain">${similar
        .slice(0, 3)
        .map((row) => `
          <div class="row row--static">
            <span class="row__body"><span class="row__title">${escapeHtml(row.name)}</span><span class="row__meta">${escapeHtml(formatDate(row.date, "long"))}</span></span>
            <span class="row__amount">${escapeHtml(formatCurrency(row.amount))}</span>
          </div>`)
        .join("")}</div>
      <button type="button" class="btn btn--secondary btn--block" data-force>${escapeHtml(t("scan.save_anyway"))}</button>
    </div>`;
  holder.querySelector("[data-force]").addEventListener("click", onForce);
  holder.scrollIntoView({ block: "center" });
}

/* Dipakai saat foto ditempel dengan Ctrl+V atau Cmd+V. */
export function imagesFromClipboard(event) {
  return [...(event.clipboardData?.files ?? [])].filter(isImageFile);
}

