/** Authenticated WebSocket adapter for the existing page-operation services. */

import type { PageSyncRequestDto, PageSyncResponseDto } from "@myownnotion/contracts";
import type { Database } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import type { FastifyInstance } from "fastify";
import type { LegacyBranchService } from "../page-state/legacy-branch-service.ts";
import type { PageActivationService } from "../page-state/page-activation-service.ts";
import { PageOperationServiceError } from "../page-state/page-operation-errors.ts";
import type { PageOperationService } from "../page-state/page-operation-service.ts";
import type { PageSyncHub } from "../realtime/page-sync-hub.ts";
import type { RealtimePageSyncObserver } from "../realtime/page-sync-observability.ts";
import { PageSyncSession } from "../realtime/page-sync-session.ts";
import {
  authorizeRealtimeHello,
  hasExactRealtimeOrigin,
  reauthorizeRealtimeDevice,
} from "../security/realtime-authorization.ts";
import { requestContext } from "../security/request-context.ts";
import type { SecurityConfig } from "../security/security-config.ts";
import type { AuthenticationGate } from "./authentication.ts";

export interface PageSyncSocketRouteDeps {
  readonly db: Database;
  readonly config: SecurityConfig;
  readonly deploymentKey: () => Buffer | null;
  readonly require: AuthenticationGate;
  readonly activation: PageActivationService;
  readonly operations: PageOperationService;
  readonly legacy: LegacyBranchService;
  readonly hub: PageSyncHub;
  readonly observability: RealtimePageSyncObserver;
}

async function synchronize(
  deps: PageSyncSocketRouteDeps,
  input: {
    readonly pageId: Uuid;
    readonly ownerId: string;
    readonly deviceId: Uuid;
    readonly request: PageSyncRequestDto;
  },
): Promise<PageSyncResponseDto> {
  const request = input.request;
  if (request.mode === "active") {
    return await deps.operations.sync({
      pageId: input.pageId,
      ownerId: input.ownerId,
      deviceId: input.deviceId,
      request,
    });
  }
  if (request.mode === "legacy-branch") {
    return await deps.legacy.convert({
      pageId: input.pageId,
      ownerId: input.ownerId,
      deviceId: input.deviceId,
      request,
    });
  }
  if (request.mode === "empty") {
    return await deps.activation.checkpointResponse({
      pageId: input.pageId,
      requestId: request.requestId as Uuid,
      maxRemoteBytes: request.maxRemoteBytes,
    });
  }
  throw new PageOperationServiceError(
    "page-operations.schema-unsupported",
    "This operational synchronization mode is not available yet.",
    409,
  );
}

export function registerPageSyncSocketRoutes(
  app: FastifyInstance,
  deps: PageSyncSocketRouteDeps,
): void {
  app.get(
    "/v1/page-sync/socket",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (!hasExactRealtimeOrigin(request, deps.config.publicOrigin)) {
          return reply.status(403).send({
            code: "origin_refused",
            message: "The realtime connection origin was refused.",
          });
        }
        deps.require(request, reply, {});
      },
    },
    (socket, request) => {
      const principal = requestContext(request).principal;
      if (principal.kind !== "owner") {
        socket.close(4401, "authentication-required");
        return;
      }
      new PageSyncSession({
        socket,
        principal,
        hub: deps.hub,
        authorizeHello: async (csrfToken) =>
          await authorizeRealtimeHello({
            db: deps.db,
            principal,
            csrfToken,
            deploymentKey: deps.deploymentKey,
          }),
        reauthorizeDevice: async () =>
          await reauthorizeRealtimeDevice({ db: deps.db, owner: principal }),
        synchronize: async (input) => await synchronize(deps, input),
        observability: deps.observability,
      });
    },
  );
}
