/**
 * Compose contract gate (feature 002, FR-030 – FR-032).
 *
 * Static checks on the committed Compose files. They run without a Docker
 * daemon so the gate is identical locally and in CI:
 *
 *   1. the official stack declares `api`, `web`, `postgres`, the one-shot
 *      `migrate` schema job the API waits on, and durable volumes for
 *      PostgreSQL data and the encrypted file store;
 *   2. every published port binds 127.0.0.1 explicitly — the HTTPS boundary is
 *      the administrator's external reverse proxy, not this stack;
 *   3. no secret value appears in any Compose file: secret material arrives as
 *      a mounted file whose host path comes from a `*_FILE` variable;
 *   4. images are selected by digest or exact tag, never `latest`;
 *   5. the loopback-HTTP cookie exception is enabled only by the development
 *      override, never by the official stack.
 *
 * `compose.dev.yaml` is a local HTTPS helper (Caddy + hot reload). It is not
 * the official topology and is checked by `tests/contract/compose-dev.spec.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

interface ComposeService {
  image?: string;
  build?: unknown;
  ports?: Array<string | { host_ip?: string; published?: number | string }>;
  environment?: Record<string, string | number | null> | string[];
  volumes?: string[];
  secrets?: unknown[];
  healthcheck?: unknown;
  depends_on?: unknown;
  restart?: string;
}

interface ComposeDocument {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
  secrets?: Record<string, { file?: string; environment?: string }>;
}

const failures: string[] = [];

function load(file: string): ComposeDocument {
  return parse(readFileSync(path.join(repoRoot, file), "utf8")) as ComposeDocument;
}

function environmentEntries(service: ComposeService): Array<[string, string]> {
  const environment = service.environment;
  if (environment === undefined) {
    return [];
  }
  if (Array.isArray(environment)) {
    return environment.map((entry) => {
      const separator = entry.indexOf("=");
      return separator === -1
        ? ([entry, ""] as [string, string])
        : ([entry.slice(0, separator), entry.slice(separator + 1)] as [string, string]);
    });
  }
  return Object.entries(environment).map(([key, value]) => [key, String(value ?? "")]);
}

const base = load("compose.yaml");
const override = load("compose.override.yaml");

// 1. Required services and durable volumes.
for (const required of ["api", "web", "postgres"]) {
  if (base.services?.[required] === undefined) {
    failures.push(`compose.yaml must declare the \`${required}\` service`);
  }
}
const supportedServices = ["api", "migrate", "postgres", "web"];
for (const [file, document] of [
  ["compose.yaml", base],
  ["compose.override.yaml", override],
] as const) {
  for (const [name, service] of Object.entries(document.services ?? {})) {
    if (!supportedServices.includes(name)) {
      failures.push(
        `${file} service \`${name}\` is outside the supported app/database/migration topology`,
      );
    }
    if (/draw\.?io|hocuspocus|y-websocket|collab/i.test(`${name} ${service.image ?? ""}`)) {
      failures.push(`${file} must not add a Draw.io or collaboration sidecar (${name})`);
    }
  }
}
for (const required of ["postgres-data", "file-store"]) {
  if (base.volumes?.[required] === undefined) {
    failures.push(`compose.yaml must declare the durable \`${required}\` volume`);
  }
}
// A healthcheck answers "is this still serving?", which only a long-running
// service can answer. The schema job runs to completion and is depended on
// through its exit status instead, so `restart: "no"` marks it as one-shot.
function isOneShotJob(service: ComposeService): boolean {
  return String(service.restart ?? "").trim() === "no";
}

for (const [name, service] of Object.entries(base.services ?? {})) {
  if (service.healthcheck === undefined && !isOneShotJob(service)) {
    failures.push(`compose.yaml service \`${name}\` must define a healthcheck`);
  }
}

// The schema must be applied by a job that finishes before the API starts.
// Migrating from inside server startup would let replicas race on the same
// database, and leaving it out entirely brought the API up against an empty
// one — the failure that motivated this rule.
const migrateService = base.services?.["migrate"];
if (migrateService === undefined) {
  failures.push("compose.yaml must declare the one-shot `migrate` schema job");
} else if (!isOneShotJob(migrateService)) {
  failures.push(
    'compose.yaml service `migrate` must set `restart: "no"`; it is a job, not a service',
  );
}

const apiDependsOnMigrate = (
  base.services?.["api"]?.depends_on as Record<string, { condition?: string }> | undefined
)?.["migrate"];
if (apiDependsOnMigrate?.condition !== "service_completed_successfully") {
  failures.push(
    "compose.yaml service `api` must depend on `migrate` with `condition: service_completed_successfully`",
  );
}

// 2. Loopback-only published ports in every Compose file.
for (const [file, document] of [
  ["compose.yaml", base],
  ["compose.override.yaml", override],
] as const) {
  for (const [name, service] of Object.entries(document.services ?? {})) {
    for (const port of service.ports ?? []) {
      const bindsLoopback =
        typeof port === "string" ? port.startsWith("127.0.0.1:") : port.host_ip === "127.0.0.1";
      if (!bindsLoopback) {
        failures.push(
          `${file} service \`${name}\` publishes ${JSON.stringify(port)} without an explicit 127.0.0.1 bind`,
        );
      }
    }
  }
}

// 3. No secret value anywhere in Compose. `*_FILE` variables hold paths.
const secretNamePattern = /(password|secret|token|api[_-]?key|private[_-]?key|credential)/i;
const developmentPasswords = new Set(["myownnotion-dev"]);
for (const [file, document] of [
  ["compose.yaml", base],
  ["compose.override.yaml", override],
] as const) {
  for (const [name, service] of Object.entries(document.services ?? {})) {
    for (const [key, value] of environmentEntries(service)) {
      if (!secretNamePattern.test(key) || key.endsWith("_FILE")) {
        continue;
      }
      const interpolated = value.startsWith("${");
      const developmentDefault = [...developmentPasswords].some((password) =>
        value.includes(password),
      );
      if (value.length > 0 && !interpolated && !developmentDefault) {
        failures.push(
          `${file} service \`${name}\` sets a literal secret value for \`${key}\`; mount a secret file instead`,
        );
      }
    }
  }
  for (const [name, secret] of Object.entries(document.secrets ?? {})) {
    if (secret.file === undefined || secret.file.length === 0) {
      failures.push(`${file} secret \`${name}\` must be sourced from a mounted host file`);
    }
  }
}

// The official stack must mount the deployment wrapping key as a secret and
// reference it only by path.
const apiService = base.services?.["api"];
if (apiService !== undefined) {
  if (!(apiService.secrets ?? []).includes("deployment-key")) {
    failures.push("compose.yaml service `api` must mount the `deployment-key` secret");
  }
  const keyPath = environmentEntries(apiService).find(
    ([key]) => key === "MYOWNNOTION_DEPLOYMENT_KEY_FILE",
  );
  if (keyPath === undefined || !keyPath[1].startsWith("/run/secrets/")) {
    failures.push(
      "compose.yaml service `api` must set MYOWNNOTION_DEPLOYMENT_KEY_FILE to a /run/secrets/ path",
    );
  }
}

// 4. Immutable image selection in the official stack.
//
// Compose interpolates the whole file before it selects services, so the
// required-variable form `${VAR:?message}` would break `docker compose up -d
// postgres` — the documented local command and the one CI uses. Every variable
// therefore carries a default, and the pin is checked on that default rather
// than on the raw `${…}` string.
const interpolationWithDefault = /^\$\{[A-Z0-9_]+:-(?<fallback>.*)\}$/;

/** The value Compose resolves when the environment supplies nothing. */
function resolvedDefault(value: string): string {
  const match = interpolationWithDefault.exec(value.trim());
  return match?.groups?.["fallback"] ?? value.trim();
}

