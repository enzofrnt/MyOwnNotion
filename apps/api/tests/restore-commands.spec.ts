/** Recorded, non-destructive command behaviour around restoration (T026, T028, T032). */

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  lastTestRestoration,
  recordBackup,
  recordVerification,
  schema,
} from "@myownnotion/database";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { restoreApplyCommand } from "../src/admin/commands/restore-apply.ts";
import { runRestore } from "../src/admin/commands/restore-runner.ts";
import { restoreTestCommand } from "../src/admin/commands/restore-test.ts";
import { encodeBackupArchive } from "../src/backup/archive-format.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let destinationRoot: string;
let destination: FilesystemDestination;

function checkedArchive(): Buffer {
  const canonicalExport = JSON.stringify({ items: [], relationships: [], revisions: [] });
  const digest = (bytes: Uint8Array) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return encodeBackupArchive({
    manifest: {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: "2026-08-18T04:00:00.000Z",
      cursor: "42",
      applicationVersion: "0.1.0",
      schemaVersion: 1,
      recordFormatVersion: 1,
      canonicalExportDigest: digest(Buffer.from(canonicalExport)),
      files: [],
      itemCount: 0,
      fileCount: 0,
    },
    canonicalExport,
    files: new Map(),
  });
}

async function seedBackup(): Promise<Uuid> {
  const id = generateUuidV7();
  const name = `${id}.tar`;
  const bytes = checkedArchive();
  await destination.put(name, Readable.from(bytes), bytes.byteLength);
  await recordBackup(harness.built.context.db, {
    id,
    workspaceId: harness.built.context.workspaceId,
    cursor: "42",
    applicationVersion: "0.1.0",
    schemaVersion: 1,
    recordFormatVersion: 1,
    byteLength: bytes.byteLength,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    reason: "manual",
    destination: destination.name,
    remoteName: name,
  });
  await recordVerification(harness.built.context.db, {
    id: generateUuidV7(),
    backupId: id,
    stage: "after-transfer",
    outcome: "passed",
  });
  return id;
}

