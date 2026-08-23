/**
 * Revision routes (T084, US5): fetch, compare, restore.
 */

import {
  CompareRevisionsSchema,
  LineageClassificationSchema,
  MutationResultSchema,
  RestoreRevisionSchema,
  RevisionSchema,
  SecurityProblemSchema,
} from "@myownnotion/contracts";
import {
  getRevision,
  loadParentEdges,
  readPageOperationState,
  readRevisionAttribution,
} from "@myownnotion/database";
import { classifyLineage, describeChangeNature, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import {
  type PageHistoryService,
  PageHistoryServiceError,
} from "../page-state/page-history-service.ts";
import { sendProblem, sendSecurityProblem } from "../plugins/errors.ts";
import { handleMutation, mutationIdFrom } from "../plugins/mutations.ts";
import { requirePageOperationProtocol } from "../plugins/protocol.ts";
import { requestContext } from "../security/request-context.ts";

export function registerRevisionRoutes(
  app: FastifyInstance,
  context: AppContext,
  deps: { readonly history?: PageHistoryService | undefined } = {},
): void {
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
      const { revision, attribution } = await context.db.transaction(async (tx) => ({
        revision: await getRevision(tx, revisionId as Uuid),
        attribution: await readRevisionAttribution(tx, revisionId as Uuid),
      }));
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
        // The date, the device and the nature — the three things FR-022 asks a
        // history to identify. Nulls carried through rather than smoothed over:
        // "unknown" is a fact about this revision, and hiding it would make an
        // unattributed entry indistinguishable from an attributed one.
        authoredByDeviceId: attribution.deviceId,
        authoredByDeviceName: attribution.deviceName,
        changeNature:
          attribution.commandType === null
            ? "changed"
            : describeChangeNature(attribution.commandType),
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
        response: { 200: MutationResultSchema, 401: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      const { revisionId } = request.params as { revisionId: string };
      const body = request.body as { currentRevisionId: string };
      if (deps.history !== undefined) {
        const source = await context.db.transaction(async (tx) =>
          getRevision(tx, revisionId as Uuid),
        );
        const state =
          source === null
            ? null
            : await readPageOperationState(context.db, context.workspaceId, source.itemId);
        if (state?.status === "active") {
          requirePageOperationProtocol(request);
          const mutationId = mutationIdFrom(request);
          if (mutationId === null) {
            return sendProblem(reply, {
              code: "validation.invalid-identifier",
              title: "Idempotency-Key must be a UUID",
            });
          }
          const principal = requestContext(request).principal;
          if (principal.kind !== "owner") {
            return sendSecurityProblem(reply, {
              code: "authentication_required",
              correlationId: requestContext(request).correlationId,
            });
          }
          try {
            return reply.status(200).send(
              await deps.history.restoreRevision({
                revisionId: revisionId as Uuid,
                expectedCurrentRevisionId: body.currentRevisionId as Uuid,
                mutationId,
                deviceId: principal.deviceId as Uuid,
              }),
            );
          } catch (error) {
            if (error instanceof PageHistoryServiceError) {
              return sendProblem(reply, {
                code: error.code,
                title: error.message,
                ...(error.competingRevisionIds.length === 0
                  ? {}
                  : { competingRevisionIds: error.competingRevisionIds }),
              });
            }
            throw error;
          }
        }
      }
      return handleMutation({
        db: context.db,
        workspaceId: context.workspaceId,
        protectedContent: context.protectedContent,
        rotationPolicies: context.rotationPolicies,
        search: context.search,
        structuredQueries: context.structuredQueries,
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
