import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DisposablePostgres, startDisposablePostgres } from "@myownnotion/test-utils";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VerifiedFullArchive } from "../src/backup/full/archive.ts";
import { PostgresFullBackupTools } from "../src/backup/full/postgres.ts";
import { FullBackupService, fullArchiveDigest } from "../src/backup/full/service.ts";

let source: DisposablePostgres;
let client: pg.Client;
let directory: string;
let blobRoot: string;
let backupRoot: string;
const key = randomBytes(32);
const blob = Buffer.from("private complete attachment");
const digest = createHash("sha256").update(blob).digest("hex");
const uploadId = randomUUID();

beforeAll(async () => {
  source = await startDisposablePostgres();
  client = new pg.Client({ connectionString: source.connectionString });
  await client.connect();
  await client.query(
    "CREATE TABLE file_contents(storage_key text PRIMARY KEY); CREATE TABLE uploads(id uuid PRIMARY KEY, received_length bigint NOT NULL); CREATE TABLE unknown_records(id integer PRIMARY KEY, private_value text)",
  );
  directory = await mkdtemp(join(tmpdir(), "mon-full-service-test-"));
  blobRoot = join(directory, "blobs");
  backupRoot = join(directory, "backups");
});
beforeEach(async () => {
  await client.query("TRUNCATE file_contents, uploads, unknown_records");
  await rm(blobRoot, { recursive: true, force: true });
  await rm(backupRoot, { recursive: true, force: true });
  await mkdir(join(blobRoot, digest.slice(0, 2)), { recursive: true });
  await mkdir(join(blobRoot, "uploads"), { recursive: true });
  await writeFile(join(blobRoot, digest.slice(0, 2), digest), blob);
  await writeFile(join(blobRoot, "uploads", uploadId), "confirmeduncommitted suffix");
  await client.query("INSERT INTO file_contents VALUES ($1)", [digest]);
  await client.query("INSERT INTO uploads VALUES ($1, 9), ($2, 0)", [uploadId, randomUUID()]);
  await client.query("INSERT INTO unknown_records VALUES (1, 'preserve unknown tables')");
});
afterAll(async () => {
  await client?.end();
  await source?.stop();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});
