// service-worker.js — precache di tutto lo shell dell'app.
// Cambia CACHE_NAME ogni volta che aggiorni i file, così i client scaricano la nuova versione.

const CACHE_NAME = 'travel-diary-v8';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/vendor/leaflet.css',
  './css/vendor/images/marker-icon.png',
  './css/vendor/images/marker-icon-2x.png',
  './css/vendor/images/marker-shadow.png',
  './css/vendor/images/layers.png',
  './css/vendor/images/layers-2x.png',
  './js/app.js',
  './js/router.js',
  './js/views.js',
  './js/db.js',
  './js/search.js',
  './js/icons.js',
  './js/geolocation.js',
  './js/seed.js',
  './js/tiles.js',
  './js/backupReminder.js',
  './js/vendor/leaflet.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // aggiorna la cache con le risposte valide, per restare aggiornati quando si è online
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
