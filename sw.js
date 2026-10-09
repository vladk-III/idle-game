// Offline support. Online, every file comes fresh from the network (so the
// game's files always match each other after an update); the cache is only
// used offline. Serving cached files and refreshing them one by one in the
// background mixed old and new files and broke the game after updates.
const CACHE = 'branchline-v32';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/main.js', 'js/sim.js', 'js/map.js', 'js/ride.js', 'js/world.js', 'js/data.js', 'js/rng.js', 'js/route.js', 'js/toon.js', 'js/trees.js', 'js/houses.js', 'js/floor.js', 'js/props.js', 'js/station.js', 'js/gl2d.js', 'js/trains.js', 'js/water.js', 'js/scenery.js', 'js/buildings.js', 'js/street.js', 'js/walk.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
