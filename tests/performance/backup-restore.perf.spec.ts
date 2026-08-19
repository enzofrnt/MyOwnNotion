/** Reference measurement for backing up and restoring a 1,000-item workspace. */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ContentStore, FilesystemBlobStore, PartialUploadStore } from "@myownnotion/blob-store";
import {
  createDatabase,
  type DatabaseHandle,
  getOrCreateWorkspace,
  schema,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openBackupArchive,
  sealBackupArchiveFile,
} from "../../apps/api/src/backup/archive-crypto.ts";
import { BackupService } from "../../apps/api/src/backup/backup-service.ts";
import { createDatabaseRestoreTarget } from "../../apps/api/src/backup/database-restore-target.ts";
import { FilesystemDestination } from "../../apps/api/src/backup/destinations/filesystem.ts";
import { createDisposableWorkspace } from "../../apps/api/src/backup/disposable-workspace.ts";
import { applyArchive, preflight } from "../../apps/api/src/backup/restore-service.ts";

const ITEM_COUNT = 1_000;
const MAX_REFERENCE_DURATION_MS = 30_000;

let postgres: DisposablePostgres;
let handle: DatabaseHandle;
let workspaceId: Uuid;
let blobRoot: string;
let backupRoot: string;

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
  workspaceId = (await getOrCreateWorkspace(handle.db)).id;
  blobRoot = mkdtempSync(path.join(os.tmpdir(), "mon-backup-perf-blobs-"));
  backupRoot = mkdtempSync(path.join(os.tmpdir(), "mon-backup-perf-destination-"));

  const mutationId = generateUuidV7();
  const itemRows: Array<typeof schema.items.$inferInsert> = [];
  const revisionRows: Array<typeof schema.revisions.$inferInsert> = [];
  const placementRows: Array<typeof schema.placements.$inferInsert> = [];
  const revisionIds: Uuid[] = [];
  for (let index = 0; index < ITEM_COUNT; index += 1) {
    const itemId = generateUuidV7();
    const revisionId = generateUuidV7();
    revisionIds.push(revisionId);
    itemRows.push({
      id: itemId,
      workspaceId,
      kind: "folder",
      name: `Backup performance item ${index}`,
      currentRevisionId: revisionId,
    });
    revisionRows.push({
      id: revisionId,
      itemId,
      mutationId,
      acceptedAt: new Date("2026-08-18T04:00:00.000Z"),
      lineageDigest: `reference-${index}`,
    });
    placementRows.push({
      id: generateUuidV7(),
      workspaceId,
      itemId,
      itemIsFile: false,
      kind: "hierarchy",
      parentItemId: null,
      positionKey: `V${index.toString(36).padStart(4, "0")}`,
      createdRevisionId: revisionId,
    });
  }
  await handle.db.transaction(async (tx) => {
    await tx.insert(schema.mutations).values({
      id: mutationId,
      workspaceId,
      commandType: "fixture.load",
      status: "accepted",
      acceptedAt: new Date("2026-08-18T04:00:00.000Z"),
      resultRevisionIds: revisionIds,
    });
    for (let offset = 0; offset < ITEM_COUNT; offset += 250) {
      await tx.insert(schema.items).values(itemRows.slice(offset, offset + 250));
      await tx.insert(schema.revisions).values(revisionRows.slice(offset, offset + 250));
      await tx.insert(schema.placements).values(placementRows.slice(offset, offset + 250));
    }
  });
}, 600_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
  rmSync(blobRoot, { recursive: true, force: true });
  rmSync(backupRoot, { recursive: true, force: true });
});

describe(`backup and restore of ${ITEM_COUNT} items`, () => {
  it("records reference timings and restores every item", async () => {
    const contentStore = new ContentStore(new FilesystemBlobStore(blobRoot));
    const destination = new FilesystemDestination(backupRoot);
    const key = randomBytes(32);
    const service = new BackupService({
      context: {
        db: handle.db,
        workspaceId,
        schemaVersion: 1,
        contentStore,
        partialUploads: new PartialUploadStore(blobRoot),
      },
      destination,
      applicationVersion: "0.1.0-performance",
      seal: async (plaintextPath, sealedPath) =>
        await sealBackupArchiveFile(key, plaintextPath, sealedPath),
    });

    const backupStarted = performance.now();
    const outcome = await service.run("manual");
    const backupMs = performance.now() - backupStarted;
    expect(outcome.verifiedAfterCreation).toBe(true);
    expect(outcome.verifiedAfterTransfer).toBe(true);

    const stored = await destination.read(outcome.name);
    expect(stored).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stored ?? []) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const archive = openBackupArchive(key, Buffer.concat(chunks));
    const checked = await preflight({
      openArchive: async () => archive,
      installation: { schemaVersion: 1, recordFormatVersion: 1 },
      showScope: () => true,
      safetyBackup: async () => null,
      confirm: () => false,
      kind: "test",
    });
    expect(checked.ok).toBe(true);

    const restoreStarted = performance.now();
    const restored = await createDisposableWorkspace(postgres.connectionString);
    let restoredItemCount = 0;
    try {
      const workspace = await getOrCreateWorkspace(restored.handle.db);
      const restoredStore = new ContentStore(new FilesystemBlobStore(restored.blobRoot));
      const result = await restored.handle.db.transaction(async (tx) =>
        applyArchive(
          archive,
          createDatabaseRestoreTarget({
            tx,
            workspaceId: workspace.id,
            contentStore: restoredStore,
          }),
        ),
      );
      restoredItemCount = result.restoredItemCount;
    } finally {
      await restored.release();
    }
    const restoreMs = performance.now() - restoreStarted;

    console.info(
      `[perf] backup/restore ${ITEM_COUNT} items: backup=${backupMs.toFixed(1)}ms restore=${restoreMs.toFixed(1)}ms archive=${outcome.byteLength} bytes`,
    );
    expect(restoredItemCount).toBe(ITEM_COUNT);
    expect(backupMs).toBeLessThan(MAX_REFERENCE_DURATION_MS);
    expect(restoreMs).toBeLessThan(MAX_REFERENCE_DURATION_MS);
  });
});
