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
  buildItemSnapshot,
  rebuildEmbedUsages,
  recordPlacementUsage,
  registerContent,
  SCRUBBED_PLACEHOLDER,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  canonicalLineageString,
  type ExportedDatabase,
  type ExportedDatabaseEntry,
  type ExportedItem,
  type RevisionHeader,
  type Uuid,
} from "@myownnotion/domain";
import { eq, sql } from "drizzle-orm";
import {
  type ProtectedFileService,
  ProtectedFileUnavailableError,
} from "../files/protected-file-service.ts";
import type { PageOperationCrypto } from "../page-state/page-operation-crypto.ts";
import {
  PROTECTED_PAYLOAD,
  protectCurrentItem,
  resolveSnapshotPayload,
} from "../security/canonical-payloads.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import { shareFullFileMutation } from "./full/locks.ts";
import { PageOperationArchiveService, readPageOperationArchive } from "./page-operation-archive.ts";
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

type StoredFile = Parameters<typeof registerContent>[1];

export interface DatabaseRestoreTargetOptions {
  readonly tx: Transaction;
  readonly workspaceId: Uuid;
  readonly contentStore: ContentStore;
  readonly protectedContent?: ProtectedContent;
  readonly protectedFiles?: ProtectedFileService;
  readonly pageOperationCrypto?: PageOperationCrypto;
  /** Destructive targets clear their old state only after archive verification. */
  readonly prepare?: () => Promise<void>;
}

