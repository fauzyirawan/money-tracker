/* store.js: data app di memori dan salinannya di perangkat.

   Mode demo (config.js belum diisi): data contoh, semua perubahan hanya di browser ini.
   Mode asli: transaksi berubah langsung di layar lalu dikirim lewat antrean offline.js,
   sedangkan kategori, sumber dana, jadwal, dan konfirmasi butuh koneksi. */

import { api, isDemoMode } from "./api.js";
import { dbDelete, dbGet, dbSet } from "./db.js";
import { DEMO_CATEGORIES, DEMO_FUNDS, createId, demoSchedules, demoTransactions } from "./demo-data.js";
import { enqueueApi, enqueueTransaction, isQueued, queuedSettings, syncNow } from "./offline.js";

export { createId };

const SNAPSHOT_KEY = "snapshot";
const DEMO_KEY = "demo-snapshot";
const SNAPSHOT_VERSION = 2;
const PERSIST_DELAY_MS = 300;

export const DEFAULT_SETTINGS = {
  language: "id",
  timeZone: "Asia/Makassar",
  cycleStartDay: 1,
  firstDay: 1,
  theme: "dark",
  reduceTransparency: false,
  increaseContrast: false,
  reminderEmail: "",
  receiptFolderId: "",
};

function emptyState() {
  return {
    transactions: [],
    categories: [],
    funds: [],
    schedules: [],
    pending: [],
    settings: { ...DEFAULT_SETTINGS },
    meta: { email: "", spreadsheetUrl: "", lastSync: "", from: "" },
  };
}

let state = emptyState();
let visible = null;
let persistTimer = 0;
const listeners = new Set();

const storageKey = () => (isDemoMode() ? DEMO_KEY : SNAPSHOT_KEY);

function persistSoon() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => dbSet(storageKey(), { version: SNAPSHOT_VERSION, state }), PERSIST_DELAY_MS);
}

export function changed() {
  visible = null;
  persistSoon();
  listeners.forEach((listener) => listener());
}

export function onStoreChange(listener) {
  listeners.add(listener);
}

function seedDemo(today) {
  state = emptyState();
  state.transactions = demoTransactions(today);
  state.categories = DEMO_CATEGORIES.map((item) => ({ ...item }));
  state.funds = DEMO_FUNDS.map((item) => ({ ...item }));
  state.schedules = demoSchedules(today);
  state.pending = [];
  state.meta.email = "demo";
}

/* Membaca salinan di perangkat. Mengembalikan true kalau ada data untuk ditampilkan. */
export async function loadStore(today) {
  const saved = await dbGet(storageKey());
  if (saved?.version === SNAPSHOT_VERSION) {
    state = { ...emptyState(), ...saved.state, settings: { ...DEFAULT_SETTINGS, ...saved.state.settings } };
    visible = null;
    return true;
  }
  if (isDemoMode()) {
    seedDemo(today);
    changed();
    return true;
  }
  return false;
}

export async function resetDemo(today) {
  seedDemo(today);
  changed();
}

/* Menghapus semua salinan di perangkat, misalnya saat keluar akun. */
export async function clearLocalData() {
  state = emptyState();
  visible = null;
  await dbDelete(SNAPSHOT_KEY);
  listeners.forEach((listener) => listener());
}

/* --- Baca --- */

export function getTransactions() {
  if (!visible) visible = state.transactions.filter((item) => !item.deleted);
  return visible;
}

export const getAllTransactions = () => state.transactions;
export const getSchedules = () => state.schedules;
export const getPending = () => state.pending.filter((item) => item.status === "PENDING");
export const getCategories = (type) => state.categories.filter((item) => !type || item.type === type).sort((a, b) => a.order - b.order);
export const getFunds = () => [...state.funds].sort((a, b) => a.order - b.order);
export const getCategory = (id) => state.categories.find((item) => item.id === id);
export const getFund = (id) => state.funds.find((item) => item.id === id);
export const getSettings = () => state.settings;
export const getMeta = () => state.meta;
export const isCategoryUsed = (id) => state.transactions.some((item) => item.category === id || item.subCategory === id);
export const isFundUsed = (id) => state.transactions.some((item) => item.fund === id || item.toFund === id);
export const isUnsynced = (id) => isQueued(id);

/* Kategori dengan id rusak atau terhapus tetap tampil, supaya data lama tidak hilang. */
export function categoryOrFallback(id) {
  return getCategory(id) ?? { id, nameId: id || "-", nameEn: id || "-", type: "OUT", icon: "lucide:tag", color: "#8e8e93", active: false, budget: 0 };
}

export function fundOrFallback(id) {
  return getFund(id) ?? { id, name: id || "-", kind: "BANK", icon: "lucide:wallet", color: "#8e8e93", openingBalance: 0, active: false };
}

/* --- Dipakai offline.js saat data dari server datang --- */

function upsert(list, row, key = "id") {
  const index = list.findIndex((item) => item[key] === row[key]);
  if (index >= 0) list[index] = row;
  else list.push(row);
}

export function applyServerTransaction(row) {
  upsert(state.transactions, row);
}

export function applyServerData(data, { replaceTransactions = false } = {}) {
  if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings, ...queuedSettings() };
  if (data.categories) state.categories = data.categories;
  if (data.funds) state.funds = data.funds;
  if (data.schedules) state.schedules = data.schedules;
  if (data.pending) state.pending = data.pending;
  if (data.email) state.meta.email = data.email;
  if (data.spreadsheetUrl) state.meta.spreadsheetUrl = data.spreadsheetUrl;
  if (data.from) state.meta.from = data.from;

  const incoming = data.transactions ?? [];
  if (replaceTransactions) {
    const kept = state.transactions.filter((row) => isQueued(row.id));
    state.transactions = incoming.filter((row) => !isQueued(row.id)).concat(kept);
    return;
  }
  incoming.forEach((row) => {
    if (!isQueued(row.id)) upsert(state.transactions, row);
  });
}

