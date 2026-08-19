/**
 * Writes one checked canonical export into an empty workspace (T023, T026).
 *
 * The target is built over a transaction supplied by the caller. A destructive
 * restore and a rehearsal therefore use the same writes; only the database and
 * blob root differ. If any row fails, no canonical database change commits.
 */

import { createHash } from "node:crypto";
import type { ContentStore } from "@myownnotion/blob-store";
import {
  rebuildEmbedUsages,
  recordPlacementUsage,
  registerContent,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  canonicalLineageString,
  type ExportedItem,
  type RevisionHeader,
  type Uuid,
} from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { RestoreTarget } from "./restore-service.ts";

interface ExportedRelationship {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdRevisionId: Uuid;
  readonly removedRevisionId: Uuid | null;
}

interface StoredFile {
  readonly contentId: Uuid;
  readonly sha256: Uint8Array;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly verifiedAt: Date;
  readonly reusedExisting: boolean;
}

export interface DatabaseRestoreTargetOptions {
  readonly tx: Transaction;
  readonly workspaceId: Uuid;
  readonly contentStore: ContentStore;
  readonly protectedContent?: ProtectedContent;
}

/** Removes the state the archive replaces, inside the restore transaction. */
export async function clearWorkspaceForRestore(tx: Transaction, workspaceId: Uuid): Promise<void> {
  // The current-revision foreign key is deferred, which lets the old revisions
  // and items disappear in one transaction without ever exposing half a tree.
  await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
  // Envelopes win over plaintext on reads. Leaving an old envelope for an ID
  // that the archive restores would therefore resurrect stale content after a
  // successful restore. Protected chunks are equally tied to the state being
  // replaced, even though their storage bytes are reclaimed separately.
  await tx.execute(sql`DELETE FROM protected_blob_chunks WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM protected_envelopes WHERE workspace_id = ${workspaceId}`);
  // Pending transfers and generated exports describe the old workspace and
  // cannot truthfully survive replacing it.
  await tx.execute(sql`DELETE FROM uploads WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM exports WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM relationships WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM file_usages WHERE used_by_item_id IN
    (SELECT id FROM items WHERE workspace_id = ${workspaceId})`);
  await tx.execute(sql`DELETE FROM page_documents WHERE page_id IN
    (SELECT id FROM items WHERE workspace_id = ${workspaceId})`);
  await tx.execute(sql`DELETE FROM placements WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM logical_files WHERE item_id IN
    (SELECT id FROM items WHERE workspace_id = ${workspaceId})`);
  await tx.execute(sql`DELETE FROM lifecycle_events WHERE item_id IN
    (SELECT id FROM items WHERE workspace_id = ${workspaceId})`);
  await tx.execute(sql`DELETE FROM revision_parents WHERE revision_id IN
    (SELECT r.id FROM revisions r JOIN items i ON i.id = r.item_id
      WHERE i.workspace_id = ${workspaceId})`);
  await tx.execute(sql`DELETE FROM changes WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM revisions WHERE item_id IN
    (SELECT id FROM items WHERE workspace_id = ${workspaceId})`);
  await tx.execute(sql`DELETE FROM mutations WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM items WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM file_contents WHERE NOT EXISTS
    (SELECT 1 FROM logical_files WHERE logical_files.content_id = file_contents.id)`);
}

