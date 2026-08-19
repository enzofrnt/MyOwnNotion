/**
 * Health route (T017): reports readiness and the canonical schema version.
 */

import { HealthResponseSchema } from "@myownnotion/contracts";
import { unfinishedRestoration } from "@myownnotion/database";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export function registerHealthRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: HealthResponseSchema,
          503: Type.Object(
            {
              status: Type.Literal("restoration-incomplete"),
              schemaVersion: Type.Integer({ minimum: 1 }),
              restorationAttemptId: Type.String({ format: "uuid" }),
              backupId: Type.String({ format: "uuid" }),
              recovery: Type.String(),
            },
            { additionalProperties: false },
          ),
        },
      },
    },
    async (_request, reply) => {
      const interrupted = await unfinishedRestoration(context.db);
      if (interrupted !== null) {
        return reply.status(503).send({
          status: "restoration-incomplete" as const,
          schemaVersion: context.schemaVersion,
          restorationAttemptId: interrupted.id,
          backupId: interrupted.backupId,
          recovery:
            "Do not serve this workspace as healthy. Re-run the same restore command to resume from its verified archive, or restore the safety backup created immediately before it.",
        });
      }
      return reply.status(200).send({
        status: "ready" as const,
        schemaVersion: context.schemaVersion,
      });
    },
  );
}
