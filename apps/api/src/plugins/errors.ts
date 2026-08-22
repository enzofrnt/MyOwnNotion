/**
 * Redacted problem responses (T017, FR-022).
 *
 * Every error leaves the API as an RFC 9457 problem document carrying only
 * the safe machine-readable code, a content-free title, and optional field
 * diagnostics. Private content, SQL, and stack traces never reach clients.
 */

import {
  type SafeError,
  type SafeErrorCode,
  type SafeProblem,
  type SafeProblemCode,
  toSafeProblem,
} from "@myownnotion/domain";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProtectedContentUnavailableError } from "../security/content-resolution.ts";
import { requestContext } from "../security/request-context.ts";
import { RotationWriteBlockedError } from "../security/rotation-policy-service.ts";
import { ProtocolTooOldError, REQUIRED_PROTOCOL_HEADER } from "./protocol.ts";

export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly invalidFields?: ReadonlyArray<{ readonly field: string; readonly code: string }>;
  readonly competingRevisionIds?: ReadonlyArray<string>;
}

const STATUS_BY_CODE: Partial<Record<SafeErrorCode, number>> = {
  "validation.invalid-identifier": 400,
  "validation.invalid-name": 400,
  "validation.invalid-kind": 400,
  "validation.invalid-payload": 400,
  "validation.unknown-format-version": 400,
  "containment.parent-not-found": 409,
  "containment.parent-not-container": 409,
  "containment.file-cannot-contain": 409,
  "containment.attachment-parent-must-be-page": 409,
  "containment.cycle-rejected": 409,
  "item.not-found": 404,
  "item.not-active": 409,
  "item.not-trashed": 409,
  "item.wrong-kind": 409,
  // 409 rather than 400: the request is well formed and the owner simply has
  // not agreed to the loss yet. The client is expected to ask them and resend
  // the same command with the confirmation, which is a conflict of state, not
  // a malformed payload.
  "conversion.confirmation-required": 409,
  "conversion.file-not-convertible": 409,
  "placement.not-found": 404,
  "placement.already-removed": 409,
  "placement.cardinality-violation": 409,
  "relationship.not-found": 404,
  "relationship.endpoint-unavailable": 409,
  "database.not-found": 404,
  "database.entry-not-found": 404,
  "database.membership-conflict": 409,
  "database.page-required": 409,
  "database.definition-conflict": 409,
  "database.impact-confirmation-required": 409,
  "database.impact-stale": 409,
  "database.cursor-stale": 409,
  "database.projection-unavailable": 503,
  "database.invalid-view": 400,
  "database.invalid-cursor": 400,
  "database.projection-building": 503,
  "database.projection-degraded": 503,
  "database.projection-rebuild-failed": 503,
  "database.projection-update-failed": 503,
  "revision.not-found": 404,
  "revision.snapshot-expired": 410,
  "revision.stale-base": 409,
  "mutation.duplicate": 409,
  "mutation.conflict": 409,
  "mutation.rejected": 409,
  "cursor.compacted": 409,
  "resource.limit-exceeded": 422,
  "internal.unexpected": 500,
};

export function problemFromSafeError(error: SafeError): ProblemBody {
  const status = STATUS_BY_CODE[error.code] ?? 400;
  return {
    type: `https://myownnotion.dev/problems/${error.code}`,
    title: error.title,
    status,
    code: error.code,
    ...(error.invalidFields !== undefined ? { invalidFields: error.invalidFields } : {}),
    ...(error.competingRevisionIds !== undefined
      ? { competingRevisionIds: error.competingRevisionIds }
      : {}),
  };
}

export function sendProblem(reply: FastifyReply, error: SafeError): FastifyReply {
  const problem = problemFromSafeError(error);
  return reply
    .status(problem.status)
    .header("content-type", "application/problem+json")
    .send(problem);
}

/**
 * The request's correlation id, or a placeholder.
 *
 * The context is attached by the first `onRequest` hook, so it is present for
 * every request that reaches a handler. A validation failure during that hook
 * itself would not have one, and inventing an id there is better than throwing
 * from the error handler.
 */
