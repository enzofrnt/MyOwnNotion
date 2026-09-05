/** Complete snapshot orchestration; verified local artifacts survive later failures. */
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { FULL_BACKUP_FORMAT, type FullBackupManifest } from "@myownnotion/domain";
import pg from "pg";
import type { BackupDestination } from "../destinations/destination.ts";
import { backupIsDue } from "../schedule.ts";
import { FullBackupActivities } from "./activity.ts";
import { writeFullArchive } from "./archive.ts";
import { componentAad, sealFullStream } from "./crypto.ts";
import { captureFullFiles } from "./files.ts";
import { acquireFullBackupLocks, acquireFullRunLock, type FullBackupLockRelease } from "./locks.ts";
import { PostgresFullBackupTools } from "./postgres.ts";
import { type FullBackupReceipt, FullBackupReceipts, fullArchiveName } from "./receipts.ts";
import { rehearseFullBackup } from "./rehearsal.ts";
import { inspectFullSource } from "./source.ts";

export interface FullBackupServiceOptions {
  readonly connectionString: string;
  readonly blobRoot: string;
  readonly backupRoot: string;
  readonly key: () => Uint8Array;
  readonly tools?: PostgresFullBackupTools;
  readonly now?: () => Date;
  readonly remote?: () => BackupDestination;
}

export async function fullArchiveDigest(
  path: string,
): Promise<{ byteLength: number; sha256: string }> {
  const hash = createHash("sha256");
  let byteLength = 0;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("The complete backup must be a regular file.");
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk as Buffer);
      byteLength += (chunk as Buffer).byteLength;
    }
  } finally {
    await handle.close();
  }
  return { byteLength, sha256: hash.digest("hex") };
}

async function matchesRemote(stored: Readable, receipt: FullBackupReceipt): Promise<boolean> {
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of stored) {
      const bytes = chunk as Buffer;
      size += bytes.byteLength;
      if (size > receipt.archiveBytes) return false;
      hash.update(bytes);
    }
    return size === receipt.archiveBytes && hash.digest("hex") === receipt.archiveSha256;
  } finally {
    stored.destroy();
  }
}

export class FullBackupService {
  readonly receipts: FullBackupReceipts;
  readonly activities: FullBackupActivities;
  private readonly tools: PostgresFullBackupTools;
  private readonly now: () => Date;

  constructor(private readonly options: FullBackupServiceOptions) {
    this.receipts = new FullBackupReceipts(options.backupRoot, options.key);
    this.activities = new FullBackupActivities(options.backupRoot, options.key);
    this.tools = options.tools ?? new PostgresFullBackupTools();
    this.now = options.now ?? (() => new Date());
  }

  /** A receipt alone is insufficient when its actual recovery artifact is gone. */
  async verifiedReceipts(limit = Number.POSITIVE_INFINITY): Promise<FullBackupReceipt[]> {
    const verified: FullBackupReceipt[] = [];
    for (const receipt of await this.receipts.list()) {
      try {
        const digest = await fullArchiveDigest(
          join(this.options.backupRoot, fullArchiveName(receipt.backupId)),
        );
        if (digest.sha256 === receipt.archiveSha256 && digest.byteLength === receipt.archiveBytes)
          verified.push(receipt);
      } catch {
        // Missing/corrupted storage cannot satisfy a daily protection deadline.
      }
      if (verified.length >= limit) break;
    }
    return verified;
  }

  async lastVerifiedAt(): Promise<Date | null> {
    const latest = (await this.verifiedReceipts(1))[0];
    return latest === undefined ? null : new Date(latest.verifiedAt);
  }

  async runScheduled(hour: number, timeZone: string): Promise<FullBackupReceipt | null> {
    const client = new pg.Client({
      connectionString: this.options.connectionString,
      connectionTimeoutMillis: 15_000,
    });
    let release: (() => Promise<void>) | undefined;
    try {
      await client.connect();
      release = await acquireFullRunLock(client);
      if (!backupIsDue({ now: this.now(), lastRunAt: await this.lastVerifiedAt(), hour, timeZone }))
        return null;
      return (await this.run("scheduled", client)).receipt;
    } finally {
      try {
        await release?.();
      } finally {
        await client.end();
      }
    }
  }

  async prune(retentionDays: number): Promise<number> {
    if (!Number.isInteger(retentionDays) || retentionDays < 1)
      throw new Error("Invalid full-backup retention.");
    const client = new pg.Client({
      connectionString: this.options.connectionString,
      connectionTimeoutMillis: 15_000,
    });
    let release: (() => Promise<void>) | undefined;
    try {
      await client.connect();
      release = await acquireFullRunLock(client);
      const verified = await this.verifiedReceipts();
      const latest = verified[0];
      const cutoff = this.now().getTime() - retentionDays * 86_400_000;
      let removed = 0;
      for (const receipt of verified) {
        if (receipt.backupId === latest?.backupId || Date.parse(receipt.createdAt) >= cutoff)
          continue;
        if (this.options.remote !== undefined) {
          try {
            await this.options.remote().delete(fullArchiveName(receipt.backupId));
          } catch {
            continue;
          }
        }
        await rm(join(this.options.backupRoot, fullArchiveName(receipt.backupId)));
        await this.receipts.remove(receipt.backupId);
        removed += 1;
      }
      return removed;
    } finally {
      try {
        await release?.();
      } finally {
        await client.end();
      }
    }
  }

