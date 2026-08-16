/**
 * Idempotent mutation-batch submission (T043, US6).
 *
 * The offline outbox submits queued mutations with their stable IDs and
 * causal bases. Each mutation is processed independently in order:
 * duplicates replay their prior result, causal conflicts return competing
 * revision identities, and validation failures return safe problems.
 */

import { MutationBatchResponseSchema, MutationBatchSchema } from "@myownnotion/contracts";
import { submitMutation } from "@myownnotion/database";
import { parseMutationCommand, type Uuid } from "@myownnotion/domain";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { type ProblemBody, problemFromSafeError } from "../plugins/errors.ts";
import { acceptedWriteGuards } from "../plugins/mutations.ts";
import { RotationWriteBlockedError } from "../security/rotation-policy-service.ts";

interface BatchBody {
  mutations: Array<{
    mutationId: string;
    commandType: string;
    baseRevisionIds: string[];
    payload: Record<string, unknown>;
  }>;
}

interface BatchResultDto {
  mutationId: string;
  status: "accepted" | "already-accepted" | "rejected" | "conflict";
  revisionIds?: ReadonlyArray<string>;
  competingRevisionIds?: ReadonlyArray<string>;
  problem?: ProblemBody;
}

export function registerMutationBatchRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(
    "/v1/mutations/batch",
    {
      schema: {
        body: MutationBatchSchema,
        response: { 200: MutationBatchResponseSchema },
      },
    },
    async (request) => {
      const body = request.body as BatchBody;
      const results: BatchResultDto[] = [];

      for (const queued of body.mutations) {
        const parsed = parseMutationCommand(queued.commandType, {
          ...queued.payload,
          // Base revisions accompany the payload for causal validation of
          // commands that carry an explicit base (document/file updates).
        });
        if (!parsed.ok) {
          results.push({
            mutationId: queued.mutationId as Uuid,
            status: "rejected",
            problem: problemFromSafeError(parsed.error),
          });
          continue;
        }
        let outcome: Awaited<ReturnType<typeof submitMutation>>;
        try {
          outcome = await submitMutation(context.db, {
            workspaceId: context.workspaceId,
            mutationId: queued.mutationId as Uuid,
            commandType: queued.commandType,
            command: parsed.value,
            // The same guarantees the single-command routes give. They were
            // missing here, which mattered more than anywhere else: this is the
            // route the browser client uses for everything it queued offline,
            // so a rotation write block did not refuse the writes an owner
            // actually makes, and their content committed without being sealed.
            ...acceptedWriteGuards(
              parsed.value,
              context.protectedContent,
              context.rotationPolicies,
            ),
          });
        } catch (error) {
          if (!(error instanceof RotationWriteBlockedError)) {
            throw error;
          }
          // Reported per mutation rather than as a failed batch. The whole
          // request failing would tell the client nothing about *which* of its
          // queued writes were refused, and it would retry all of them — the
          // outbox needs a verdict for each row to mark it blocked and stop.
          results.push({
            mutationId: queued.mutationId as Uuid,
            status: "rejected",
            problem: {
              type: "https://myownnotion.dev/problems/write_blocked",
              title: error.message,
              status: 409,
              code: "write_blocked",
            },
          });
          continue;
        }
        const result = outcome.result;
        results.push({
          mutationId: result.mutationId,
          status: result.status,
          ...(result.revisionIds !== undefined ? { revisionIds: result.revisionIds } : {}),
          ...(result.competingRevisionIds !== undefined
            ? { competingRevisionIds: result.competingRevisionIds }
            : {}),
          ...(result.problem !== undefined
            ? { problem: problemFromSafeError(result.problem) }
            : {}),
        });
      }

      return { results };
    },
  );
}
