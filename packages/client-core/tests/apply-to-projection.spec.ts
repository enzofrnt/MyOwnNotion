/**
 * Offline projection application per command type (T040, US6).
 *
 * Covers every command the offline applier supports — including the branch
 * cascades (trash/restore), relationship commands, and each rejection path —
 * so an offline command can never report success while leaving the local
 * projection inconsistent (FR-037/FR-038), and commands with no safe offline
 * semantics are refused rather than half-applied.
 */

import type { LocalRecordCodec } from "@myownnotion/client-core";
import {
  applyLocalMutation,
  type LocalDatabase,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;

/**
 * The stored row, opened.
 *
 * Every assertion in this file is about what a *user* would see, and the user
 * sees the opened row. Reading the sealed one and asserting on `sealedName`
 * would test the codec, which has its own suite.
 */
async function readItem(itemId: Uuid) {
  const row = await db.items.get(itemId);
  return row === undefined ? undefined : await codec.openItem(row);
}

const FIXED_NOW = new Date("2026-08-09T12:00:00.000Z");
const now = () => FIXED_NOW;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`test-${generateUuidV7()}`);
});

afterEach(async () => {
  await db.delete();
});

/** Creates an item through the public applier so state stays realistic. */
async function createItem(
  kind: "page" | "folder",
  name: string,
  parentItemId: Uuid | null,
): Promise<{ itemId: Uuid; placementId: Uuid }> {
  const itemId = generateUuidV7();
  const placementId = generateUuidV7();
  const result = await applyLocalMutation(
    db,
    {
      mutationId: generateUuidV7(),
      commandType: "item.create",
      payload: {
        id: itemId,
        kind,
        name,
        placement: { id: placementId, kind: "hierarchy", parentItemId, positionKey: "V" },
      },
      baseRevisionIds: [],
    },
    now,
    codec,
  );
  expect(result.ok).toBe(true);
  return { itemId, placementId };
}

describe("item.create", () => {
  it("persists a page with a default document envelope and its placement", async () => {
    const { itemId, placementId } = await createItem("page", "  Padded name  ", null);

    const item = await readItem(itemId);
    expect(item?.name).toBe("Padded name");
    expect(item?.pageDocument?.format).toBe("myownnotion.document+json");

    const placement = await db.placements.get(placementId);
    expect(placement?.parentKey).toBe("root");
    // The client-generated placement id is persisted verbatim so a queued
    // follow-up move still resolves after reconciliation.
    expect(placement?.id).toBe(placementId);
  });

  it("leaves a folder without a page document", async () => {
    const { itemId } = await createItem("folder", "Folder", null);
    expect((await readItem(itemId))?.pageDocument).toBeNull();
  });

  it("nests beneath an active container", async () => {
    const parent = await createItem("folder", "Parent", null);
    const child = await createItem("page", "Child", parent.itemId);
    expect((await db.placements.get(child.placementId))?.parentItemId).toBe(parent.itemId);
  });

  it("rejects an unknown parent without writing anything", async () => {
    const before = await db.items.count();
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: generateUuidV7(),
          kind: "page",
          name: "Orphan",
          placement: { kind: "hierarchy", parentItemId: generateUuidV7(), positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
    expect(await db.items.count()).toBe(before);
    expect(await db.outbox.count()).toBe(0);
  });

  it("rejects a trashed parent", async () => {
    const parent = await createItem("folder", "Parent", null);
    await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.trash",
        payload: { itemId: parent.itemId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: generateUuidV7(),
          kind: "page",
          name: "Child of trash",
          placement: { kind: "hierarchy", parentItemId: parent.itemId, positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects a file as a parent because file placements are terminal", async () => {
    const fileId = generateUuidV7();
    const revisionId = generateUuidV7();
    // Sealed like any other row: the fixture has to look like what the
    // application would actually have stored, or the validation under test is
    // reading a shape that cannot occur.
    await db.items.add(
      await codec.sealItem({
        id: fileId,
        kind: "file",
        name: "diagram.png",
        lifecycle: "active",
        currentRevisionId: revisionId,
        trashedAt: null,
        purgeAfter: null,
        favourite: false,
        offlineIntent: false,
        localAvailability: "present",
        pageDocument: null,
        file: { mediaType: "image/png", originalName: "diagram.png", byteLength: 4 },
      }),
    );

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.create",
        payload: {
          id: generateUuidV7(),
          kind: "page",
          name: "Beneath a file",
          placement: { kind: "hierarchy", parentItemId: fileId, positionKey: "V" },
        },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });
});

describe("item.rename", () => {
  it("renames and chains the new revision onto the previous head", async () => {
    const { itemId } = await createItem("page", "Before", null);
    const previousRevisionId = (await readItem(itemId))?.currentRevisionId as Uuid;

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId, name: "  After  " },
        baseRevisionIds: [previousRevisionId],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);

    const item = await readItem(itemId);
    expect(item?.name).toBe("After");
    expect(item?.currentRevisionId).not.toBe(previousRevisionId);

    const revision = await db.revisionHeaders.get(item?.currentRevisionId as Uuid);
    expect(revision?.parentRevisionIds).toEqual([previousRevisionId]);
    expect(revision?.local).toBe(1);
  });

  it("rejects renaming an item that is not available locally", async () => {
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId: generateUuidV7(), name: "Ghost" },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });
});

