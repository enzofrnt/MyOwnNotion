/**
 * Shared types and failure modes for security repositories (T020, feature 002).
 *
 * Two things every security repository must agree on:
 *
 *   1. **Scope.** Every row belongs to one installation, and workspace-scoped
 *      rows belong to the one canonical feature-001 workspace. A repository
 *      that forgets the scope silently reads or writes across a boundary that
 *      is supposed to be impossible, so the scope travels as an explicit
 *      argument rather than as ambient state.
 *   2. **Failure direction.** A security repository fails *closed*. When a
 *      precondition cannot be verified — the installation is missing, the
 *      state is wrong, the key is unavailable — it raises rather than
 *      returning a default, because a default here means "proceed without the
 *      check".
 */

import type { InstallationState, SafeProblemCode } from "@myownnotion/domain";

/**
 * The scope every security operation runs under.
 *
 * `workspaceId` is absent before the atomic promotion: the pre-confirmation
 * bootstrap workflow has an installation but no workspace, and that is exactly
 * the `0/0` state the design depends on.
 */
export interface SecurityScope {
  readonly installationId: string;
  readonly workspaceId?: string;
}

/** Scope for an operation that requires a committed workspace. */
export interface WorkspaceScope {
  readonly installationId: string;
  readonly workspaceId: string;
}

export function requireWorkspaceScope(scope: SecurityScope): WorkspaceScope {
  if (scope.workspaceId === undefined) {
    throw new SecurityRepositoryError(
      "installation_not_ready",
      "operation requires a committed workspace; the installation is still uninitialized",
    );
  }
  return { installationId: scope.installationId, workspaceId: scope.workspaceId };
}

/**
 * A repository failure, already carrying the safe problem code the API will
 * return. Mapping happens here, at the point where the cause is known, so a
 * route handler never has to guess which failure it is looking at — and never
 * has to invent a message that might leak content.
 */
export class SecurityRepositoryError extends Error {
  constructor(
    readonly code: SafeProblemCode,
    /** Operator-facing detail. Never returned to a client verbatim. */
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message);
    this.name = "SecurityRepositoryError";
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Raised when the installation is not in a state that permits the operation. */
export class InstallationStateError extends SecurityRepositoryError {
  constructor(
    readonly actual: InstallationState,
    readonly expected: readonly InstallationState[],
  ) {
    super(
      actual === "degraded" ? "installation_degraded" : "installation_not_ready",
      `installation is ${actual}; this operation requires one of: ${expected.join(", ")}`,
    );
    this.name = "InstallationStateError";
  }
}

/**
 * An idempotency key makes a replay return the prior result instead of
 * performing the side effect twice. Every resumable security operation —
 * rotation checkpoints, migration checkpoints, bootstrap claims — carries one.
 *
 * The key is caller-supplied and stable across retries of the *same logical*
 * operation; it must never be regenerated on retry, or the replay protection
 * disappears exactly when it is needed.
 */
export type IdempotencyKey = string;

export interface IdempotentResult<T> {
  readonly value: T;
  /** True when a prior identical operation supplied this result. */
  readonly replayed: boolean;
}

/** PostgreSQL SQLSTATEs the security layer interprets rather than propagates. */
export const SQLSTATE = {
  uniqueViolation: "23505",
  checkViolation: "23514",
  foreignKeyViolation: "23503",
  serializationFailure: "40001",
  deadlockDetected: "40P01",
} as const;

/**
 * Unwraps a driver error from whatever the query layer wrapped it in. Drizzle
 * re-throws with its own `Failed query: …` message and keeps the PostgreSQL
 * error as `cause`, so matching on the message alone finds nothing.
 */
export function driverError(
  reason: unknown,
): { code?: string; constraint?: string; table?: string } | null {
  let current: unknown = reason;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "object" && "code" in current) {
      return current as { code?: string; constraint?: string; table?: string };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(reason: unknown, constraint?: string): boolean {
  const error = driverError(reason);
  if (error?.code !== SQLSTATE.uniqueViolation) {
    return false;
  }
  return constraint === undefined || error.constraint === constraint;
}

export function isCheckViolation(reason: unknown, constraint?: string): boolean {
  const error = driverError(reason);
  if (error?.code !== SQLSTATE.checkViolation) {
    return false;
  }
  return constraint === undefined || error.constraint === constraint;
}

export function isSerializationFailure(reason: unknown): boolean {
  const code = driverError(reason)?.code;
  return code === SQLSTATE.serializationFailure || code === SQLSTATE.deadlockDetected;
}
