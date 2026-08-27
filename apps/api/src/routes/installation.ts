/**
 * Installation status (T032, feature 002).
 *
 * The one route that answers at every stage of an installation's life,
 * including before the installation row exists and while the deployment key is
 * unavailable. That is deliberate: it is the owner's only diagnostic surface,
 * and an installation that hides its own state during a fault cannot be
 * recovered by the person who owns it.
 *
 * It is also the endpoint that makes SC-001 observable from outside. The counts
 * it returns are read from the `owners` and `workspaces` tables, never inferred
 * from `installations.owner_id`, so a half-committed promotion shows up here
 * rather than being smoothed over.
 */

import { InstallationStatusSchema } from "@myownnotion/contracts";
import {
  type Database,
  findInstallation,
  readCounts,
  readInstallationStatus,
} from "@myownnotion/database";
import type { FastifyInstance } from "fastify";
import { checkDeploymentKey } from "../security/deployment-key.ts";
import { isWebSocketUpgradeRequest } from "../security/realtime-authorization.ts";
import { requestContext, updateRequestContext } from "../security/request-context.ts";
import type { SecurityConfig } from "../security/security-config.ts";

export interface InstallationRouteDeps {
  readonly db: Database;
  readonly config: SecurityConfig;
}

export function registerInstallationRoutes(
  app: FastifyInstance,
  deps: InstallationRouteDeps,
): void {
  /**
   * Resolves the installation state and key availability into the request
   * context, before any route runs. Every guard downstream reads it from
   * there, so two handlers can never disagree about what state they are in.
   */
  app.addHook("onRequest", (request, _reply, done) => {
    if (isWebSocketUpgradeRequest(request)) {
      done();
      return;
    }
    void findInstallation(deps.db).then((record) => {
      const key = checkDeploymentKey(deps.config.deploymentKeyFile);
      updateRequestContext(request, {
        installationState: record?.state ?? null,
        installationId: record?.id ?? null,
        workspaceId: record?.workspaceId ?? null,
        deploymentKeyAvailable: key.available,
      });
      if (!key.available) {
        // The path is operator information and belongs only in the server log.
        request.log.warn(
          { correlationId: requestContext(request).correlationId, problem: key.problem },
          "deployment wrapping key is unavailable; protected operations will fail closed",
        );
      }
      done();
    }, done);
  });

  app.get(
    "/v1/installation/status",
    { schema: { response: { 200: InstallationStatusSchema } } },
    async (request, reply) => {
      const context = requestContext(request);
      const status = await readInstallationStatus(deps.db);

      if (status === null) {
        // No installation row yet: the first-run page needs a definite answer,
        // not a 404 it would have to interpret.
        const counts = await readCounts(deps.db);
        return reply.status(200).send({
          state: "uninitialized",
          recoveryReady: false,
          securityReady: false,
          ownerCount: counts.ownerCount,
          workspaceCount: counts.workspaceCount,
        });
      }

      const initialized = status.counts.ownerCount === 1;
      return reply.status(200).send({
        state: status.state,
        // Readiness is not "an owner exists": it also requires the recovery
        // kit to be confirmed and the deployment key to be usable.
        recoveryReady: status.state === "ready",
        securityReady: status.state === "ready" && context.deploymentKeyAvailable,
        ownerCount: initialized ? 1 : 0,
        workspaceCount: initialized ? 1 : 0,
      });
    },
  );
}
