import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The browser talks same-origin; the dev/preview server proxies API routes
 * to the loopback API process. No CORS surface is opened.
 */
function apiProxy() {
  const target = process.env["MYOWNNOTION_API_URL"] ?? "http://127.0.0.1:3001";
  return {
    "/v1": { target, changeOrigin: false },
    "/health": { target, changeOrigin: false },
  };
}

/**
 * Workbox retains only the versioned application shell (T021): precached
 * build assets let the app boot offline, while canonical content always
 * comes from the Dexie projection — never from HTTP caches.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "MyOwnNotion",
        short_name: "MyOwnNotion",
        start_url: "/",
        display: "standalone",
        background_color: "#101014",
        theme_color: "#101014",
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
      devOptions: {
        // The dev server serves the shell directly; offline journeys run
        // against the production build in Playwright.
        enabled: false,
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    proxy: apiProxy(),
  },
  preview: {
    host: "127.0.0.1",
    proxy: apiProxy(),
  },
  build: {
    sourcemap: true,
    outDir: "dist",
  },
});
