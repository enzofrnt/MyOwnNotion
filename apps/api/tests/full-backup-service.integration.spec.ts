import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { VerifiedFullArchive } from "../src/backup/full/archive.ts";
import { FullBackupService } from "../src/backup/full/service.ts";

it("captures committed upload prefixes, keeps local recovery through remote failure and retains the last valid copy", async () => {
  const database = await startDisposablePostgres();
  const directory = await mkdtemp(join(tmpdir(), "mon-full-service-"));
  const client = new pg.Client({ connectionString: database.connectionString });
  const key = randomBytes(32);
  let now = new Date("2026-01-01T04:00:00.000Z");
  let remoteAvailable = false;
  const blobRoot = join(directory, "blobs");
  const backupRoot = join(directory, "backups");
  const remote = new FilesystemDestination(join(directory, "remote"));
  const uploadId = randomUUID();
  const blob = Buffer.from("private complete attachment");
  const blobId = createHash("sha256").update(blob).digest("hex");
  try {
    await client.connect();
    await client.query(
      "CREATE TABLE uploads (id uuid PRIMARY KEY, received_length bigint NOT NULL)",
    );
    await client.query("CREATE TABLE file_contents (storage_key text NOT NULL)");
    await client.query("INSERT INTO uploads VALUES ($1, 9)", [uploadId]);
    await client.query("INSERT INTO file_contents VALUES ($1)", [blobId]);
    await mkdir(join(blobRoot, "uploads"), { recursive: true });
    await mkdir(join(blobRoot, blobId.slice(0, 2)));
    await writeFile(join(blobRoot, blobId.slice(0, 2), blobId), blob);
    await writeFile(join(blobRoot, "uploads", uploadId), "committed-uncommitted-tail");
    const service = new FullBackupService({
      connectionString: database.connectionString,
      blobRoot,
      backupRoot,
      key: () => key,
      now: () => now,
      remote: () => {
        if (!remoteAvailable) throw new Error("private remote credential detail");
        return remote;
      },
    });
    const first = await service.run("scheduled");
    expect(first.receipt.remote).toBe("failed");
    expect(await service.lastVerifiedAt()).toEqual(now);
    const bytes = await readFile(first.path);
    expect(bytes.includes(blob)).toBe(false);
    const archive = await VerifiedFullArchive.open(first.path, key, directory);
    try {
      const index = archive.manifest.components.findIndex((part) => part.kind === "upload");
      const chunks: Buffer[] = [];
      for await (const chunk of archive.component(index)) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe("committed");
      expect(archive.manifest.components.find((part) => part.kind === "blob")?.sha256).toBe(blobId);
    } finally {
      await archive.close();
    }
    remoteAvailable = true;
    expect((await service.retryRemote())?.remote).toBe("verified");
    expect(await service.retryRemote()).toBeNull();
    const remoteReceipt = (await service.receipts.list())[0];
    if (remoteReceipt === undefined) throw new Error("Missing recovery receipt");
    await service.receipts.put({ ...remoteReceipt, remote: "failed", remoteVerifiedAt: null });
    const uploaded = vi.spyOn(remote, "put");
    expect((await service.retryRemote())?.remote).toBe("verified");
    expect(uploaded).not.toHaveBeenCalled();
    uploaded.mockRestore();
    await service.receipts.put({ ...remoteReceipt, remote: "failed", remoteVerifiedAt: null });
    await remote.delete(`${remoteReceipt.backupId}.monfull`);
    const actualPut = remote.put.bind(remote);
    const lostUpload = vi
      .spyOn(remote, "put")
      .mockImplementationOnce(async (name, contents, length) => {
        await actualPut(name, contents, length);
        await remote.delete(name);
      });
    expect((await service.retryRemote())?.remote).toBe("failed");
    expect(await readFile(first.path)).toEqual(bytes);
    lostUpload.mockRestore();
    expect((await service.retryRemote())?.remote).toBe("verified");
    await service.receipts.put({ ...remoteReceipt, remote: "failed", remoteVerifiedAt: null });

    await writeFile(
      join(directory, "remote", `${remoteReceipt.backupId}.monfull`),
      Buffer.alloc(remoteReceipt.archiveBytes + 1),
    );
    expect((await service.retryRemote())?.remote).toBe("verified");
    expect(await service.runScheduled(4, "UTC")).toBeNull();
    now = new Date("2026-05-01T04:00:00.000Z");
    expect(await service.prune(90)).toBe(0);
    const second = await service.run("manual");
    remoteAvailable = false;
    expect(await service.prune(90)).toBe(0);
    remoteAvailable = true;
    expect(await service.prune(90)).toBe(1);
    await expect(readFile(first.path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await service.verifiedReceipts()).map((entry) => entry.backupId)).toEqual([
      second.receipt.backupId,
    ]);
    await service.receipts.put({ ...second.receipt, remote: "failed", remoteVerifiedAt: null });
    await writeFile(second.path, "corrupted recovery copy");
    expect((await service.retryRemote())?.remote).toBe("failed");
    // The already verified remote archive survives local corruption and cannot
    // be overwritten by that corrupted local candidate.
    expect(
      (await readFile(join(directory, "remote", `${second.receipt.backupId}.monfull`))).byteLength,
    ).toBe(second.receipt.archiveBytes);
    expect(await service.lastVerifiedAt()).toBeNull();
    await expect(service.rehearseLatest()).rejects.toThrow("No locally verified");
    expect((await service.activities.read("rehearsal"))?.outcome).toBe("failed");
    await expect(service.prune(0)).rejects.toThrow("retention");
    await writeFile(join(backupRoot, `${randomUUID()}.receipt`), "invalid encrypted receipt");
    expect((await service.receipts.scan()).invalidCount).toBe(1);
    await rm(join(blobRoot, blobId.slice(0, 2), blobId));
    await expect(service.run("manual")).rejects.toThrow("missing");
  } finally {
    await client.end();
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
