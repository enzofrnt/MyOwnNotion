import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const read = (file: string): string => readFileSync(path.join(repoRoot, file), "utf8");

describe("realtime reverse-proxy contract", () => {
  it("upgrades the same-origin /v1 path in both Vite server modes", () => {
    const vite = read("apps/web/vite.config.ts");
    expect(vite).toMatch(/"\/v1"\s*:\s*\{[^}]*ws:\s*true[^}]*\}/s);
    expect(vite.match(/proxy:\s*apiProxy\(\)/g)).toHaveLength(2);
  });

  it("keeps same-origin Vite HMR through the local Caddy helper when HTTPS proxy mode is on", () => {
    const vite = read("apps/web/vite.config.ts");
    expect(vite).toContain('process.env["MYOWNNOTION_DEV_HTTPS_PROXY"]');
    expect(vite).toContain("usePolling: true");
    expect(vite).not.toMatch(/hmr:\s*\{/);
  });

  it("keeps WebSocket upgrade headers and heartbeat-safe timeouts in bundled nginx", () => {
    const nginx = read("docker/web-nginx.conf");
    expect(nginx).toMatch(/map\s+\$http_upgrade\s+\$connection_upgrade\s*\{/);
    const apiLocation = /location\s+\/v1\/\s*\{(?<body>[\s\S]*?)\n\s*\}/.exec(nginx)?.groups?.[
      "body"
    ];
    expect(apiLocation).toBeDefined();
    expect(apiLocation).toContain("proxy_http_version 1.1;");
    expect(apiLocation).toContain("proxy_set_header Upgrade $http_upgrade;");
    expect(apiLocation).toContain("proxy_set_header Connection $connection_upgrade;");
    expect(apiLocation).toContain("proxy_buffering off;");
    const readTimeout = /proxy_read_timeout\s+(\d+)s;/.exec(apiLocation ?? "");
    expect(Number(readTimeout?.[1])).toBeGreaterThanOrEqual(60);
  });

  it("documents one HTTPS origin, forwarded headers, upgrades, and timeout diagnosis", () => {
    const guide = read("docs/deployment/reverse-proxy.md");
    expect(guide).toContain("MYOWNNOTION_PUBLIC_ORIGIN");
    expect(guide).toContain("X-Forwarded-Proto");
    expect(guide).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
    expect(guide).toContain("proxy_read_timeout 75s");
    expect(guide).toMatch(/101 Switching Protocols/i);
  });

  it("adds no Draw.io or collaboration sidecar to the supported topology", () => {
    const compose = parse(read("compose.yaml")) as {
      services?: Record<string, { image?: string }>;
    };
    expect(Object.keys(compose.services ?? {}).sort()).toEqual([
      "api",
      "migrate",
      "postgres",
      "web",
    ]);
    for (const [name, service] of Object.entries(compose.services ?? {})) {
      expect(`${name} ${service.image ?? ""}`).not.toMatch(
        /draw\.?io|hocuspocus|y-websocket|collab/i,
      );
    }
  });
});
