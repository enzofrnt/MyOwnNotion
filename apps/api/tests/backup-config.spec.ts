import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackupConfigError,
  createBackupDestination,
  loadBackupConfig,
} from "../src/backup/backup-config.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backup configuration", () => {
  it("uses conservative local defaults", () => {
    expect(loadBackupConfig({})).toEqual({
      destination: "filesystem",
      root: "./.dev-backups",
      hour: 4,
      retentionDays: 90,
      timeZone: "UTC",
      googleDriveTokenFile: undefined,
      googleDriveFolderId: undefined,
    });
  });

  it("reads every supported setting and trims mounted-path values", () => {
    expect(
      loadBackupConfig({
        MYOWNNOTION_BACKUP_DESTINATION: " google-drive ",
        MYOWNNOTION_BACKUP_ROOT: " /backups ",
        MYOWNNOTION_BACKUP_HOUR: "23",
        MYOWNNOTION_BACKUP_RETENTION_DAYS: "36500",
        MYOWNNOTION_BACKUP_GOOGLE_DRIVE_TOKEN_FILE: " /run/secrets/drive ",
        MYOWNNOTION_BACKUP_GOOGLE_DRIVE_FOLDER_ID: " folder-id ",
        TZ: " Europe/Paris ",
      }),
    ).toEqual({
      destination: "google-drive",
      root: "/backups",
      hour: 23,
      retentionDays: 36_500,
      timeZone: "Europe/Paris",
      googleDriveTokenFile: "/run/secrets/drive",
      googleDriveFolderId: "folder-id",
    });
  });

  it.each([
    [{ MYOWNNOTION_BACKUP_DESTINATION: "s3" }, /filesystem or google-drive/],
    [{ MYOWNNOTION_BACKUP_HOUR: "24" }, /BACKUP_HOUR/],
    [{ MYOWNNOTION_BACKUP_HOUR: "1.5" }, /BACKUP_HOUR/],
    [{ MYOWNNOTION_BACKUP_RETENTION_DAYS: "0" }, /RETENTION_DAYS/],
  ])("refuses invalid settings", (env, message) => {
    expect(() => loadBackupConfig(env)).toThrow(message);
  });
});

describe("constructing a configured destination", () => {
  it("constructs the filesystem provider and refuses unknown overrides", () => {
    const config = loadBackupConfig({ MYOWNNOTION_BACKUP_ROOT: "/tmp/backup-contract" });
    expect(createBackupDestination(config).name).toBe("filesystem");
    expect(() => createBackupDestination(config, "s3")).toThrow(BackupConfigError);
  });

  it("requires both mounted Drive settings", () => {
    const config = loadBackupConfig({
      MYOWNNOTION_BACKUP_DESTINATION: "google-drive",
      MYOWNNOTION_BACKUP_GOOGLE_DRIVE_TOKEN_FILE: "/run/secrets/drive",
    });
    expect(() => createBackupDestination(config)).toThrow(/requires.*TOKEN_FILE.*FOLDER_ID/i);
  });

  it("reads a rotated Drive token for every provider request", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mon-backup-config-"));
    const tokenFile = path.join(directory, "drive-token");
    await writeFile(tokenFile, "first-token\n", { mode: 0o600 });
    const authorizations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        authorizations.push(String(new Headers(init?.headers).get("authorization")));
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }),
    );

    try {
      const destination = createBackupDestination(
        loadBackupConfig({
          MYOWNNOTION_BACKUP_DESTINATION: "google-drive",
          MYOWNNOTION_BACKUP_GOOGLE_DRIVE_TOKEN_FILE: tokenFile,
          MYOWNNOTION_BACKUP_GOOGLE_DRIVE_FOLDER_ID: "folder-id",
        }),
      );
      await destination.list();
      await writeFile(tokenFile, "second-token\n", { mode: 0o600 });
      await destination.list();
      expect(authorizations).toEqual(["Bearer first-token", "Bearer second-token"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
