/**
 * Session-free bootstrap routes (T032, feature 002).
 *
 * These are the only routes that operate without a session, because there is
 * no owner yet to have one. Authority comes from `X-Bootstrap-Capability`.
 *
 * Three rules the handlers enforce that are easy to lose in a refactor:
 *
 *   - **The capability travels in a header, never in a path or a query.** A
 *     URL lands in server logs, browser history, and `Referer`, all of which
 *     outlive the attempt.
 *   - **Every pre-confirmation response states `ownerCount: 0` explicitly.**
 *     The client renders it, so a regression that created an owner early would
 *     be visible in the response rather than only in the database.
 *   - **The bootstrap surface closes the moment ownership commits.** Once an
 *     owner exists these routes refuse; leaving them open is the most direct
 *     route to a second owner.
 */

import {
  BOOTSTRAP_CAPABILITY_HEADER,
  BootstrapConfirmationResultSchema,
  BootstrapProgressSchema,
  BootstrapStartedSchema,
  BootstrapStartSchema,
  OfflineConfirmationSchema,
  SecurityProblemSchema,
} from "@myownnotion/contracts";
import { BootstrapCapabilityError, BootstrapTransitionError } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendSecurityProblem, toSecurityProblem } from "../plugins/errors.ts";
import type { BootstrapService } from "../security/bootstrap-service.ts";
import { checkReadiness } from "../security/private-route-guard.ts";
import { requestContext, updateRequestContext } from "../security/request-context.ts";
import { WebAuthnVerificationError } from "../security/webauthn-service.ts";

const AttemptParams = Type.Object({ attemptId: Type.String({ format: "uuid" }) });

/**
 * Reads the capability from its header.
 *
 * Absent is treated exactly like wrong: distinguishing them would tell a caller
 * whether a given attempt exists.
 */
function capabilityFrom(request: FastifyRequest): string {
  const value = request.headers[BOOTSTRAP_CAPABILITY_HEADER];
  const capability = Array.isArray(value) ? value[0] : value;
  if (typeof capability !== "string" || capability.length === 0) {
    throw new BootstrapCapabilityError("no bootstrap capability presented");
  }
  return capability;
}

