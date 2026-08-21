/**
 * Canonical read side for the transient search projection.
 *
 * Payloads are returned exactly as stored. The API protection layer opens the
 * encrypted name and page body before they enter an in-memory index; keeping
 * decryption out of this package preserves the existing security boundary.
 */

import type { ItemKind, Uuid } from "@myownnotion/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import { databaseEntries, databases, items, pageDocuments } from "../schema/index.ts";

type Executor = Database | Transaction;

export interface SearchSourceRecord {
  readonly itemId: Uuid;
  readonly revisionId: Uuid;
  readonly kind: ItemKind;
  readonly storedName: string;
  readonly pageDocument: {
    readonly format: "myownnotion.document+json";
    readonly formatVersion: number;
    readonly body: Readonly<Record<string, unknown>>;
  } | null;
  readonly databaseEntry?: {
    readonly databaseId: Uuid;
    readonly definitionVersion: number;
    readonly valueVersion: number;
  } | null;
}

export interface StoredSearchPathSegment {
  readonly itemId: Uuid;
  readonly storedName: string;
}

type SearchSourceRow = {
  readonly itemId: string;
  readonly revisionId: string;
  readonly kind: string;
  readonly storedName: string;
  readonly documentFormat: string | null;
  readonly documentFormatVersion: number | null;
  readonly documentBody: unknown;
  readonly databaseId: string | null;
  readonly definitionVersion: number | null;
  readonly valueVersion: number | null;
};

function mapSearchSource(row: SearchSourceRow): SearchSourceRecord {
  return {
    itemId: row.itemId as Uuid,
    revisionId: row.revisionId as Uuid,
    kind: row.kind as ItemKind,
    storedName: row.storedName,
    pageDocument:
      row.kind !== "page" || row.documentFormat === null || row.documentFormatVersion === null
        ? null
        : {
            format: row.documentFormat as "myownnotion.document+json",
            formatVersion: row.documentFormatVersion,
            body: row.documentBody as Readonly<Record<string, unknown>>,
          },
    databaseEntry:
      row.databaseId === null || row.definitionVersion === null || row.valueVersion === null
        ? null
        : {
            databaseId: row.databaseId as Uuid,
            definitionVersion: row.definitionVersion,
            valueVersion: row.valueVersion,
          },
  };
}

const searchSourceSelection = {
  itemId: items.id,
  revisionId: items.currentRevisionId,
  kind: items.kind,
  storedName: items.name,
  documentFormat: pageDocuments.format,
  documentFormatVersion: pageDocuments.formatVersion,
  documentBody: pageDocuments.body,
  databaseId: databaseEntries.databaseId,
  definitionVersion: databases.definitionVersion,
  valueVersion: databaseEntries.valueVersion,
};

/** Reads every active item in a stable order for an atomic index build. */
export async function listSearchSources(
  executor: Executor,
  workspaceId: Uuid,
): Promise<SearchSourceRecord[]> {
  const rows = await executor
    .select(searchSourceSelection)
    .from(items)
    .leftJoin(pageDocuments, eq(pageDocuments.pageId, items.id))
    .leftJoin(databaseEntries, eq(databaseEntries.entryItemId, items.id))
    .leftJoin(databases, eq(databases.itemId, databaseEntries.databaseId))
    .where(and(eq(items.workspaceId, workspaceId), eq(items.lifecycle, "active")))
    .orderBy(asc(items.id));

  return rows.map(mapSearchSource);
}

/** Reads the current active subset touched by one or more committed changes. */
export async function readSearchSources(
  executor: Executor,
  workspaceId: Uuid,
  itemIds: readonly Uuid[],
): Promise<SearchSourceRecord[]> {
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return [];
  }
  const dependentRows = await executor
    .select({ entryId: databaseEntries.entryItemId })
    .from(databaseEntries)
    .where(
      and(
        eq(databaseEntries.workspaceId, workspaceId),
        inArray(databaseEntries.databaseId, uniqueItemIds),
      ),
    );
  const expandedItemIds = [
    ...new Set([...uniqueItemIds, ...dependentRows.map(({ entryId }) => entryId as Uuid)]),
  ];
  const rows = await executor
    .select(searchSourceSelection)
    .from(items)
    .leftJoin(pageDocuments, eq(pageDocuments.pageId, items.id))
    .leftJoin(databaseEntries, eq(databaseEntries.entryItemId, items.id))
    .leftJoin(databases, eq(databases.itemId, databaseEntries.databaseId))
    .where(
      and(
        eq(items.workspaceId, workspaceId),
        eq(items.lifecycle, "active"),
        inArray(items.id, expandedItemIds),
      ),
    )
    .orderBy(asc(items.id));

  return rows.map(mapSearchSource);
}

/** Includes an active root and its active hierarchy descendants only. */
export async function activeDescendantIds(executor: Executor, rootItemId: Uuid): Promise<Uuid[]> {
  const result = await executor.execute(sql`
    WITH RECURSIVE branch (item_id) AS (
      SELECT i.id
      FROM items i
      WHERE i.id = ${rootItemId}::uuid AND i.lifecycle = 'active'

      UNION

      SELECT child.id
      FROM branch b
      JOIN placements p
        ON p.parent_item_id = b.item_id
       AND p.kind = 'hierarchy'
       AND p.removed_at IS NULL
      JOIN items child
        ON child.id = p.item_id
       AND child.lifecycle = 'active'
    )
    SELECT item_id FROM branch ORDER BY item_id
  `);
  return result.rows.map((row) => (row as { item_id: string }).item_id as Uuid);
}

/**
 * Hydrates current root-to-item paths without putting paths into the index.
 *
 * Files may have several placements. A hierarchy placement wins over an
 * attachment, then position and placement identity provide a stable choice;
 * the result remains one canonical search identity.
 */
export async function hydrateSearchPaths(
  executor: Executor,
  itemIds: readonly Uuid[],
): Promise<Map<Uuid, StoredSearchPathSegment[]>> {
  const paths = new Map<Uuid, StoredSearchPathSegment[]>();
  for (const targetItemId of [...new Set(itemIds)]) {
    const result = await executor.execute(sql`
      WITH RECURSIVE lineage (item_id, stored_name, parent_item_id, depth) AS (
        SELECT i.id, i.name, chosen.parent_item_id, 0
        FROM items i
        LEFT JOIN LATERAL (
          SELECT p.parent_item_id
          FROM placements p
          WHERE p.item_id = i.id AND p.removed_at IS NULL
          ORDER BY
            CASE WHEN p.kind = 'hierarchy' THEN 0 ELSE 1 END,
            p.position_key,
            p.id
          LIMIT 1
        ) chosen ON true
        WHERE i.id = ${targetItemId}::uuid AND i.lifecycle = 'active'

        UNION ALL

        SELECT parent.id, parent.name, chosen.parent_item_id, lineage.depth + 1
        FROM lineage
        JOIN items parent
          ON parent.id = lineage.parent_item_id
         AND parent.lifecycle = 'active'
        LEFT JOIN LATERAL (
          SELECT p.parent_item_id
          FROM placements p
          WHERE p.item_id = parent.id
            AND p.kind = 'hierarchy'
            AND p.removed_at IS NULL
          ORDER BY p.position_key, p.id
          LIMIT 1
        ) chosen ON true
      )
      SELECT item_id, stored_name, depth
      FROM lineage
      ORDER BY depth DESC
    `);
    paths.set(
      targetItemId,
      result.rows.map((row) => ({
        itemId: (row as { item_id: string }).item_id as Uuid,
        storedName: (row as { stored_name: string }).stored_name,
      })),
    );
  }
  return paths;
}
