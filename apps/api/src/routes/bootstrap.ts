/**
 * Session-free bootstrap routes (T032 / T133, feature 002).
 *
 * These are the only routes that operate without a session, because there is
 * no owner yet to have one. Authority comes from `X-Bootstrap-Capability`.
 *
 * Happy path: start → credential → password → confirm. Legacy recovery kit
 * routes remain registered but are unused by the first-run UI.
 */

import {
  BOOTSTRAP_CAPABILITY_HEADER,
  BootstrapConfirmationResultSchema,
  type BootstrapOfflineConfirmationDto,
  BootstrapOfflineConfirmationSchema,
  type BootstrapPasswordDto,
  BootstrapPasswordSchema,
  BootstrapProgressSchema,
  BootstrapStartedSchema,
  BootstrapStartSchema,
  SecurityProblemSchema,
} from "@myownnotion/contracts";
import { BootstrapCapabilityError, BootstrapTransitionError } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendSecurityProblem, toSecurityProblem } from "../plugins/errors.ts";
import type { BootstrapService } from "../security/bootstrap-service.ts";
import { WeakPasswordError } from "../security/password-service.ts";
import { checkReadiness } from "../security/private-route-guard.ts";
import { requestContext, updateRequestContext } from "../security/request-context.ts";
import { WebAuthnVerificationError } from "../security/webauthn-service.ts";

const AttemptParams = Type.Object({ attemptId: Type.String({ format: "uuid" }) });

function capabilityFrom(request: FastifyRequest): string {
  const value = request.headers[BOOTSTRAP_CAPABILITY_HEADER];
  const capability = Array.isArray(value) ? value[0] : value;
  if (typeof capability !== "string" || capability.length === 0) {
    throw new BootstrapCapabilityError("no bootstrap capability presented");
  }
  return capability;
}

function bootstrapProblemCode(error: unknown): string {
  if (error instanceof BootstrapCapabilityError) {
    return "bootstrap_capability_invalid";
  }
  if (error instanceof WebAuthnVerificationError) {
    return "authentication_failed";
  }
  if (error instanceof WeakPasswordError) {
    return "validation_failed";
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
  readonly startSession: (input: {
    reply: FastifyReply;
    ownerId: string;
    deviceId: string;
    correlationId: string;
  }) => Promise<void>;
}

export function registerBootstrapRoutes(app: FastifyInstance, deps: BootstrapRouteDeps): void {
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
        await deps.service.verifyCredential({
          attemptId,
          capability: capabilityFrom(request),
          response: body.credential,
          correlationId: requestContext(request).correlationId,
        });
        return reply.status(200).send({
          attemptId,
          bootstrapState: "credential-verified",
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
    "/v1/bootstrap/:attemptId/password",
    {
      schema: {
        params: AttemptParams,
        body: BootstrapPasswordSchema,
        response: { 200: BootstrapProgressSchema, 409: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const { attemptId } = request.params as { attemptId: string };
      const body = request.body as BootstrapPasswordDto;
      try {
        await deps.service.setPassword({
          attemptId,
          capability: capabilityFrom(request),
          password: body.password,
          correlationId: requestContext(request).correlationId,
        });
        return reply.status(200).send({
          attemptId,
          bootstrapState: "password-set",
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
    "/v1/bootstrap/:attemptId/recovery/download",
    { schema: { params: AttemptParams } },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const { attemptId } = request.params as { attemptId: string };
      try {
        const attempt = await deps.service.consumeKitDownload({
          attemptId,
          capability: capabilityFrom(request),
          correlationId: requestContext(request).correlationId,
        });
        const artifact = await deps.renderKit(attempt.recoveryKitId ?? "");
        return reply
          .status(200)
          .header("content-type", "application/json")
          .header("content-disposition", 'attachment; filename="myownnotion-recovery.json"')
          .header("cache-control", "no-store")
          .header("x-recovery-download-consumed", "true")
          .send(artifact);
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
        body: BootstrapOfflineConfirmationSchema,
        response: { 200: BootstrapConfirmationResultSchema, 409: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      if (!requireUninitialized(request, reply)) {
        return reply;
      }
      const { attemptId } = request.params as { attemptId: string };
      const { device } = request.body as BootstrapOfflineConfirmationDto;
      try {
        const promoted = await deps.service.confirmAndPromote({
          attemptId,
          capability: capabilityFrom(request),
          deviceBindingId: device.deviceBindingId,
          deviceName: device.name,
          devicePlatform: device.platform,
          correlationId: requestContext(request).correlationId,
        });

        await deps.startSession({
          reply,
          ownerId: promoted.ownerId,
          deviceId: promoted.deviceId,
          correlationId: requestContext(request).correlationId,
        });

        return reply.status(200).send({
          attemptId,
          bootstrapState: "confirmed",
          installationState: "ready",
          ownerCount: 1,
          workspaceCount: 1,
        });
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );
}
