import {
  readCurrentDatabaseDefinition,
  readCurrentDatabasePresentation,
  readDatabaseEntryRecord,
  readDatabaseRecord,
  readDatabaseRelationTargets,
  submitMutation,
} from "@myownnotion/database";
import { type DatabaseDefinition, generateUuidV7, type MutationCommand } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);
afterAll(async () => {
  await context?.close();
});

async function submit(command: MutationCommand) {
  return submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: command.type,
    command,
  });
}

async function ownerItem() {
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
  return id;
}

async function fixture() {
  const originItem = await ownerItem();
  const targetItem = await ownerItem();
  const relationId = generateUuidV7();
  const origin = await readDatabaseRecord(context.handle.db, originItem);
  const target = await readDatabaseRecord(context.handle.db, targetItem);
  const originDefinition = await readCurrentDatabaseDefinition(context.handle.db, originItem);
  if (origin === null || target === null || originDefinition === null) throw new Error("fixture");
  const definition: DatabaseDefinition = {
    ...originDefinition,
    properties: [
      ...originDefinition.properties,
      {
        id: relationId,
        name: "Relation",
        type: "relation",
        positionKey: "b",
        state: "active",
        config: { cardinality: "many", targetSourceId: target.sourceId },
      },
    ],
  };
  const replace = await submit({
    type: "database.definition.replace",
    databaseId: originItem,
    baseRevisionId: origin.definitionRevisionId as never,
    definition,
  } as MutationCommand);
  expect(replace.result.status).toBe("accepted");
  const fresh = await readDatabaseRecord(context.handle.db, originItem);
  const freshTarget = await readDatabaseRecord(context.handle.db, targetItem);
  if (fresh?.definitionRevisionId == null || freshTarget?.definitionRevisionId == null)
    throw new Error("revisions");
  return {
    originItem,
    originSourceId: fresh.sourceId,
    originRevision: fresh.definitionRevisionId,
    targetItem,
    targetSourceId: freshTarget.sourceId,
    targetRevision: freshTarget.definitionRevisionId,
    relationId,
  };
}

async function revisions(f: Awaited<ReturnType<typeof fixture>>) {
  const origin = await readDatabaseRecord(context.handle.db, f.originItem);
  const target = await readDatabaseRecord(context.handle.db, f.targetItem);
  if (origin?.definitionRevisionId == null || target?.definitionRevisionId == null)
    throw new Error("revisions");
  return { origin: origin.definitionRevisionId, target: target.definitionRevisionId };
}

