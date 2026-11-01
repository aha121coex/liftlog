/* LiftLog service worker — network first, offline fallback.
   Never cache user workout records, which live in on-device storage. */
const CACHE = 'liftlog-shell-2026-11-01-v4';
const ASSETS = [
  './', './index.html', './styles.css', './sync.js', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => (key.startsWith('liftlog-shell-') || key.startsWith('liftlog-app-shell-')) && key !== CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // A version published at the same GitHub Pages address takes precedence
      // over a stale cached copy, even while the service worker stays installed.
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) {
        const put = cache.put(request, response.clone());
        event.waitUntil(put);
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
