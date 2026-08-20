import type { RelationTargets, Uuid } from "@myownnotion/domain";
import type {
  LocalDatabase,
  LocalDatabaseEntryRow,
  LocalDatabaseRow,
  SealedLocalDatabaseEntryRow,
  SealedLocalDatabaseRow,
} from "../local-store/schema.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";

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
