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
  readDatabaseEntryRecord,
  readDatabaseRecord,
  readItems,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";
import {
  resolveProtectedContent,
  resolveProtectedRelationships,
} from "../security/content-resolution.ts";
import {
  resolveDatabaseEntryProjections,
  resolveDatabaseProjections,
} from "../sync/structured-payload.ts";

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
        // Resolved, like every other read that returns content. This is the path
        // a device uses to catch up, so unresolved bodies here mean a change
        // arrives as a page that has gone blank — worse than not arriving,
        // because the device then overwrites what it had with the blank.
        const items = await resolveProtectedContent(
          tx,
          await readItems(tx, itemIds),
          context.protectedContent,
        );
        const itemsById = new Map(items.map((item) => [item.id, item]));
        // `tx` owns one pg client. Queries on it must be awaited in order;
        // Promise.all only queues work on that same connection and pg 9 rejects
        // the overlapping client.query calls.
        const databaseRecords = [];
        const entryRecords = [];
        const relationshipRows = [];
        for (const itemId of itemIds) {
          const databaseRecord = await readDatabaseRecord(tx, itemId);
          if (
            databaseRecord !== null &&
            itemsById.get(databaseRecord.databaseId)?.lifecycle !== "purged"
          ) {
            databaseRecords.push(databaseRecord);
          }

          const entryRecord = await readDatabaseEntryRecord(tx, itemId);
          if (entryRecord !== null && itemsById.get(entryRecord.entryId)?.lifecycle !== "purged") {
            entryRecords.push(entryRecord);
          }

          relationshipRows.push(...(await listRelationships(tx, context.workspaceId, itemId)));
        }
        const uniqueRelationships = [
          ...new Map(
            relationshipRows.map((relationship) => [relationship.id, relationship]),
          ).values(),
        ];
        const relationships = await resolveProtectedRelationships(
          tx,
          uniqueRelationships,
          context.protectedContent,
        );
        const databases = await resolveDatabaseProjections(
          tx,
          databaseRecords,
          context.protectedContent,
        );
        const databaseEntries = await resolveDatabaseEntryProjections(
          tx,
          entryRecords,
          context.protectedContent,
        );
        return {
          changes: changes.changes.map((change) => {
            const changedIds = new Set(change.changedItemIds);
            return {
              sequence: change.sequence,
              mutationId: change.mutationId,
              revisionIds: change.revisionIds,
              nature: change.nature,
              changedItems: change.changedItemIds
                .map((id) => itemsById.get(id))
                .filter((item) => item !== undefined),
              relationships: relationships
                .filter(
                  ({ sourceItemId, targetItemId }) =>
                    changedIds.has(sourceItemId) || changedIds.has(targetItemId),
                )
                .sort((left, right) => left.id.localeCompare(right.id)),
              databases: databases.filter(({ itemId }) => changedIds.has(itemId as Uuid)),
              databaseEntries: databaseEntries.filter(({ entryItemId }) =>
                changedIds.has(entryItemId as Uuid),
              ),
            };
          }),
          nextCursor: changes.nextCursor,
          hasMore: changes.hasMore,
        };
      });
      return page;
    },
  );
}
