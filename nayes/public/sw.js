// Service worker: שומר את קבצי האתר במטמון כדי שייפתח מהר, גם כשהחיבור חלש.
// מבזקים ומודעות תמיד נטענים מהרשת (ורק אם אין רשת, מהעותק האחרון).

const VERSION = "nayes-v5";
const SHELL = [
  "/", "/index.html", "/styles.css", "/common.js", "/prefs.js", "/status.js", "/pwa.js",
  "/fonts/fonts.css", "/favicon.svg", "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/admin") || url.pathname === "/api/admin") return;

  // מבזקים ומודעות: קודם רשת
  if (url.pathname.startsWith("/api/")) {
    if (url.searchParams.has("click")) return;
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // עמודים: קישור למבזק נפתח מאותו עמוד ראשי
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }

  // קבצים קבועים (עיצוב, גופנים, תמונות): קודם מהמטמון
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    })),
  );
});

// לחיצה על התראה של מבזק דחוף: פותחים את המבזק
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === location.origin);
      if (open) { open.focus(); return open.navigate(url); }
      return self.clients.openWindow(url);
    }),
  );
});
