import type { RelationTargets, Uuid } from "@myownnotion/domain";
import type {
  LocalDatabase,
  LocalDatabaseEntryRow,
  LocalDatabaseRow,
  SealedLocalDatabaseEntryRow,
  SealedLocalDatabaseRow,
} from "../local-store/schema.ts";
import { databaseEntryPairKey } from "../local-store/schema.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";

export interface LocalDatabaseCoverage {
  readonly coverage: "complete" | "partial";
  readonly availableCount: number;
  readonly expectedCount: number;
  /** True only when the owner asked to pin this base and every value is present. */
  readonly offlineReady: boolean;
}

/** Sealed persistence boundary for feature-009's browser projection. */
export class LocalDatabaseRepository {
  readonly db: LocalDatabase;
  readonly #codec: LocalRecordCodec;

  constructor(db: LocalDatabase, codec: LocalRecordCodec) {
    this.db = db;
    this.#codec = codec;
  }

  async sealDatabase(row: LocalDatabaseRow): Promise<SealedLocalDatabaseRow> {
    return await this.#codec.sealDatabase(row);
  }

  async sealEntry(row: LocalDatabaseEntryRow): Promise<SealedLocalDatabaseEntryRow> {
    return await this.#codec.sealDatabaseEntry(row);
  }

  async putDatabase(row: LocalDatabaseRow): Promise<void> {
    const sealed = await this.sealDatabase(row);
    await this.db.transaction("rw", [this.db.databases, this.db.databaseSources], async () => {
      await this.db.databases.put(sealed);
      if (sealed.sourceId !== undefined) await this.db.databaseSources.put(sealed);
    });
  }

  async getDatabase(databaseId: Uuid): Promise<LocalDatabaseRow | null> {
    const container = await this.db.databases.get(databaseId);
    if (container !== undefined) return await this.#codec.openDatabase(container);
    const source = await this.db.databaseSources.get(databaseId);
    if (source === undefined) return null;
    const opened = await this.#codec.openDatabase(source);
    const owner = await this.db.databases.get(opened.itemId);
    if (owner === undefined) return opened;
    const ownerOpened = await this.#codec.openDatabase(owner);
    return {
      ...opened,
      ...(ownerOpened.presentation === undefined ? {} : { presentation: ownerOpened.presentation }),
      ...(ownerOpened.presentationRevisionId === undefined
        ? {}
        : { presentationRevisionId: ownerOpened.presentationRevisionId }),
      ...(ownerOpened.presentationVersion === undefined
        ? {}
        : { presentationVersion: ownerOpened.presentationVersion }),
    };
  }

