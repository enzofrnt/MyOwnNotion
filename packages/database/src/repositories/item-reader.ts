/**
 * Read-model assembly for API responses: canonical item plus its active
 * placements, page document, and file metadata, in the shape of the
 * OpenAPI `Item` schema.
 */

import type { Uuid } from "@myownnotion/domain";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import { items, logicalFiles, pageDocuments, placements } from "../schema/index.ts";

export interface ItemReadModel {
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
    readonly mediaType: string;
    readonly originalName: string;
    readonly byteLength: number;
  } | null;
  readonly placements: ReadonlyArray<{
    readonly id: Uuid;
    readonly itemId: Uuid;
    readonly kind: "hierarchy" | "attachment";
    readonly parentItemId: Uuid | null;
    readonly positionKey: string;
  }>;
}

type Executor = Database | Transaction;

export async function readItems(
  executor: Executor,
  itemIds: ReadonlyArray<Uuid>,
): Promise<ItemReadModel[]> {
  if (itemIds.length === 0) {
    return [];
  }
  const itemRows = await executor
    .select()
    .from(items)
    .where(inArray(items.id, itemIds as Uuid[]));
  const placementRows = await executor
    .select()
    .from(placements)
    .where(and(inArray(placements.itemId, itemIds as Uuid[]), isNull(placements.removedAt)))
    .orderBy(asc(placements.positionKey), asc(placements.id));
  const pageIds = itemRows.filter((row) => row.kind === "page").map((row) => row.id);
  const documentRows =
    pageIds.length === 0
      ? []
      : await executor.select().from(pageDocuments).where(inArray(pageDocuments.pageId, pageIds));
  const fileIds = itemRows.filter((row) => row.kind === "file").map((row) => row.id);
  const fileRows =
    fileIds.length === 0
      ? []
      : await executor.select().from(logicalFiles).where(inArray(logicalFiles.itemId, fileIds));

  const documentsByPage = new Map(documentRows.map((row) => [row.pageId, row]));
  const filesByItem = new Map(fileRows.map((row) => [row.itemId, row]));
  const placementsByItem = new Map<string, typeof placementRows>();
  for (const placement of placementRows) {
    const list = placementsByItem.get(placement.itemId) ?? [];
    list.push(placement);
    placementsByItem.set(placement.itemId, list);
  }

  return itemRows.map((row) => {
    const document = documentsByPage.get(row.id);
    const file = filesByItem.get(row.id);
    return {
      id: row.id as Uuid,
      kind: row.kind as ItemReadModel["kind"],
      name: row.name,
      lifecycle: row.lifecycle as ItemReadModel["lifecycle"],
      currentRevisionId: row.currentRevisionId as Uuid,
      trashedAt: row.trashedAt?.toISOString() ?? null,
      purgeAfter: row.purgeAfter?.toISOString() ?? null,
      pageDocument:
        row.kind === "page"
          ? document === undefined
            ? { format: "myownnotion.document+json", formatVersion: 1, body: {} }
            : {
                format: document.format as "myownnotion.document+json",
                formatVersion: document.formatVersion,
                body: document.body as Record<string, unknown>,
              }
          : null,
      file:
        file === undefined
          ? null
          : {
              mediaType: file.mediaType,
              originalName: file.originalName,
              byteLength: file.byteLength,
            },
      placements: (placementsByItem.get(row.id) ?? []).map((placement) => ({
        id: placement.id as Uuid,
        itemId: placement.itemId as Uuid,
        kind: placement.kind as "hierarchy" | "attachment",
        parentItemId: (placement.parentItemId as Uuid | null) ?? null,
        positionKey: placement.positionKey,
      })),
    };
  });
}

export async function readItem(executor: Executor, itemId: Uuid): Promise<ItemReadModel | null> {
  const models = await readItems(executor, [itemId]);
  return models[0] ?? null;
}

/** Lists items by lifecycle and/or active hierarchy parent. */
export async function listItems(
  executor: Executor,
  workspaceId: Uuid,
  filter: {
    readonly parentItemId?: Uuid | null;
    readonly lifecycle?: "active" | "trashed" | "purged";
  },
): Promise<ItemReadModel[]> {
  if (filter.parentItemId !== undefined) {
    const parentCondition =
      filter.parentItemId === null
        ? isNull(placements.parentItemId)
        : eq(placements.parentItemId, filter.parentItemId);
    const childPlacements = await executor
      .select({ itemId: placements.itemId })
      .from(placements)
      .where(and(parentCondition, eq(placements.kind, "hierarchy"), isNull(placements.removedAt)));
    const ids = [...new Set(childPlacements.map((row) => row.itemId as Uuid))];
    const models = await readItems(executor, ids);
    const filtered =
      filter.lifecycle === undefined
        ? models.filter((model) => model.lifecycle === "active")
        : models.filter((model) => model.lifecycle === filter.lifecycle);
    return filtered;
  }

  const conditions = [eq(items.workspaceId, workspaceId)];
  if (filter.lifecycle !== undefined) {
    conditions.push(eq(items.lifecycle, filter.lifecycle));
  }
  const rows = await executor
    .select({ id: items.id })
    .from(items)
    .where(and(...conditions));
  return readItems(
    executor,
    rows.map((row) => row.id as Uuid),
  );
}

/**
 * Reads just an item's name, from any executor.
 *
 * Exists so the encryption layer can seal a title from inside the mutation's
 * own transaction, where the full `readItem` — which fans out to placements,
 * documents and files — would be far more work than the one column it needs.
 */
export async function readItemName(
  executor: Parameters<typeof readItems>[0],
  itemId: string,
): Promise<string | null> {
  const rows = await executor
    .select({ name: items.name })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  return rows[0]?.name ?? null;
}
