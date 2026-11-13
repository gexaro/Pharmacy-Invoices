
'use strict';

const CACHE_NAME = 'pharmacy-invoices-v1';

const CORE_FILES = [
  './index.html',
  './style.css',
  './db.js',
  './ocr.js',
  './invoice.js',
  './returns.js',
  './payments.js',
  './reports.js',
  './app.js',
  './manifest.json',
  './icon.svg'
];

// تثبيت الملفات الأساسية.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting())
  );
});

// حذف النسخ القديمة من التخزين المؤقت.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key =>
            key.startsWith('pharmacy-invoices-') &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// إدارة طلبات الملفات والصفحات.
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // لا نتدخل في طلبات المواقع الخارجية مثل مكتبة OCR.
  if (url.origin !== self.location.origin) return;

  // صفحات التطبيق: الشبكة أولاً ثم النسخة المحفوظة.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, copy))
              .catch(() => {});
          }

          return response;
        })
        .catch(async () => {
          return (
            await caches.match(request) ||
            await caches.match('./index.html')
          );
        })
    );

    return;
  }

  // الملفات الثابتة: النسخة المحفوظة أولاً.
  event.respondWith(
    caches.match(request, { ignoreSearch: true })
      .then(cached => {
        if (cached) return cached;

        return fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, copy))
              .catch(() => {});
          }

          return response;
        });
      })
  );
});