/** Removes the state the archive replaces, inside the restore transaction. */
export async function clearWorkspaceForRestore(tx: Transaction, workspaceId: Uuid): Promise<void> {
  await shareFullFileMutation(tx);
  // The current-revision foreign key is deferred, which lets the old revisions
  // and items disappear in one transaction without ever exposing half a tree.
  await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
  // Envelopes win over plaintext on reads. Leaving an old envelope for an ID
  // that the archive restores would therefore resurrect stale content after a
  // successful restore. Protected chunks are equally tied to the state being
  // replaced, even though their storage bytes are reclaimed separately.
  // Operational rows name protected envelopes and must disappear first. The
  // authorization inventory intentionally remains: an absent authorized
  // device must still be able to submit its offline branch after restoration.
  await tx.execute(
    sql`DELETE FROM page_legacy_branch_conversions WHERE workspace_id = ${workspaceId}`,
  );
  await tx.execute(sql`DELETE FROM page_ambiguities WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM page_device_frontiers WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM page_operation_updates WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM page_operation_checkpoints WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM page_operation_states WHERE workspace_id = ${workspaceId}`);
  // Quarantine belongs to recovery, not the logical workspace being replaced.
  await tx.execute(sql`DELETE FROM protected_blob_chunks b WHERE b.workspace_id = ${workspaceId}
    AND NOT EXISTS (SELECT 1 FROM protected_file_quarantine q WHERE q.content_id = b.content_id)`);
  await tx.execute(sql`DELETE FROM protected_envelopes p WHERE p.workspace_id = ${workspaceId}
    AND NOT EXISTS (SELECT 1 FROM file_storage_transitions t WHERE t.source_inventory_envelope_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM file_storage_transition_entries e
      WHERE e.source_envelope_id = p.id OR e.replacement_envelope_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM protected_file_quarantine q
      WHERE q.manifest_envelope_id = p.id OR
        (p.entity_type = 'file.content-manifest' AND p.entity_id = q.content_id))`);
  // Pending transfers and generated exports describe the old workspace and
  // cannot truthfully survive replacing it.
  await tx.execute(sql`DELETE FROM uploads WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM exports WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM relationships WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM database_entries WHERE workspace_id = ${workspaceId}`);
  await tx.execute(sql`DELETE FROM databases WHERE workspace_id = ${workspaceId}`);
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
    (SELECT 1 FROM logical_files WHERE logical_files.content_id = file_contents.id)
    AND NOT EXISTS (SELECT 1 FROM protected_file_quarantine q WHERE q.content_id = file_contents.id)`);
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
  const itemsById = new Map<Uuid, ExportedItem>();
  const restoredDatabases = new Map<Uuid, ExportedDatabase>();
  const restoredEntries = new Map<Uuid, ExportedDatabaseEntry>();
  const pageOperationArchive =
    options.pageOperationCrypto === undefined
      ? null
      : new PageOperationArchiveService({
          workspaceId: options.workspaceId,
          crypto: options.pageOperationCrypto,
        });

  return {
    ...(options.prepare === undefined ? {} : { begin: options.prepare }),
    verifyPageOperations: async (raw, canonicalExport) => {
      if (pageOperationArchive === null) {
        throw new Error("the restore target cannot verify operational page state");
      }
      await pageOperationArchive.verify(readPageOperationArchive(raw), canonicalExport);
    },
    verifyPageOperationDevices: async (raw) => {
      if (pageOperationArchive === null) {
        throw new Error("the restore target cannot verify operational page state");
      }
      await pageOperationArchive.verifyDeviceReferences(options.tx, readPageOperationArchive(raw));
    },

    writePageOperations: async (raw) => {
      if (pageOperationArchive === null) {
        throw new Error("the restore target cannot write operational page state");
      }
      await pageOperationArchive.restore(options.tx, raw);
    },

    writeFile: async (digest, bytes) => {
      if (options.protectedContent !== undefined && options.protectedFiles === undefined)
        throw new ProtectedFileUnavailableError();
      const stored =
        options.protectedFiles === undefined
          ? await options.contentStore.ingest(bytes, async () => null)
          : await options.protectedFiles.ingest(
              options.tx,
              (async function* () {
                yield bytes;
              })(),
              { maxBytes: bytes.byteLength, expectedLength: bytes.byteLength },
            );
      if (`sha256:${Buffer.from(stored.sha256).toString("hex")}` !== digest) {
        throw new Error("restored file bytes changed while being stored");
      }
      files.set(digest, stored);
    },

    writeItem: async (raw) => {
      const item = raw as ExportedItem;
      itemsById.set(item.id, item);
      await options.tx.insert(schema.items).values({
        id: item.id,
        workspaceId: options.workspaceId,
        kind: item.kind,
        name:
          item.kind === "file" && options.protectedContent !== undefined
            ? SCRUBBED_PLACEHOLDER
            : item.name,
        icon:
          item.kind === "file" && options.protectedContent !== undefined
            ? null
            : (item.icon ?? null),
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
        icon: item.icon ?? null,
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
          mediaType:
            options.protectedContent === undefined
              ? item.file.mediaType
              : "application/octet-stream",
          originalName:
            options.protectedContent === undefined ? item.file.originalName : SCRUBBED_PLACEHOLDER,
          byteLength: item.file.byteLength,
        });
        await options.protectedContent?.writeFileMetadata(options.tx, {
          kind: "file",
          id: item.id,
          recordVersion: 1,
          metadata: { originalName: item.file.originalName, mediaType: item.file.mediaType },
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

    writeDatabase: async (raw) => {
      const database = raw as ExportedDatabase;
      const journalItem = itemsById.get(database.databaseId);
      if (journalItem === undefined) {
        throw new Error("a restored database has no journal identity");
      }
      restoredDatabases.set(database.databaseId, database);
      await options.tx.insert(schema.databases).values({
        itemId: database.databaseId,
        definitionRevisionId: database.definitionRevisionId ?? journalItem.currentRevisionId,
        workspaceId: options.workspaceId,
        definitionVersion: database.definitionVersion,
      });
      await options.protectedContent?.writeDatabaseDefinition(options.tx, {
        databaseId: database.databaseId,
        definitionVersion: database.definitionVersion,
        definition: database.definition,
      });
    },

    writeDatabaseEntry: async (raw) => {
      const entry = raw as ExportedDatabaseEntry;
      if (!itemsById.has(entry.entryId) || !restoredDatabases.has(entry.databaseId)) {
        throw new Error("a restored database entry has no page or database");
      }
      restoredEntries.set(entry.entryId, entry);
      await options.tx.insert(schema.databaseEntries).values({
        entryItemId: entry.entryId,
        databaseId: entry.databaseId,
        workspaceId: options.workspaceId,
        valueVersion: entry.valueVersion,
        addedRevisionId: entry.addedRevisionId,
      });
      await options.protectedContent?.writeDatabaseEntryValues(options.tx, {
        entryId: entry.entryId,
        valueVersion: entry.valueVersion,
        values: entry.values,
      });
    },

    writeRelationship: async (raw) => {
      const relationship = raw as ExportedRelationship;
      await options.tx.insert(schema.relationships).values({
        id: relationship.id,
        workspaceId: options.workspaceId,
        sourceItemId: relationship.sourceItemId,
        targetItemId: relationship.targetItemId,
        relationType: relationship.relationType,
        metadata:
          options.protectedContent !== undefined &&
          relationship.relationType !== "database:property"
            ? PROTECTED_PAYLOAD
            : relationship.metadata,
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
      for (const [itemId, item] of itemsById) {
        const database = restoredDatabases.get(itemId);
        const entry = restoredEntries.get(itemId);
        if (database === undefined && entry === undefined && options.protectedContent === undefined)
          continue;
        let snapshot = await buildItemSnapshot(options.tx, itemId);
        if (database !== undefined) {
          snapshot["databaseDefinition"] = database.definition;
          snapshot["databaseDefinitionVersion"] = database.definitionVersion;
        }
        if (entry !== undefined) {
          snapshot["databaseId"] = entry.databaseId;
          snapshot["databaseEntryValues"] = entry.values;
          snapshot["databaseEntryValueVersion"] = entry.valueVersion;
        }
        if (options.protectedContent !== undefined)
          snapshot = await resolveSnapshotPayload(
            options.tx,
            options.protectedContent,
            itemId,
            snapshot,
          );
        await options.tx
          .update(schema.revisions)
          .set({ snapshot: options.protectedContent === undefined ? snapshot : null })
          .where(eq(schema.revisions.id, item.currentRevisionId));
        await options.protectedContent?.writeRevisionSnapshot(options.tx, {
          revisionId: item.currentRevisionId,
          snapshot,
        });
        if (
          database?.definitionRevisionId !== undefined &&
          database.definitionRevisionId !== item.currentRevisionId
        ) {
          const sourceSnapshot = {
            databaseDefinition: database.definition,
            databaseDefinitionVersion: database.definitionVersion,
          };
          await options.tx
            .update(schema.revisions)
            .set({ snapshot: options.protectedContent === undefined ? sourceSnapshot : null })
            .where(eq(schema.revisions.id, database.definitionRevisionId));
          await options.protectedContent?.writeRevisionSnapshot(options.tx, {
            revisionId: database.definitionRevisionId,
            snapshot: sourceSnapshot,
          });
        }
        if (options.protectedContent !== undefined)
          await protectCurrentItem(options.tx, options.protectedContent, itemId);
      }
    },
  };
}
