/**
 * Committing a resolution, and the order that makes it recoverable (T026, FR-016).
 *
 * One assertion here is worth more than the others: the conflict record is
 * cleared *after* the resolution is durably queued, never before. Reversed, a
 * reload landing in the window between them finds neither — the conflict gone and
 * the resolution never written, which is the owner's work destroyed by the screen
 * built to save it.
 */

import {
  applyLocalMutation,
  type LocalDatabase,
  Outbox,
  openLocalDatabase,
  resolveConflictLocally,
  resolveDatabaseDefinitionConflictLocally,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: Awaited<ReturnType<typeof createTestCodec>>["codec"];
let outbox: Outbox;

const BLOCK = "01a10000-0000-7000-8000-0000000b10c1";

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`resolve-${generateUuidV7()}`);
  await db.open();
  outbox = new Outbox(db, codec);
});

afterEach(async () => {
  await db.delete();
});

function document(text: string) {
  return {
    format: "myownnotion.document+json" as const,
    formatVersion: 1 as const,
    body: { blocks: [{ id: BLOCK, type: "paragraph", content: [{ text }] }] },
  };
}

/** A page in the projection, plus a conflict record naming two revisions. */
async function pageWithConflict(): Promise<{
  itemId: Uuid;
  localRevisionId: Uuid;
  remoteRevisionId: Uuid;
  conflictMutationId: Uuid;
}> {
  const itemId = generateUuidV7();
  const created = await applyLocalMutation(
    db,
    {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: itemId,
        kind: "page",
        name: "Diverged",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        pageDocument: document("shared"),
      },
      baseRevisionIds: [],
    },
    () => new Date(),
    codec,
  );
  expect(created.ok).toBe(true);

  const conflictMutationId = generateUuidV7();
  const localRevisionId = generateUuidV7();
  const remoteRevisionId = generateUuidV7();
  const edit = await applyLocalMutation(
    db,
    {
      mutationId: conflictMutationId,
      commandType: "page.document.replace",
      payload: {
        itemId,
        baseRevisionId: localRevisionId,
        document: document("written here"),
        pageLinkTargetIds: [],
      },
      baseRevisionIds: [localRevisionId],
    },
    () => new Date(),
    codec,
  );
  expect(edit.ok).toBe(true);
  await outbox.captureConflict(conflictMutationId, [remoteRevisionId], "revision.stale-base");
  expect(await outbox.conflicts()).toHaveLength(1);

  return { itemId, localRevisionId, remoteRevisionId, conflictMutationId };
}

