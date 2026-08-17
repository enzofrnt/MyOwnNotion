/**
 * Favourites against a real database (feature 003, FR-012).
 *
 * The domain suite settles what the rule is. This one settles two things only a
 * database can answer, and both of them are the reason favourites are stored
 * server-side rather than beside the expanded branches in the browser:
 *
 *   - **the mark is durable and reaches the projection**, because it travels in
 *     the item's revision snapshot — an attribute the snapshot omits is an
 *     attribute the owner's other devices never learn about;
 *   - **replaying the same command is a no-op**, which is what makes it safe
 *     for the offline outbox to submit it more than once.
 */

import { schema, submitMutation } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
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

async function createPage(positionKey: string): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "page",
      name: `page-${positionKey}`,
      placement: { kind: "hierarchy", parentItemId: null, positionKey },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function setFavourite(itemId: Uuid, favourite: boolean) {
  return submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.favourite",
    command: { type: "item.favourite", itemId, favourite },
  });
}

async function readItem(itemId: Uuid) {
  const [row] = await context.handle.db
    .select()
    .from(schema.items)
    .where(eq(schema.items.id, itemId));
  return row;
}

describe("marking a favourite", () => {
  it("stores the mark and clears it again", async () => {
    const itemId = await createPage("Fa");
    expect((await readItem(itemId))?.favourite).toBe(false);

    expect((await setFavourite(itemId, true)).result.status).toBe("accepted");
    expect((await readItem(itemId))?.favourite).toBe(true);

    expect((await setFavourite(itemId, false)).result.status).toBe("accepted");
    expect((await readItem(itemId))?.favourite).toBe(false);
  });

  it("puts the mark in the revision snapshot the projection is fed from", async () => {
    const itemId = await createPage("Fb");
    await setFavourite(itemId, true);
    const item = await readItem(itemId);

    const currentRevisionId = item?.currentRevisionId;
    expect(currentRevisionId).toBeDefined();
    const [revision] = await context.handle.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.id, currentRevisionId as Uuid));

    // The claim that makes favourites per-installation rather than per-device.
    // If this were absent, the mark would exist in the database and be invisible
    // on every other device — the exact failure the spec rules out.
    const snapshot = revision?.snapshot as { favourite?: boolean } | undefined;
    expect(snapshot?.favourite).toBe(true);
  });

  it("is a no-op when the item is already in that state", async () => {
    const itemId = await createPage("Fc");
    await setFavourite(itemId, true);
    const afterFirst = await readItem(itemId);

    expect((await setFavourite(itemId, true)).result.status).toBe("accepted");
    const afterSecond = await readItem(itemId);

    // Accepted rather than refused, because the outbox replays and a refusal
    // there would surface to the owner as a failure they cannot act on. The
    // state is what they asked for either way.
    expect(afterSecond?.favourite).toBe(true);
    // A second revision is written — the command went through the ordinary
    // lineage — but the answer did not change, which is what idempotent means
    // here.
    expect(afterSecond?.currentRevisionId).not.toBe(afterFirst?.currentRevisionId);
  });

  it("refuses a trashed item", async () => {
    const itemId = await createPage("Fd");
    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.trash",
      command: { type: "item.trash", itemId },
    });

    const outcome = await setFavourite(itemId, true);
    expect(outcome.result.status).toBe("rejected");
    expect((await readItem(itemId))?.favourite).toBe(false);
  });
});

describe("keeping an item available offline", () => {
  it("stores the instruction and clears it again", async () => {
    const itemId = await createPage("Oa");
    expect((await readItem(itemId))?.offlineIntent).toBe(false);

    const marked = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.offline",
      command: { type: "item.offline", itemId, offline: true },
    });
    expect(marked.result.status).toBe("accepted");
    expect((await readItem(itemId))?.offlineIntent).toBe(true);

    const cleared = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.offline",
      command: { type: "item.offline", itemId, offline: false },
    });
    expect(cleared.result.status).toBe("accepted");
    expect((await readItem(itemId))?.offlineIntent).toBe(false);
  });

  it("puts the instruction in the revision snapshot, so every device learns it", async () => {
    const itemId = await createPage("Ob");
    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.offline",
      command: { type: "item.offline", itemId, offline: true },
    });

    const item = await readItem(itemId);
    const currentRevisionId = item?.currentRevisionId;
    expect(currentRevisionId).toBeDefined();
    const [revision] = await context.handle.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.id, currentRevisionId as Uuid));

    // The projection on every other device is fed from these. An instruction
    // outside the lineage would stay on the device that gave it, which is the
    // opposite of what "keep this available" means for an owner with a laptop
    // and a phone.
    const snapshot = revision?.snapshot as { offlineIntent?: boolean } | undefined;
    expect(snapshot?.offlineIntent).toBe(true);
  });

  it("refuses a trashed item", async () => {
    const itemId = await createPage("Oc");
    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.trash",
      command: { type: "item.trash", itemId },
    });

    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.offline",
      command: { type: "item.offline", itemId, offline: true },
    });
    expect(outcome.result.status).toBe("rejected");
  });
});
