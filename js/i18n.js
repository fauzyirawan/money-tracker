/* i18n.js: terjemahan dan format angka, Rupiah, serta tanggal.

   Cara pakai:
     await initI18n();
     t("dashboard.safe_daily", { amount: formatCurrency(50000), days: 12 });
     t("tx.count", { count: 3 });

   Di HTML:
     <span data-i18n="nav.home"></span>
     <input data-i18n-placeholder="tx.search_placeholder">
     <button data-i18n-aria-label="common.close"></button>

   Menambah bahasa: buat js/i18n/<kode>.json, lalu tambahkan kodenya ke
   SUPPORTED_LANGUAGES. */

export const SUPPORTED_LANGUAGES = ["id", "en"];

const FALLBACK_LANGUAGE = "id";
const STORAGE_KEY = "mt.lang";
const DEFAULT_TIME_ZONE = "Asia/Makassar";
const NBSP = " ";
const MINUS = "−";

const DATE_STYLES = {
  short: { day: "numeric", month: "short", year: "numeric" },
  medium: { day: "numeric", month: "short" },
  long: { day: "numeric", month: "long", year: "numeric" },
  full: { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  monthYear: { month: "long", year: "numeric" },
};

const IS_DEVELOPMENT = ["localhost", "127.0.0.1"].includes(location.hostname);

const dictionaries = new Map();
const listeners = new Set();
const warnedKeys = new Set();

let currentLanguage = FALLBACK_LANGUAGE;
let timeZone = DEFAULT_TIME_ZONE;

async function loadDictionary(language) {
  if (dictionaries.has(language)) return dictionaries.get(language);
  const url = new URL(`./i18n/${language}.json`, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`I18N_LOAD_FAILED:${language}`);
  const dictionary = await response.json();
  dictionaries.set(language, dictionary);
  return dictionary;
}

function readStoredLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLanguage(language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* Penyimpanan bisa diblokir, bahasa tetap berlaku sampai halaman ditutup. */
  }
}

function detectLanguage() {
  const stored = readStoredLanguage();
  if (SUPPORTED_LANGUAGES.includes(stored)) return stored;
  const code = (navigator.language || "").slice(0, 2).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(code) ? code : FALLBACK_LANGUAGE;
}

export async function initI18n(options = {}) {
  if (options.timeZone) timeZone = options.timeZone;
  await loadDictionary(FALLBACK_LANGUAGE);
  await setLanguage(options.language || detectLanguage(), { persist: false });
}

export async function setLanguage(language, { persist = true } = {}) {
  const next = SUPPORTED_LANGUAGES.includes(language) ? language : FALLBACK_LANGUAGE;
  await loadDictionary(next);
  currentLanguage = next;
  if (persist) storeLanguage(next);
  document.documentElement.lang = next;
  applyTranslations();
  listeners.forEach((listener) => listener(next));
}

export function getLanguage() {
  return currentLanguage;
}

export function getLocale() {
  return dictionaries.get(currentLanguage)?._meta?.locale ?? "id-ID";
}

export function setTimeZone(value) {
  timeZone = value;
  listeners.forEach((listener) => listener(currentLanguage));
}

export function getTimeZone() {
  return timeZone;
}

/* Mendaftarkan fungsi yang dijalankan setiap bahasa berubah. */
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function warnMissing(key) {
  if (!IS_DEVELOPMENT || warnedKeys.has(`${currentLanguage}:${key}`)) return;
  warnedKeys.add(`${currentLanguage}:${key}`);
  console.warn(`[i18n] Key tidak ditemukan di ${currentLanguage}.json: ${key}`);
}

function lookup(key) {
  const value = dictionaries.get(currentLanguage)?.[key];
  if (value !== undefined) return value;
  warnMissing(key);
  return dictionaries.get(FALLBACK_LANGUAGE)?.[key] ?? key;
}

function pickPlural(entry, count) {
  const category = new Intl.PluralRules(getLocale()).select(count);
  return entry[category] ?? entry.other;
}

