import type { RelationTargets, Uuid } from "@myownnotion/domain";
import type {
  LocalDatabase,
  LocalDatabaseEntryRow,
  LocalDatabaseRow,
  SealedLocalDatabaseEntryRow,
  SealedLocalDatabaseRow,
} from "../local-store/schema.ts";
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
    await this.db.transaction("rw", [this.db.databases], async () => {
      await this.db.databases.put(sealed);
    });
  }

  async getDatabase(databaseId: Uuid): Promise<LocalDatabaseRow | null> {
    const row = await this.db.databases.get(databaseId);
    return row === undefined ? null : await this.#codec.openDatabase(row);
  }

  async putEntry(row: LocalDatabaseEntryRow): Promise<void> {
    const sealed = await this.sealEntry(row);
    await this.db.transaction("rw", [this.db.databaseEntries], async () => {
      await this.db.databaseEntries.put(sealed);
    });
  }

  async getEntry(entryId: Uuid): Promise<LocalDatabaseEntryRow | null> {
    const row = await this.db.databaseEntries.get(entryId);
    return row === undefined ? null : await this.#codec.openDatabaseEntry(row);
  }

  async listEntries(databaseId: Uuid): Promise<LocalDatabaseEntryRow[]> {
    const rows = await this.db.databaseEntries.where("databaseId").equals(databaseId).toArray();
    const opened: LocalDatabaseEntryRow[] = [];
    for (const row of rows) opened.push(await this.#codec.openDatabaseEntry(row));
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
    const [definition, host, entries] = await Promise.all([
      this.db.databases.get(databaseId),
      this.db.items.get(databaseId),
      this.db.databaseEntries.where("databaseId").equals(databaseId).toArray(),
    ]);
    const expected = expectedCount ?? entries.length;
    const availableCount = entries.filter(
      ({ availability, sealedValues }) => availability === "present" && sealedValues !== null,
    ).length;
    const complete =
      definition !== undefined &&
      entries.length === expected &&
      availableCount === expected &&
      entries.every(
        ({ availability, sealedValues }) => availability === "present" && sealedValues !== null,
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
    const entry = await this.db.databaseEntries.get(entryId);
    if (entry === undefined || entry.availability !== "present" || entry.sealedValues === null) {
      return false;
    }
    const host = await this.db.items.get(entry.databaseId);
    if (host?.offlineIntent === true || (await this.#hasLocalWork(entry.databaseId, entryId))) {
      return false;
    }
    await this.db.databaseEntries.update(entryId, {
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
