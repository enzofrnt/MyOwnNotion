/**
 * What a backup archive claims about itself (T005, FR-002, FR-003).
 *
 * Pure and total, because this is the only thing a restoration can rely on
 * before it has read a single byte of content. A manifest that is wrong in a way
 * this module accepts becomes a restoration that fails halfway, and a
 * restoration that fails halfway is the state FR-017 spends its effort making
 * survivable.
 *
 * **The manifest carries digests, never content.** It is the first thing anybody
 * inspects — an operator listing backups, a support transcript, a bug report —
 * so a manifest quoting a page title would leak the workspace into every one of
 * those places. What it may contain is arithmetic: sizes, counts, hashes, and
 * the versions needed to read the archive without this application.
 */

export const BACKUP_FORMAT = "myownnotion.backup";
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFileEntry {
  /** `sha256:<hex>`, which is also the file's name inside the archive. */
  readonly digest: string;
  readonly byteLength: number;
}

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT;
  readonly formatVersion: number;
  readonly createdAt: string;
  /** The change-feed position this archive represents. */
  readonly cursor: string;
  readonly applicationVersion: string;
  readonly schemaVersion: number;
  readonly recordFormatVersion: number;
  /** Of `canonical-export.json`, so the export can be checked on its own. */
  readonly canonicalExportDigest: string;
  readonly files: readonly BackupFileEntry[];
  readonly itemCount: number;
  readonly fileCount: number;
}

export interface ManifestProblem {
  readonly field: string;
  readonly message: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads an untrusted manifest, or says everything wrong with it.
 *
 * Every problem is collected rather than the first one returned. An operator
 * holding an archive that will not open needs the whole list: fixing one fault
 * at a time, with a slow verification between each, is how a recovery turns into
 * an afternoon.
 */
export function readBackupManifest(
  value: unknown,
): { ok: true; manifest: BackupManifest } | { ok: false; problems: ManifestProblem[] } {
  const problems: ManifestProblem[] = [];
  if (!isRecord(value)) {
    return { ok: false, problems: [{ field: "manifest", message: "is not an object" }] };
  }

  if (value["format"] !== BACKUP_FORMAT) {
    problems.push({ field: "format", message: `must be ${BACKUP_FORMAT}` });
  }
  const formatVersion = value["formatVersion"];
  if (typeof formatVersion !== "number" || !Number.isSafeInteger(formatVersion)) {
    problems.push({ field: "formatVersion", message: "must be an integer" });
  }

  for (const field of ["createdAt", "cursor", "applicationVersion"] as const) {
    if (typeof value[field] !== "string" || value[field] === "") {
      problems.push({ field, message: "must be a non-empty string" });
    }
  }
  for (const field of ["schemaVersion", "recordFormatVersion", "itemCount", "fileCount"] as const) {
    const candidate = value[field];
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0) {
      problems.push({ field, message: "must be a non-negative integer" });
    }
  }
  if (
    typeof value["canonicalExportDigest"] !== "string" ||
    !DIGEST.test(value["canonicalExportDigest"])
  ) {
    problems.push({ field: "canonicalExportDigest", message: "must be a sha256 digest" });
  }

  const files = value["files"];
  if (!Array.isArray(files)) {
    problems.push({ field: "files", message: "must be an array" });
  } else {
    const seen = new Set<string>();
    files.forEach((entry, index) => {
      if (!isRecord(entry)) {
        problems.push({ field: `files[${index}]`, message: "is not an object" });
        return;
      }
      const digest = entry["digest"];
      if (typeof digest !== "string" || !DIGEST.test(digest)) {
        problems.push({ field: `files[${index}].digest`, message: "must be a sha256 digest" });
      } else if (seen.has(digest)) {
        // Content-addressed names cannot repeat: two entries for one name mean
        // the manifest disagrees with itself about how large the archive is.
        problems.push({ field: `files[${index}].digest`, message: "is listed twice" });
      } else {
        seen.add(digest);
      }
      const byteLength = entry["byteLength"];
      if (typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 0) {
        problems.push({
          field: `files[${index}].byteLength`,
          message: "must be a non-negative integer",
        });
      }
    });
    if (typeof value["fileCount"] === "number" && value["fileCount"] !== files.length) {
      // The count exists so a truncated `files` array is caught by arithmetic
      // rather than by a restoration discovering a missing file later.
      problems.push({ field: "fileCount", message: "does not match the number of file entries" });
    }
  }

  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, manifest: value as unknown as BackupManifest };
}

/**
 * Which files the archive should hold, and which it should not.
 *
 * Returned as a comparison rather than a boolean so a failure can name what is
 * missing and what is unexpected. "The archive does not match its manifest" is
 * true and unusable; "these three files are absent" is something an operator can
 * act on.
 */
export function compareArchiveContents(
  manifest: BackupManifest,
  present: Iterable<string>,
): { readonly missing: string[]; readonly unexpected: string[] } {
  const expected = new Set(manifest.files.map((file) => file.digest));
  const actual = new Set(present);
  return {
    missing: [...expected].filter((digest) => !actual.has(digest)).sort(),
    unexpected: [...actual].filter((digest) => !expected.has(digest)).sort(),
  };
}

/** The total the archive should weigh, for a cheap check before a slow one. */
export function expectedFileBytes(manifest: BackupManifest): number {
  return manifest.files.reduce((total, file) => total + file.byteLength, 0);
}
