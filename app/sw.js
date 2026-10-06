// Minimal service worker: makes the app installable and keeps the shell available offline.
// Network-first for everything (so new deployments show up immediately); /api/* is never cached.
const CACHE = 'tizon-v1';
const SHELL = ['/app/', '/app/index.html', '/app/app.css', '/app/app.js', '/app/plan.js', '/app/extras.js', '/style.css', '/assets/logo.webp', '/assets/favicon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || caches.match('/app/index.html'))));
});
