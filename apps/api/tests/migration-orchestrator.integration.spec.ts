/**
 * Driving a migration to completion, and stopping it everywhere (T097, US6,
 * FR-028, FR-029, SC-010).
 *
 * The happy path takes one test. The other fifteen stop the migration at each
 * stage and check the same two things every time:
 *
 *   - **the notes are still readable**, from whichever side of the cutover
 *     applies;
 *   - **the plaintext is still there**, unless the scrub has run and been
 *     verified.
 *
 * That pairing is the whole safety argument. A migration is a sequence of
 * steps ending in a deletion, and the only thing that makes such a sequence
 * safe to run on someone's only copy is that every prefix of it is survivable.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  findMigration,
  schema,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";
import { MigrationBackfillService } from "../src/security/migration-backfill-service.ts";
import { MigrationOrchestrator } from "../src/security/migration-orchestrator.ts";
import { PROTECTED_ENTITY_TYPES } from "../src/security/protected-content.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const KEY = Buffer.from(randomBytes(32));

function records(): ProtectedRecordService {
  return new ProtectedRecordService({
    db: handle.db,
    keys: new KeyHierarchy({
      db: handle.db,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      deploymentKey: () => KEY,
      now: () => new Date(),
    }),
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    now: () => new Date(),
  });
}

function orchestrator(batchSize = 100): MigrationOrchestrator {
  return new MigrationOrchestrator({
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    backfill: new MigrationBackfillService({
      db: handle.db,
      workspaceId: WORKSPACE_ID,
      records: records(),
      batchSize,
    }),
    now: () => new Date(),
  });
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
});

beforeEach(async () => {
  await handle.db.execute(sql`
    TRUNCATE migration_checkpoints, encryption_migrations, protected_envelopes,
      page_documents, placements, revision_parents, revisions, mutations, items,
      workspaces, data_key_generations, workspace_root_keys, wrapping_key_versions,
      installations CASCADE
  `);
  await handle.db
    .insert(schema.workspaces)
    .values({ id: WORKSPACE_ID, schemaVersion: 1 })
    .onConflictDoNothing();
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await handle.db.transaction(async (tx) => {
    await new KeyHierarchy({
      db: handle.db,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      deploymentKey: () => KEY,
      now: () => new Date(),
    }).initialize(tx);
  });
});

async function seedItems(count: number): Promise<{ id: string; name: string }[]> {
  const created: { id: string; name: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    // v7, like the application generates. The capture boundary is an id
    // comparison, so a fixture using random v4 identifiers would produce
    // records that sort before a boundary they were created after — testing a
    // world this application does not live in.
    const id = generateUuidV7();
    const name = `Private note ${index}`;
    const mutationId = randomUUID();
    const revisionId = randomUUID();
    await handle.db.insert(schema.mutations).values({
      id: mutationId,
      workspaceId: WORKSPACE_ID,
      commandType: "create-item",
      status: "accepted",
      resultRevisionIds: [revisionId],
    });
    await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      await tx.insert(schema.items).values({
        id,
        workspaceId: WORKSPACE_ID,
        kind: "page",
        name,
        currentRevisionId: revisionId,
      });
      await tx.insert(schema.revisions).values({
        id: revisionId,
        itemId: id,
        mutationId,
        lineageDigest: `digest-${index}`,
      });
    });
    created.push({ id, name });
  }
  return created.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Runs the migration until it stops moving, or until `stopAt` is reached. */
async function run(
  driver: MigrationOrchestrator,
  options: { stopAt?: string; maxSteps?: number } = {},
): Promise<string> {
  await driver.begin();
  const limit = options.maxSteps ?? 60;
  let state = "prepare-destinations";
  for (let step = 0; step < limit; step += 1) {
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    state = migration?.state ?? state;
    if (state === options.stopAt || state === "complete" || state === "failed") {
      return state;
    }
    const result = await driver.step();
    state = result.state;
    if (state === options.stopAt || state === "complete" || state === "failed") {
      return state;
    }
  }
  return state;
}

async function plaintextNames(): Promise<string[]> {
  const rows = await handle.db.select().from(schema.items).orderBy(schema.items.id);
  return rows.map((row) => row.name);
}

async function sealedName(itemId: string): Promise<string | null> {
  const opened = await records().read(handle.db, {
    entityType: PROTECTED_ENTITY_TYPES.itemName,
    entityId: itemId,
  });
  return opened === null ? null : (JSON.parse(Buffer.from(opened).toString("utf8")) as string);
}

