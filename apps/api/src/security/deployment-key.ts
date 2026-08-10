/**
 * Deployment wrapping-key loading (T016, feature 002).
 *
 * The deployment key is the root of the encryption hierarchy. It is supplied
 * by the hosting administrator as a mounted file and is never persisted with
 * workspace data, never written to a log, and never returned by any endpoint.
 *
 * Everything here fails **closed**. If the key cannot be loaded, or can be
 * loaded but does not meet the requirements, the installation reports
 * `degraded` and refuses protected reads and writes. The alternative — falling
 * back to a generated key, or continuing unencrypted — would silently produce
 * data the owner believes is protected and is not. That is the one failure
 * mode this module exists to prevent.
 *
 * The permission check is deliberately strict. A key readable by group or
 * other on a self-hosted box is readable by every process on that box, which
 * defeats the point of mounting it as a secret.
 */

import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants, readFileSync, statSync } from "node:fs";

/** AES-256: the wrapping key is exactly 32 bytes. */
export const DEPLOYMENT_KEY_BYTES = 32;

/**
 * Why a key could not be used. Each value maps to operator-actionable advice;
 * none of them ever reaches a client, which sees only `installation_degraded`.
 */
export type DeploymentKeyProblem =
  | "not-configured"
  | "missing"
  | "not-a-file"
  | "unreadable"
  | "world-readable"
  | "empty"
  | "malformed"
  | "wrong-length";

export class DeploymentKeyUnavailableError extends Error {
  constructor(
    readonly problem: DeploymentKeyProblem,
    /** Operator-facing detail. Contains a path, never key material. */
    message: string,
  ) {
    super(message);
    this.name = "DeploymentKeyUnavailableError";
  }
}

export interface DeploymentKey {
  /** Raw 32-byte key. Never log, serialize, or return this. */
  readonly bytes: Uint8Array;
  /**
   * Stable, non-reversible identifier for the key, safe to record in audit and
   * status. Lets an operator confirm *which* key is loaded without exposing it.
   */
  readonly fingerprint: string;
  readonly path: string;
}

export interface LoadDeploymentKeyOptions {
  /**
   * Permission check. Enabled by default; a test using a fixture on a
   * filesystem that cannot express modes may disable it explicitly.
   */
  readonly enforcePermissions?: boolean;
}

/**
 * Rejects a mode that grants any group or other bit. Only the API user may
 * read the key.
 */
function isTooPermissive(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

/**
 * Parses the file contents.
 *
 * Accepts base64, base64url, or hex, and tolerates surrounding whitespace,
 * because a hosting administrator writing a secret file by hand will produce
 * one of those with a trailing newline. It does **not** accept an arbitrary
 * passphrase: a short human string silently stretched into a key would look
 * like it worked while providing far less entropy than the format promises.
 */
function decodeKeyMaterial(raw: string, path: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new DeploymentKeyUnavailableError("empty", `deployment key file is empty: ${path}`);
  }

  const candidates: Array<{ encoding: BufferEncoding; pattern: RegExp }> = [
    { encoding: "hex", pattern: /^[0-9a-fA-F]+$/ },
    { encoding: "base64url", pattern: /^[A-Za-z0-9_-]+$/ },
    { encoding: "base64", pattern: /^[A-Za-z0-9+/]+={0,2}$/ },
  ];

  for (const candidate of candidates) {
    if (!candidate.pattern.test(trimmed)) {
      continue;
    }
    const decoded = Buffer.from(trimmed, candidate.encoding);
    if (decoded.length === DEPLOYMENT_KEY_BYTES) {
      return new Uint8Array(decoded);
    }
    // Right alphabet, wrong size: report the size rather than silently trying
    // another encoding that might coincidentally produce 32 bytes.
    throw new DeploymentKeyUnavailableError(
      "wrong-length",
      `deployment key at ${path} decodes to ${decoded.length} bytes; ${DEPLOYMENT_KEY_BYTES} are required`,
    );
  }

  throw new DeploymentKeyUnavailableError(
    "malformed",
    `deployment key at ${path} is not hex, base64, or base64url`,
  );
}

/**
 * Non-reversible fingerprint. Domain-separated so it can never collide with a
 * digest computed elsewhere over the same bytes, and truncated because its
 * only job is to let an operator distinguish two keys.
 */
function fingerprint(bytes: Uint8Array): string {
  return createHash("sha256")
    .update("mn.deployment-key.fingerprint.v1")
    .update(Buffer.from(bytes))
    .digest("base64url")
    .slice(0, 16);
}

/**
 * Loads and validates the key. Throws `DeploymentKeyUnavailableError` for
 * every failure; callers map that to `degraded` and refuse protected work.
 */
export function loadDeploymentKey(
  path: string | undefined,
  options: LoadDeploymentKeyOptions = {},
): DeploymentKey {
  if (path === undefined || path.trim().length === 0) {
    throw new DeploymentKeyUnavailableError(
      "not-configured",
      "MYOWNNOTION_DEPLOYMENT_KEY_FILE is not set; protected data cannot be read or written",
    );
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    throw new DeploymentKeyUnavailableError(
      "missing",
      `deployment key file does not exist: ${path}`,
    );
  }
  if (!stats.isFile()) {
    throw new DeploymentKeyUnavailableError(
      "not-a-file",
      `deployment key path is not a regular file: ${path}`,
    );
  }
  if ((options.enforcePermissions ?? true) && isTooPermissive(stats.mode)) {
    throw new DeploymentKeyUnavailableError(
      "world-readable",
      `deployment key at ${path} is readable beyond its owner (mode ${(stats.mode & 0o777).toString(8)}); use 0400 or 0600`,
    );
  }
  try {
    accessSync(path, fsConstants.R_OK);
  } catch {
    throw new DeploymentKeyUnavailableError(
      "unreadable",
      `deployment key at ${path} cannot be read by this process`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new DeploymentKeyUnavailableError(
      "unreadable",
      `deployment key at ${path} could not be read`,
    );
  }

  const bytes = decodeKeyMaterial(raw, path);
  return { bytes, fingerprint: fingerprint(bytes), path };
}

export type DeploymentKeyStatus =
  | { readonly available: true; readonly fingerprint: string }
  | { readonly available: false; readonly problem: DeploymentKeyProblem };

/**
 * Non-throwing form for a status endpoint or a startup probe.
 *
 * Returns only the problem *category*, never the operator message, because the
 * message contains a filesystem path. The operator reads the path in the
 * server log; the owner sees that the installation is degraded.
 */
export function checkDeploymentKey(
  path: string | undefined,
  options: LoadDeploymentKeyOptions = {},
): DeploymentKeyStatus {
  try {
    const key = loadDeploymentKey(path, options);
    return { available: true, fingerprint: key.fingerprint };
  } catch (error) {
    if (error instanceof DeploymentKeyUnavailableError) {
      return { available: false, problem: error.problem };
    }
    throw error;
  }
}
