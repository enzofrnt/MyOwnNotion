import { type McpGrant, McpGrantSchema } from "@myownnotion/contracts";
import { type Database, listAuditEvents } from "@myownnotion/database";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { McpAccessError, type McpAccessService } from "../mcp/access-service.ts";
import { consumeRateLimit } from "../security/rate-limit-service.ts";
import { requestContext } from "../security/request-context.ts";
import type { AuthenticationGate } from "./authentication.ts";

export function registerMcpManagementRoutes(
  app: FastifyInstance,
  deps: {
    access: McpAccessService;
    require: AuthenticationGate;
    publicOrigin: string;
    db: Database;
    installationId: string;
    now: () => Date;
    /** Binds the request to the workspace of an exchange code; false when unknown. */
    bindExchangeWorkspace: (code: string) => Promise<boolean>;
  },
) {
  const { access } = deps;
  app.get("/v1/mcp/connections", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const owner = deps.require(request, reply, {});
    if (owner === null) return reply;
    return { connections: await access.inventory(owner.ownerId) };
  });
  app.post("/v1/mcp/connections", { schema: { body: McpGrantSchema } }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
    if (owner === null) return reply;
    try {
      return await access.grant(owner.ownerId, owner.deviceId, request.body as McpGrant, {
        installationId: access.deps.installationId,
        workspaceId: access.deps.workspaceId,
        correlationId: requestContext(request).correlationId,
        actorClass: "owner",
      });
    } catch (error) {
      if (error instanceof McpAccessError)
        return reply.status(error.status).send({ code: error.code });
      throw error;
    }
  });
  app.post(
    "/v1/mcp/connections/:id/revoke",
    { schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) } },
    async (request, reply) => {
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) return reply;
      await access.revoke(owner.ownerId, (request.params as { id: string }).id, {
        installationId: access.deps.installationId,
        workspaceId: access.deps.workspaceId,
        correlationId: requestContext(request).correlationId,
        actorClass: "owner",
      });
      return reply.status(204).send();
    },
  );
  app.get("/v1/mcp/audit", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const owner = deps.require(request, reply, {});
    if (owner === null) return reply;
    const events = (
      await Promise.all(
        (
          [
            "mcp.granted",
            "mcp.exchanged",
            "mcp.revoked",
            "mcp.operation",
            "mcp.exchange-failed",
            "mcp.authentication-failed",
          ] as const
        ).map((eventType) =>
          listAuditEvents(
            deps.db,
            { installationId: deps.installationId },
            {
              eventType,
              limit: 100,
              // This account's connections only (feature 058). Credentials that
              // name no connection belong to no account: the administrator sees
              // them, a member never does.
              account: {
                ownerId: owner.ownerId,
                workspaceId: owner.workspaceId,
                includeUnscoped: owner.role === "administrator",
              },
            },
          ),
        ),
      )
    ).flat();
    return {
      events: events
        .sort(
          (left, right) =>
            right.occurredAt.getTime() - left.occurredAt.getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(0, 100)
        .map((event) => ({
          id: event.id,
          action:
            event.objectKind === "mcp-connection" || event.objectKind === null
              ? event.eventType
              : event.objectKind,
          connectionId: event.objectId ?? "unknown",
          outcome: event.outcome,
          occurredAt: event.occurredAt.toISOString(),
        })),
    };
  });
  // Explicit public entry point: the high-entropy single-use code is its only credential.
  app.post(
    "/mcp/exchange",
    {
      bodyLimit: 4096,
      schema: {
        body: Type.Object(
          { code: Type.String({ minLength: 1, maxLength: 128 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (request.headers.origin !== undefined && request.headers.origin !== deps.publicOrigin)
        return reply.status(403).send({ code: "mcp.origin-refused" });
      const limit = await consumeRateLimit(deps.db, {
        installationId: deps.installationId,
        operation: "mcp.exchange",
        subject: request.ip,
        now: deps.now(),
      });
      if (!limit.allowed) return reply.status(429).send({ code: "mcp.rate-limited" });
      try {
        // The code names its connection, the connection names its account.
        if (!(await deps.bindExchangeWorkspace((request.body as { code: string }).code)))
          throw new McpAccessError("mcp.invalid-exchange", 401);
        return await access.exchange(
          (request.body as { code: string }).code,
          requestContext(request).correlationId,
        );
      } catch (error) {
        if (error instanceof McpAccessError)
          return reply.status(error.status).send({ code: error.code });
        throw error;
      }
    },
  );
}
