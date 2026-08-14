/**
 * Migration persistence against a real database (T095, US6, FR-028, FR-029).
 *
 * The state machine next door is pure and provably correct on its own. These
 * tests exist for what it cannot reach: the guarantees that only a database
 * can make, and that only a database can break.
 *
 * Three of them matter more than the rest:
 *
 *   1. **A conditional advance refuses a second caller.** Two processes
 *      resuming the same migration is not a hypothetical — it is what happens
 *      when a supervisor restarts a container that had not quite died.
 *   2. **The retention constraint refuses at the schema level.** The
 *      application already guards releasing plaintext; the point of this test
 *      is that the database refuses too, so a bug that gets past the
 *      application still cannot delete an owner's only copy.
 *   3. **A retried checkpoint records once.** A batch that commits and loses
 *      its acknowledgement is the ordinary interruption these rows exist to
 *      survive, and a retry that raised would break the resume path on
 *      precisely the case it was written for.
 */

import { randomUUID } from "node:crypto";
import {
  advanceMigration,
  appendMigrationCheckpoint,
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  failMigration,
  findLastSafeCheckpoint,
  findLatestMigrationCheckpoint,
  findMigration,
  listMigrationCheckpoints,
  recordCaptureBoundary,
  releasePlaintextSource,
  startMigration,
} from "@myownnotion/database";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const NOW = new Date("2026-07-01T00:00:00.000Z");

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
});

