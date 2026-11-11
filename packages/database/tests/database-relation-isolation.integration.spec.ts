import {
  readDatabaseRecord,
  readDatabaseRelationTargets,
  replaceDatabaseRelationships,
  schema,
  submitMutation,
} from "@myownnotion/database";
import {
  generateUuidV7,
  type MutationCommand,
  type RelationTargets,
  type Uuid,
} from "@myownnotion/domain";
import { eq } from "drizzle-orm";
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
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: command.type,
    command,
  });
  expect(outcome.result.status).toBe("accepted");
}

async function owner() {
  const id = generateUuidV7();
  await submit({
    type: "database.create",
    id,
    name: "Relation isolation fixture",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Table",
  });
  const record = await readDatabaseRecord(context.handle.db, id);
  if (!record) throw new Error("Missing fixture owner");
  return record;
}

async function entry(databaseId: Uuid) {
  const id = generateUuidV7();
  await submit({
    type: "database.entry.create",
    id,
    databaseId,
    title: "Relation isolation entry",
    values: {},
    relationTargets: {},
  });
  const [item] = await context.handle.db.select().from(schema.items).where(eq(schema.items.id, id));
  if (!item) throw new Error("Missing fixture entry");
  return { id, revisionId: item.currentRevisionId as Uuid };
}

async function fixture() {
  const current = await owner();
  const foreign = await owner();
  const source = await entry(current.databaseId);
  const first = await entry(foreign.databaseId);
  const second = await entry(foreign.databaseId);
  // Membership values survive moves between owners. Seed that supported historical
  // state, without pretending the entry has two active hierarchy parents.
  await context.handle.db.insert(schema.databaseEntries).values({
    entryItemId: source.id,
    databaseId: foreign.databaseId,
    sourceId: foreign.sourceId,
    workspaceId: context.workspaceId,
    valueVersion: 2,
    addedRevisionId: source.revisionId,
    valueRevisionId: source.revisionId,
  });
  const propertyId = generateUuidV7();
  const otherPropertyId = generateUuidV7();
  const newPropertyId = generateUuidV7();
  const row = (databaseId: Uuid, property: Uuid, targetItemId: Uuid) => ({
    id: generateUuidV7(),
    workspaceId: context.workspaceId,
    sourceItemId: source.id,
    targetItemId,
    relationType: "database:property",
    metadata: { databaseId, propertyId: property },
    createdRevisionId: source.revisionId,
    removedRevisionId: null as string | null,
  });
  const retained = row(current.databaseId, propertyId, first.id);
  const removed = row(current.databaseId, otherPropertyId, second.id);
  const untouched = [
    // Same property AND target must not consume the current owner's desired key.
    row(foreign.databaseId, propertyId, first.id),
    row(foreign.databaseId, otherPropertyId, first.id),
    { ...row(current.databaseId, propertyId, second.id), relationType: "manual:link" },
    { ...row(current.databaseId, propertyId, first.id), sourceItemId: first.id },
    { ...row(current.databaseId, propertyId, second.id), removedRevisionId: first.revisionId },
  ];
  // Insert together: using the reconciler to seed would itself trigger the bug.
  await context.handle.db.insert(schema.relationships).values([...untouched, retained, removed]);
  const rows = () => context.handle.db.select().from(schema.relationships);
  const before = await rows();
  const reconcile = (relationTargets: RelationTargets) =>
    context.handle.db.transaction((tx) =>
      replaceDatabaseRelationships(tx, {
        workspaceId: context.workspaceId,
        databaseId: current.databaseId,
        entryId: source.id,
        revisionId: second.revisionId,
        relationTargets,
      }),
    );
  const expectUntouched = async () => {
    const after = await rows();
    for (const relationship of untouched) {
      expect(after.find((candidate) => candidate.id === relationship.id)).toEqual(
        before.find((candidate) => candidate.id === relationship.id),
      );
    }
    expect(
      await readDatabaseRelationTargets(context.handle.db, {
        databaseId: foreign.databaseId,
        entryId: source.id,
      }),
    ).toEqual({ [propertyId]: [first.id], [otherPropertyId]: [first.id] });
  };
  return {
    current,
    source,
    first,
    second,
    propertyId,
    otherPropertyId,
    newPropertyId,
    retained,
    removed,
    rows,
    reconcile,
    expectUntouched,
  };
}

describe("database relationship owner isolation PostgreSQL (057)", () => {
  it("preserves both owners' shared property/target pairs on unchanged replacement", async () => {
    const f = await fixture();
    expect(
      await f.reconcile({ [f.propertyId]: [f.first.id], [f.otherPropertyId]: [f.second.id] }),
    ).toEqual({ createdRelationshipIds: [], removedRelationshipIds: [] });
    await f.expectUntouched();
  });

  it("reconciles properties only within the selected owner and preserves retained edge identity", async () => {
    const f = await fixture();
    const targets = {
      [f.propertyId]: [f.first.id],
      [f.otherPropertyId]: [f.first.id],
      [f.newPropertyId]: [f.second.id],
    };
    const result = await f.reconcile(targets);
    expect(result.removedRelationshipIds).toEqual([f.removed.id]);
    expect(result.createdRelationshipIds).toHaveLength(2);
    const after = await f.rows();
    expect(after.find((row) => row.id === f.retained.id)).toEqual(f.retained);
    expect(after.find((row) => row.id === f.removed.id)?.removedRevisionId).toBe(
      f.second.revisionId,
    );
    expect(
      await readDatabaseRelationTargets(context.handle.db, {
        databaseId: f.current.databaseId,
        entryId: f.source.id,
      }),
    ).toEqual(targets);
    await f.expectUntouched();
    expect(await f.reconcile(targets)).toEqual({
      createdRelationshipIds: [],
      removedRelationshipIds: [],
    });
  });

  it("clears omitted properties for the selected owner without removing another owner's links", async () => {
    const f = await fixture();
    const result = await f.reconcile({});
    expect(result.createdRelationshipIds).toEqual([]);
    expect([...result.removedRelationshipIds].sort()).toEqual([f.retained.id, f.removed.id].sort());
    expect(
      await readDatabaseRelationTargets(context.handle.db, {
        databaseId: f.current.databaseId,
        entryId: f.source.id,
      }),
    ).toEqual({});
    await f.expectUntouched();
  });
});
