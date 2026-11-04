/* offline.js: antrean offline dan sinkron dengan Google Sheets.

   Setiap perubahan transaksi masuk antrean di IndexedDB, lalu dikirim saat online.
   Antrean dirapikan sebelum dikirim: transaksi yang dibuat lalu dihapus sebelum
   sempat terkirim tidak dikirim sama sekali. Setelah antrean kosong, perubahan dari
   perangkat lain diambil lewat sync.pull. */

import { api, isDemoMode, isRetryable } from "./api.js";
import { dbDelete, dbGet, dbKeys, dbSet } from "./db.js";
import { applyServerData, applyServerTransaction, changed, getMeta, setLastSync, setReceiptLink } from "./store.js";

const QUEUE_KEY = "queue";
const PHOTO_PREFIX = "photo:";
const BATCH_SIZE = 100;
const SYNC_INTERVAL_MS = 300000;
const FOCUS_SYNC_GAP_MS = 30000;

let queue = [];
let syncing = null;
let lastSyncAt = 0;
let pendingFull = false;
let enabled = false;
const statusListeners = new Set();
const errorListeners = new Set();
let status = { online: navigator.onLine, syncing: false, failed: false };

function setStatus(patch) {
  status = { ...status, ...patch };
  statusListeners.forEach((listener) => listener(syncStatus()));
}

export function syncStatus() {
  return { ...status, queued: queue.length, unsynced: unsyncedCount(), lastSync: getMeta().lastSync };
}

export function onSyncStatus(listener) {
  statusListeners.add(listener);
}

/* Perubahan yang ditolak server, misalnya data tidak valid, dilaporkan ke layar. */
export function onSyncError(listener) {
  errorListeners.add(listener);
}

function saveQueue() {
  dbSet(QUEUE_KEY, queue);
  setStatus({});
}

export async function loadQueue() {
  queue = (await dbGet(QUEUE_KEY)) ?? [];
}

export function isQueued(id) {
  return queue.some((item) => item.kind === "tx" && item.txId === id);
}

function unsyncedCount() {
  return new Set(queue.filter((item) => item.kind === "tx").map((item) => item.txId)).size;
}

/* Merapikan antrean untuk satu transaksi. */
export function enqueueTransaction(op, row) {
  const own = queue.filter((item) => item.kind === "tx" && item.txId === row.id);
  const create = own.find((item) => item.op === "create");
  const snapshot = { ...row };

  if (op === "update" && create) {
    create.data = { transaction: snapshot };
  } else if (op === "update") {
    queue = queue.filter((item) => !(item.kind === "tx" && item.txId === row.id && item.op === "update"));
    queue.push({ kind: "tx", op: "update", txId: row.id, data: { id: row.id, patch: snapshot } });
  } else if (op === "delete" && create) {
    queue = queue.filter((item) => !(item.kind === "tx" && item.txId === row.id));
    queue.push({ kind: "local", txId: row.id, snapshot });
  } else if (op === "restore" && queue.some((item) => item.kind === "local" && item.txId === row.id)) {
    queue = queue.filter((item) => !(item.kind === "local" && item.txId === row.id));
    queue.push({ kind: "tx", op: "create", txId: row.id, data: { transaction: snapshot } });
  } else if (op === "restore" && own.length && own[own.length - 1].op === "delete") {
    queue = queue.filter((item) => item !== own[own.length - 1]);
  } else {
    queue.push({ kind: "tx", op, txId: row.id, data: op === "create" ? { transaction: snapshot } : { id: row.id } });
  }
  saveQueue();
}

/* Pengaturan yang diubah tapi belum terkirim. Data server yang datang lebih dulu tidak boleh menimpanya. */
export function queuedSettings() {
  return queue.find((item) => item.kind === "api" && item.action === "settings.update")?.data.settings ?? {};
}

export function enqueueApi(action, data) {
  const same = queue.find((item) => item.kind === "api" && item.action === action);
  if (same && action === "settings.update") same.data = { settings: { ...same.data.settings, ...data.settings } };
  else queue.push({ kind: "api", action, data });
  saveQueue();
}

/* Foto struk disimpan di perangkat sampai berhasil diunggah. */
export async function enqueuePhoto(txId, image) {
  await dbSet(PHOTO_PREFIX + txId, image);
  queue.push({ kind: "upload", txId });
  saveQueue();
  syncNow();
}

/* Penanda transaksi lokal yang dihapus hanya perlu bertahan selama tombol Urungkan masih ada. */
const LOCAL_MARKER_MS = 600000;

