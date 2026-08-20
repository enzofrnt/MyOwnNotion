import {
  executeCommand,
  type MutationContext,
  previewDatabaseTrashImpact,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  readDatabaseEntryRecord,
  runMutation,
  schema,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, type MutationCommand, type Uuid } from "@myownnotion/domain";
import { inArray } from "drizzle-orm";
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
  return await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: command.type,
    command,
  });
}

async function createDatabaseWithMovedEntries(entryCount: number) {
  const databaseId = generateUuidV7();
  const create = await submit({
    type: "database.create",
    id: databaseId,
    name: "Lifecycle database",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Table",
  });
  expect(create.result.status).toBe("accepted");
  const entryIds: Uuid[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const entryId = generateUuidV7();
    entryIds.push(entryId);
    const created = await submit({
      type: "database.entry.create",
      databaseId,
      id: entryId,
      title: `Moved entry ${index + 1}`,
      // Membership deliberately differs from hierarchy: this is the case a
      // normal branch traversal cannot discover.
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: `e${index}` },
      values: {},
      relationTargets: {},
    });
    expect(created.result.status).toBe("accepted");
  }
  return { databaseId, entryIds };
}

async function lifecycles(itemIds: readonly Uuid[]) {
  const rows = await context.handle.db
    .select({ id: schema.items.id, lifecycle: schema.items.lifecycle })
    .from(schema.items)
    .where(inArray(schema.items.id, [...itemIds]));
  return new Map(rows.map(({ id, lifecycle }) => [id as Uuid, lifecycle]));
}

describe("database lifecycle is one membership-aware transaction (T102)", () => {
  it("previews active members, trashes moved entries, and restores the same identities", async () => {
    const { databaseId, entryIds } = await createDatabaseWithMovedEntries(3);
    const alreadyTrashed = entryIds[2] as Uuid;
    expect((await submit({ type: "item.trash", itemId: alreadyTrashed })).result.status).toBe(
      "accepted",
    );

    const impact = await context.handle.db.transaction((tx) =>
      previewDatabaseTrashImpact(tx, databaseId),
    );
    expect(impact).toEqual({ isDatabase: true, activeEntryCount: 2 });

    const definitionBefore = await readCurrentDatabaseDefinition(context.handle.db, databaseId);
    const valuesBefore = await Promise.all(
      entryIds.map((entryId) => readCurrentDatabaseEntryValues(context.handle.db, entryId)),
    );
    const trash = await submit({ type: "item.trash", itemId: databaseId });
    expect(trash.result.status).toBe("accepted");
    expect(trash.result.revisionIds).toHaveLength(3);
    const afterTrash = await lifecycles([databaseId, ...entryIds]);
    expect(afterTrash.get(databaseId)).toBe("trashed");
    expect(afterTrash.get(entryIds[0] as Uuid)).toBe("trashed");
    expect(afterTrash.get(entryIds[1] as Uuid)).toBe("trashed");
    expect(afterTrash.get(alreadyTrashed)).toBe("trashed");

    const restore = await submit({ type: "item.restore", itemId: databaseId });
    expect(restore.result.status).toBe("accepted");
    expect(restore.result.revisionIds).toHaveLength(3);
    const afterRestore = await lifecycles([databaseId, ...entryIds]);
    expect(afterRestore.get(databaseId)).toBe("active");
    expect(afterRestore.get(entryIds[0] as Uuid)).toBe("active");
    expect(afterRestore.get(entryIds[1] as Uuid)).toBe("active");
    expect(afterRestore.get(alreadyTrashed)).toBe("trashed");

    expect(await readCurrentDatabaseDefinition(context.handle.db, databaseId)).toEqual(
      definitionBefore,
    );
    expect(
      await Promise.all(
        entryIds.map((entryId) => readCurrentDatabaseEntryValues(context.handle.db, entryId)),
      ),
    ).toEqual(valuesBefore);
    for (const entryId of entryIds) {
      expect(await readDatabaseEntryRecord(context.handle.db, entryId)).toMatchObject({
        databaseId,
        entryId,
      });
    }
  });

  it("rolls back the host and every membership revision on trash and restore faults", async () => {
    const { databaseId, entryIds } = await createDatabaseWithMovedEntries(2);
    const itemIds = [databaseId, ...entryIds];
    const revisionCountBefore = (await context.handle.db.select().from(schema.revisions)).length;
    const mutationContext = (): MutationContext => ({
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      acceptedAt: new Date(),
    });

    await expect(
      runMutation(context.handle.db, async (tx) => {
        const result = await executeCommand(tx, mutationContext(), {
          type: "item.trash",
          itemId: databaseId,
        });
        expect(result.ok && result.value.revisionIds).toHaveLength(3);
        throw new Error("database-trash-boundary-fault");
      }),
    ).rejects.toThrow("database-trash-boundary-fault");
    expect([...(await lifecycles(itemIds)).values()].every((state) => state === "active")).toBe(
      true,
    );
    expect((await context.handle.db.select().from(schema.revisions)).length).toBe(
      revisionCountBefore,
    );

    expect((await submit({ type: "item.trash", itemId: databaseId })).result.status).toBe(
      "accepted",
    );
    const revisionCountTrashed = (await context.handle.db.select().from(schema.revisions)).length;
    await expect(
      runMutation(context.handle.db, async (tx) => {
        const result = await executeCommand(tx, mutationContext(), {
          type: "item.restore",
          itemId: databaseId,
        });
        expect(result.ok && result.value.revisionIds).toHaveLength(3);
        throw new Error("database-restore-boundary-fault");
      }),
    ).rejects.toThrow("database-restore-boundary-fault");
    expect([...(await lifecycles(itemIds)).values()].every((state) => state === "trashed")).toBe(
      true,
    );
    expect((await context.handle.db.select().from(schema.revisions)).length).toBe(
      revisionCountTrashed,
    );
  });
});
