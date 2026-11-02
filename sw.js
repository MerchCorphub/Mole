// MOLE service worker: push notifications + offline shell.
const CACHE = "mole-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/mole-192.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });

// Network first for pages; never cache API calls.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req).then((r) => r || caches.match("./"))));
});

self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "MOLE Network", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "MOLE Network", { body: d.body || "", icon: "icons/mole-192.png", badge: "icons/mole-192.png", data: { link: d.link || "" } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL("./" + (e.notification.data.link || ""), self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ("focus" in w) { w.navigate(url); return w.focus(); }
    return clients.openWindow(url);
  }));
});
