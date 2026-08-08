/**
 * Health route (T017): reports readiness and the canonical schema version.
 */

import { HealthResponseSchema } from "@myownnotion/contracts";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";

export function registerHealthRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    "/health",
    {
      schema: {
        response: { 200: HealthResponseSchema },
      },
    },
    async () => ({
      status: "ready" as const,
      schemaVersion: context.schemaVersion,
      storage: { adapter: context.storageAdapter, status: "ready" as const },
    }),
  );
}
