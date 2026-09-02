/* Bumping CACHE decides what the *next* worker stores and which old caches it
   drops. On its own that never refreshes the page already on screen: a
   cache-first navigation keeps answering from the old copy, and taking control
   via clients.claim() does not reload the document. So navigations go to the
   network first here, and the page reloads itself when a new worker takes over
   (see the registration block in index.html). */
const CACHE = 'mc-v5';
const FILES = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())
  );
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

  // Navigation: network first, so a deploy lands on the next open. The cache is
  // the offline fallback, not the default answer.
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

  // Everything else: serve the cached copy immediately, refresh it behind you.
  e.respondWith((async () => {
    const cached = await caches.match(req, { cacheName: CACHE });
    const net = fetch(req).then(r => {
      if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
      return r;
    }).catch(() => null);
    return cached || (await net) || Response.error();
  })());
});
