import { describe, expect, it } from "vitest";
import {
  type BackupManifest,
  canonicalizeBackupManifest,
  hashBackupManifest,
  parseBackupManifest,
  serializeBackupManifest,
  validateBackupCompatibility,
} from "../src/manifest.ts";

const FIRST_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd7";
const SECOND_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd9";

function validManifest(): BackupManifest {
  return {
    manifestVersion: 1,
    product: "myownnotion",
    createdAt: "2026-08-08T00:00:00.000Z",
    sourceRevision: "a".repeat(40),
    databaseSchemaVersions: ["0002_content_types", "0001_content_foundations"],
    toolVersions: { node: "24.14.0", postgres: "18.4", restic: "0.18.1", rclone: "1.72.1" },
    database: {
      path: "database/myownnotion.dump",
      format: "postgresql-custom",
      byteLength: 42,
      sha256: "d".repeat(64),
    },
    objects: [
      {
        contentId: SECOND_ID,
        storageKey: "private/z",
        path: `objects/aa/${SECOND_ID}`,
        byteLength: 9,
        sha256: "b".repeat(64),
      },
      {
        contentId: FIRST_ID,
        storageKey: "private/a",
        path: `objects/bb/${FIRST_ID}`,
        byteLength: 7,
        sha256: "a".repeat(64),
      },
    ],
    counts: {
      workspaces: 1,
      items: 3,
      placements: 3,
      revisions: 3,
      relationships: 1,
      pageDocuments: 1,
      logicalFiles: 2,
      contentObjects: 2,
    },
    status: "complete",
  };
}

describe("backup manifest v1", () => {
  it("round-trips one exact closed manifest and produces a stable digest", () => {
    const source = validManifest();
    const serialized = serializeBackupManifest(source);
    const parsed = parseBackupManifest(serialized);
    expect(parsed).toEqual(canonicalizeBackupManifest(source));
    expect(serializeBackupManifest(parsed)).toBe(serialized);
    expect(hashBackupManifest(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashBackupManifest({ ...source, objects: [...source.objects].reverse() })).toBe(
      hashBackupManifest(source),
    );
  });

  it("sorts schema and object inventory while preserving exact counts and digests", () => {
    const parsed = parseBackupManifest(serializeBackupManifest(validManifest()));
    expect(parsed.databaseSchemaVersions).toEqual([
      "0001_content_foundations",
      "0002_content_types",
    ]);
    expect(parsed.objects.map((object) => object.contentId)).toEqual([FIRST_ID, SECOND_ID]);
    expect(parsed.counts.contentObjects).toBe(parsed.objects.length);
    expect(parsed.database.sha256).toBe("d".repeat(64));
  });

  it.each([
    ["private root field", { ...validManifest(), password: "secret" }],
    [
      "private object field",
      {
        ...validManifest(),
        objects: [
          { ...validManifest().objects[0], filename: "private.txt" },
          validManifest().objects[1],
        ],
      },
    ],
    [
      "wrong object count",
      {
        ...validManifest(),
        counts: { ...validManifest().counts, contentObjects: 1 },
      },
    ],
    [
      "duplicate object identity",
      {
        ...validManifest(),
        objects: [validManifest().objects[0], validManifest().objects[0]],
      },
    ],
    [
      "unsafe object path",
      {
        ...validManifest(),
        objects: [
          { ...validManifest().objects[0], path: "../private" },
          validManifest().objects[1],
        ],
      },
    ],
    [
      "invalid digest",
      {
        ...validManifest(),
        database: { ...validManifest().database, sha256: "not-a-digest" },
      },
    ],
    ["unsupported status", { ...validManifest(), status: "recoverable" }],
  ])("rejects %s", (_label, candidate) => {
    expect(() => parseBackupManifest(JSON.stringify(candidate))).toThrow();
  });

  it("reports compatibility without exposing manifest contents", () => {
    const manifest = validManifest();
    expect(
      validateBackupCompatibility(manifest, {
        databaseSchemaVersions: ["0001_content_foundations", "0002_content_types"],
        postgresMajor: 18,
      }),
    ).toEqual({ compatible: true, failureCode: null });
    expect(
      validateBackupCompatibility(manifest, {
        databaseSchemaVersions: ["0001_content_foundations"],
        postgresMajor: 18,
      }),
    ).toEqual({ compatible: false, failureCode: "backup.schema-incompatible" });
    expect(
      validateBackupCompatibility(manifest, {
        databaseSchemaVersions: ["0001_content_foundations", "0002_content_types"],
        postgresMajor: 17,
      }),
    ).toEqual({ compatible: false, failureCode: "backup.postgres-incompatible" });
  });
});
