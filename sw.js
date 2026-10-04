// expense service worker — network-first, cache as offline fallback.
// bump CACHE_NAME on every deploy. ASSETS must list EVERY js module:
// a module missing from cache must fail as missing, never be answered with index.html.
const CACHE_NAME = 'expense-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/ctx.js',
  './js/db.js',
  './js/ui.js',
  './js/fields.js',
  './js/money.js',
  './js/dates.js',
  './js/frecency.js',
  './js/ledger.js',
  './js/people.js',
  './js/report-data.js',
  './js/charts.js',
  './js/reports.js',
  './js/store.js',
  './js/spend.js',
  './js/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 'reload' skips the browser HTTP cache so the offline copy is never a stale file
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    // 'no-cache' = revalidate with the server every time (cheap 304 when unchanged).
    // without it the browser's heuristic HTTP cache can hand back a stale module
    // next to fresh ones, breaking imports (seen with python http.server, which sends no Cache-Control).
    fetch(event.request, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // only page loads fall back to the app shell
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
