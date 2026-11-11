import {
  listRelationships,
  replaceDatabaseRelationships,
  schema,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
beforeAll(async () => {
  context = await createIntegrationContext();
}, 120_000);
afterAll(async () => {
  await context?.close();
});

async function createItem() {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "page",
      name: "Relationship security fixture",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  const [item] = await context.handle.db.select().from(schema.items).where(eq(schema.items.id, id));
  if (!item) throw new Error("Missing fixture item");
  return { id, revisionId: item.currentRevisionId as Uuid };
}

describe("generic database relationship bypass (057 T007)", () => {
  it("rejects forged property metadata via generic commands without changing source lineage", async () => {
    const source = await createItem();
    const target = await createItem();
    const id = generateUuidV7();
    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "relationship.create",
      command: {
        type: "relationship.create",
        id,
        sourceItemId: source.id,
        targetItemId: target.id,
        relationType: "database:property",
        metadata: { databaseId: generateUuidV7(), propertyId: generateUuidV7() },
      },
    });
    expect(outcome.result).toMatchObject({
      status: "rejected",
      problem: { code: "validation.invalid-payload" },
    });
    expect(
      await context.handle.db
        .select()
        .from(schema.relationships)
        .where(eq(schema.relationships.id, id)),
    ).toEqual([]);
    const [unchanged] = await context.handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, source.id));
    expect(unchanged?.currentRevisionId).toBe(source.revisionId);
  });

  it("keeps historical internal rows readable, rejects generic removal and allows their owner to reconcile", async () => {
    const source = await createItem();
    const target = await createItem();
    const databaseId = generateUuidV7();
    const propertyId = generateUuidV7();
    // The existing database writer is also the fixture for historical rows.
    const created = await context.handle.db.transaction((tx) =>
      replaceDatabaseRelationships(tx, {
        workspaceId: context.workspaceId,
        databaseId,
        entryId: source.id,
        revisionId: source.revisionId,
        relationTargets: { [propertyId]: [target.id] },
      }),
    );
    const relationshipId = created.createdRelationshipIds[0] as Uuid;
    const mutationId = generateUuidV7();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const removed = await submitMutation(context.handle.db, {
        workspaceId: context.workspaceId,
        mutationId,
        commandType: "relationship.remove",
        command: { type: "relationship.remove", relationshipId },
      });
      expect(removed.result).toMatchObject({
        status: "rejected",
        problem: { code: "validation.invalid-payload" },
      });
    }
    const listed = await context.handle.db.transaction((tx) =>
      listRelationships(tx, context.workspaceId, source.id),
    );
    expect(listed).toContainEqual(
      expect.objectContaining({
        id: relationshipId,
        relationType: "database:property",
        metadata: { databaseId, propertyId },
      }),
    );
    const [unchanged] = await context.handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, source.id));
    expect(unchanged?.currentRevisionId).toBe(source.revisionId);
    const removed = await context.handle.db.transaction((tx) =>
      replaceDatabaseRelationships(tx, {
        workspaceId: context.workspaceId,
        databaseId,
        entryId: source.id,
        revisionId: source.revisionId,
        relationTargets: {},
      }),
    );
    expect(removed.removedRelationshipIds).toEqual([relationshipId]);
  });
});
