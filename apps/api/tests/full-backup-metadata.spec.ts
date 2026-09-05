import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal } from "@myownnotion/domain/security";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FullBackupActivities, type FullBackupActivity } from "../src/backup/full/activity.ts";
import { type FullBackupReceipt, FullBackupReceipts } from "../src/backup/full/receipts.ts";
import {
  assertFullRestoreActivated,
  readFullRestoreState,
  writeFullRestoreState,
} from "../src/backup/full/restore-state.ts";
import { FullBackupService } from "../src/backup/full/service.ts";
import { fullBackupStatus } from "../src/backup/full/status.ts";

let root: string;
const key = randomBytes(32);
const now = "2026-09-05T04:00:00.000Z";
const id = randomUUID();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mon-full-metadata-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const activity: FullBackupActivity = {
  startedAt: now,
  finishedAt: now,
  outcome: "succeeded",
  backupId: id,
};
const receipt: FullBackupReceipt = {
  formatVersion: 1,
  backupId: id,
  createdAt: now,
  verifiedAt: now,
  sourceVersion: null,
  reason: "manual",
  archiveBytes: 200,
  archiveSha256: "a".repeat(64),
  remote: "not-configured",
  remoteVerifiedAt: null,
};
async function encrypted(path: string, value: unknown, aad: string) {
  const envelope = seal(key, Buffer.from(JSON.stringify(value)), Buffer.from(aad));
  await writeFile(
    path,
    Buffer.concat([
      Buffer.from(envelope.nonce),
      Buffer.from(envelope.tag),
      Buffer.from(envelope.ciphertext),
    ]),
  );
}

it("authenticates operational records separately and refuses wrong keys, symlinks and oversized metadata", async () => {
  const store = new FullBackupActivities(root, () => key);
  expect(await store.read("backup")).toBeNull();
  await store.put("backup", activity);
  expect(await store.read("backup")).toEqual(activity);
  const bytes = await readFile(join(root, ".full-backup-activity"));
  expect(bytes.includes(Buffer.from(now))).toBe(false);
  await expect(
    new FullBackupActivities(root, () => randomBytes(32)).read("backup"),
  ).rejects.toThrow();
  await writeFile(join(root, ".full-rehearsal-activity"), bytes);
  await expect(store.read("rehearsal")).rejects.toThrow();
  await rm(join(root, ".full-backup-activity"));
  await symlink(join(root, ".full-rehearsal-activity"), join(root, ".full-backup-activity"));
  await expect(store.read("backup")).rejects.toThrow();
  await rm(join(root, ".full-backup-activity"));
  await writeFile(join(root, ".full-backup-activity"), Buffer.alloc(4097));
  await expect(store.read("backup")).rejects.toThrow("size");
});

it.each([
  null,
  { ...activity, startedAt: "not a date" },
  { ...activity, startedAt: "2026-02-30T04:00:00.000Z" },
  { ...activity, finishedAt: null },
  { ...activity, outcome: "running" },
  { ...activity, outcome: "unknown" },
  { ...activity, backupId: "../escape" },
])("refuses malformed authenticated activity %# instead of reporting protection", async (value) => {
  await encrypted(
    join(root, ".full-backup-activity"),
    value,
    "myownnotion.full-backup.activity.v1:backup",
  );
  await expect(new FullBackupActivities(root, () => key).read("backup")).rejects.toThrow("Invalid");
});

it("keeps valid receipts while reporting corrupt, renamed and symlinked catalogue entries", async () => {
  const store = new FullBackupReceipts(root, () => key);
  await store.put(receipt);
  const renamed = randomUUID();
  await writeFile(join(root, `${renamed}.receipt`), await readFile(join(root, `${id}.receipt`)));
  await symlink(join(root, `${id}.receipt`), join(root, `${randomUUID()}.receipt`));
  await mkdir(join(root, `${randomUUID()}.receipt`));
  await writeFile(join(root, `${randomUUID()}.receipt`), Buffer.alloc(16385));
  expect(await store.scan()).toEqual({ receipts: [receipt], invalidCount: 4 });
  await expect(store.remove("../escape")).rejects.toThrow("identity");
  await expect(
    new FullBackupReceipts(join(root, `${id}.receipt`), () => key).scan(),
  ).rejects.toThrow();
});

it.each([
  null,
  { ...receipt, formatVersion: 2 },
  { ...receipt, createdAt: "invalid" },
  { ...receipt, verifiedAt: "2026-02-30T00:00:00.000Z" },
  { ...receipt, sourceVersion: 42 },
  { ...receipt, reason: "partial" },
  { ...receipt, archiveBytes: -1 },
  { ...receipt, archiveSha256: "wrong" },
  { ...receipt, remote: "verified" },
  { ...receipt, remoteVerifiedAt: now },
])(
  "rejects malformed authenticated receipt %# while retaining the actual archive",
  async (value) => {
    const archivePath = join(root, `${id}.monfull`);
    await writeFile(archivePath, "untouched recovery artifact");
    await encrypted(join(root, `${id}.receipt`), value, "myownnotion.full-backup.receipt.v1");
    expect(await new FullBackupReceipts(root, () => key).scan()).toEqual({
      receipts: [],
      invalidCount: 1,
    });
    expect(await readFile(archivePath, "utf8")).toBe("untouched recovery artifact");
  },
);

it("refuses unauthenticated, malformed and oversized activation markers", async () => {
  const state = {
    formatVersion: 1 as const,
    backupId: id,
    stage: "data-restored" as const,
    databaseName: "fixture",
    databaseOid: 42,
    clusterId: "1234",
  };
  await writeFullRestoreState(root, state, key);
  expect(await readFullRestoreState(root, key)).toEqual(state);
  await expect(readFullRestoreState(root, randomBytes(32))).rejects.toThrow();
  await encrypted(
    join(root, ".full-restore-state"),
    { ...state, databaseOid: "42" },
    "myownnotion.full-backup.restore-state.v1",
  );
  await expect(readFullRestoreState(root, key)).rejects.toThrow("Invalid");
  await writeFile(join(root, ".full-restore-state"), Buffer.alloc(16385));
  await expect(readFullRestoreState(root, key)).rejects.toThrow("Invalid");
});

it("reports absent protection, interrupted attempts and expired rehearsal independently", async () => {
  const service = new FullBackupService({
    connectionString: "postgres://invalid@127.0.0.1:1/missing",
    backupRoot: root,
    blobRoot: join(root, "blobs"),
    key: () => key,
  });
  expect(await fullBackupStatus(service)).toMatchObject({
    stale: true,
    rehearsalDue: true,
    remote: null,
    lastVerifiedBackupId: null,
  });
  await service.activities.put("backup", { ...activity, outcome: "running", finishedAt: null });
  await service.activities.put("rehearsal", { ...activity, outcome: "failed" });
  expect(await fullBackupStatus(service, new Date(now))).toMatchObject({
    latestAttemptOutcome: "unfinished",
    lastRehearsalOutcome: "failed",
    rehearsalDue: true,
  });
  await service.activities.put("rehearsal", activity);
  expect((await fullBackupStatus(service, new Date("2026-10-07T04:00:00.000Z"))).rehearsalDue).toBe(
    true,
  );
  expect((await fullBackupStatus(service, new Date(now))).rehearsalDue).toBe(false);
});

it("refuses an unreadable restore-marker location instead of assuming activation", async () => {
  const file = join(root, "not-a-directory");
  await writeFile(file, "private fixture");
  await expect(assertFullRestoreActivated(file)).rejects.toMatchObject({ code: "ENOTDIR" });
});
