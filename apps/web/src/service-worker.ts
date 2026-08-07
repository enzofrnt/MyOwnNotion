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
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