  async listDatabases(): Promise<LocalDatabaseRow[]> {
    const [storedContainers, storedSources] = await Promise.all([
      this.db.databases.toArray(),
      this.db.databaseSources.toArray(),
    ]);
    const [containers, sources] = await Promise.all([
      Promise.all(storedContainers.map((row) => this.#codec.openDatabase(row))),
      Promise.all(storedSources.map((row) => this.#codec.openDatabase(row))),
    ]);
    const owners = new Map(containers.map((row) => [row.itemId, row]));
    const merged = new Map<string, LocalDatabaseRow>();
    for (const row of containers) merged.set(row.sourceId ?? row.itemId, row);
    for (const row of sources) {
      const key = row.sourceId ?? row.itemId;
      const existing = merged.get(key);
      const owner = owners.get(row.itemId);
      merged.set(key, {
        ...row,
        ...(existing?.presentation !== undefined
          ? { presentation: existing.presentation }
          : owner?.presentation !== undefined
            ? { presentation: owner.presentation }
            : {}),
        ...(existing?.presentationRevisionId !== undefined
          ? { presentationRevisionId: existing.presentationRevisionId }
          : owner?.presentationRevisionId !== undefined
            ? { presentationRevisionId: owner.presentationRevisionId }
            : {}),
        ...(existing?.presentationVersion !== undefined
          ? { presentationVersion: existing.presentationVersion }
          : owner?.presentationVersion !== undefined
            ? { presentationVersion: owner.presentationVersion }
            : {}),
      });
    }
    return [...merged.values()];
  }

  async countOwnedSources(ownerItemId: Uuid): Promise<number> {
    const stored = await this.db.databaseSources.where("itemId").equals(ownerItemId).count();
    if (stored > 0) return stored;
    const [item, container] = await Promise.all([
      this.db.items.get(ownerItemId),
      this.db.databases.get(ownerItemId),
    ]);
    return item?.kind === "database" && container !== undefined ? 1 : 0;
  }

  async putEntry(row: LocalDatabaseEntryRow): Promise<void> {
    const sealed = await this.sealEntry(row);
    await this.db.transaction("rw", [this.db.databaseEntryPairs], async () => {
      await this.db.databaseEntryPairs.put(sealed);
    });
  }

  async getEntry(entryId: Uuid): Promise<LocalDatabaseEntryRow | null> {
    const placement = (await this.db.placements.where("itemId").equals(entryId).toArray()).find(
      (candidate) => candidate.kind === "hierarchy" && candidate.parentItemId !== null,
    );
    const owner =
      placement?.parentItemId === undefined || placement.parentItemId === null
        ? undefined
        : await this.db.items.get(placement.parentItemId);
    const row =
      placement?.parentItemId === undefined || placement.parentItemId === null
        ? undefined
        : await this.db.databaseEntryPairs.get(
            databaseEntryPairKey(placement.parentItemId, entryId),
          );
    const entry = await this.db.items.get(entryId);
    if (
      owner?.lifecycle !== "active" ||
      entry?.lifecycle !== "active" ||
      (await this.db.databases.get(owner.id)) === undefined
    )
      return null;
    if (row !== undefined) return await this.#codec.openDatabaseEntry(row);
    return {
      key: databaseEntryPairKey(owner.id, entryId),
      entryItemId: entryId,
      databaseId: owner.id,
      valueVersion: 0,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId: owner.id,
        entryId,
        values: {},
        preserved: [],
      },
    };
  }

  /**
   * Routes a page identity without opening sealed structured payloads.
   *
   * Opening a note must not decrypt neighbouring database misses. Presence of
   * the host row is enough to decide whether the canvas is a base, an entry,
   * or an ordinary page.
   */
  async classifyStructuredHost(itemId: Uuid): Promise<"database" | "entry" | "page"> {
    const placement = (await this.db.placements.where("itemId").equals(itemId).toArray()).find(
      (candidate) => candidate.kind === "hierarchy" && candidate.parentItemId !== null,
    );
    if (
      placement?.parentItemId !== undefined &&
      placement.parentItemId !== null &&
      (await this.db.databases.get(placement.parentItemId)) !== undefined
    )
      return "entry";
    return "page";
  }

  async listEntries(databaseId: Uuid): Promise<LocalDatabaseEntryRow[]> {
    const stored = await this.db.transaction(
      "r",
      [this.db.placements, this.db.items, this.db.databaseEntryPairs],
      async () => {
        const placements = (
          await this.db.placements.where("parentKey").equals(databaseId).toArray()
        ).filter(
          (placement) => placement.kind === "hierarchy" && placement.parentItemId === databaseId,
        );
        const items = await this.db.items.bulkGet(placements.map((placement) => placement.itemId));
        const activeIds = placements.flatMap((placement, index) => {
          const item = items[index];
          return item?.lifecycle === "active" && (item.kind === "page" || item.kind === "folder")
            ? [placement.itemId]
            : [];
        });
        const rows = await this.db.databaseEntryPairs.bulkGet(
          activeIds.map((entryId) => databaseEntryPairKey(databaseId, entryId)),
        );
        return activeIds.map((entryId, index) => ({ entryId, row: rows[index] }));
      },
    );
    // Open after the read snapshot closes: WebCrypto must not hold an IndexedDB
    // transaction, and bounded batches retain order without flooding its queue.
    const opened: LocalDatabaseEntryRow[] = [];
    for (let offset = 0; offset < stored.length; offset += 64) {
      opened.push(
        ...(await Promise.all(
          stored.slice(offset, offset + 64).map(async ({ entryId, row }) =>
            row === undefined
              ? {
                  key: databaseEntryPairKey(databaseId, entryId),
                  entryItemId: entryId,
                  databaseId,
                  valueVersion: 0,
                  availability: "present" as const,
                  values: {
                    format: "myownnotion.database-entry-values+json" as const,
                    formatVersion: 1 as const,
                    databaseId,
                    entryId,
                    values: {},
                    preserved: [],
                  },
                }
              : await this.#codec.openDatabaseEntry(row),
          ),
        )),
      );
    }
    return opened;
  }

  /**
   * Reports verified local coverage without opening private payloads.
   *
   * `expectedCount` can come from a server query. When omitted, every retained
   * membership is expected; an offloaded membership therefore remains partial
   * across restart without storing a second private count.
   */
  async coverage(databaseId: Uuid, expectedCount?: number): Promise<LocalDatabaseCoverage> {
    const [definition, host, placements] = await Promise.all([
      this.db.databases.get(databaseId),
      this.db.items.get(databaseId),
      this.db.placements.where("parentKey").equals(databaseId).toArray(),
    ]);
    const direct = placements.filter(
      (placement) => placement.kind === "hierarchy" && placement.parentItemId === databaseId,
    );
    const items = await this.db.items.bulkGet(direct.map((placement) => placement.itemId));
    const activeIds = direct.flatMap((placement, index) => {
      const item = items[index];
      return item?.lifecycle === "active" && (item.kind === "page" || item.kind === "folder")
        ? [placement.itemId]
        : [];
    });
    const entries = await this.db.databaseEntryPairs.bulkGet(
      activeIds.map((entryId) => databaseEntryPairKey(databaseId, entryId)),
    );
    const expected = expectedCount ?? activeIds.length;
    const availableCount = entries.filter(
      (entry) =>
        entry === undefined || (entry.availability === "present" && entry.sealedValues !== null),
    ).length;
    const complete =
      definition !== undefined &&
      activeIds.length === expected &&
      availableCount === expected &&
      entries.every(
        (entry) =>
          entry === undefined || (entry.availability === "present" && entry.sealedValues !== null),
      );
    return {
      coverage: complete ? "complete" : "partial",
      availableCount,
      expectedCount: expected,
      offlineReady: host?.offlineIntent === true && complete,
    };
  }

  /** Stores the owner's pinning intent and returns whether the base is ready. */
  async setOfflineIntent(databaseId: Uuid, offlineIntent: boolean): Promise<LocalDatabaseCoverage> {
    await this.db.items.update(databaseId, { offlineIntent });
    return await this.coverage(databaseId);
  }

  /**
   * Releases recoverable values while preserving membership and visibility.
   * Pinned bases and unsynchronized entry/database work are never released.
   */
  async offloadEntryValues(entryId: Uuid): Promise<boolean> {
    const placement = (await this.db.placements.where("itemId").equals(entryId).toArray()).find(
      (candidate) => candidate.kind === "hierarchy" && candidate.parentItemId !== null,
    );
    const entry =
      placement?.parentItemId === undefined || placement.parentItemId === null
        ? undefined
        : await this.db.databaseEntryPairs.get(
            databaseEntryPairKey(placement.parentItemId, entryId),
          );
    if (entry === undefined || entry.availability !== "present" || entry.sealedValues === null) {
      return false;
    }
    const host = await this.db.items.get(entry.databaseId);
    if (host?.offlineIntent === true || (await this.#hasLocalWork(entry.databaseId, entryId))) {
      return false;
    }
    await this.db.databaseEntryPairs.update(entry.key, {
      availability: "offloaded",
      sealedValues: null,
    });
    return true;
  }

  async #hasLocalWork(databaseId: Uuid, entryId: Uuid): Promise<boolean> {
    for (const stored of await this.db.outbox.toArray()) {
      const row =
        "payload" in stored
          ? stored
          : await this.#codec.openOutbox(stored as Parameters<LocalRecordCodec["openOutbox"]>[0]);
      if (this.#payloadTouches(row.payload, databaseId, entryId)) return true;
    }
    for (const stored of await this.db.conflicts.toArray()) {
      const row =
        "payload" in stored
          ? stored
          : await this.#codec.openConflict(
              stored as Parameters<LocalRecordCodec["openConflict"]>[0],
            );
      if (this.#payloadTouches(row.payload, databaseId, entryId)) return true;
    }
    return false;
  }

  #payloadTouches(payload: Record<string, unknown>, databaseId: Uuid, entryId: Uuid): boolean {
    return (
      payload["databaseId"] === databaseId ||
      payload["entryId"] === entryId ||
      payload["itemId"] === entryId
    );
  }

  async getRelationTargetsForEntries(
    databaseId: Uuid,
    entryIds: readonly Uuid[],
  ): Promise<ReadonlyMap<Uuid, RelationTargets>> {
    if (entryIds.length === 0) return new Map();
    const relationships = await this.db.relationships
      .where("sourceItemId")
      .anyOf([...entryIds])
      .toArray();
    const byEntry = new Map<Uuid, Record<string, Uuid[]>>();
    for (const relationship of relationships) {
      const propertyId = relationship.metadata["propertyId"];
      if (
        relationship.relationType !== "database:property" ||
        relationship.metadata["databaseId"] !== databaseId ||
        typeof propertyId !== "string"
      )
        continue;
      const properties = byEntry.get(relationship.sourceItemId) ?? {};
      const targets = properties[propertyId] ?? [];
      targets.push(relationship.targetItemId);
      properties[propertyId] = targets;
      byEntry.set(relationship.sourceItemId, properties);
    }
    return new Map(
      [...byEntry].map(([id, properties]) => [
        id,
        Object.fromEntries(
          Object.entries(properties).map(([propertyId, targets]) => [
            propertyId,
            [...new Set(targets)].sort(),
          ]),
        ) as RelationTargets,
      ]),
    );
  }

  async getRelationTargets(databaseId: Uuid, entryId: Uuid): Promise<RelationTargets> {
    const relationships = await this.db.relationships
      .where("sourceItemId")
      .equals(entryId)
      .toArray();
    const targets: Record<string, Uuid[]> = {};
    for (const relationship of relationships) {
      if (
        relationship.relationType !== "database:property" ||
        relationship.metadata["databaseId"] !== databaseId
      ) {
        continue;
      }
      const propertyId = relationship.metadata["propertyId"];
      if (typeof propertyId !== "string") continue;
      const values = targets[propertyId] ?? [];
      values.push(relationship.targetItemId);
      targets[propertyId] = values;
    }
    return Object.fromEntries(
      Object.entries(targets).map(([propertyId, targetIds]) => [
        propertyId,
        [...new Set(targetIds)].sort(),
      ]),
    ) as RelationTargets;
  }
}
