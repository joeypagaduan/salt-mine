// Keeps Salt Mine Beta's own files on the device so it opens without a connection.
// Your data is handled separately by Firebase's offline copy.
const CACHE = 'smb-2.0.0-alpha.11';
const SHELL = ['./', 'index.html', 'css/app.css', 'css/beta.css', 'js/app.js', 'js/util.js', 'js/data.js', 'js/archidekt.js', 'js/config.js',
  'js/state.js', 'js/game.js', 'js/gameui.js', 'js/commanders.js', 'js/lifecounter.js', 'js/stats.js', 'js/importer.js', 'js/xlsx.js', 'js/groups.js', 'js/vendor/qrcode.js', 'js/shared.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // The app's own files: use the network when it's there (so updates show up), the saved copy when it isn't
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
    return;
  }
  // Firebase's code and the font never change at a given address, so the saved copy is always right
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })));
  }
});
