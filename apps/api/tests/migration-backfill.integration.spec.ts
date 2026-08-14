/**
 * The encrypted backfill against real data (T096, US6, FR-024, FR-028, FR-029).
 *
 * The property that makes every other one safe is asserted first and asserted
 * hardest:
 *
 * **The backfill never touches the source.**
 *
 * Not "touches it carefully" — never. If that holds, this service can fail in
 * any way at any point and the worst outcome is wasted work. If it does not
 * hold, every other bug in the sweep becomes a candidate for destroying an
 * owner's only copy, and no amount of care elsewhere recovers that.
 *
 * The rest is about interruption, because a backfill of any real workspace
 * will be interrupted: a resume must not skip a record, and must not pay to
 * re-seal one it already sealed.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  schema,
} from "@myownnotion/database";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";
import { MigrationBackfillService } from "../src/security/migration-backfill-service.ts";
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

function backfill(batchSize?: number): MigrationBackfillService {
  return new MigrationBackfillService({
    db: handle.db,
    workspaceId: WORKSPACE_ID,
    records: records(),
    ...(batchSize === undefined ? {} : { batchSize }),
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
    TRUNCATE protected_envelopes, page_documents, placements, revision_parents,
      revisions, mutations, items, workspaces, data_key_generations,
      workspace_root_keys, wrapping_key_versions, installations CASCADE
  `);
  // The feature-001 workspace the items belong to. Seeded first: `items`
  // requires it, and a migration test that could not hold an item would be
  // testing nothing.
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

/**
 * Plaintext items, exactly as a feature-001 installation holds them.
 *
 * Each carries a mutation and a revision, because `items.current_revision_id`
 * is not nullable: an item without its revision is not a lighter fixture, it
 * is a row feature-001 cannot produce, and a migration test built on one would
 * be migrating something that never exists.
 */
async function seedItems(count: number): Promise<{ id: string; name: string }[]> {
  const created: { id: string; name: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    const name = `Private note ${index}`;
    const mutationId = randomUUID();
    const revisionId = randomUUID();
    await handle.db.insert(schema.mutations).values({
      id: mutationId,
      workspaceId: WORKSPACE_ID,
      commandType: "create-item",
      status: "accepted",
      // An accepted mutation must name at least one resulting revision: the
      // schema refuses one that accepted nothing, which is right — feature-001
      // has no such thing.
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
  // Sorted by id, because that is the order the sweep walks in and every
  // assertion about cursors depends on it.
  return created.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** One item with an id past any the sweep will have seen. */
async function seedLateItem(id: string): Promise<void> {
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
      name: "Written during the migration",
      currentRevisionId: revisionId,
    });
    await tx.insert(schema.revisions).values({
      id: revisionId,
      itemId: id,
      mutationId,
      lineageDigest: "late",
    });
  });
}

async function seedPage(itemId: string, body: unknown): Promise<void> {
  await handle.db.insert(schema.pageDocuments).values({
    pageId: itemId,
    format: "myownnotion.document+json",
    formatVersion: 1,
    body: body as never,
  });
}

async function sealedNames(): Promise<number> {
  const rows = await handle.db
    .select()
    .from(schema.protectedEnvelopes)
    .where(eq(schema.protectedEnvelopes.entityType, PROTECTED_ENTITY_TYPES.itemName));
  return rows.length;
}

describe("what the backfill must never do", () => {
  it("leaves every source row exactly as it found it", async () => {
    const seeded = await seedItems(5);
    const boundary = await backfill().captureBoundary();

    await backfill().copyBatch({ stream: "item-names", afterCursor: "", boundary });

    // The property everything else rests on. The scrub is a separate stage
    // behind its own gate; nothing in the sweep may pre-empt it.
    const rows = await handle.db.select().from(schema.items).orderBy(schema.items.id);
    expect(rows).toHaveLength(5);
    for (const [index, row] of rows.entries()) {
      expect(row.name).toBe(seeded[index]?.name);
    }
  });
});

