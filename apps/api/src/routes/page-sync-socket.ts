/** Authenticated WebSocket adapter for the existing page-operation services. */

import type { PageSyncRequestDto, PageSyncResponseDto } from "@myownnotion/contracts";
import type { Database } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LegacyBranchService } from "../page-state/legacy-branch-service.ts";
import type { PageActivationService } from "../page-state/page-activation-service.ts";
import { PageOperationServiceError } from "../page-state/page-operation-errors.ts";
import type { PageOperationService } from "../page-state/page-operation-service.ts";
import type { PageSyncHub } from "../realtime/page-sync-hub.ts";
import type { RealtimePageSyncObserver } from "../realtime/page-sync-observability.ts";
import { PageSyncSession, type PageSyncSessionDeps } from "../realtime/page-sync-session.ts";
import { PendingAuthenticationFrames } from "../realtime/pending-authentication-frames.ts";
import { readSessionSecret } from "../security/cookie-policy.ts";
import {
  authorizeRealtimeHello,
  hasExactRealtimeOrigin,
  reauthorizeRealtimeDevice,
} from "../security/realtime-authorization.ts";
import type { RequestPrincipal } from "../security/request-context.ts";
import { trustedRealtimeOrigins, type SecurityConfig } from "../security/security-config.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;
type PageSyncSessionFactory = (deps: PageSyncSessionDeps) => void;

const createPageSyncSession: PageSyncSessionFactory = (deps) => {
  new PageSyncSession(deps);
};

export interface PageSyncSocketRouteDeps {
  readonly db: Database;
  readonly config: SecurityConfig;
  readonly deploymentKey: () => Buffer | null;
  readonly authenticate: (request: FastifyRequest) => Promise<OwnerPrincipal | null>;
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
  createSession: PageSyncSessionFactory = createPageSyncSession,
): void {
  app.get(
    "/v1/page-sync/socket",
    {
      websocket: true,
      preValidation: (request, reply, done) => {
        if (!hasExactRealtimeOrigin(request, trustedRealtimeOrigins(deps.config))) {
          reply.status(403).send({
            code: "origin_refused",
            message: "The realtime connection origin was refused.",
          });
          return;
        }
        if (readSessionSecret(request, deps.config) === null) {
          reply.status(401).send({
            code: "authentication_required",
            message: "Authentication is required.",
          });
          return;
        }
        done();
      },
    },
    async (socket, request) => {
      // Bun's optimized server upgrades before the durable session lookup.
      // Capture an eager browser's hello synchronously, with hard bounds, then
      // replay it once PageSyncSession has attached its normal listeners.
      const pendingFrames = new PendingAuthenticationFrames();
      let overflowed = false;
      const queueFrame = (
        frame: Parameters<typeof pendingFrames.enqueue>[0],
        isBinary: boolean,
      ) => {
        if (pendingFrames.enqueue(frame, isBinary)) return;
        overflowed = true;
        socket.off("message", queueFrame);
        socket.close(1009, "authentication-buffer-full");
      };
      socket.on("message", queueFrame);

      let principal: OwnerPrincipal | null;
      try {
        principal = await deps.authenticate(request);
      } catch (error) {
        request.log.error({ err: error }, "realtime owner authentication failed");
        if (socket.readyState === 1) socket.close(1011, "authentication-failed");
        return;
      } finally {
        socket.off("message", queueFrame);
      }
      if (overflowed || socket.readyState !== 1) return;
      if (principal === null) {
        socket.close(4401, "authentication-required");
        return;
      }
      createSession({
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
      for (const pending of pendingFrames.drain()) {
        socket.emit("message", pending.frame, pending.isBinary);
      }
    },
  );
}
