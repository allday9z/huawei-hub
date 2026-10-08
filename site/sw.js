// HUAWEI Hub service worker — only what's needed to make the hub installable
// as an app. Pages always come from the network (so every deploy shows up
// immediately); the portal is cached just as an offline fallback.
const CACHE = "hub-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Tapping a deadline reminder (portal's showNotification, data.url) opens
// that page — reusing an open hub window if there is one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const w = wins.find((c) => c.url.startsWith(self.location.origin));
      if (w) return w.navigate(url).then((c) => (c || w).focus());
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Only same-origin page loads; API calls, Google sign-in and Apps Script go straight through.
  if (req.mode !== "navigate" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).catch(() => caches.match("/")));
});
