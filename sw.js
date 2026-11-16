const CACHE = 'rei-da-chapa-v1.0.56';
const CACHE_PREFIX = 'rei-da-chapa';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const appScope = new URL(self.registration.scope).pathname;
  const dentroDoApp = url.origin === self.location.origin && url.pathname.startsWith(appScope);
  const caminhoDaApi = /\/(?:rest\/v1|auth\/v1|storage\/v1)(?:\/|$)/i.test(url.pathname);
  const arquivoEstatico = /\.(?:html|js|css|png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname);
  const telaInicial = url.pathname === appScope || url.pathname === appScope + 'index.html';
  if (!dentroDoApp || caminhoDaApi || !(arquivoEstatico || telaInicial)) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(response => {
      if (response && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, copy));
      }
      return response;
    }).catch(() => caches.open(CACHE).then(cache => cache.match(e.request)))
  );
});