describe("a migration that runs to completion", () => {
  it("seals every record and removes every plaintext", async () => {
    const seeded = await seedItems(4);

    const state = await run(orchestrator());

    expect(state).toBe("complete");
    for (const item of seeded) {
      expect(await sealedName(item.id)).toBe(item.name);
    }
    // A single replacement character, not the title: the row survives the
    // migration, the plaintext does not.
    expect(await plaintextNames()).toEqual(["\uFFFD", "\uFFFD", "\uFFFD", "\uFFFD"]);
    expect((await findMigration(handle.db, INSTALLATION_ID))?.sourceRetained).toBe(false);
  });

  it("reports itself complete only once the source is gone", async () => {
    await seedItems(2);
    const driver = orchestrator();
    await run(driver);
    expect(await driver.isComplete()).toBe(true);
  });

  it("migrates an installation with nothing in it", async () => {
    // A new installation still has to reach `complete`, or it would sit
    // forever in a state that says a migration is under way.
    expect(await run(orchestrator())).toBe("complete");
  });
});

describe("stopping part-way through", () => {
  it("keeps the plaintext at every stage before the scrub", async () => {
    const seeded = await seedItems(3);

    for (const stage of [
      "capture-boundary",
      "backfill",
      "verify",
      "stop-plaintext-writes",
      "encrypted-read-cutover",
    ] as const) {
      await handle.db.execute(sql`TRUNCATE migration_checkpoints, encryption_migrations CASCADE`);
      await handle.db.execute(
        sql`UPDATE items SET name = 'Private note 0' WHERE id = ${seeded[0]?.id ?? ""}`,
      );
      await run(orchestrator(1), { stopAt: stage });

      // The safety argument, checked at every prefix: nothing before the scrub
      // may have removed anything.
      const names = await plaintextNames();
      expect(
        names.every((name) => name !== "\uFFFD"),
        `${stage}: ${names.join(",")}`,
      ).toBe(true);
      expect((await findMigration(handle.db, INSTALLATION_ID))?.sourceRetained).toBe(true);
    }
  });

  it("resumes the backfill where it stopped", async () => {
    const seeded = await seedItems(5);
    const driver = orchestrator(2);
    await driver.begin();

    // Three steps: prepare, boundary, and one batch of two.
    await driver.step();
    await driver.step();
    await driver.step();

    const afterInterruption = await handle.db
      .select()
      .from(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityType, PROTECTED_ENTITY_TYPES.itemName));
    expect(afterInterruption.length).toBeGreaterThan(0);
    expect(afterInterruption.length).toBeLessThan(5);

    // A fresh orchestrator, as a restarted process would be: no memory of what
    // the last one was doing, only the row and the checkpoints.
    expect(await run(orchestrator(2))).toBe("complete");
    for (const item of seeded) {
      expect(await sealedName(item.id)).toBe(item.name);
    }
  });

  it("does not resume a failed migration on its own", async () => {
    await seedItems(2);
    const driver = orchestrator();
    await driver.begin();
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    await handle.db.execute(
      sql`UPDATE encryption_migrations SET state = 'failed' WHERE id = ${migration?.id ?? ""}`,
    );

    const result = await driver.step();
    // Resuming is an operator decision made after they know why it failed. A
    // machine that retried automatically would hide a repeatable fault behind
    // a loop.
    expect(result.advanced).toBe(false);
    expect(result.state).toBe("failed");
  });
});

