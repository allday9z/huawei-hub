// HUAWEI Hub service worker — only what's needed to make the hub installable
// as an app. Pages always come from the network (so every deploy shows up
// immediately); the portal is cached just as an offline fallback.
const CACHE = "hub-v1";

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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Only same-origin page loads; API calls, Google sign-in and Apps Script go straight through.
  if (req.mode !== "navigate" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).catch(() => caches.match("/")));
});
