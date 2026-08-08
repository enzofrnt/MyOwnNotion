import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FilesystemBlobStore } from "@myownnotion/blob-store";
import {
  type ContentAuditInventoryRecord,
  createDatabase,
  type DatabaseHandle,
  executeImportFile,
  getOrCreateWorkspace,
  runMutation,
  schema,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditContentStorage } from "../src/audit.ts";
import { runStorageAuditCommand } from "../src/cli.ts";
import { migrateFilesystemContent } from "../src/migrate-filesystem.ts";

const roots: string[] = [];
let postgres: DisposablePostgres;
let database: DatabaseHandle;
let workspaceId: Uuid;

beforeEach(async () => {
  postgres = await startMigratedPostgres();
  database = createDatabase(postgres.connectionString);
  workspaceId = (await getOrCreateWorkspace(database.db)).id;
}, 120_000);

afterEach(async () => {
  await database.close();
  await postgres.stop();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function record(storageKey: string, bytes: Uint8Array): ContentAuditInventoryRecord {
  return {
    contentId: generateUuidV7(),
    storageKey,
    sha256: digest(bytes),
    byteLength: bytes.byteLength,
    verified: true,
    verifiedAt: new Date(),
    storedReferenceCount: 1,
    logicalReferenceCount: 1,
  };
}

async function canonicalFile(
  source: FilesystemBlobStore,
  bytes: Uint8Array,
): Promise<{ contentId: Uuid; storageKey: string }> {
  const stored = await source.put(bytes);
  const contentId = generateUuidV7();
  const mutationId = generateUuidV7();
  await runMutation(database.db, async (tx) => {
    const execution = await executeImportFile(tx, {
      mutationId,
      workspaceId,
      itemId: generateUuidV7(),
      name: "legacy.bin",
      mediaType: "application/octet-stream",
      content: {
        contentId,
        sha256: stored.sha256,
        byteLength: stored.byteLength,
        storageKey: stored.storageKey,
        verifiedAt: stored.verifiedAt,
        reusedExisting: false,
      },
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      acceptedAt: new Date(),
    });
    if (!execution.ok) throw new Error(execution.error.code);
    await tx.insert(schema.mutations).values({
      id: mutationId,
      workspaceId,
      commandType: "file.import",
      status: "accepted",
      submittedAt: new Date(),
      acceptedAt: new Date(),
      resultRevisionIds: [execution.value.revisionId],
    });
  });
  return { contentId, storageKey: stored.storageKey };
}

describe("read-only storage audit", () => {
  it("classifies injected faults, redacts locators, bounds findings, and changes nothing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mon-audit-"));
    roots.push(root);
    const store = new FilesystemBlobStore(root);
    const goodBytes = new TextEncoder().encode("verified audit bytes");
    const mismatchedBytes = new TextEncoder().encode("expected mismatch");
    const good = await store.put(goodBytes);
    const mismatched = await store.put(mismatchedBytes);
    const unreferenced = await store.put(new TextEncoder().encode("not referenced"));
    const temporaryName = "019c3e8e-3140-7a75-af40-7a4b74df0dd7";
    await mkdir(path.join(root, ".tmp"), { recursive: true });
    await writeFile(path.join(root, ".tmp", temporaryName), "partial");
    await writeFile(
      path.join(root, mismatched.storageKey.slice(0, 2), mismatched.storageKey),
      "tampered",
    );
    const missingKey = "0".repeat(64);
    const inventory = [
      record(good.storageKey, goodBytes),
      record(mismatched.storageKey, mismatchedBytes),
      record(missingKey, new TextEncoder().encode("missing")),
    ];
    const before = await store.list({ includeTemporary: true });

    const report = await auditContentStorage({
      inventory,
      blobStore: store,
      hmacKey: new Uint8Array(32).fill(7),
      limit: 3,
    });

    expect(report.counts).toEqual({
      referenced: 1,
      missing: 1,
      mismatched: 1,
      temporary: 1,
      unreferenced: 1,
    });
    expect(report.findings).toHaveLength(3);
    expect(report.truncated).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(good.storageKey);
    expect(serialized).not.toContain(missingKey);
    expect(serialized).not.toContain(unreferenced.storageKey);
    expect(await store.list({ includeTemporary: true })).toEqual(before);
    expect(await readFile(path.join(root, ".tmp", temporaryName), "utf8")).toBe("partial");
  });

  it("validates report and HMAC bounds before reading storage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mon-audit-bounds-"));
    roots.push(root);
    const store = new FilesystemBlobStore(root);
    await expect(
      auditContentStorage({ inventory: [], blobStore: store, hmacKey: new Uint8Array(31) }),
    ).rejects.toThrow("HMAC");
    await expect(
      auditContentStorage({
        inventory: [],
        blobStore: store,
        hmacKey: new Uint8Array(32),
        limit: 10_001,
      }),
    ).rejects.toThrow("limit");
  });

  it("emits the same closed safe envelope through the real command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mon-audit-command-"));
    roots.push(root);
    const store = new FilesystemBlobStore(root);
    await canonicalFile(store, new TextEncoder().encode("command audit bytes"));
    const result = await runStorageAuditCommand(["--limit", "0"], {
      DATABASE_URL: postgres.connectionString,
      MYOWNNOTION_STORAGE_ADAPTER: "filesystem",
      MYOWNNOTION_BLOB_ROOT: root,
    });
    expect(result).toMatchObject({
      command: "storage.audit",
      status: "succeeded",
      counts: { referenced: 1, missing: 0, mismatched: 0 },
      findings: [],
    });
  });
});

