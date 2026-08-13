/**
 * Compose publishes only loopback ports (T092).
 *
 * No supported production composition exists before authentication; every
 * published development port must bind to 127.0.0.1 explicitly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface ComposeDocument {
  services?: Record<
    string,
    {
      ports?: Array<string | { host_ip?: string; published?: number | string }>;
      image?: string;
      restart?: string;
      command?: string[];
      depends_on?: Record<string, { condition?: string }>;
    }
  >;
  volumes?: Record<string, unknown>;
}

const repoRoot = path.resolve(import.meta.dirname, "../..");

function loadCompose(file: string): ComposeDocument {
  return parse(readFileSync(path.join(repoRoot, file), "utf8")) as ComposeDocument;
}

describe("compose security (loopback only)", () => {
  it.each(["compose.yaml", "compose.override.yaml"])(
    "%s publishes ports only on 127.0.0.1",
    (file) => {
      const compose = loadCompose(file);
      for (const [serviceName, service] of Object.entries(compose.services ?? {})) {
        for (const port of service.ports ?? []) {
          if (typeof port === "string") {
            expect(
              port.startsWith("127.0.0.1:"),
              `${file} service ${serviceName} port ${port} must bind 127.0.0.1`,
            ).toBe(true);
          } else {
            expect(port.host_ip, `${file} service ${serviceName} long-form port`).toBe("127.0.0.1");
          }
        }
      }
    },
  );

  it("PostgreSQL has a healthcheck and a persistent named volume", () => {
    const compose = loadCompose("compose.yaml");
    const postgres = compose.services?.["postgres"] as {
      healthcheck?: unknown;
      volumes?: string[];
      environment?: Record<string, string>;
    };
    expect(postgres).toBeDefined();
    expect(postgres.healthcheck).toBeDefined();
    expect(postgres.volumes?.some((volume) => volume.startsWith("postgres-data:"))).toBe(true);
    expect(compose.volumes).toHaveProperty("postgres-data");
  });

  it("uses the PostgreSQL 18 image with a shared UTC timezone", () => {
    const compose = loadCompose("compose.yaml");
    const postgres = compose.services?.["postgres"] as {
      image?: string;
      environment?: Record<string, string>;
    };
    expect(postgres.image).toBe("postgres:18");
    expect(postgres.environment?.["TZ"]).toBe("UTC");
  });

  it("serves the client and the API from one origin", () => {
    // `MYOWNNOTION_PUBLIC_ORIGIN` names a single origin and the production
    // session cookie is `__Host-`-prefixed, so it is returned only to the
    // exact origin that set it. If the web server does not carry `/v1/`
    // through to the API, the client's relative calls resolve against the
    // static shell and every one of them answers with index.html.
    const nginx = readFileSync(path.join(repoRoot, "docker/web-nginx.conf"), "utf8");
    expect(nginx).toMatch(/location\s+\/v1\/\s*\{[^}]*proxy_pass\s+http:\/\/api:3001/s);
    expect(nginx).toMatch(/location\s+=\s+\/health\s*\{[^}]*proxy_pass\s+http:\/\/api:3001/s);
  });

  it("applies the schema through a one-shot job the API waits for", () => {
    // The image carries the reviewed SQL, but nothing applied it: a fresh
    // deployment started the API against an empty database and crashed on its
    // first query. Migrating from server startup instead would let replicas
    // race, so it is a job whose exit status gates the API.
    const compose = loadCompose("compose.yaml");
    const migrate = compose.services?.["migrate"] as { restart?: string; command?: string[] };
    expect(migrate).toBeDefined();
    expect(migrate.restart).toBe("no");
    expect(migrate.command).toContain("dist/migrate.mjs");

    const api = compose.services?.["api"] as {
      depends_on?: Record<string, { condition?: string }>;
    };
    expect(api.depends_on?.["migrate"]?.condition).toBe("service_completed_successfully");
  });
});