beforeEach(async () => {
  await handle.db.execute(
    sql`TRUNCATE migration_checkpoints, encryption_migrations, installations CASCADE`,
  );
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

async function start(): Promise<string> {
  const migration = await handle.db.transaction(async (tx) =>
    startMigration(tx, {
      id: randomUUID(),
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      sourceSchemaVersion: 1,
      destinationSchemaVersion: 2,
      now: NOW,
    }),
  );
  return migration.id;
}

/** Walks the migration to a stage, one legal step at a time. */
async function walkTo(migrationId: string, target: string): Promise<void> {
  const order = [
    "prepare-destinations",
    "capture-boundary",
    "backfill",
    "verify",
    "stop-plaintext-writes",
    "encrypted-read-cutover",
    "scrub-plaintext",
    "complete",
  ] as const;
  for (let index = 0; index < order.length - 1; index += 1) {
    const from = order[index];
    const to = order[index + 1];
    if (from === undefined || to === undefined || from === target) {
      return;
    }
    await handle.db.transaction(async (tx) => {
      await advanceMigration(tx, {
        migrationId,
        expectedState: from,
        nextState: to,
        now: NOW,
      });
    });
    if (to === target) {
      return;
    }
  }
}

describe("starting a migration", () => {
  it("is idempotent for one installation", async () => {
    const first = await start();
    const second = await start();
    // Two migrations of one installation would each capture their own
    // boundary, and records between the two would be backfilled twice — or
    // scrubbed by one while the other still needed them.
    expect(second).toBe(first);
  });

  it("begins with the plaintext retained", async () => {
    await start();
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    expect(migration?.sourceRetained).toBe(true);
    expect(migration?.state).toBe("prepare-destinations");
  });
});

describe("advancing a stage", () => {
  it("refuses when the migration has already moved", async () => {
    const id = await start();

    const first = await handle.db.transaction(async (tx) =>
      advanceMigration(tx, {
        migrationId: id,
        expectedState: "prepare-destinations",
        nextState: "capture-boundary",
        now: NOW,
      }),
    );
    const second = await handle.db.transaction(async (tx) =>
      advanceMigration(tx, {
        migrationId: id,
        expectedState: "prepare-destinations",
        nextState: "capture-boundary",
        now: NOW,
      }),
    );

    // The check and the write are one statement, so the loser is told it lost
    // rather than overwriting a stage someone else had already advanced.
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("carries the counts and digests it is given", async () => {
    const id = await start();
    await walkTo(id, "verify");
    await handle.db.transaction(async (tx) =>
      advanceMigration(tx, {
        migrationId: id,
        expectedState: "verify",
        nextState: "stop-plaintext-writes",
        now: NOW,
        sourceCount: 1200,
        destinationCount: 1200,
        sourceDigest: "abc",
        destinationDigest: "abc",
      }),
    );
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    expect(migration?.sourceCount).toBe(1200);
    expect(migration?.sourceDigest).toBe("abc");
  });
});

describe("the capture boundary", () => {
  it("is recorded only at its own stage", async () => {
    const id = await start();
    const early = await handle.db.transaction(async (tx) =>
      recordCaptureBoundary(tx, { migrationId: id, cursor: "m", sourceCount: 5, now: NOW }),
    );
    expect(early).toBe(false);

    await walkTo(id, "capture-boundary");
    const recorded = await handle.db.transaction(async (tx) =>
      recordCaptureBoundary(tx, { migrationId: id, cursor: "m", sourceCount: 5, now: NOW }),
    );
    expect(recorded).toBe(true);
    expect((await findMigration(handle.db, INSTALLATION_ID))?.cursor).toBe("m");
  });
});

describe("releasing the plaintext source", () => {
  it("is refused before the scrub stage", async () => {
    const id = await start();
    await walkTo(id, "encrypted-read-cutover");

    const released = await handle.db.transaction(async (tx) =>
      releasePlaintextSource(tx, { migrationId: id, now: NOW }),
    );

    expect(released).toBe(false);
    expect((await findMigration(handle.db, INSTALLATION_ID))?.sourceRetained).toBe(true);
  });

  it("is permitted at the scrub stage", async () => {
    const id = await start();
    await walkTo(id, "scrub-plaintext");

    const released = await handle.db.transaction(async (tx) =>
      releasePlaintextSource(tx, { migrationId: id, now: NOW }),
    );

    expect(released).toBe(true);
    expect((await findMigration(handle.db, INSTALLATION_ID))?.sourceRetained).toBe(false);
  });

  it("is refused by the database itself, not only by this code", async () => {
    const id = await start();
    await walkTo(id, "backfill");

    // Straight past the repository, as a bug or a hand-run statement would.
    // The schema is the last thing standing between a mistake and an owner's
    // only copy, so it has to refuse on its own.
    await expect(
      handle.db.execute(
        sql`UPDATE encryption_migrations SET source_retained = 'false' WHERE id = ${id}`,
      ),
    ).rejects.toThrow();
  });
});

describe("a failed migration", () => {
  it("can fail from any stage", async () => {
    const id = await start();
    await walkTo(id, "backfill");
    await handle.db.transaction(async (tx) => failMigration(tx, { migrationId: id, now: NOW }));
    expect((await findMigration(handle.db, INSTALLATION_ID))?.state).toBe("failed");
  });

  it("keeps the plaintext", async () => {
    const id = await start();
    await walkTo(id, "encrypted-read-cutover");
    await handle.db.transaction(async (tx) => failMigration(tx, { migrationId: id, now: NOW }));
    // What makes a failure survivable at all.
    expect((await findMigration(handle.db, INSTALLATION_ID))?.sourceRetained).toBe(true);
  });
});

describe("checkpoints", () => {
  function checkpoint(
    migrationId: string,
    sequence: number,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: randomUUID(),
      migrationId,
      sequence,
      state: "backfill" as const,
      sourceCursor: `cursor-${sequence}`,
      destinationCursor: `dest-${sequence}`,
      batchCount: 1,
      recordCount: sequence * 100,
      blobCount: 0,
      identityDigest: "identity",
      checkpointDigest: `digest-${sequence}`,
      idempotencyKey: `batch-${sequence}`,
      now: NOW,
      ...overrides,
    };
  }

  it("records a retried batch once", async () => {
    const id = await start();
    await handle.db.transaction(async (tx) => appendMigrationCheckpoint(tx, checkpoint(id, 1)));
    const retried = await handle.db.transaction(async (tx) =>
      appendMigrationCheckpoint(tx, checkpoint(id, 1)),
    );

    // A batch that commits and loses its acknowledgement is the ordinary
    // interruption these rows exist to survive. A retry that raised would
    // break the resume path on exactly that case.
    expect(retried.sequence).toBe(1);
    expect(await listMigrationCheckpoints(handle.db, id)).toHaveLength(1);
  });

  it("refuses a different batch at a taken sequence", async () => {
    const id = await start();
    await handle.db.transaction(async (tx) => appendMigrationCheckpoint(tx, checkpoint(id, 1)));

    // Same position, different work: another process wrote here. Returning its
    // row would let this caller believe its own batch was recorded.
    await expect(
      handle.db.transaction(async (tx) =>
        appendMigrationCheckpoint(
          tx,
          checkpoint(id, 1, { idempotencyKey: "a-different-batch", checkpointDigest: "other" }),
        ),
      ),
    ).rejects.toThrow(/already recorded checkpoint 1/);
  });

  it("finds the furthest by sequence", async () => {
    const id = await start();
    for (const sequence of [1, 2, 3]) {
      await handle.db.transaction(async (tx) =>
        appendMigrationCheckpoint(tx, checkpoint(id, sequence)),
      );
    }
    expect((await findLatestMigrationCheckpoint(handle.db, id))?.sequence).toBe(3);
  });

  it("skips an interrupted checkpoint when resuming", async () => {
    const id = await start();
    await handle.db.transaction(async (tx) => appendMigrationCheckpoint(tx, checkpoint(id, 1)));
    await handle.db.transaction(async (tx) =>
      appendMigrationCheckpoint(tx, checkpoint(id, 2, { faultPoint: "blob-copy" })),
    );

    // "The latest checkpoint" and "the last safe checkpoint" are different
    // questions. Resuming from an interrupted one treats work that never
    // finished as done.
    expect((await findLatestMigrationCheckpoint(handle.db, id))?.sequence).toBe(2);
    expect((await findLastSafeCheckpoint(handle.db, id))?.sequence).toBe(1);
  });

  it("reports no safe checkpoint when every one was interrupted", async () => {
    const id = await start();
    await handle.db.transaction(async (tx) =>
      appendMigrationCheckpoint(tx, checkpoint(id, 1, { faultPoint: "record-copy" })),
    );
    // Null, not the interrupted row. The resume rule turns this into
    // "start from the beginning", which is correct and safe.
    expect(await findLastSafeCheckpoint(handle.db, id)).toBeNull();
  });
});
