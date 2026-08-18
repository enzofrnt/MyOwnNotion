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
import { acceptedWriteGuards, attributionFor } from "../plugins/mutations.ts";
import { requireWriteProtocol } from "../plugins/protocol.ts";
import { RotationWriteBlockedError } from "../security/rotation-policy-service.ts";
import { announceCommitted } from "../sync/change-notifier.ts";

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
      // The whole batch, not each row. Every queued mutation comes from the
      // same client at the same version, so a per-row check would ask the same
      // question fifty times and answer it fifty times identically — and a
      // partially accepted batch from a client that cannot write safely is the
      // outcome the gate exists to prevent.
      requireWriteProtocol(request);

      const body = request.body as BatchBody;
      const results: BatchResultDto[] = [];
      /**
       * The furthest position this batch reached (feature 006, FR-001).
       *
       * One announcement for the whole batch rather than one per mutation. A
       * device that comes back from a day offline can flush fifty queued writes,
       * and fifty notifications would ask every other device to fetch fifty
       * times to arrive at the state the last one already describes. The
       * position is cumulative, so the highest one says everything the others
       * would have.
       */
      let furthestSequence: number | undefined;

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
              // The device is attributed here too, and for the same reason the
              // guards are: this is the route the browser uses for everything it
              // queued, so an unattributed batch would leave most of an owner's
              // history unable to say where the change came from.
              attributionFor(request, queued.mutationId as Uuid),
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
        if (outcome.committedSequence !== undefined) {
          furthestSequence = Math.max(furthestSequence ?? 0, outcome.committedSequence);
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

      announceCommitted(furthestSequence);
      return { results };
    },
  );
}
