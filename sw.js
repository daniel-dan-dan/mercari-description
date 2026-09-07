const CACHE_PREFIX = 'mercari-description-';
const CACHE_NAME = 'mercari-description-v20260908a';
const ASSETS = [
  './',
  './index.html',
  './pair.html',
  './styles.css?v=20260908a',
  './public-config.js?v=20260908a',
  './catalog-data.js?v=20260908a',
  './app.js?v=20260908a',
  './review.js?v=20260908a',
  './bootstrap.js?v=20260908a',
  './pair.js?v=20260908a',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/lucide/lucide.min.js?v=1.24.0',
  './vendor/lucide/LICENSE',
];

function validAssetResponse_(asset, response) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  if (response.url && new URL(response.url).origin !== self.location.origin) return false;
  const path = new URL(asset, self.location.href).pathname;
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (/\.js$/.test(path)) return ['text/javascript', 'application/javascript'].includes(mime);
  if (/\.css$/.test(path)) return mime === 'text/css';
  if (/\.png$/.test(path)) return mime === 'image/png';
  if (/\.json$/.test(path)) return ['application/json', 'application/manifest+json'].includes(mime);
  if (/\/LICENSE$/.test(path)) return ['text/plain', 'application/octet-stream'].includes(mime);
  return mime === 'text/html';
}

async function releaseCacheComplete_() {
  const cache = await caches.open(CACHE_NAME);
  const entries = await Promise.all(ASSETS.map(asset => cache.match(asset)));
  return entries.every((entry, index) => validAssetResponse_(ASSETS[index], entry));
}

async function installRelease_() {
  // Start with validated files; continue while every cache write succeeds;
  // finish only after read-back, or discard this incomplete new release.
  const responses = await Promise.all(ASSETS.map(async asset => {
    const response = await fetch(asset, { cache: 'reload' });
    if (!validAssetResponse_(asset, response)) throw new Error(`invalid app asset: ${asset}`);
    return response;
  }));
  try {
    const cache = await caches.open(CACHE_NAME);
    for (let index = 0; index < ASSETS.length; index++) await cache.put(ASSETS[index], responses[index]);
    if (!await releaseCacheComplete_()) throw new Error('app cache verification failed');
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(installRelease_());
  // Updates wait until all current app windows close; never interrupt active input.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if (!await releaseCacheComplete_()) throw new Error('incomplete app cache cannot activate');
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const knownAsset = ASSETS.find(asset => new URL(asset, self.location.href).href === event.request.url);
  const request = new Request(event.request, { cache: 'no-cache' });
  event.respondWith((async () => {
    // Keep the active release coherent while the next worker is waiting.
    // Reloading one file from a newer deployment must not mix two app versions.
    if (knownAsset) {
      const cache = await caches.open(CACHE_NAME);
      const saved = await cache.match(event.request);
      if (validAssetResponse_(knownAsset, saved)) return saved;
    }
    return fetch(request).then(response => {
      if (knownAsset && !validAssetResponse_(knownAsset, response)) throw new Error('invalid app response; using saved release');
      if (knownAsset) {
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone())));
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached && (!knownAsset || validAssetResponse_(knownAsset, cached))) return cached;
      if (event.request.mode === 'navigate') {
        const index = await cache.match('./index.html');
        if (validAssetResponse_('./index.html', index)) return index;
      }
      throw new Error('offline asset unavailable');
    });
  })());
});