describe("copying a batch", () => {
  it("seals every plaintext title it finds", async () => {
    const seeded = await seedItems(3);
    const boundary = await backfill().captureBoundary();

    const result = await backfill().copyBatch({
      stream: "item-names",
      afterCursor: "",
      boundary,
    });

    expect(result.sealed).toBe(3);
    expect(await sealedNames()).toBe(3);
    // Readable through the ordinary path, which is the only definition of
    // "migrated" that matters.
    const opened = await records().read(handle.db, {
      entityType: PROTECTED_ENTITY_TYPES.itemName,
      entityId: seeded[0]?.id ?? "",
    });
    expect(JSON.parse(Buffer.from(opened ?? new Uint8Array()).toString("utf8"))).toBe(
      seeded[0]?.name,
    );
  });

  it("stops at the batch size and reports where it stopped", async () => {
    const seeded = await seedItems(5);
    const boundary = await backfill().captureBoundary();

    const first = await backfill(2).copyBatch({
      stream: "item-names",
      afterCursor: "",
      boundary,
    });

    expect(first.seen).toBe(2);
    expect(first.cursor).toBe(seeded[1]?.id);
  });

  it("reports an exhausted stream as zero seen", async () => {
    await seedItems(2);
    const boundary = await backfill().captureBoundary();
    await backfill().copyBatch({ stream: "item-names", afterCursor: "", boundary });

    const beyond = await backfill().copyBatch({
      stream: "item-names",
      afterCursor: boundary.itemCursor,
      boundary,
    });
    // How the orchestrator learns the sweep is finished, without a count it
    // would have to keep in step with reality.
    expect(beyond.seen).toBe(0);
  });

  it("copies page bodies as their own stream", async () => {
    const seeded = await seedItems(2);
    await seedPage(seeded[0]?.id ?? "", { blocks: [{ text: "the body" }] });
    const boundary = await backfill().captureBoundary();

    const result = await backfill().copyBatch({
      stream: "page-bodies",
      afterCursor: "",
      boundary,
    });

    expect(result.sealed).toBe(1);
    const opened = await records().read(handle.db, {
      entityType: PROTECTED_ENTITY_TYPES.pageBody,
      entityId: seeded[0]?.id ?? "",
    });
    expect(JSON.parse(Buffer.from(opened ?? new Uint8Array()).toString("utf8"))).toEqual({
      blocks: [{ text: "the body" }],
    });
  });
});

describe("resuming", () => {
  it("skips a record already sealed rather than sealing it twice", async () => {
    await seedItems(4);
    const boundary = await backfill().captureBoundary();
    await backfill().copyBatch({ stream: "item-names", afterCursor: "", boundary });

    // Exactly what a resume from an earlier checkpoint does: re-reads ground
    // it has already covered.
    const again = await backfill().copyBatch({
      stream: "item-names",
      afterCursor: "",
      boundary,
    });

    expect(again.seen).toBe(4);
    expect(again.sealed).toBe(0);
    expect(await sealedNames()).toBe(4);
  });

  it("covers everything when driven batch by batch", async () => {
    const seeded = await seedItems(7);
    const boundary = await backfill().captureBoundary();

    let cursor = "";
    for (;;) {
      const batch = await backfill(2).copyBatch({
        stream: "item-names",
        afterCursor: cursor,
        boundary,
      });
      if (batch.seen === 0) {
        break;
      }
      cursor = batch.cursor;
    }

    // Nothing skipped between batches: the cursor is the row's own key, so
    // there is no window a record can fall through.
    expect(await sealedNames()).toBe(seeded.length);
  });
});

describe("the capture boundary", () => {
  it("excludes rows written after it was taken", async () => {
    await seedItems(3);
    const boundary = await backfill().captureBoundary();

    // A record written after the boundary belongs to the encrypted path, not
    // to the backfill. Copying it would be harmless here and would mean the
    // sweep chases a workspace still being written to, and never terminates.
    await seedLateItem("ffffffff-ffff-4fff-8fff-ffffffffffff");

    const result = await backfill().copyBatch({
      stream: "item-names",
      afterCursor: "",
      boundary,
    });
    expect(result.seen).toBe(3);
  });

  it("counts what it will copy", async () => {
    await seedItems(4);
    const service = backfill();
    const boundary = await service.captureBoundary();
    expect(await service.countSources(boundary)).toBe(4);
  });

  it("reports an empty workspace as nothing to do", async () => {
    const service = backfill();
    const boundary = await service.captureBoundary();
    expect(boundary.itemCursor).toBe("");
    expect(await service.countSources(boundary)).toBe(0);
  });
});

describe("the identity digest", () => {
  it("is stable across two reads of the same source", async () => {
    await seedItems(3);
    const first = await backfill().sourceIdentityDigest();
    const second = await backfill().sourceIdentityDigest();
    expect(second).toBe(first);
  });

  it("changes when a record is added", async () => {
    await seedItems(3);
    const before = await backfill().sourceIdentityDigest();
    await seedItems(1);
    expect(await backfill().sourceIdentityDigest()).not.toBe(before);
  });

  it("does not change when a title is edited", async () => {
    // Identity, not content. What the verification proves is that the same
    // records exist on both sides; comparing payloads would mean comparing
    // plaintext against ciphertext and proving nothing about either.
    const seeded = await seedItems(2);
    const before = await backfill().sourceIdentityDigest();
    await handle.db
      .update(schema.items)
      .set({ name: "renamed" })
      .where(eq(schema.items.id, seeded[0]?.id ?? ""));
    expect(await backfill().sourceIdentityDigest()).toBe(before);
  });
});
