/**
 * Security configuration and the loopback cookie exception (T016, feature 002).
 *
 * Reads the environment once, at startup, and refuses an incoherent
 * combination rather than discovering it on the first request.
 *
 * The rule this module exists to enforce: **the production cookie is never
 * issued over HTTP, and the development exception is never available outside
 * loopback.** Those are two separate cookies with two separate names, so a
 * misconfiguration cannot quietly downgrade a production session — it
 * produces a differently named cookie the production path does not accept.
 *
 * `MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1` alone is not enough: the public
 * origin must also be loopback HTTP. A public HTTP origin with the flag set is
 * a configuration error and the process refuses to start, because the operator
 * has asked for something that would ship session cookies in clear text over a
 * network.
 *
 * The bound listener is deliberately *not* part of that decision. A container
 * has to listen on `0.0.0.0` to be reachable through its published port at
 * all, so requiring a loopback listener made the exception unusable inside the
 * Compose stack and left the whole security surface silently unregistered. The
 * public origin is what actually bounds the cookie's reach: with a loopback
 * origin, only a browser on this host can reach the application at the origin
 * the cookie, CSRF, and WebAuthn checks are pinned to. Confining the listener
 * on top of that is the deployment's job — `compose.yaml` publishes every port
 * on `127.0.0.1` and `pnpm compose:check` verifies it.
 */

export const PRODUCTION_SESSION_COOKIE = "__Host-mn_session" as const;
export const DEVELOPMENT_SESSION_COOKIE = "mn_dev_session" as const;

export type SessionCookieMode = "production" | "loopback-development";

export interface SecurityConfig {
  readonly publicOrigin: URL;
  readonly listenHost: string;
  readonly listenPort: number;
  /** CIDRs whose `X-Forwarded-*` headers are honoured. Empty means none. */
  readonly trustedProxyCidrs: readonly string[];
  readonly cookieMode: SessionCookieMode;
  readonly sessionCookieName: string;
  readonly deploymentKeyFile: string | undefined;
  readonly blobRoot: string;
  readonly maxRequestBytes: number;
  readonly maxBodyBytes: number;
  readonly maxFileBytes: number;
}

export class SecurityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityConfigError";
  }
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Whether an origin is a loopback HTTP origin.
 *
 * `localhost` counts because that is what a developer types, but note that it
 * can resolve elsewhere in a hostile DNS environment; the listener check below
 * is what actually constrains reachability.
 */
export function isLoopbackHttpOrigin(origin: URL): boolean {
  return origin.protocol === "http:" && isLoopbackHostname(origin.hostname);
}

function readInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SecurityConfigError(`${name} must be a positive integer (found: ${raw})`);
  }
  return value;
}

function parseOrigin(raw: string | undefined): URL {
  if (raw === undefined || raw.trim().length === 0) {
    throw new SecurityConfigError(
      "MYOWNNOTION_PUBLIC_ORIGIN is required; cookie and WebAuthn origin checks derive from it",
    );
  }
  let origin: URL;
  try {
    origin = new URL(raw.trim());
  } catch {
    throw new SecurityConfigError(`MYOWNNOTION_PUBLIC_ORIGIN is not a valid URL: ${raw}`);
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new SecurityConfigError(
      `MYOWNNOTION_PUBLIC_ORIGIN must be http or https (found: ${origin.protocol})`,
    );
  }
  if (origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
    throw new SecurityConfigError(
      "MYOWNNOTION_PUBLIC_ORIGIN must be a bare origin with no path, query, or fragment",
    );
  }
  return origin;
}

export type Environment = Record<string, string | undefined>;

/**
 * Builds the configuration, refusing every incoherent combination.
 *
 * Deliberately takes the environment as an argument so the whole decision
 * table is testable without mutating `process.env`.
 */
export function loadSecurityConfig(env: Environment = process.env): SecurityConfig {
  const publicOrigin = parseOrigin(env["MYOWNNOTION_PUBLIC_ORIGIN"]);
  const listenHost = env["MYOWNNOTION_API_HOST"]?.trim() ?? "127.0.0.1";
  const listenPort = readInteger(env["MYOWNNOTION_API_PORT"], 3001, "MYOWNNOTION_API_PORT");
  const exceptionRequested = env["MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE"]?.trim() === "1";

  const originIsLoopbackHttp = isLoopbackHttpOrigin(publicOrigin);

  let cookieMode: SessionCookieMode;
  if (exceptionRequested) {
    if (!originIsLoopbackHttp) {
      throw new SecurityConfigError(
        `MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1 requires a loopback HTTP public origin; ` +
          `${publicOrigin.origin} would send session cookies in clear text over a network`,
      );
    }
    cookieMode = "loopback-development";
  } else {
    if (publicOrigin.protocol !== "https:") {
      // Without the named exception, an HTTP origin has no way to carry a
      // `__Host-` cookie, so there is no session policy that would work.
      throw new SecurityConfigError(
        `MYOWNNOTION_PUBLIC_ORIGIN must be https unless the named loopback exception is enabled; ` +
          `${PRODUCTION_SESSION_COOKIE} is never issued over HTTP`,
      );
    }
    cookieMode = "production";
  }

  const trustedProxyCidrs = (env["MYOWNNOTION_TRUSTED_PROXY_CIDRS"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    publicOrigin,
    listenHost,
    listenPort,
    trustedProxyCidrs,
    cookieMode,
    sessionCookieName:
      cookieMode === "production" ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE,
    deploymentKeyFile: env["MYOWNNOTION_DEPLOYMENT_KEY_FILE"]?.trim() || undefined,
    blobRoot: env["MYOWNNOTION_BLOB_ROOT"]?.trim() ?? "./.dev-blobs",
    maxRequestBytes: readInteger(
      env["MYOWNNOTION_MAX_REQUEST_BYTES"],
      1_048_576,
      "MYOWNNOTION_MAX_REQUEST_BYTES",
    ),
    maxBodyBytes: readInteger(
      env["MYOWNNOTION_MAX_BODY_BYTES"],
      1_048_576,
      "MYOWNNOTION_MAX_BODY_BYTES",
    ),
    maxFileBytes: readInteger(
      env["MYOWNNOTION_MAX_FILE_BYTES"],
      104_857_600,
      "MYOWNNOTION_MAX_FILE_BYTES",
    ),
  };
}

/**
 * The attributes a session cookie must carry in the configured mode.
 *
 * Production is `__Host-` prefixed, which the browser itself enforces: it
 * refuses the cookie unless `Secure` is set, `Path=/`, and no `Domain` is
 * given. The development cookie deliberately does **not** use the prefix,
 * because it has no `Secure` flag and a `__Host-` cookie without `Secure`
 * would simply be dropped.
 */
export interface SessionCookieAttributes {
  readonly name: string;
  readonly secure: boolean;
  readonly httpOnly: true;
  readonly sameSite: "Strict";
  readonly path: "/";
}

export function sessionCookieAttributes(config: SecurityConfig): SessionCookieAttributes {
  return {
    name: config.sessionCookieName,
    secure: config.cookieMode === "production",
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
  };
}

/**
 * Whether a cookie name may be *accepted* in the current mode.
 *
 * Strictly one name per mode. A production installation that accepted
 * `mn_dev_session` would honour a session minted under the weaker policy, and
 * a development installation that accepted `__Host-mn_session` would blur the
 * distinction the two names exist to keep.
 */
export function acceptsCookieName(config: SecurityConfig, name: string): boolean {
  return name === config.sessionCookieName;
}
