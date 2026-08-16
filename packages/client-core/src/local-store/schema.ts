/**
 * Versioned Dexie local schema (T020, US6).
 *
 * One database holds the browser projection, causal revision headers, the
 * durable outbox, the last applied change cursor, and unresolved conflict
 * records. Schema migrations run transactionally through Dexie versioning.
 * The projection uses the same stable identities as the server and is never
 * a second source of truth.
 */

import type { Uuid } from "@myownnotion/domain";
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
}

export interface LocalMetaRow {
  readonly key: string;
  readonly value: unknown;
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
export const LOCAL_SCHEMA_VERSION = 4;
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

export type LocalDatabase = Dexie & {
  items: EntityTable<SealedLocalItemRow, "id">;
  placements: EntityTable<LocalPlacementRow, "id">;
  relationships: EntityTable<LocalRelationshipRow, "id">;
  revisionHeaders: EntityTable<LocalRevisionHeaderRow, "id">;
  outbox: EntityTable<OutboxMutationRow, "mutationId">;
  conflicts: EntityTable<ConflictRecordRow, "mutationId">;
  meta: EntityTable<LocalMetaRow, "key">;
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
  db.version(LOCAL_SCHEMA_VERSION)
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
  return db;
}

export function parentKeyOf(parentItemId: Uuid | null): string {
  return parentItemId ?? "root";
}
