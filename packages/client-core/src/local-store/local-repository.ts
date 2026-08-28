/**
 * Transactional Dexie projection reads and writes (T039, US6; sealed in T121).
 *
 * The projection mirrors server state under the same stable identities.
 * Applying server data (snapshot or change envelopes) is transactional so a
 * crash never leaves a half-applied projection.
 *
 * **Sealing happens outside the transaction, and it has to.** The codec is
 * asynchronous because WebCrypto is, and Dexie commits a transaction as soon
 * as control returns to the event loop for anything that is not a Dexie
 * promise. Sealing inside one does not fail loudly — it closes the transaction
 * early and the writes that follow land outside it, which is the atomicity
 * this file exists to provide, silently gone.
 *
 * So every method here has the same shape: do the crypto, then open a
 * transaction and do only Dexie work inside it. Reads are the mirror image —
 * fetch under a transaction, open the rows after it.
 */
import type {
  DatabaseEntryProjectionDto,
  DatabaseProjectionDto,
  ItemDto,
  RelationshipDto,
} from "@myownnotion/contracts";
import type { BlockDocumentV3, DatabaseDefinition, EntryValues, Uuid } from "@myownnotion/domain";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";
import {
  type LocalDatabase,
  type LocalDatabaseEntryRow,
  type LocalDatabaseRow,
  type LocalItemRow,
  type LocalPlacementRow,
  type LocalRelationshipRow,
  META_KEYS,
  parentKeyOf,
  type SealedLocalItemRow,
} from "./schema.ts";

export interface ProjectedItem extends LocalItemRow {
  readonly placements: LocalPlacementRow[];
}

function itemRowFrom(dto: ItemDto): LocalItemRow {
  return {
    id: dto.id as Uuid,
    kind: dto.kind,
    name: dto.name,
    icon: dto.icon ?? null,
    lifecycle: dto.lifecycle,
    currentRevisionId: dto.currentRevisionId as Uuid,
    trashedAt: dto.trashedAt ?? null,
    purgeAfter: dto.purgeAfter ?? null,
    favourite: dto.favourite ?? false,
    offlineIntent: dto.offlineIntent ?? false,
    // Arriving in a snapshot means the server sent it, so this device now has
    // whatever the snapshot carried. Content fetched lazily later is what moves
    // to the other two states.
    localAvailability: "present",
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
    metadata: (dto.metadata ?? {}) as Record<string, unknown>,
  };
}

function databaseRowFrom(dto: DatabaseProjectionDto): LocalDatabaseRow {
  return {
    itemId: dto.itemId as Uuid,
    definitionVersion: dto.definitionVersion,
    definition: dto.definition as unknown as DatabaseDefinition,
  };
}

function databaseEntryRowFrom(dto: DatabaseEntryProjectionDto): LocalDatabaseEntryRow {
  return {
    entryItemId: dto.entryItemId as Uuid,
    databaseId: dto.databaseId as Uuid,
    valueVersion: dto.valueVersion,
    availability: "present",
    values: dto.values as unknown as EntryValues,
  };
}

export class LocalRepository {
  readonly db: LocalDatabase;
  readonly #codec: LocalRecordCodec;

  constructor(db: LocalDatabase, codec: LocalRecordCodec) {
    this.db = db;
    this.#codec = codec;
  }

  /** Seals a batch before any transaction is open. */
  async #sealAll(items: ReadonlyArray<ItemDto>): Promise<SealedLocalItemRow[]> {
    const sealed: SealedLocalItemRow[] = [];
    for (const dto of items) {
      sealed.push((await this.#codec.sealItem(itemRowFrom(dto))) as SealedLocalItemRow);
    }
    return sealed;
  }

  /** Opens rows after the transaction that fetched them has closed. */
  async #openAll(
    rows: ReadonlyArray<{ row: SealedLocalItemRow; placements: LocalPlacementRow[] }>,
  ): Promise<ProjectedItem[]> {
    const opened: ProjectedItem[] = [];
    for (const entry of rows) {
      const item = await this.#codec.openItem(entry.row);
      opened.push({ ...item, placements: entry.placements });
    }
    return opened;
  }

