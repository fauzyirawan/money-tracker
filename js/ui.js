/* ui.js: perilaku komponen yang dipakai di seluruh app:
   sheet, menu aksi, toast, segmented control, swipe, dan haptic. */

import { formatNumber, t } from "./i18n.js";
import { glyph } from "./icons.js";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhoneLayout = () => window.matchMedia("(max-width: 639.98px)").matches;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function haptic(duration = 10) {
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(duration);
}

/* --- Sheet ---
   Hanya ada satu sheet, isinya diganti sesuai kebutuhan. Saat terbuka sheet menambah
   satu entri history, sehingga tombol Back Android menutup sheet lebih dulu. */

const HALF_DETENT = 0.45;
const CLOSE_VELOCITY = 0.5;

let sheet;
let sheetBody;
let sheetHasHistory = false;
let sheetOnClose = null;

export function initSheet(dialog) {
  sheet = dialog;
  sheetBody = dialog.querySelector("[data-sheet-content]");

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSheet();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSheet();
  });

  window.addEventListener("popstate", () => {
    if (!sheetHasHistory) return;
    sheetHasHistory = false;
    animateClose();
  });
}

function setDetent(detent) {
  sheet.classList.toggle("is-half", detent === "half");
  sheet.style.setProperty("--sheet-offset", detent === "half" ? `${HALF_DETENT * 100}%` : "0px");
}

/* Mengisi sheet. Bisa dipanggil saat sheet terbuka untuk berganti isi. */
export function showSheet(render, { detent = "full", onClose = null } = {}) {
  const wasOpen = sheet.open;
  sheetOnClose = onClose;
  sheetBody.innerHTML = "";
  render(sheetBody);
  if (isPhoneLayout()) setDetent(detent);
  else setDetent("full");
  initSheetDrag();

  if (wasOpen) return;
  const root = document.documentElement;
  root.style.setProperty("--scrollbar-width", `${window.innerWidth - root.clientWidth}px`);
  sheet.classList.add("is-closed");
  sheet.showModal();
  root.classList.add("is-locked");
  history.pushState({ sheet: true }, "");
  sheetHasHistory = true;
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.remove("is-closed")));
  haptic();
}

export function closeSheet() {
  if (!sheet.open) return;
  if (sheetHasHistory) history.back();
  else animateClose();
}

function animateClose() {
  if (sheet.classList.contains("is-closing")) return;
  sheet.classList.add("is-closing", "is-closed");
  sheet.style.removeProperty("--sheet-offset");
  const onClose = sheetOnClose;
  sheetOnClose = null;
  onClose?.();
  window.setTimeout(() => {
    sheet.close();
    sheet.classList.remove("is-closing", "is-half");
    document.documentElement.classList.remove("is-locked");
    sheetBody.innerHTML = "";
  }, prefersReducedMotion() ? 120 : 320);
}

