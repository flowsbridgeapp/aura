const CACHE_NAME = 'aura-messenger-v1';
const ASSETS = [
    './',
    './index.html',
    './script.js',
    './style.css',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
];

// Установка и кэширование
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// Активация и очистка старых кэшей
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Стратегия: Cache First для статики, Network First для API
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Если запрос к Supabase или другим внешним API - идем в сеть
    if (url.hostname.includes('supabase.co') || url.origin !== location.origin) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Для локальных ресурсов: сначала кэш, потом сеть
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
