/**
 * Versioned Dexie local schema (T020, US6).
 *
 * One database holds the browser projection, causal revision headers, the
 * durable outbox, the last applied change cursor, and unresolved conflict
 * records. Schema migrations run transactionally through Dexie versioning.
 * The projection uses the same stable identities as the server and is never
 * a second source of truth.
 */

import type {
  DatabaseDefinition,
  DatabaseMergeConflict,
  EntryValues,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import { Dexie, type EntityTable } from "dexie";
// The envelope type, not the codec: `local-encryption.ts` knows nothing about
// the projection, so this is a leaf dependency rather than a cycle.
import type { LocalEnvelope } from "../security/local-encryption.ts";

export interface LocalItemRow {
  readonly id: Uuid;
  readonly kind: "page" | "folder" | "file";
  readonly name: string;
  readonly lifecycle: "active" | "trashed" | "purged";
  readonly currentRevisionId: Uuid;
  readonly trashedAt: string | null;
  readonly purgeAfter: string | null;
  /**
   * Kept in the clear, unlike the title.
   *
   * It is a flag, not content: it says an item was singled out, never which
   * one in any readable sense, and the favourites list has to be orderable
   * before the database is unlocked.
   */
  readonly favourite: boolean;
  /** The owner's instruction that this be kept locally (feature 005, FR-016). */
  readonly offlineIntent: boolean;
  /**
   * What *this* device holds, which no other device can answer for it.
   *
   * Three states rather than two, and the distinction is the point:
   * `offloaded` means this device had the content and released it to stay
   * within its budget, `never-fetched` means it has simply never been opened
   * here. Collapsed into "not here" they read identically, and they are not the
   * same thing to an owner deciding whether something is safe. Neither ever
   * reads as *missing*: content the server holds is not lost because this
   * laptop has not fetched it.
   */
  readonly localAvailability: "present" | "offloaded" | "never-fetched";
  readonly pageDocument: {
    readonly format: "myownnotion.document+json";
    readonly formatVersion: number;
    readonly body: Record<string, unknown>;
  } | null;
  readonly file: {
    readonly mediaType: string;
    readonly originalName: string;
    readonly byteLength: number;
  } | null;
}

export interface LocalPlacementRow {
  readonly id: Uuid;
  readonly itemId: Uuid;
  readonly kind: "hierarchy" | "attachment";
  readonly parentItemId: Uuid | null;
  /** Dexie cannot index null: root parents are indexed as "root". */
  readonly parentKey: string;
  readonly positionKey: string;
}

export interface LocalRelationshipRow {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly metadata: Record<string, unknown>;
}

export interface LocalRevisionHeaderRow {
  readonly id: Uuid;
  readonly itemId: Uuid;
  readonly mutationId: Uuid;
  readonly parentRevisionIds: Uuid[];
  readonly acceptedAt: string;
  /** True for optimistic local revisions not yet acknowledged by the server. */
  readonly local: 0 | 1;
  /**
   * Canonical identity returned for this optimistic revision.
   *
   * Kept for the lifetime of the page so an edit prepared by a render that
   * still names the local revision can be rebased instead of becoming a false
   * conflict. It is routing metadata, not owner-authored content.
   */
  readonly canonicalRevisionId?: Uuid;
}

/**
 * Where a queued mutation stands.
 *
 * `blocked` was added by feature 003 because the previous set could only say
 * "not yet" — which is a lie when the server has refused and retrying cannot
 * help. A rotation write block is the case that exists today: the owner needs
 * to know what is refused, that their existing content is still readable, and
 * what would resolve it, and none of that fits in `pending`.
 *
 * `conflict` is deliberately not a save state. A conflict is a question for
 * the owner, not a stage of saving.
 */
export type OutboxStatus = "pending" | "sending" | "conflict" | "blocked";

export interface OutboxMutationRow {
  readonly mutationId: Uuid;
  readonly commandType: string;
  readonly payload: Record<string, unknown>;
  readonly baseRevisionIds: Uuid[];
  readonly localRevisionIds: Uuid[];
  readonly status: OutboxStatus;
  /**
   * Why the server refused, when the status is `blocked`.
   *
   * Stored rather than recomputed: the interface has to tell the owner what is
   * refused and what would resolve it, and the refusal happened once, on the
   * server, possibly hours ago.
   */
  readonly blockedReason?: string;
  readonly createdAt: string;
  readonly lastAttemptAt: string | null;
  /** Monotonic local order of submission. */
  readonly enqueueOrder: number;
}

export interface ConflictRecordRow {
  readonly mutationId: Uuid;
  readonly commandType: string;
  readonly payload: Record<string, unknown>;
  readonly baseRevisionIds: Uuid[];
  readonly localRevisionIds: Uuid[];
  readonly competingRevisionIds: Uuid[];
  readonly capturedAt: string;
  readonly errorCode: string;
  /** Three complete versions retained when a structured merge needs the owner. */
  readonly structured?: StructuredConflictContext;
}

export type LegacySyncRecoveryStatus = "pending" | "converting" | "quarantined" | "converted";

export const LEGACY_SYNC_RECOVERY_REASON_CODES = [
  "legacy-recovery.payload-unreadable",
  "legacy-recovery.base-unavailable",
  "legacy-recovery.schema-unsupported",
  "legacy-recovery.diff-unprovable",
  "legacy-recovery.item-not-page",
  "legacy-recovery.server-item-missing",
  "legacy-recovery.integrity-failed",
] as const;
export type LegacySyncRecoveryReasonCode = (typeof LEGACY_SYNC_RECOVERY_REASON_CODES)[number];

/** Content-free routing for a historical whole-document conflict. */
export interface LegacySyncRecoveryRow {
  readonly mutationId: Uuid;
  /** Null only when payload and retained revision headers are both unreadable. */
  readonly pageId: Uuid | null;
  readonly status: LegacySyncRecoveryStatus;
  readonly reasonCode: LegacySyncRecoveryReasonCode | null;
  readonly branchId: Uuid | null;
  readonly attemptCount: number;
  readonly capturedAt: string;
  readonly updatedAt: string;
}

export type StructuredConflictContext =
  | {
      readonly kind: "database-definition";
      readonly conflicts: readonly DatabaseMergeConflict[];
      readonly ancestor: DatabaseDefinition;
      readonly local: DatabaseDefinition;
      readonly remote: DatabaseDefinition;
    }
  | {
      readonly kind: "database-entry-values";
      readonly conflicts: readonly DatabaseMergeConflict[];
      readonly ancestor: EntryValues;
      readonly local: EntryValues;
      readonly remote: EntryValues;
      readonly ancestorRelationTargets: RelationTargets;
      readonly localRelationTargets: RelationTargets;
      readonly remoteRelationTargets: RelationTargets;
    };

export interface LocalMetaRow {
  readonly key: string;
  readonly value: unknown;
}

/** Open in memory; `definition` is replaced by ciphertext before persistence. */
export interface LocalDatabaseRow {
  readonly itemId: Uuid;
  readonly definitionVersion: number;
  readonly definition: DatabaseDefinition;
}

export interface SealedLocalDatabaseRow extends Omit<LocalDatabaseRow, "definition"> {
  readonly sealedDefinition: LocalEnvelope;
}

/** Open in memory; values are sealed before the later version-6 Dexie write. */
export interface LocalDatabaseEntryRow {
  readonly entryItemId: Uuid;
  readonly databaseId: Uuid;
  readonly valueVersion: number;
  readonly availability: "present" | "offloaded" | "never-fetched";
  /**
   * Empty when availability is not `present`; callers must inspect the
   * availability field before treating this projection as evaluable.
   */
  readonly values: EntryValues;
}

export interface SealedLocalDatabaseEntryRow extends Omit<LocalDatabaseEntryRow, "values"> {
  readonly sealedValues: LocalEnvelope | null;
}

/**
 * Version 2 stores sealed rows (T121, FR-012, FR-024).
 *
 * The bump is what tells Dexie to run the upgrade, and the upgrade is where an
 * existing plaintext projection is resealed under the device key. A database
 * left at version 1 is a database whose titles are readable by anything with
 * access to the browser profile — which is the whole reason the local codec
 * exists.
 *
 * The indexes are unchanged and deliberately so. Only payload-bearing fields
 * are sealed; `kind`, `lifecycle`, and the placement keys stay in the clear
 * because they are what the projection is *queried* by, and encrypting them
 * would mean decrypting every row to answer "what is in this folder".
 */
export const LOCAL_SCHEMA_VERSION = 9;
export const META_KEYS = {
  workspaceId: "workspaceId",
  schemaVersion: "schemaVersion",
  lastChangeCursor: "lastChangeCursor",
  syncState: "syncState",
} as const;

/**
 * What a sealed item looks like on disk.
 *
 * The identity and the routing metadata are still readable; the title, the
 * document body, and the file description are ciphertext. `hasPageDocument`
 * exists because "does this page have a body" has to be answerable without
 * opening anything, and a null check on a sealed field cannot answer it.
 */
export interface SealedLocalItemRow extends Omit<LocalItemRow, "name" | "pageDocument" | "file"> {
  readonly sealedName: LocalEnvelope;
  readonly sealedPageBody: LocalEnvelope | null;
  readonly sealedFile: LocalEnvelope | null;
  /** Kept in the clear: the client renders a placeholder without unlocking. */
  readonly hasPageDocument: 0 | 1;
}

/** Lifecycle of the local operational representation of one page. */
export type PageOperationStateStatus = "legacy" | "initializing" | "active" | "blocked";

/** Whether the operational body is available on this device. */
export type PageOperationLocalAvailability = "present" | "offloaded" | "never-fetched";

/**
 * Durable routing metadata for one operational page.
 *
 * Checkpoint bytes, canonical content, vectors and frontiers all live in the
 * single sealed payload. Keeping one envelope is intentional: a reader can
 * never combine a new frontier with an old projection, and IndexedDB exposes
 * no owner-authored text even when every store is inspected directly.
 */
export interface SealedPageOperationStateRow {
  readonly pageId: Uuid;
  readonly status: PageOperationStateStatus;
  readonly operationalVersion: number;
  readonly canonicalFormatVersion: number;
  readonly latestServerPageSequence: number;
  readonly localAvailability: PageOperationLocalAvailability;
  readonly lastAccessedAt: string;
  /** Enters the AAD and prevents an older ciphertext replacing this row. */
  readonly recordVersion: number;
  readonly sealedState: LocalEnvelope;
}

export type PageOperationUpdateStatus = "pending" | "sending" | "accepted" | "blocked";

/** One immutable operational update; its causal body and server result are sealed together. */
export interface SealedPageOperationUpdateRow {
  readonly updateId: Uuid;
  readonly pageId: Uuid;
  readonly status: PageOperationUpdateStatus;
  readonly enqueueOrder: number;
  readonly createdAt: string;
  readonly recordVersion: number;
  readonly sealedBody: LocalEnvelope;
}

export type LocalPageAmbiguityStatus =
  | "open"
  | "resolved-keep"
  | "resolved-delete"
  | "resolved-custom";

/** Only non-content fields needed to list and route an ambiguity remain readable. */
export interface SealedPageAmbiguityRow {
  readonly ambiguityId: Uuid;
  readonly pageId: Uuid;
  readonly kind: "delete-edit" | "delete-move" | "type-transform" | "property-transform" | "schema";
  readonly status: LocalPageAmbiguityStatus;
  readonly openedAt: string;
  readonly recordVersion: number;
  readonly sealedDetails: LocalEnvelope;
}

/** Migration-only bridge for edits made before a page owns a shared CRDT history. */
export interface SealedLegacyOfflineBranchRow {
  readonly pageId: Uuid;
  readonly branchId: Uuid;
  readonly status: "editing" | "sending" | "blocked" | "converted";
  readonly createdAt: string;
  readonly recordVersion: number;
  readonly sealedBranch: LocalEnvelope;
}

export type LocalDatabase = Dexie & {
  items: EntityTable<SealedLocalItemRow, "id">;
  placements: EntityTable<LocalPlacementRow, "id">;
  relationships: EntityTable<LocalRelationshipRow, "id">;
  revisionHeaders: EntityTable<LocalRevisionHeaderRow, "id">;
  outbox: EntityTable<OutboxMutationRow, "mutationId">;
  conflicts: EntityTable<ConflictRecordRow, "mutationId">;
  meta: EntityTable<LocalMetaRow, "key">;
  databases: EntityTable<SealedLocalDatabaseRow, "itemId">;
  databaseEntries: EntityTable<SealedLocalDatabaseEntryRow, "entryItemId">;
  pageOperationStates: EntityTable<SealedPageOperationStateRow, "pageId">;
  pageOperationUpdates: EntityTable<SealedPageOperationUpdateRow, "updateId">;
  pageAmbiguities: EntityTable<SealedPageAmbiguityRow, "ambiguityId">;
  legacyOfflineBranches: EntityTable<SealedLegacyOfflineBranchRow, "pageId">;
  legacySyncRecoveries: EntityTable<LegacySyncRecoveryRow, "mutationId">;
};

export function openLocalDatabase(name = "myownnotion-local"): LocalDatabase {
  const db = new Dexie(name) as LocalDatabase;
  // Version 1 is still declared. Dexie needs the older schema to open a
  // database that is on it, and dropping the declaration would make an
  // existing projection fail to open rather than upgrade — losing offline work
  // that has not reconciled yet.
  db.version(1).stores({
    items: "id, kind, lifecycle",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
  });
  db.version(2).stores({
    items: "id, kind, lifecycle",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
  });
  // Version 3 widens what an outbox row may hold — a `blocked` status and its
  // reason — without touching a single stored row. Nothing existing can be
  // `blocked`, because nothing wrote that value before this version, so the
  // upgrade needs no migration function at all.
  db.version(3).stores({
    items: "id, kind, lifecycle",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
  });
  // Version 4 adds `favourite` to stored items. It is written rather than
  // defaulted at read time so that one place decides what an item that predates
  // favourites is — and so a query can trust the field exists.
  db.version(4)
    .stores({
      items: "id, kind, lifecycle",
      placements: "id, itemId, parentKey, [parentKey+kind]",
      relationships: "id, sourceItemId, targetItemId",
      revisionHeaders: "id, itemId, local",
      outbox: "mutationId, status, enqueueOrder",
      conflicts: "mutationId, capturedAt",
      meta: "key",
    })
    .upgrade(async (tx) => {
      // Modifiable without unsealing: `favourite` is in the clear, so nothing
      // here needs the device key — which matters, because an upgrade runs
      // when the database opens and the key may not be available yet.
      await tx
        .table("items")
        .toCollection()
        .modify((row: { favourite?: boolean }) => {
          row.favourite = false;
        });
    });
  // Version 5 adds the owner's offline instruction and what this device
  // actually holds (feature 005). `localAvailability` is indexed because the
  // eviction pass queries by it, and answering "what can I release" by opening
  // every row would mean unsealing the whole projection to reclaim space.
  db.version(5)
    .stores({
      items: "id, kind, lifecycle, localAvailability",
      placements: "id, itemId, parentKey, [parentKey+kind]",
      relationships: "id, sourceItemId, targetItemId",
      revisionHeaders: "id, itemId, local",
      outbox: "mutationId, status, enqueueOrder",
      conflicts: "mutationId, capturedAt",
      meta: "key",
    })
    .upgrade(async (tx) => {
      await tx
        .table("items")
        .toCollection()
        .modify((row: { offlineIntent?: boolean; localAvailability?: string }) => {
          row.offlineIntent = false;
          // Everything already in the projection is here because it was
          // fetched. Defaulting to `never-fetched` would tell an owner their
          // existing pages are not on this device, which is both false and
          // alarming.
          row.localAvailability = "present";
        });
    });
  // Version 6 adds page-backed database capabilities and entry memberships.
  // Both private payloads are already ciphertext when they enter these stores;
  // the indexed fields are stable identities and local availability only.
  db.version(6).stores({
    items: "id, kind, lifecycle, localAvailability",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
    databases: "itemId",
    databaseEntries: "entryItemId, databaseId, availability, [databaseId+availability]",
  });
  // Version 7 introduces the convergent page journal. It adds stores only: no
  // historical projection row is rewritten or discarded, which lets an
  // installation upgrade while legacy offline work is still waiting.
  db.version(7).stores({
    items: "id, kind, lifecycle, localAvailability",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
    databases: "itemId",
    databaseEntries: "entryItemId, databaseId, availability, [databaseId+availability]",
    pageOperationStates: "pageId, status, localAvailability, lastAccessedAt",
    pageOperationUpdates: "updateId, pageId, status, enqueueOrder, [pageId+status]",
    pageAmbiguities: "ambiguityId, pageId, status, [pageId+status]",
    legacyOfflineBranches: "pageId, branchId, status",
  });
  // Version 8 adds the inverse queue-routing index. Boot and reconnection must
  // discover page IDs that own pending operational updates without reading the
  // encrypted update envelopes themselves: after a long offline period those
  // envelopes can contain thousands of changes and many megabytes of private
  // content. Adding an index rewrites only IndexedDB routing metadata; it does
  // not open, migrate or replace a single sealed update.
  db.version(8).stores({
    items: "id, kind, lifecycle, localAvailability",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
    databases: "itemId",
    databaseEntries: "entryItemId, databaseId, availability, [databaseId+availability]",
    pageOperationStates: "pageId, status, localAvailability, lastAccessedAt",
    pageOperationUpdates:
      "updateId, pageId, status, enqueueOrder, [pageId+status], [status+pageId]",
    pageAmbiguities: "ambiguityId, pageId, status, [pageId+status]",
    legacyOfflineBranches: "pageId, branchId, status",
  });
  // Version 9 adds content-free routing for historical page conflicts. The
  // Dexie upgrade does not decrypt, classify or remove anything: the device
  // key is established later, then an idempotent recovery service proves each
  // conversion while the original sealed conflict remains authoritative.
  db.version(LOCAL_SCHEMA_VERSION).stores({
    items: "id, kind, lifecycle, localAvailability",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
    databases: "itemId",
    databaseEntries: "entryItemId, databaseId, availability, [databaseId+availability]",
    pageOperationStates: "pageId, status, localAvailability, lastAccessedAt",
    pageOperationUpdates:
      "updateId, pageId, status, enqueueOrder, [pageId+status], [status+pageId]",
    pageAmbiguities: "ambiguityId, pageId, status, [pageId+status]",
    legacyOfflineBranches: "pageId, branchId, status",
    legacySyncRecoveries: "mutationId, pageId, status, capturedAt, [status+pageId]",
  });
  return db;
}

export function parentKeyOf(parentItemId: Uuid | null): string {
  return parentItemId ?? "root";
}