describe("page.document.replace", () => {
  it("replaces the document body and advances the revision", async () => {
    const { itemId } = await createItem("page", "Doc", null);
    const baseRevisionId = (await readItem(itemId))?.currentRevisionId as Uuid;

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "page.document.replace",
        payload: {
          itemId,
          baseRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: { text: "offline edit" },
          },
        },
        baseRevisionIds: [baseRevisionId],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);

    const item = await readItem(itemId);
    expect(item?.pageDocument?.body).toEqual({ text: "offline edit" });
    expect(item?.currentRevisionId).not.toBe(baseRevisionId);
  });

  it("refuses to give a folder page content", async () => {
    const { itemId } = await createItem("folder", "Folder", null);
    const baseRevisionId = (await readItem(itemId))?.currentRevisionId as Uuid;

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "page.document.replace",
        payload: {
          itemId,
          baseRevisionId,
          document: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
        },
        baseRevisionIds: [baseRevisionId],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
    expect((await readItem(itemId))?.pageDocument).toBeNull();
  });

  it("reconciles deduplicated page links without disturbing other relationships", async () => {
    const source = await createItem("page", "Source", null);
    const firstTarget = await createItem("page", "First target", null);
    const secondTarget = await createItem("page", "Second target", null);
    const unrelatedRelationshipId = generateUuidV7();
    await db.relationships.add({
      id: unrelatedRelationshipId,
      sourceItemId: source.itemId,
      targetItemId: secondTarget.itemId,
      relationType: "link",
      metadata: { label: "unrelated" },
    });

    const replaceLinks = async (targetItemIds: readonly Uuid[], includeIndex = true) => {
      const baseRevisionId = (await readItem(source.itemId))?.currentRevisionId as Uuid;
      return await applyLocalMutation(
        db,
        {
          mutationId: generateUuidV7(),
          commandType: "page.document.replace",
          payload: {
            itemId: source.itemId,
            baseRevisionId,
            document: {
              format: "myownnotion.document+json",
              formatVersion: 2,
              body: {
                blocks: [
                  {
                    type: "paragraph",
                    id: generateUuidV7(),
                    content: targetItemIds.map((targetItemId) => ({
                      text: "linked target",
                      marks: [{ type: "pageLink", targetItemId }],
                    })),
                  },
                ],
              },
            },
            ...(includeIndex ? { pageLinkTargetIds: targetItemIds } : {}),
          },
          baseRevisionIds: [baseRevisionId],
        },
        now,
        codec,
      );
    };

    expect((await replaceLinks([firstTarget.itemId, firstTarget.itemId])).ok).toBe(true);
    let pageLinks = (await db.relationships.toArray()).filter(
      (relationship) => relationship.relationType === "page:link",
    );
    expect(pageLinks).toHaveLength(1);
    expect(pageLinks[0]?.targetItemId).toBe(firstTarget.itemId);

    expect((await replaceLinks([secondTarget.itemId])).ok).toBe(true);
    pageLinks = (await db.relationships.toArray()).filter(
      (relationship) => relationship.relationType === "page:link",
    );
    expect(pageLinks).toHaveLength(1);
    expect(pageLinks[0]?.targetItemId).toBe(secondTarget.itemId);

    const retainedPageLinkId = pageLinks[0]?.id;
    expect((await replaceLinks([secondTarget.itemId])).ok).toBe(true);
    pageLinks = (await db.relationships.toArray()).filter(
      (relationship) => relationship.relationType === "page:link",
    );
    expect(pageLinks[0]?.id).toBe(retainedPageLinkId);

    expect((await replaceLinks([], false)).ok).toBe(true);
    pageLinks = (await db.relationships.toArray()).filter(
      (relationship) => relationship.relationType === "page:link",
    );
    expect(pageLinks).toHaveLength(0);
    expect(await db.relationships.get(unrelatedRelationshipId)).toMatchObject({
      relationType: "link",
      metadata: { label: "unrelated" },
    });
  });

  it("rejects an unavailable page-link target atomically", async () => {
    const source = await createItem("page", "Source", null);
    const baseRevisionId = (await readItem(source.itemId))?.currentRevisionId as Uuid;
    const before = await readItem(source.itemId);
    const unavailableTargetId = generateUuidV7();

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "page.document.replace",
        payload: {
          itemId: source.itemId,
          baseRevisionId,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 2,
            body: {
              blocks: [
                {
                  type: "paragraph",
                  id: generateUuidV7(),
                  content: [
                    {
                      text: "invalid link",
                      marks: [{ type: "pageLink", targetItemId: unavailableTargetId }],
                    },
                  ],
                },
              ],
            },
          },
          pageLinkTargetIds: [unavailableTargetId],
        },
        baseRevisionIds: [baseRevisionId],
      },
      now,
      codec,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("relationship.endpoint-unavailable");
    }
    expect(await readItem(source.itemId)).toEqual(before);
    expect(
      (await db.relationships.toArray()).filter(
        (relationship) => relationship.relationType === "page:link",
      ),
    ).toHaveLength(0);
  });
});

