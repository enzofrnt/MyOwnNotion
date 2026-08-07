/**
 * Monotonic workspace change sequence (T042, US6).
 *
 * Every accepted mutation receives a workspace-local `GENERATED ALWAYS AS
 * IDENTITY` sequence in addition to its causal revision IDs. Gaps are
 * harmless: ordering is what matters, and clients treat cursors as opaque.
 */
import { bigint, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { mutations, workspaces } from "./index.ts";

export const changes = pgTable(
  "changes",
  {
    sequence: bigint("sequence", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    mutationId: uuid("mutation_id")
      .notNull()
      .unique()
      .references(() => mutations.id),
    revisionIds: uuid("revision_ids").array().notNull().default([]),
    changedItemIds: uuid("changed_item_ids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("changes_workspace_idx").on(table.workspaceId, table.sequence)],
);
