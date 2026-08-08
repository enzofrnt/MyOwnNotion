/**
 * Ordered change-cursor catch-up (T043, US6).
 *
 * Returns contiguous changes after an opaque cursor. A cursor that predates
 * the retained window yields a `cursor.compacted` conflict so the client
 * rebuilds from the verified snapshot without discarding its outbox.
 */

import { ChangesResponseSchema } from "@myownnotion/contracts";
import {
  cursorToSequence,
  listChangesAfter,
  listRelationships,
  readItems,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";

export function registerChangeRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    "/v1/changes",
    {
      schema: {
        querystring: Type.Object({
          after: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
        }),
        response: { 200: ChangesResponseSchema },
      },
    },
    async (request, reply) => {
      const query = request.query as { after?: string; limit?: number };
      const afterSequence = cursorToSequence(query.after ?? "");
      if (afterSequence === null) {
        // Unparseable cursors are treated as compacted: rebuild from snapshot.
        return sendProblem(reply, {
          code: "cursor.compacted",
          title: "Change cursor is no longer available; rebuild from the verified snapshot",
        });
      }
      const limit = query.limit ?? 200;
      const page = await context.db.transaction(async (tx) => {
        const changes = await listChangesAfter(tx, context.workspaceId, afterSequence, limit);
        const itemIds = [
          ...new Set(changes.changes.flatMap((change) => change.changedItemIds)),
        ] as Uuid[];
        const items = await readItems(tx, itemIds);
        const itemsById = new Map(items.map((item) => [item.id, item]));
        const relationships = await listRelationships(tx, context.workspaceId);
        return {
          changes: changes.changes.map((change) => ({
            sequence: change.sequence,
            mutationId: change.mutationId,
            revisionIds: change.revisionIds,
            changedItems: change.changedItemIds
              .map((id) => itemsById.get(id))
              .filter((item) => item !== undefined),
            relationshipSourceItemIds: change.changedItemIds,
            changedRelationships: relationships.filter(
              (relationship) =>
                change.changedItemIds.includes(relationship.sourceItemId) &&
                relationship.relationType === "link:references",
            ),
          })),
          nextCursor: changes.nextCursor,
          hasMore: changes.hasMore,
        };
      });
      return page;
    },
  );
}
