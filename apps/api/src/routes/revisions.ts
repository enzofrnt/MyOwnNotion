/**
 * Revision routes (T084, US5): fetch, compare, restore.
 */

import {
  CompareRevisionsSchema,
  LineageClassificationSchema,
  MutationResultSchema,
  RestoreRevisionSchema,
  RevisionSchema,
} from "@myownnotion/contracts";
import { getRevision, loadParentEdges } from "@myownnotion/database";
import { classifyLineage, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";
import { handleMutation } from "../plugins/mutations.ts";

export function registerRevisionRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    "/v1/revisions/:revisionId",
    {
      schema: {
        params: Type.Object({ revisionId: Type.String({ format: "uuid" }) }),
        response: { 200: RevisionSchema },
      },
    },
    async (request, reply) => {
      const { revisionId } = request.params as { revisionId: string };
      const revision = await context.db.transaction(async (tx) =>
        getRevision(tx, revisionId as Uuid),
      );
      if (revision === null) {
        return sendProblem(reply, { code: "revision.not-found", title: "Revision does not exist" });
      }
      const expired =
        revision.snapshot === null ||
        (revision.snapshotExpiresAt !== null &&
          Date.parse(revision.snapshotExpiresAt) <= Date.now());
      if (revision.snapshot === null) {
        // Header exists but content is no longer retained.
        return sendProblem(reply, {
          code: "revision.snapshot-expired",
          title: "Revision content is no longer retained",
        });
      }
      return {
        id: revision.id,
        itemId: revision.itemId,
        mutationId: revision.mutationId,
        parentRevisionIds: revision.parentRevisionIds,
        acceptedAt: revision.acceptedAt,
        snapshotRetained: !expired,
        snapshot: revision.snapshot,
        snapshotExpiresAt: revision.snapshotExpiresAt,
      };
    },
  );

  app.post(
    "/v1/revisions/compare",
    {
      schema: {
        body: CompareRevisionsSchema,
        response: {
          200: Type.Object({ classification: LineageClassificationSchema }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { leftRevisionId: string; rightRevisionId: string };
      const left = body.leftRevisionId as Uuid;
      const right = body.rightRevisionId as Uuid;
      const classification = await context.db.transaction(async (tx) => {
        const [leftRevision, rightRevision] = await Promise.all([
          getRevision(tx, left),
          getRevision(tx, right),
        ]);
        if (leftRevision === null || rightRevision === null) {
          return null;
        }
        const edges = await loadParentEdges(tx, [left, right]);
        return classifyLineage(left, right, (id) => edges.get(id) ?? []);
      });
      if (classification === null) {
        return sendProblem(reply, { code: "revision.not-found", title: "Revision does not exist" });
      }
      return { classification };
    },
  );

  app.post(
    "/v1/revisions/:revisionId/restore",
    {
      schema: {
        params: Type.Object({ revisionId: Type.String({ format: "uuid" }) }),
        body: RestoreRevisionSchema,
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const { revisionId } = request.params as { revisionId: string };
      const body = request.body as { currentRevisionId: string };
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        request,
        reply,
        command: {
          type: "revision.restore",
          revisionId: revisionId as Uuid,
          currentRevisionId: body.currentRevisionId as Uuid,
        },
      });
    },
  );
}