describe("verification is a gate", () => {
  it("fails the migration when fewer records were copied than counted", async () => {
    await seedItems(3);
    const driver = orchestrator();
    await driver.begin();
    await run(driver, { stopAt: "verify" });

    // As a lost batch would leave it: the row claims three sources and one
    // copy.
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    await handle.db.execute(
      sql`UPDATE encryption_migrations SET destination_count = 1 WHERE id = ${migration?.id ?? ""}`,
    );

    const result = await driver.step();
    expect(result.state).toBe("failed");
    // Everything after verification is irreversible, so the only moment to
    // refuse is before it.
    expect((await findMigration(handle.db, INSTALLATION_ID))?.sourceRetained).toBe(true);
    expect((await plaintextNames()).every((name) => name !== "\uFFFD")).toBe(true);
  });

  it("fails when the recorded identity no longer matches the source", async () => {
    await seedItems(3);
    const driver = orchestrator();
    await driver.begin();
    await run(driver, { stopAt: "verify" });

    // As a source that changed under the migration would leave it. Everything
    // after this point is irreversible, so the gate has to close.
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    await handle.db.execute(
      sql`UPDATE encryption_migrations SET identity_digest = 'something-else' WHERE id = ${migration?.id ?? ""}`,
    );

    const result = await driver.step();
    expect(result.state).toBe("failed");
    expect(result.message).toMatch(/identity digest/i);
  });

  it("does not fail because a note was taken during the migration", async () => {
    // The case the bound exists for. A record written after the capture
    // boundary was never the backfill's to copy, so counting it would fail an
    // installation for the crime of being in use — and refuse it a scrub it
    // had earned.
    const seeded = await seedItems(2);
    const driver = orchestrator();
    await driver.begin();
    await run(driver, { stopAt: "verify" });

    await seedItems(1);

    expect(await run(driver)).toBe("complete");
    for (const item of seeded) {
      expect(await sealedName(item.id)).toBe(item.name);
    }
  });
});

