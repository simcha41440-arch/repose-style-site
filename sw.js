const CACHE_NAME = "rstyle-shell-v1";
const SHELL_URLS = [
  "/",
  "/index.html",
  "/site.webmanifest",
  "/favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch the admin panel or the API - these must always be live/fresh.
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/admin")
  ) {
    return;
  }

  // Network-first, falling back to the cached shell when offline OR when the
  // network request is taking unusually long (e.g. a slow filtering/proxy
  // software on the visitor's machine holding up the response). Without this
  // timeout, fetch() just waits forever with nothing on screen - this makes
  // a returning visitor fall back to the last cached copy instead of being
  // stuck, and the page then quietly updates itself once the slow request
  // does eventually complete.
  const NETWORK_TIMEOUT_MS = 8000;

  const networkFetch = fetch(req).then((res) => {
    caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone())).catch(() => {});
    return res;
  });

  event.respondWith(
    Promise.race([
      networkFetch,
      new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, "timeout"))
    ]).then((result) => {
      if (result === "timeout") {
        // Network is taking too long - serve the cached copy right away.
        // The real networkFetch keeps running in the background (see
        // above) and will refresh the cache whenever it does complete.
        return caches.match(req).then((cached) => cached || networkFetch);
      }
      return result;
    }).catch(() =>
      caches.match(req).then((cached) => cached || caches.match("/index.html"))
    )
  );
});
