import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { VerifiedFullArchive } from "../src/backup/full/archive.ts";
import { acquireFullBackupLocks, shareFullBlobDeletion } from "../src/backup/full/locks.ts";
import { PostgresFullBackupTools } from "../src/backup/full/postgres.ts";
import { FullBackupService } from "../src/backup/full/service.ts";
import { createApiHarness } from "./helpers/app.ts";

it("holds physical deletion until file capture is released while retaining run coordination", async () => {
  const harness = await createApiHarness();
  const coordinator = new pg.Client({ connectionString: harness.postgres.connectionString });
  const file = join(harness.blobRoot, "deletion-fixture");
  let release: Awaited<ReturnType<typeof acquireFullBackupLocks>> | undefined;
  let deletion: Promise<void> | undefined;
  try {
    await coordinator.connect();
    await writeFile(file, "durable attachment");
    release = await acquireFullBackupLocks(coordinator);
    deletion = harness.built.context.db.transaction(async (tx) => {
      await shareFullBlobDeletion(tx);
      await rm(file);
    });
    void deletion.catch(() => undefined);
    await expect
      .poll(async () =>
        Number(
          (
            await coordinator.query(
              "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    expect(await readFile(file, "utf8")).toBe("durable attachment");
    await release.releaseFiles();
    await release.releaseFiles();
    await deletion;
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      Number(
        (
          await coordinator.query(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted",
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  } finally {
    await release?.();
    await deletion?.catch(() => undefined);
    await coordinator.end();
    await harness.close();
  }
});

it("keeps upload finalization and prefix deletion behind the snapshot, then coalesces concurrent nightly calls", async () => {
  const harness = await createApiHarness();
  const root = await mkdtemp(join(tmpdir(), "mon-full-consistency-"));
  const observer = new pg.Client({ connectionString: harness.postgres.connectionString });
  const key = randomBytes(32);
  const pending: Promise<unknown>[] = [];
  let releaseDump: () => void = () => undefined;
  let enteredDump: () => void = () => undefined;
  const paused = new Promise<void>((resolve) => {
    enteredDump = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    releaseDump = resolve;
  });
  class PausedDump extends PostgresFullBackupTools {
    override async *dump(connectionString: string, snapshot: string) {
      enteredDump();
      await proceed;
      yield* super.dump(connectionString, snapshot);
    }
  }
  const service = new FullBackupService({
    connectionString: harness.postgres.connectionString,
    blobRoot: harness.blobRoot,
    backupRoot: root,
    key: () => key,
    tools: new PausedDump(),
    now: () => new Date("2026-09-05T04:00:00.000Z"),
  });
  try {
    await observer.connect();
    const created = await harness.built.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: { "upload-length": "8" },
    });
    expect(created.statusCode).toBe(201);
    const url = String(created.headers["location"]);
    const uploadId = url.split("/").at(-1) ?? "";
    const prefix = await harness.built.app.inject({
      method: "PATCH",
      url,
      headers: { "upload-offset": "0", "content-type": "application/offset+octet-stream" },
      payload: Buffer.from("head"),
    });
    expect(prefix.statusCode).toBe(204);
    const backup = service.run("manual");
    pending.push(backup);
    void backup.catch(() => undefined);
    await paused;
    const completed = harness.built.app
      .inject({
        method: "PATCH",
        url,
        headers: { "upload-offset": "4", "content-type": "application/offset+octet-stream" },
        payload: Buffer.from("tail"),
      })
      .then((response) => response);
    pending.push(completed);
    void completed.catch(() => undefined);
    await expect
      .poll(async () =>
        Number(
          (
            await observer.query(
              "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND NOT granted",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    expect(
      Buffer.from((await harness.built.context.partialUploads.read(uploadId)) ?? []).toString(),
    ).toBe("head");
    releaseDump();
    const result = await backup;
    expect((await completed).statusCode).toBe(201);
    expect(await harness.built.context.partialUploads.read(uploadId)).toBeNull();
    const archive = await VerifiedFullArchive.open(result.path, key, root);
    try {
      const index = archive.manifest.components.findIndex(
        (entry) => entry.path === `uploads/${uploadId}`,
      );
      const parts: Buffer[] = [];
      for await (const part of archive.component(index)) parts.push(Buffer.from(part));
      expect(Buffer.concat(parts).toString()).toBe("head");
      expect(archive.manifest.components.filter((entry) => entry.kind === "blob")).toHaveLength(0);
    } finally {
      await archive.close();
    }
    // Both callers start from a new deadline; only the winner may publish it.
    const nextDay = new FullBackupService({
      connectionString: harness.postgres.connectionString,
      blobRoot: harness.blobRoot,
      backupRoot: root,
      key: () => key,
      now: () => new Date("2026-09-06T04:00:00.000Z"),
    });
    const runs = await Promise.all([
      nextDay.runScheduled(4, "UTC"),
      nextDay.runScheduled(4, "UTC"),
    ]);
    expect(runs.filter((result) => result !== null)).toHaveLength(1);
    expect((await nextDay.verifiedReceipts()).length).toBe(2);
  } finally {
    releaseDump();
    await Promise.allSettled(pending);
    await observer.end();
    await harness.close();
    await rm(root, { recursive: true, force: true });
  }
});