  async run(
    reason: FullBackupManifest["reason"],
    coordinator?: pg.Client,
  ): Promise<{ manifest: FullBackupManifest; receipt: FullBackupReceipt; path: string }> {
    const client =
      coordinator ??
      new pg.Client({
        connectionString: this.options.connectionString,
        connectionTimeoutMillis: 15_000,
      });
    let release: (() => Promise<void>) | undefined;
    const startedAt = this.now().toISOString();
    try {
      if (coordinator === undefined) await client.connect();
      release = await acquireFullRunLock(client);
      const roots = await this.prepareStorage();
      await this.activities.put("backup", {
        startedAt,
        finishedAt: null,
        outcome: "running",
        backupId: null,
      });
      try {
        const result = await this.capture(reason, client, roots);
        await this.activities.put("backup", {
          startedAt,
          finishedAt: this.now().toISOString(),
          outcome: "succeeded",
          backupId: result.manifest.backupId,
        });
        return result;
      } catch (error) {
        await this.activities
          .put("backup", {
            startedAt,
            finishedAt: this.now().toISOString(),
            outcome: "failed",
            backupId: null,
          })
          .catch(() => undefined);
        throw error;
      }
    } finally {
      try {
        await release?.();
      } finally {
        if (coordinator === undefined) await client.end();
      }
    }
  }

  async rehearseLatest() {
    return await this.rehearseArchive();
  }

  async rehearseArchive(archivePath?: string): Promise<{
    backupId: string;
    databaseRestored: true;
    filesVerified: number;
  }> {
    const client = new pg.Client({
      connectionString: this.options.connectionString,
      connectionTimeoutMillis: 15_000,
    });
    let release: (() => Promise<void>) | undefined;
    const startedAt = this.now().toISOString();
    let key: Buffer | undefined;
    try {
      await client.connect();
      release = await acquireFullRunLock(client);
      await this.activities.put("rehearsal", {
        startedAt,
        finishedAt: null,
        outcome: "running",
        backupId: null,
      });
      try {
        if (archivePath === undefined) {
          const receipt = (await this.verifiedReceipts(1))[0];
          if (receipt === undefined)
            throw new Error("No locally verified complete backup is available for rehearsal.");
          archivePath = join(this.options.backupRoot, fullArchiveName(receipt.backupId));
        }
        key = Buffer.from(this.options.key());
        const result = await rehearseFullBackup({
          archivePath,
          connectionString: this.options.connectionString,
          activeDirectory: this.options.blobRoot,
          key,
        });
        await this.activities.put("rehearsal", {
          startedAt,
          finishedAt: this.now().toISOString(),
          outcome: "succeeded",
          backupId: result.backupId,
        });
        return result;
      } catch (error) {
        await this.activities
          .put("rehearsal", {
            startedAt,
            finishedAt: this.now().toISOString(),
            outcome: "failed",
            backupId: null,
          })
          .catch(() => undefined);
        throw error;
      }
    } finally {
      key?.fill(0);
      try {
        await release?.();
      } finally {
        await client.end();
      }
    }
  }

  private async prepareStorage(): Promise<{ backupRoot: string; blobRoot: string }> {
    const lexical = relative(resolve(this.options.blobRoot), resolve(this.options.backupRoot));
    if (
      lexical === "" ||
      (!(lexical === ".." || lexical.startsWith(`..${sep}`)) && !isAbsolute(lexical))
    )
      throw new Error("Complete backups must be stored outside the blob root.");
    await mkdir(this.options.backupRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.options.blobRoot, { recursive: true, mode: 0o700 });
    const backupRoot = await realpath(this.options.backupRoot);
    const blobRoot = await realpath(this.options.blobRoot);
    const separation = relative(blobRoot, backupRoot);
    if (
      separation === "" ||
      (!(separation === ".." || separation.startsWith(`..${sep}`)) && !isAbsolute(separation))
    ) {
      throw new Error("Complete backups must be stored outside the blob root.");
    }
    // RUN is held: these unpublished staging names cannot belong to a live run.
    for (const name of await readdir(backupRoot)) {
      if (
        /^\.full-(stage|publish)-[A-Za-z0-9]+$/.test(name) ||
        /^\.(receipt|activity)-[0-9a-f-]{36}$/.test(name)
      )
        await rm(join(backupRoot, name), { recursive: true, force: true });
    }
    return { backupRoot, blobRoot };
  }

