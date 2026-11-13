
const CACHE_NAME = "pharmacy-invoices-v2";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./db.js",
  "./invoice.js",
  "./reports.js",
  "./app.js",
  "./manifest.json",
  "./icon.svg"
];

// تثبيت التطبيق وتخزين ملفاته الأساسية
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_FILES);
    })
  );

  self.skipWaiting();
});

// تفعيل النسخة الجديدة وحذف الكاش القديم
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith("pharmacy-invoices-"))
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );

  self.clients.claim();
});

// عرض الملفات من الكاش أولاً، ثم الشبكة
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestURL = new URL(event.request.url);

  if (requestURL.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        return networkResponse;
      });
    })
  );
});
