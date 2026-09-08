/** Environment-backed backup configuration shared by the API and host CLI. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackupDestination } from "./destinations/destination.ts";
import { FilesystemDestination } from "./destinations/filesystem.ts";
import { GoogleDriveDestination } from "./destinations/google-drive.ts";
import { historicalBackupKeyFiles, loadHistoricalBackupKeys } from "./full/read-keys.ts";

export type BackupDestinationName = "filesystem" | "google-drive";

export interface BackupConfig {
  readonly historicalKeyFiles: readonly string[];
  readonly destination: BackupDestinationName;
  readonly root: string;
  readonly hour: number;
  readonly retentionDays: number;
  readonly timeZone: string;
  readonly googleDriveTokenFile: string | undefined;
  readonly googleDriveFolderId: string | undefined;
}

export class BackupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupConfigError";
  }
}

function integer(
  raw: string | undefined,
  fallback: number,
  name: string,
  bounds: { readonly min: number; readonly max: number },
): number {
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new BackupConfigError(`${name} must be between ${bounds.min} and ${bounds.max}`);
  }
  return value;
}

export function loadBackupConfig(
  env: Record<string, string | undefined> = process.env,
): BackupConfig {
  const requested = env["MYOWNNOTION_BACKUP_DESTINATION"]?.trim() || "filesystem";
  if (requested !== "filesystem" && requested !== "google-drive") {
    throw new BackupConfigError(
      "MYOWNNOTION_BACKUP_DESTINATION must be filesystem or google-drive",
    );
  }
  const timeZone = env["MYOWNNOTION_BACKUP_TIME_ZONE"]?.trim() || env["TZ"]?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
  } catch {
    throw new BackupConfigError("MYOWNNOTION_BACKUP_TIME_ZONE must be a valid IANA time zone");
  }
  const config: BackupConfig = {
    historicalKeyFiles: historicalBackupKeyFiles(env["MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES"]),
    destination: requested,
    root: env["MYOWNNOTION_BACKUP_ROOT"]?.trim() || "./.dev-backups",
    hour: integer(env["MYOWNNOTION_BACKUP_HOUR"], 4, "MYOWNNOTION_BACKUP_HOUR", {
      min: 0,
      max: 23,
    }),
    retentionDays: integer(
      env["MYOWNNOTION_BACKUP_RETENTION_DAYS"],
      90,
      "MYOWNNOTION_BACKUP_RETENTION_DAYS",
      { min: 1, max: 36_500 },
    ),
    timeZone,
    googleDriveTokenFile: env["MYOWNNOTION_BACKUP_GOOGLE_DRIVE_TOKEN_FILE"]?.trim() || undefined,
    googleDriveFolderId: env["MYOWNNOTION_BACKUP_GOOGLE_DRIVE_FOLDER_ID"]?.trim() || undefined,
  };
  const keys = loadHistoricalBackupKeys(config.historicalKeyFiles, [
    config.root,
    env["MYOWNNOTION_BLOB_ROOT"]?.trim() || "./.dev-blobs",
  ]);
  for (const key of keys) key.fill(0);
  return config;
}

/** Constructs only the configured provider; credentials remain mounted files. */
export function createBackupDestination(
  config: BackupConfig,
  requested: string | undefined = config.destination,
): BackupDestination {
  if (requested === "filesystem") {
    return new FilesystemDestination(config.root);
  }
  if (requested !== "google-drive") {
    throw new BackupConfigError(`unknown backup destination: ${requested}`);
  }
  const tokenFile = config.googleDriveTokenFile;
  const folderId = config.googleDriveFolderId;
  if (tokenFile === undefined || folderId === undefined) {
    throw new BackupConfigError(
      "Google Drive requires MYOWNNOTION_BACKUP_GOOGLE_DRIVE_TOKEN_FILE and MYOWNNOTION_BACKUP_GOOGLE_DRIVE_FOLDER_ID",
    );
  }
  return new GoogleDriveDestination({
    folderId,
    // Read for every request so rotating the mounted token does not require a
    // restart and the credential is never retained in application state.
    accessToken: async () => await readFile(tokenFile, "utf8"),
  });
}

/** Complete archives are separate from the portable export destination. */
export function fullBackupRoot(config: Pick<BackupConfig, "root">): string {
  return join(config.root, "full");
}
