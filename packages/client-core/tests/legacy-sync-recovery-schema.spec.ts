import {
  LOCAL_SCHEMA_VERSION,
  LocalCipher,
  LocalKeyManager,
  LocalRecordCodec,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { Dexie } from "dexie";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createLegacySyncFixtureKeyStorage,
  type LegacySyncFixture,
  legacySyncStoresFor,
} from "./fixtures/build-legacy-sync-fixtures.ts";
import { loadEncryptedLegacySyncFixtures } from "./fixtures/legacy-sync/index.ts";

const databasesToDelete = new Set<string>();
let fixtures: readonly LegacySyncFixture[] = [];

beforeAll(async () => {
  fixtures = await loadEncryptedLegacySyncFixtures();
});

afterAll(() => {
  fixtures = [];
});

afterEach(async () => {
  for (const name of databasesToDelete) await Dexie.delete(name);
  databasesToDelete.clear();
});

describe("legacy sync recovery schema", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "upgrades the encrypted v%s profile without rewriting owner payloads",
    async (version) => {
      const fixture = fixtures.find(({ databaseVersion }) => databaseVersion === version);
      if (fixture === undefined) throw new Error(`missing encrypted v${version} fixture`);
      const name = `legacy-sync-schema-v${version}-${generateUuidV7()}`;
      databasesToDelete.add(name);
      const legacy = new Dexie(name);
      legacy.version(version).stores(legacySyncStoresFor(fixture.databaseVersion));
      for (const [storeName, rows] of Object.entries(fixture.stores)) {
        await legacy.table(storeName).bulkPut(rows);
      }
      legacy.close();

      const upgraded = openLocalDatabase(name);
      await upgraded.open();

      expect(upgraded.verno).toBe(LOCAL_SCHEMA_VERSION);
      expect(await upgraded.legacySyncRecoveries.count()).toBe(0);
      for (const storeName of fixture.expected.storeNames) {
        expect(upgraded.tables.some(({ name: tableName }) => tableName === storeName)).toBe(true);
        expect(await upgraded.table(storeName).count()).toBe(
          fixture.stores[storeName]?.length ?? 0,
        );
      }
      for (const conflict of fixture.stores.conflicts ?? []) {
        expect(await upgraded.conflicts.get(conflict["mutationId"] as Uuid)).toEqual(conflict);
      }

      const keys = new LocalKeyManager(await createLegacySyncFixtureKeyStorage());
      await keys.establish({ reuseExistingOnly: true });
      const codec = new LocalRecordCodec(new LocalCipher(keys), {
        installationId: "018f2b7c-0000-7000-8000-000000000001",
        workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
      });
      const firstConflict = fixture.stores.conflicts?.[0];
      if (firstConflict === undefined) throw new Error("fixture has no historical conflict");
      await expect(codec.openConflict(firstConflict as never)).resolves.toMatchObject({
        mutationId: firstConflict["mutationId"],
        commandType: "page.document.replace",
        payload: { itemId: fixture.expected.pageId },
      });

      const storedProfile = JSON.stringify(
        await Promise.all(
          fixture.expected.storeNames.map((storeName) => upgraded.table(storeName).toArray()),
        ),
      );
      expect(storedProfile).not.toContain("Encrypted historical title");
      expect(storedProfile).not.toContain("Encrypted offline draft");
      expect(storedProfile).not.toContain("Encrypted queued rename");
      upgraded.close();
    },
  );

  it("builds byte-identical encrypted fixtures and includes five refused v8 drafts", async () => {
    const first = await loadEncryptedLegacySyncFixtures();
    const second = await loadEncryptedLegacySyncFixtures();

    expect(second).toEqual(first);
    expect(first.map(({ databaseVersion }) => databaseVersion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      first.find(({ databaseVersion }) => databaseVersion === 8)?.expected.conflictIds,
    ).toHaveLength(5);
  });

  it("adds only content-free recovery indexes", async () => {
    const name = `legacy-sync-schema-current-${generateUuidV7()}`;
    databasesToDelete.add(name);
    const db = openLocalDatabase(name);
    await db.open();

    expect(db.legacySyncRecoveries.schema.primKey.name).toBe("mutationId");
    expect(db.legacySyncRecoveries.schema.indexes.map(({ name }) => name)).toEqual([
      "pageId",
      "status",
      "capturedAt",
      "[status+pageId]",
    ]);
    expect(
      db.legacySyncRecoveries.schema.indexes.some(({ name }) =>
        /payload|document|content|cipher/i.test(name),
      ),
    ).toBe(false);
    db.close();
  });
});