function service(tools?: PostgresFullBackupTools) {
  return new FullBackupService({
    connectionString: source.connectionString,
    blobRoot,
    backupRoot,
    key: () => key,
    ...(tools === undefined ? {} : { tools }),
  });
}
async function bytes(input: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("complete server backup orchestration", () => {
  it("saves all database records, blobs and committed upload prefixes with independently readable receipts", async () => {
    const backup = service();
    const result = await backup.run("manual");
    expect(result.manifest.source.applicationVersion).toBeNull();
    expect(result.manifest.components).toHaveLength(4);
    const archive = await VerifiedFullArchive.open(result.path, key, directory);
    try {
      for (const [index, component] of archive.manifest.components.entries()) {
        const contents = await bytes(archive.component(index));
        if (component.kind === "blob") expect(contents).toEqual(blob);
        if (component.path === `uploads/${uploadId}`) expect(contents.toString()).toBe("confirmed");
      }
      const target = await startDisposablePostgres();
      const read = new pg.Client({ connectionString: target.connectionString });
      try {
        await new PostgresFullBackupTools().restore(target.connectionString, archive.component(0));
        await read.connect();
        expect((await read.query("SELECT * FROM unknown_records")).rows).toEqual([
          { id: 1, private_value: "preserve unknown tables" },
        ]);
        expect(
          (await read.query("SELECT received_length FROM uploads WHERE id = $1", [uploadId]))
            .rows[0].received_length,
        ).toBe("9");
      } finally {
        await read.end();
        await target.stop();
      }
    } finally {
      await archive.close();
    }
    expect(await backup.receipts.list()).toEqual([result.receipt]);
    const persisted = await readFile(result.path);
    expect(persisted.includes(blob)).toBe(false);
    expect(
      (await readdir(backupRoot)).filter(
        (name) => name.startsWith(".") && name !== ".full-backup-activity",
      ),
    ).toEqual([]);
    expect((await backup.activities.read("backup"))?.outcome).toBe("succeeded");
  });

  it.each([
    "missing-blob",
    "corrupt-blob",
    "short-prefix",
    "unknown-entry",
    "upload-symlink",
    "invalid-blob-name",
    "symlink-blob",
    "invalid-upload-length",
  ])("refuses %s without a successful receipt or schema mutation", async (failure) => {
    const blobPath = join(blobRoot, digest.slice(0, 2), digest);
    if (failure === "missing-blob") await rm(blobPath);
    if (failure === "corrupt-blob") await writeFile(blobPath, "damaged");
    if (failure === "short-prefix") await writeFile(join(blobRoot, "uploads", uploadId), "short");
    if (failure === "unknown-entry") await writeFile(join(blobRoot, "unsupported"), "extra data");
    if (failure === "upload-symlink") {
      await rm(join(blobRoot, "uploads"), { recursive: true });
      await symlink(directory, join(blobRoot, "uploads"), "dir");
    }
    if (failure === "invalid-blob-name")
      await writeFile(join(blobRoot, digest.slice(0, 2), "wrong-identity"), "unexpected");
    if (failure === "symlink-blob") {
      await rm(blobPath);
      await symlink(join(blobRoot, "uploads", uploadId), blobPath);
    }
    if (failure === "invalid-upload-length")
      await client.query("UPDATE uploads SET received_length = -1 WHERE id = $1", [uploadId]);
    const backup = service();
    await expect(backup.run("pre-update")).rejects.toThrow();
    expect(await backup.receipts.list()).toEqual([]);
    expect(await readdir(backupRoot)).toEqual([".full-backup-activity"]);
    expect((await service().activities.read("backup"))?.outcome).toBe("failed");
    expect(
      (await client.query("SELECT to_regclass('public.schema_migrations') AS relation")).rows[0]
        .relation,
    ).toBeNull();
  });

  it("does not treat uncommitted atomic blob staging as a durable attachment", async () => {
    await writeFile(join(blobRoot, digest.slice(0, 2), ".tmp-0123456789abcdef"), "uncommitted");
    const result = await service().run("manual");
    expect(result.manifest.components).toHaveLength(4);
    expect(result.manifest.components.some((component) => component.path.includes(".tmp-"))).toBe(
      false,
    );
  });

  it("releases snapshot and file coordination after an interrupted dump so the next backup can complete", async () => {
    class InterruptedDump extends PostgresFullBackupTools {
      override async *dump() {
        yield Buffer.from("PGDMP incomplete private source");
        throw new Error("interrupted dump fixture");
      }
    }
    await expect(service(new InterruptedDump()).run("manual")).rejects.toThrow("interrupted dump");
    expect(await readdir(backupRoot)).toEqual([".full-backup-activity"]);
    expect((await service().activities.read("backup"))?.outcome).toBe("failed");
    const result = await service().run("manual");
    expect(result.receipt.verifiedAt).toBeTruthy();
  });

  it("refuses backup storage inside the captured blob root", async () => {
    const backup = new FullBackupService({
      connectionString: source.connectionString,
      blobRoot,
      backupRoot: join(blobRoot, "nested-backups"),
      key: () => key,
    });
    await expect(backup.run("manual")).rejects.toThrow("outside the blob root");
  });

  it("resolves storage symlinks before allowing a backup and cleans only abandoned staging", async () => {
    const alias = join(directory, "blob-alias");
    await symlink(blobRoot, alias, "dir");
    const unsafe = new FullBackupService({
      connectionString: source.connectionString,
      blobRoot,
      backupRoot: join(alias, "nested-backups"),
      key: () => key,
    });
    await expect(unsafe.run("manual")).rejects.toThrow("outside the blob root");
    await rm(join(blobRoot, "nested-backups"), { recursive: true });
    await mkdir(backupRoot, { recursive: true });
    await mkdir(join(backupRoot, ".full-stage-Ab12"));
    await writeFile(join(backupRoot, ".full-stage-Ab12", "interrupted"), "ciphertext fixture");
    await writeFile(join(backupRoot, `.receipt-${randomUUID()}`), "interrupted metadata");
    await writeFile(join(backupRoot, "operator-note.txt"), "retain this file");
    const result = await service().run("manual");
    const names = await readdir(backupRoot);
    expect(
      names.some((name) => name.startsWith(".full-stage-") || name.startsWith(".receipt-")),
    ).toBe(false);
    expect(await readFile(join(backupRoot, "operator-note.txt"), "utf8")).toBe("retain this file");
    expect(await fullArchiveDigest(result.path)).toMatchObject({
      sha256: result.receipt.archiveSha256,
    });
    await expect(fullArchiveDigest(backupRoot)).rejects.toThrow("regular file");
  });

  it("cleans unpublished capture even when the external key disappears after the activity record", async () => {
    let reads = 0;
    const unavailable = new FullBackupService({
      connectionString: source.connectionString,
      blobRoot,
      backupRoot,
      key: () => {
        reads += 1;
        if (reads > 1) throw new Error("external key became unavailable");
        return key;
      },
    });
    await expect(unavailable.run("manual")).rejects.toThrow("external key became unavailable");
    expect(await readdir(backupRoot)).toEqual([".full-backup-activity"]);
    expect((await service().activities.read("backup"))?.outcome).toBe("running");
    expect(await service().lastVerifiedAt()).toBeNull();
  });

  it("removes staging after the snapshot connection is lost and permits a fresh backup", async () => {
    const coordinator = new pg.Client({ connectionString: source.connectionString });
    await coordinator.connect();
    class LostSnapshot extends PostgresFullBackupTools {
      override async *dump() {
        await coordinator.end();
        yield Buffer.from("interrupted fixture");
        throw new Error("snapshot connection was lost");
      }
    }
    await expect(service(new LostSnapshot()).run("manual", coordinator)).rejects.toThrow();
    expect(await readdir(backupRoot)).toEqual([".full-backup-activity"]);
    expect(await service().lastVerifiedAt()).toBeNull();
    expect((await service().run("manual")).receipt.verifiedAt).toBeTruthy();
  });

  it("leaves an interrupted rehearsal explicit when its external key disappears", async () => {
    const created = await service().run("manual");
    let reads = 0;
    const unavailable = new FullBackupService({
      connectionString: source.connectionString,
      blobRoot,
      backupRoot,
      key: () => {
        if (++reads > 1) throw new Error("rehearsal key disappeared");
        return key;
      },
    });
    await expect(unavailable.rehearseArchive(created.path)).rejects.toThrow("key disappeared");
    expect((await service().activities.read("rehearsal"))?.outcome).toBe("running");
    expect(await service().lastVerifiedAt()).not.toBeNull();
  });
});
