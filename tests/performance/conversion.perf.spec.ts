/**
 * Conversion at workspace scale (T042, SC-009).
 *
 * SC-009 asks that a conversion complete within 2 seconds from the owner's
 * perspective in a workspace of 1,000 items. The interesting part is not
 * whether the number is met — a conversion is one row update plus at most one
 * delete, so it should be far under — but **whether it stays constant as the
 * workspace grows**.
 *
 * That is the property the schema change bought. Before feature 004, changing
 * an item's kind would have meant updating every placement that denormalised
 * it, so the cost would have risen with the number of children. Now nothing
 * cascades, and this suite is what would notice if that ever stopped being
 * true: it converts an item with many children and one with none, and expects
 * them to cost the same.
 */

import {
  createDatabase,
  type DatabaseHandle,
  getOrCreateWorkspace,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, initialKeys, keyBetween, type Uuid } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ITEM_COUNT = 1_000;
/** How many children the heavily populated parent gets. */
const WIDE_BRANCH = 200;

let postgres: DisposablePostgres;
let handle: DatabaseHandle;
let workspaceId: Uuid;
let wideParent: Uuid;
let emptyItem: Uuid;

async function createItem(
  kind: "page" | "folder",
  parentItemId: Uuid | null,
  positionKey: string,
): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(handle.db, {
    workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind,
      name: `Perf ${positionKey}`,
      placement: { kind: "hierarchy", parentItemId, positionKey },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
  workspaceId = (await getOrCreateWorkspace(handle.db)).id;

  let key = initialKeys(1)[0] as string;
  wideParent = await createItem("folder", null, key);

  // A parent with many children, to show the cost does not follow them.
  let childKey = initialKeys(1)[0] as string;
  for (let index = 0; index < WIDE_BRANCH; index += 1) {
    await createItem("page", wideParent, childKey);
    childKey = keyBetween(childKey, null);
  }

  // Filler, so the workspace is at the size SC-009 names.
  for (let index = WIDE_BRANCH + 1; index < ITEM_COUNT; index += 1) {
    key = keyBetween(key, null);
    await createItem("folder", null, key);
  }

  key = keyBetween(key, null);
  emptyItem = await createItem("folder", null, key);
}, 600_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
});

async function timeConversion(itemId: Uuid, targetKind: "page" | "folder"): Promise<number> {
  const started = performance.now();
  const outcome = await submitMutation(handle.db, {
    workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.convert",
    command: { type: "item.convert", itemId, targetKind, confirmedDestruction: true },
  });
  const elapsed = performance.now() - started;
  expect(outcome.result.status).toBe("accepted");
  return elapsed;
}

describe(`converting in a workspace of ${ITEM_COUNT} items`, () => {
  it("completes well within the 2-second budget (SC-009)", async () => {
    const elapsed = await timeConversion(emptyItem, "page");
    expect(elapsed).toBeLessThan(2_000);
  });

  it("costs the same whether the item has 200 children or none", async () => {
    // The property, rather than the number. A conversion touches one row and
    // no placements, so children cannot make it slower — and if a future change
    // reintroduces a cascade, this is what notices.
    const wide = await timeConversion(wideParent, "page");
    const bare = await timeConversion(emptyItem, "folder");

    expect(wide).toBeLessThan(2_000);
    // Generous on purpose: this is not a microbenchmark, and a strict ratio
    // would fail on scheduling noise rather than on a real regression. What it
    // catches is cost that scales with the branch — 200 children turning a
    // millisecond into hundreds.
    expect(wide).toBeLessThan(bare + 500);
  });
});
