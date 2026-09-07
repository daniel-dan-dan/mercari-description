const CACHE_PREFIX = 'mercari-description-';
const CACHE_NAME = 'mercari-description-v20260907c';
const ASSETS = [
  './',
  './index.html',
  './pair.html',
  './styles.css?v=20260907c',
  './public-config.js?v=20260907c',
  './catalog-data.js?v=20260907c',
  './app.js?v=20260907c',
  './review.js?v=20260907c',
  './bootstrap.js?v=20260907c',
  './pair.js?v=20260907c',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/lucide/lucide.min.js?v=1.24.0',
  './vendor/lucide/LICENSE',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url => fetch(url, { cache: 'reload' }).then(response => {
        if (!response.ok) throw new Error(`asset fetch failed: ${url} (${response.status})`);
        return cache.put(url, response);
      })))
    )
  );
  // Updates wait until all current app windows close; never interrupt active input.
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
      if (response.ok) {
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone())));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline asset unavailable');
    })
  );
});
