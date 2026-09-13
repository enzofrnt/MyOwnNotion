/**
 * Private-route readiness guard (T021, feature 002).
 *
 * Authentication answers "who is calling". This answers the separate question
 * "is the installation in a state where this operation is meaningful". Both
 * must pass, and they fail differently: an unauthenticated caller gets 401, a
 * caller hitting a degraded installation gets 503.
 *
 * The judgement encoded here: **a degraded installation refuses protected
 * work but keeps answering status.** When the deployment key is unavailable,
 * every protected read and write fails closed — but the owner must still be
 * able to see *why*, or a key-mounting mistake becomes an opaque outage with
 * no diagnostic path. Status is therefore explicitly exempt.
 */

import {
  type InstallationState,
  protectedOperationsAvailable,
  type SafeProblemCode,
} from "@myownnotion/domain";
import type { SecurityRequestContext } from "./request-context.ts";

/**
 * What an operation needs from the installation.
 *
 * - `none`: reachable at any time, including before the installation row
 *   exists. Health and installation status.
 * - `uninitialized`: only before ownership is committed. The bootstrap flow;
 *   once an owner exists these must refuse, or a second owner becomes possible.
 * - `initialized`: an owner exists. Session and inventory operations that do
 *   not touch protected data, so they still work while degraded.
 * - `protected`: touches encrypted data. Requires a usable deployment key.
 */
export type ReadinessRequirement = "none" | "uninitialized" | "initialized" | "protected";

export type ReadinessDecision =
  | { readonly ready: true }
  | { readonly ready: false; readonly code: SafeProblemCode };

const INITIALIZED: readonly InstallationState[] = [
  "recovery-required",
  "ready",
  "migration-in-progress",
  "degraded",
];

export function checkReadiness(
  context: SecurityRequestContext,
  requirement: ReadinessRequirement,
): ReadinessDecision {
  if (requirement === "none") {
    return { ready: true };
  }

  const state = context.installationState;
  if (state === null) {
    // No installation row: only the bootstrap flow and status make sense.
    return requirement === "uninitialized"
      ? { ready: true }
      : { ready: false, code: "installation_not_ready" };
  }

  if (requirement === "uninitialized") {
    // Once ownership is committed, the bootstrap surface must close. Leaving
    // it open is the most direct route to a second owner.
    return INITIALIZED.includes(state)
      ? { ready: false, code: "bootstrap_unavailable" }
      : { ready: true };
  }

  if (!INITIALIZED.includes(state)) {
    return { ready: false, code: "installation_not_ready" };
  }

  if (requirement === "initialized") {
    return { ready: true };
  }

  // `protected` from here: the operation touches encrypted data.
  if (!context.deploymentKeyAvailable) {
    return { ready: false, code: "installation_degraded" };
  }
  if (!protectedOperationsAvailable(state)) {
    return {
      ready: false,
      code: state === "degraded" ? "installation_degraded" : "installation_not_ready",
    };
  }
  return { ready: true };
}

/**
 * Whether an operation may proceed as a protected *write*.
 *
 * Split from `checkReadiness` because reads and writes diverge under rotation
 * policy: a write-blocked installation still serves reads of valid existing
 * ciphertext, and refusing those would turn a late rotation into data loss.
 */
export interface WriteGateInput {
  readonly context: SecurityRequestContext;
  /** From the rotation policy evaluation; false once `writeBlockAt` passes. */
  readonly writesAllowed: boolean;
  /** True while plaintext writes are stopped during a migration cutover. */
  readonly plaintextWritesStopped?: boolean;
}

export function checkProtectedWrite(input: WriteGateInput): ReadinessDecision {
  const readiness = checkReadiness(input.context, "protected");
  if (!readiness.ready) {
    return readiness;
  }
  if (!input.writesAllowed) {
    return { ready: false, code: "write_blocked" };
  }
  if (input.plaintextWritesStopped === true) {
    return { ready: false, code: "migration_in_progress" };
  }
  return { ready: true };
}

/**
 * Readiness requirement per route family, in one table.
 *
 * Kept together so a reviewer can see the whole security surface at once. The
 * composition root applies this table before private handlers run; a private
 * route added without an entry receives the protected requirement below.
 */
