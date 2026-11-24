// Offline support for Daybook. Every file is fetched from the network first, so a new upload
// to GitHub shows up right away; the saved copy is used only when there is no internet.
const CACHE = 'daybook-v1';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/main.js', 'js/firebase.js', 'js/firebase-config.js',
  'js/sync-core.js', 'js/store.js', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  const sdk = url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (req.method !== 'GET' || (url.origin !== location.origin && !sdk)) return; // Firebase data calls go straight to the network
  if (url.pathname.includes('/__/')) return; // Firebase auth helper pages

  if (sdk) { // versioned SDK files never change: use the saved copy when there is one
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)); }
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true }))
  );
});
