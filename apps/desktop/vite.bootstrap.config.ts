import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: true,
    sourcemap: true,
    minify: false,
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: "src/bootstrap.ts",
      formats: ["es"],
      fileName: () => "bootstrap.js",
    },
    rollupOptions: {
      external: ["electron", "node:path", "node:url"],
    },
    target: "node20",
  },
});
