import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: true,
    sourcemap: true,
    minify: false,
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: ["electron", "node:fs", "node:path", "node:url", "node:crypto", "node:os"],
    },
    target: "node20",
  },
});
