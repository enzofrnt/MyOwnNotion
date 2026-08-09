/**
 * 24-hour retention, conflict protection, restore-as-descendant, and pruning
 * integration tests (T078, US5, SC-008).
 */

import { getRevision, loadParentEdges, schema, submitMutation } from "@myownnotion/database";
import {
  classifyLineage,
  generateUuidV7,
  REVISION_SNAPSHOT_RETENTION_MS,
  type Uuid,
} from "@myownnotion/domain";
import { eq, isNull } from "drizzle-orm";
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
        positionKey: `V${counter.toString(36)}x`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return { itemId: id, revisionId: (outcome.result.revisionIds as Uuid[])[0] as Uuid };
}

async function editPage(itemId: Uuid, baseRevisionId: Uuid, text: string): Promise<Uuid> {
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "page.document.replace",
    command: {
      type: "page.document.replace",
      itemId,
      baseRevisionId,
      document: { format: "myownnotion.document+json", formatVersion: 1, body: { text } },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return (outcome.result.revisionIds as Uuid[])[0] as Uuid;
}

describe("supersession stamps the 24-hour retention window (FR-026)", () => {
  it("the superseded head gains snapshot_expires_at = acceptedAt + 24h", async () => {
    const page = await createPage("Retention page");
    const second = await editPage(page.itemId, page.revisionId, "v2");

    const superseded = await context.handle.db.transaction(async (tx) =>
      getRevision(tx, page.revisionId),
    );
    const head = await context.handle.db.transaction(async (tx) => getRevision(tx, second));
    expect(superseded?.snapshotExpiresAt).not.toBeNull();
    expect(head?.snapshotExpiresAt).toBeNull();
    const acceptedAt = Date.parse(head?.acceptedAt as string);
    const expiry = Date.parse(superseded?.snapshotExpiresAt as string);
    expect(expiry - acceptedAt).toBe(REVISION_SNAPSHOT_RETENTION_MS);
    // Complete content remains restorable throughout the window.
    expect(superseded?.snapshot).not.toBeNull();
  });
});

describe("restore-as-new-descendant (FR: history never rewritten)", () => {
  it("restoring a retained revision creates a descendant of the current head", async () => {
    const page = await createPage("Restore lineage");
    const v2 = await editPage(page.itemId, page.revisionId, "v2");
    const v3 = await editPage(page.itemId, v2, "v3");

    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "revision.restore",
      command: {
        type: "revision.restore",
        revisionId: page.revisionId, // restore the original content
        currentRevisionId: v3,
      },
    });
    expect(outcome.result.status).toBe("accepted");
    const restored = (outcome.result.revisionIds as Uuid[])[0] as Uuid;

    const header = await context.handle.db.transaction(async (tx) => getRevision(tx, restored));
    // Parent is the current head, never the historical source.
    expect(header?.parentRevisionIds).toEqual([v3]);

    // Ancestry is intact: original < v2 < v3 < restored.
    const edges = await context.handle.db.transaction(async (tx) =>
      loadParentEdges(tx, [restored]),
    );
    const getParents = (id: Uuid) => edges.get(id) ?? [];
    expect(classifyLineage(page.revisionId, restored, getParents)).toBe("left-ancestor");
    expect(classifyLineage(v3, restored, getParents)).toBe("left-ancestor");
  });

  it("a stale head produces an explicit concurrency conflict", async () => {
    const page = await createPage("Stale restore");
    const v2 = await editPage(page.itemId, page.revisionId, "v2");
    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "revision.restore",
      command: {
        type: "revision.restore",
        revisionId: page.revisionId,
        currentRevisionId: page.revisionId, // stale: actual head is v2
      },
    });
    expect(outcome.result.status).toBe("conflict");
    expect(outcome.result.competingRevisionIds).toEqual([v2]);
  });
});

describe("pruning preserves headers and classification (FR-027, SC-008)", () => {
  it("classification survives snapshot pruning", async () => {
    const page = await createPage("Pruned lineage");
    const v2 = await editPage(page.itemId, page.revisionId, "v2");
    const v3 = await editPage(page.itemId, v2, "v3");

    // Deterministic eligibility: simulate the retention worker by pruning
    // the superseded snapshot after its window (test clock advance).
    await context.handle.db
      .update(schema.revisions)
      .set({ snapshot: null })
      .where(eq(schema.revisions.id, page.revisionId));

    const pruned = await context.handle.db.transaction(async (tx) =>
      getRevision(tx, page.revisionId),
    );
    expect(pruned?.snapshot).toBeNull();
    // Header and parent edges survive.
    expect(pruned?.id).toBe(page.revisionId);

    const edges = await context.handle.db.transaction(async (tx) => loadParentEdges(tx, [v3]));
    const getParents = (id: Uuid) => edges.get(id) ?? [];
    expect(classifyLineage(page.revisionId, v3, getParents)).toBe("left-ancestor");
    expect(classifyLineage(v3, page.revisionId, getParents)).toBe("right-ancestor");
    expect(classifyLineage(v2, v3, getParents)).toBe("left-ancestor");
  });

  it("restoring a pruned snapshot is rejected as expired", async () => {
    const page = await createPage("Expired restore");
    const v2 = await editPage(page.itemId, page.revisionId, "v2");
    await context.handle.db
      .update(schema.revisions)
      .set({ snapshot: null })
      .where(eq(schema.revisions.id, page.revisionId));

    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "revision.restore",
      command: {
        type: "revision.restore",
        revisionId: page.revisionId,
        currentRevisionId: v2,
      },
    });
    expect(outcome.result.status).toBe("rejected");
    expect(outcome.result.problem?.code).toBe("revision.snapshot-expired");
  });

  it("current heads never carry an expiry (protected from pruning)", async () => {
    const rows = await context.handle.db
      .select()
      .from(schema.revisions)
      .where(isNull(schema.revisions.snapshotExpiresAt));
    // Every current head is in this set; verify one known head.
    const page = await createPage("Head check");
    const heads = await context.handle.db
      .select()
      .from(schema.revisions)
      .where(eq(schema.revisions.id, page.revisionId));
    expect(heads[0]?.snapshotExpiresAt).toBeNull();
    expect(rows.length).toBeGreaterThan(0);
  });
});
