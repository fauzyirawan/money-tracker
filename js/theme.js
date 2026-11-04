/* theme.js: menerapkan tema dan preferensi tampilan sebelum halaman digambar.
   Dimuat sebagai <script> biasa di <head> agar tidak ada kedipan warna. */
(function () {
  "use strict";

  var STORAGE_KEY = "mt.display";
  var DEFAULTS = { theme: "dark", reduceTransparency: false, increaseContrast: false };
  var root = document.documentElement;

  function query(media) {
    return window.matchMedia ? window.matchMedia(media) : { matches: false, addEventListener: function () {} };
  }

  var systemDark = query("(prefers-color-scheme: dark)");
  var systemTransparency = query("(prefers-reduced-transparency: reduce)");
  var systemContrast = query("(prefers-contrast: more)");

  function read() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (error) {
      return Object.assign({}, DEFAULTS);
    }
  }

  var prefs = read();

  function isLowEndAndroid() {
    var cores = navigator.hardwareConcurrency || 8;
    var memory = navigator.deviceMemory || 8;
    return /Android/i.test(navigator.userAgent) && (cores <= 4 || memory <= 3);
  }

  function resolveTheme() {
    if (prefs.theme === "light" || prefs.theme === "dark") return prefs.theme;
    return systemDark.matches ? "dark" : "light";
  }

  function apply() {
    var theme = resolveTheme();
    root.dataset.theme = theme;
    root.dataset.transparency = prefs.reduceTransparency || systemTransparency.matches ? "reduced" : "full";
    root.dataset.contrast = prefs.increaseContrast || systemContrast.matches ? "more" : "normal";
    root.dataset.glass = isLowEndAndroid() ? "lite" : "full";

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0c1426" : "#f1f4fa");
  }

  function set(patch) {
    Object.assign(prefs, patch);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      /* Penyimpanan bisa diblokir, pilihan tetap berlaku sampai halaman ditutup. */
    }
    apply();
  }

  [systemDark, systemTransparency, systemContrast].forEach(function (media) {
    media.addEventListener("change", apply);
  });

  apply();

  window.MTTheme = {
    get: function () {
      return Object.assign({}, prefs);
    },
    set: set,
  };
})();
