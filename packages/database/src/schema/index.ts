/**
 * Canonical PostgreSQL schema (T014).
 *
 * Kept in one module so cross-table references (deferred circular foreign
 * keys between items and revisions are added in reviewed SQL migrations)
 * stay easy to audit. Column-level invariants live here; graph-level
 * invariants (cycles, final-placement transitions) are enforced by domain
 * services plus recursive queries inside one transaction.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    schemaVersion: integer("schema_version").notNull(),
  },
  (table) => [
    // Exactly one canonical workspace per installation (FR-001): a unique
    // index on a constant expression admits at most one row, so a concurrent
    // second bootstrap fails loudly instead of inserting a stray workspace.
    // Added in migration 0002_workspace_singleton.sql.
    uniqueIndex("workspaces_singleton_idx").on(sql`(true)`),
    check("workspaces_schema_version_check", sql`${table.schemaVersion} >= 1`),
  ],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    lifecycle: text("lifecycle").notNull().default("active"),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    // FK to revisions(id) is added as DEFERRABLE INITIALLY DEFERRED in SQL,
    // so the item row and its creation revision commit atomically.
    currentRevisionId: uuid("current_revision_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("items_id_kind_unique").on(table.id, table.kind),
    index("items_workspace_lifecycle_idx").on(table.workspaceId, table.lifecycle),
    check("items_kind_check", sql`${table.kind} IN ('page', 'folder', 'file')`),
    check("items_lifecycle_check", sql`${table.lifecycle} IN ('active', 'trashed', 'purged')`),
    check("items_name_check", sql`length(${table.name}) BETWEEN 1 AND 512`),
    check(
      "items_trash_metadata_check",
      sql`(${table.lifecycle} <> 'trashed') OR (${table.trashedAt} IS NOT NULL AND ${table.purgeAfter} IS NOT NULL)`,
    ),
  ],
);

export const placements = pgTable(
  "placements",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    itemId: uuid("item_id").notNull(),
    // Denormalized item kind lets constraints enforce kind-aware cardinality;
    // the composite FK (item_id, item_kind) keeps it consistent.
    itemKind: text("item_kind").notNull(),
    kind: text("kind").notNull(),
    parentItemId: uuid("parent_item_id"),
    positionKey: text("position_key").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdRevisionId: uuid("created_revision_id").notNull(),
    removedRevisionId: uuid("removed_revision_id"),
  },
  (table) => [
    index("placements_parent_active_idx").on(table.parentItemId, table.kind),
    index("placements_item_idx").on(table.itemId),
    // Pages and folders: exactly one active hierarchy placement.
    uniqueIndex("placements_single_hierarchy_unique")
      .on(table.itemId)
      .where(
        sql`${table.kind} = 'hierarchy' AND ${table.removedAt} IS NULL AND ${table.itemKind} <> 'file'`,
      ),
    check("placements_kind_check", sql`${table.kind} IN ('hierarchy', 'attachment')`),
    check(
      "placements_attachment_parent_check",
      sql`(${table.kind} <> 'attachment') OR (${table.parentItemId} IS NOT NULL)`,
    ),
    check(
      "placements_attachment_file_check",
      sql`(${table.kind} <> 'attachment') OR (${table.itemKind} = 'file')`,
    ),
    check("placements_position_key_check", sql`length(${table.positionKey}) BETWEEN 1 AND 255`),
  ],
);

export const pageDocuments = pgTable(
  "page_documents",
  {
    pageId: uuid("page_id")
      .primaryKey()
      .references(() => items.id),
    format: text("format").notNull(),
    formatVersion: integer("format_version").notNull(),
    body: jsonb("body").notNull(),
  },
  (table) => [
    check("page_documents_format_check", sql`${table.format} = 'myownnotion.document+json'`),
    check("page_documents_version_check", sql`${table.formatVersion} >= 1`),
  ],
);

export const fileContents = pgTable(
  "file_contents",
  {
    id: uuid("id").primaryKey(),
    sha256: bytea("sha256").notNull(),
    byteLength: bigint("byte_length", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    referenceCount: integer("reference_count").notNull().default(0),
  },
  (table) => [
    index("file_contents_digest_idx").on(table.sha256, table.byteLength),
    check("file_contents_length_check", sql`${table.byteLength} >= 0`),
    check("file_contents_sha256_check", sql`octet_length(${table.sha256}) = 32`),
  ],
);

export const logicalFiles = pgTable(
  "logical_files",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => items.id),
    contentId: uuid("content_id")
      .notNull()
      .references(() => fileContents.id),
    mediaType: text("media_type").notNull(),
    originalName: text("original_name").notNull(),
    byteLength: bigint("byte_length", { mode: "number" }).notNull(),
  },
  (table) => [check("logical_files_length_check", sql`${table.byteLength} >= 0`)],
);

export const mutations = pgTable(
  "mutations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    commandType: text("command_type").notNull(),
    status: text("status").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    resultRevisionIds: uuid("result_revision_ids").array().notNull().default([]),
    failureCode: text("failure_code"),
  },
  (table) => [
    check("mutations_status_check", sql`${table.status} IN ('accepted', 'rejected')`),
    check(
      "mutations_result_check",
      sql`(${table.status} <> 'accepted') OR (cardinality(${table.resultRevisionIds}) >= 1)`,
    ),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    mutationId: uuid("mutation_id")
      .notNull()
      .references(() => mutations.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    snapshot: jsonb("snapshot"),
    snapshotExpiresAt: timestamp("snapshot_expires_at", { withTimezone: true }),
    lineageDigest: text("lineage_digest").notNull(),
  },
  (table) => [index("revisions_item_idx").on(table.itemId)],
);

export const revisionParents = pgTable(
  "revision_parents",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id),
    parentRevisionId: uuid("parent_revision_id")
      .notNull()
      .references(() => revisions.id),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.parentRevisionId] }),
    index("revision_parents_parent_idx").on(table.parentRevisionId),
  ],
);

export { changes } from "./change-sequence.ts";

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    sourceItemId: uuid("source_item_id")
      .notNull()
      .references(() => items.id),
    targetItemId: uuid("target_item_id")
      .notNull()
      .references(() => items.id),
    relationType: text("relation_type").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdRevisionId: uuid("created_revision_id")
      .notNull()
      .references(() => revisions.id),
    removedRevisionId: uuid("removed_revision_id").references(() => revisions.id),
  },
  (table) => [
    index("relationships_source_idx").on(table.sourceItemId),
    index("relationships_target_idx").on(table.targetItemId),
    check(
      "relationships_type_check",
      sql`${table.relationType} ~ '^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$'`,
    ),
  ],
);

export const lifecycleEvents = pgTable(
  "lifecycle_events",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    mutationId: uuid("mutation_id")
      .notNull()
      .references(() => mutations.id),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    placementSnapshot: jsonb("placement_snapshot").notNull().default([]),
  },
  (table) => [
    index("lifecycle_events_item_idx").on(table.itemId),
    check(
      "lifecycle_events_type_check",
      sql`${table.eventType} IN ('trashed', 'restored', 'purged')`,
    ),
  ],
);

export const exports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    status: text("status").notNull().default("pending"),
    digest: text("digest"),
    manifest: jsonb("manifest"),
    problem: jsonb("problem"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ready: boolean("ready").notNull().default(false),
  },
  (table) => [
    check("exports_status_check", sql`${table.status} IN ('pending', 'ready', 'failed')`),
  ],
);