describe("placement.move", () => {
  it("reparents a placement and advances the moved item's revision", async () => {
    const target = await createItem("folder", "Target", null);
    const moving = await createItem("page", "Moving", null);
    const before = (await db.items.get(moving.itemId))?.currentRevisionId as Uuid;

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "placement.move",
        payload: {
          placementId: moving.placementId,
          parentItemId: target.itemId,
          positionKey: "W",
        },
        baseRevisionIds: [before],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);

    const placement = await db.placements.get(moving.placementId);
    expect(placement?.parentItemId).toBe(target.itemId);
    expect(placement?.parentKey).toBe(target.itemId);
    expect(placement?.positionKey).toBe("W");
    expect((await db.items.get(moving.itemId))?.currentRevisionId).not.toBe(before);
  });

  it("moves a placement back to the root", async () => {
    const parent = await createItem("folder", "Parent", null);
    const child = await createItem("page", "Child", parent.itemId);

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "placement.move",
        payload: { placementId: child.placementId, parentItemId: null, positionKey: "V" },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);
    expect((await db.placements.get(child.placementId))?.parentKey).toBe("root");
  });

  it("rejects moving an item beneath its own descendant", async () => {
    const root = await createItem("folder", "Root", null);
    const child = await createItem("folder", "Child", root.itemId);
    const rootPlacementBefore = await db.placements.get(root.placementId);

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "placement.move",
        payload: { placementId: root.placementId, parentItemId: child.itemId, positionKey: "V" },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("containment.cycle-rejected");
    }
    // The hierarchy is untouched.
    expect(await db.placements.get(root.placementId)).toEqual(rootPlacementBefore);
  });

  it("rejects a placement that is not available locally", async () => {
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "placement.move",
        payload: { placementId: generateUuidV7(), parentItemId: null, positionKey: "V" },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.not-found");
    }
  });
});

