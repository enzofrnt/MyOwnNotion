/**
 * What a manifest must say before anything is restored (T009, FR-002, FR-003).
 *
 * This module is the only thing a restoration can rely on before it has read a
 * byte of content, so every test here is a way a wrong manifest could become a
 * restoration that fails halfway — which is the state FR-017 spends its whole
 * effort making survivable.
 */

import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupCompatibility,
  compareArchiveContents,
  expectedFileBytes,
  readBackupManifest,
} from "../src/index.ts";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: "2026-08-18T04:00:00.000Z",
    cursor: "22055",
    applicationVersion: "0.1.0",
    schemaVersion: 1,
    recordFormatVersion: 1,
    canonicalExportDigest: DIGEST_A,
    files: [{ digest: DIGEST_B, byteLength: 12 }],
    itemCount: 3,
    fileCount: 1,
    ...overrides,
  };
}

describe("reading a manifest", () => {
  it("accepts a complete one", () => {
    const read = readBackupManifest(manifest());
    expect(read.ok).toBe(true);
  });

  it("refuses one whose file count disagrees with its file list", () => {
    // Caught by arithmetic rather than by a restoration discovering a missing
    // file later, which is the difference between a refusal and a half-restore.
    const read = readBackupManifest(manifest({ fileCount: 4 }));
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.map((problem) => problem.field)).toContain("fileCount");
    }
  });

  it("refuses a digest that is not a sha256", () => {
    const read = readBackupManifest(manifest({ files: [{ digest: "md5:x", byteLength: 1 }] }));
    expect(read.ok).toBe(false);
  });

  it("refuses the same file listed twice", () => {
    // Names are content addresses, so a repeat means the manifest disagrees
    // with itself about how large the archive is.
    const read = readBackupManifest(
      manifest({
        files: [
          { digest: DIGEST_B, byteLength: 12 },
          { digest: DIGEST_B, byteLength: 12 },
        ],
        fileCount: 2,
      }),
    );
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.some((problem) => problem.message.includes("twice"))).toBe(true);
    }
  });

  it("reports every problem at once rather than the first", () => {
    // An operator holding an archive that will not open needs the whole list.
    // Fixing one fault at a time, with a slow verification between each, is how
    // a recovery turns into an afternoon.
    const read = readBackupManifest({ format: "wrong", files: "not-an-array" });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems.length).toBeGreaterThan(2);
    }
  });

  it("refuses something that is not an object at all", () => {
    expect(readBackupManifest(null).ok).toBe(false);
    expect(readBackupManifest([]).ok).toBe(false);
    expect(readBackupManifest("{}").ok).toBe(false);
  });
});

describe("comparing an archive with its manifest", () => {
  it("names what is missing and what is unexpected", () => {
    const read = readBackupManifest(manifest());
    if (!read.ok) {
      throw new Error("expected a valid manifest");
    }
    const comparison = compareArchiveContents(read.manifest, [DIGEST_A]);
    // Named rather than reported as a mismatch: "the archive does not match its
    // manifest" is true and unusable.
    expect(comparison.missing).toEqual([DIGEST_B]);
    expect(comparison.unexpected).toEqual([DIGEST_A]);
  });

  it("is satisfied when the contents match exactly", () => {
    const read = readBackupManifest(manifest());
    if (!read.ok) {
      throw new Error("expected a valid manifest");
    }
    expect(compareArchiveContents(read.manifest, [DIGEST_B])).toEqual({
      missing: [],
      unexpected: [],
    });
    expect(expectedFileBytes(read.manifest)).toBe(12);
  });
});

describe("whether this installation can read that backup", () => {
  const installation = { schemaVersion: 3, recordFormatVersion: 2 };

  it("accepts a backup from an older data version", () => {
    // Older is fine: migrations run forward.
    expect(
      backupCompatibility(installation, {
        schemaVersion: 2,
        recordFormatVersion: 2,
        applicationVersion: "0.0.9",
      }),
    ).toEqual({ kind: "compatible" });
  });

  it("refuses a newer data version and names both", () => {
    const verdict = backupCompatibility(installation, {
      schemaVersion: 4,
      recordFormatVersion: 2,
      applicationVersion: "0.2.0",
    });
    expect(verdict.kind).toBe("refused");
    if (verdict.kind === "refused") {
      expect(verdict.reason).toContain("4");
      expect(verdict.reason).toContain("3");
      // The one thing an owner mid-recovery needs to hear.
      expect(verdict.reason).toMatch(/unchanged/i);
    }
  });

  it("refuses a newer record format in its own words", () => {
    // Distinct from a schema mismatch on purpose: this one would restore rows
    // this installation cannot decrypt — a workspace that looks restored and is
    // not.
    const verdict = backupCompatibility(installation, {
      schemaVersion: 3,
      recordFormatVersion: 3,
      applicationVersion: "0.2.0",
    });
    expect(verdict.kind).toBe("refused");
    if (verdict.kind === "refused") {
      expect(verdict.reason).toMatch(/cannot read/i);
    }
  });

  it("ignores the application version when deciding", () => {
    // It changes for reasons that have nothing to do with the data — a fixed
    // stylesheet, a new shortcut — and an owner who has just lost their server
    // is the last person who should be arguing with a version string.
    expect(
      backupCompatibility(installation, {
        schemaVersion: 3,
        recordFormatVersion: 2,
        applicationVersion: "99.0.0",
      }),
    ).toEqual({ kind: "compatible" });
  });
});
