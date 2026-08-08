/**
 * Compose publishes only loopback ports (T092/T096).
 *
 * Authentication is not implemented yet, so every published development or
 * production-like port must bind to 127.0.0.1 explicitly. The production-like
 * topology must also gate API readiness on a successful migration job.
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
      build?: { context?: string; dockerfile?: string; target?: string } | string;
      command?: string | string[];
      depends_on?: Record<string, { condition?: string }> | string[];
      healthcheck?: unknown;
      volumes?: string[];
    }
  >;
  volumes?: Record<string, unknown>;
}

const repoRoot = path.resolve(import.meta.dirname, "../..");

function loadCompose(file: string): ComposeDocument {
  return parse(readFileSync(path.join(repoRoot, file), "utf8")) as ComposeDocument;
}

describe("compose security (loopback only)", () => {
  it.each(["compose.yaml", "compose.override.yaml", "compose.prod.yaml"])(
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
    expect(postgres.volumes).toContain("postgres-data:/var/lib/postgresql");
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

  it("production-like services use GHCR images with local build fallbacks", () => {
    const compose = loadCompose("compose.prod.yaml");
    const api = compose.services?.["api"];
    const web = compose.services?.["web"];
    const imageTagReference = "$" + "{MYOWNNOTION_IMAGE_TAG:-latest}";

    expect(api?.image).toBe(`ghcr.io/enzofrnt/myownnotion-api:${imageTagReference}`);
    expect(web?.image).toBe(`ghcr.io/enzofrnt/myownnotion-web:${imageTagReference}`);
    expect(api?.build).toMatchObject({ context: ".", dockerfile: "apps/api/Dockerfile" });
    expect(web?.build).toMatchObject({ context: ".", dockerfile: "apps/web/Dockerfile" });
  });

  it("production-like startup blocks API and web readiness on migrations and health", () => {
    const compose = loadCompose("compose.prod.yaml");
    const migrate = compose.services?.["migrate"];
    const api = compose.services?.["api"];
    const web = compose.services?.["web"];

    expect(migrate?.command).toEqual(["node", "dist/migrate.mjs"]);
    expect(migrate?.depends_on).toMatchObject({ postgres: { condition: "service_healthy" } });
    expect(api?.depends_on).toMatchObject({
      postgres: { condition: "service_healthy" },
      migrate: { condition: "service_completed_successfully" },
      "object-storage": { condition: "service_healthy" },
    });
    expect(web?.depends_on).toMatchObject({ api: { condition: "service_healthy" } });
    expect(api?.healthcheck).toBeDefined();
    expect(web?.healthcheck).toBeDefined();
  });

  it("production-like state uses explicit named volumes", () => {
    const compose = loadCompose("compose.prod.yaml");
    const postgres = compose.services?.["postgres"];
    const objectStorage = compose.services?.["object-storage"];
    const operations = compose.services?.["operations"];

    expect(postgres?.volumes).toContain("postgres-data:/var/lib/postgresql");
    expect(objectStorage?.volumes).toContain("object-data:/data");
    expect(operations?.volumes).toContain("blob-data:/var/lib/myownnotion/legacy-blobs:ro");
    expect(compose.volumes).toHaveProperty("postgres-data");
    expect(compose.volumes).toHaveProperty("object-data");
    expect(compose.volumes).toHaveProperty("blob-data");
  });
});
