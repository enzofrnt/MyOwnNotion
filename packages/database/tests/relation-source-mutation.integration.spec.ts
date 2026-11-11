import {
  readCurrentDatabaseDefinition,
  readDatabaseRecord,
  readDatabaseRelationTargets,
  schema,
  submitMutation,
} from "@myownnotion/database";
import {
  type DatabaseDefinition,
  generateUuidV7,
  type MutationCommand,
  type Uuid,
} from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeDatabaseCommand } from "../src/mutations/database-commands.ts";
import { listDatabaseProjectionEntries } from "../src/repositories/database-repository.ts";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);
afterAll(async () => {
  await context?.close();
});
async function submit(command: MutationCommand, mutationId = generateUuidV7()) {
  return submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId,
    commandType: command.type,
    command,
  });
}
async function owner() {
  const id = generateUuidV7();
  expect(
    (
      await submit({
        type: "database.create",
        id,
        name: "Fixture",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Table",
      })
    ).result.status,
  ).toBe("accepted");
  const record = await readDatabaseRecord(context.handle.db, id);
  const definition = await readCurrentDatabaseDefinition(context.handle.db, id);
  if (!record?.definitionRevisionId || !definition) throw new Error("Missing fixture");
  return { ...record, definitionRevisionId: record.definitionRevisionId, definition };
}
async function fixture(configured = true) {
  const origin = await owner(),
    target = await owner(),
    relationId = generateUuidV7();
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
  expect(
    (
      await submit({
        type: "database.definition.replace",
        databaseId: origin.databaseId,
        baseRevisionId: origin.definitionRevisionId,
        definition,
      })
    ).result.status,
  ).toBe("accepted");
  return { origin, target, relationId, definition };
}
async function entry(databaseId: Uuid, relationId?: Uuid, targetId?: Uuid, sourceId?: Uuid) {
  const id = generateUuidV7();
  const command: MutationCommand = {
    type: "database.entry.create",
    id,
    databaseId,
    ...(sourceId ? { sourceId } : {}),
    title: "Entry",
    values: {},
    relationTargets: relationId && targetId ? { [relationId]: [targetId] } : {},
  };
  const outcome = await submit(command);
  return { id, outcome, command };
}
async function head(id: Uuid) {
  const [item] = await context.handle.db.select().from(schema.items).where(eq(schema.items.id, id));
  if (!item) throw new Error("Missing item");
  return item.currentRevisionId as Uuid;
}
describe("relation source integrity PostgreSQL (057 T006)", () => {
  it("isolates SQL projection rows of two sources sharing the same owner", async () => {
    const database = await owner();
    const primary = await entry(database.databaseId);
    const sourceId = generateUuidV7();
    expect(
      (
        await submit({
          type: "database.source.create",
          ownerItemId: database.databaseId,
          sourceId,
          name: "Secondary",
          titlePropertyId: generateUuidV7(),
          initialViewId: generateUuidV7(),
          initialViewName: "Secondary",
          baseRevisionId: await head(database.databaseId),
        })
      ).result.status,
    ).toBe("accepted");
    expect(
      await listDatabaseProjectionEntries(
        context.handle.db,
        database.databaseId,
        undefined,
        sourceId,
      ),
    ).toEqual([]);
    const secondary = await entry(database.databaseId, undefined, undefined, sourceId);
    expect(secondary.outcome.result.status).toBe("accepted");
    expect(
      (
        await listDatabaseProjectionEntries(
          context.handle.db,
          database.databaseId,
          undefined,
          database.sourceId,
        )
      ).map((row) => row.entryId),
    ).toEqual([primary.id]);
    expect(
      (
        await listDatabaseProjectionEntries(
          context.handle.db,
          database.databaseId,
          undefined,
          sourceId,
        )
      ).map((row) => row.entryId),
    ).toEqual([secondary.id]);
  });
  it("allows a configured self-source relation", async () => {
    const { origin, definition, relationId } = await fixture();
    const record = await readDatabaseRecord(context.handle.db, origin.databaseId);
    if (!record?.definitionRevisionId) throw new Error("Missing source");
    const self: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((p) =>
        p.type === "relation"
          ? { ...p, config: { ...p.config, targetSourceId: origin.sourceId } }
          : p,
      ),
    };
    expect(
      (
        await submit({
          type: "database.definition.replace",
          databaseId: origin.databaseId,
          baseRevisionId: record.definitionRevisionId,
          definition: self,
        })
      ).result.status,
    ).toBe("accepted");
    const first = await entry(origin.databaseId);
    expect(
      (
        await submit({
          type: "database.entry.values.replace",
          databaseId: origin.databaseId,
          entryId: first.id,
          baseRevisionId: await head(first.id),
          values: {},
          relationTargets: { [relationId]: [first.id] },
        })
      ).result.status,
    ).toBe("accepted");
  });
  it("rejects cross-workspace relation targets even through the lower-level executor", async () => {
    const { origin, target, relationId } = await fixture();
    const member = await entry(target.databaseId);
    const id = generateUuidV7();
    const result = await context.handle.db.transaction((tx) =>
      executeDatabaseCommand(
        tx,
        {
          workspaceId: generateUuidV7(),
          mutationId: generateUuidV7(),
          acceptedAt: new Date(),
        },
        {
          type: "database.entry.create",
          id,
          databaseId: origin.databaseId,
          title: "Denied",
          values: {},
          relationTargets: { [relationId]: [member.id] },
        },
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("database.source-unavailable");
    expect(
      await context.handle.db.select().from(schema.items).where(eq(schema.items.id, id)),
    ).toEqual([]);
  });
  it("retains cardinality and competing-write guards for configured relations", async () => {
    const { origin, target, relationId, definition } = await fixture();
    const first = await entry(target.databaseId),
      second = await entry(target.databaseId);
    const record = await readDatabaseRecord(context.handle.db, origin.databaseId);
    if (!record?.definitionRevisionId) throw new Error("Missing revision");
    const single: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((p) =>
        p.type === "relation" ? { ...p, config: { ...p.config, cardinality: "one" } } : p,
      ),
    };
    expect(
      (
        await submit({
          type: "database.definition.replace",
          databaseId: origin.databaseId,
          baseRevisionId: record.definitionRevisionId,
          definition: single,
        })
      ).result.status,
    ).toBe("accepted");
    const linked = await entry(origin.databaseId, relationId, first.id);
    const baseRevisionId = await head(linked.id);
    expect(
      (
        await submit({
          type: "database.entry.values.replace",
          databaseId: origin.databaseId,
          entryId: linked.id,
          baseRevisionId,
          values: {},
          relationTargets: { [relationId]: [first.id, second.id] },
        })
      ).result.status,
    ).toBe("rejected");
    const outcomes = await Promise.all(
      [first.id, second.id].map((targetId) =>
        submit({
          type: "database.entry.values.replace",
          databaseId: origin.databaseId,
          entryId: linked.id,
          baseRevisionId,
          values: {},
          relationTargets: { [relationId]: [targetId] },
        }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.result.status === "accepted")).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.result.problem?.code === "revision.stale-base"),
    ).toHaveLength(1);
  });
  it("accepts canonical member and idempotent replay, refuses wrong source under the same owner", async () => {
    const { origin, target, relationId } = await fixture();
    const member = await entry(target.databaseId);
    const linked = await entry(origin.databaseId, relationId, member.id);
    expect(linked.outcome.result.status).toBe("accepted");
    const mutationId = generateUuidV7();
    const replayCommand: MutationCommand = {
      type: "database.entry.values.replace",
      databaseId: origin.databaseId,
      entryId: linked.id,
      baseRevisionId: await head(linked.id),
      values: {},
      relationTargets: { [relationId]: [member.id] },
    };
    expect((await submit(replayCommand, mutationId)).result.status).toBe("accepted");
    expect((await submit(replayCommand, mutationId)).result.status).toBe("already-accepted");
    const current = await readDatabaseRecord(context.handle.db, target.databaseId);
    if (!current) throw new Error("Missing source");
    const sourceId = generateUuidV7();
    expect(
      (
        await submit({
          type: "database.source.create",
          ownerItemId: target.databaseId,
          sourceId,
          name: "Secondary",
          titlePropertyId: generateUuidV7(),
          initialViewId: generateUuidV7(),
          initialViewName: "Secondary",
          baseRevisionId: await head(target.databaseId),
        })
      ).result.status,
    ).toBe("accepted");
    const foreign = await entry(target.databaseId, undefined, undefined, sourceId);
    expect(foreign.outcome.result.status).toBe("accepted");
    expect((await entry(origin.databaseId, relationId, foreign.id)).outcome.result.status).toBe(
      "rejected",
    );
  });
  it.each(["target-trash", "owner-trash", "plain-page", "missing-source", "moved"])(
    "refuses new link: %s",
    async (state) => {
      const { origin, target, relationId } = await fixture();
      const member = await entry(target.databaseId);
      if (state === "target-trash")
        await context.handle.db
          .update(schema.items)
          .set({
            lifecycle: "trashed",
            trashedAt: new Date(),
            purgeAfter: new Date(Date.now() + 86400000),
          })
          .where(eq(schema.items.id, member.id));
      if (state === "owner-trash")
        await context.handle.db
          .update(schema.items)
          .set({
            lifecycle: "trashed",
            trashedAt: new Date(),
            purgeAfter: new Date(Date.now() + 86400000),
          })
          .where(eq(schema.items.id, target.databaseId));
      if (state === "plain-page" || state === "missing-source")
        await context.handle.db
          .delete(schema.databaseEntries)
          .where(eq(schema.databaseEntries.entryItemId, member.id));
      if (state === "missing-source")
        await context.handle.db
          .delete(schema.databases)
          .where(eq(schema.databases.sourceId, target.sourceId));
      if (state === "moved")
        await context.handle.db
          .delete(schema.placements)
          .where(eq(schema.placements.itemId, member.id));
      expect((await entry(origin.databaseId, relationId, member.id)).outcome.result.status).toBe(
        "rejected",
      );
    },
  );
  it("preserves historical links after target change and purge; removal remains possible", async () => {
    const { origin, target, relationId, definition } = await fixture(false);
    const member = await entry(target.databaseId);
    const linked = await entry(origin.databaseId, relationId, member.id);
    expect(linked.outcome.result.status).toBe("accepted");
    const other = await owner();
    const current = await readDatabaseRecord(context.handle.db, origin.databaseId);
    if (!current?.definitionRevisionId) throw new Error("Missing source revision");
    const configured: DatabaseDefinition = {
      ...definition,
      properties: definition.properties.map((p) =>
        p.type === "relation"
          ? { ...p, config: { ...p.config, targetSourceId: other.sourceId } }
          : p,
      ),
    };
    expect(
      (
        await submit({
          type: "database.definition.replace",
          databaseId: origin.databaseId,
          baseRevisionId: current.definitionRevisionId,
          definition: configured,
        })
      ).result.status,
    ).toBe("accepted");
    await context.handle.db
      .update(schema.items)
      .set({ lifecycle: "purged" })
      .where(eq(schema.items.id, member.id));
    await context.handle.db
      .delete(schema.databases)
      .where(eq(schema.databases.sourceId, other.sourceId));
    const originalRevisionId = await head(linked.id);
    const originalRelationships = await context.handle.db
      .select()
      .from(schema.relationships)
      .where(eq(schema.relationships.sourceItemId, linked.id));
    expect(
      (
        await submit({
          type: "database.entry.values.replace",
          databaseId: origin.databaseId,
          entryId: linked.id,
          baseRevisionId: originalRevisionId,
          values: {},
          relationTargets: { [relationId]: [member.id] },
        })
      ).result.status,
    ).toBe("accepted");
    expect(
      (
        await submit({
          type: "database.entry.values.resolve-conflict",
          databaseId: origin.databaseId,
          entryId: linked.id,
          resolvedRevisionIds: [await head(linked.id), originalRevisionId],
          values: {},
          relationTargets: { [relationId]: [member.id] },
        })
      ).result.status,
    ).toBe("accepted");
    expect(
      await context.handle.db
        .select()
        .from(schema.relationships)
        .where(eq(schema.relationships.sourceItemId, linked.id)),
    ).toEqual(originalRelationships);
    for (const targets of [[member.id], []]) {
      expect(
        (
          await submit({
            type: "database.entry.values.replace",
            databaseId: origin.databaseId,
            entryId: linked.id,
            baseRevisionId: await head(linked.id),
            values: {},
            relationTargets: { [relationId]: targets },
          })
        ).result.status,
      ).toBe("accepted");
      expect(
        (
          await readDatabaseRelationTargets(context.handle.db, {
            databaseId: origin.databaseId,
            entryId: linked.id,
          })
        )[relationId] ?? [],
      ).toEqual(targets);
    }
    expect(
      (
        await submit({
          type: "database.entry.values.replace",
          databaseId: origin.databaseId,
          entryId: linked.id,
          baseRevisionId: await head(linked.id),
          values: {},
          relationTargets: { [relationId]: [member.id] },
        })
      ).result.status,
    ).toBe("rejected");
  });
  it.each(["database.definition.replace", "database.definition.resolve-conflict"] as const)(
    "rejects old client target erasure: %s",
    async (type) => {
      const { origin, definition } = await fixture();
      const current = await readDatabaseRecord(context.handle.db, origin.databaseId);
      if (!current?.definitionRevisionId) throw new Error("Missing revision");
      const stripped: DatabaseDefinition = {
        ...definition,
        properties: definition.properties.map((p) =>
          p.type === "relation" ? { ...p, config: { cardinality: "many" } } : p,
        ),
      };
      const command: MutationCommand =
        type === "database.definition.replace"
          ? {
              type,
              databaseId: origin.databaseId,
              baseRevisionId: current.definitionRevisionId,
              definition: stripped,
            }
          : {
              type,
              databaseId: origin.databaseId,
              resolvedRevisionIds: [current.definitionRevisionId, origin.definitionRevisionId],
              definition: stripped,
            };
      expect((await submit(command)).result.status).toBe("rejected");
      expect(await readCurrentDatabaseDefinition(context.handle.db, origin.databaseId)).toEqual(
        definition,
      );
    },
  );
});
