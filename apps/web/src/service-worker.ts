/**
 * Versioned application shell (T021, US6).
 *
 * Precaches only the build's own assets so a previously loaded client can
 * reboot without the server. API responses are intentionally never cached
 * here: canonical content lives in the Dexie projection with real
 * transactional semantics, and stale HTTP caches must not masquerade as
 * synchronized state.
 */
/// <reference lib="WebWorker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [
      /^\/v1(?:\/|$)/u,
      /^\/health(?:\/|$)/u,
      /^\/assets(?:\/|$)/u,
      /^\/service-worker\.js$/u,
    ],
  }),
);

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