export function createDatabaseRestoreTarget(options: DatabaseRestoreTargetOptions): RestoreTarget {
  const files = new Map<string, StoredFile>();
  const placements: Array<{
    readonly item: ExportedItem;
    readonly placement: ExportedItem["placements"][number];
  }> = [];
  const parentEdges: Array<{ revisionId: Uuid; parentRevisionId: Uuid }> = [];
  const mutationRevisions = new Map<Uuid, Uuid[]>();
  const pages: Array<{ id: Uuid; body: unknown }> = [];

  return {
    writeFile: async (digest, bytes) => {
      const stored = await options.contentStore.ingest(bytes, async () => null);
      if (`sha256:${Buffer.from(stored.sha256).toString("hex")}` !== digest) {
        throw new Error("restored file bytes changed while being stored");
      }
      files.set(digest, stored);
    },

    writeItem: async (raw) => {
      const item = raw as ExportedItem;
      await options.tx.insert(schema.items).values({
        id: item.id,
        workspaceId: options.workspaceId,
        kind: item.kind,
        name: item.name,
        lifecycle: item.lifecycle,
        trashedAt: item.trashedAt === null ? null : new Date(item.trashedAt),
        purgeAfter: item.purgeAfter === null ? null : new Date(item.purgeAfter),
        currentRevisionId: item.currentRevisionId,
        favourite: item.favourite,
        offlineIntent: item.offlineIntent,
      });
      await options.protectedContent?.writeItemName(options.tx, {
        itemId: item.id,
        recordVersion: 1,
        name: item.name,
      });

      if (item.pageDocument !== null) {
        await options.tx.insert(schema.pageDocuments).values({
          pageId: item.id,
          format: item.pageDocument.format,
          formatVersion: item.pageDocument.formatVersion,
          body: item.pageDocument.body,
        });
        await options.protectedContent?.writePageBody(options.tx, {
          pageId: item.id,
          recordVersion: 1,
          body: item.pageDocument.body,
        });
        pages.push({ id: item.id, body: item.pageDocument.body });
      }

      if (item.file !== null) {
        const digest = `sha256:${item.file.sha256}`;
        const stored = files.get(digest);
        if (stored === undefined) {
          throw new Error("an exported file item names bytes the archive did not restore");
        }
        const contentId = await registerContent(options.tx, stored);
        await options.tx.insert(schema.logicalFiles).values({
          itemId: item.id,
          contentId,
          mediaType: item.file.mediaType,
          originalName: item.file.originalName,
          byteLength: item.file.byteLength,
        });
      }

      for (const placement of item.placements) {
        placements.push({ item, placement });
      }
    },

    writeRevision: async (raw) => {
      const revision = raw as RevisionHeader;
      const revisions = mutationRevisions.get(revision.mutationId) ?? [];
      if (revisions.length === 0) {
        await options.tx.insert(schema.mutations).values({
          id: revision.mutationId,
          workspaceId: options.workspaceId,
          commandType: "restore.import",
          status: "accepted",
          acceptedAt: new Date(revision.acceptedAt),
          resultRevisionIds: [revision.id],
        });
      } else {
        await options.tx
          .update(schema.mutations)
          .set({ resultRevisionIds: [...revisions, revision.id] })
          .where(sql`${schema.mutations.id} = ${revision.mutationId}`);
      }
      revisions.push(revision.id);
      mutationRevisions.set(revision.mutationId, revisions);

      const lineageDigest = createHash("sha256")
        .update(
          canonicalLineageString({
            id: revision.id,
            itemId: revision.itemId,
            mutationId: revision.mutationId,
            parentRevisionIds: revision.parentRevisionIds,
          }),
        )
        .digest("hex");
      await options.tx.insert(schema.revisions).values({
        id: revision.id,
        itemId: revision.itemId,
        mutationId: revision.mutationId,
        acceptedAt: new Date(revision.acceptedAt),
        authoredByDeviceId: revision.authoredByDeviceId ?? null,
        snapshot: null,
        snapshotExpiresAt: null,
        lineageDigest,
      });
      for (const parentRevisionId of revision.parentRevisionIds) {
        parentEdges.push({ revisionId: revision.id, parentRevisionId });
      }
    },

    writeRelationship: async (raw) => {
      const relationship = raw as ExportedRelationship;
      await options.tx.insert(schema.relationships).values({
        id: relationship.id,
        workspaceId: options.workspaceId,
        sourceItemId: relationship.sourceItemId,
        targetItemId: relationship.targetItemId,
        relationType: relationship.relationType,
        metadata: relationship.metadata,
        createdRevisionId: relationship.createdRevisionId,
        removedRevisionId: relationship.removedRevisionId,
      });
      await options.protectedContent?.writeRelationshipMetadata(options.tx, {
        relationshipId: relationship.id,
        recordVersion: 1,
        metadata: relationship.metadata,
      });
    },

    finish: async () => {
      if (parentEdges.length > 0) {
        await options.tx.insert(schema.revisionParents).values(parentEdges);
      }
      for (const { item, placement } of placements) {
        await options.tx.insert(schema.placements).values({
          id: placement.id,
          workspaceId: options.workspaceId,
          itemId: item.id,
          itemIsFile: item.kind === "file",
          kind: placement.kind,
          parentItemId: placement.parentItemId,
          positionKey: placement.positionKey,
          removedAt: null,
          // The portable export does not keep placement-history headers. Its
          // current item revision is the revision that vouches for this active
          // placement in the restored state.
          createdRevisionId: item.currentRevisionId,
        });
        if (item.kind === "file") {
          await recordPlacementUsage(options.tx, {
            fileItemId: item.id,
            parentItemId: placement.parentItemId,
            kind: placement.kind,
          });
        }
      }
      for (const page of pages) {
        await rebuildEmbedUsages(options.tx, page.id, page.body);
      }
    },
  };
}