export const ROUTE_READINESS: Readonly<Record<string, ReadinessRequirement>> = {
  "/health": "none",
  "/v1/installation/status": "none",
  "/v1/bootstrap": "uninitialized",
  "/v1/bootstrap/:attemptId/credential": "uninitialized",
  "/v1/bootstrap/:attemptId/recovery/download": "uninitialized",
  "/v1/bootstrap/:attemptId/recovery/regenerate": "uninitialized",
  "/v1/bootstrap/:attemptId/recovery/confirm": "uninitialized",
  "/v1/auth/login/passkey": "initialized",
  "/v1/auth/login/password": "initialized",
  "/v1/auth/session": "initialized",
  "/v1/auth/sessions": "initialized",
  "/v1/auth/sessions/:sessionId": "initialized",
  "/v1/auth/sessions/revoke-all": "initialized",
  "/v1/auth/passkeys": "initialized",
  "/v1/auth/passkeys/enrollment/options": "initialized",
  "/v1/auth/passkeys/enrollment/complete": "initialized",
  "/v1/auth/passkeys/:credentialId": "initialized",
  "/v1/auth/password": "initialized",
  "/v1/devices": "initialized",
  "/v1/devices/:deviceId": "initialized",
  "/v1/backups/status": "initialized",
  "/v1/backups/full/status": "initialized",
  "/v1/backups/full/rehearsals": "protected",
  "/v1/backups/rehearsals": "protected",
  "/v1/security/recovery-kits": "initialized",
  "/v1/security/recovery-kits/:kitId/download": "protected",
  "/v1/security/recovery-kits/:kitId/confirm": "protected",
  "/v1/security/recovery-kits/revoke": "protected",
  "/v1/security/rotations": "initialized",
  "/v1/security/rotations/policies": "initialized",
  "/v1/security/rotations/:operationId": "initialized",
  "/v1/security/audit": "initialized",
  "/v1/mcp/audit": "initialized",
};

/**
 * Method-specific overrides for route declarations whose diagnostic GET and
 * mutating POST have different installation requirements. The path table
 * remains the default so routes without an override retain their documented
 * family requirement.
 */
export const ROUTE_READINESS_BY_METHOD: Readonly<Record<string, ReadinessRequirement>> = {
  "POST /v1/security/recovery-kits": "protected",
  "POST /v1/security/rotations": "protected",
};

/**
 * Resolves the requirement for a Fastify route declaration.
 *
 * Route declarations use parameter placeholders (`:kitId`) while a caller can
 * also reach this helper with a concrete path. Patterns match one complete
 * route shape only. An unlisted descendant therefore falls through to the
 * protected default instead of inheriting a diagnostic collection's weaker
 * requirement.
 */
export function readinessRequirementForRoute(
  route: string,
  method: string = "GET",
): ReadinessRequirement | undefined {
  const normalized = route.replace(/\/+$/u, "") || "/";
  const methodOverride = ROUTE_READINESS_BY_METHOD[`${method.toUpperCase()} ${normalized}`];
  if (methodOverride !== undefined) return methodOverride;
  const exact = ROUTE_READINESS[normalized];
  if (exact !== undefined) return exact;

  const family = Object.entries(ROUTE_READINESS)
    .filter(([pattern]) => routePatternMatches(normalized, pattern))
    .sort(([left], [right]) => right.length - left.length)[0];
  if (family !== undefined) return family[1];

  return normalized.startsWith("/v1/") ? "protected" : undefined;
}

/** Matches both Fastify declarations (`:id`) and concrete request paths. */
function routePatternMatches(path: string, pattern: string): boolean {
  const pathSegments = path.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);
  if (pathSegments.length !== patternSegments.length) return false;
  return patternSegments.every(
    (segment, index) => segment.startsWith(":") || segment === pathSegments[index],
  );
}

/** Applies the resolved route requirement, with an open result for public paths. */
export function checkRouteReadiness(
  context: SecurityRequestContext,
  route: string,
  method: string = "GET",
): ReadinessDecision {
  const requirement = readinessRequirementForRoute(route, method);
  return requirement === undefined ? { ready: true } : checkReadiness(context, requirement);
}
