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
  OFFLINE_FILE_CACHE_MAX_AGE_SECONDS,
  OFFLINE_FILE_CACHE_MAX_ENTRIES,
} from "@myownnotion/domain";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import {
  admitCompleteFileResponse,
  isRevisionQualifiedFileRequest,
} from "./services/file-cache-policy.ts";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ url, request }) => isRevisionQualifiedFileRequest({ url, request }),
  new CacheFirst({
    cacheName: "myownnotion-file-revisions-v1",
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          admitCompleteFileResponse(response) ? response : null,
      },
      // Workbox's optional plugin hooks are not declared with
      // exactOptionalPropertyTypes compatibility, though the runtime plugin
      // contract is correct.
      new ExpirationPlugin({
        maxEntries: OFFLINE_FILE_CACHE_MAX_ENTRIES,
        maxAgeSeconds: OFFLINE_FILE_CACHE_MAX_AGE_SECONDS,
        purgeOnQuotaError: true,
      }) as never,
    ],
  }),
  "GET",
);

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