  private async capture(
    reason: FullBackupManifest["reason"],
    client: pg.Client,
    roots: { backupRoot: string; blobRoot: string },
  ): Promise<{ manifest: FullBackupManifest; receipt: FullBackupReceipt; path: string }> {
    await this.tools.checkVersions(this.options.connectionString);
    const { backupRoot, blobRoot } = roots;
    const stagingDirectory = await mkdtemp(join(backupRoot, ".full-stage-"));
    let key: Buffer | undefined;
    let release: FullBackupLockRelease | undefined;
    let transaction = false;
    try {
      key = Buffer.from(this.options.key());
      release = await acquireFullBackupLocks(client);
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transaction = true;
      const source = await inspectFullSource(client);
      const backupId = randomUUID();
      const createdAt = this.now().toISOString();
      const snapshot = (
        await client.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot")
      ).rows[0]?.snapshot;
      if (snapshot === undefined) throw new Error("The backup snapshot could not be exported.");
      const files = await captureFullFiles({ client, blobRoot, stagingDirectory, backupId, key });
      const dumpPath = join(stagingDirectory, "component-0");
      const dump = await sealFullStream(
        this.tools.dump(this.options.connectionString, snapshot),
        key,
        componentAad(backupId, 0, "database.dump"),
        dumpPath,
      );
      const manifest: FullBackupManifest = {
        format: FULL_BACKUP_FORMAT,
        formatVersion: 1,
        backupId,
        createdAt,
        reason,
        source: source.source,
        components: [{ kind: "database", path: "database.dump", ...dump }, ...files.components],
      };
      await client.query("COMMIT");
      transaction = false;
      await release.releaseFiles();
      const path = join(backupRoot, fullArchiveName(backupId));
      await writeFullArchive({
        manifest,
        encryptedComponents: [dumpPath, ...files.encryptedPaths],
        key,
        destination: path,
      });
      const digest = await fullArchiveDigest(path);
      if ((await stat(path)).size !== digest.byteLength)
        throw new Error("The published backup changed unexpectedly.");
      const receipt: FullBackupReceipt = {
        formatVersion: 1,
        backupId,
        createdAt,
        verifiedAt: this.now().toISOString(),
        sourceVersion: source.source.applicationVersion,
        reason,
        archiveBytes: digest.byteLength,
        archiveSha256: digest.sha256,
        remote: this.options.remote === undefined ? "not-configured" : "pending",
        remoteVerifiedAt: null,
      };
      await this.receipts.put(receipt);
      const outcome = await this.copyRemote(receipt);
      return { manifest, receipt: outcome, path };
    } finally {
      try {
        if (transaction) await client.query("ROLLBACK").catch(() => undefined);
        await release?.();
      } finally {
        key?.fill(0);
        await rm(stagingDirectory, { recursive: true, force: true });
      }
    }
  }

  /** A remote outage never removes or invalidates the locally verified artifact. */
  private async copyRemote(receipt: FullBackupReceipt): Promise<FullBackupReceipt> {
    if (this.options.remote === undefined || receipt.remote === "verified") return receipt;
    const name = fullArchiveName(receipt.backupId);
    let outcome: FullBackupReceipt;
    try {
      const destination = this.options.remote();
      const path = join(this.options.backupRoot, name);
      const local = await fullArchiveDigest(path);
      if (local.byteLength !== receipt.archiveBytes || local.sha256 !== receipt.archiveSha256) {
        throw new Error("The local recovery artifact no longer matches its verification.");
      }
      const existing = await destination.read(name);
      if (existing === null || !(await matchesRemote(existing, receipt))) {
        if (existing !== null) await destination.delete(name);
        const contents = createReadStream(path);
        try {
          await destination.put(name, contents, receipt.archiveBytes);
        } finally {
          contents.destroy();
        }
        const stored = await destination.read(name);
        if (stored === null || !(await matchesRemote(stored, receipt))) {
          throw new Error("The remote recovery artifact did not verify.");
        }
      }
      outcome = { ...receipt, remote: "verified", remoteVerifiedAt: this.now().toISOString() };
    } catch {
      outcome = { ...receipt, remote: "failed", remoteVerifiedAt: null };
    }
    await this.receipts.put(outcome);
    return outcome;
  }

  /** Retry one newest unprotected artifact per tick; the catalogue remains local. */
  async retryRemote(): Promise<FullBackupReceipt | null> {
    if (this.options.remote === undefined) return null;
    const client = new pg.Client({
      connectionString: this.options.connectionString,
      connectionTimeoutMillis: 15_000,
    });
    let release: (() => Promise<void>) | undefined;
    try {
      await client.connect();
      release = await acquireFullRunLock(client);
      const pending = (await this.receipts.list()).find(
        (receipt) => receipt.remote === "pending" || receipt.remote === "failed",
      );
      return pending === undefined ? null : await this.copyRemote(pending);
    } finally {
      try {
        await release?.();
      } finally {
        await client.end();
      }
    }
  }
}
