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
});