function initSheetDrag() {
  const handle = sheet.querySelector(".sheet__drag");
  if (!handle) return;
  let startY = 0;
  let startOffset = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocity = 0;
  let dragging = false;

  handle.addEventListener("pointerdown", (event) => {
    if (!isPhoneLayout() || event.target.closest("button")) return;
    dragging = true;
    startY = lastY = event.clientY;
    lastTime = event.timeStamp;
    velocity = 0;
    startOffset = sheet.classList.contains("is-half") ? sheet.offsetHeight * HALF_DETENT : 0;
    sheet.classList.add("is-dragging");
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const elapsed = event.timeStamp - lastTime;
    if (elapsed > 0) velocity = (event.clientY - lastY) / elapsed;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    sheet.style.setProperty("--sheet-offset", `${Math.max(0, startOffset + event.clientY - startY)}px`);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove("is-dragging");
    const height = sheet.offsetHeight;
    const offset = Math.max(0, startOffset + event.clientY - startY);
    const halfPoint = height * HALF_DETENT;

    if (velocity > CLOSE_VELOCITY || offset > halfPoint + height * 0.18) closeSheet();
    else if (velocity < -CLOSE_VELOCITY || offset < halfPoint / 2) setDetent("full");
    else setDetent("half");
    haptic();
  };

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
}

/* Kepala sheet yang seragam: tombol kiri, judul, tombol kanan. */
export function sheetHeader({ title, leading, trailing }) {
  return `
    <div class="sheet__drag">
      <div class="sheet__grabber"></div>
      <div class="sheet__header">
        ${leading ?? `<button type="button" class="btn-plain" data-sheet-dismiss>${escapeHtml(t("common.close"))}</button>`}
        <h2 class="t-headline sheet__title" id="sheet-title" tabindex="-1" autofocus>${escapeHtml(title)}</h2>
        ${trailing ?? "<span></span>"}
      </div>
    </div>`;
}

/* --- Menu aksi: titik tiga, klik kanan, dan tekan lama --- */

let openMenuElement = null;

export function closeMenu() {
  openMenuElement?.remove();
  openMenuElement = null;
}

/* items: [{ label, icon, onSelect, destructive }] */
export function openMenu(point, items) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.className = `menu__item${item.destructive ? " menu__item--destructive" : ""}`;
    button.innerHTML = `<span>${escapeHtml(item.label)}</span>${glyph(item.icon)}`;
    button.addEventListener("click", () => {
      closeMenu();
      item.onSelect();
    });
    menu.append(button);
  });

  document.body.append(menu);
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(point.x - width, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(point.y + 4, window.innerHeight - height - 8))}px`;
  openMenuElement = menu;
  menu.querySelector("button").focus();
  haptic();
}

document.addEventListener("pointerdown", (event) => {
  if (openMenuElement && !event.target.closest(".menu")) closeMenu();
});

document.addEventListener("keydown", (event) => {
  if (!openMenuElement) return;
  const buttons = [...openMenuElement.querySelectorAll("button")];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.stopPropagation();
    closeMenu();
  }
  if (event.key === "ArrowDown") buttons[(index + 1) % buttons.length].focus();
  if (event.key === "ArrowUp") buttons[(index - 1 + buttons.length) % buttons.length].focus();
});

/* --- Toast --- */

const TOAST_DURATION = 5000;

export function toast(message, { actionLabel, onAction, duration = TOAST_DURATION } = {}) {
  const container = document.querySelector("[data-toasts]");
  const element = document.createElement("div");
  element.className = "toast";
  element.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "toast__message";
  text.textContent = message;
  element.append(text);

  const dismiss = () => {
    element.classList.add("is-leaving");
    window.setTimeout(() => element.remove(), 200);
  };

  if (actionLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-plain btn-plain--strong";
    button.textContent = actionLabel;
    button.addEventListener("click", () => {
      dismiss();
      onAction?.();
    });
    element.append(button);
  }

  container.append(element);
  window.setTimeout(dismiss, duration);
}

/* --- Segmented control --- */

export function segmented({ name, options, value, label }) {
  const inputs = options
    .map(
      (option) => `
      <label class="segmented__option">
        <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}" ${option.value === value ? "checked" : ""} />
        <span>${escapeHtml(option.label)}</span>
      </label>`
    )
    .join("");
  const index = Math.max(options.findIndex((option) => option.value === value), 0);
  return `
    <fieldset class="segmented" aria-label="${escapeHtml(label)}" style="--count:${options.length};--index:${index}">
      <span class="segmented__indicator"></span>${inputs}
    </fieldset>`;
}

export function bindSegmented(root, name, onChange) {
  const inputs = [...root.querySelectorAll(`input[name="${name}"]`)];
  inputs.forEach((input, index) => {
    input.addEventListener("change", () => {
      input.closest("fieldset").style.setProperty("--index", index);
      haptic();
      onChange(input.value);
    });
  });
}

/* --- Swipe dan tekan lama pada baris --- */

const LONG_PRESS_MS = 480;

export function initSwipeRow(shell, onLongPress) {
  const row = shell.querySelector(".row");
  const actions = row.querySelector(".row__actions");
  let startX = 0;
  let startY = 0;
  let base = 0;
  let current = 0;
  let active = false;
  let tracking = false;
  let pressTimer = 0;

  const moveTo = (x) => {
    current = x;
    row.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
  };

  row.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    startX = event.clientX;
    startY = event.clientY;
    base = current;
    tracking = true;
    active = false;
    pressTimer = window.setTimeout(() => {
      tracking = false;
      onLongPress?.({ x: event.clientX, y: event.clientY });
    }, LONG_PRESS_MS);
  });

  row.addEventListener("pointermove", (event) => {
    if (!tracking) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) window.clearTimeout(pressTimer);
    if (!active) {
      if (Math.abs(deltaY) > 10) tracking = false;
      if (Math.abs(deltaX) < 10) return;
      active = true;
      row.classList.add("is-dragging");
      row.setPointerCapture(event.pointerId);
    }
    moveTo(Math.min(0, Math.max(-actions.offsetWidth - 24, base + deltaX)));
  });

  const end = () => {
    window.clearTimeout(pressTimer);
    tracking = false;
    if (!active) return;
    active = false;
    row.classList.remove("is-dragging");
    const width = actions.offsetWidth;
    moveTo(current < -width / 2 ? -width : 0);
    haptic();
  };

  row.addEventListener("pointerup", end);
  row.addEventListener("pointercancel", end);
}

/* --- Urutkan dengan menyeret ---
   Baris diseret lewat tombol pegangan. Dengan keyboard: fokus ke pegangan lalu
   tekan panah atas atau bawah. onDone menerima urutan id yang baru. */

/* Daftar biasa digeser naik turun. Susunan kotak (data-reorder-layout="grid")
   digeser ke segala arah, dan urutannya dibaca dari kiri ke kanan, atas ke bawah. */
export function initReorder(list, onDone) {
  const grid = list.dataset.reorderLayout === "grid";
  const items = () => [...list.querySelectorAll(":scope > [data-reorder-item]")];
  const ids = () => items().map((item) => item.dataset.reorderItem);
  let drag = null;

  /* Elemen yang harus berada tepat setelah elemen yang diseret, atau null kalau paling akhir.
     Daftar memakai titik tengah baris. Kotak memakai posisi jari, karena tombol seretnya
     ada di pojok kartu sehingga titik tengah kartu tertinggal di belakang jari. */
  const anchorFor = (box, pointer) => {
    const middleX = grid ? pointer.x : box.left + box.width / 2;
    const middleY = grid ? pointer.y : box.top + box.height / 2;
    const siblings = items().filter((item) => item !== drag.row);
    return (
      siblings.find((item) => {
        const other = item.getBoundingClientRect();
        if (!grid) return middleY < other.top + other.height / 2;
        if (middleY < other.top) return true;
        return middleY <= other.bottom && middleX < other.left + other.width / 2;
      }) ?? null
    );
  };

  const place = () => {
    drag.row.style.transform = grid ? `translate(${drag.x}px, ${drag.y}px)` : `translateY(${drag.y}px)`;
  };

  list.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-reorder-handle]");
    if (!handle) return;
    event.preventDefault();
    const row = handle.closest("[data-reorder-item]");
    drag = { row, startX: event.clientX, startY: event.clientY, x: 0, y: 0, moved: false };
    row.classList.add("is-reordering");
    handle.setPointerCapture(event.pointerId);
  });

  list.addEventListener("pointermove", (event) => {
    if (!drag) return;
    drag.moved = true;
    drag.x = event.clientX - drag.startX;
    drag.y = event.clientY - drag.startY;
    place();
    const anchor = anchorFor(drag.row.getBoundingClientRect(), { x: event.clientX, y: event.clientY });
    if (anchor === drag.row.nextElementSibling) return;
    drag.row.style.transform = "";
    const resting = drag.row.getBoundingClientRect();
    if (anchor) list.insertBefore(drag.row, anchor);
    else list.append(drag.row);
    const moved = drag.row.getBoundingClientRect();
    /* Elemen pindah tempat di DOM, jadi titik awal digeser supaya tetap di bawah jari. */
    drag.startX += moved.left - resting.left;
    drag.startY += moved.top - resting.top;
    drag.x = event.clientX - drag.startX;
    drag.y = event.clientY - drag.startY;
    place();
    haptic();
  });

  const end = () => {
    if (!drag) return;
    drag.row.classList.remove("is-reordering");
    drag.row.style.transform = "";
    if (drag.moved) onDone(ids());
    drag = null;
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);

  list.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-reorder-handle]");
    const earlier = ["ArrowUp", ...(grid ? ["ArrowLeft"] : [])];
    const later = ["ArrowDown", ...(grid ? ["ArrowRight"] : [])];
    if (!handle || ![...earlier, ...later].includes(event.key)) return;
    event.preventDefault();
    const row = handle.closest("[data-reorder-item]");
    const siblings = items();
    const index = siblings.indexOf(row);
    const target = siblings[index + (earlier.includes(event.key) ? -1 : 1)];
    if (!target) return;
    if (earlier.includes(event.key)) list.insertBefore(row, target);
    else list.insertBefore(row, target.nextElementSibling);
    handle.focus();
    onDone(ids());
  });
}

/* --- Angka yang menghitung naik ---
   Nilai terakhir diingat lewat kunci, jadi saat filter berubah angkanya bergerak
   dari nilai lama ke nilai baru, bukan dari nol. */

const NUMBER_DURATION = 600;
const lastNumbers = new Map();
const runningNumbers = new WeakMap();

export function cancelNumber(element) {
  cancelAnimationFrame(runningNumbers.get(element));
}

function animateNumber(element, target, format) {
  const key = element.dataset.countKey;
  const from = lastNumbers.get(key) ?? 0;
  lastNumbers.set(key, target);
  if (prefersReducedMotion() || from === target) {
    element.textContent = format(target);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    /* Waktu frame pertama bisa sedikit lebih awal dari start, jadi dibatasi mulai dari 0. */
    const progress = Math.max(0, Math.min((now - start) / NUMBER_DURATION, 1));
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = format(progress === 1 ? target : from + (target - from) * eased);
    if (progress < 1) runningNumbers.set(element, requestAnimationFrame(step));
  };
  element.textContent = format(from);
  runningNumbers.set(element, requestAnimationFrame(step));
}

/* formats: { nama: fungsi } sesuai atribut data-count-format pada elemen. */
export function animateNumbers(root, formats) {
  root.querySelectorAll("[data-count-key]").forEach((element) => {
    animateNumber(element, Number(element.dataset.count), formats[element.dataset.countFormat]);
  });
}

/* Memulai ulang animasi CSS pada elemen yang sama. */
export function replayAnimation(element) {
  element.style.animation = "none";
  void element.offsetWidth;
  element.style.animation = "";
}

/* Berganti halaman dengan View Transitions API bila ada. */
export function transition(update, element) {
  if (document.startViewTransition && !prefersReducedMotion()) {
    /* Pindah halaman yang sangat cepat membatalkan transisi lama, dan itu wajar. */
    const change = document.startViewTransition(update);
    change.ready.catch(() => {});
    change.finished.catch(() => {});
    return;
  }
  update();
  const target = element?.();
  if (!target) return;
  target.classList.remove("is-entering");
  void target.offsetWidth;
  target.classList.add("is-entering");
}

/* --- Isian nominal ---
   Titik ribuan dipasang saat mengetik tanpa melempar kursor ke ujung. Posisi kursor
   dihitung dari jumlah angka di sebelah kirinya, jadi tetap di tempat walau titik
   ribuan bertambah atau berkurang. Menghapus tepat di samping titik ikut menghapus
   angka di sebelahnya, supaya tombol hapus tidak terasa macet.
   skip(value) mengembalikan true untuk isian yang dibiarkan apa adanya, misalnya
   saat kalkulator dipakai (25.000+15.000). onChange menerima nominal terbaru. */

const DIGIT = /\d/;

function caretAfterDigits(text, count) {
  if (count <= 0) {
    const first = text.search(DIGIT);
    return first < 0 ? text.length : first;
  }
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (DIGIT.test(text[index])) seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
}

export function bindAmountInput(input, { onChange, skip } = {}) {
  let before = { digits: "", caret: 0 };

  input.addEventListener("beforeinput", () => {
    const caret = input.selectionStart ?? input.value.length;
    before = { digits: input.value.replace(/\D/g, ""), caret: input.value.slice(0, caret).replace(/\D/g, "").length };
  });

  input.addEventListener("input", (event) => {
    if (skip?.(input.value)) return;
    const caret = input.selectionStart ?? input.value.length;
    let digits = input.value.replace(/\D/g, "");
    let digitsLeft = input.value.slice(0, caret).replace(/\D/g, "").length;

    /* Yang terhapus hanya titik ribuan: hapus angka di sebelahnya. */
    if (digits === before.digits && event.inputType === "deleteContentBackward" && digitsLeft > 0) {
      digits = digits.slice(0, digitsLeft - 1) + digits.slice(digitsLeft);
      digitsLeft -= 1;
    } else if (digits === before.digits && event.inputType === "deleteContentForward") {
      digits = digits.slice(0, digitsLeft) + digits.slice(digitsLeft + 1);
    }

    /* Nol di depan dibuang (0900 jadi 900); kursor ikut bergeser sebanyak nol yang hilang. */
    const leadingZeros = digits.length - digits.replace(/^0+/, "").length;
    digits = digits.replace(/^0+/, "");
    digitsLeft = Math.max(0, digitsLeft - Math.min(leadingZeros, digitsLeft));

    const formatted = digits ? formatNumber(Number(digits)) : "";
    input.value = formatted;
    if (document.activeElement === input) {
      const position = caretAfterDigits(formatted, digitsLeft);
      input.setSelectionRange(position, position);
    }
    onChange?.(digits ? Number(digits) : 0);
  });
}