/** Maps a bootstrap failure to its safe code. */
function bootstrapProblemCode(error: unknown): string {
  if (error instanceof BootstrapCapabilityError) {
    return "bootstrap_capability_invalid";
  }
  if (error instanceof WebAuthnVerificationError) {
    return "authentication_failed";
  }
  if (error instanceof BootstrapTransitionError) {
    return "conflict";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "internal_error";
}

export interface BootstrapRouteDeps {
  readonly service: BootstrapService;
  /** Kits are streamed once and never colocated with workspace data. */
  readonly renderKit: (kitId: string) => Promise<string>;
  /**
   * Signs the new owner in, once ownership has committed.
   *
   * Injected rather than reached for directly so this module keeps knowing
   * nothing about sessions: bootstrap is session-free right up to the moment
   * it stops being, and that moment is a single call.
   */
  readonly startSession: (input: {
    reply: FastifyReply;
    ownerId: string;
    deviceId: string;
    correlationId: string;
  }) => Promise<void>;
}

export function registerBootstrapRoutes(app: FastifyInstance, deps: BootstrapRouteDeps): void {
  /** Rejects the request unless the installation is still uninitialized. */
  const requireUninitialized = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const readiness = checkReadiness(requestContext(request), "uninitialized");
    if (!readiness.ready) {
      sendSecurityProblem(reply, {
        code: readiness.code,
        correlationId: requestContext(request).correlationId,
      });
      return false;
    }
    return true;
  };

  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown): FastifyReply => {
    const correlationId = requestContext(request).correlationId;
    request.log.warn(
      { correlationId, err: error instanceof Error ? error.name : "unknown" },
      "bootstrap request refused",
    );
    return sendSecurityProblem(
      reply,
      toSecurityProblem({ code: bootstrapProblemCode(error) }, correlationId),
    );
  };

  app.post(
    "/v1/bootstrap",
    {
      schema: {
        body: BootstrapStartSchema,
        response: { 201: BootstrapStartedSchema, 409: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const body = request.body as { clientNonce: string };
      try {
        const started = await deps.service.start({
          clientNonce: body.clientNonce,
          correlationId: requestContext(request).correlationId,
        });
        updateRequestContext(request, {
          principal: { kind: "bootstrap", attemptId: started.attemptId },
        });
        return reply.status(201).send({
          attemptId: started.attemptId,
          // Response body only. Never a URL, never a log line.
          capability: started.capability,
          expiresAt: started.expiresAt.toISOString(),
          challenge: started.challenge,
          bootstrapState: "started",
          installationState: "uninitialized",
          ownerCount: 0,
          workspaceCount: 0,
        });
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    "/v1/bootstrap/:attemptId/credential",
    {
      schema: {
        params: AttemptParams,
        response: { 200: BootstrapProgressSchema, 409: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const { attemptId } = request.params as { attemptId: string };
      const body = request.body as { credential: unknown };
      try {
        const { attempt, kitId } = await deps.service.verifyCredential({
          attemptId,
          capability: capabilityFrom(request),
          response: body.credential,
          correlationId: requestContext(request).correlationId,
        });
        return reply.status(200).send({
          attemptId,
          bootstrapState: "recovery-prepared",
          recoveryKitId: kitId,
          authorizationState: "provisional",
          deliveryState: "downloadable",
          downloadExpiresAt: (attempt.downloadExpiresAt ?? new Date()).toISOString(),
          installationState: "uninitialized",
          // Still no owner: the credential is held against the attempt.
          ownerCount: 0,
          workspaceCount: 0,
        });
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    "/v1/bootstrap/:attemptId/recovery/download",
    { schema: { params: AttemptParams } },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const { attemptId } = request.params as { attemptId: string };
      try {
        // No request body: the capability is the only thing the client holds.
        // One-time-ness is a server-side property, not something the caller
        // proves by presenting a second secret.
        const attempt = await deps.service.consumeKitDownload({
          attemptId,
          capability: capabilityFrom(request),
          correlationId: requestContext(request).correlationId,
        });
        const artifact = await deps.renderKit(attempt.recoveryKitId ?? "");
        // Streamed as an attachment: the kit is never rendered into a page
        // where a browser extension or a screenshot could capture it.
        return (
          reply
            .status(200)
            .header("content-type", "application/json")
            .header("content-disposition", 'attachment; filename="myownnotion-recovery.json"')
            .header("cache-control", "no-store")
            // The contract pins this header: the client learns the download is
            // spent from the same response that carries the kit, so a retry
            // after a partial save is a regeneration rather than a second GET.
            .header("x-recovery-download-consumed", "true")
            .send(artifact)
        );
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    "/v1/bootstrap/:attemptId/recovery/regenerate",
    {
      schema: {
        params: AttemptParams,
        response: { 200: BootstrapProgressSchema, 409: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const { attemptId } = request.params as { attemptId: string };
      try {
        const { attempt, kitId } = await deps.service.regenerateKit({
          attemptId,
          capability: capabilityFrom(request),
          correlationId: requestContext(request).correlationId,
        });
        return reply.status(200).send({
          attemptId,
          bootstrapState: "recovery-prepared",
          recoveryKitId: kitId,
          authorizationState: "provisional",
          deliveryState: "downloadable",
          downloadExpiresAt: (attempt.downloadExpiresAt ?? new Date()).toISOString(),
          installationState: "uninitialized",
          ownerCount: 0,
          workspaceCount: 0,
        });
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.post(
    "/v1/bootstrap/:attemptId/recovery/confirm",
    {
      schema: {
        params: AttemptParams,
        body: OfflineConfirmationSchema,
        response: { 200: BootstrapConfirmationResultSchema, 409: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const { attemptId } = request.params as { attemptId: string };
      try {
        const promoted = await deps.service.confirmAndPromote({
          attemptId,
          capability: capabilityFrom(request),
          deviceBindingId: `web-${attemptId}`,
          deviceName: "First device",
          devicePlatform: null,
          correlationId: requestContext(request).correlationId,
        });

        // Setup ends signed in. The owner proved possession of their passkey
        // seconds ago; sending them to a sign-in screen to prove it again is
        // friction with no security gain, and an owner who has just finished a
        // careful ceremony reads it as the ceremony having failed.
        //
        // Only the cookie is set here. The CSRF token is not added to the
        // response body because the contract pins that shape exactly — the
        // client reads it from `GET /v1/auth/session`, which it calls on load
        // anyway.
        await deps.startSession({
          reply,
          ownerId: promoted.ownerId,
          deviceId: promoted.deviceId,
          correlationId: requestContext(request).correlationId,
        });

        // The one response shape that can only exist after the atomic
        // promotion: every field is a constant the contract pins.
        return reply.status(200).send({
          attemptId,
          bootstrapState: "confirmed",
          installationState: "ready",
          ownerCount: 1,
          workspaceCount: 1,
          authorizationState: "active",
          deliveryState: "confirmed",
        });
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );
}
