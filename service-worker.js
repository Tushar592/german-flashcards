const VERSION = '4.6.0-beta.1';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Deliberately no fetch cache.
// The app always requests the latest frontend and live learner data.
