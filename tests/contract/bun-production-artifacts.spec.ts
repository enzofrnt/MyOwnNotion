import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("Bun production artifacts", () => {
  it("bundles every API entry for the Bun runtime", () => {
    const build = read("apps/api/build.ts");
    expect(build).toContain("await Bun.build({");
    expect(build).toContain('target: "bun"');
    expect(build).toContain('format: "esm"');
    expect(build).toContain('packages: "bundle"');
    expect(build).toContain('Bun.resolveSync("loro-crdt/bundler"');
    expect(build).toContain("new URL(wasmModuleOrExports, import.meta.url)");
    expect(build).toContain('output.path.endsWith(".wasm")');
    expect(build).toContain('source.includes("nodejs/loro_wasm_bg.wasm")');
    expect(build).toContain("const adminHelp = Bun.spawnSync({");
    expect(build).toContain('adminHelpOutput.includes("myownnotion security —")');
    for (const output of [
      '"server.js"',
      '"migrate.js"',
      '"admin/admin-cli.js"',
      '"server.js.map"',
      '"migrate.js.map"',
      '"admin/admin-cli.js.map"',
    ]) {
      expect(build).toContain(output);
    }
  });

  it("builds the browser, search and graph workers, Wasm and PWA through Bun", () => {
    const build = read("apps/web/build.ts");
    expect(build.match(/await Bun\.build\(\{/g)).toHaveLength(4);
    expect(build).toContain("search.worker-[hash].[ext]");
    expect(build).toContain("knowledge-graph.worker-[hash].[ext]");
    expect(build).toContain("bun-plugin-tailwind");
    expect(build).toContain("injectManifest");
    expect(build).toContain('file.endsWith(".wasm")');
    expect(build).toContain('file.endsWith(".webmanifest")');
    expect(build).toContain("__MYOWNNOTION_SEARCH_WORKER_URL__");
    expect(build).toContain("__MYOWNNOTION_GRAPH_WORKER_URL__");
    expect(read("apps/web/index.html")).toContain("manifest.webmanifest");
    expect(read("apps/web/src/main.tsx")).toMatch(/import\.meta\.env\.PROD/);
  });

  it("packages a Bun-only API runtime and a static nginx web runtime", () => {
    const bases = JSON.parse(read("docker/base-images.json")) as {
      platforms: string[];
      bases: Record<string, { ref: string; digest: string }>;
    };
    expect(bases.platforms).toEqual(["linux/amd64", "linux/arm64"]);
    expect(bases.bases["bun"]?.ref).toBe("oven/bun:1.4.0-debian");
    expect(bases.bases["bun"]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const api = read("docker/api.Dockerfile");
    expect(api).toContain("ARG BUN_BASE");
    expect(api).toContain("RUN bun run --filter @myownnotion/api build");
    expect(api).toContain("USER bun");
    expect(api).toContain('CMD ["bun", "dist/server.js"]');
    expect(api).not.toMatch(/^FROM .*node/m);

    const web = read("docker/web.Dockerfile");
    expect(web).toContain("ARG BUN_BASE");
    expect(web).toContain("ARG NGINX_BASE");
    expect(web).toContain("RUN bun run --filter @myownnotion/web build");
    expect(web).toContain("USER 101");
  });

  it("keeps page sync on Bun's built-in ws boundary", () => {
    expect(Bun.resolveSync("ws", repoRoot)).toBe("ws");
    const route = read("apps/api/src/routes/page-sync-socket.ts");
    expect(route).toContain("PendingAuthenticationFrames");
    expect(route).toContain('socket.close(1009, "authentication-buffer-full")');
    expect(route).toContain('socket.close(4401, "authentication-required")');
    expect(read("package.json")).not.toContain("ws-npm");
  });
});