describe("legacy filesystem migration", () => {
  it("is dry-run-first, independently verified, per-row committed, and idempotent", async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "mon-legacy-source-"));
    const destinationRoot = await mkdtemp(path.join(os.tmpdir(), "mon-legacy-destination-"));
    roots.push(sourceRoot, destinationRoot);
    const source = new FilesystemBlobStore(sourceRoot);
    const destination = new FilesystemBlobStore(destinationRoot);
    const bytes = new TextEncoder().encode("verified legacy bytes");
    const canonical = await canonicalFile(source, bytes);
    await mkdir(path.join(destinationRoot, canonical.storageKey.slice(0, 2)), { recursive: true });
    await writeFile(
      path.join(destinationRoot, canonical.storageKey.slice(0, 2), canonical.storageKey),
      "collision forces an opaque replacement key",
    );

    const dryRun = await migrateFilesystemContent({
      db: database.db,
      source,
      destination,
      confirm: false,
    });
    expect(dryRun).toMatchObject({ dryRun: true, counts: { eligible: 1, migrated: 0 } });
    const beforeRows = await database.db
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, canonical.contentId));
    expect(beforeRows[0]?.storageKey).toBe(canonical.storageKey);

    const confirmed = await migrateFilesystemContent({
      db: database.db,
      source,
      destination,
      confirm: true,
    });
    expect(confirmed).toMatchObject({ dryRun: false, counts: { eligible: 1, migrated: 1 } });
    const migratedRows = await database.db
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, canonical.contentId));
    const replacementKey = migratedRows[0]?.storageKey;
    expect(replacementKey).not.toBe(canonical.storageKey);
    expect(await destination.get(replacementKey as string)).toEqual(bytes);

    const replay = await migrateFilesystemContent({
      db: database.db,
      source,
      destination,
      confirm: true,
    });
    expect(replay).toMatchObject({ counts: { alreadyPresent: 1, migrated: 0 } });
  });

  it("leaves missing and mismatched legacy rows unchanged", async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "mon-legacy-faults-"));
    const destinationRoot = await mkdtemp(path.join(os.tmpdir(), "mon-legacy-target-"));
    roots.push(sourceRoot, destinationRoot);
    const source = new FilesystemBlobStore(sourceRoot);
    const destination = new FilesystemBlobStore(destinationRoot);
    const missing = await canonicalFile(source, new TextEncoder().encode("will disappear"));
    const mismatched = await canonicalFile(source, new TextEncoder().encode("will be altered"));
    await source.delete(missing.storageKey);
    await writeFile(
      path.join(sourceRoot, mismatched.storageKey.slice(0, 2), mismatched.storageKey),
      "altered",
    );

    const report = await migrateFilesystemContent({
      db: database.db,
      source,
      destination,
      confirm: true,
    });
    expect(report.counts).toMatchObject({ missing: 1, mismatched: 1, migrated: 0 });
    const rows = await database.db.select().from(schema.fileContents);
    expect(rows.find((row) => row.id === missing.contentId)?.storageKey).toBe(missing.storageKey);
    expect(rows.find((row) => row.id === mismatched.contentId)?.storageKey).toBe(
      mismatched.storageKey,
    );
    expect(await destination.list()).toEqual([]);
  });
});
