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
  listItems,
  listRelationships,
  sequenceToCursor,
} from "@myownnotion/database";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { resolveProtectedContent } from "../security/content-resolution.ts";

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