function pruneLocalMarkers() {
  const before = queue.length;
  queue = queue.filter((item) => item.kind !== "local" || Date.now() - Date.parse(item.snapshot.updatedAt) < LOCAL_MARKER_MS);
  if (queue.length !== before) saveQueue();
}

async function flushTransactions() {
  pruneLocalMarkers();
  const batch = queue.filter((item) => item.kind === "tx").slice(0, BATCH_SIZE);
  if (!batch.length) return false;
  const { data } = await api("transactions.batch", { ops: batch.map((item) => ({ op: item.op, data: item.data })) });

  const rejected = [];
  data.results.forEach((result, index) => {
    const item = batch[index];
    queue = queue.filter((entry) => entry !== item);
    if (result.ok) {
      if (!isQueued(item.txId)) applyServerTransaction(result.transaction);
    } else if (result.error.code !== "NOT_FOUND" || item.op === "create") {
      rejected.push({ code: result.error.code, details: result.error.details, transaction: item.data.transaction ?? item.data.patch });
    }
  });
  saveQueue();
  changed();
  rejected.forEach((rejection) => errorListeners.forEach((listener) => listener(rejection)));
  return true;
}

async function flushApiCalls() {
  for (const item of queue.filter((entry) => entry.kind === "api")) {
    try {
      await api(item.action, item.data);
    } catch (error) {
      if (isRetryable(error)) throw error;
      errorListeners.forEach((listener) => listener({ code: error.code, details: error.details }));
    }
    queue = queue.filter((entry) => entry !== item);
    saveQueue();
  }
}

async function flushUploads() {
  for (const item of queue.filter((entry) => entry.kind === "upload")) {
    if (isQueued(item.txId)) continue;
    const image = await dbGet(PHOTO_PREFIX + item.txId);
    if (image) {
      try {
        const { data } = await api("receipts.upload", { transactionId: item.txId, imageBase64: image.data, mime: image.mime });
        setReceiptLink(item.txId, data.link);
      } catch (error) {
        if (isRetryable(error)) throw error;
        errorListeners.forEach((listener) => listener({ code: error.code }));
      }
    }
    await dbDelete(PHOTO_PREFIX + item.txId);
    queue = queue.filter((entry) => entry !== item);
    saveQueue();
  }
}

async function pull(full) {
  const meta = getMeta();
  if (full || !meta.lastSync) {
    const { data, serverTime } = await api("sync.bootstrap", {});
    applyServerData(data, { replaceTransactions: true });
    setLastSync(serverTime);
  } else {
    const { data, serverTime } = await api("sync.pull", { since: meta.lastSync });
    applyServerData(data);
    setLastSync(serverTime);
  }
  changed();
}

async function runSync() {
  setStatus({ syncing: true, failed: false });
  try {
    while (await flushTransactions());
    await flushApiCalls();
    await flushUploads();
    const full = pendingFull;
    pendingFull = false;
    await pull(full);
    lastSyncAt = Date.now();
    setStatus({ syncing: false });
  } catch (error) {
    setStatus({ syncing: false, failed: isRetryable(error) && error.code !== "OFFLINE" });
    if (!isRetryable(error)) errorListeners.forEach((listener) => listener({ code: error.code }));
  }
}

/* Sinkron berjalan satu per satu. Perubahan yang dibuat saat sinkron sedang berjalan
   dikirim lewat putaran berikutnya yang langsung menyusul, bukan menunggu jadwal 5 menit. */
let rerun = false;

export function syncNow({ full = false } = {}) {
  if (full) pendingFull = true;
  if (!enabled || isDemoMode() || !navigator.onLine) return Promise.resolve();
  if (syncing) {
    rerun = true;
    return syncing;
  }
  syncing = runSync().finally(() => {
    syncing = null;
    const waiting = queue.some((item) => item.kind !== "local") || pendingFull;
    if (rerun && waiting && !status.failed) syncNow();
    rerun = false;
  });
  return syncing;
}

/* Foto yang masih tersimpan untuk diunggah, misalnya setelah app ditutup. */
export async function photoKeys() {
  return dbKeys(PHOTO_PREFIX);
}

export function startSync() {
  enabled = true;
  window.addEventListener("online", () => {
    setStatus({ online: true });
    syncNow();
  });
  window.addEventListener("offline", () => setStatus({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSyncAt > FOCUS_SYNC_GAP_MS) syncNow();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") syncNow();
  }, SYNC_INTERVAL_MS);
  return syncNow();
}

export function stopSync() {
  enabled = false;
}

export async function clearQueue() {
  queue = [];
  await dbDelete(QUEUE_KEY);
  setStatus({});
}
