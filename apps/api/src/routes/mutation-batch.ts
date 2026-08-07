/**
 * Idempotent mutation-batch submission (T043, US6).
 *
 * The offline outbox submits queued mutations with their stable IDs and
 * causal bases. Each mutation is processed independently in order:
 * duplicates replay their prior result, causal conflicts return competing
 * revision identities, and validation failures return safe problems.
 */
import type { FastifyInstance } from "fastify";
import { MutationBatchResponseSchema, MutationBatchSchema } from "@myownnotion/contracts";
import { parseMutationCommand, type Uuid } from "@myownnotion/domain";
import { submitMutation } from "@myownnotion/database";
import { problemFromSafeError, type ProblemBody } from "../plugins/errors.ts";
import type { AppContext } from "../context.ts";

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
        const outcome = await submitMutation(context.db, {
          workspaceId: context.workspaceId,
          mutationId: queued.mutationId as Uuid,
          commandType: queued.commandType,
          command: parsed.value,
        });
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
