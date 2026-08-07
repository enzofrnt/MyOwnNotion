/**
 * Verified replacement snapshot (T043, US6).
 *
 * When a client's cursor is compacted it rebuilds from this snapshot: the
 * complete current projection, its contiguous change cursor, and a digest
 * the client can verify independently.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CanonicalSnapshotSchema } from "@myownnotion/contracts";
import {
  currentSequence,
  listItems,
  listRelationships,
  sequenceToCursor,
} from "@myownnotion/database";
import type { AppContext } from "../context.ts";

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
        const items = [...active, ...trashed].sort((a, b) => (a.id < b.id ? -1 : 1));
        const relationships = await listRelationships(tx, context.workspaceId);
        const payload = {
          workspaceId: context.workspaceId,
          schemaVersion: context.schemaVersion,
          cursor: sequenceToCursor(sequence),
          items,
          relationships,
        };
        const digest = createHash("sha256")
          .update(JSON.stringify({ items: payload.items, relationships: payload.relationships }))
          .digest("hex");
        return { ...payload, digest };
      });
    },
  );
}