function safeCorrelationId(request: FastifyRequest): string {
  try {
    return requestContext(request).correlationId;
  } catch {
    return "00000000-0000-0000-0000-000000000000";
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // Fastify schema-validation failures become safe 400 problems.
    if (error.validation !== undefined) {
      const problem: ProblemBody & { correlationId?: string } = {
        type: "https://myownnotion.dev/problems/validation.invalid-payload",
        title: "Request does not match the API contract",
        status: 400,
        code: "validation.invalid-payload",
        invalidFields: error.validation.map((failure) => ({
          field: failure.instancePath || String(failure.params["missingProperty"] ?? "body"),
          code: failure.keyword,
        })),
        // Carried on every validation failure, not only the security ones.
        // Security routes declare `SecurityProblem` for their 400, which
        // requires it — without it Fastify cannot serialize the error and the
        // caller receives a 500 that hides an ordinary bad request. It is also
        // the only bridge from a redacted client problem to the server log,
        // which is exactly what someone debugging a rejected payload wants.
        correlationId: safeCorrelationId(_request),
      };
      return reply.status(400).header("content-type", "application/problem+json").send(problem);
    }

    // A protected record that could not be read is reported as itself rather
    // than as an unexpected failure. The distinction matters to the person
    // reading it: "unexpected" invites a bug report, and this is a key or an
    // envelope problem with an operator-side cause. The code is deliberately
    // coarse — naming the failed check would be a decryption oracle.
    if (error instanceof ProtectedContentUnavailableError) {
      _request.log.error({ err: error }, "protected read failed");
      const problem: ProblemBody = {
        type: "https://myownnotion.dev/problems/protected_read_failed",
        title: "Protected record could not be read",
        status: 500,
        code: "protected_read_failed",
      };
      return reply.status(500).header("content-type", "application/problem+json").send(problem);
    }

    // A refused write is a decision, not a fault. Without this it fell through
    // to the 500 below and reached the client as "unexpected server error" —
    // so the block was enforced and never explained, which is the one outcome
    // FR-010 rules out: an owner cannot act on a refusal they cannot read.
    if (error instanceof RotationWriteBlockedError) {
      const problem: ProblemBody = {
        type: "https://myownnotion.dev/problems/write_blocked",
        title: error.message,
        status: 409,
        code: "write_blocked",
      };
      return reply.status(409).header("content-type", "application/problem+json").send(problem);
    }

    // A client too old to write safely (FR-018, FR-019). 426 rather than 409:
    // the situation is not a conflict between two writes, it is "this device
    // must be upgraded before it may write", and the title carries the version
    // needed because "please update" without a number leaves someone comparing
    // two things they cannot see.
    if (error instanceof ProtocolTooOldError) {
      const problem: ProblemBody = {
        type: "https://myownnotion.dev/problems/protocol.too_old",
        title: error.reason,
        status: 426,
        code: "protocol.too_old",
      };
      return reply
        .status(426)
        .header("content-type", "application/problem+json")
        .header(REQUIRED_PROTOCOL_HEADER, String(error.requiredVersion))
        .send(problem);
    }

    const statusCode =
      error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      // Log the full error server-side; expose nothing private (FR-022).
      _request.log.error(
        { err: error, ...safeUnexpectedErrorDiagnostics(error) },
        "unhandled error",
      );
      const problem: ProblemBody = {
        type: "https://myownnotion.dev/problems/internal.unexpected",
        title: "Unexpected server error",
        status: 500,
        code: "internal.unexpected",
      };
      return reply.status(500).header("content-type", "application/problem+json").send(problem);
    }

    const problem: ProblemBody = {
      type: "https://myownnotion.dev/problems/http",
      title: error.message,
      status: statusCode,
      code: `http.${statusCode}`,
    };
    return reply
      .status(statusCode)
      .header("content-type", "application/problem+json")
      .send(problem);
  });

  app.setNotFoundHandler((_request, reply) => {
    const problem: ProblemBody = {
      type: "https://myownnotion.dev/problems/http",
      title: "Route not found",
      status: 404,
      code: "http.404",
    };
    return reply.status(404).header("content-type", "application/problem+json").send(problem);
  });
}

/**
 * Retains only stable technical classifications from an unexpected error.
 *
 * Error messages and stacks may contain owner content, SQL values or paths and
 * remain redacted. Constructor names and machine codes (for example a
 * PostgreSQL SQLSTATE nested under Drizzle's `cause`) are finite identifiers:
 * they make an operational 500 diagnosable without weakening that boundary.
 */
function safeUnexpectedErrorDiagnostics(error: unknown): {
  readonly unexpectedErrorTypes: readonly string[];
  readonly unexpectedErrorCodes: readonly string[];
} {
  const types = new Set<string>();
  const codes = new Set<string>();
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const record = current as Record<string, unknown>;
    const constructorName = Object.getPrototypeOf(current)?.constructor?.name;
    for (const candidate of [record["name"], constructorName]) {
      if (typeof candidate === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(candidate)) {
        types.add(candidate);
      }
    }
    const code = record["code"];
    if (typeof code === "string" && /^[A-Z0-9_]{2,32}$/u.test(code)) codes.add(code);
    current = record["cause"];
  }
  return { unexpectedErrorTypes: [...types], unexpectedErrorCodes: [...codes] };
}

