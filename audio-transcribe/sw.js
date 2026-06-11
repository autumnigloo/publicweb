const CACHE = 'audio-transcribe-v5';
const SHARE_CACHE = 'audio-transcribe-shared';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.svg', './icon-512.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE && k !== SHARE_CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (e.request.method === 'POST' && url.pathname.endsWith('/share-audio')) {
    e.respondWith(handleShare(e.request));
    return;
  }

  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('audio');
    if (file && file.size > 0) {
      const cache = await caches.open(SHARE_CACHE);
      const headers = new Headers();
      headers.set('content-type', file.type || 'application/octet-stream');
      headers.set('x-filename', encodeURIComponent(file.name || 'shared-audio'));
      headers.set('x-filesize', String(file.size));
      await cache.put('/__shared_audio__', new Response(file, { headers }));
    }
  } catch (err) {
    // fall through to redirect; page will show "no file"
  }
  return Response.redirect('./?shared=1', 303);
}