describe("item.trash", () => {
  it("cascades over the whole branch with one shared deadline", async () => {
    const root = await createItem("folder", "Root", null);
    const child = await createItem("folder", "Child", root.itemId);
    const grandchild = await createItem("page", "Grandchild", child.itemId);
    const untouched = await createItem("page", "Sibling", null);

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.trash",
        payload: { itemId: root.itemId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // One optimistic revision per trashed branch member.
      expect(result.value.localRevisionIds.length).toBe(3);
    }

    for (const id of [root.itemId, child.itemId, grandchild.itemId]) {
      const item = await db.items.get(id);
      expect(item?.lifecycle).toBe("trashed");
      expect(item?.trashedAt).toBe(FIXED_NOW.toISOString());
      // 30-day recovery deadline (TRASH_RETENTION_MS).
      expect(item?.purgeAfter).toBe(new Date("2026-09-08T12:00:00.000Z").toISOString());
    }
    expect((await db.items.get(untouched.itemId))?.lifecycle).toBe("active");
  });

  it("rejects trashing an item that is already trashed", async () => {
    const { itemId } = await createItem("page", "Once", null);
    await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.trash",
        payload: { itemId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );

    const second = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.trash",
        payload: { itemId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("item.not-found");
    }
  });

  it("rejects trashing an unknown item", async () => {
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.trash",
        payload: { itemId: generateUuidV7() },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });
});

describe("item.restore", () => {
  it("restores every member trashed by the same action", async () => {
    const root = await createItem("folder", "Root", null);
    const child = await createItem("page", "Child", root.itemId);
    await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.trash",
        payload: { itemId: root.itemId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.restore",
        payload: { itemId: root.itemId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);

    for (const id of [root.itemId, child.itemId]) {
      const item = await db.items.get(id);
      expect(item?.lifecycle).toBe("active");
      expect(item?.trashedAt).toBeNull();
      expect(item?.purgeAfter).toBeNull();
    }
  });

  it("rejects restoring an item that is not trashed", async () => {
    const { itemId } = await createItem("page", "Active", null);
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.restore",
        payload: { itemId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });
});

describe("relationship commands", () => {
  it("rejects direct creation of the page:link relation reserved for documents", async () => {
    const source = await createItem("page", "Source", null);
    const target = await createItem("page", "Target", null);
    const relationshipId = generateUuidV7();
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.create",
        payload: {
          id: relationshipId,
          sourceItemId: source.itemId,
          targetItemId: target.itemId,
          relationType: "page:link",
        },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    expect(await db.relationships.get(relationshipId)).toBeUndefined();
  });

  it("creates a typed relationship with metadata", async () => {
    const source = await createItem("page", "Source", null);
    const target = await createItem("page", "Target", null);
    const relationshipId = generateUuidV7();

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.create",
        payload: {
          id: relationshipId,
          sourceItemId: source.itemId,
          targetItemId: target.itemId,
          relationType: "link",
          metadata: { label: "see also" },
        },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);

    const relationship = await db.relationships.get(relationshipId);
    expect(relationship?.relationType).toBe("link");
    expect(relationship?.metadata).toEqual({ label: "see also" });
  });

  it("defaults missing metadata to an empty object", async () => {
    const source = await createItem("page", "Source", null);
    const target = await createItem("page", "Target", null);
    const relationshipId = generateUuidV7();

    await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.create",
        payload: {
          id: relationshipId,
          sourceItemId: source.itemId,
          targetItemId: target.itemId,
          relationType: "link",
        },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect((await db.relationships.get(relationshipId))?.metadata).toEqual({});
  });

  it("removes an existing relationship", async () => {
    const source = await createItem("page", "Source", null);
    const target = await createItem("page", "Target", null);
    const relationshipId = generateUuidV7();
    await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.create",
        payload: {
          id: relationshipId,
          sourceItemId: source.itemId,
          targetItemId: target.itemId,
          relationType: "link",
        },
        baseRevisionIds: [],
      },
      now,
      codec,
    );

    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.remove",
        payload: { relationshipId },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(true);
    expect(await db.relationships.get(relationshipId)).toBeUndefined();
  });

  it("rejects removing a relationship that is not available locally", async () => {
    const result = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "relationship.remove",
        payload: { relationshipId: generateUuidV7() },
        baseRevisionIds: [],
      },
      now,
      codec,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });
});

