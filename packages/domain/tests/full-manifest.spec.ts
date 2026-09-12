import { describe, expect, it } from "vitest";
import {
  FULL_BACKUP_FORMAT,
  type FullBackupManifest,
  readFullBackupManifest,
  sourceVersionLabel,
  UNKNOWN_SOURCE_VERSION,
} from "../src/backup/full-manifest.ts";

function manifest(): FullBackupManifest {
  return {
    format: FULL_BACKUP_FORMAT,
    formatVersion: 1,
    backupId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-05T02:00:00.000Z",
    reason: "manual",
    source: {
      installationId: null,
      applicationVersion: null,
      commit: null,
      image: null,
      postgresVersion: 180004,
      appliedMigrations: ["0001_initial"],
    },
    components: [
      { kind: "database", path: "database.dump", byteLength: 20, sha256: "a".repeat(64) },
    ],
  };
}
describe("complete-backup inventory", () => {
  it("preserves unknown source provenance without inventing the target version", () => {
    const parsed = readFullBackupManifest(manifest());
    expect(parsed.source.applicationVersion).toBeNull();
    expect(sourceVersionLabel(parsed.source)).toBe(UNKNOWN_SOURCE_VERSION);
  });
  it.each([
    "../secret",
    "/absolute",
    "uploads/../../secret",
    "uploads\\escape",
    `00/${"a".repeat(64)}`,
  ])("refuses a file path that cannot belong to the durable store: %s", (filePath) => {
    const value = manifest();
    expect(() =>
      readFullBackupManifest({
        ...value,
        components: [
          ...value.components,
          { kind: "blob", path: filePath, byteLength: 1, sha256: "b".repeat(64) },
        ],
      }),
    ).toThrow();
  });
  it("refuses duplicates, missing dumps, unsupported formats and overflowing sizes", () => {
    const value = manifest();
    for (const altered of [
      { ...value, components: [] },
      { ...value, components: [...value.components, ...value.components] },
      { ...value, formatVersion: 2 },
      { ...value, components: [{ ...value.components[0], byteLength: Number.MAX_SAFE_INTEGER }] },
    ])
      expect(() => readFullBackupManifest(altered)).toThrow();
  });
  it("requires the database dump before any file components", () => {
    const value = manifest();
    const upload = {
      kind: "upload",
      path: "uploads/22222222-2222-4222-8222-222222222222",
      byteLength: 0,
      sha256: "d".repeat(64),
    };
    for (const components of [[upload], [upload, ...value.components]]) {
      expect(() => readFullBackupManifest({ ...value, components })).toThrow(
        "begin with exactly one database dump",
      );
    }
  });
  it("accepts an immutable blob and a committed upload prefix", () => {
    const value = manifest();
    expect(
      readFullBackupManifest({
        ...value,
        components: [
          ...value.components,
          { kind: "blob", path: `ab/${"ab".repeat(32)}`, byteLength: 10, sha256: "c".repeat(64) },
          {
            kind: "upload",
            path: "uploads/22222222-2222-4222-8222-222222222222",
            byteLength: 0,
            sha256: "d".repeat(64),
          },
        ],
      }).components,
    ).toHaveLength(3);
  });

  it.each([
    { postgresVersion: 170006 },
    { postgresVersion: 190000 },
    { postgresVersion: 180000.5 },
    { installationId: "unknown-id" },
    { applicationVersion: "" },
    { applicationVersion: "version\nwith private output" },
    { image: 42 },
    { commit: "unverified" },
    { appliedMigrations: ["../../outside"] },
    { appliedMigrations: ["0001_initial", "0001_initial"] },
  ])("refuses incompatible or ambiguous provenance before restore IO: %j", (source) => {
    const original = manifest();
    expect(() =>
      readFullBackupManifest({ ...original, source: { ...original.source, ...source } }),
    ).toThrow("provenance");
  });

  it("refuses invalid dates and malformed component metadata while preserving valid source labels", () => {
    const value = manifest();
    for (const createdAt of ["2026-02-30T00:00:00.000Z", "not a date", "2026-09-05"])
      expect(() => readFullBackupManifest({ ...value, createdAt })).toThrow();
    for (const change of [
      { byteLength: 0 },
      { byteLength: -1 },
      { sha256: "not a digest" },
      { kind: "unknown" },
    ])
      expect(() =>
        readFullBackupManifest({ ...value, components: [{ ...value.components[0], ...change }] }),
      ).toThrow();
    expect(sourceVersionLabel({ ...value.source, applicationVersion: "0.2.0" })).toBe("0.2.0");
  });
});
