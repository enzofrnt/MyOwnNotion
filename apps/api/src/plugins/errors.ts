/**
 * Redacted problem responses (T017, FR-022).
 *
 * Every error leaves the API as an RFC 9457 problem document carrying only
 * the safe machine-readable code, a content-free title, and optional field
 * diagnostics. Private content, SQL, and stack traces never reach clients.
 */
import type { FastifyError, FastifyInstance, FastifyReply } from "fastify";
import type { SafeError, SafeErrorCode } from "@myownnotion/domain";

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
  "placement.not-found": 404,
  "placement.already-removed": 409,
  "placement.cardinality-violation": 409,
  "relationship.not-found": 404,
  "relationship.endpoint-unavailable": 409,
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

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // Fastify schema-validation failures become safe 400 problems.
    if (error.validation !== undefined) {
      const problem: ProblemBody = {
        type: "https://myownnotion.dev/problems/validation.invalid-payload",
        title: "Request does not match the API contract",
        status: 400,
        code: "validation.invalid-payload",
        invalidFields: error.validation.map((failure) => ({
          field: failure.instancePath || String(failure.params.missingProperty ?? "body"),
          code: failure.keyword,
        })),
      };
      return reply.status(400).header("content-type", "application/problem+json").send(problem);
    }

    const statusCode =
      error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      // Log the full error server-side; expose nothing private (FR-022).
      _request.log.error({ err: error }, "unhandled error");
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
