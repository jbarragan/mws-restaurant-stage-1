var CACHE_NAME = 'restaurants-cache-v10';
var resources = [
  '/',
  '/index.html',
  '/restaurant.html',
  '/css/media.css',
  '/css/styles.css',
  '/js/main.js',
  '/js/dbhelper.js',
  '/js/restaurant_info.js',
  '/img/1.jpg',
  '/img/2.jpg',
  '/img/3.jpg',
  '/img/4.jpg',
  '/img/5.jpg',
  '/img/6.jpg',
  '/img/7.jpg',
  '/img/8.jpg',
  '/img/9.jpg',
  '/img/10.jpg',
  '/data/restaurants.json'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(resources);
      })
  );
});

self.addEventListener('activate', function(event) {
  console.log('Activated');
});

self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);
  let request = event.request;
  if (url.pathname.startsWith('/restaurant.html')) {
    request = 'restaurant.html';
  }
  event.respondWith(
    caches.match(request)
      .then(function(response) {
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});
