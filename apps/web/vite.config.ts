import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The browser talks same-origin; the dev/preview server proxies API routes
 * to the loopback API process. No CORS surface is opened.
 */
function apiProxy() {
  const target = process.env["MYOWNNOTION_API_URL"] ?? "http://127.0.0.1:3001";
  return {
    "/v1": { target, changeOrigin: false, ws: true },
    "/health": { target, changeOrigin: false },
  };
}

/**
 * The port to serve on, and a refusal to serve on any other one.
 *
 * `strictPort` matters more than the port itself. Vite's default is to take the
 * next free port when the configured one is busy, which is friendly for a person
 * watching the terminal and wrong for everything else: the local Playwright
 * matrix runs several stacks at once and waits on a specific port for each. A
 * server that quietly moved would leave one stack waiting on a port nobody is
 * listening to — or, worse, would let it connect to *another stack's* server and
 * report on the wrong workspace.
 */
function portPolicy() {
  return {
    port: Number(process.env["MYOWNNOTION_WEB_PORT"] ?? 5173),
    strictPort: true,
  };
}

/**
 * When Caddy terminates TLS in `compose.dev.yaml`, the browser talks to
 * https://localhost:8443. HMR must use that public origin, not the internal
 * Vite port, and bind-mounted sources on Docker Desktop need polling.
 */
function httpsProxyServer() {
  if (process.env["MYOWNNOTION_DEV_HTTPS_PROXY"] !== "1") {
    return {};
  }
  const origin = process.env["MYOWNNOTION_PUBLIC_ORIGIN"] ?? "https://localhost:8443";
  const url = new URL(origin);
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  return {
    origin,
    allowedHosts: true as const,
    hmr: {
      protocol: url.protocol === "https:" ? "wss" : "ws",
      host: url.hostname,
      clientPort: url.port === "" ? defaultPort : Number(url.port),
    },
    watch: {
      usePolling: true,
      interval: 400,
    },
  };
}

/**
 * Workbox retains only the versioned application shell (T021): precached
 * build assets let the app boot offline, while canonical content always
 * comes from the Dexie projection — never from HTTP caches.
 */
export default defineConfig({
  define: {
    __MYOWNNOTION_E2E__: "false",
    __MYOWNNOTION_SEARCH_WORKER_URL__: "undefined",
    __MYOWNNOTION_GRAPH_WORKER_URL__: "undefined",
  },
  ...(process.env["MYOWNNOTION_VITE_CACHE_DIR"] === undefined
    ? {}
    : { cacheDir: process.env["MYOWNNOTION_VITE_CACHE_DIR"] }),
  optimizeDeps: {
    // The browser entry resolves its Wasm payload relative to import.meta.url.
    // Pre-bundling relocates the JS into node_modules/.vite without copying the
    // sibling Wasm file, so the browser receives Vite's HTML fallback instead.
    exclude: ["loro-crdt"],
  },
  resolve: {
    alias: [
      {
        // Loro's development export uses native Wasm module imports, which
        // Vite deliberately leaves to plugins. Its browser export uses the
        // URL-based loader Vite supports natively and exposes the same API.
        find: /^loro-crdt$/,
        replacement: "loro-crdt/browser",
      },
    ],
  },
  plugins: [tailwindcss(), react()],
  server: {
    host: process.env["MYOWNNOTION_DEV_HTTPS_PROXY"] === "1" ? "0.0.0.0" : "127.0.0.1",
    ...portPolicy(),
    proxy: apiProxy(),
    ...httpsProxyServer(),
  },
  preview: {
    host: "127.0.0.1",
    ...portPolicy(),
    proxy: apiProxy(),
  },
});
