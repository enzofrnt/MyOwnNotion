/**
 * The device budget, and what eviction actually does to a row (T034, T040, US4).
 *
 * The domain suite proves the *rule* never releases unsynchronized work. This
 * proves the code that applies it does what the rule decided — which is a
 * separate claim, and the one where an owner loses something: a correct plan
 * applied to the wrong rows is indistinguishable from a wrong plan.
 *
 * The assertion that matters most is what survives an offload: the row, its
 * title, and its metadata. An offload that removed the row would look to an
 * owner exactly like deletion.
 */

import {
  DEFAULT_LIMIT_BYTES,
  type LocalDatabase,
  measure,
  openLocalDatabase,
  readLimit,
  runEviction,
  writeLimit,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: LocalDatabase;

beforeEach(() => {
  db = openLocalDatabase(`budget-${generateUuidV7()}`);
});

afterEach(async () => {
  await db.delete();
});

function envelope(size: number) {
  return {
    format: "myownnotion.local.v1" as never,
    alg: "AES-GCM" as never,
    keyId: "test",
    nonce: "nonce",
    ciphertext: "x".repeat(size),
  };
}

/** A stored item that looks like something worth keeping or releasing. */
async function seedItem(input: {
  readonly kind: "page" | "file";
  readonly bodySize: number;
  readonly offlineIntent?: boolean;
}): Promise<Uuid> {
  const id = generateUuidV7();
  await db.items.put({
    id,
    kind: input.kind,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    offlineIntent: input.offlineIntent ?? false,
    localAvailability: "present",
    sealedName: envelope(8),
    sealedPageBody: input.kind === "page" ? envelope(input.bodySize) : null,
    sealedFile: input.kind === "file" ? envelope(input.bodySize) : null,
    hasPageDocument: input.kind === "page" ? 1 : 0,
  } as never);
  return id;
}

describe("the configured limit", () => {
  it("defaults to 5 GB", async () => {
    expect(await readLimit(db)).toBe(DEFAULT_LIMIT_BYTES);
  });

  it("can be set, and unlimited is the absence of a limit rather than a big number", async () => {
    await writeLimit(db, 1000);
    expect(await readLimit(db)).toBe(1000);

    await writeLimit(db, null);
    // `null`, not a sentinel: any number chosen to mean "no limit" eventually
    // gets compared against.
    expect(await readLimit(db)).toBeNull();
  });
});

describe("what the panel is told", () => {
  it("reports a breakdown rather than only a total", async () => {
    await seedItem({ kind: "file", bodySize: 400 });
    await seedItem({ kind: "page", bodySize: 100 });

    const measurement = await measure(db);
    // FR-019 asks what is holding the space, because a total an owner cannot
    // act on is a number rather than an answer.
    expect(measurement.breakdown.length).toBeGreaterThan(1);
    expect(measurement.breakdown.some((entry) => /file/i.test(entry.label))).toBe(true);
    expect(measurement.measuredAt).not.toBe("");
  });
});

describe("offloading", () => {
  it("keeps the row, the title and the metadata, and drops the content", async () => {
    const page = await seedItem({ kind: "page", bodySize: 5000 });
    await writeLimit(db, 0);

    const released = await runEviction(db, {
      limitBytes: 0,
      usedBytes: 5000,
      persisted: false,
      measuredAt: new Date().toISOString(),
      breakdown: [],
    });

    expect(released.released).toContain(page);
    const row = await db.items.get(page);
    // The row survives. Removing it would look to an owner exactly like
    // deletion, which is what FR-018 exists to prevent.
    expect(row).toBeDefined();
    expect(row?.sealedName).toBeDefined();
    expect(row?.sealedPageBody).toBeNull();
    // And it says which of the three states it is in, rather than looking
    // identical to something never fetched.
    expect(row?.localAvailability).toBe("offloaded");
  });

  it("never releases an item the owner marked to keep", async () => {
    const kept = await seedItem({ kind: "file", bodySize: 9000, offlineIntent: true });

    const released = await runEviction(db, {
      limitBytes: 0,
      usedBytes: 9000,
      persisted: false,
      measuredAt: new Date().toISOString(),
      breakdown: [],
    });

    expect(released.released).not.toContain(kept);
    expect((await db.items.get(kept))?.sealedFile).not.toBeNull();
    // And it admits the limit was not met rather than claiming success.
    expect(released.stillOverLimit).toBe(true);
  });

  it("never releases an item with work waiting to be sent", async () => {
    const pending = await seedItem({ kind: "page", bodySize: 9000 });
    await db.outbox.put({
      mutationId: generateUuidV7(),
      commandType: "page.document.replace",
      payload: { itemId: pending },
      baseRevisionIds: [],
      localRevisionIds: [],
      status: "pending",
      enqueueOrder: 1,
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
    } as never);

    const released = await runEviction(db, {
      limitBytes: 0,
      usedBytes: 9000,
      persisted: false,
      measuredAt: new Date().toISOString(),
      breakdown: [],
    });

    // The whole point. Releasing this would destroy an edit the server has
    // never seen, and nothing could bring it back.
    expect(released.released).not.toContain(pending);
    expect((await db.items.get(pending))?.sealedPageBody).not.toBeNull();
  });

  it("releases nothing when the limit is unlimited", async () => {
    const page = await seedItem({ kind: "page", bodySize: 9000 });
    const released = await runEviction(db, {
      limitBytes: null,
      usedBytes: 999_999,
      persisted: false,
      measuredAt: new Date().toISOString(),
      breakdown: [],
    });
    expect(released.released).toEqual([]);
    expect((await db.items.get(page))?.sealedPageBody).not.toBeNull();
  });

  it("releases nothing when usage is within the limit", async () => {
    await seedItem({ kind: "page", bodySize: 10 });
    const released = await runEviction(db, {
      limitBytes: 1_000_000,
      usedBytes: 10,
      persisted: false,
      measuredAt: new Date().toISOString(),
      breakdown: [],
    });
    expect(released.released).toEqual([]);
  });
});
