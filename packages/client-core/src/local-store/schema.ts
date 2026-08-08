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

export interface LocalItemRow {
  readonly id: Uuid;
  readonly kind: "page" | "folder" | "file";
  readonly name: string;
  readonly lifecycle: "active" | "trashed" | "purged";
  readonly currentRevisionId: Uuid;
  readonly trashedAt: string | null;
  readonly purgeAfter: string | null;
  readonly pageDocument: {
    readonly format: "myownnotion.document+json";
    readonly formatVersion: number;
    readonly body: Record<string, unknown>;
  } | null;
  readonly file: {
    readonly contentId: Uuid;
    readonly mediaType: string;
    readonly originalName: string;
    readonly byteLength: number;
    readonly sha256: string;
    readonly verifiedAt: string;
    readonly cacheEligibility: boolean;
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

export type OutboxStatus = "pending" | "sending" | "conflict";

export interface OutboxMutationRow {
  readonly mutationId: Uuid;
  readonly commandType: string;
  readonly payload: Record<string, unknown>;
  readonly baseRevisionIds: Uuid[];
  readonly localRevisionIds: Uuid[];
  readonly status: OutboxStatus;
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

export const LOCAL_SCHEMA_VERSION = 1;
export const META_KEYS = {
  workspaceId: "workspaceId",
  schemaVersion: "schemaVersion",
  lastChangeCursor: "lastChangeCursor",
  syncState: "syncState",
} as const;

export type LocalDatabase = Dexie & {
  items: EntityTable<LocalItemRow, "id">;
  placements: EntityTable<LocalPlacementRow, "id">;
  relationships: EntityTable<LocalRelationshipRow, "id">;
  revisionHeaders: EntityTable<LocalRevisionHeaderRow, "id">;
  outbox: EntityTable<OutboxMutationRow, "mutationId">;
  conflicts: EntityTable<ConflictRecordRow, "mutationId">;
  meta: EntityTable<LocalMetaRow, "key">;
};

export function openLocalDatabase(name = "myownnotion-local"): LocalDatabase {
  const db = new Dexie(name) as LocalDatabase;
  db.version(LOCAL_SCHEMA_VERSION).stores({
    items: "id, kind, lifecycle",
    placements: "id, itemId, parentKey, [parentKey+kind]",
    relationships: "id, sourceItemId, targetItemId",
    revisionHeaders: "id, itemId, local",
    outbox: "mutationId, status, enqueueOrder",
    conflicts: "mutationId, capturedAt",
    meta: "key",
  });
  return db;
}

export function parentKeyOf(parentItemId: Uuid | null): string {
  return parentItemId ?? "root";
}