  /** Applies one server item state (and its placements) transactionally. */
  async applyServerItems(items: ReadonlyArray<ItemDto>): Promise<void> {
    const sealed = await this.#sealAll(items);
    await this.db.transaction("rw", [this.db.items, this.db.placements], async () => {
      for (const [index, dto] of items.entries()) {
        const row = sealed[index];
        if (row === undefined) {
          continue;
        }
        await this.db.items.put(row);
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
    relationships?: ReadonlyArray<RelationshipDto>;
    databases?: ReadonlyArray<DatabaseProjectionDto>;
    databaseEntries?: ReadonlyArray<DatabaseEntryProjectionDto>;
  }): Promise<void> {
    const sealed = await this.#sealAll(input.items);
    const relationshipRows = (input.relationships ?? []).map(relationshipRowFrom);
    const retainedItemIds = new Set(
      input.items.filter(({ lifecycle }) => lifecycle !== "purged").map(({ id }) => id),
    );
    const databaseRows = await Promise.all(
      (input.databases ?? [])
        .filter(({ itemId }) => retainedItemIds.has(itemId))
        .map((dto) => this.#codec.sealDatabase(databaseRowFrom(dto))),
    );
    const databaseEntryRows = await Promise.all(
      (input.databaseEntries ?? [])
        .filter(
          ({ entryItemId, databaseId }) =>
            retainedItemIds.has(entryItemId) && retainedItemIds.has(databaseId),
        )
        .map((dto) => this.#codec.sealDatabaseEntry(databaseEntryRowFrom(dto))),
    );
    await this.db.transaction(
      "rw",
      [
        this.db.items,
        this.db.placements,
        this.db.relationships,
        this.db.databases,
        this.db.databaseEntries,
        this.db.meta,
      ],
      async () => {
        await this.db.items.clear();
        await this.db.placements.clear();
        await this.db.relationships.clear();
        await this.db.databases.clear();
        await this.db.databaseEntries.clear();
        for (const [index, dto] of input.items.entries()) {
          const row = sealed[index];
          if (row !== undefined) {
            await this.db.items.put(row);
          }
          const rows = placementRowsFrom(dto);
          if (rows.length > 0) {
            await this.db.placements.bulkPut(rows);
          }
        }
        if (relationshipRows.length > 0) {
          await this.db.relationships.bulkPut(relationshipRows);
        }
        if (databaseRows.length > 0) await this.db.databases.bulkPut(databaseRows);
        if (databaseEntryRows.length > 0) {
          await this.db.databaseEntries.bulkPut(databaseEntryRows);
        }
        await this.db.meta.bulkPut([
          { key: META_KEYS.workspaceId, value: input.workspaceId },
          { key: META_KEYS.schemaVersion, value: input.schemaVersion },
          { key: META_KEYS.lastChangeCursor, value: input.cursor },
        ]);
      },
    );
  }

  /** Applies one change envelope and advances its cursor in the same transaction. */
  async applyServerChange(input: {
    readonly cursor: string;
    readonly items: ReadonlyArray<ItemDto>;
    readonly relationships?: ReadonlyArray<RelationshipDto>;
    readonly databases?: ReadonlyArray<DatabaseProjectionDto>;
    readonly databaseEntries?: ReadonlyArray<DatabaseEntryProjectionDto>;
  }): Promise<void> {
    const sealedItems = await this.#sealAll(input.items);
    const relationshipRows = (input.relationships ?? []).map(relationshipRowFrom);
    const purgedItemIds = new Set(
      input.items.filter(({ lifecycle }) => lifecycle === "purged").map(({ id }) => id),
    );
    const databaseRows = await Promise.all(
      (input.databases ?? [])
        .filter(({ itemId }) => !purgedItemIds.has(itemId))
        .map((dto) => this.#codec.sealDatabase(databaseRowFrom(dto))),
    );
    const databaseEntryRows = await Promise.all(
      (input.databaseEntries ?? [])
        .filter(
          ({ entryItemId, databaseId }) =>
            !purgedItemIds.has(entryItemId) && !purgedItemIds.has(databaseId),
        )
        .map((dto) => this.#codec.sealDatabaseEntry(databaseEntryRowFrom(dto))),
    );
    const changedItemIds = new Set(input.items.map(({ id }) => id));
    await this.db.transaction(
      "rw",
      [
        this.db.items,
        this.db.placements,
        this.db.relationships,
        this.db.databases,
        this.db.databaseEntries,
        this.db.meta,
      ],
      async () => {
        for (const [index, dto] of input.items.entries()) {
          const row = sealedItems[index];
          if (row !== undefined) await this.db.items.put(row);
          await this.db.placements.where("itemId").equals(dto.id).delete();
          const placements = placementRowsFrom(dto);
          if (placements.length > 0) await this.db.placements.bulkPut(placements);
          // A source revision owns its complete active outgoing relationship
          // set. Clearing before putting the envelope also transports removals.
          await this.db.relationships.where("sourceItemId").equals(dto.id).delete();
          if (dto.lifecycle === "purged") {
            const itemId = dto.id as Uuid;
            // The tombstone is canonical; structured rows are only derived
            // projections. Keep the item identity unavailable, but remove its
            // definition/membership/value material immediately. A purged host
            // also invalidates every retained membership keyed to that base.
            await this.db.databases.delete(itemId);
            await this.db.databaseEntries.delete(itemId);
            await this.db.databaseEntries.where("databaseId").equals(itemId).delete();
          }
        }
        const relevantRelationships = relationshipRows.filter(({ sourceItemId }) =>
          changedItemIds.has(sourceItemId),
        );
        if (relevantRelationships.length > 0) {
          await this.db.relationships.bulkPut(relevantRelationships);
        }
        if (databaseRows.length > 0) await this.db.databases.bulkPut(databaseRows);
        if (databaseEntryRows.length > 0) {
          await this.db.databaseEntries.bulkPut(databaseEntryRows);
        }
        await this.db.meta.put({ key: META_KEYS.lastChangeCursor, value: input.cursor });
      },
    );
  }

  async getItem(itemId: Uuid): Promise<ProjectedItem | null> {
    const fetched = await this.db.transaction(
      "r",
      [this.db.items, this.db.placements],
      async () => {
        const item = await this.db.items.get(itemId);
        if (item === undefined) {
          return null;
        }
        const placements = await this.db.placements.where("itemId").equals(itemId).toArray();
        return { row: item, placements };
      },
    );
    if (fetched === null) {
      return null;
    }
    return (await this.#openAll([fetched]))[0] ?? null;
  }

  /**
   * Restores an offloaded page row from a verified operational projection.
   *
   * Sealing happens outside IndexedDB, so the item can change while WebCrypto
   * runs. The compare-and-swap prevents a late checkpoint from overwriting a
   * conversion (or another newer revision) with the stale page row it opened.
   * `false` means the item stopped being this page before the cache committed.
   */
  async cacheOperationalPageProjection(pageId: Uuid, document: BlockDocumentV3): Promise<boolean> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const row = await this.db.items.get(pageId);
      if (row === undefined || row.kind !== "page") return false;
      const item = await this.#codec.openItem(row);
      const sealed = await this.#codec.sealItem({
        ...item,
        localAvailability: "present",
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: { blocks: structuredClone(document.blocks) },
        },
      });
      const committed = await this.db.transaction("rw", this.db.items, async () => {
        const current = await this.db.items.get(pageId);
        if (current === undefined || current.kind !== "page") return "retired" as const;
        if (current.currentRevisionId !== row.currentRevisionId) return "retry" as const;
        await this.db.items.put(sealed);
        return "stored" as const;
      });
      if (committed === "stored") return true;
      if (committed === "retired") return false;
    }
    return false;
  }

  async listItems(lifecycle?: LocalItemRow["lifecycle"]): Promise<ProjectedItem[]> {
    // `lifecycle` is still an index, which is why filtering by it does not
    // require opening a single row. That is the payoff of sealing payloads and
    // leaving routing metadata in the clear.
    const fetched = await this.db.transaction(
      "r",
      [this.db.items, this.db.placements],
      async () => {
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
        return items.map((row) => ({ row, placements: byItem.get(row.id) ?? [] }));
      },
    );
    return await this.#openAll(fetched);
  }

  async listChildren(parentItemId: Uuid | null): Promise<ProjectedItem[]> {
    const fetched = await this.db.transaction(
      "r",
      [this.db.items, this.db.placements],
      async () => {
        const placements = await this.db.placements
          .where("[parentKey+kind]")
          .equals([parentKeyOf(parentItemId), "hierarchy"])
          .toArray();
        const result: { row: SealedLocalItemRow; placements: LocalPlacementRow[] }[] = [];
        for (const placement of placements.sort((a, b) =>
          a.positionKey < b.positionKey ? -1 : 1,
        )) {
          const item = await this.db.items.get(placement.itemId);
          // Ordering and lifecycle are both readable without a key, so the
          // sort and the filter happen here rather than after opening every
          // child of a folder the caller may not even display.
          if (item !== undefined && item.lifecycle === "active") {
            const itemPlacements = await this.db.placements
              .where("itemId")
              .equals(item.id)
              .toArray();
            result.push({ row: item, placements: itemPlacements });
          }
        }
        return result;
      },
    );
    return await this.#openAll(fetched);
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
