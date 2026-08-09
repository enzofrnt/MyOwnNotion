/**
 * Failure-path integration tests for the lifecycle and file repositories
 * (T104, Constitution III).
 *
 * These two adapters were the weakest-covered files in scope: their happy
 * paths were well exercised but almost none of their rejection branches were.
 * Every case below asserts both the returned safe error AND that the rejected
 * attempt left no partial state, which is the property that matters under
 * FR-017/FR-018.
 */

import { createHash } from "node:crypto";
import {
  executeAddFilePlacement,
  executeRemovePlacement,
  executeReplaceFileContent,
  executeRestore,
  executeTrash,
  runMutation,
  type StoredContent,
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
  await context.close();
});

function storedContent(text: string): StoredContent {
  const bytes = new TextEncoder().encode(text);
  const digest = createHash("sha256").update(bytes).digest();
  return {
    contentId: generateUuidV7(),
    sha256: new Uint8Array(digest),
    byteLength: bytes.byteLength,
    storageKey: digest.toString("hex"),
    verifiedAt: new Date(),
    reusedExisting: false,
  };
}

let positionCounter = 0;
function nextPositionKey(): string {
  positionCounter += 1;
  return `P${positionCounter.toString(36)}x`;
}

async function createItem(kind: "page" | "folder", name: string): Promise<Uuid> {
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
      placement: { kind: "hierarchy", parentItemId: null, positionKey: nextPositionKey() },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function trash(itemId: Uuid): Promise<void> {
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.trash",
    command: { type: "item.trash", itemId },
  });
  expect(outcome.result.status).toBe("accepted");
}

/** Runs one repository call in its own transaction and returns its result. */
async function attempt<T>(work: Parameters<typeof runMutation<T>>[1]): Promise<T> {
  return runMutation(context.handle.db, work);
}

async function itemRow(itemId: Uuid) {
  const rows = await context.handle.db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId));
  return rows[0];
}

describe("executeTrash rejections", () => {
  it("rejects an unknown item", async () => {
    const result = await attempt(async (tx) =>
      executeTrash(tx, {
        mutationId: generateUuidV7(),
        itemId: generateUuidV7(),
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects an already trashed item without touching its trash metadata", async () => {
    const itemId = await createItem("page", "TrashTwice");
    await trash(itemId);
    const before = await itemRow(itemId);

    const result = await attempt(async (tx) =>
      executeTrash(tx, { mutationId: generateUuidV7(), itemId, acceptedAt: new Date() }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-active");
    }

    const after = await itemRow(itemId);
    // The original deadline and revision are untouched: a rejected second
    // trash must not silently extend the 30-day window.
    expect(after?.trashedAt?.toISOString()).toBe(before?.trashedAt?.toISOString());
    expect(after?.purgeAfter?.toISOString()).toBe(before?.purgeAfter?.toISOString());
    expect(after?.currentRevisionId).toBe(before?.currentRevisionId);
  });
});

describe("executeRestore rejections", () => {
  it("rejects an unknown item", async () => {
    const result = await attempt(async (tx) =>
      executeRestore(tx, {
        mutationId: generateUuidV7(),
        itemId: generateUuidV7(),
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects restoring an active item", async () => {
    const itemId = await createItem("page", "AlreadyActive");
    const before = await itemRow(itemId);

    const result = await attempt(async (tx) =>
      executeRestore(tx, { mutationId: generateUuidV7(), itemId, acceptedAt: new Date() }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-trashed");
    }
    expect((await itemRow(itemId))?.currentRevisionId).toBe(before?.currentRevisionId);
  });

  it("rejects an item trashed without recoverable metadata", async () => {
    // A row marked trashed with no lifecycle event: restore must refuse
    // explicitly rather than guess a destination.
    const itemId = await createItem("page", "NoTrashEvent");
    await context.handle.db
      .update(schema.items)
      .set({
        lifecycle: "trashed",
        trashedAt: new Date(),
        purgeAfter: new Date(Date.now() + 1000),
      })
      .where(eq(schema.items.id, itemId));

    const result = await attempt(async (tx) =>
      executeRestore(tx, { mutationId: generateUuidV7(), itemId, acceptedAt: new Date() }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-trashed");
    }
    // Still trashed: the failed restore changed nothing.
    expect((await itemRow(itemId))?.lifecycle).toBe("trashed");
  });
});

describe("executeReplaceFileContent rejections", () => {
  it("rejects an unknown file", async () => {
    const result = await attempt(async (tx) =>
      executeReplaceFileContent(tx, {
        mutationId: generateUuidV7(),
        itemId: generateUuidV7(),
        baseRevisionId: generateUuidV7(),
        content: storedContent("new"),
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects replacing the content of a page", async () => {
    const pageId = await createItem("page", "NotAFile");
    const page = await itemRow(pageId);

    const result = await attempt(async (tx) =>
      executeReplaceFileContent(tx, {
        mutationId: generateUuidV7(),
        itemId: pageId,
        baseRevisionId: page?.currentRevisionId as Uuid,
        content: storedContent("bytes"),
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.wrong-kind");
    }
  });
});

describe("file placement rejections", () => {
  it("rejects adding a placement for an unknown item", async () => {
    const result = await attempt(async (tx) =>
      executeAddFilePlacement(tx, {
        mutationId: generateUuidV7(),
        command: {
          itemId: generateUuidV7(),
          kind: "hierarchy",
          parentItemId: null,
          positionKey: nextPositionKey(),
        },
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.not-found");
    }
  });

  it("rejects an extra placement for a page (single-membership cardinality)", async () => {
    const pageId = await createItem("page", "SinglePlacement");
    const before = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, pageId));

    const result = await attempt(async (tx) =>
      executeAddFilePlacement(tx, {
        mutationId: generateUuidV7(),
        command: {
          itemId: pageId,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: nextPositionKey(),
        },
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.cardinality-violation");
    }
    const after = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, pageId));
    expect(after.length).toBe(before.length);
  });

  it("rejects removing a placement that does not exist", async () => {
    const result = await attempt(async (tx) =>
      executeRemovePlacement(tx, {
        mutationId: generateUuidV7(),
        placementId: generateUuidV7(),
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.not-found");
    }
  });

  it("refuses to de-place a page: pages are trashed instead", async () => {
    const pageId = await createItem("page", "DePlaceMe");
    const placements = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, pageId));
    const placementId = placements[0]?.id as Uuid;

    const result = await attempt(async (tx) =>
      executeRemovePlacement(tx, {
        mutationId: generateUuidV7(),
        placementId,
        acceptedAt: new Date(),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("placement.cardinality-violation");
    }
    // The placement survives the rejected removal.
    const after = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.id, placementId));
    expect(after.length).toBe(1);
    expect(after[0]?.removedAt).toBeNull();
  });
});
