/* utils.js: alat bantu kecil yang dipakai beberapa halaman. */

const loadedScripts = new Map();

/* Library besar (HEIC, PDF, Excel) hanya dimuat saat benar-benar dipakai. */
export function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => {
          loadedScripts.delete(src);
          reject(new Error("SCRIPT_LOAD_FAILED"));
        };
        document.head.append(script);
      })
    );
  }
  return loadedScripts.get(src);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Nama file aman untuk semua sistem operasi. */
export function safeFileName(text) {
  return String(text).replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
