/**
 * Catch-up never skips a change (T016, US2, FR-005, FR-006).
 *
 * The invariant under test is the one that cannot be checked by reading the
 * code, because the dangerous case is an interleaving rather than a line: a
 * notification arrives, the fetch it triggers fails, and the device is left
 * believing it is further along than its projection is. Nothing errors. The
 * change is simply never asked for again.
 *
 * So the property is stated over *what was applied*, not over what was
 * announced: for any interleaving of announcements and transport failures, the
 * items the device holds are a prefix of the feed with no hole in it, and the
 * stored cursor never runs ahead of them.
 */

import {
  type LocalDatabase,
  LocalRepository,
  openLocalDatabase,
  type ReconcileTransport,
  reconcile,
} from "@myownnotion/client-core";
import type { ItemDto } from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import fc from "fast-check";
import { afterEach, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase | null = null;

afterEach(async () => {
  await db?.delete();
  db = null;
});

/** One change on the server feed, at sequence `index + 1`. */
function feedItem(index: number): ItemDto {
  const id = generateUuidV7();
  return {
    id,
    kind: "folder",
    // The name carries the sequence, so a gap in what was applied is visible
    // rather than inferred.
    name: `change-${index + 1}`,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    placements: [
      { id: generateUuidV7(), itemId: id, kind: "hierarchy", parentItemId: null, positionKey: "V" },
    ],
  } as ItemDto;
}

/**
 * A server whose fetches fail on a schedule the test controls.
 *
 * Pages are served one change at a time so a failure can fall *between* two
 * changes. A transport that answered the whole feed in one page would make the
 * property trivially true and test nothing: there would be no interleaving to
 * get wrong.
 */
class FlakyFeed implements ReconcileTransport {
  #failures: boolean[];
  #call = 0;

  constructor(
    private readonly feed: readonly ItemDto[],
    failures: readonly boolean[],
  ) {
    this.#failures = [...failures];
  }

  async submitMutationBatch() {
    return { ok: true as const, value: { results: [] } };
  }

  async listChanges(after: string) {
    const shouldFail = this.#failures[this.#call % Math.max(1, this.#failures.length)] === true;
    this.#call += 1;
    if (shouldFail) {
      // Offline rather than compacted: a lost fetch, which is the case where
      // "told about" and "applied" are most likely to be conflated.
      return { ok: false as const, offline: true };
    }
    const from = Number.parseInt(after === "" ? "0" : after, 10);
    const next = this.feed[from];
    if (next === undefined) {
      return { ok: true as const, value: { changes: [], nextCursor: after, hasMore: false } };
    }
    return {
      ok: true as const,
      value: {
        changes: [
          {
            sequence: from + 1,
            mutationId: generateUuidV7(),
            revisionIds: [],
            changedItems: [next],
          },
        ],
        nextCursor: String(from + 1),
        hasMore: from + 1 < this.feed.length,
      },
    };
  }

  async currentSnapshot() {
    return { ok: false as const, offline: true };
  }
}

it("never applies a change without every change before it", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 6 }),
      // How the fetches fail, cycled. An all-false schedule is the happy path
      // and an all-true one never gets anywhere; both are worth including.
      fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
      // How many times the device is woken. A notification is not a change: a
      // device can be told twice about one position, or told once about three.
      fc.integer({ min: 1, max: 8 }),
      async (feedLength, failures, wakeUps) => {
        const { codec } = await createTestCodec();
        const database = openLocalDatabase(`catchup-${generateUuidV7()}`);
        await database.open();
        db = database;
        const repository = new LocalRepository(database, codec);
        const feed = Array.from({ length: feedLength }, (_, index) => feedItem(index));
        const transport = new FlakyFeed(feed, failures);

        for (let wake = 0; wake < wakeUps; wake += 1) {
          // Each pass is one wake-up. A notification is not a change: a device
          // can be told twice about one position, and each telling must be safe.
          await reconcile(database, transport, codec);
        }

        const applied = (await repository.listItems("active"))
          .map((item) => item.name)
          .filter((name) => name.startsWith("change-"))
          .map((name) => Number.parseInt(name.slice("change-".length), 10))
          .sort((a, b) => a - b);

        // A prefix, with no hole. This is the assertion that a lost fetch must
        // not be able to break: applying 1 and 3 without 2 is the silent loss
        // FR-005 forbids, and it would look like a working device.
        expect(applied).toEqual(applied.map((_, index) => index + 1));

        // And the durable cursor never runs ahead of what was applied. If it
        // did, the missing changes would never be requested again — the cursor
        // is the authority on what this device has, so an optimistic one is a
        // permanent gap rather than a delayed one.
        const cursor = await repository.getLastChangeCursor();
        const position = cursor === "" ? 0 : Number.parseInt(cursor, 10);
        expect(position).toBeLessThanOrEqual(applied.length);

        await database.delete();
        db = null;
      },
    ),
    { numRuns: 25 },
  );
}, 120_000);