async function recordOnlyBackup(input: {
  readonly remoteName?: string;
  readonly bytes?: Buffer;
  readonly verified?: boolean;
  readonly digest?: string;
}): Promise<Uuid> {
  const id = generateUuidV7();
  const bytes = input.bytes ?? checkedArchive();
  if (input.remoteName !== undefined) {
    await destination.put(input.remoteName, Readable.from(bytes), bytes.byteLength);
  }
  await recordBackup(harness.built.context.db, {
    id,
    workspaceId: harness.built.context.workspaceId,
    cursor: "42",
    applicationVersion: "0.1.0",
    schemaVersion: 1,
    recordFormatVersion: 1,
    byteLength: bytes.byteLength,
    digest: input.digest ?? `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    reason: "manual",
    ...(input.remoteName === undefined
      ? {}
      : { destination: destination.name, remoteName: input.remoteName }),
  });
  if (input.verified === true) {
    await recordVerification(harness.built.context.db, {
      id: generateUuidV7(),
      backupId: id,
      stage: "after-transfer",
      outcome: "passed",
    });
  }
  return id;
}

beforeAll(async () => {
  harness = await createApiHarness();
  destinationRoot = await mkdtemp(path.join(os.tmpdir(), "mon-restore-command-"));
  destination = new FilesystemDestination(destinationRoot);
}, 180_000);

afterAll(async () => {
  await harness?.close();
  await rm(destinationRoot, { recursive: true, force: true });
});

describe("recorded restoration commands", () => {
  it("records a successful rehearsal and its restored count", async () => {
    const backupId = await seedBackup();
    const apply = vi.fn(async () => ({ restoredItemCount: 3, restoredFileCount: 1 }));
    const result = await runRestore(
      {
        db: harness.built.context.db,
        workspaceId: harness.built.context.workspaceId,
        destination,
        open: async (ciphertext) => ciphertext,
        installation: { schemaVersion: 1, recordFormatVersion: 1 },
      },
      {
        selector: { id: backupId },
        kind: "test",
        dryRun: false,
        showScope: () => true,
        safetyBackup: async () => null,
        confirm: () => false,
        apply,
      },
    );

    expect(result.code).toBe(0);
    expect(apply).toHaveBeenCalledOnce();
    expect(
      await lastTestRestoration(harness.built.context.db, harness.built.context.workspaceId),
    ).toMatchObject({ outcome: "succeeded", restoredItemCount: 3 });
  });

  it("assumes no consent when a destructive command has no terminal", async () => {
    const backupId = await seedBackup();
    const result = await restoreApplyCommand(
      {
        db: harness.built.context.db,
        workspaceId: harness.built.context.workspaceId,
        destination,
        open: async (ciphertext) => ciphertext,
        installation: { schemaVersion: 1, recordFormatVersion: 1 },
        contentStore: harness.built.context.contentStore,
        safetyBackup: async () => randomUUID(),
      },
      { id: backupId, dryRun: false, yes: false, terminalAvailable: false },
    );
    expect(result.code).toBe(3);
    expect(result.message).toMatch(/not confirmed/i);
    const attempts = await harness.built.context.db
      .select()
      .from(schema.restorationAttempts)
      .where(eq(schema.restorationAttempts.backupId, backupId));
    expect(attempts.at(-1)).toMatchObject({ outcome: "failed" });
  });

  it("a dry run validates but creates no restoration attempt and writes nothing", async () => {
    const backupId = await seedBackup();
    const before = await harness.built.context.db.select().from(schema.restorationAttempts);
    const result = await restoreApplyCommand(
      {
        db: harness.built.context.db,
        workspaceId: harness.built.context.workspaceId,
        destination,
        open: async (ciphertext) => ciphertext,
        installation: { schemaVersion: 1, recordFormatVersion: 1 },
        contentStore: harness.built.context.contentStore,
        safetyBackup: async () => {
          throw new Error("a dry run must not create a safety backup");
        },
      },
      { id: backupId, dryRun: true, yes: true, terminalAvailable: false },
    );
    expect(result.code).toBe(0);
    expect(await harness.built.context.db.select().from(schema.restorationAttempts)).toHaveLength(
      before.length,
    );
  });

  it("performs a real rehearsal in a disposable database", async () => {
    const backupId = await seedBackup();
    const result = await restoreTestCommand(
      {
        db: harness.built.context.db,
        databaseUrl: harness.postgres.connectionString,
        workspaceId: harness.built.context.workspaceId,
        destination,
        open: async (ciphertext) => ciphertext,
        installation: { schemaVersion: 1, recordFormatVersion: 1 },
      },
      { id: backupId },
    );
    expect(result).toMatchObject({
      code: 0,
      data: { backupId, restoredItemCount: 0, restoredFileCount: 0 },
    });
  }, 180_000);

  it("refuses an unknown or unverified backup before reading the destination", async () => {
    const unknown = await runRestore(
      {
        db: harness.built.context.db,
        workspaceId: harness.built.context.workspaceId,
        destination,
        open: async (ciphertext) => ciphertext,
        installation: { schemaVersion: 1, recordFormatVersion: 1 },
      },
      {
        selector: { id: generateUuidV7() },
        kind: "test",
        dryRun: false,
        showScope: () => true,
        safetyBackup: async () => null,
        confirm: () => false,
        apply: async () => ({ restoredItemCount: 0, restoredFileCount: 0 }),
      },
    );
    expect(unknown).toMatchObject({ code: 2, message: "no such backup" });

    const unverifiedId = await recordOnlyBackup({});
    const unverified = await runRestore(
      {
        db: harness.built.context.db,
        workspaceId: harness.built.context.workspaceId,
        destination,
        open: async (ciphertext) => ciphertext,
        installation: { schemaVersion: 1, recordFormatVersion: 1 },
      },
      {
        selector: { id: unverifiedId },
        kind: "test",
        dryRun: false,
        showScope: () => true,
        safetyBackup: async () => null,
        confirm: () => false,
        apply: async () => ({ restoredItemCount: 0, restoredFileCount: 0 }),
      },
    );
    expect(unverified).toMatchObject({ code: 3, data: { backupId: unverifiedId } });
  });

  it("detects a missing or changed destination object before decryption", async () => {
    const missingId = await recordOnlyBackup({
      remoteName: "missing.tar",
      verified: true,
    });
    await destination.delete("missing.tar");
    const changedBytes = checkedArchive();
    const changedId = await recordOnlyBackup({
      remoteName: "changed.tar",
      bytes: changedBytes,
      verified: true,
      digest: `sha256:${"f".repeat(64)}`,
    });
    const options = (id: Uuid) => ({
      selector: { id },
      kind: "test" as const,
      dryRun: false,
      showScope: () => true,
      safetyBackup: async () => null,
      confirm: () => false,
      apply: async () => ({ restoredItemCount: 0, restoredFileCount: 0 }),
    });
    const deps = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination,
      open: async (ciphertext: Buffer) => ciphertext,
      installation: { schemaVersion: 1, recordFormatVersion: 1 },
    };
    expect(await runRestore(deps, options(missingId))).toMatchObject({
      code: 5,
      data: { backupId: missingId },
    });
    expect(await runRestore(deps, options(changedId))).toMatchObject({
      code: 5,
      data: { backupId: changedId },
    });
  });

  it("records key-access and application failures without throwing", async () => {
    const keyFailureId = await seedBackup();
    const common = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination,
      installation: { schemaVersion: 1, recordFormatVersion: 1 },
    };
    const keyFailure = await runRestore(
      { ...common, open: async () => await Promise.reject(new Error("no key")) },
      {
        selector: { id: keyFailureId },
        kind: "test",
        dryRun: false,
        showScope: () => true,
        safetyBackup: async () => null,
        confirm: () => false,
        apply: async () => ({ restoredItemCount: 0, restoredFileCount: 0 }),
      },
    );
    expect(keyFailure).toMatchObject({ code: 4, data: { failedAt: "key-access" } });

    const applyFailureId = await seedBackup();
    const applyFailure = await runRestore(
      { ...common, open: async (ciphertext) => ciphertext },
      {
        selector: { id: applyFailureId },
        kind: "destructive",
        dryRun: false,
        showScope: () => true,
        safetyBackup: async () => "safety-backup",
        confirm: () => true,
        apply: async () => await Promise.reject("apply failed"),
      },
    );
    expect(applyFailure).toMatchObject({
      code: 7,
      data: { backupId: applyFailureId, errorType: "unknown" },
    });
  });
});