function interpolate(template, variables) {
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in variables)) return match;
    const value = variables[name];
    return typeof value === "number" ? formatNumber(value) : String(value);
  });
}

export function t(key, variables = {}) {
  const entry = lookup(key);
  const template = typeof entry === "object" ? pickPlural(entry, variables.count ?? 0) : entry;
  return interpolate(template, variables);
}

/* Teks dari error code backend. Kode yang belum dikenal memakai pesan umum. */
export function tError(code) {
  const key = `error.${code}`;
  const known = dictionaries.get(currentLanguage)?.[key] ?? dictionaries.get(FALLBACK_LANGUAGE)?.[key];
  return known ? t(key) : t("error.INTERNAL_ERROR");
}

/* Mengisi teks semua elemen yang punya atribut data-i18n. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
}

export function formatNumber(value) {
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(value);
}

/* Disusun manual karena hasil Intl untuk IDR berbeda antar browser.
   Indonesia: "Rp 1.250.000", English: "Rp1,250,000". */
export function formatCurrency(value, { signed = false } = {}) {
  const amount = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 }).format(Math.abs(value));
  const gap = dictionaries.get(currentLanguage)?._meta?.currencyGap ? NBSP : "";
  const sign = value < 0 ? MINUS : signed && value > 0 ? "+" : "";
  return `${sign}Rp${gap}${amount}`;
}

/* Angka ringkas untuk sumbu grafik: "1,2 jt" atau "1.2M". */
export function formatCompact(value) {
  return new Intl.NumberFormat(getLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/* Nama kategori sesuai bahasa aktif. Kalau kosong, pakai nama bahasa satunya. */
export function localizedName(item) {
  if (currentLanguage === "en") return item.nameEn || item.nameId;
  return item.nameId || item.nameEn;
}

export function formatPercent(value) {
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value) + "%";
}

/* Tanggal "YYYY-MM-DD" adalah tanggal kalender, jadi tidak boleh ikut bergeser
   oleh zona waktu. Nilai lain dianggap waktu nyata di zona waktu aktif. */
function toDateParts(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return { date: new Date(Date.UTC(year, month - 1, day, 12)), zone: "UTC" };
  }
  return { date: value instanceof Date ? value : new Date(value), zone: timeZone };
}

export function formatDate(value, style = "short") {
  const { date, zone } = toDateParts(value);
  const options = DATE_STYLES[style] ?? DATE_STYLES.short;
  return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: zone }).format(date);
}

export function formatTime(value) {
  const { date, zone } = toDateParts(value);
  return new Intl.DateTimeFormat(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  }).format(date);
}

/* Nama hari sesuai bahasa. firstDay: 0 = Minggu, 1 = Senin. */
export function weekdayNames(firstDay = 1, style = "short") {
  const formatter = new Intl.DateTimeFormat(getLocale(), { weekday: style, timeZone: "UTC" });
  /* 4 Januari 1970 jatuh pada hari Minggu. */
  return Array.from({ length: 7 }, (_, index) => {
    const day = 4 + ((firstDay + index) % 7);
    return formatter.format(new Date(Date.UTC(1970, 0, day, 12)));
  });
}

export function monthNames(style = "long") {
  const formatter = new Intl.DateTimeFormat(getLocale(), { month: style, timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, month) => formatter.format(new Date(Date.UTC(2026, month, 15))));
}

/* Mengubah teks nominal menjadi angka bulat sesuai pemisah bahasa aktif.
   Mengembalikan null jika bukan angka yang sah. */
export function parseAmount(text) {
  const parts = new Intl.NumberFormat(getLocale()).formatToParts(1234567.5);
  const groupSeparator = parts.find((part) => part.type === "group")?.value ?? ".";
  const decimalSeparator = parts.find((part) => part.type === "decimal")?.value ?? ",";
  const cleaned = String(text)
    .replace(/rp|idr|\s/gi, "")
    .split(groupSeparator)
    .join("")
    .replace(decimalSeparator, ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned));
}