describe("committing a resolution", () => {
  it("queues one mutation naming both revisions, and clears the conflict", async () => {
    const scenario = await pageWithConflict();
    const outcome = await resolveConflictLocally(db, codec, {
      mutationId: generateUuidV7(),
      conflictMutationId: scenario.conflictMutationId,
      itemId: scenario.itemId,
      localRevisionId: scenario.localRevisionId,
      remoteRevisionId: scenario.remoteRevisionId,
      document: document("what the owner assembled"),
      pageLinkTargetIds: [],
    });

    expect(outcome.ok).toBe(true);
    // The page's own creation is still queued behind it — this workspace has
    // never reached a server — so the resolution is found rather than assumed to
    // be alone.
    const pending = await outbox.pending();
    const resolution = pending.filter((row) => row.commandType === "document.resolve-conflict");
    expect(resolution).toHaveLength(1);
    // Both, and this is what makes the resolution descend from both versions
    // once the server accepts it.
    expect(resolution[0]?.payload["resolvedRevisionIds"]).toEqual([
      scenario.localRevisionId,
      scenario.remoteRevisionId,
    ]);
    expect(await outbox.conflicts()).toHaveLength(0);
  });

  it("leaves the conflict alone when the resolution could not be written", async () => {
    const scenario = await pageWithConflict();
    // A document the domain refuses. The resolution never becomes durable, so
    // clearing the conflict here would leave the owner with neither version and
    // no way back to either.
    const outcome = await resolveConflictLocally(db, codec, {
      mutationId: generateUuidV7(),
      conflictMutationId: scenario.conflictMutationId,
      itemId: scenario.itemId,
      localRevisionId: scenario.localRevisionId,
      remoteRevisionId: scenario.remoteRevisionId,
      document: { format: "not-a-format", formatVersion: 1, body: {} } as never,
      pageLinkTargetIds: [],
    });

    expect(outcome.ok).toBe(false);
    expect(await outbox.conflicts()).toHaveLength(1);
  });

  it("refuses to resolve a revision with itself", async () => {
    const scenario = await pageWithConflict();
    // Not a resolution: it would write a two-parent revision whose parents are
    // the same, putting a conflict that never happened into the history forever.
    const outcome = await resolveConflictLocally(db, codec, {
      mutationId: generateUuidV7(),
      conflictMutationId: scenario.conflictMutationId,
      itemId: scenario.itemId,
      localRevisionId: scenario.localRevisionId,
      remoteRevisionId: scenario.localRevisionId,
      document: document("same on both sides"),
      pageLinkTargetIds: [],
    });

    expect(outcome.ok).toBe(false);
    expect(await outbox.conflicts()).toHaveLength(1);
  });

  it("queues a structured resolution with both parents before clearing its conflict", async () => {
    const databaseId = generateUuidV7();
    const created = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "database.create",
        payload: {
          id: databaseId,
          name: "Diverged database",
          placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
          titlePropertyId: generateUuidV7(),
          initialViewId: generateUuidV7(),
          initialViewName: "Table",
        },
        baseRevisionIds: [],
      },
      () => new Date(),
      codec,
    );
    expect(created.ok).toBe(true);
    const storedItem = await db.items.get(databaseId);
    const storedDatabase = await db.databases.get(databaseId);
    if (storedItem === undefined || storedDatabase === undefined) throw new Error("seed failed");
    const item = await codec.openItem(storedItem);
    const database = await codec.openDatabase(storedDatabase);
    await db.outbox.clear();

    const conflictMutationId = generateUuidV7();
    const localDefinition = {
      ...database.definition,
      views: database.definition.views.map((view) => ({ ...view, name: "Local table" })),
    };
    const edit = await applyLocalMutation(
      db,
      {
        mutationId: conflictMutationId,
        commandType: "database.definition.replace",
        payload: {
          databaseId,
          baseRevisionId: item.currentRevisionId,
          definition: localDefinition,
        },
        baseRevisionIds: [item.currentRevisionId],
      },
      () => new Date(),
      codec,
    );
    if (!edit.ok || edit.value.localRevisionIds[0] === undefined) {
      throw new Error("local edit failed");
    }
    const optimisticLocalRevisionId = edit.value.localRevisionIds[0];
    const remoteRevisionId = generateUuidV7();
    await outbox.captureConflict(conflictMutationId, [remoteRevisionId], "revision.stale-base");

    const outcome = await resolveDatabaseDefinitionConflictLocally(db, codec, {
      mutationId: generateUuidV7(),
      conflictMutationId,
      databaseId,
      localRevisionId: item.currentRevisionId,
      remoteRevisionId,
      definition: {
        ...localDefinition,
        views: localDefinition.views.map((view) => ({ ...view, name: "Resolved table" })),
      },
    });

    expect(outcome.ok).toBe(true);
    const resolution = (await outbox.pending()).find(
      (row) => row.commandType === "database.definition.resolve-conflict",
    );
    expect(resolution?.payload["resolvedRevisionIds"]).toEqual([
      item.currentRevisionId,
      remoteRevisionId,
    ]);
    expect(resolution?.payload["resolvedRevisionIds"]).not.toContain(optimisticLocalRevisionId);
    const revisionId = resolution?.localRevisionIds[0];
    expect(
      revisionId === undefined ? undefined : await db.revisionHeaders.get(revisionId),
    ).toMatchObject({ parentRevisionIds: [item.currentRevisionId, remoteRevisionId] });
    expect(await outbox.conflicts()).toHaveLength(0);
  });
});
