/** Environment-backed backup configuration shared by the API and host CLI. */

import { readFile } from "node:fs/promises";
import type { BackupDestination } from "./destinations/destination.ts";
import { FilesystemDestination } from "./destinations/filesystem.ts";
import { GoogleDriveDestination } from "./destinations/google-drive.ts";

export type BackupDestinationName = "filesystem" | "google-drive";

export interface BackupConfig {
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
  return {
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
    timeZone: env["TZ"]?.trim() || "UTC",
    googleDriveTokenFile: env["MYOWNNOTION_BACKUP_GOOGLE_DRIVE_TOKEN_FILE"]?.trim() || undefined,
    googleDriveFolderId: env["MYOWNNOTION_BACKUP_GOOGLE_DRIVE_FOLDER_ID"]?.trim() || undefined,
  };
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
