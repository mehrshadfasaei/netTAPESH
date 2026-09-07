// Minimal service worker — exists to satisfy the two things that
// actually make the "install to home screen" prompt available (a
// registered SW + a linked manifest.json), and as a side effect lets
// the app shell open without a live connection.
//
// Deliberately NOT a full offline-first cache: every speed test result
// depends on a real, live round trip to this server, so a cached
// response for /api/* would silently corrupt every measurement.
// Static shell assets (HTML/CSS/JS/fonts/icons) use network-first —
// always fetch fresh when online (so a deploy is never stuck behind a
// stale cache), only falling back to whatever was last cached when the
// network fetch itself fails.
const CACHE_NAME = "nettapesh-shell-v1";

const SHELL_ASSETS = [
  "/",
  "/css/style.css",
  "/js/speedtest.js",
  "/js/vendor/chart.umd.js",
  "/js/vendor/chartjs-adapter-date-fns.bundle.min.js",
  "/fonts/Vazirmatn-Variable.woff2",
  "/manifest.json",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      // Best-effort — a missing/renamed asset shouldn't block
      // installation of the service worker itself.
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch the API — see the module comment above.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
  );
});
