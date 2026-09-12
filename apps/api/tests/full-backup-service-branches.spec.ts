import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import type { PostgresFullBackupTools } from "../src/backup/full/postgres.ts";
import type { FullBackupReceipt } from "../src/backup/full/receipts.ts";
import { FullBackupService } from "../src/backup/full/service.ts";

const fsFault = vi.hoisted(() => ({ tamperPublishedArchive: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (
      path: Parameters<typeof actual.stat>[0],
      options?: Parameters<typeof actual.stat>[1],
    ) => {
      const result = await actual.stat(path, options);
      if (fsFault.tamperPublishedArchive && String(path).endsWith(".monfull")) {
        return new Proxy(result, {
          get(target, property, receiver) {
            if (property === "size") return Number(target.size) + 1;
            return Reflect.get(target, property, receiver);
          },
        });
      }
      return result;
    },
  };
});

function archiveReceipt(backupId: string, bytes: Buffer): FullBackupReceipt {
  return {
    formatVersion: 1,
    backupId,
    createdAt: "2026-01-01T04:00:00.000Z",
    verifiedAt: "2026-01-01T04:00:01.000Z",
    sourceVersion: null,
    reason: "scheduled",
    archiveBytes: bytes.byteLength,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    remote: "failed",
    remoteVerifiedAt: null,
  };
}

it("uses the backup identity to break equal-age legacy retry ties", async () => {
  const database = await startDisposablePostgres();
  const directory = await mkdtemp(join(tmpdir(), "mon-full-service-tie-"));
  const key = randomBytes(32);
  const blobRoot = join(directory, "blobs");
  const backupRoot = join(directory, "backups");
  const remote = new FilesystemDestination(join(directory, "remote"));
  const firstId = "00000000-0000-4000-8000-000000000001";
  const secondId = "00000000-0000-4000-8000-000000000002";
  const firstBytes = Buffer.from("first legacy archive");
  const secondBytes = Buffer.from("second legacy archive");
  const first = archiveReceipt(firstId, firstBytes);
  const second = archiveReceipt(secondId, secondBytes);
  const service = new FullBackupService({
    connectionString: database.connectionString,
    blobRoot,
    backupRoot,
    key: () => key,
    remote: () => remote,
  });
  try {
    await mkdir(blobRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });
    await writeFile(join(backupRoot, `${firstId}.monfull`), firstBytes);
    await writeFile(join(backupRoot, `${secondId}.monfull`), secondBytes);
    await service.receipts.put(first);
    await service.receipts.put(second);

    const [expectedFirst, expectedSecond] =
      firstId.localeCompare(secondId) <= 0 ? [firstId, secondId] : [secondId, firstId];
    expect((await service.retryRemote())?.backupId).toBe(expectedFirst);
    expect((await service.retryRemote())?.backupId).toBe(expectedSecond);
  } finally {
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses a published archive whose size changes before receipt publication", async () => {
  const database = await startDisposablePostgres();
  const directory = await mkdtemp(join(tmpdir(), "mon-full-service-publish-"));
  const key = randomBytes(32);
  const blobRoot = join(directory, "blobs");
  const backupRoot = join(directory, "backups");
  const client = new pg.Client({ connectionString: database.connectionString });
  const tools = {
    checkVersions: async () => undefined,
    dump: async function* () {
      yield Buffer.from("synthetic pg dump");
    },
  } as unknown as PostgresFullBackupTools;
  const service = new FullBackupService({
    connectionString: database.connectionString,
    blobRoot,
    backupRoot,
    key: () => key,
    tools,
  });
  try {
    await client.connect();
    await client.query(
      "CREATE TABLE uploads (id uuid PRIMARY KEY, received_length bigint NOT NULL); CREATE TABLE file_contents (storage_key text NOT NULL)",
    );
    await client.end();
    fsFault.tamperPublishedArchive = true;
    await expect(service.run("manual")).rejects.toThrow("published backup changed unexpectedly");
    expect((await service.receipts.list()).length).toBe(0);
  } finally {
    fsFault.tamperPublishedArchive = false;
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
