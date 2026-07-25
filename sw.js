const CACHE_PREFIX = 'mercari-description-';
const CACHE_NAME = 'mercari-description-v20260725e';
const ASSETS = [
  './',
  './index.html',
  './pair.html',
  './styles.css',
  './catalog-data.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/lucide/lucide.min.js',
  './vendor/lucide/LICENSE',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url => fetch(url, { cache: 'reload' }).then(response => cache.put(url, response))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const request = new Request(event.request, { cache: 'no-cache' });
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
