import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadBackupConfig } from "../src/backup/backup-config.ts";
import { FullBackupActivities } from "../src/backup/full/activity.ts";
import {
  historicalBackupKeyFiles,
  loadBackupReadKeys,
  loadHistoricalBackupKeys,
} from "../src/backup/full/read-keys.ts";
import { FullBackupReceipts } from "../src/backup/full/receipts.ts";
import { FullBackupService } from "../src/backup/full/service.ts";

let directory: string;
let keyFile: string;
const key = randomBytes(32);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mon-historical-key-config-"));
  keyFile = join(directory, "external-key");
  await writeFile(keyFile, key.toString("base64"), { mode: 0o600 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it.each([
  "null",
  "{}",
  "false",
  "[1]",
  '"key"',
  '["relative"]',
  '["/a", "/a"]',
  '["/a/../b", "/b"]',
  '["/bad\\u0000file"]',
  "[",
  JSON.stringify(Array.from({ length: 17 }, (_, i) => `/key-${i}`)),
  JSON.stringify([`/${"x".repeat(4096)}`]),
  " ".repeat(16_385),
])("refuses malformed or unbounded historical key configuration %#", (raw) => {
  expect(() => historicalBackupKeyFiles(raw)).toThrow("HISTORICAL_KEY_FILES");
});

it("loads only explicitly configured private files, returning owned buffers without persisting them", async () => {
  expect(historicalBackupKeyFiles(undefined)).toEqual([]);
  expect(historicalBackupKeyFiles(" ")).toEqual([]);
  const maximumPaths = Array.from({ length: 16 }, (_, index) => `/key-${index}`);
  expect(historicalBackupKeyFiles(JSON.stringify(maximumPaths).padEnd(16_384))).toEqual(
    maximumPaths,
  );
  expect(historicalBackupKeyFiles(JSON.stringify([`/${"x".repeat(4095)}`]))).toHaveLength(1);
  expect(
    loadBackupConfig({ MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES: JSON.stringify([keyFile]) })
      .historicalKeyFiles,
  ).toEqual([keyFile]);
  const current = randomBytes(32);
  const keys = loadBackupReadKeys(
    () => current,
    [keyFile],
    [join(directory, "not-yet-created", "backups")],
  );
  expect(keys).toEqual([current, key]);
  for (const owned of keys) owned.fill(0);
  expect(current.equals(Buffer.alloc(32))).toBe(false);
  expect(await readFile(keyFile, "utf8")).toBe(key.toString("base64"));
  await writeFile(keyFile, key.toString("base64").padEnd(4096));
  const maximumFile = loadHistoricalBackupKeys([keyFile], []);
  expect(maximumFile).toEqual([key]);
  maximumFile[0]?.fill(0);
  const failingCurrent = vi.fn(() => {
    throw new Error("Current key absent");
  });
  expect(() => loadBackupReadKeys(failingCurrent, [keyFile])).toThrow("Current key absent");
});

it("refuses keys inside data/backup roots, including symlinked parents and duplicate aliases", async () => {
  const alias = join(directory, "alias");
  await symlink(directory, alias);
  expect(() => loadHistoricalBackupKeys([keyFile], [alias])).toThrow("outside");
  expect(() =>
    loadBackupConfig({
      MYOWNNOTION_BACKUP_ROOT: alias,
      MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES: JSON.stringify([keyFile]),
    }),
  ).toThrow("outside");
  expect(() => loadHistoricalBackupKeys([keyFile], [keyFile])).toThrow("outside");
  const aliasKey = join(directory, "alias-key");
  await symlink(keyFile, aliasKey);
  expect(() => loadHistoricalBackupKeys([keyFile, aliasKey], [])).toThrow("distinct");
  expect(() => loadHistoricalBackupKeys([keyFile], [join(keyFile, "bad-root")])).toThrow();
});

it("refuses unreadable, malformed, absent, directory and permissive secrets before filtering catalogue entries", async () => {
  const current = vi.fn(() => key);
  const options = {
    connectionString: "postgres://unused",
    blobRoot: join(directory, "blobs"),
    backupRoot: join(directory, "backups"),
    key: current,
    historicalKeyFiles: [keyFile],
  };
  const service = new FullBackupService(options);
  await rm(keyFile);
  await expect(service.receipts.scan()).rejects.toThrow();
  await expect(service.activities.read("backup")).rejects.toThrow();
  await expect(service.run("manual")).rejects.toThrow();
  expect(current).not.toHaveBeenCalled();
  expect(() => new FullBackupService(options)).toThrow();
  await mkdir(keyFile);
  expect(() => new FullBackupService(options)).toThrow();
  await rm(keyFile, { recursive: true });
  await writeFile(keyFile, "malformed", { mode: 0o600 });
  expect(() => new FullBackupService(options)).toThrow();
  await writeFile(keyFile, "x".repeat(4097));
  expect(() => new FullBackupService(options)).toThrow("4096");
  await writeFile(keyFile, key.toString("base64"));
  await chmod(keyFile, 0o644);
  expect(() => new FullBackupService(options)).toThrow();
});

it("clears owned keys on empty/missing stores and on failed file reads", async () => {
  const owned: Buffer[][] = [];
  const readKeys = () => {
    const keys = [Buffer.from(key)];
    owned.push(keys);
    return keys;
  };
  const missing = join(directory, "missing");
  expect(await new FullBackupReceipts(missing, () => key, readKeys).scan()).toEqual({
    receipts: [],
    invalidCount: 0,
  });
  expect(await new FullBackupActivities(missing, () => key, readKeys).read("backup")).toBeNull();
  await expect(new FullBackupReceipts(keyFile, () => key, readKeys).scan()).rejects.toThrow();
  await symlink(keyFile, join(directory, ".full-backup-activity"));
  await expect(
    new FullBackupActivities(directory, () => key, readKeys).read("backup"),
  ).rejects.toThrow();
  expect(owned.flat().every((bytes) => bytes.equals(Buffer.alloc(32)))).toBe(true);
});
