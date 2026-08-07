/**
 * 10,000-item / 1,000-operation performance suite (T089).
 *
 * Records timings for the plan's targets: common hierarchy reads and
 * single-item mutations within 150 ms p95 on the reference fixture, and the
 * randomized integrity suite completing without invariant failures.
 */

import {
  createDatabase,
  type DatabaseHandle,
  getActiveChildren,
  getOrCreateWorkspace,
  readItem,
  schema,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, initialKeys, keyBetween, type Uuid } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ITEM_COUNT = 10_000;
const OPERATIONS = 1_000;
const BRANCHING = 10;

let postgres: DisposablePostgres;
let handle: DatabaseHandle;
let workspaceId: Uuid;
const itemIds: Uuid[] = [];
const placementIds = new Map<string, Uuid>();

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] as number;
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
  const workspace = await getOrCreateWorkspace(handle.db);
  workspaceId = workspace.id;

  // Reference fixture: bulk load 10,000 items.
  const keys = initialKeys(BRANCHING);
  const mutationId = generateUuidV7();
  await handle.db.insert(schema.mutations).values({
    id: mutationId,
    workspaceId,
    commandType: "fixture.load",
    status: "accepted",
    submittedAt: new Date(),
    acceptedAt: new Date(),
    resultRevisionIds: [generateUuidV7()],
  });
  const itemRows: Array<typeof schema.items.$inferInsert> = [];
  const revisionRows: Array<typeof schema.revisions.$inferInsert> = [];
  const placementRows: Array<typeof schema.placements.$inferInsert> = [];
  for (let index = 0; index < ITEM_COUNT; index += 1) {
    const id = generateUuidV7();
    const revisionId = generateUuidV7();
    const parent = index === 0 ? null : (itemIds[Math.floor((index - 1) / BRANCHING)] as Uuid);
    const kind = index % 3 === 0 ? "folder" : "page";
    itemIds.push(id);
    itemRows.push({ id, workspaceId, kind, name: `Perf ${index}`, currentRevisionId: revisionId });
    revisionRows.push({ id: revisionId, itemId: id, mutationId, snapshot: {}, lineageDigest: "f" });
    const placementId = generateUuidV7();
    placementIds.set(id, placementId);
    placementRows.push({
      id: placementId,
      workspaceId,
      itemId: id,
      itemKind: kind,
      kind: "hierarchy",
      parentItemId: parent,
      positionKey: `${keys[index % BRANCHING] as string}${index.toString(36)}`,
      createdRevisionId: revisionId,
    });
  }
  await handle.db.transaction(async (tx) => {
    for (let offset = 0; offset < ITEM_COUNT; offset += 1000) {
      await tx.insert(schema.items).values(itemRows.slice(offset, offset + 1000));
      await tx.insert(schema.revisions).values(revisionRows.slice(offset, offset + 1000));
      await tx.insert(schema.placements).values(placementRows.slice(offset, offset + 1000));
    }
  });
}, 600_000);

afterAll(async () => {
  await handle.close();
  await postgres.stop();
});

describe("reference performance (plan targets)", () => {
  it("common hierarchy reads stay within 150ms p95", async () => {
    const samples: number[] = [];
    for (let run = 0; run < 100; run += 1) {
      const parent = itemIds[run % 500] as Uuid;
      const started = performance.now();
      await handle.db.transaction(async (tx) => {
        await getActiveChildren(tx, parent);
      });
      samples.push(performance.now() - started);
    }
    const p95 = percentile(samples, 0.95);
    console.info(`[perf] children read p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(150);
  });

  it("single-item reads stay within 150ms p95", async () => {
    const samples: number[] = [];
    for (let run = 0; run < 100; run += 1) {
      const id = itemIds[(run * 97) % ITEM_COUNT] as Uuid;
      const started = performance.now();
      await readItem(handle.db, id);
      samples.push(performance.now() - started);
    }
    const p95 = percentile(samples, 0.95);
    console.info(`[perf] item read p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(150);
  });

  it("1,000 randomized mutations complete with zero invariant failures and p95 <150ms", async () => {
    const samples: number[] = [];
    let accepted = 0;
    let rejected = 0;
    for (let op = 0; op < OPERATIONS; op += 1) {
      const itemId = itemIds[(op * 31) % ITEM_COUNT] as Uuid;
      const started = performance.now();
      if (op % 2 === 0) {
        const outcome = await submitMutation(handle.db, {
          workspaceId,
          mutationId: generateUuidV7(),
          commandType: "item.rename",
          command: { type: "item.rename", itemId, name: `Perf renamed ${op}` },
        });
        if (outcome.result.status === "accepted") {
          accepted += 1;
        } else {
          rejected += 1;
        }
      } else {
        const target = itemIds[(op * 61 + 13) % ITEM_COUNT] as Uuid;
        const outcome = await submitMutation(handle.db, {
          workspaceId,
          mutationId: generateUuidV7(),
          commandType: "placement.move",
          command: {
            type: "placement.move",
            placementId: placementIds.get(itemId) as Uuid,
            parentItemId: target,
            positionKey: keyBetween(null, null) + op.toString(36),
          },
        });
        if (outcome.result.status === "accepted") {
          accepted += 1;
        } else {
          rejected += 1;
          // Only legal rejections: cycles or non-container parents.
          expect([
            "containment.cycle-rejected",
            "containment.parent-not-container",
            "containment.file-cannot-contain",
            "item.not-active",
          ]).toContain(outcome.result.problem?.code);
        }
      }
      samples.push(performance.now() - started);
    }
    const p95 = percentile(samples, 0.95);
    console.info(
      `[perf] 1000 mutations: accepted=${accepted} rejected=${rejected} p95=${p95.toFixed(1)}ms`,
    );
    expect(accepted + rejected).toBe(OPERATIONS);
    expect(accepted).toBeGreaterThan(0);
    expect(p95).toBeLessThan(150);

    // Integrity: every identity still resolves.
    const count = await handle.db.select({ id: schema.items.id }).from(schema.items);
    expect(count.length).toBe(ITEM_COUNT);
  }, 600_000);
});
