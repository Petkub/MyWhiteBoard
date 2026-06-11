// Self-unregistering kill-switch. The earlier caching SW served stale modules
// during development (cache-first + no version bump), which broke updates.
// On navigation the browser update-checks this script over the network, installs
// this version, which wipes all caches, unregisters itself, and reloads open
// clients so they fetch fresh code straight from the network.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.navigate(c.url);
  })());
});

// No fetch handler: every request passes through to the network.
