/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.skipWaiting();
clientsClaim();

try {
  const handler = createHandlerBoundToURL('/index.html');
  registerRoute(
    new NavigationRoute(handler, {
      denylist: [/^\/api\//],
    }),
  );
} catch {
  // createHandlerBoundToURL απαιτεί precache του index.html
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const url = data?.url || '/';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of all) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', url });
          if ('navigate' in client) {
            await (client as WindowClient).navigate(url);
          }
          return;
        }
      }

      await self.clients.openWindow(url);
    })(),
  );
});
