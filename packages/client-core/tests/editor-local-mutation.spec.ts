import {
  applyLocalMutation,
  type LocalDatabase,
  LocalRepository,
  Outbox,
  openLocalDatabase,
} from "@myownnotion/client-core";
import {
  EDITOR_DOCUMENT_VERSION,
  type EditorDocument,
  generateUuidV7,
  toPageDocument,
  type Uuid,
} from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RICH_DOCUMENT: EditorDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Offline draft", marks: [{ type: "bold" }] }],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Ship safely" }] }],
        },
      ],
    },
  ],
};

let databaseName: string;
let db: LocalDatabase;

beforeEach(() => {
  databaseName = `editor-${generateUuidV7()}`;
  db = openLocalDatabase(databaseName);
});

afterEach(async () => {
  await db.delete();
});

async function createPage(): Promise<{ readonly itemId: Uuid; readonly revisionId: Uuid }> {
  const itemId = generateUuidV7();
  const created = await applyLocalMutation(db, {
    mutationId: generateUuidV7(),
    commandType: "item.create",
    payload: {
      id: itemId,
      kind: "page",
      name: "Offline page",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    },
    baseRevisionIds: [],
  });
  expect(created.ok).toBe(true);
  const item = await new LocalRepository(db).getItem(itemId);
  if (item === null) {
    throw new Error("Page projection was not created");
  }
  return { itemId, revisionId: item.currentRevisionId };
}

describe("rich editor local mutations", () => {
  it("atomically advances the projection and durable outbox from the current causal head", async () => {
    const { itemId, revisionId } = await createPage();
    const mutationId = generateUuidV7();

    const replaced = await applyLocalMutation(db, {
      mutationId,
      commandType: "page.document.replace",
      payload: {
        itemId,
        baseRevisionId: revisionId,
        document: toPageDocument(RICH_DOCUMENT),
      },
      baseRevisionIds: [revisionId],
    });

    expect(replaced.ok).toBe(true);
    const projected = await new LocalRepository(db).getItem(itemId);
    expect(projected?.currentRevisionId).not.toBe(revisionId);
    expect(projected?.pageDocument).toEqual({
      format: "myownnotion.document+json",
      formatVersion: EDITOR_DOCUMENT_VERSION,
      body: RICH_DOCUMENT,
    });
    expect(await new Outbox(db).get(mutationId)).toMatchObject({
      status: "pending",
      baseRevisionIds: [revisionId],
      payload: { itemId, baseRevisionId: revisionId },
    });
  });

  it("recovers an interrupted rich-document outbox row after reopening IndexedDB", async () => {
    const { itemId, revisionId } = await createPage();
    const mutationId = generateUuidV7();
    const replaced = await applyLocalMutation(db, {
      mutationId,
      commandType: "page.document.replace",
      payload: {
        itemId,
        baseRevisionId: revisionId,
        document: toPageDocument(RICH_DOCUMENT),
      },
      baseRevisionIds: [revisionId],
    });
    expect(replaced.ok).toBe(true);
    await new Outbox(db).markSending([mutationId]);
    db.close();

    db = openLocalDatabase(databaseName);
    const restartedOutbox = new Outbox(db);
    expect(await restartedOutbox.recoverInterrupted()).toBe(1);
    const recovered = await restartedOutbox.get(mutationId);
    expect(recovered).toMatchObject({ status: "pending", baseRevisionIds: [revisionId] });
    expect(recovered?.payload).toMatchObject({
      itemId,
      document: { formatVersion: EDITOR_DOCUMENT_VERSION, body: RICH_DOCUMENT },
    });
  });
});
