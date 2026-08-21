/**
 * Verified replacement snapshot (T043, US6).
 *
 * When a client's cursor is compacted it rebuilds from this snapshot: the
 * complete current projection, its contiguous change cursor, and a digest
 * the client can verify independently.
 */
import { createHash } from "node:crypto";
import { CanonicalSnapshotSchema } from "@myownnotion/contracts";
import {
  currentSequence,
  listDatabaseEntryRecords,
  listDatabaseRecords,
  listItems,
  listRelationships,
  sequenceToCursor,
} from "@myownnotion/database";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import {
  resolveProtectedContent,
  resolveProtectedRelationships,
} from "../security/content-resolution.ts";
import {
  resolveDatabaseEntryProjections,
  resolveDatabaseProjections,
} from "../sync/structured-payload.ts";

/** Stable object-key order; array order is canonicalized by each projection set. */
function canonicalSnapshotString(value: unknown): string {
  return JSON.stringify(value, (_key, candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return candidate;
    }
    const record = candidate as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

export function registerSnapshotRoutes(app: FastifyInstance, context: AppContext): void {
  app.get(
    "/v1/snapshots/current",
    {
      schema: {
        response: { 200: CanonicalSnapshotSchema },
      },
    },
    async () => {
      return context.db.transaction(async (tx) => {
        const sequence = await currentSequence(tx, context.workspaceId);
        const active = await listItems(tx, context.workspaceId, { lifecycle: "active" });
        const trashed = await listItems(tx, context.workspaceId, { lifecycle: "trashed" });
        // Resolved, exactly as `/v1/items` resolves them. This snapshot is how a
        // device rebuilds its whole workspace, so serving sealed page bodies here
        // hands it a projection whose every page is blank — and it has no way to
        // tell that from pages that are genuinely empty. That failure is silent
        // and total, which is why it belongs on the same path as the read that
        // already gets it right rather than on a second one.
        const items = await resolveProtectedContent(
          tx,
          [...active, ...trashed].sort((a, b) => (a.id < b.id ? -1 : 1)),
          context.protectedContent,
        );
        const retainedItemIds = new Set(items.map(({ id }) => id));
        const databaseRecords = (await listDatabaseRecords(tx, context.workspaceId)).filter(
          ({ databaseId }) => retainedItemIds.has(databaseId),
        );
        const entryRecords = (
          await Promise.all(
            databaseRecords.map((record) => listDatabaseEntryRecords(tx, record.databaseId)),
          )
        )
          .flat()
          .filter(({ entryId }) => retainedItemIds.has(entryId));
        const [relationships, databases, databaseEntries] = await Promise.all([
          resolveProtectedRelationships(
            tx,
            await listRelationships(tx, context.workspaceId),
            context.protectedContent,
          ).then((rows) => rows.sort((left, right) => left.id.localeCompare(right.id))),
          resolveDatabaseProjections(tx, databaseRecords, context.protectedContent),
          resolveDatabaseEntryProjections(tx, entryRecords, context.protectedContent),
        ]);
        const payload = {
          workspaceId: context.workspaceId,
          schemaVersion: context.schemaVersion,
          cursor: sequenceToCursor(sequence),
          items,
          relationships,
          databases,
          databaseEntries,
        };
        const digest = createHash("sha256")
          .update(
            canonicalSnapshotString({
              items: payload.items,
              relationships: payload.relationships,
              databases: payload.databases,
              databaseEntries: payload.databaseEntries,
            }),
          )
          .digest("hex");
        return { ...payload, digest };
      });
    },
  );
}
