// Bump this version for every release that changes any cached file.
const VERSION = 'v3.4.0';
const PREFIX = `my-vocabulary:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const ASSETS = ['./', './index.html', './styles.css', './app.js', './core.mjs', './progress.mjs', './config.js', './sync.mjs', './cloud.mjs', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // A fresh service-worker script must not fill its new cache with an old
    // HTTP-cached cloud.mjs. Store fresh release requests under canonical URLs.
    const fresh = await Promise.all(ASSETS.map(async path => {
      const canonical = new URL(path, self.registration.scope).href;
      const releaseURL = new URL(canonical);
      releaseURL.searchParams.set('__release', VERSION);
      const response = await fetch(new Request(releaseURL.href, {cache:'reload'}));
      if (!response.ok) throw new Error(`Cannot cache ${path}: ${response.status}`);
      return [canonical, response];
    }));
    await Promise.all(fresh.map(([url, response]) => cache.put(url, response)));
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // App shell is an atomic release. New versions install in the background.
  const assetURLs = ASSETS.map(path => new URL(path, self.registration.scope).href);
  if (event.request.mode !== 'navigate' && !assetURLs.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : event.request);
    return cached || fetch(event.request);
  })());
});