export function setLastSync(serverTime) {
  state.meta.lastSync = serverTime;
}

/* --- Transaksi: berubah di layar dulu, dikirim kemudian --- */

export function saveTransaction(input) {
  const now = new Date().toISOString();
  const existing = state.transactions.find((item) => item.id === input.id);
  const row = {
    subCategory: "",
    merchant: "",
    tags: "",
    inputMethod: "MANUAL",
    referenceNo: "",
    receiptLink: "",
    details: null,
    scheduleId: "",
    groupId: "",
    scheduleDueDate: "",
    ...existing,
    ...input,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deleted: false,
  };
  upsert(state.transactions, row);
  if (!isDemoMode()) enqueueTransaction(existing ? "update" : "create", row);
  changed();
  syncNow();
  return row;
}

export function deleteTransaction(id) {
  const row = state.transactions.find((item) => item.id === id);
  if (!row || row.deleted) return null;
  row.deleted = true;
  row.updatedAt = new Date().toISOString();
  if (!isDemoMode()) enqueueTransaction("delete", row);
  changed();
  syncNow();
  return row;
}

export function restoreTransaction(removed) {
  const row = state.transactions.find((item) => item.id === removed.id) ?? removed;
  row.deleted = false;
  row.updatedAt = new Date().toISOString();
  upsert(state.transactions, row);
  if (!isDemoMode()) enqueueTransaction("restore", row);
  changed();
  syncNow();
}

export function setReceiptLink(id, link) {
  const row = state.transactions.find((item) => item.id === id);
  if (!row) return;
  row.receiptLink = link;
  changed();
}

/* Hasil scan: langsung ke server, karena backend memeriksa struk ganda lebih dulu. */
export async function applyScanCommit(rows, { correction = null, force = false } = {}) {
  if (isDemoMode()) return rows.map((row) => saveTransaction(row));
  const { data } = await api("scan.commit", { transactions: rows, correction, force });
  data.transactions.forEach(applyServerTransaction);
  changed();
  return data.transactions;
}

/* --- Data induk: langsung ke server di mode asli --- */

async function serverOrLocal(action, data, local) {
  if (isDemoMode()) return local();
  const { data: result } = await api(action, data);
  return result;
}

function withDefaults(list, item) {
  const existing = list.find((entry) => entry.id === item.id);
  return { order: existing?.order ?? list.length, active: true, ...existing, ...item };
}

export async function saveCategory(category) {
  const result = await serverOrLocal("categories.save", { category }, () => ({ category: withDefaults(state.categories, { parentId: "", systemKey: "", ...category }) }));
  upsert(state.categories, result.category);
  changed();
  return result.category;
}

export async function saveFund(fund) {
  const result = await serverOrLocal("funds.save", { fund }, () => ({ fund: withDefaults(state.funds, fund) }));
  upsert(state.funds, result.fund);
  changed();
  return result.fund;
}

export async function reorder(kind, ids) {
  const list = kind === "funds" ? state.funds : state.categories;
  await serverOrLocal(kind === "funds" ? "funds.reorder" : "categories.reorder", { ids }, () => ({}));
  ids.forEach((id, order) => {
    const item = list.find((entry) => entry.id === id);
    if (item) item.order = order;
  });
  changed();
}

/* Semua transaksi kategori A pindah ke B, lalu A dinonaktifkan. */
export async function mergeCategories(fromId, toId) {
  const result = await serverOrLocal("categories.merge", { fromId, toId }, () => {
    let moved = 0;
    state.transactions.forEach((row) => {
      if (row.category === fromId) {
        row.category = toId;
        moved += 1;
      }
    });
    state.schedules.forEach((row) => {
      if (row.category === fromId) row.category = toId;
    });
    return { moved };
  });
  const from = getCategory(fromId);
  if (from) from.active = false;
  changed();
  if (!isDemoMode()) await syncNow({ full: true });
  return result.moved;
}

export async function saveSchedule(schedule) {
  const result = await serverOrLocal("schedules.save", { schedule }, () => ({
    schedule: { runCount: 0, lastRun: "", lastReminder: "", active: true, ...state.schedules.find((item) => item.id === schedule.id), ...schedule, nextDate: schedule.nextDate || schedule.startDate },
  }));
  upsert(state.schedules, result.schedule);
  changed();
  return result.schedule;
}

export async function deactivateSchedule(id) {
  await serverOrLocal("schedules.deactivate", { id }, () => ({}));
  const schedule = state.schedules.find((item) => item.id === id);
  if (schedule) schedule.active = false;
  changed();
}

export async function resolvePending(id, decision, nominal) {
  const result = await serverOrLocal("pending.resolve", { id, decision, nominal }, () => ({ pending: { ...state.pending.find((item) => item.id === id), status: decision === "SKIP" ? "SKIPPED" : "CONFIRMED" } }));
  upsert(state.pending, result.pending);
  if (result.transaction) applyServerTransaction(result.transaction);
  changed();
  return result;
}

/* Pengaturan berlaku langsung, lalu ikut tersimpan di Sheets agar sama di semua perangkat. */
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if (!isDemoMode()) enqueueApi("settings.update", { settings: patch });
  changed();
  syncNow();
}

export function getSnapshotState() {
  return state;
}
