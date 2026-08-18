/**
 * A resolution descends from both versions it resolved (T023, US3, FR-016).
 *
 * This is the test that makes "the original versions are kept" checkable. The
 * requirement could be satisfied by a retention policy — keep both snapshots for
 * a while — and that reading is the one to rule out: a policy is something a
 * pruning job can forget, whereas an ancestor is a fact about the graph that
 * nothing later removes. So the assertions are about parent edges, not about what
 * happens to survive in a snapshot column.
 */

import { getRevision, loadParentEdges, submitMutation } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
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

/**
 * One paragraph, always the same block identity.
 *
 * Stable on purpose: a merge is about what happened to *a* block, so two texts
 * under one id is the shape that produces the divergence these tests are about.
 */
const BLOCK_ID = "018f2b7c-0000-7000-8000-0000000b10c1";

function blocks(text: string) {
  return {
    format: "myownnotion.document+json" as const,
    formatVersion: 1 as const,
    body: {
      blocks: [{ id: BLOCK_ID, type: "paragraph", content: [{ text }] }],
    },
  };
}

async function createPage(name: string): Promise<{ itemId: Uuid; revisionId: Uuid }> {
  counter += 1;
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "page",
      name,
      placement: {
        kind: "hierarchy",
        parentItemId: null,
        positionKey: `V${counter.toString(36)}z`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return { itemId: id, revisionId: (outcome.result.revisionIds as Uuid[])[0] as Uuid };
}

async function edit(itemId: Uuid, baseRevisionId: Uuid, text: string): Promise<Uuid> {
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "page.document.replace",
    command: {
      type: "page.document.replace",
      itemId,
      baseRevisionId,
      document: blocks(text),
      pageLinkTargetIds: [],
    },
  });
  expect(outcome.result.status, JSON.stringify(outcome.result)).toBe("accepted");
  return (outcome.result.revisionIds as Uuid[])[0] as Uuid;
}

async function resolve(
  itemId: Uuid,
  resolvedRevisionIds: readonly [Uuid, Uuid],
  text: string,
): Promise<{
  status: string;
  revisionId: Uuid | undefined;
  competing: readonly string[] | undefined;
}> {
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "document.resolve-conflict",
    command: {
      type: "document.resolve-conflict",
      itemId,
      resolvedRevisionIds,
      document: blocks(text),
      pageLinkTargetIds: [],
    },
  });
  return {
    status: outcome.result.status,
    revisionId: (outcome.result.revisionIds as Uuid[] | undefined)?.[0],
    competing: outcome.result.competingRevisionIds,
  };
}

describe("resolving a divergence", () => {
  it("produces a revision whose parents are both resolved versions", async () => {
    const page = await createPage("Diverged page");
    // One line of work on the server. The other exists only on the other device
    // and never reached this database, which is exactly the situation: its
    // revision id is the one the refusal named.
    const serverRevision = await edit(page.itemId, page.revisionId, "written on the server");

    const resolution = await resolve(
      page.itemId,
      [serverRevision, page.revisionId],
      "what the owner assembled",
    );
    expect(resolution.status).toBe("accepted");

    const parents = await context.handle.db.transaction(async (tx) =>
      loadParentEdges(tx, [resolution.revisionId as Uuid]),
    );
    const edges = parents.get(resolution.revisionId as string) ?? [];
    // Two, and both of them. One parent would make the resolution look like an
    // ordinary edit and would leave one version reachable only by luck.
    expect([...edges].sort()).toEqual([serverRevision, page.revisionId].sort());
  });

  it("leaves both resolved revisions readable, unaltered", async () => {
    const page = await createPage("Both kept");
    const serverRevision = await edit(page.itemId, page.revisionId, "server text");
    const before = await context.handle.db.transaction(async (tx) =>
      getRevision(tx, serverRevision),
    );

    await resolve(page.itemId, [serverRevision, page.revisionId], "merged text");

    const after = await context.handle.db.transaction(async (tx) =>
      getRevision(tx, serverRevision),
    );
    expect(after).not.toBeNull();
    // The resolution produced a new version without altering its sources. A
    // resolution that edited either one would destroy the record of what the
    // owner was actually choosing between.
    expect(after?.snapshot).toEqual(before?.snapshot);
    expect(after?.parentRevisionIds).toEqual(before?.parentRevisionIds);
  });

  it("becomes the head, so the next ordinary edit builds on it", async () => {
    const page = await createPage("Head after resolution");
    const serverRevision = await edit(page.itemId, page.revisionId, "server text");
    const resolution = await resolve(page.itemId, [serverRevision, page.revisionId], "merged text");

    // The proof that the resolution is the head: an edit based on it is accepted.
    // An edit based on the version that lost would be refused as stale, which is
    // what "no data is destroyed before resolution, and the resolution is the new
    // state" has to mean in practice.
    const next = await edit(page.itemId, resolution.revisionId as Uuid, "after the resolution");
    expect(next).toBeDefined();
  });

  it("refuses a resolution whose head moved again while the owner was choosing", async () => {
    const page = await createPage("Moved again");
    const serverRevision = await edit(page.itemId, page.revisionId, "server text");
    // A third version appears — another device, or the same one in another tab —
    // after the comparison was prepared.
    const third = await edit(page.itemId, serverRevision, "and again");

    const resolution = await resolve(
      page.itemId,
      [serverRevision, page.revisionId],
      "based on a comparison that is now out of date",
    );
    // Refused rather than merged in. The owner reviewed two versions and would be
    // committing over a third they were never shown.
    expect(resolution.status).toBe("conflict");
    expect(resolution.competing).toEqual([third]);
  });
});
