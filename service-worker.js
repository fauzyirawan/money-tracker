/* service-worker.js: membuat app tetap terbuka saat sinyal jelek.
   - Tampilan app disimpan di cache saat pemasangan, jadi app terbuka tanpa jaringan.
   - File app memakai cache dulu, lalu diperbarui diam-diam di belakang.
   - config.js selalu dicoba dari jaringan dulu, supaya perubahan setup langsung terasa.
   - Permintaan ke backend dan login Google tidak pernah disimpan di cache.
   Naikkan VERSION setiap kali file app diubah, supaya perangkat mengambil versi baru. */

const VERSION = "1.0.8";
const CACHE = `money-tracker-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "config.js",
  "css/tokens.css",
  "css/layout.css",
  "css/components.css",
  "css/shell.css",
  "css/pages.css",
  "css/materials.css",
  "css/motion.css",
  "fonts/inter-latin-wght.woff2",
  "icons/sprite.svg",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
  "vendor/chart-4.4.7.umd.js",
  "js/theme.js",
  "js/app.js",
  "js/api.js",
  "js/auth.js",
  "js/budget.js",
  "js/categories.js",
  "js/charts.js",
  "js/dashboard.js",
  "js/db.js",
  "js/demo-data.js",
  "js/i18n.js",
  "js/icons.js",
  "js/image.js",
  "js/install.js",
  "js/offline.js",
  "js/range-picker.js",
  "js/reports.js",
  "js/scan.js",
  "js/schedule-math.js",
  "js/scheduled.js",
  "js/settings.js",
  "js/stats.js",
  "js/store.js",
  "js/transactions.js",
  "js/ui.js",
  "js/utils.js",
  "js/i18n/id.json",
  "js/i18n/en.json",
];

/* Saat dicoba di komputer sendiri (localhost), file selalu diambil dari jaringan dulu dan
   versi baru langsung dipakai, supaya perubahan langsung terlihat. Cache tetap diisi
   untuk mencoba mode offline. */
const LOCAL = ["localhost", "127.0.0.1"].includes(self.location.hostname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => (LOCAL ? self.skipWaiting() : undefined))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("money-tracker-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

/* GitHub Pages memberi label "boleh dipakai 10 menit" pada setiap file. Untuk halaman
   utama dan config.js, label itu membuat browser memakai salinan lama dari cache atau
   memorinya, sehingga config.js yang baru diisi baru terbaca 10 menit kemudian.
   Karena itu file diambil tanpa cache (no-store), lalu labelnya diganti menjadi
   "jangan disimpan" sebelum diberikan ke halaman. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(new Request(request.url, { cache: "no-store", credentials: "same-origin" }));
    if (response.ok) cache.put(request, response.clone());
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return (await cache.match(request)) ?? (await cache.match("index.html"));
  }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(new Request("index.html")));
    return;
  }
  if (LOCAL || url.pathname.endsWith("/config.js")) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request, event));
});
