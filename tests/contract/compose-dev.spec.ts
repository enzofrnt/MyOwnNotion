import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const read = (file: string): string => readFileSync(path.join(repoRoot, file), "utf8");

interface ComposeService {
  image?: string;
  build?: { dockerfile?: string; args?: Record<string, string> };
  ports?: string[];
  environment?: Record<string, string>;
  command?: string[];
  restart?: string;
  volumes?: string[];
  depends_on?: Record<string, { condition?: string }>;
}

interface ComposeDocument {
  name?: string;
  services?: Record<string, ComposeService>;
}

describe("local HTTPS development stack", () => {
  const raw = read("compose.dev.yaml");
  const compose = parse(raw) as ComposeDocument;
  const official = parse(read("compose.yaml")) as ComposeDocument;
  const caddyfile = read("docker/Caddyfile.dev");
  const bases = JSON.parse(read("docker/base-images.json")) as {
    bases: { bun: { ref: string; digest: string } };
  };

  it("is a named helper and not the official deployment topology", () => {
    expect(compose.name).toBe("myownnotion-dev");
    expect(Object.keys(official.services ?? {}).sort()).toEqual([
      "api",
      "migrate",
      "postgres",
      "web",
    ]);
    expect(official.services).not.toHaveProperty("caddy");
    expect(raw).toMatch(/Not the official deployment/i);
  });

  it("runs postgres, a one-shot migrate job, hot-reload app processes, and Caddy", () => {
    expect(Object.keys(compose.services ?? {}).sort()).toEqual([
      "api",
      "caddy",
      "migrate",
      "postgres",
      "web",
    ]);
    expect(compose.services?.["migrate"]?.restart).toBe("no");
    expect(compose.services?.["migrate"]?.command).toEqual(["bun", "scripts/db/migrate.ts"]);
    expect(compose.services?.["api"]?.command).toEqual([
      "bun",
      "run",
      "--filter",
      "@myownnotion/api",
      "dev",
    ]);
    expect(compose.services?.["web"]?.command).toEqual([
      "bun",
      "run",
      "--filter",
      "@myownnotion/web",
      "dev",
    ]);
    expect(compose.services?.["api"]?.depends_on?.["migrate"]?.condition).toBe(
      "service_completed_successfully",
    );
  });

  it("publishes only loopback ports and pins images without latest", () => {
    for (const [name, service] of Object.entries(compose.services ?? {})) {
      for (const port of service.ports ?? []) {
        expect(port.startsWith("127.0.0.1:"), `${name} port ${port}`).toBe(true);
      }
      const image = service.image ?? "";
      if (image.length > 0) {
        expect(image, `${name} uses latest`).not.toMatch(/:latest$/);
      }
    }
    expect(compose.services?.["caddy"]?.image).toBe("caddy:2.10.2-alpine");
    expect(compose.services?.["postgres"]?.image).toBe("postgres:18");
  });

  it("builds the hot-reload image from the pinned Bun digest", () => {
    const bunBase = `${bases.bases.bun.ref}@${bases.bases.bun.digest}`;
    expect(raw).toContain("dockerfile: docker/dev.Dockerfile");
    expect(raw).toContain(`BUN_BASE: ${bunBase}`);
    expect(raw).toMatch(/^\s+<<: \*dev-app$/m);
  });

  it("uses https://localhost:8443 so passkeys and Host-prefix cookies work", () => {
    expect(raw).toContain("MYOWNNOTION_PUBLIC_ORIGIN: https://localhost:8443");
    expect(raw).toContain('MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "0"');
    expect(raw).toContain('MYOWNNOTION_DEV_HTTPS_PROXY: "1"');
    expect(raw).toContain(
      "MYOWNNOTION_TRUSTED_PROXY_CIDRS: 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32",
    );
  });

  it("bind-mounts source without overlaying host node_modules", () => {
    expect(raw).toContain("./apps/api/src:/app/apps/api/src");
    expect(raw).toContain("./apps/web/src:/app/apps/web/src");
    expect(raw).toContain("./packages/database/migrations:/app/packages/database/migrations");
    expect(raw).not.toMatch(/node_modules/);
    expect(raw).toMatch(/deployment-key\}:\/run\/secrets\/deployment-key:ro/);
  });

  it("resets only the development data volumes and keeps Caddy's local CA", () => {
    const stack = read("scripts/dev/stack.ts");
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["dev:stack:reset"]).toBe("bun scripts/dev/stack.ts --reset");
    expect(stack).toContain('args.includes("--reset")');
    expect(stack).toContain('const projectName = "myownnotion-dev"');
    expect(stack).toMatch(/\$\{projectName\}_postgres-data/);
    expect(stack).toMatch(/\$\{projectName\}_file-store/);
    expect(stack).toMatch(/\$\{projectName\}_backup-store/);
    expect(stack).not.toMatch(/\$\{projectName\}_caddy-data/);
    expect(stack).not.toMatch(/\$\{projectName\}_caddy-config/);
    expect(stack).not.toMatch(/compose\(\["down".*"-v"/);
  });

  it("keeps the Compose project detached and lets Bun and Vite reload themselves", () => {
    const stack = read("scripts/dev/stack.ts");
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["dev:stack:logs"]).toBe("bun scripts/dev/stack.ts --logs");
    expect(stack).toContain('compose(["up", "-d", "--wait", "--remove-orphans"])');
    expect(stack).toContain('args.includes("--logs")');
    expect(stack).not.toMatch(/compose\(\[[^\]]*--watch/);
    expect(stack).not.toContain("compose watch");
    expect(raw).not.toMatch(/^\s+develop:/m);
    expect(raw).not.toMatch(/action:\s*(rebuild|sync\+restart)/);
  });

  it("terminates TLS for localhost and upgrades /v1 and Vite with heartbeat-safe timeouts", () => {
    expect(caddyfile).toContain("localhost:8443");
    expect(caddyfile).toContain("tls internal");
    expect(caddyfile).toContain("local_certs");
    expect(caddyfile).toContain("handle /v1*");
    expect(caddyfile).toContain("reverse_proxy api:3001");
    expect(caddyfile).toContain("reverse_proxy web:5173");
    expect(caddyfile).toContain("flush_interval -1");
    expect(caddyfile).toMatch(/read_timeout\s+75s/);
    expect(caddyfile).toContain("header_up X-Forwarded-Proto {scheme}");
    expect(caddyfile).toContain("redir https://localhost:8443{uri} permanent");
  });
});
