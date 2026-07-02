const CACHE_NAME = 'hwcollector-' + '2026070108';

// Must succeed at install time — if any of these fail, install fails
// loudly (see DevTools > Application > Service Workers) rather than
// silently shipping a broken offline/OCR experience.
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/css/auth.css',
  '/manifest.json',
  // OCR (Tesseract.js), vendored — precached at install so card scanning
  // works offline from the very first use, not just after a first online
  // scan. js/ocr.js itself must be here too: without it, the network-first
  // JS branch below would still work online, but a scan attempted offline
  // before ocr.js was ever fetched once would fail with no fallback.
  '/js/ocr.js',
  '/vendor/tesseract/tesseract.min.js',
  '/vendor/tesseract/worker.min.js',
  '/vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  '/vendor/tesseract/lang/eng.traineddata.gz'
];

// Cross-origin and purely cosmetic (webfont) — a hiccup fetching this
// must NOT fail the whole install and take the offline-critical assets
// above down with it.
const OPTIONAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(CRITICAL_ASSETS);
      await Promise.all(OPTIONAL_ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('[sw] optional precache failed:', url, err))
      ));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  if(e.request.url.includes('supabase.co')) return;

  const url = new URL(e.request.url);

  // OCR vendor files — immutable once downloaded, always cache-first.
  // Checked before the CSS/JS branch below: worker.min.js and
  // tesseract-core-simd-lstm.wasm.js also end in .js and would otherwise
  // be routed through the network-first path, re-fetching ~4MB on every
  // load instead of serving instantly from the install-time precache.
  if(url.pathname.startsWith('/vendor/tesseract/')){
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

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

  // Everything else — cache first, network as fallback. This is a
  // safeguard (e.g. cache cleared manually), not what the OCR vendor
  // files rely on — those are precached at install above. Unlike before,
  // a network hit here now also backfills the cache.
  e.respondWith(
    caches.match(e.request).then(r => {
      if(r) return r;
      return fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
