import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    minify: false,
    outDir: ".vite/build",
    emptyOutDir: false,
    lib: {
      entry: "src/preload.ts",
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rollupOptions: {
      external: ["electron"],
    },
    target: "chrome132",
  },
});