describe("item.convert page-link projection", () => {
  it("destroys a source document and its outgoing page-link index together", async () => {
    const source = await createItem("page", "Source", null);
    const target = await createItem("page", "Target", null);
    const sourceBase = (await readItem(source.itemId))?.currentRevisionId as Uuid;
    const linked = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "page.document.replace",
        payload: {
          itemId: source.itemId,
          baseRevisionId: sourceBase,
          document: {
            format: "myownnotion.document+json",
            formatVersion: 2,
            body: {
              blocks: [
                {
                  type: "paragraph",
                  id: generateUuidV7(),
                  content: [
                    {
                      text: "Target",
                      marks: [{ type: "pageLink", targetItemId: target.itemId }],
                    },
                  ],
                },
              ],
            },
          },
          pageLinkTargetIds: [target.itemId],
        },
        baseRevisionIds: [sourceBase],
      },
      now,
      codec,
    );
    expect(linked.ok).toBe(true);

    const current = await readItem(source.itemId);
    const converted = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.convert",
        payload: {
          itemId: source.itemId,
          targetKind: "folder",
          confirmedDestruction: true,
        },
        baseRevisionIds: [current?.currentRevisionId as Uuid],
      },
      now,
      codec,
    );
    expect(converted.ok).toBe(true);
    expect(await readItem(source.itemId)).toMatchObject({ kind: "folder", pageDocument: null });
    expect(
      (await db.relationships.toArray()).filter(
        (relationship) =>
          relationship.sourceItemId === source.itemId && relationship.relationType === "page:link",
      ),
    ).toHaveLength(0);
  });
});

describe("commands with no offline semantics", () => {
  // These parse as valid commands but the offline applier must refuse them
  // rather than guess at a local outcome it cannot reproduce.
  const unsupported: ReadonlyArray<{ type: string; payload: Record<string, unknown> }> = [
    { type: "placement.remove", payload: { placementId: generateUuidV7() } },
    {
      type: "file.placement.add",
      payload: {
        itemId: generateUuidV7(),
        kind: "hierarchy",
        parentItemId: null,
        positionKey: "V",
      },
    },
    {
      type: "revision.restore",
      payload: { revisionId: generateUuidV7(), currentRevisionId: generateUuidV7() },
    },
  ];

  for (const { type, payload } of unsupported) {
    it(`refuses ${type} offline without partial writes`, async () => {
      const result = await applyLocalMutation(
        db,
        { mutationId: generateUuidV7(), commandType: type, payload, baseRevisionIds: [] },
        now,
        codec,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation.invalid-payload");
      }
      expect(await db.outbox.count()).toBe(0);
      expect(await db.revisionHeaders.count()).toBe(0);
    });
  }
});
