/**
 * Transactional Dexie projection reads and writes (T039, US6).
 *
 * The projection mirrors server state under the same stable identities.
 * Applying server data (snapshot or change envelopes) is transactional so a
 * crash never leaves a half-applied projection.
 */
import type { ItemDto, RelationshipDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import {
  type LocalDatabase,
  type LocalItemRow,
  type LocalPlacementRow,
  type LocalRelationshipRow,
  META_KEYS,
  parentKeyOf,
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

function relationshipRowFrom(dto: RelationshipDto): LocalRelationshipRow {
  return {
    id: dto.id as Uuid,
    sourceItemId: dto.sourceItemId as Uuid,
    targetItemId: dto.targetItemId as Uuid,
    relationType: dto.relationType,
    metadata: (dto.metadata as Record<string, unknown> | undefined) ?? {},
  };
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
    relationships: ReadonlyArray<RelationshipDto>;
    preserveRelationshipSourceItemIds?: ReadonlyArray<Uuid>;
  }): Promise<void> {
    await this.db.transaction(
      "rw",
      [this.db.items, this.db.placements, this.db.relationships, this.db.meta],
      async () => {
        const preservedSources = new Set(input.preserveRelationshipSourceItemIds ?? []);
        const preservedItems =
          preservedSources.size === 0
            ? []
            : (await this.db.items.bulkGet([...preservedSources])).filter(
                (item): item is LocalItemRow => item !== undefined,
              );
        const preservedRelationships =
          preservedSources.size === 0
            ? []
            : await this.db.relationships
                .filter(
                  (relationship) =>
                    preservedSources.has(relationship.sourceItemId) &&
                    relationship.relationType === "link:references",
                )
                .toArray();
        await this.db.items.clear();
        await this.db.placements.clear();
        await this.db.relationships.clear();
        for (const dto of input.items) {
          await this.db.items.put(itemRowFrom(dto));
          const rows = placementRowsFrom(dto);
          if (rows.length > 0) {
            await this.db.placements.bulkPut(rows);
          }
        }
        if (input.relationships.length > 0) {
          await this.db.relationships.bulkPut(input.relationships.map(relationshipRowFrom));
        }
        if (preservedItems.length > 0) {
          await this.db.items.bulkPut(preservedItems);
        }
        if (preservedRelationships.length > 0) {
          const replacedSnapshotRows = await this.db.relationships
            .filter(
              (relationship) =>
                preservedSources.has(relationship.sourceItemId) &&
                relationship.relationType === "link:references",
            )
            .primaryKeys();
          await this.db.relationships.bulkDelete(replacedSnapshotRows as Uuid[]);
          await this.db.relationships.bulkPut(preservedRelationships);
        }
        await this.db.meta.bulkPut([
          { key: META_KEYS.workspaceId, value: input.workspaceId },
          { key: META_KEYS.schemaVersion, value: input.schemaVersion },
          { key: META_KEYS.lastChangeCursor, value: input.cursor },
        ]);
      },
    );
  }

  /**
   * Replaces only document-derived wiki links for the listed source pages.
   * Explicit relationship types and unrelated sources remain untouched.
   */
  async replaceDerivedWikiRelationships(
    sourceItemIds: ReadonlyArray<Uuid>,
    relationships: ReadonlyArray<RelationshipDto>,
  ): Promise<void> {
    if (sourceItemIds.length === 0) {
      return;
    }
    const sources = new Set<string>(sourceItemIds);
    await this.db.transaction("rw", this.db.relationships, async () => {
      const existing = await this.db.relationships
        .filter(
          (relationship) =>
            sources.has(relationship.sourceItemId) &&
            relationship.relationType === "link:references",
        )
        .primaryKeys();
      await this.db.relationships.bulkDelete(existing as Uuid[]);
      const rows = relationships
        .filter(
          (relationship) =>
            sources.has(relationship.sourceItemId) &&
            relationship.relationType === "link:references",
        )
        .map(relationshipRowFrom);
      if (rows.length > 0) {
        await this.db.relationships.bulkPut(rows);
      }
    });
  }

  async listRelationships(itemId?: Uuid): Promise<LocalRelationshipRow[]> {
    if (itemId === undefined) {
      return this.db.relationships.toArray();
    }
    return this.db.relationships
      .filter(
        (relationship) =>
          relationship.sourceItemId === itemId || relationship.targetItemId === itemId,
      )
      .toArray();
  }

  async readKnowledgeData(): Promise<{
    readonly items: LocalItemRow[];
    readonly relationships: LocalRelationshipRow[];
  }> {
    return this.db.transaction("r", [this.db.items, this.db.relationships], async () => ({
      items: await this.db.items.toArray(),
      relationships: await this.db.relationships.toArray(),
    }));
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
      for (const placement of placements.sort((a, b) => (a.positionKey < b.positionKey ? -1 : 1))) {
        const item = await this.db.items.get(placement.itemId);
        if (item !== undefined && item.lifecycle === "active") {
          const itemPlacements = await this.db.placements.where("itemId").equals(item.id).toArray();
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