describe("two-way relation pair PostgreSQL", () => {
  it("creates both properties in one transaction and removes only the inverse", async () => {
    const f = await fixture();
    const inverseId = generateUuidV7();
    expect(
      (
        await submit({
          type: "database.relation.pair.create",
          databaseId: f.originSourceId,
          relationPropertyId: f.relationId,
          inversePropertyId: inverseId,
          inverseName: "Projets liés",
          baseRevisionId: f.originRevision,
          inverseBaseRevisionId: f.targetRevision,
        } as MutationCommand)
      ).result.status,
    ).toBe("accepted");
    const targetDefinition = await readCurrentDatabaseDefinition(context.handle.db, f.targetItem);
    expect(
      targetDefinition?.properties.find((property) => property.id === inverseId),
    ).toMatchObject({
      type: "relation",
      name: "Projets liés",
      config: {
        cardinality: "many",
        targetSourceId: f.originSourceId,
        reciprocalPropertyId: f.relationId,
      },
    });
    const originDefinition = await readCurrentDatabaseDefinition(context.handle.db, f.originItem);
    expect(
      originDefinition?.properties.find((property) => property.id === f.relationId),
    ).toMatchObject({ config: { reciprocalPropertyId: inverseId } });
    // The saved presentation must show the new column, or no table renders it.
    const presentation = await readCurrentDatabasePresentation(context.handle.db, f.targetItem);
    expect(
      presentation?.views.some((view) =>
        view.properties.some((column) => column.propertyId === inverseId),
      ),
    ).toBe(true);

    const next = await revisions(f);
    const removed = await submit({
      type: "database.relation.pair.remove",
      databaseId: f.originSourceId,
      relationPropertyId: f.relationId,
      baseRevisionId: next.origin,
      inverseBaseRevisionId: next.target,
    } as MutationCommand);
    expect(JSON.stringify(removed.result)).toContain('"status":"accepted"');
    const removedTarget = await readCurrentDatabaseDefinition(context.handle.db, f.targetItem);
    expect(removedTarget?.properties.find((property) => property.id === inverseId)?.state).toBe(
      "retired",
    );
    const keptOrigin = await readCurrentDatabaseDefinition(context.handle.db, f.originItem);
    expect(keptOrigin?.properties.find((property) => property.id === f.relationId)).toMatchObject({
      type: "relation",
    });
    expect(
      keptOrigin?.properties.find((property) => property.id === f.relationId)?.type === "relation"
        ? keptOrigin.properties.find((property) => property.id === f.relationId)?.config
        : null,
    ).not.toHaveProperty("reciprocalPropertyId");
  });

  it("refuses to delete a property that still belongs to a pair", async () => {
    const f = await fixture();
    const inverseId = generateUuidV7();
    const created = await submit({
      type: "database.relation.pair.create",
      databaseId: f.originSourceId,
      relationPropertyId: f.relationId,
      inversePropertyId: inverseId,
      inverseName: "Inverse",
      baseRevisionId: f.originRevision,
      inverseBaseRevisionId: f.targetRevision,
    } as MutationCommand);
    expect(created.result.status).toBe("accepted");
    const next = await revisions(f);
    const originDefinition = await readCurrentDatabaseDefinition(context.handle.db, f.originItem);
    if (originDefinition === null) throw new Error("definition");
    const refused = await submit({
      type: "database.definition.replace",
      databaseId: f.originItem,
      baseRevisionId: next.origin,
      definition: {
        ...originDefinition,
        properties: originDefinition.properties.filter((property) => property.id !== f.relationId),
      },
    } as MutationCommand);
    expect(refused.result.status).toBe("rejected");
    expect(JSON.stringify(refused.result)).toContain("database.relation.pair-active");
  });

  it("removes the link stored on the partner entry from the inverse side", async () => {
    const f = await fixture();
    const created = await submit({
      type: "database.relation.pair.create",
      databaseId: f.originSourceId,
      relationPropertyId: f.relationId,
      inversePropertyId: generateUuidV7(),
      inverseName: "Inverse",
      baseRevisionId: f.originRevision,
      inverseBaseRevisionId: f.targetRevision,
    } as MutationCommand);
    expect(created.result.status).toBe("accepted");
    const entryA = generateUuidV7();
    const entryB = generateUuidV7();
    for (const [databaseId, id, title] of [
      [f.originItem, entryA, "Origin entry"],
      [f.targetItem, entryB, "Target entry"],
    ] as const) {
      expect(
        (
          await submit({
            type: "database.entry.create",
            databaseId,
            id,
            title,
            values: {},
            relationTargets: {},
          } as MutationCommand)
        ).result.status,
      ).toBe("accepted");
    }
    const linked = await submit({
      type: "database.entry.values.replace",
      databaseId: f.originItem,
      entryId: entryA,
      baseRevisionId: (await readDatabaseEntryRecord(context.handle.db, entryA, f.originItem))
        ?.valueRevisionId as never,
      values: {},
      relationTargets: { [f.relationId]: [entryB] },
    } as MutationCommand);
    expect(linked.result.status).toBe("accepted");
    expect(
      (
        await readDatabaseRelationTargets(context.handle.db, {
          databaseId: f.originItem,
          entryId: entryA,
        })
      )[f.relationId],
    ).toEqual([entryB]);
    const target = await readDatabaseEntryRecord(context.handle.db, entryA, f.originItem);
    const removed = await submit({
      type: "database.entry.relation.patch",
      databaseId: f.originItem,
      entryId: entryA,
      propertyId: f.relationId,
      targetItemId: entryB,
      present: false,
      baseRevisionId: target?.valueRevisionId as never,
    } as MutationCommand);
    expect(removed.result.status).toBe("accepted");
    expect(
      (
        await readDatabaseRelationTargets(context.handle.db, {
          databaseId: f.originItem,
          entryId: entryA,
        })
      )[f.relationId] ?? [],
    ).toEqual([]);
  });

  it("pairs a database with itself", async () => {
    const id = generateUuidV7();
    expect(
      (
        await submit({
          type: "database.create",
          id,
          name: "Self pair",
          placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
          titlePropertyId: generateUuidV7(),
          initialViewId: generateUuidV7(),
          initialViewName: "Table",
        })
      ).result.status,
    ).toBe("accepted");
    const record = await readDatabaseRecord(context.handle.db, id);
    const definition = await readCurrentDatabaseDefinition(context.handle.db, id);
    if (record === null || definition === null) throw new Error("fixture");
    const relationId = generateUuidV7();
    const replaced = await submit({
      type: "database.definition.replace",
      databaseId: id,
      baseRevisionId: record.definitionRevisionId as never,
      definition: {
        ...definition,
        properties: [
          ...definition.properties,
          {
            id: relationId,
            name: "Related",
            type: "relation",
            positionKey: "b",
            state: "active",
            config: { cardinality: "many", targetSourceId: record.sourceId },
          },
        ],
      },
    } as MutationCommand);
    expect(replaced.result.status).toBe("accepted");
    const fresh = await readDatabaseRecord(context.handle.db, id);
    const inverseId = generateUuidV7();
    expect(
      (
        await submit({
          type: "database.relation.pair.create",
          databaseId: record.sourceId,
          relationPropertyId: relationId,
          inversePropertyId: inverseId,
          inverseName: "Inverse",
          baseRevisionId: fresh?.definitionRevisionId as never,
          inverseBaseRevisionId: fresh?.definitionRevisionId as never,
        } as MutationCommand)
      ).result.status,
    ).toBe("accepted");
    const paired = await readCurrentDatabaseDefinition(context.handle.db, id);
    expect(paired?.properties.find((property) => property.id === inverseId)).toMatchObject({
      config: { reciprocalPropertyId: relationId, targetSourceId: record.sourceId },
    });
    expect(paired?.properties.find((property) => property.id === relationId)).toMatchObject({
      config: { reciprocalPropertyId: inverseId },
    });
  });
});