for (const [name, service] of Object.entries(base.services ?? {})) {
  const image = service.image ?? "";
  if (image.length === 0) {
    failures.push(`compose.yaml service \`${name}\` must select an image`);
    continue;
  }
  if (image.includes("${") && !interpolationWithDefault.test(image.trim())) {
    failures.push(
      `compose.yaml service \`${name}\` selects its image through \`${image}\`; use the \`\${VAR:-pinned-default}\` form so \`docker compose up -d postgres\` still interpolates`,
    );
    continue;
  }
  const pinned = resolvedDefault(image);
  if (pinned.length === 0) {
    failures.push(`compose.yaml service \`${name}\` must supply a pinned default image`);
    continue;
  }
  if (/(^|[:@/])latest\b/.test(pinned) || (!pinned.includes(":") && !pinned.includes("@"))) {
    failures.push(
      `compose.yaml service \`${name}\` must pin an image digest or exact tag (resolves to: ${pinned})`,
    );
  }
}

// The mounted-secret source must interpolate too, for the same reason.
const deploymentKeySecret = base.secrets?.["deployment-key"]?.file ?? "";
if (deploymentKeySecret.includes("${") && !interpolationWithDefault.test(deploymentKeySecret)) {
  failures.push(
    "compose.yaml secret `deployment-key` must interpolate with a default fallback; the required-variable form breaks every Compose invocation",
  );
}

// 5. The loopback cookie exception belongs to the development override only.
const officialCookieException = environmentEntries(apiService ?? {}).find(
  ([key]) => key === "MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE",
);
if (officialCookieException !== undefined && officialCookieException[1].trim() === "1") {
  failures.push(
    "compose.yaml must not hard-enable MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE; it belongs to compose.override.yaml",
  );
}
const overrideCookieException = environmentEntries(override.services?.["api"] ?? {}).find(
  ([key]) => key === "MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE",
);
if (overrideCookieException?.[1].trim() !== "1") {
  failures.push(
    "compose.override.yaml service `api` must set MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1 for the named loopback exception",
  );
}

// 6. The only public application service must carry persistent page-sync
// upgrades to the API. A plain HTTP proxy here makes the app appear healthy
// while every browser quietly falls back to slower polling.
const nginx = readFileSync(path.join(repoRoot, "docker/web-nginx.conf"), "utf8");
for (const [label, pattern] of [
  ["HTTP/1.1 upstream", /location\s+\/v1\/\s*\{[\s\S]*?proxy_http_version\s+1\.1;/],
  ["Upgrade header", /location\s+\/v1\/\s*\{[\s\S]*?proxy_set_header\s+Upgrade\s+\$http_upgrade;/],
  [
    "Connection upgrade header",
    /location\s+\/v1\/\s*\{[\s\S]*?proxy_set_header\s+Connection\s+\$connection_upgrade;/,
  ],
  ["unbuffered realtime response", /location\s+\/v1\/\s*\{[\s\S]*?proxy_buffering\s+off;/],
] as const) {
  if (!pattern.test(nginx)) failures.push(`docker/web-nginx.conf is missing ${label}`);
}
const realtimeTimeout = /location\s+\/v1\/\s*\{[\s\S]*?proxy_read_timeout\s+(\d+)s;/.exec(nginx);
if (Number(realtimeTimeout?.[1] ?? 0) < 60) {
  failures.push("docker/web-nginx.conf /v1/ proxy_read_timeout must be at least 60 seconds");
}

if (failures.length > 0) {
  console.error("Compose contract check failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.info(
  "Compose contract check passed (services, loopback ports, secrets, images, realtime upgrade).",
);
