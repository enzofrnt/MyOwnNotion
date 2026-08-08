/**
 * Endpoint stability and unavailable-target integration tests (T063, US3).
 */

import { listRelationships, schema, submitMutation } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
let counter = 0;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 120_000);

afterAll(async () => {
  await context.close();
});

async function createItem(kind: "page" | "folder", name: string, parent: Uuid | null = null) {
  counter += 1;
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind,
      name,
      placement: {
        kind: "hierarchy",
        parentItemId: parent,
        positionKey: `R${counter.toString(36)}x`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function relate(source: Uuid, target: Uuid): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "relationship.create",
    command: {
      type: "relationship.create",
      id,
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

describe("relationship endpoint stability (FR-010/FR-011)", () => {
  it("projects wiki links supplied with the initial page document", async () => {
    const target = await createItem("page", "Initial link target");
    const source = generateUuidV7();
    const occurrenceId = generateUuidV7();
    const created = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.create",
      command: {
        type: "item.create",
        id: source,
        kind: "page",
        name: "Initially linked source",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "Rinitialx" },
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Initial link target",
                    marks: [{ type: "wikiLink", attrs: { targetItemId: target, occurrenceId } }],
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(created.result.status).toBe("accepted");
    expect(
      (
        await context.handle.db
          .select()
          .from(schema.relationships)
          .where(eq(schema.relationships.id, occurrenceId))
      )[0],
    ).toMatchObject({
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
      metadata: { label: "Initial link target" },
    });
  });

  it("atomically projects version-3 wiki-link occurrences through removal and reactivation", async () => {
    const source = await createItem("page", "Linked source");
    const target = await createItem("page", "Linked target");
    const occurrenceId = generateUuidV7();
    const sourceRow = await context.handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, source));
    const replace = async (baseRevisionId: Uuid, linked: boolean) =>
      submitMutation(context.handle.db, {
        workspaceId: context.workspaceId,
        mutationId: generateUuidV7(),
        commandType: "page.document.replace",
        command: {
          type: "page.document.replace",
          itemId: source,
          baseRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 3,
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  ...(linked
                    ? {
                        content: [
                          {
                            type: "text",
                            text: "Target label",
                            marks: [
                              { type: "wikiLink", attrs: { targetItemId: target, occurrenceId } },
                            ],
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          },
        },
      });

    const added = await replace(sourceRow[0]?.currentRevisionId as Uuid, true);
    expect(added.result.status).toBe("accepted");
    let row = (
      await context.handle.db
        .select()
        .from(schema.relationships)
        .where(eq(schema.relationships.id, occurrenceId))
    )[0];
    expect(row).toMatchObject({
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
      metadata: { label: "Target label" },
      removedRevisionId: null,
    });

    const removed = await replace(added.result.revisionIds?.[0] as Uuid, false);
    expect(removed.result.status).toBe("accepted");
    row = (
      await context.handle.db
        .select()
        .from(schema.relationships)
        .where(eq(schema.relationships.id, occurrenceId))
    )[0];
    expect(row?.removedRevisionId).toBe(removed.result.revisionIds?.[0]);

    const restored = await replace(removed.result.revisionIds?.[0] as Uuid, true);
    expect(restored.result.status).toBe("accepted");
    row = (
      await context.handle.db
        .select()
        .from(schema.relationships)
        .where(eq(schema.relationships.id, occurrenceId))
    )[0];
    expect(row?.removedRevisionId).toBeNull();
  });

  it("rejects invalid wiki-link targets without changing document or revision", async () => {
    const source = await createItem("page", "Safe source");
    const folder = await createItem("folder", "Not a page");
    const before = (
      await context.handle.db.select().from(schema.items).where(eq(schema.items.id, source))
    )[0];
    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "page.document.replace",
      command: {
        type: "page.document.replace",
        itemId: source,
        baseRevisionId: before?.currentRevisionId as Uuid,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "invalid target",
                    marks: [
                      {
                        type: "wikiLink",
                        attrs: { targetItemId: folder, occurrenceId: generateUuidV7() },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    });
    expect(outcome.result.status).toBe("rejected");
    expect(outcome.result.problem?.code).toBe("item.wrong-kind");
    const after = (
      await context.handle.db.select().from(schema.items).where(eq(schema.items.id, source))
    )[0];
    expect(after?.currentRevisionId).toBe(before?.currentRevisionId);
  });
  it("survives rename and move of both endpoints", async () => {
    const source = await createItem("page", "Source");
    const target = await createItem("page", "Target");
    const relationshipId = await relate(source, target);

    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.rename",
      command: { type: "item.rename", itemId: source, name: "Source renamed" },
    });
    const folder = await createItem("folder", "Elsewhere");
    const targetPlacement = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, target));
    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "placement.move",
      command: {
        type: "placement.move",
        placementId: targetPlacement[0]?.id as Uuid,
        parentItemId: folder,
        positionKey: "Vx",
      },
    });

    const listed = await context.handle.db.transaction(async (tx) =>
      listRelationships(tx, context.workspaceId, source),
    );
    const relationship = listed.find((entry) => entry.id === relationshipId);
    expect(relationship?.sourceItemId).toBe(source);
    expect(relationship?.targetItemId).toBe(target);
    expect(relationship?.sourceAvailability).toBe("active");
    expect(relationship?.targetAvailability).toBe("active");
  });

  it("a trashed target stays diagnosable, never silently redirected (FR-014)", async () => {
    const source = await createItem("page", "Referrer");
    const target = await createItem("page", "Doomed");
    const relationshipId = await relate(source, target);

    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.trash",
      command: { type: "item.trash", itemId: target },
    });

    const listed = await context.handle.db.transaction(async (tx) =>
      listRelationships(tx, context.workspaceId, source),
    );
    const relationship = listed.find((entry) => entry.id === relationshipId);
    expect(relationship?.targetItemId).toBe(target);
    expect(relationship?.targetAvailability).toBe("trashed");
  });

  it("name reuse never rebinds a relationship (FR-011)", async () => {
    const source = await createItem("page", "Stable source");
    const original = await createItem("page", "Reusable name");
    const relationshipId = await relate(source, original);

    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.trash",
      command: { type: "item.trash", itemId: original },
    });
    const impostor = await createItem("page", "Reusable name");

    const listed = await context.handle.db.transaction(async (tx) =>
      listRelationships(tx, context.workspaceId, source),
    );
    const relationship = listed.find((entry) => entry.id === relationshipId);
    expect(relationship?.targetItemId).toBe(original);
    expect(relationship?.targetItemId).not.toBe(impostor);
    expect(relationship?.targetAvailability).toBe("trashed");
  });

  it("relationships to unknown endpoints are rejected", async () => {
    const source = await createItem("page", "Lonely");
    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "relationship.create",
      command: {
        type: "relationship.create",
        id: generateUuidV7(),
        sourceItemId: source,
        targetItemId: generateUuidV7(),
        relationType: "link:references",
      },
    });
    expect(outcome.result.status).toBe("rejected");
    expect(outcome.result.problem?.code).toBe("relationship.endpoint-unavailable");
  });

  it("removal is an explicit lineage event, not a row deletion", async () => {
    const source = await createItem("page", "Remover");
    const target = await createItem("page", "Removed target");
    const relationshipId = await relate(source, target);

    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "relationship.remove",
      command: { type: "relationship.remove", relationshipId },
    });
    expect(outcome.result.status).toBe("accepted");

    const rows = await context.handle.db
      .select()
      .from(schema.relationships)
      .where(eq(schema.relationships.id, relationshipId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.removedRevisionId).not.toBeNull();

    const listed = await context.handle.db.transaction(async (tx) =>
      listRelationships(tx, context.workspaceId, source),
    );
    expect(listed.find((entry) => entry.id === relationshipId)).toBeUndefined();
  });
});
