const CACHE = 'rei-da-chapa-v1';
const ASSETS = ['./', './index.html', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      if (r && r.status===200 && r.type==='basic') {
        const cc = r.clone();
        caches.open(CACHE).then(c2 => c2.put(e.request, cc));
      }
      return r;
    }).catch(()=>c))
  );
});