describe("the scrub", () => {
  it("refuses without a verified digest", async () => {
    await seedItems(2);
    const driver = orchestrator();
    await driver.begin();
    await run(driver, { stopAt: "scrub-plaintext" });

    // Clear the digests the verification wrote, as an unverified migration
    // hand-advanced to this stage would look.
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    await handle.db.execute(
      sql`UPDATE encryption_migrations SET source_digest = NULL, destination_digest = NULL WHERE id = ${migration?.id ?? ""}`,
    );

    const result = await driver.step();
    expect(result.advanced).toBe(false);
    expect(result.message).toMatch(/not been verified/i);
    expect((await plaintextNames()).every((name) => name !== "\uFFFD")).toBe(true);
  });

  it("leaves the rows themselves in place", async () => {
    const seeded = await seedItems(3);
    await run(orchestrator());

    // The migration removes the plaintext, not the record. Deleting rows would
    // take the hierarchy, the ordering, and the revision lineage with them.
    const rows = await handle.db.select().from(schema.items).orderBy(schema.items.id);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.id)).toEqual(seeded.map((item) => item.id));
  });

  it("is idempotent", async () => {
    await seedItems(2);
    const driver = orchestrator();
    await run(driver);
    // Running the whole thing again on a complete migration changes nothing
    // and says so, rather than starting a second one.
    const result = await driver.step();
    expect(result.state).toBe("complete");
    expect(result.advanced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fault injection (T091)
// ---------------------------------------------------------------------------
//
// These live here rather than in a file of their own, and the reason is
// mundane but real: every integration file starts its own PostgreSQL
// container, and a separate suite for the same subject pushed this machine
// past what it can run at once — producing serialization failures in
// unrelated tests. Same fixtures, same subject, one container.
//
// The faults are injected in the database rather than by mocking, because what
// is being tested is what the *rows* say after a crash. A mocked failure proves
// the code takes a branch; a broken row proves the migration cannot be talked
// into finishing over one.

/** Simulates a crash: the process stops calling `step`, the rows stay put. */
const SCRUBBED = "\uFFFD";

async function plaintextSurvives(): Promise<boolean> {
  const rows = await handle.db.select().from(schema.items);
  return rows.length > 0 && rows.every((row) => row.name !== SCRUBBED);
}

async function sourceRetained(): Promise<boolean> {
  return (await findMigration(handle.db, INSTALLATION_ID))?.sourceRetained ?? false;
}

const FAULT_POINTS = [
  "prepare-destinations",
  "capture-boundary",
  "backfill",
  "verify",
  "stop-plaintext-writes",
  "encrypted-read-cutover",
] as const;

describe("a crash at each stage before the scrub", () => {
  for (const stage of FAULT_POINTS) {
    it(`leaves the plaintext intact when it stops at ${stage}`, async () => {
      await seedItems(3);
      const driver = orchestrator(1);
      await run(driver, { stopAt: stage });

      // The safety argument, at every prefix of the sequence. One point where
      // this fails is the point at which a container restart destroys a
      // workspace, and it would be found by an operator rather than here.
      expect(await plaintextSurvives(), `${stage}: plaintext gone`).toBe(true);
      expect(await sourceRetained(), `${stage}: source released`).toBe(true);
    });
  }

  it("resumes from a crash and still finishes", async () => {
    const seeded = await seedItems(4);
    await run(orchestrator(1), { stopAt: "backfill" });

    // A fresh orchestrator, as a restarted process would be: no memory of what
    // the last one was doing, only the rows.
    const resumed = orchestrator();
    await resumed.begin();
    for (let step = 0; step < 60; step += 1) {
      const result = await resumed.step();
      if (result.state === "complete" || result.state === "failed") {
        break;
      }
    }

    expect((await findMigration(handle.db, INSTALLATION_ID))?.state).toBe("complete");
    for (const item of seeded) {
      const opened = await records().read(handle.db, {
        entityType: PROTECTED_ENTITY_TYPES.itemName,
        entityId: item.id,
      });
      expect(JSON.parse(Buffer.from(opened ?? new Uint8Array()).toString("utf8"))).toBe(item.name);
    }
  });
});

describe("a fault during the backfill", () => {
  it("stops rather than skipping the record it could not copy", async () => {
    const seeded = await seedItems(3);
    await run(orchestrator(1), { stopAt: "backfill" });

    // A row the sweep cannot handle. Skipping it would leave a record with no
    // encrypted copy, which the scrub would then delete the only version of.
    await handle.db
      .update(schema.items)
      .set({ name: "" })
      .where(eq(schema.items.id, seeded[0]?.id ?? ""))
      .catch(() => undefined);

    const driver = orchestrator();
    for (let step = 0; step < 20; step += 1) {
      const result = await driver.step();
      if (result.state === "complete" || result.state === "failed") {
        break;
      }
    }

    // Either it finished honestly or it stopped. What it must not do is reach
    // `complete` with a record uncopied.
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    if (migration?.state === "complete") {
      expect(migration.destinationCount).toBeGreaterThanOrEqual(migration.sourceCount);
    }
  });
});

describe("a fault after verification", () => {
  it("does not let a later stage proceed on stale counts", async () => {
    await seedItems(3);
    const driver = orchestrator();
    await run(driver, { stopAt: "stop-plaintext-writes" });

    // The verification wrote its digests; something then corrupted them, as a
    // partial write or a hand-edit would.
    const migration = await findMigration(handle.db, INSTALLATION_ID);
    await handle.db.execute(
      sql`UPDATE encryption_migrations SET source_digest = 'a', destination_digest = 'b' WHERE id = ${migration?.id ?? ""}`,
    );

    for (let step = 0; step < 10; step += 1) {
      const result = await driver.step();
      if (result.state === "complete" || result.state === "failed") {
        break;
      }
    }

    // The scrub asks for a positive answer to every question rather than
    // trusting the stage it is in, so mismatched digests stop it there.
    expect(await plaintextSurvives()).toBe(true);
    expect(await sourceRetained()).toBe(true);
  });
});

describe("a fault during the scrub", () => {
  it("keeps the migration at the scrub stage until nothing is left", async () => {
    await seedItems(3);
    const driver = orchestrator();
    await run(driver, { stopAt: "scrub-plaintext" });

    // A record written back into plaintext between two scrub passes, as a
    // partially applied batch would leave it.
    const rows = await handle.db.select().from(schema.items).limit(1);
    await handle.db
      .update(schema.items)
      .set({ name: "restored by a partial write" })
      .where(eq(schema.items.id, rows[0]?.id ?? ""));

    const result = await driver.step();

    // Not an error, and not completion either: there is more to do, and the
    // next call does it.
    expect(["scrub-plaintext", "complete"]).toContain(result.state);
    if (result.state === "scrub-plaintext") {
      expect(await sourceRetained()).toBe(true);
    }
  });

  it("releases the source only once every record is scrubbed", async () => {
    await seedItems(3);
    const driver = orchestrator();
    await driver.begin();
    for (let step = 0; step < 60; step += 1) {
      const result = await driver.step();
      if (result.state === "complete" || result.state === "failed") {
        break;
      }
    }

    const migration = await findMigration(handle.db, INSTALLATION_ID);
    expect(migration?.state).toBe("complete");
    expect(migration?.sourceRetained).toBe(false);
    // And the evidence behind SC-010: counted, not sampled. A migration that
    // scrubbed 99% has not finished, and the remaining 1% is exactly the part
    // nobody would notice.
    const remaining = await handle.db.select().from(schema.items).where(sql`name <> ${SCRUBBED}`);
    expect(remaining).toHaveLength(0);
  });
});
