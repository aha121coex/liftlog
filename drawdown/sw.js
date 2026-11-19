const CACHE_PREFIX = `drawdown-monitor-shell-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE = CACHE_PREFIX + 'v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const SCOPE = self.registration.scope;
const ALLOWED = new Set(SHELL.map(path => new URL(path, SCOPE).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !ALLOWED.has(request.url)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request);
    return cached || fetch(request);
  }));
});
