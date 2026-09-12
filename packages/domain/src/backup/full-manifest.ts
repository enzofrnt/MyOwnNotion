/** The authenticated inventory of a complete server recovery artifact. */
import { isUuid } from "../ids/uuid.ts";

export const FULL_BACKUP_FORMAT = "myownnotion.full-backup";
export const FULL_BACKUP_FORMAT_VERSION = 1;
export const UNKNOWN_SOURCE_VERSION = "V0 — version exacte inconnue";

export interface FullBackupSource {
  readonly installationId: string | null;
  readonly applicationVersion: string | null;
  readonly commit: string | null;
  readonly image: string | null;
  readonly postgresVersion: number;
  readonly appliedMigrations: readonly string[];
}

export interface FullBackupComponent {
  readonly kind: "database" | "blob" | "upload";
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface FullBackupManifest {
  readonly format: typeof FULL_BACKUP_FORMAT;
  readonly formatVersion: typeof FULL_BACKUP_FORMAT_VERSION;
  readonly backupId: string;
  readonly createdAt: string;
  readonly reason: "manual" | "scheduled" | "pre-update";
  readonly source: FullBackupSource;
  readonly components: readonly FullBackupComponent[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  );
}
function nullableText(value: unknown): boolean {
  return value === null || text(value);
}

export function sourceVersionLabel(source: FullBackupSource): string {
  return source.applicationVersion ?? UNKNOWN_SOURCE_VERSION;
}

/**
 * V0 predates the installation-version column itself. A missing version alone
 * is not proof: a later, damaged installation may also lack that value.
 */
export function isV0FullBackupSource(source: FullBackupSource): boolean {
  return (
    source.applicationVersion === null &&
    !source.appliedMigrations.includes("0006_installation_application_version")
  );
}

/** Only durable blob-store paths belong in this version of the archive. */
export function validFullComponentPath(kind: FullBackupComponent["kind"], value: string): boolean {
  if (kind === "database") return value === "database.dump";
  if (kind === "upload") return value.startsWith("uploads/") && isUuid(value.slice(8));
  const match = /^([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(value);
  return match !== null && match[2]?.startsWith(match[1] ?? "") === true;
}

/** Reject unknown formats and an incomplete/ambiguous inventory before IO. */
export function readFullBackupManifest(value: unknown): FullBackupManifest {
  if (
    !record(value) ||
    value["format"] !== FULL_BACKUP_FORMAT ||
    value["formatVersion"] !== 1 ||
    !isUuid(value["backupId"]) ||
    typeof value["createdAt"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value["createdAt"]) ||
    !Number.isFinite(Date.parse(value["createdAt"])) ||
    new Date(value["createdAt"]).toISOString() !== value["createdAt"] ||
    !["manual", "scheduled", "pre-update"].includes(String(value["reason"]))
  ) {
    throw new TypeError("Invalid or unsupported complete-backup manifest.");
  }
  const source = value["source"];
  if (
    !record(source) ||
    !(source["installationId"] === null || isUuid(source["installationId"])) ||
    !nullableText(source["applicationVersion"]) ||
    !nullableText(source["image"]) ||
    !(
      source["commit"] === null ||
      (typeof source["commit"] === "string" && /^[0-9a-f]{40,64}$/.test(source["commit"]))
    ) ||
    !Number.isSafeInteger(source["postgresVersion"]) ||
    Number(source["postgresVersion"]) < 180000 ||
    Number(source["postgresVersion"]) >= 190000 ||
    !Array.isArray(source["appliedMigrations"]) ||
    !source["appliedMigrations"].every(
      (migration: unknown) => typeof migration === "string" && /^[0-9a-z_-]+$/.test(migration),
    ) ||
    new Set(source["appliedMigrations"]).size !== source["appliedMigrations"].length
  ) {
    throw new TypeError("Invalid complete-backup source provenance.");
  }
  const components = value["components"];
  if (!Array.isArray(components) || components.length === 0) {
    throw new TypeError("The complete backup has no database component.");
  }
  const paths = new Set<string>();
  let databaseCount = 0;
  let total = 0;
  for (const component of components) {
    if (
      !record(component) ||
      !["database", "blob", "upload"].includes(String(component["kind"])) ||
      typeof component["path"] !== "string" ||
      !validFullComponentPath(
        component["kind"] as FullBackupComponent["kind"],
        component["path"],
      ) ||
      !Number.isSafeInteger(component["byteLength"]) ||
      Number(component["byteLength"]) < 0 ||
      typeof component["sha256"] !== "string" ||
      !/^[0-9a-f]{64}$/.test(component["sha256"]) ||
      paths.has(component["path"])
    ) {
      throw new TypeError("Invalid or duplicate complete-backup component.");
    }
    if (component["kind"] === "database") {
      databaseCount += 1;
      if (component["byteLength"] === 0) throw new TypeError("The database dump is empty.");
    }
    paths.add(component["path"]);
    total += Number(component["byteLength"]) + 28;
    if (!Number.isSafeInteger(total))
      throw new TypeError("The archive size exceeds safe addressing.");
  }
  if (databaseCount !== 1 || (components[0] as Record<string, unknown>)["kind"] !== "database") {
    throw new TypeError("The complete backup must begin with exactly one database dump.");
  }
  return value as unknown as FullBackupManifest;
}
