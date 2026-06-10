// Roots — service worker (Web Push receiver). A separate, hand-maintained side
// project (the daily tending must NOT touch this). Served from the plant-server
// at /sw.js with `Service-Worker-Allowed: /` so its scope can cover the whole app.
//
// Two jobs only: turn an incoming `push` into a visible notification, and focus
// (or open) the app when a notification is clicked. No caching/offline — Roots
// is online-only; we just want background pushes to reach the phone.
/* eslint-env serviceworker */

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { try { data = { body: event.data && event.data.text() }; } catch { data = {}; } }
  const title = data.title || 'Roots';
  const options = {
    body: data.body || '',
    icon: '/assets/hearth-icon-192.png',
    badge: '/assets/hearth-icon-192.png',
    tag: data.tag || 'hearth',          // coalesce rapid-fire updates
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      // Focus an already-open Roots tab if we have one.
      if ('focus' in c) { try { await c.focus(); return; } catch { /* fall through */ } }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
