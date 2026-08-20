import {
  currentSequence,
  listChangesAfter,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  readDatabaseEntryRecord,
  readDatabaseRecord,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, type MutationCommand } from "@myownnotion/domain";
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

describe("structured change feed (T073)", () => {
  it("keeps database and entry identities resolvable at their ordered sequences", async () => {
    const before = await context.handle.db.transaction((tx) =>
      currentSequence(tx, context.workspaceId),
    );
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    const titlePropertyId = generateUuidV7();
    const viewId = generateUuidV7();
    const created = await submit({
      type: "database.create",
      id: databaseId,
      name: "Change feed database",
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "xFeed" },
      titlePropertyId,
      initialViewId: viewId,
      initialViewName: "Feed table",
    });
    expect(created.result.status).toBe("accepted");
    const entry = await submit({
      type: "database.entry.create",
      databaseId,
      id: entryId,
      title: "Feed entry",
      placement: { id: generateUuidV7(), parentItemId: databaseId, positionKey: "a" },
      values: {},
      relationTargets: {},
    });
    expect(entry.result.status).toBe("accepted");

    const projection = await context.handle.db.transaction(async (tx) => {
      const page = await listChangesAfter(tx, context.workspaceId, before, 10);
      return {
        page,
        database: await readDatabaseRecord(tx, databaseId),
        definition: await readCurrentDatabaseDefinition(tx, databaseId),
        entry: await readDatabaseEntryRecord(tx, entryId),
        values: await readCurrentDatabaseEntryValues(tx, entryId),
      };
    });

    expect(projection.page.changes.map(({ changedItemIds }) => changedItemIds)).toEqual([
      [databaseId],
      [entryId],
    ]);
    expect(projection.page.changes[1]?.sequence).toBe(
      (projection.page.changes[0]?.sequence as number) + 1,
    );
    expect(projection.database).toMatchObject({ databaseId, definitionVersion: 1 });
    expect(projection.definition).toMatchObject({ databaseId, views: [{ id: viewId }] });
    expect(projection.entry).toMatchObject({ entryId, databaseId, valueVersion: 1 });
    expect(projection.values).toMatchObject({ entryId, databaseId, values: {} });
    expect(String(projection.page.nextCursor)).toBe(
      String(projection.page.changes.at(-1)?.sequence),
    );
  });
});
