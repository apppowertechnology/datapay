/**
 * STRICTWALLET — Progressive Web App Service Worker
 * Fast offline caching, asset pre-fetching, and native app performance
 */

const CACHE_NAME = 'strictwallet-pwa-v1';
const STATIC_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/Script.js',
  '/Image.png',
  '/manifest.json'
];

// 1. Install Event: Cache Core Static Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_SHELL).catch((err) => {
        console.warn('[SW Install] Shell pre-cache warning:', err);
      });
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Clean Stale Caches & Claim Clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event: Network-First for APIs, Cache-First/Revalidate for Assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always use Network-First for API requests to ensure fresh realtime financial data
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ success: false, message: 'Network unavailable. Please reconnect to the internet.' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate for static resources (CSS, JS, Images, HTML)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
