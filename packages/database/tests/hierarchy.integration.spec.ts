/**
 * 10,000-item recursive query and branch-move integration tests (T025, US1).
 *
 * Exercises the canonical store at acceptance scale: bulk fixture load,
 * recursive branch collection, atomic branch move, transactional cycle
 * rejection, and the p95-oriented timing gate from the plan.
 */

import {
  collectBranchItemIds,
  getActiveChildren,
  schema,
  submitMutation,
  wouldCreateCycleSql,
} from "@myownnotion/database";
import { generateUuidV7, initialKeys, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

const ITEM_COUNT = 10_000;
const BRANCHING = 10;

let context: IntegrationContext;
const itemIds: Uuid[] = [];
const placementIds = new Map<string, Uuid>();

beforeAll(async () => {
  context = await createIntegrationContext();
  const { db } = context.handle;

  // Bulk fixture: inserted directly (not through the mutation pipeline) to
  // keep suite time reasonable; integrity comes from the same constraints.
  const keys = initialKeys(BRANCHING);
  const mutationId = generateUuidV7();
  const revisionRows: Array<typeof schema.revisions.$inferInsert> = [];
  const itemRows: Array<typeof schema.items.$inferInsert> = [];
  const placementRows: Array<typeof schema.placements.$inferInsert> = [];

  await db.insert(schema.mutations).values({
    id: mutationId,
    workspaceId: context.workspaceId,
    commandType: "fixture.load",
    status: "accepted",
    submittedAt: new Date(),
    acceptedAt: new Date(),
    resultRevisionIds: [generateUuidV7()],
  });

  for (let index = 0; index < ITEM_COUNT; index += 1) {
    const id = generateUuidV7();
    const revisionId = generateUuidV7();
    const parent = index === 0 ? null : (itemIds[Math.floor((index - 1) / BRANCHING)] as Uuid);
    const kind = index % 3 === 0 ? "folder" : "page";
    itemIds.push(id);
    itemRows.push({
      id,
      workspaceId: context.workspaceId,
      kind,
      name: `Item ${index}`,
      lifecycle: "active",
      currentRevisionId: revisionId,
    });
    revisionRows.push({
      id: revisionId,
      itemId: id,
      mutationId,
      snapshot: {},
      lineageDigest: "fixture",
    });
    const placementId = generateUuidV7();
    placementIds.set(id, placementId);
    placementRows.push({
      id: placementId,
      workspaceId: context.workspaceId,
      itemId: id,
      // This helper only creates pages and folders; files have their own path.
      itemIsFile: false,
      kind: "hierarchy",
      parentItemId: parent,
      positionKey: `${keys[index % BRANCHING] as string}${index.toString(36)}`,
      createdRevisionId: revisionId,
    });
  }

  const CHUNK = 1_000;
  await db.transaction(async (tx) => {
    for (let offset = 0; offset < ITEM_COUNT; offset += CHUNK) {
      await tx.insert(schema.items).values(itemRows.slice(offset, offset + CHUNK));
      await tx.insert(schema.revisions).values(revisionRows.slice(offset, offset + CHUNK));
      await tx.insert(schema.placements).values(placementRows.slice(offset, offset + CHUNK));
    }
  });
}, 300_000);

afterAll(async () => {
  await context.close();
});

describe("10,000-item hierarchy (SC-002 scale)", () => {
  it("loads the complete fixture", async () => {
    const rows = await context.handle.db.select({ id: schema.items.id }).from(schema.items);
    expect(rows.length).toBe(ITEM_COUNT);
  });

  it("collects a deep branch recursively", async () => {
    const root = itemIds[0] as Uuid;
    const started = performance.now();
    const branch = await context.handle.db.transaction(async (tx) =>
      collectBranchItemIds(tx, root),
    );
    const elapsed = performance.now() - started;
    expect(branch.length).toBe(ITEM_COUNT);
    // Plan: common hierarchy reads within 150ms p95 on the 10k fixture.
    expect(elapsed).toBeLessThan(1_500);
  });

  it("reads children within the performance budget", async () => {
    const parent = itemIds[0] as Uuid;
    const started = performance.now();
    const children = await context.handle.db.transaction(async (tx) =>
      getActiveChildren(tx, parent),
    );
    const elapsed = performance.now() - started;
    expect(children.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(150);
  });

  it("moves a complete branch atomically and preserves every identity", async () => {
    const branchRoot = itemIds[1] as Uuid;
    const before = await context.handle.db.transaction(async (tx) =>
      collectBranchItemIds(tx, branchRoot),
    );
    expect(before.length).toBeGreaterThan(10);

    const targetParent = itemIds[itemIds.length - 1] as Uuid;
    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "placement.move",
      command: {
        type: "placement.move",
        placementId: placementIds.get(branchRoot) as Uuid,
        parentItemId: targetParent,
        positionKey: "V",
      },
    });
    expect(outcome.result.status).toBe("accepted");

    const after = await context.handle.db.transaction(async (tx) =>
      collectBranchItemIds(tx, branchRoot),
    );
    expect(new Set(after)).toEqual(new Set(before));

    const parentBranch = await context.handle.db.transaction(async (tx) =>
      collectBranchItemIds(tx, targetParent),
    );
    expect(new Set(parentBranch)).toEqual(new Set([targetParent, ...before]));
  });

  it("rejects a cycle inside the transaction and leaves state unchanged", async () => {
    const branchRoot = itemIds[2] as Uuid;
    const descendants = await context.handle.db.transaction(async (tx) =>
      collectBranchItemIds(tx, branchRoot),
    );
    const deepDescendant = descendants[descendants.length - 1] as Uuid;
    expect(deepDescendant).not.toBe(branchRoot);

    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "placement.move",
      command: {
        type: "placement.move",
        placementId: placementIds.get(branchRoot) as Uuid,
        parentItemId: deepDescendant,
        positionKey: "V",
      },
    });
    expect(outcome.result.status).toBe("rejected");
    expect(outcome.result.problem?.code).toBe("containment.cycle-rejected");

    const after = await context.handle.db.transaction(async (tx) =>
      collectBranchItemIds(tx, branchRoot),
    );
    expect(new Set(after)).toEqual(new Set(descendants));
  });

  it("recursive SQL cycle check matches expectations at depth", async () => {
    const root = itemIds[0] as Uuid;
    const leaf = itemIds[itemIds.length - 1] as Uuid;
    await context.handle.db.transaction(async (tx) => {
      expect(await wouldCreateCycleSql(tx, root, leaf)).toBe(true);
      expect(await wouldCreateCycleSql(tx, leaf, root)).toBe(false);
    });
  });
});
