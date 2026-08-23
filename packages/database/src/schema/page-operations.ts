/**
 * Structural schema for convergent page operations.
 *
 * This module is a factory to avoid a circular schema import: the canonical
 * content and security tables are declared in `index.ts`, then their identity
 * columns are supplied here. Payloads remain in `protected_envelopes`; these
 * tables expose only routing, lifecycle and monotonic ordering metadata.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export interface PageOperationSchemaDependencies {
  readonly workspaceId: AnyPgColumn;
  readonly itemId: AnyPgColumn;
  readonly itemWorkspaceId: AnyPgColumn;
  readonly revisionId: AnyPgColumn;
  readonly deviceId: AnyPgColumn;
  readonly protectedEnvelopeId: AnyPgColumn;
}

export function definePageOperationSchema(deps: PageOperationSchemaDependencies) {
  const pageOperationStates = pgTable(
    "page_operation_states",
    {
      pageId: uuid("page_id")
        .primaryKey()
        .references(() => deps.itemId),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => deps.workspaceId),
      status: text("status").notNull().default("initializing"),
      operationalFormat: text("operational_format")
        .notNull()
        .default("myownnotion.page-operations+loro"),
      operationalVersion: integer("operational_version").notNull().default(1),
      currentCheckpointId: uuid("current_checkpoint_id"),
      currentFrontierEnvelopeId: uuid("current_frontier_envelope_id").references(
        () => deps.protectedEnvelopeId,
      ),
      operationalDigest: text("operational_digest"),
      canonicalDigest: text("canonical_digest").notNull(),
      canonicalFormatVersion: integer("canonical_format_version").notNull(),
      lastUpdateSequence: bigint("last_update_sequence", { mode: "number" }).notNull().default(0),
      lastRevisionId: uuid("last_revision_id").references(() => deps.revisionId),
      revisionWindowStartedAt: timestamp("revision_window_started_at", { withTimezone: true }),
      revisionWindowLastUpdateAt: timestamp("revision_window_last_update_at", {
        withTimezone: true,
      }),
      revisionWindowFrontierEnvelopeId: uuid("revision_window_frontier_envelope_id").references(
        () => deps.protectedEnvelopeId,
      ),
      bootstrappedAt: timestamp("bootstrapped_at", { withTimezone: true }),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("page_operation_states_page_workspace_unique").on(
        table.pageId,
        table.workspaceId,
      ),
      index("page_operation_states_workspace_status_idx").on(table.workspaceId, table.status),
      foreignKey({
        name: "page_operation_states_item_workspace_fk",
        columns: [table.pageId, table.workspaceId],
        foreignColumns: [deps.itemId, deps.itemWorkspaceId],
      }),
      check(
        "page_operation_states_status_check",
        sql`${table.status} IN ('legacy', 'initializing', 'active', 'blocked')`,
      ),
      check(
        "page_operation_states_format_check",
        sql`${table.operationalFormat} = 'myownnotion.page-operations+loro'`,
      ),
      check("page_operation_states_version_check", sql`${table.operationalVersion} >= 1`),
      check(
        "page_operation_states_canonical_version_check",
        sql`${table.canonicalFormatVersion} IN (2, 3)`,
      ),
      check("page_operation_states_sequence_check", sql`${table.lastUpdateSequence} >= 0`),
    ],
  );

  const pageOperationUpdates = pgTable(
    "page_operation_updates",
    {
      id: uuid("id").primaryKey(),
      pageId: uuid("page_id").notNull(),
      workspaceId: uuid("workspace_id").notNull(),
      pageSequence: bigint("page_sequence", { mode: "number" }).notNull(),
      authoredByDeviceId: uuid("authored_by_device_id")
        .notNull()
        .references(() => deps.deviceId),
      baseFrontierEnvelopeId: uuid("base_frontier_envelope_id").references(
        () => deps.protectedEnvelopeId,
      ),
      resultFrontierEnvelopeId: uuid("result_frontier_envelope_id")
        .notNull()
        .references(() => deps.protectedEnvelopeId),
      updateEnvelopeId: uuid("update_envelope_id").references(() => deps.protectedEnvelopeId),
      updateDigest: text("update_digest").notNull(),
      status: text("status").notNull(),
      failureCode: text("failure_code"),
      acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
      compactedAt: timestamp("compacted_at", { withTimezone: true }),
    },
    (table) => [
      foreignKey({
        name: "page_operation_updates_state_fk",
        columns: [table.pageId, table.workspaceId],
        foreignColumns: [pageOperationStates.pageId, pageOperationStates.workspaceId],
      }),
      unique("page_operation_updates_sequence_unique").on(table.pageId, table.pageSequence),
      index("page_operation_updates_page_sequence_idx").on(table.pageId, table.pageSequence),
      index("page_operation_updates_workspace_device_idx").on(
        table.workspaceId,
        table.authoredByDeviceId,
        table.acceptedAt,
      ),
      check("page_operation_updates_sequence_check", sql`${table.pageSequence} >= 1`),
      check(
        "page_operation_updates_status_check",
        sql`${table.status} IN ('accepted', 'rejected')`,
      ),
      check(
        "page_operation_updates_compaction_check",
        sql`(
          (${table.compactedAt} IS NULL AND ${table.baseFrontierEnvelopeId} IS NOT NULL AND ${table.updateEnvelopeId} IS NOT NULL)
          OR
          (${table.compactedAt} IS NOT NULL AND ${table.status} = 'accepted' AND ${table.baseFrontierEnvelopeId} IS NULL AND ${table.updateEnvelopeId} IS NULL)
        )`,
      ),
    ],
  );

  const pageOperationCheckpoints = pgTable(
    "page_operation_checkpoints",
    {
      id: uuid("id").primaryKey(),
      pageId: uuid("page_id").notNull(),
      workspaceId: uuid("workspace_id").notNull(),
      throughPageSequence: bigint("through_page_sequence", { mode: "number" }).notNull(),
      frontierEnvelopeId: uuid("frontier_envelope_id")
        .notNull()
        .references(() => deps.protectedEnvelopeId),
      snapshotEnvelopeId: uuid("snapshot_envelope_id")
        .notNull()
        .references(() => deps.protectedEnvelopeId),
      snapshotDigest: text("snapshot_digest").notNull(),
      canonicalDigest: text("canonical_digest").notNull(),
      revisionId: uuid("revision_id").references(() => deps.revisionId),
      state: text("state").notNull().default("candidate"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      verifiedAt: timestamp("verified_at", { withTimezone: true }),
    },
    (table) => [
      foreignKey({
        name: "page_operation_checkpoints_state_fk",
        columns: [table.pageId, table.workspaceId],
        foreignColumns: [pageOperationStates.pageId, pageOperationStates.workspaceId],
      }),
      unique("page_operation_checkpoints_id_page_unique").on(table.id, table.pageId),
      unique("page_operation_checkpoints_page_sequence_unique").on(
        table.pageId,
        table.throughPageSequence,
      ),
      index("page_operation_checkpoints_page_state_idx").on(
        table.pageId,
        table.state,
        table.throughPageSequence,
      ),
      check("page_operation_checkpoints_sequence_check", sql`${table.throughPageSequence} >= 0`),
      check(
        "page_operation_checkpoints_state_check",
        sql`${table.state} IN ('candidate', 'verified', 'superseded', 'retained')`,
      ),
    ],
  );

  const pageDeviceFrontiers = pgTable(
    "page_device_frontiers",
    {
      pageId: uuid("page_id").notNull(),
      deviceId: uuid("device_id")
        .notNull()
        .references(() => deps.deviceId),
      workspaceId: uuid("workspace_id").notNull(),
      frontierEnvelopeId: uuid("frontier_envelope_id")
        .notNull()
        .references(() => deps.protectedEnvelopeId),
      frontierDigest: text("frontier_digest").notNull(),
      confirmedPageSequence: bigint("confirmed_page_sequence", { mode: "number" }).notNull(),
      recordVersion: integer("record_version").notNull().default(1),
      lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      deviceState: text("device_state").notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.pageId, table.deviceId] }),
      foreignKey({
        name: "page_device_frontiers_state_fk",
        columns: [table.pageId, table.workspaceId],
        foreignColumns: [pageOperationStates.pageId, pageOperationStates.workspaceId],
      }),
      index("page_device_frontiers_device_idx").on(table.deviceId, table.deviceState),
      check("page_device_frontiers_sequence_check", sql`${table.confirmedPageSequence} >= 0`),
      check("page_device_frontiers_record_version_check", sql`${table.recordVersion} >= 1`),
      check(
        "page_device_frontiers_device_state_check",
        sql`${table.deviceState} IN ('authorized', 'revoked')`,
      ),
    ],
  );

  const pageAmbiguities = pgTable(
    "page_ambiguities",
    {
      id: uuid("id").primaryKey(),
      pageId: uuid("page_id").notNull(),
      workspaceId: uuid("workspace_id").notNull(),
      logicalKey: text("logical_key").notNull(),
      kind: text("kind").notNull(),
      status: text("status").notNull().default("open"),
      detailsEnvelopeId: uuid("details_envelope_id")
        .notNull()
        .references(() => deps.protectedEnvelopeId),
      sourceUpdateIds: uuid("source_update_ids").array().notNull(),
      openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }),
      resolutionRevisionId: uuid("resolution_revision_id").references(() => deps.revisionId),
    },
    (table) => [
      foreignKey({
        name: "page_ambiguities_state_fk",
        columns: [table.pageId, table.workspaceId],
        foreignColumns: [pageOperationStates.pageId, pageOperationStates.workspaceId],
      }),
      unique("page_ambiguities_logical_unique").on(table.pageId, table.logicalKey),
      index("page_ambiguities_page_status_idx").on(table.pageId, table.status, table.openedAt),
      index("page_ambiguities_sources_idx").using("gin", table.sourceUpdateIds),
      check(
        "page_ambiguities_kind_check",
        sql`${table.kind} IN ('delete-edit', 'delete-move', 'type-transform', 'property-transform', 'schema')`,
      ),
      check(
        "page_ambiguities_status_check",
        sql`${table.status} IN ('open', 'resolved-keep', 'resolved-delete', 'resolved-custom')`,
      ),
    ],
  );

  const pageLegacyBranchConversions = pgTable(
    "page_legacy_branch_conversions",
    {
      branchId: uuid("branch_id").primaryKey(),
      pageId: uuid("page_id").notNull(),
      workspaceId: uuid("workspace_id").notNull(),
      requestDigest: text("request_digest").notNull(),
      status: text("status").notNull(),
      responseEnvelopeId: uuid("response_envelope_id").references(() => deps.protectedEnvelopeId),
      checkpointId: uuid("checkpoint_id").references(() => pageOperationCheckpoints.id),
      conversionUpdateIds: uuid("conversion_update_ids").array().notNull().default([]),
      localDocumentDigest: text("local_document_digest").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      convertedAt: timestamp("converted_at", { withTimezone: true }),
    },
    (table) => [
      foreignKey({
        name: "page_legacy_branch_conversions_state_fk",
        columns: [table.pageId, table.workspaceId],
        foreignColumns: [pageOperationStates.pageId, pageOperationStates.workspaceId],
      }),
      index("page_legacy_branch_conversions_page_idx").on(table.pageId, table.status),
      check(
        "page_legacy_branch_conversions_status_check",
        sql`${table.status} IN ('sending', 'converted', 'blocked')`,
      ),
    ],
  );

  return {
    pageOperationStates,
    pageOperationUpdates,
    pageOperationCheckpoints,
    pageDeviceFrontiers,
    pageAmbiguities,
    pageLegacyBranchConversions,
  };
}
