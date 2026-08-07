/**
 * Transactional Dexie projection reads and writes (T039, US6).
 *
 * The projection mirrors server state under the same stable identities.
 * Applying server data (snapshot or change envelopes) is transactional so a
 * crash never leaves a half-applied projection.
 */
import type { ItemDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import {
  META_KEYS,
  parentKeyOf,
  type LocalDatabase,
  type LocalItemRow,
  type LocalPlacementRow,
} from "./schema.ts";

export interface ProjectedItem extends LocalItemRow {
  readonly placements: LocalPlacementRow[];
}

function itemRowFrom(dto: ItemDto): LocalItemRow {
  return {
    id: dto.id as Uuid,
    kind: dto.kind,
    name: dto.name,
    lifecycle: dto.lifecycle,
    currentRevisionId: dto.currentRevisionId as Uuid,
    trashedAt: dto.trashedAt ?? null,
    purgeAfter: dto.purgeAfter ?? null,
    pageDocument:
      dto.pageDocument == null
        ? null
        : {
            format: dto.pageDocument.format,
            formatVersion: dto.pageDocument.formatVersion,
            body: dto.pageDocument.body as Record<string, unknown>,
          },
    file: null,
  };
}

function placementRowsFrom(dto: ItemDto): LocalPlacementRow[] {
  return dto.placements.map((placement) => ({
    id: placement.id as Uuid,
    itemId: placement.itemId as Uuid,
    kind: placement.kind,
    parentItemId: (placement.parentItemId as Uuid | null) ?? null,
    parentKey: parentKeyOf((placement.parentItemId as Uuid | null) ?? null),
    positionKey: placement.positionKey,
  }));
}

export class LocalRepository {
  readonly db: LocalDatabase;

  constructor(db: LocalDatabase) {
    this.db = db;
  }

  /** Applies one server item state (and its placements) transactionally. */
  async applyServerItems(items: ReadonlyArray<ItemDto>): Promise<void> {
    await this.db.transaction("rw", [this.db.items, this.db.placements], async () => {
      for (const dto of items) {
        await this.db.items.put(itemRowFrom(dto));
        await this.db.placements.where("itemId").equals(dto.id).delete();
        const rows = placementRowsFrom(dto);
        if (rows.length > 0) {
          await this.db.placements.bulkPut(rows);
        }
      }
    });
  }

  /** Replaces the complete projection from a verified snapshot. */
  async replaceFromSnapshot(input: {
    workspaceId: Uuid;
    schemaVersion: number;
    cursor: string;
    items: ReadonlyArray<ItemDto>;
  }): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.items, this.db.placements, this.db.meta],
      async () => {
        await this.db.items.clear();
        await this.db.placements.clear();
        for (const dto of input.items) {
          await this.db.items.put(itemRowFrom(dto));
          const rows = placementRowsFrom(dto);
          if (rows.length > 0) {
            await this.db.placements.bulkPut(rows);
          }
        }
        await this.db.meta.bulkPut([
          { key: META_KEYS.workspaceId, value: input.workspaceId },
          { key: META_KEYS.schemaVersion, value: input.schemaVersion },
          { key: META_KEYS.lastChangeCursor, value: input.cursor },
        ]);
      },
    );
  }

  async getItem(itemId: Uuid): Promise<ProjectedItem | null> {
    return this.db.transaction("r", [this.db.items, this.db.placements], async () => {
      const item = await this.db.items.get(itemId);
      if (item === undefined) {
        return null;
      }
      const placements = await this.db.placements.where("itemId").equals(itemId).toArray();
      return { ...item, placements };
    });
  }

  async listItems(lifecycle?: LocalItemRow["lifecycle"]): Promise<ProjectedItem[]> {
    return this.db.transaction("r", [this.db.items, this.db.placements], async () => {
      const items =
        lifecycle === undefined
          ? await this.db.items.toArray()
          : await this.db.items.where("lifecycle").equals(lifecycle).toArray();
      const placements = await this.db.placements.toArray();
      const byItem = new Map<string, LocalPlacementRow[]>();
      for (const placement of placements) {
        const list = byItem.get(placement.itemId) ?? [];
        list.push(placement);
        byItem.set(placement.itemId, list);
      }
      return items.map((item) => ({ ...item, placements: byItem.get(item.id) ?? [] }));
    });
  }

  async listChildren(parentItemId: Uuid | null): Promise<ProjectedItem[]> {
    return this.db.transaction("r", [this.db.items, this.db.placements], async () => {
      const placements = await this.db.placements
        .where("[parentKey+kind]")
        .equals([parentKeyOf(parentItemId), "hierarchy"])
        .toArray();
      const result: ProjectedItem[] = [];
      for (const placement of placements.sort((a, b) =>
        a.positionKey < b.positionKey ? -1 : 1,
      )) {
        const item = await this.db.items.get(placement.itemId);
        if (item !== undefined && item.lifecycle === "active") {
          const itemPlacements = await this.db.placements
            .where("itemId")
            .equals(item.id)
            .toArray();
          result.push({ ...item, placements: itemPlacements });
        }
      }
      return result;
    });
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const row = await this.db.meta.get(key);
    return row === undefined ? null : (row.value as T);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  async getLastChangeCursor(): Promise<string> {
    return (await this.getMeta<string>(META_KEYS.lastChangeCursor)) ?? "";
  }
}
