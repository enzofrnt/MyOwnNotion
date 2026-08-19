/**
 * What a produced archive does and does not contain (T011, FR-001, FR-004, FR-007).
 *
 * The assertion that matters is the negative one. An archive is the one artefact
 * this product deliberately copies to somewhere it does not control, so a secret
 * inside it is a secret handed to a third party — and unlike a leaked log line,
 * it is retained for three months by policy.
 *
 * So the test seeds recognisable secrets into the installation, produces a real
 * archive, decrypts it, and searches. Searching the *ciphertext* would pass for
 * any encryption at all; searching the plaintext is what proves the archive was
 * built without them rather than merely sealed over them.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  backupsWithVerification,
  latestBackupVerificationStatus,
  recordBackup,
  recordVerification,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { open as openSealed } from "@myownnotion/domain/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  pruneBackupsCommand,
  runBackupCommand,
  verifyBackupCommand,
} from "../src/admin/commands/backup-commands.ts";
import { sealBackupArchiveFile } from "../src/backup/archive-crypto.ts";
import { decodeBackupArchive } from "../src/backup/archive-format.ts";
import { BackupService } from "../src/backup/backup-service.ts";
import type { BackupDestination } from "../src/backup/destinations/destination.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { type ApiHarness, createApiHarness, createItemViaApi } from "./helpers/app.ts";

let harness: ApiHarness;
let destinationRoot: string;

/** The key the archive is sealed under; the real one is mounted, not generated. */
const ARCHIVE_KEY = randomBytes(32);
const ARCHIVE_AAD = Buffer.from("myownnotion.backup.v1", "utf8");

beforeAll(async () => {
  harness = await createApiHarness();
  destinationRoot = mkdtempSync(path.join(os.tmpdir(), "mon-backup-dest-"));
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(destinationRoot, { recursive: true, force: true });
});

function serviceFor(): BackupService {
  return new BackupService({
    context: harness.built.context,
    destination: new FilesystemDestination(destinationRoot),
    applicationVersion: "0.1.0-test",
    seal: async (plaintextPath, sealedPath) =>
      await sealBackupArchiveFile(ARCHIVE_KEY, plaintextPath, sealedPath),
  });
}

