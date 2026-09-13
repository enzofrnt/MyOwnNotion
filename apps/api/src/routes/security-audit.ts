/** Owner-visible redacted security audit trail. */

import { AuditEventSchema, SecurityProblemSchema } from "@myownnotion/contracts";
import { type Database, listAuditEvents } from "@myownnotion/database";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RequestPrincipal } from "../security/request-context.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

const AuditQuerySchema = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
  { additionalProperties: false },
);
const AuditResponseSchema = Type.Object(
  { events: Type.Array(AuditEventSchema) },
  { additionalProperties: false },
);

export interface SecurityAuditRouteDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly require: (
    request: FastifyRequest,
    reply: FastifyReply,
    requirement: { csrf?: boolean; recentAuthentication?: boolean },
  ) => OwnerPrincipal | null;
}

export function registerSecurityAuditRoutes(
  app: FastifyInstance,
  deps: SecurityAuditRouteDeps,
): void {
  app.get(
    "/v1/security/audit",
    {
      schema: {
        querystring: AuditQuerySchema,
        response: {
          200: AuditResponseSchema,
          400: SecurityProblemSchema,
          401: SecurityProblemSchema,
          500: SecurityProblemSchema,
          503: SecurityProblemSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (deps.require(request, reply, {}) === null) return reply;
      const query = request.query as { limit?: number };
      const events = await listAuditEvents(
        deps.db,
        { installationId: deps.installationId },
        { limit: query.limit ?? 100, excludeActorClasses: ["mcp"] },
      );
      return reply.status(200).send({
        events: events.map((event) => ({
          eventId: event.id,
          eventType: event.eventType,
          outcome: event.outcome,
          actorClass: event.actorClass,
          correlationId: event.correlationId,
          safeCode: event.safeCode,
          occurredAt: event.occurredAt.toISOString(),
        })),
      });
    },
  );
}
