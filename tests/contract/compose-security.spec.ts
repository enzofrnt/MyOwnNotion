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

// ---------------------------------------------------------------------------
// The rest of the baseline (T092, FR-030 – FR-032, FR-035)
// ---------------------------------------------------------------------------
//
// These assert the shape of the deployment an owner actually runs. The
// question behind each one is the same: what would a hosting administrator
// discover, and when?
//
// A missing health check is discovered when a container comes up unable to
// serve and nothing notices. A secret inlined into the file is discovered when
// it appears in a backup of the repository. A world-bound port is discovered by
// someone who was not looking for it. None of them fails loudly at the moment
// the mistake is made, which is exactly why they are checked here.

interface FullCompose {
  services?: Record<
    string,
    {
      image?: string;
      environment?: Record<string, string>;
      healthcheck?: { test?: unknown; interval?: string };
      depends_on?: Record<string, { condition?: string }>;
      volumes?: string[];
      secrets?: string[];
      read_only?: boolean;
      security_opt?: string[];
      build?: unknown;
    }
  >;
  volumes?: Record<string, unknown>;
  secrets?: Record<string, { file?: string }>;
}

const base = parse(readFileSync(path.join(repoRoot, "compose.yaml"), "utf8")) as FullCompose;
const override = parse(
  readFileSync(path.join(repoRoot, "compose.override.yaml"), "utf8"),
) as FullCompose;
const envExample = readFileSync(path.join(repoRoot, ".env.example"), "utf8");

describe("the services the baseline defines", () => {
  it("has api, web, postgres, and the one-shot migrate job", () => {
    const services = Object.keys(base.services ?? {});
    expect(services).toEqual(expect.arrayContaining(["api", "web", "postgres", "migrate"]));
  });

  it("gives every long-running service a health check", () => {
    // A container that comes up unable to serve and is never asked is a
    // deployment that looks healthy and is not. `migrate` is exempt because it
    // is a job: it runs to completion, and its exit status is the check.
    for (const name of ["api", "web", "postgres"]) {
      expect(base.services?.[name]?.healthcheck?.test, `${name} has no healthcheck`).toBeDefined();
    }
  });

  it("starts the API only after the schema job has succeeded", () => {
    // `service_completed_successfully`, not `service_started`. The API must not
    // begin serving against a schema that is still being applied.
    expect(base.services?.["api"]?.depends_on?.["migrate"]?.condition).toBe(
      "service_completed_successfully",
    );
    expect(base.services?.["api"]?.depends_on?.["postgres"]?.condition).toBe("service_healthy");
  });
});

describe("durable storage", () => {
  it("keeps the file store in a named volume", () => {
    // A bind mount would tie the data to one host path, and an anonymous
    // volume would be discarded by `docker compose down -v` along with every
    // file an owner has uploaded.
    expect(Object.keys(base.volumes ?? {})).toEqual(
      expect.arrayContaining(["postgres-data", "file-store"]),
    );
    expect(base.services?.["api"]?.volumes?.join(" ")).toContain("file-store:");
  });

  it("mounts the file store where the API is configured to write", () => {
    // The two must agree. A volume mounted somewhere the application does not
    // write is a volume that survives every restart and holds nothing.
    const blobRoot = base.services?.["api"]?.environment?.["MYOWNNOTION_BLOB_ROOT"];
    expect(blobRoot).toBeDefined();
    expect(base.services?.["api"]?.volumes?.join(" ")).toContain(blobRoot ?? " ");
  });
});

describe("secrets", () => {
  it("carries no secret value, only a path", () => {
    // The file is committed. Anything in it is in every clone, every backup,
    // and every screenshot of the repository.
    const raw = readFileSync(path.join(repoRoot, "compose.yaml"), "utf8");
    expect(raw).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(base.secrets?.["deployment-key"]?.file).toBeDefined();
  });

  it("gives the API the deployment key as a mounted secret, by path", () => {
    expect(base.services?.["api"]?.secrets).toContain("deployment-key");
    // The variable holds a path inside the container, never the key itself.
    expect(base.services?.["api"]?.environment?.["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]).toMatch(
      /^\/run\/secrets\//,
    );
  });

  it("documents every path variable in .env.example", () => {
    // An operator setting this up reads that file. A variable the stack needs
    // and the example never mentions is one they discover from a stack trace.
    for (const variable of [
      "MYOWNNOTION_DEPLOYMENT_KEY_FILE",
      "MYOWNNOTION_PUBLIC_ORIGIN",
      "MYOWNNOTION_TRUSTED_PROXY_CIDRS",
    ]) {
      expect(envExample, `${variable} is undocumented`).toContain(variable);
    }
  });
});

describe("container hardening", () => {
  it("runs every service read-only with no privilege escalation", () => {
    // Neither stops a determined attacker. Both remove the easy version of
    // several attacks, and neither costs anything here because nothing in this
    // stack writes to its own image.
    for (const name of ["api", "web", "migrate"]) {
      expect(base.services?.[name]?.read_only, `${name} is writable`).toBe(true);
      expect(base.services?.[name]?.security_opt, `${name} allows escalation`).toContain(
        "no-new-privileges:true",
      );
    }
  });
});

describe("images", () => {
  it("selects every image by an exact tag or digest, never latest", () => {
    // `latest` is only as fresh as the last publish. Pulling it can hand an
    // operator an image many commits behind the one they are testing, with
    // routes the client already calls simply absent.
    for (const [name, service] of Object.entries(base.services ?? {})) {
      const image = service.image ?? "";
      expect(image, `${name} uses a moving tag`).not.toMatch(/:latest$/);
      expect(image, `${name} has no tag at all`).toMatch(/[:@]/);
    }
  });
});

describe("the local-build override", () => {
  it("builds rather than pulls", () => {
    // The override exists so a developer runs their own working tree. If it
    // pulled, `docker compose up` would silently test something else.
    expect(override.services?.["api"]?.build ?? override.services?.["web"]?.build).toBeDefined();
  });

  it("does not weaken the loopback binding", () => {
    // Checked by the suite above for both files, and restated here because
    // this is the file most likely to be edited casually.
    const raw = readFileSync(path.join(repoRoot, "compose.override.yaml"), "utf8");
    expect(raw).not.toMatch(/^\s+- "0\.0\.0\.0:/m);
  });
});

describe("one baseline, not two", () => {
  it("defines the stack in compose.yaml alone", () => {
    // Feature 002 owns the baseline. A second composition defining the same
    // services would make "which file is the deployment" a question with two
    // answers, and an operator would have to guess which one their host runs.
    for (const file of ["compose.yaml", "compose.override.yaml"]) {
      expect(() => readFileSync(path.join(repoRoot, file), "utf8")).not.toThrow();
    }
    // The override adds to the baseline rather than restating it: it carries
    // no `secrets` section of its own.
    expect(override.secrets).toBeUndefined();
  });
});
