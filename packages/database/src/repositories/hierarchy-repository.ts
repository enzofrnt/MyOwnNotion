/**
 * Transactional hierarchy reads and recursive integrity checks (T029, US1).
 *
 * All lookups run through the Drizzle query builder. The only SQL here is
 * the recursive CTE pair (descendant collection and ancestor walk): cycle
 * checks over an adjacency list genuinely require `WITH RECURSIVE`.
 */

import type { CanonicalItem, HierarchyView, Placement, Uuid } from "@myownnotion/domain";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import { items, placements } from "../schema/index.ts";

type ItemRow = typeof items.$inferSelect;
type PlacementRow = typeof placements.$inferSelect;

export function toCanonicalItem(row: ItemRow): CanonicalItem {
  return {
    id: row.id as Uuid,
    workspaceId: row.workspaceId as Uuid,
    kind: row.kind as CanonicalItem["kind"],
    name: row.name,
    lifecycle: row.lifecycle as CanonicalItem["lifecycle"],
    trashedAt: row.trashedAt?.toISOString() ?? null,
    purgeAfter: row.purgeAfter?.toISOString() ?? null,
    currentRevisionId: row.currentRevisionId as Uuid,
  };
}

export function toPlacement(row: PlacementRow): Placement {
  return {
    id: row.id as Uuid,
    workspaceId: row.workspaceId as Uuid,
    itemId: row.itemId as Uuid,
    itemIsFile: row.itemIsFile,
    kind: row.kind as Placement["kind"],
    parentItemId: (row.parentItemId as Uuid | null) ?? null,
    positionKey: row.positionKey,
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}

export async function getItem(tx: Transaction, itemId: Uuid): Promise<CanonicalItem | null> {
  const rows = await tx.select().from(items).where(eq(items.id, itemId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toCanonicalItem(row);
}

export async function getPlacement(tx: Transaction, placementId: Uuid): Promise<Placement | null> {
  const rows = await tx.select().from(placements).where(eq(placements.id, placementId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toPlacement(row);
}

export async function getActivePlacements(tx: Transaction, itemId: Uuid): Promise<Placement[]> {
  const rows = await tx
    .select()
    .from(placements)
    .where(and(eq(placements.itemId, itemId), isNull(placements.removedAt)))
    .orderBy(asc(placements.positionKey), asc(placements.id));
  return rows.map(toPlacement);
}

export async function getActiveChildren(
  tx: Transaction,
  parentItemId: Uuid | null,
): Promise<Placement[]> {
  const parentCondition =
    parentItemId === null
      ? isNull(placements.parentItemId)
      : eq(placements.parentItemId, parentItemId);
  const rows = await tx
    .select()
    .from(placements)
    .where(and(parentCondition, eq(placements.kind, "hierarchy"), isNull(placements.removedAt)))
    .orderBy(asc(placements.positionKey), asc(placements.id));
  return rows.map(toPlacement);
}

export async function getAttachments(tx: Transaction, pageItemId: Uuid): Promise<Placement[]> {
  const rows = await tx
    .select()
    .from(placements)
    .where(
      and(
        eq(placements.parentItemId, pageItemId),
        eq(placements.kind, "attachment"),
        isNull(placements.removedAt),
      ),
    )
    .orderBy(asc(placements.positionKey), asc(placements.id));
  return rows.map(toPlacement);
}

/**
 * Collects the complete active hierarchy branch under `rootItemId`
 * (inclusive) with one recursive query — required use of SQL: adjacency-list
 * traversal cannot be expressed through the query builder.
 */
export async function collectBranchItemIds(tx: Transaction, rootItemId: Uuid): Promise<Uuid[]> {
  const result = await tx.execute(sql`
    WITH RECURSIVE branch (item_id) AS (
      SELECT ${rootItemId}::uuid
      UNION
      SELECT p.item_id
      FROM placements p
      JOIN branch b ON p.parent_item_id = b.item_id
      WHERE p.kind = 'hierarchy' AND p.removed_at IS NULL
    )
    SELECT item_id FROM branch
  `);
  return result.rows.map((row) => (row as { item_id: string }).item_id as Uuid);
}

/**
 * Authoritative transactional cycle check (recursive ancestor walk): true
 * when `candidateAncestorId` is `itemId` itself or one of its descendants,
 * i.e. re-parenting `itemId` beneath it would create a cycle.
 */
export async function wouldCreateCycleSql(
  tx: Transaction,
  itemId: Uuid,
  candidateParentId: Uuid,
): Promise<boolean> {
  const result = await tx.execute(sql`
    WITH RECURSIVE ancestors (item_id) AS (
      SELECT ${candidateParentId}::uuid
      UNION
      SELECT p.parent_item_id
      FROM placements p
      JOIN ancestors a ON p.item_id = a.item_id
      WHERE p.kind = 'hierarchy' AND p.removed_at IS NULL AND p.parent_item_id IS NOT NULL
    )
    SELECT 1 AS hit FROM ancestors WHERE item_id = ${itemId}::uuid LIMIT 1
  `);
  return result.rows.length > 0;
}

/**
 * Domain view over the current transaction. Lookups are pre-loaded because
 * the domain interface is synchronous by design (it also runs in browsers).
 */
export async function loadHierarchyView(
  tx: Transaction,
  seedItemIds: ReadonlyArray<Uuid>,
): Promise<HierarchyView> {
  const itemCache = new Map<string, CanonicalItem | null>();
  const placementCache = new Map<string, Placement[]>();
  const childrenCache = new Map<string, Placement[]>();

  for (const id of seedItemIds) {
    if (!itemCache.has(id)) {
      itemCache.set(id, await getItem(tx, id));
      placementCache.set(id, await getActivePlacements(tx, id));
    }
  }

  return {
    getItem: (id) => itemCache.get(id) ?? null,
    getActivePlacements: (itemId) => placementCache.get(itemId) ?? [],
    getActiveChildren: (parentItemId) => childrenCache.get(parentItemId ?? "root") ?? [],
  };
}

/**
 * Eager view loader used by branch-scale operations (trash, restore): loads
 * every item and active placement of a branch so domain planning sees a
 * complete consistent snapshot inside the transaction.
 */
export async function loadBranchView(
  tx: Transaction,
  rootItemId: Uuid,
  extraItemIds: ReadonlyArray<Uuid> = [],
): Promise<{ view: HierarchyView; branchItemIds: Uuid[] }> {
  const branchItemIds = await collectBranchItemIds(tx, rootItemId);
  const itemCache = new Map<string, CanonicalItem | null>();
  const placementCache = new Map<string, Placement[]>();
  const childrenCache = new Map<string, Placement[]>();

  for (const id of [...branchItemIds, ...extraItemIds]) {
    if (itemCache.has(id)) {
      continue;
    }
    itemCache.set(id, await getItem(tx, id));
    const active = await getActivePlacements(tx, id);
    placementCache.set(id, active);
  }
  for (const id of branchItemIds) {
    childrenCache.set(id, await getActiveChildren(tx, id));
  }

  const view: HierarchyView = {
    getItem: (id) => itemCache.get(id) ?? null,
    getActivePlacements: (itemId) => placementCache.get(itemId) ?? [],
    getActiveChildren: (parentItemId) => childrenCache.get(parentItemId ?? "root") ?? [],
  };
  return { view, branchItemIds };
}
