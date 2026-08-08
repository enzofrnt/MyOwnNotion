export interface BackupObjectRecord {
  readonly contentId: string;
  readonly storageKey: string;
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly manifestVersion: 1;
  readonly product: "myownnotion";
  readonly createdAt: string;
  readonly sourceRevision: string;
  readonly databaseSchemaVersions: readonly string[];
  readonly toolVersions: {
    readonly node: string;
    readonly postgres: string;
    readonly restic: string;
    readonly rclone: string;
  };
  readonly database: {
    readonly path: "database/myownnotion.dump";
    readonly format: "postgresql-custom";
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly objects: readonly BackupObjectRecord[];
  readonly counts: {
    readonly workspaces: number;
    readonly items: number;
    readonly placements: number;
    readonly revisions: number;
    readonly relationships: number;
    readonly pageDocuments: number;
    readonly logicalFiles: number;
    readonly contentObjects: number;
  };
  readonly status: "staged" | "complete";
}

export interface BackupCompatibilityTarget {
  readonly databaseSchemaVersions: readonly string[];
  readonly postgresMajor: number;
}

export type BackupCompatibilityResult =
  | { readonly compatible: true; readonly failureCode: null }
  | {
      readonly compatible: false;
      readonly failureCode: "backup.schema-incompatible" | "backup.postgres-incompatible";
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SCHEMA_VERSION_PATTERN = /^[0-9]{4}_[a-z0-9_]+$/;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{7,64}$/;
const OBJECT_PATH_PATTERN = /^objects\/[a-f0-9]{2}\/[a-f0-9-]{36,64}$/;
const MAX_OBJECT_COUNT = 1_000_000;
const MAX_OBJECT_BYTE_LENGTH = 256 * 1024 * 1024;
const MAX_SERIALIZED_BYTE_LENGTH = 512 * 1024 * 1024;

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields are invalid`);
  }
  return record;
}

function nonNegativeCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateBackupObject(value: unknown): BackupObjectRecord {
  const record = exactRecord(
    value,
    ["contentId", "storageKey", "path", "byteLength", "sha256"],
    "backup object",
  );
  const contentId = boundedString(record["contentId"], "content identity", 36);
  const storageKey = boundedString(record["storageKey"], "storage key", 1024);
  const objectPath = boundedString(record["path"], "object path", 1100);
  const sha256 = boundedString(record["sha256"], "object digest", 64);
  const byteLength = nonNegativeCount(record["byteLength"], "object byte length");
  if (
    !UUID_PATTERN.test(contentId) ||
    storageKey.includes("\0") ||
    !OBJECT_PATH_PATTERN.test(objectPath) ||
    !SHA256_PATTERN.test(sha256) ||
    byteLength > MAX_OBJECT_BYTE_LENGTH
  ) {
    throw new TypeError("backup object is invalid");
  }
  return { contentId, storageKey, path: objectPath, byteLength, sha256 };
}

export function validateBackupManifest(value: unknown): BackupManifest {
  const record = exactRecord(
    value,
    [
      "manifestVersion",
      "product",
      "createdAt",
      "sourceRevision",
      "databaseSchemaVersions",
      "toolVersions",
      "database",
      "objects",
      "counts",
      "status",
    ],
    "backup manifest",
  );
  if (record["manifestVersion"] !== 1 || record["product"] !== "myownnotion") {
    throw new TypeError("backup manifest identity is invalid");
  }
  const createdAt = boundedString(record["createdAt"], "backup timestamp", 64);
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
    throw new TypeError("backup timestamp is invalid");
  }
  const sourceRevision = boundedString(record["sourceRevision"], "source revision", 64);
  if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    throw new TypeError("source revision is invalid");
  }
  if (
    !Array.isArray(record["databaseSchemaVersions"]) ||
    record["databaseSchemaVersions"].length === 0
  ) {
    throw new TypeError("database schema versions are invalid");
  }
  const databaseSchemaVersions = record["databaseSchemaVersions"].map((version) => {
    const parsed = boundedString(version, "database schema version", 128);
    if (!SCHEMA_VERSION_PATTERN.test(parsed)) {
      throw new TypeError("database schema version is invalid");
    }
    return parsed;
  });
  if (new Set(databaseSchemaVersions).size !== databaseSchemaVersions.length) {
    throw new TypeError("database schema versions must be unique");
  }

  const tools = exactRecord(
    record["toolVersions"],
    ["node", "postgres", "restic", "rclone"],
    "tool versions",
  );
  const toolVersions = {
    node: boundedString(tools["node"], "node version", 64),
    postgres: boundedString(tools["postgres"], "postgres version", 64),
    restic: boundedString(tools["restic"], "restic version", 64),
    rclone: boundedString(tools["rclone"], "rclone version", 64),
  };

  const databaseRecord = exactRecord(
    record["database"],
    ["path", "format", "byteLength", "sha256"],
    "database snapshot",
  );
  const databaseByteLength = nonNegativeCount(databaseRecord["byteLength"], "database byte length");
  const databaseSha256 = boundedString(databaseRecord["sha256"], "database digest", 64);
  if (
    databaseRecord["path"] !== "database/myownnotion.dump" ||
    databaseRecord["format"] !== "postgresql-custom" ||
    databaseByteLength < 1 ||
    !SHA256_PATTERN.test(databaseSha256)
  ) {
    throw new TypeError("database snapshot is invalid");
  }

  if (!Array.isArray(record["objects"]) || record["objects"].length > MAX_OBJECT_COUNT) {
    throw new TypeError("backup object inventory is invalid");
  }
  const objects = record["objects"].map(validateBackupObject);
  const uniqueContentIds = new Set(objects.map((object) => object.contentId));
  const uniqueStorageKeys = new Set(objects.map((object) => object.storageKey));
  const uniquePaths = new Set(objects.map((object) => object.path));
  if (
    uniqueContentIds.size !== objects.length ||
    uniqueStorageKeys.size !== objects.length ||
    uniquePaths.size !== objects.length
  ) {
    throw new TypeError("backup objects must be unique");
  }

  const countRecord = exactRecord(
    record["counts"],
    [
      "workspaces",
      "items",
      "placements",
      "revisions",
      "relationships",
      "pageDocuments",
      "logicalFiles",
      "contentObjects",
    ],
    "backup counts",
  );
  const counts = {
    workspaces: nonNegativeCount(countRecord["workspaces"], "workspace count"),
    items: nonNegativeCount(countRecord["items"], "item count"),
    placements: nonNegativeCount(countRecord["placements"], "placement count"),
    revisions: nonNegativeCount(countRecord["revisions"], "revision count"),
    relationships: nonNegativeCount(countRecord["relationships"], "relationship count"),
    pageDocuments: nonNegativeCount(countRecord["pageDocuments"], "page document count"),
    logicalFiles: nonNegativeCount(countRecord["logicalFiles"], "logical file count"),
    contentObjects: nonNegativeCount(countRecord["contentObjects"], "content object count"),
  };
  if (counts.contentObjects !== objects.length) {
    throw new TypeError("content object count does not match inventory");
  }
  if (record["status"] !== "staged" && record["status"] !== "complete") {
    throw new TypeError("backup manifest status is invalid");
  }

  return {
    manifestVersion: 1,
    product: "myownnotion",
    createdAt,
    sourceRevision,
    databaseSchemaVersions,
    toolVersions,
    database: {
      path: "database/myownnotion.dump",
      format: "postgresql-custom",
      byteLength: databaseByteLength,
      sha256: databaseSha256,
    },
    objects,
    counts,
    status: record["status"],
  };
}

/** Produces the one canonical property and inventory order used for hashing. */
export function canonicalizeBackupManifest(manifest: BackupManifest): BackupManifest {
  const validated = validateBackupManifest(manifest);
  return {
    manifestVersion: 1,
    product: "myownnotion",
    createdAt: validated.createdAt,
    sourceRevision: validated.sourceRevision,
    databaseSchemaVersions: [...validated.databaseSchemaVersions].sort(),
    toolVersions: {
      node: validated.toolVersions.node,
      postgres: validated.toolVersions.postgres,
      restic: validated.toolVersions.restic,
      rclone: validated.toolVersions.rclone,
    },
    database: {
      path: "database/myownnotion.dump",
      format: "postgresql-custom",
      byteLength: validated.database.byteLength,
      sha256: validated.database.sha256,
    },
    objects: [...validated.objects]
      .sort((left, right) =>
        left.contentId === right.contentId
          ? left.storageKey.localeCompare(right.storageKey)
          : left.contentId.localeCompare(right.contentId),
      )
      .map((object) => ({
        contentId: object.contentId,
        storageKey: object.storageKey,
        path: object.path,
        byteLength: object.byteLength,
        sha256: object.sha256,
      })),
    counts: {
      workspaces: validated.counts.workspaces,
      items: validated.counts.items,
      placements: validated.counts.placements,
      revisions: validated.counts.revisions,
      relationships: validated.counts.relationships,
      pageDocuments: validated.counts.pageDocuments,
      logicalFiles: validated.counts.logicalFiles,
      contentObjects: validated.counts.contentObjects,
    },
    status: validated.status,
  };
}

export function serializeBackupManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(canonicalizeBackupManifest(manifest), null, 2)}\n`;
}

export function parseBackupManifest(serialized: string): BackupManifest {
  if (Buffer.byteLength(serialized) > MAX_SERIALIZED_BYTE_LENGTH) {
    throw new RangeError("backup manifest is too large");
  }
  return canonicalizeBackupManifest(validateBackupManifest(JSON.parse(serialized) as unknown));
}

export function hashBackupManifest(manifest: BackupManifest): string {
  return createHash("sha256").update(serializeBackupManifest(manifest)).digest("hex");
}

export function validateBackupCompatibility(
  manifest: BackupManifest,
  target: BackupCompatibilityTarget,
): BackupCompatibilityResult {
  const validated = validateBackupManifest(manifest);
  const targetVersions = new Set(target.databaseSchemaVersions);
  if (validated.databaseSchemaVersions.some((version) => !targetVersions.has(version))) {
    return { compatible: false, failureCode: "backup.schema-incompatible" };
  }
  const sourcePostgresMajor = Number.parseInt(
    validated.toolVersions.postgres.match(/^\d+/)?.[0] ?? "",
    10,
  );
  if (
    !Number.isSafeInteger(target.postgresMajor) ||
    target.postgresMajor < 1 ||
    sourcePostgresMajor !== target.postgresMajor
  ) {
    return { compatible: false, failureCode: "backup.postgres-incompatible" };
  }
  return { compatible: true, failureCode: null };
}

import { createHash } from "node:crypto";