async function producedArchive(): Promise<{
  plaintext: Buffer;
  outcome: Awaited<ReturnType<BackupService["run"]>>;
}> {
  const service = serviceFor();
  const outcome = await service.run("manual");
  const destination = new FilesystemDestination(destinationRoot);
  const stream = await destination.read(outcome.name);
  if (stream === null) {
    throw new Error("the archive was not stored");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const ciphertext = Buffer.concat(chunks);
  const nonce = ciphertext.subarray(0, 12);
  const tag = ciphertext.subarray(12, 28);
  const body = ciphertext.subarray(28);
  const plaintext = Buffer.from(
    openSealed(ARCHIVE_KEY, { nonce, tag, ciphertext: body }, ARCHIVE_AAD),
  );
  return { plaintext, outcome };
}

describe("producing an archive", () => {
  it("reports that no backup attempt has been recorded yet", async () => {
    await expect(
      latestBackupVerificationStatus(harness.built.context.db, harness.built.context.workspaceId),
    ).resolves.toBeNull();
  });

  it("verifies it after creation and after transfer", async () => {
    await createItemViaApi(harness, { kind: "folder", name: "Backed up" });
    const { outcome } = await producedArchive();
    // Two checks, not one repeated: the second re-read the object from the
    // destination, which is the only way a corrupted upload is caught.
    expect(outcome.verifiedAfterCreation).toBe(true);
    expect(outcome.verifiedAfterTransfer).toBe(true);
    expect(outcome.detail).toBeUndefined();
  });

  it("refuses a same-size object whose bytes changed after transfer", async () => {
    const destination = new FilesystemDestination(destinationRoot);
    const service = serviceFor();
    const deps = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination,
      service,
    };
    const produced = await runBackupCommand(deps, "manual");
    expect(produced.code).toBe(0);
    const backupId = produced.data?.["backupId"];
    expect(typeof backupId).toBe("string");
    const stored = (await destination.list()).find((entry) =>
      entry.name.includes(String(backupId).slice(0, 8)),
    );
    expect(stored).toBeDefined();

    const storedPath = path.join(destinationRoot, stored?.name ?? "missing");
    const bytes = readFileSync(storedPath);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    writeFileSync(storedPath, bytes);

    const checked = await verifyBackupCommand(deps, { id: String(backupId) });
    expect(checked.code).not.toBe(0);
    expect(checked.message).toContain("does not match");
  });

  it("records a locally verified backup when the destination fails halfway", async () => {
    let received = 0;
    const destination: BackupDestination = {
      name: "interrupted",
      put: async (_name, contents) => {
        for await (const chunk of contents) {
          received += Buffer.from(chunk as Uint8Array).byteLength;
          throw new Error("simulated interruption after the first chunk");
        }
      },
      list: async () => [],
      read: async () => null,
      delete: async () => undefined,
    };
    const service = new BackupService({
      context: harness.built.context,
      destination,
      applicationVersion: "0.1.0-test",
      seal: async (plaintextPath, sealedPath) =>
        await sealBackupArchiveFile(ARCHIVE_KEY, plaintextPath, sealedPath),
    });

    const result = await runBackupCommand(
      {
        db: harness.built.context.db,
        workspaceId: harness.built.context.workspaceId,
        destination,
        service,
      },
      "scheduled",
    );

    expect(received).toBeGreaterThan(0);
    expect(result).toMatchObject({
      code: 5,
      data: { verifiedAfterCreation: true, verifiedAfterTransfer: false },
    });
    const backupId = String(result.data?.["backupId"]);
    expect(
      (
        await backupsWithVerification(harness.built.context.db, harness.built.context.workspaceId)
      ).find((backup) => backup.id === backupId),
    ).toMatchObject({
      id: backupId,
      destination: null,
      remoteName: null,
      verifiedAtDestination: false,
    });
    await expect(
      latestBackupVerificationStatus(harness.built.context.db, harness.built.context.workspaceId),
    ).resolves.toMatchObject({
      backupId,
      afterCreation: "passed",
      afterTransfer: "failed",
    });
  });

  it("keeps a completed but corrupt transfer addressable for re-verification", async () => {
    const filesystem = new FilesystemDestination(destinationRoot);
    const destination: BackupDestination = {
      name: "corrupting",
      put: async (name, contents, byteLength) => {
        await filesystem.put(name, contents, byteLength);
        const storedPath = path.join(destinationRoot, name);
        const bytes = readFileSync(storedPath);
        bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
        writeFileSync(storedPath, bytes);
      },
      list: async () => await filesystem.list(),
      read: async (name) => await filesystem.read(name),
      delete: async (name) => await filesystem.delete(name),
    };
    const service = new BackupService({
      context: harness.built.context,
      destination,
      applicationVersion: "0.1.0-test",
      seal: async (plaintextPath, sealedPath) =>
        await sealBackupArchiveFile(ARCHIVE_KEY, plaintextPath, sealedPath),
    });
    const deps = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination,
      service,
    };

    const result = await runBackupCommand(deps, "manual");
    expect(result).toMatchObject({ code: 5 });
    const backupId = String(result.data?.["backupId"]);
    const recorded = (
      await backupsWithVerification(harness.built.context.db, harness.built.context.workspaceId)
    ).find((backup) => backup.id === backupId);
    expect(recorded).toMatchObject({
      destination: "corrupting",
      verifiedAtDestination: false,
    });
    expect(recorded?.remoteName).not.toBeNull();
    await expect(verifyBackupCommand(deps, { id: backupId })).resolves.toMatchObject({ code: 5 });
  });

  it("records a completed transfer when its first read-back is unavailable", async () => {
    const filesystem = new FilesystemDestination(destinationRoot);
    let reads = 0;
    const destination: BackupDestination = {
      name: "temporarily-unreadable",
      put: async (name, contents, byteLength) => {
        await filesystem.put(name, contents, byteLength);
      },
      list: async () => await filesystem.list(),
      read: async (name) => {
        reads += 1;
        if (reads === 1) {
          throw new Error("simulated read-back outage");
        }
        return await filesystem.read(name);
      },
      delete: async (name) => await filesystem.delete(name),
    };
    const service = new BackupService({
      context: harness.built.context,
      destination,
      applicationVersion: "0.1.0-test",
      seal: async (plaintextPath, sealedPath) =>
        await sealBackupArchiveFile(ARCHIVE_KEY, plaintextPath, sealedPath),
    });
    const deps = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination,
      service,
    };

    const result = await runBackupCommand(deps, "manual");
    expect(result).toMatchObject({
      code: 5,
      data: { verifiedAfterCreation: true, verifiedAfterTransfer: false },
    });
    const backupId = String(result.data?.["backupId"]);
    expect(
      (
        await backupsWithVerification(harness.built.context.db, harness.built.context.workspaceId)
      ).find((backup) => backup.id === backupId),
    ).toMatchObject({
      destination: "temporarily-unreadable",
      verifiedAtDestination: false,
    });
    await expect(verifyBackupCommand(deps, { id: backupId })).resolves.toMatchObject({ code: 0 });
  });

  it("explains absent selectors, untransferred records and vanished objects", async () => {
    const destination = new FilesystemDestination(destinationRoot);
    const deps = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination,
      service: serviceFor(),
    };
    expect(await verifyBackupCommand(deps, {})).toMatchObject({
      code: 2,
      message: "no such backup",
    });

    const untransferredId = generateUuidV7();
    await recordBackup(harness.built.context.db, {
      id: untransferredId,
      workspaceId: harness.built.context.workspaceId,
      cursor: "42",
      applicationVersion: "sha-test",
      schemaVersion: 1,
      recordFormatVersion: 1,
      byteLength: 10,
      digest: `sha256:${"a".repeat(64)}`,
      reason: "manual",
    });
    expect(await verifyBackupCommand(deps, { id: untransferredId })).toMatchObject({
      code: 2,
      data: { backupId: untransferredId },
    });

    const vanishedId = generateUuidV7();
    await recordBackup(harness.built.context.db, {
      id: vanishedId,
      workspaceId: harness.built.context.workspaceId,
      cursor: "42",
      applicationVersion: "sha-test",
      schemaVersion: 1,
      recordFormatVersion: 1,
      byteLength: 10,
      digest: `sha256:${"b".repeat(64)}`,
      reason: "manual",
      destination: destination.name,
      remoteName: "vanished.tar",
    });
    expect(await verifyBackupCommand(deps, { id: vanishedId })).toMatchObject({
      code: 5,
      data: { backupId: vanishedId },
    });
  });

  it("keeps recent backups and prunes an older copy only when a verified successor exists", async () => {
    const destination = new FilesystemDestination(destinationRoot);
    const deps = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination,
      service: serviceFor(),
      retainDays: 30,
      now: () => new Date("2026-08-19T12:00:00.000Z"),
    };
    expect(await pruneBackupsCommand({ ...deps, retainDays: 36_500 })).toMatchObject({
      code: 0,
      data: { deleted: 0 },
    });

    const oldId = generateUuidV7();
    const oldName = `${oldId}.tar`;
    const oldBytes = Buffer.from("old sealed backup");
    await destination.put(oldName, Readable.from(oldBytes), oldBytes.byteLength);
    await recordBackup(harness.built.context.db, {
      id: oldId,
      workspaceId: harness.built.context.workspaceId,
      cursor: "1",
      applicationVersion: "sha-old",
      schemaVersion: 1,
      recordFormatVersion: 1,
      byteLength: oldBytes.byteLength,
      digest: `sha256:${"c".repeat(64)}`,
      reason: "manual",
      destination: destination.name,
      remoteName: oldName,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await recordVerification(harness.built.context.db, {
      id: generateUuidV7(),
      backupId: oldId,
      stage: "after-transfer",
      outcome: "passed",
      checkedAt: new Date("2025-01-01T00:01:00.000Z"),
    });

    const recentId = generateUuidV7();
    await recordBackup(harness.built.context.db, {
      id: recentId,
      workspaceId: harness.built.context.workspaceId,
      cursor: "2",
      applicationVersion: "sha-recent",
      schemaVersion: 1,
      recordFormatVersion: 1,
      byteLength: 10,
      digest: `sha256:${"d".repeat(64)}`,
      reason: "manual",
      destination: destination.name,
      remoteName: `${recentId}.tar`,
      createdAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    await recordVerification(harness.built.context.db, {
      id: generateUuidV7(),
      backupId: recentId,
      stage: "after-transfer",
      outcome: "passed",
      checkedAt: new Date("2026-08-18T00:01:00.000Z"),
    });

    expect(await pruneBackupsCommand(deps)).toMatchObject({
      code: 0,
      message: "old backups deleted",
      data: { deleted: 1 },
    });
    expect(await destination.read(oldName)).toBeNull();
  });

  it("refuses a second manual or scheduled run while one backup is active", async () => {
    let release!: () => void;
    let entered!: () => void;
    const mayFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hasEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service: Pick<BackupService, "run" | "inspectStored"> = {
      run: async (reason = "manual") => {
        entered();
        await mayFinish;
        return {
          backupId: randomUUID(),
          name: `concurrent-${randomUUID()}.tar`,
          byteLength: 100,
          digest: `sha256:${"a".repeat(64)}`,
          cursor: "0",
          applicationVersion: "sha-test",
          schemaVersion: harness.built.context.schemaVersion,
          recordFormatVersion: 1,
          reason,
          verifiedAfterCreation: true,
          transferred: true,
          verifiedAfterTransfer: true,
        };
      },
      inspectStored: async () => null,
    };
    const deps = {
      db: harness.built.context.db,
      workspaceId: harness.built.context.workspaceId,
      destination: new FilesystemDestination(destinationRoot),
      service,
    };

    const first = runBackupCommand(deps, "manual");
    await hasEntered;
    const second = await runBackupCommand(deps, "scheduled");
    expect(second).toMatchObject({ code: 3 });
    expect(second.message).toMatch(/already running/i);

    release();
    await expect(first).resolves.toMatchObject({ code: 0 });
  });

  it("names the change-feed position it represents", async () => {
    const { outcome } = await producedArchive();
    // Consistency is not a separate mechanism: "one moment" is a number the
    // product already has, and recording it lets an owner say what they lost in
    // changes rather than in minutes.
    expect(outcome.cursor).toMatch(/^\d+$/);
  });

  it("carries the versions needed to read it back", async () => {
    const { plaintext } = await producedArchive();
    const archive = decodeBackupArchive(plaintext) as { manifest: Record<string, unknown> };
    expect(archive.manifest["applicationVersion"]).toBe("0.1.0-test");
    expect(typeof archive.manifest["schemaVersion"]).toBe("number");
    expect(typeof archive.manifest["recordFormatVersion"]).toBe("number");
  });

  it("stores nothing readable at the destination", async () => {
    const { outcome } = await producedArchive();
    const destination = new FilesystemDestination(destinationRoot);
    const stream = await destination.read(outcome.name);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    // Encrypted before it left the machine (FR-007). The destination sees an
    // opaque blob and a name, and the name carries a date and nothing else.
    expect(raw).not.toContain("myownnotion.backup");
    expect(raw).not.toContain("canonicalExport");
    expect(outcome.name).not.toMatch(/workspace|item|page/i);
  });
});

describe("what an archive must never contain", () => {
  it("holds no session, key or recovery material, once decrypted", async () => {
    const { plaintext } = await producedArchive();
    // Searched *after* decryption on purpose. Searching the ciphertext would
    // pass for any encryption at all and would prove nothing about what was put
    // inside.
    for (const forbidden of [
      "mn_dev_session",
      "BEGIN PRIVATE KEY",
      "recovery-kit",
      "session_secret_hash",
      "wrapping_key",
      "password_hash",
    ]) {
      expect(plaintext.toString("utf8"), `archive contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("puts no workspace content in the manifest", async () => {
    await createItemViaApi(harness, { kind: "folder", name: "SecretlyNamedFolder" });
    const { plaintext } = await producedArchive();
    const archive = decodeBackupArchive(plaintext);
    // The manifest is the first thing anybody inspects — an operator listing
    // backups, a support transcript, a bug report — so a title quoted here would
    // leak the workspace into every one of those places.
    expect(JSON.stringify(archive.manifest)).not.toContain("SecretlyNamedFolder");
  });
});
