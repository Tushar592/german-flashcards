const VERSION = '4.6.5';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Deliberately no fetch cache.
// The app always requests the latest frontend and live learner data.
