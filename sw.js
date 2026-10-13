const CACHE = 'rei-da-chapa';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith('http')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(r => {
      if (r && r.status === 200 && r.type === 'basic') {
        const cc = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, cc));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});