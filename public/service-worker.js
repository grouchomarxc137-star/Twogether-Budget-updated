const CACHE = 'twogether-v6';
const FALLBACK = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', FALLBACK, './manifest.webmanifest', './app-icon.svg?v=5'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.startsWith('twogether-')).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request, { cache: 'no-store' });
      if (fresh?.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      return (await caches.match(request)) || (request.mode === 'navigate' ? caches.match(FALLBACK) : Response.error());
    }
  })());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription?.endpoint) return;
    try {
      const response = await fetch(new URL('./api/push/messages', self.registration.scope), {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ endpoint:subscription.endpoint }),
      });
      const json = await response.json();
      const messages = Array.isArray(json?.messages) ? json.messages : [];
      for (const message of messages) {
        await self.registration.showNotification(String(message.title || 'Twogether'), {
          body:String(message.body || ''),
          icon:'./app-icon.svg?v=5',
          badge:'./app-icon.svg?v=5',
          tag:String(message.tag || message.id || 'twogether-notification'),
          renotify:true,
          data:{ url:String(message.url || './') },
        });
      }
    } catch {
      await self.registration.showNotification('Twogether', {
        body:'You have a new notification.',
        icon:'./app-icon.svg?v=5',
        badge:'./app-icon.svg?v=5',
        tag:'twogether-notification',
        data:{ url:'./' },
      });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    for (const client of list) {
      if (!('focus' in client)) continue;
      try {
        if ('navigate' in client && client.url !== target) await client.navigate(target);
      } catch {}
      return client.focus();
    }
    return clients.openWindow(target);
  }));
});
