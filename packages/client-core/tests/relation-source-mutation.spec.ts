import {
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  type LocalRecordCodec,
  LocalRepository,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let databases: LocalDatabaseRepository;
let items: LocalRepository;
const relationId = generateUuidV7();
beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`relation-source-${generateUuidV7()}`);
  databases = new LocalDatabaseRepository(db, codec);
  items = new LocalRepository(db, codec);
});
afterEach(async () => {
  await db.delete();
});
async function apply(
  commandType: string,
  payload: Record<string, unknown>,
  mutationId = generateUuidV7(),
) {
  return applyLocalMutation(
    db,
    { mutationId, commandType, payload, baseRevisionIds: [] },
    () => new Date("2026-11-11T12:00:00Z"),
    codec,
  );
}
async function owner() {
  const id = generateUuidV7();
  expect(
    (
      await apply("database.create", {
        id,
        name: "Fixture",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Table",
      })
    ).ok,
  ).toBe(true);
  const row = await databases.getDatabase(id);
  if (!row?.sourceId) throw new Error("Missing source");
  return { ...row, sourceId: row.sourceId };
}
async function define(id: Uuid, definition: DatabaseDefinition) {
  const row = await databases.getDatabase(id);
  const item = await items.getItem(id);
  if (!row || !item) throw new Error("Missing fixture");
  return apply("database.definition.replace", {
    databaseId: id,
    baseRevisionId: row.definitionRevisionId ?? item.currentRevisionId,
    definition,
  });
}
async function entry(databaseId: Uuid, sourceId?: Uuid, targets: readonly Uuid[] = []) {
  const id = generateUuidV7();
  const result = await apply("database.entry.create", {
    id,
    databaseId,
    ...(sourceId ? { sourceId } : {}),
    title: "Entry",
    values: {},
    relationTargets: targets.length ? { [relationId]: targets } : {},
  });
  return { id, result };
}
async function fixture(configured = true) {
  const origin = await owner();
  const target = await owner();
  const definition: DatabaseDefinition = {
    ...origin.definition,
    properties: [
      ...origin.definition.properties,
      {
        id: relationId,
        name: "Relation",
        type: "relation",
        positionKey: "b",
        state: "active",
        config: { cardinality: "many", ...(configured ? { targetSourceId: target.sourceId } : {}) },
      },
    ],
  };
  expect((await define(origin.itemId, definition)).ok).toBe(true);
  return { origin, target, definition };
}
async function replace(
  databaseId: Uuid,
  entryId: Uuid,
  targets: readonly Uuid[],
  conflict = false,
) {
  const item = await items.getItem(entryId);
  if (!item) throw new Error("Missing entry");
  return apply(
    conflict ? "database.entry.values.resolve-conflict" : "database.entry.values.replace",
    {
      databaseId,
      entryId,
      ...(conflict
        ? { resolvedRevisionIds: [item.currentRevisionId, generateUuidV7()] }
        : { baseRevisionId: item.currentRevisionId }),
      values: {},
      relationTargets: { [relationId]: targets },
    },
  );
}

