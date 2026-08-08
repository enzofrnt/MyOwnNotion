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

/** Produces the one canonical property and inventory order used for hashing. */
export function canonicalizeBackupManifest(manifest: BackupManifest): BackupManifest {
  return {
    manifestVersion: 1,
    product: "myownnotion",
    createdAt: manifest.createdAt,
    sourceRevision: manifest.sourceRevision,
    databaseSchemaVersions: [...manifest.databaseSchemaVersions].sort(),
    toolVersions: {
      node: manifest.toolVersions.node,
      postgres: manifest.toolVersions.postgres,
      restic: manifest.toolVersions.restic,
      rclone: manifest.toolVersions.rclone,
    },
    database: {
      path: "database/myownnotion.dump",
      format: "postgresql-custom",
      byteLength: manifest.database.byteLength,
      sha256: manifest.database.sha256,
    },
    objects: [...manifest.objects]
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
      workspaces: manifest.counts.workspaces,
      items: manifest.counts.items,
      placements: manifest.counts.placements,
      revisions: manifest.counts.revisions,
      relationships: manifest.counts.relationships,
      pageDocuments: manifest.counts.pageDocuments,
      logicalFiles: manifest.counts.logicalFiles,
      contentObjects: manifest.counts.contentObjects,
    },
    status: manifest.status,
  };
}

export function serializeBackupManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(canonicalizeBackupManifest(manifest), null, 2)}\n`;
}
