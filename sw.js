const CACHE_NAME = 'hwcollector-' + '2026061003';
const ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/css/auth.css',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap'
];

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  if(e.request.url.includes('supabase.co')) return;

  const url = new URL(e.request.url);

  // CSS and JS — network first, cache as fallback
  if(url.pathname.endsWith('.css') || url.pathname.endsWith('.js')){
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else — cache first, network as fallback
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
