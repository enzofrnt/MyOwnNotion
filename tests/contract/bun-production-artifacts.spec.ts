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

  it("serves container browsers from a guarded container-local E2E build", () => {
    const build = read("apps/web/build.ts");
    expect(build).toContain('process.env["MYOWNNOTION_E2E_WEB_OUTDIR"]');
    expect(build).toContain('path.basename(resolved).startsWith("myownnotion-e2e-web-")');
    expect(build).toContain("os.tmpdir()");

    const webPackage = JSON.parse(read("apps/web/package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(webPackage.scripts?.["preview"]).toContain(
      `--outDir "\${MYOWNNOTION_WEB_DIST_DIR:-dist}"`,
    );

    const container = read("scripts/test-e2e-firefox-container.sh");
    expect(container).toContain('container_web_dist="/tmp/myownnotion-e2e-web-dist"');
    expect(container).toContain(`if [[ ! -f "\${deployment_key_file}" ]]`);
    expect(container).toContain(`COPYFILE_DISABLE=1 tar --no-xattrs -C "\${repo_root}" -cf -`);
    for (const excluded of [
      "./.env",
      "./.env.*",
      "./secrets",
      "./node_modules",
      "*/node_modules",
      "*/dist",
      "./test-results",
    ]) {
      expect(container).toContain(`--exclude='${excluded}'`);
    }
    expect(container).not.toContain(`--volume "\${repo_root}:/work"`);
    expect(container).not.toContain(`--volume "\${deployment_key_file}`);
    expect(container).toContain(`-C "$(dirname -- "\${deployment_key_file}")"`);
    expect(container).toContain(`chmod 0400 "\${MYOWNNOTION_DEPLOYMENT_KEY_FILE}"`);
    expect(container).toContain(`--volume "\${repo_root}/test-results:/work/test-results"`);
    expect(container).toContain(`--env MYOWNNOTION_E2E_WEB_OUTDIR="\${container_web_dist}"`);
    expect(container).toContain(`--env MYOWNNOTION_WEB_DIST_DIR="\${container_web_dist}"`);
    expect(container).toContain('test "$(bun --version)" = "1.4.0"');
    expect(container).toContain("test -d node_modules");
    expect(container).toContain("MYOWNNOTION_E2E_BUILD=1 bun run --filter @myownnotion/web build");
    expect(container).toContain('exec bash scripts/e2e/run-container-project.sh "$@"');

    const containerBootstrap = read("scripts/e2e/bootstrap-container.sh");
    expect(containerBootstrap).toContain("readonly max_attempts=4");
    expect(containerBootstrap).toContain('retry_bootstrap "installing unzip" install_unzip');
    expect(containerBootstrap).toContain('retry_bootstrap "installing Bun 1.4.0" install_bun');
    expect(containerBootstrap).toContain('retry_bootstrap "installing locked dependencies" bun ci');
    expect(containerBootstrap).toContain('test "$(bun --version)" = "1.4.0"');

    const preparedImage = read("scripts/e2e/prepare-container-image.sh");
    expect(preparedImage).toContain("docker/e2e-browser.Dockerfile");
    expect(preparedImage).toContain("MYOWNNOTION_PREPARED_PLAYWRIGHT_IMAGE=");
    expect(preparedImage).toContain("packages/*/package.json");

    const e2eDockerfile = read("docker/e2e-browser.Dockerfile");
    expect(e2eDockerfile).toContain("FROM $" + "{BUN_BASE} AS bun-runtime");
    expect(e2eDockerfile).toContain("FROM $" + "{PLAYWRIGHT_BASE}");
    expect(e2eDockerfile).toContain("COPY --from=bun-runtime /usr/local/bin/bun");
    expect(e2eDockerfile).toContain("--mount=type=cache,id=bun-install");
    expect(e2eDockerfile).toContain("source scripts/e2e/bootstrap-container.sh");

    const containerProject = read("scripts/e2e/run-container-project.sh");
    expect(containerProject).toContain(`[[ "\${project}" == webkit-* ]]`);
    expect(containerProject).toContain("for shard in 1/3 2/3 3/3");
    expect(containerProject).toContain(`"--shard=\${shard}"`);
    expect(containerProject).toContain("--fail-on-flaky-tests");

    const playwrightConfig = read("playwright.config.ts");
    expect(playwrightConfig).toContain('timeout: name.startsWith("webkit-") ? 120_000 : 60_000');
    expect(playwrightConfig).toContain("expect: { timeout: 10_000 }");
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
