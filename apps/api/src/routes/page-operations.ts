/** Public protocol-v3 page-operation routes (T144, US5). */

import {
  ActivatePageRequestSchema,
  PageAmbiguityDetailSchema,
  PageCheckpointResponseSchema,
  PageOperationProblemSchema,
  PageSyncRequestSchema,
  PageSyncResponseSchema,
  parseActivatePageRequest,
  parsePageSyncRequest,
  parseResolvePageAmbiguityRequest,
  ResolvePageAmbiguityRequestSchema,
  ResolvePageAmbiguityResponseSchema,
} from "@myownnotion/contracts";
import type { Database } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LegacyBranchService } from "../page-state/legacy-branch-service.ts";
import type { PageActivationService } from "../page-state/page-activation-service.ts";
import type { PageAmbiguityService } from "../page-state/page-ambiguity-service.ts";
import { PageOperationServiceError } from "../page-state/page-operation-errors.ts";
import type { PageOperationService } from "../page-state/page-operation-service.ts";
import { sendSecurityProblem } from "../plugins/errors.ts";
import { requirePageOperationProtocol } from "../plugins/protocol.ts";
import { requestContext } from "../security/request-context.ts";
import { authorizeSynchronization } from "../security/synchronization-authorization.ts";
import type { AuthenticationGate } from "./authentication.ts";

const PageParams = Type.Object({ pageId: Type.String({ format: "uuid" }) });
const AmbiguityParams = Type.Object({ ambiguityId: Type.String({ format: "uuid" }) });

export interface PageOperationRouteDeps {
  readonly db: Database;
  readonly activation: PageActivationService;
  readonly legacy: LegacyBranchService;
  readonly operations: PageOperationService;
  readonly ambiguities: PageAmbiguityService;
  readonly require: AuthenticationGate;
}

function sendPageOperationProblem(reply: FastifyReply, error: PageOperationServiceError) {
  return reply
    .status(error.status)
    .header("content-type", "application/problem+json")
    .send({ code: error.code, message: error.message });
}

async function authorizeOperationalRequest(
  deps: PageOperationRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  csrf: boolean,
) {
  const owner = deps.require(request, reply, csrf ? { csrf: true } : {});
  if (owner === null) return null;
  const decision = await authorizeSynchronization(deps.db, {
    ownerId: owner.ownerId,
    deviceId: owner.deviceId,
  });
  if (!decision.allowed) {
    sendSecurityProblem(reply, {
      code: "device_revoked",
      correlationId: requestContext(request).correlationId,
    });
    return null;
  }
  return owner;
}

function handleServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof PageOperationServiceError) return sendPageOperationProblem(reply, error);
  throw error;
}

export function registerPageOperationRoutes(
  app: FastifyInstance,
  deps: PageOperationRouteDeps,
): void {
  app.post(
    "/v1/page-operations/:pageId/activate",
    {
      schema: {
        params: PageParams,
        body: ActivatePageRequestSchema,
        response: {
          200: PageCheckpointResponseSchema,
          409: PageOperationProblemSchema,
        },
      },
    },
    async (request, reply) => {
      requirePageOperationProtocol(request);
      if ((await authorizeOperationalRequest(deps, request, reply, true)) === null) return reply;
      const { pageId } = request.params as { pageId: Uuid };
      const body = parseActivatePageRequest(request.body);
      try {
        const response = await deps.activation.activate({
          pageId,
          requestId: body.requestId as Uuid,
          expectedRevisionId: body.expectedRevisionId as Uuid,
          expectedCanonicalDigest: body.expectedCanonicalDigest,
        });
        return reply.status(200).send(response);
      } catch (error) {
        return handleServiceError(reply, error);
      }
    },
  );

  app.post(
    "/v1/page-operations/:pageId/sync",
    {
      schema: {
        params: PageParams,
        body: PageSyncRequestSchema,
        response: { 200: PageSyncResponseSchema, 409: PageOperationProblemSchema },
      },
    },
    async (request, reply) => {
      requirePageOperationProtocol(request);
      const owner = await authorizeOperationalRequest(deps, request, reply, true);
      if (owner === null) return reply;
      const { pageId } = request.params as { pageId: Uuid };
      const body = parsePageSyncRequest(request.body);
      try {
        if (body.mode === "active") {
          return reply.status(200).send(
            await deps.operations.sync({
              pageId,
              deviceId: owner.deviceId as Uuid,
              request: body,
            }),
          );
        }
        if (body.mode === "legacy-branch") {
          return reply.status(200).send(
            await deps.legacy.convert({
              pageId,
              deviceId: owner.deviceId as Uuid,
              request: body,
            }),
          );
        }
        if (body.mode !== "empty") {
          throw new PageOperationServiceError(
            "page-operations.schema-unsupported",
            "This operational synchronization mode is not available yet.",
            409,
          );
        }
        return reply.status(200).send(
          await deps.activation.checkpointResponse({
            pageId,
            requestId: body.requestId as Uuid,
            maxRemoteBytes: body.maxRemoteBytes,
          }),
        );
      } catch (error) {
        return handleServiceError(reply, error);
      }
    },
  );

  app.get(
    "/v1/page-ambiguities/:ambiguityId",
    { schema: { params: AmbiguityParams, response: { 200: PageAmbiguityDetailSchema } } },
    async (request, reply) => {
      requirePageOperationProtocol(request);
      reply.header("cache-control", "no-store");
      if ((await authorizeOperationalRequest(deps, request, reply, false)) === null) return reply;
      const { ambiguityId } = request.params as { ambiguityId: Uuid };
      try {
        return await deps.ambiguities.detail({ ambiguityId });
      } catch (error) {
        if (error instanceof PageOperationServiceError) {
          return sendPageOperationProblem(reply, error);
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/page-ambiguities/:ambiguityId/resolve",
    {
      schema: {
        params: AmbiguityParams,
        body: ResolvePageAmbiguityRequestSchema,
        response: { 200: ResolvePageAmbiguityResponseSchema },
      },
    },
    async (request, reply) => {
      requirePageOperationProtocol(request);
      const owner = await authorizeOperationalRequest(deps, request, reply, true);
      if (owner === null) return reply;
      const body = parseResolvePageAmbiguityRequest(request.body);
      const { ambiguityId } = request.params as { ambiguityId: Uuid };
      try {
        return await deps.ambiguities.resolve({
          ambiguityId,
          deviceId: owner.deviceId as Uuid,
          request: body as Parameters<PageAmbiguityService["resolve"]>[0]["request"],
        });
      } catch (error) {
        if (error instanceof PageOperationServiceError) {
          return sendPageOperationProblem(reply, error);
        }
        throw error;
      }
    },
  );
}
