/* Navigations are network-first so a deploy is picked up on the next open; the
   cache is the offline fallback, not the default answer. Bumping CACHE alone
   never refreshes a page that is already on screen -- see ../CLAUDE.md. */
const CACHE = 'arabic-v2';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;   // never touch API traffic

  // Navigation: network first. Query params (share targets) ride on the URL, so
  // they are unaffected by where the response body comes from.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) (await caches.open(CACHE)).put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html', { cacheName: CACHE })) ||
               (await caches.match('./', { cacheName: CACHE })) ||
               Response.error();
      }
    })());
    return;
  }

  // Everything else: cached copy now, refreshed behind you.
  e.respondWith((async () => {
    const cached = await caches.match(req, { cacheName: CACHE });
    const net = fetch(req).then(r => {
      if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
      return r;
    }).catch(() => null);
    return cached || (await net) || Response.error();
  })());
});
