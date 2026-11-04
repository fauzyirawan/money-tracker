/* db.js: penyimpanan di perangkat dengan IndexedDB.
   Isinya salinan data dan antrean offline. Data utama tetap di Google Sheets, jadi
   kalau iOS membersihkan penyimpanan, app cukup mengunduh ulang. */

const DB_NAME = "money-tracker";
const DB_VERSION = 1;
const STORE = "kv";

let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return opening;
}

async function run(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/* Semua fungsi menelan kesalahan: tanpa penyimpanan, app tetap berjalan dari jaringan. */
export async function dbGet(key) {
  try {
    return await run("readonly", (store) => store.get(key));
  } catch {
    return undefined;
  }
}

export async function dbSet(key, value) {
  try {
    await run("readwrite", (store) => store.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function dbDelete(key) {
  try {
    await run("readwrite", (store) => store.delete(key));
  } catch {
    /* Tidak ada yang perlu dilakukan. */
  }
}

export async function dbKeys(prefix) {
  try {
    const keys = await run("readonly", (store) => store.getAllKeys());
    return keys.filter((key) => String(key).startsWith(prefix));
  } catch {
    return [];
  }
}

export async function dbClear() {
  try {
    await run("readwrite", (store) => store.clear());
  } catch {
    /* Tidak ada yang perlu dilakukan. */
  }
}