describe("relation source integrity offline (057 T006)", () => {
  it("allows a configured self-source relation without recursive validation", async () => {
    const { origin, definition } = await fixture();
    const self: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((p) =>
        p.type === "relation"
          ? { ...p, config: { ...p.config, targetSourceId: origin.sourceId } }
          : p,
      ),
    };
    expect((await define(origin.itemId, self)).ok).toBe(true);
    const first = await entry(origin.itemId);
    expect((await replace(origin.itemId, first.id, [first.id])).ok).toBe(true);
  });
  it("accepts explicit secondary-source members and refuses primary-source members", async () => {
    const { origin, target, definition } = await fixture();
    const secondaryId = generateUuidV7();
    await db.databaseSources.put(await codec.sealDatabase({ ...target, sourceId: secondaryId }));
    const configured: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((p) =>
        p.type === "relation" ? { ...p, config: { ...p.config, targetSourceId: secondaryId } } : p,
      ),
    };
    expect((await define(origin.itemId, configured)).ok).toBe(true);
    const member = await entry(target.itemId, secondaryId),
      primary = await entry(target.itemId);
    expect((await entry(origin.itemId, undefined, [member.id])).result.ok).toBe(true);
    expect((await entry(origin.itemId, undefined, [primary.id])).result.ok).toBe(false);
  });
  it("enforces single cardinality and serializes competing offline writes", async () => {
    const { origin, target, definition } = await fixture();
    const single: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((p) =>
        p.type === "relation" ? { ...p, config: { ...p.config, cardinality: "one" } } : p,
      ),
    };
    expect((await define(origin.itemId, single)).ok).toBe(true);
    const first = await entry(target.itemId),
      second = await entry(target.itemId);
    expect((await entry(origin.itemId, undefined, [first.id, second.id])).result.ok).toBe(false);
    const linked = await entry(origin.itemId, undefined, [first.id]);
    const item = await items.getItem(linked.id);
    if (!item) throw new Error("Missing entry");
    const results = await Promise.all(
      [first.id, second.id].map((id) =>
        apply("database.entry.values.replace", {
          databaseId: origin.itemId,
          entryId: linked.id,
          baseRevisionId: item.currentRevisionId,
          values: {},
          relationTargets: { [relationId]: [id] },
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.error.code === "revision.stale-base"),
    ).toHaveLength(1);
  });
  it("accepts a folder member, rejects another source under the same owner and plain pages atomically", async () => {
    const { origin, target } = await fixture();
    const member = await entry(target.itemId);
    await db.items.update(member.id, { kind: "folder" });
    const acceptedId = generateUuidV7();
    const payload = {
      id: acceptedId,
      databaseId: origin.itemId,
      title: "Linked",
      values: {},
      relationTargets: { [relationId]: [member.id] },
    };
    const mutationId = generateUuidV7();
    expect((await apply("database.entry.create", payload, mutationId)).ok).toBe(true);
    expect((await apply("database.entry.create", payload, mutationId)).ok).toBe(true);
    const secondaryId = generateUuidV7();
    await db.databaseSources.put(await codec.sealDatabase({ ...target, sourceId: secondaryId }));
    const other = await entry(target.itemId, secondaryId);
    const plain = generateUuidV7();
    expect(
      (
        await apply("item.create", {
          id: plain,
          kind: "page",
          name: "Plain",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "a" },
        })
      ).ok,
    ).toBe(true);
    for (const id of [other.id, plain]) {
      const before = await db.outbox.count();
      const rejected = await entry(origin.itemId, undefined, [id]);
      expect(rejected.result.ok).toBe(false);
      expect(await db.items.get(rejected.id)).toBeUndefined();
      expect(await db.outbox.count()).toBe(before);
    }
  });
  it.each(["target-trash", "owner-trash", "missing-source", "moved"])(
    "rejects new links when %s",
    async (state) => {
      const { origin, target } = await fixture();
      const member = await entry(target.itemId);
      if (state === "target-trash") await db.items.update(member.id, { lifecycle: "trashed" });
      if (state === "owner-trash") await db.items.update(target.itemId, { lifecycle: "trashed" });
      if (state === "missing-source") {
        await db.databaseSources.delete(target.sourceId);
        await db.databases.delete(target.itemId);
      }
      if (state === "moved") await db.placements.where("itemId").equals(member.id).delete();
      expect((await entry(origin.itemId, undefined, [member.id])).result.ok).toBe(false);
    },
  );
  it("preserves unavailable historical links on replacement and resolution, allows removal, but rejects readdition", async () => {
    const { origin, target, definition } = await fixture(false);
    const historical = await entry(target.itemId);
    const sourceEntry = await entry(origin.itemId, undefined, [historical.id]);
    expect(sourceEntry.result.ok).toBe(true);
    const otherTarget = await owner();
    const configured: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((p) =>
        p.type === "relation"
          ? { ...p, config: { ...p.config, targetSourceId: otherTarget.sourceId } }
          : p,
      ),
    };
    expect((await define(origin.itemId, configured)).ok).toBe(true);
    await db.items.delete(historical.id);
    await db.databaseSources.delete(otherTarget.sourceId);
    await db.databases.delete(otherTarget.itemId);
    expect((await replace(origin.itemId, sourceEntry.id, [historical.id])).ok).toBe(true);
    expect((await replace(origin.itemId, sourceEntry.id, [historical.id], true)).ok).toBe(true);
    expect(
      (await db.relationships.where("sourceItemId").equals(sourceEntry.id).toArray()).map(
        (r) => r.targetItemId,
      ),
    ).toEqual([historical.id]);
    expect((await replace(origin.itemId, sourceEntry.id, [])).ok).toBe(true);
    expect((await replace(origin.itemId, sourceEntry.id, [historical.id])).ok).toBe(false);
  });
  it.each(["database.definition.replace", "database.definition.resolve-conflict"])(
    "refuses old-client source erasure via %s",
    async (type) => {
      const { origin, definition } = await fixture();
      const row = await databases.getDatabase(origin.itemId);
      if (!row?.definitionRevisionId) throw new Error("Missing revision");
      const candidate = {
        ...definition,
        properties: definition.properties.map((p) =>
          p.type === "relation" ? { ...p, config: { cardinality: "many" } } : p,
        ),
      };
      const result = await apply(type, {
        databaseId: origin.itemId,
        definition: candidate,
        ...(type.endsWith("resolve-conflict")
          ? { resolvedRevisionIds: [row.definitionRevisionId, generateUuidV7()] }
          : { baseRevisionId: row.definitionRevisionId }),
      });
      expect(result.ok).toBe(false);
      expect((await databases.getDatabase(origin.itemId))?.definition).toEqual(definition);
    },
  );
});