// ---------------------------------------------------------------------------
// Security problems (T017, feature 002)
// ---------------------------------------------------------------------------

/**
 * Titles for the security problem codes.
 *
 * Deliberately coarse and content-free. `authentication_failed` covers an
 * unknown credential, a wrong password, and a failed passkey assertion alike:
 * distinguishing them would turn the endpoint into an oracle that tells an
 * attacker which half of a guess was right.
 */
const SECURITY_PROBLEM_TITLES: Record<SafeProblemCode, { title: string; status: number }> = {
  authentication_failed: { title: "Authentication failed", status: 401 },
  authentication_required: { title: "Authentication required", status: 401 },
  // 401, and deliberately not 403: the credential itself is what stopped being
  // acceptable. A device told 403 would keep its session and keep retrying;
  // told 401 it drops it, which is what an owner meant by revoking it.
  device_revoked: { title: "This device's access was withdrawn", status: 401 },
  // 428, not 401: the session is valid and the caller is who they say they
  // are. What is missing is a precondition — a fresh proof of possession — and
  // a client that received 401 would reasonably discard the session and send
  // the owner back to a full sign-in instead of prompting for one step. This
  // is also what the normative contract declares.
  recent_authentication_required: { title: "Recent authentication required", status: 428 },
  csrf_validation_failed: { title: "Request could not be validated", status: 403 },
  rate_limited: { title: "Too many attempts", status: 429 },
  forbidden: { title: "Not permitted", status: 403 },
  not_found: { title: "Not found", status: 404 },
  conflict: { title: "Conflicting concurrent operation", status: 409 },
  validation_failed: { title: "Request does not match the API contract", status: 400 },
  installation_not_ready: { title: "Installation is not ready", status: 409 },
  installation_degraded: { title: "Installation is degraded", status: 503 },
  bootstrap_unavailable: { title: "Bootstrap is not available", status: 409 },
  bootstrap_capability_invalid: { title: "Bootstrap capability is not valid", status: 403 },
  recovery_unavailable: { title: "Recovery material is not available", status: 409 },
  recovery_material_invalid: { title: "Recovery material is not valid", status: 403 },
  rotation_in_progress: { title: "A key rotation is already running", status: 409 },
  write_blocked: { title: "Protected writes are blocked", status: 409 },
  migration_in_progress: { title: "An encryption migration is running", status: 409 },
  protected_read_failed: { title: "Protected record could not be read", status: 500 },
  protected_write_failed: { title: "Protected record could not be written", status: 500 },
  internal_error: { title: "Unexpected server error", status: 500 },
};

export interface SecurityProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: SafeProblemCode;
  /** Lets an operator join this response to the unredacted server log. */
  readonly correlationId: string;
  /** Present only when the caller marked a detail safe to disclose. */
  readonly detail?: string;
}

/**
 * Builds the outward-facing security problem.
 *
 * Note what is *absent*: no message from the underlying error, no field path,
 * no identifier that was not already known to the caller. An unrecognised code
 * collapses to `internal_error`, so a future code added without a title cannot
 * escape as a raw string.
 */
export function securityProblem(problem: SafeProblem): SecurityProblemBody {
  const mapped = SECURITY_PROBLEM_TITLES[problem.code] ?? {
    title: SECURITY_PROBLEM_TITLES.internal_error.title,
    status: 500,
  };
  return {
    type: `https://myownnotion.dev/problems/${problem.code}`,
    title: mapped.title,
    status: mapped.status,
    code: problem.code,
    correlationId: problem.correlationId,
    ...(problem.detail === undefined ? {} : { detail: problem.detail }),
  };
}

export function sendSecurityProblem(reply: FastifyReply, problem: SafeProblem): FastifyReply {
  const body = securityProblem(problem);
  return reply.status(body.status).header("content-type", "application/problem+json").send(body);
}

/**
 * Maps any thrown value to a safe problem.
 *
 * The default is `internal_error` with no detail. A repository error carries
 * the code the repository already decided on; anything else is treated as
 * unknown, because guessing a more specific code from an unrecognised error is
 * how internal detail escapes.
 */
export function toSecurityProblem(error: unknown, correlationId: string): SafeProblem {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return toSafeProblem((error as { code: string }).code, correlationId);
  }
  return toSafeProblem("internal_error", correlationId);
}
