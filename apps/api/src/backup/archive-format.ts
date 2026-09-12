/** The portable, unencrypted TAR payload sealed inside every backup object. */

import { createHash } from "node:crypto";
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  type CanonicalExportManifest,
  canonicalStructuredDataString,
  compareArchiveContents,
  isProtectedContentPayload,
  readBackupManifest,
  validateCanonicalExport,
  validateRelationshipMetadata,
} from "@myownnotion/domain";
import {
  PAGE_OPERATION_ARCHIVE_VERSION,
  type PageOperationArchive,
  readPageOperationArchive,
} from "./page-operation-archive.ts";

const TAR_BLOCK_BYTES = 512;
const MANIFEST_PATH = "manifest.json";
const CANONICAL_EXPORT_PATH = "canonical-export.json";
const PAGE_OPERATIONS_PATH = "page-operations.json";
const FILE_PATH = /^files\/([0-9a-f]{64})$/;

export interface DecodedBackupArchive {
  readonly manifest: unknown;
  readonly canonicalExport: string;
  readonly operationalState: string | null;
  readonly files: ReadonlyMap<string, Buffer>;
}

export type InspectedBackupArchive =
  | {
      readonly ok: true;
      readonly body: DecodedBackupArchive;
      readonly manifest: BackupManifest;
    }
  | { readonly ok: false; readonly reason: string };

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Format v1 predates the protected-content marker reservation. It is therefore
 * allowed to contain the exact marker as authored data. Format v2 is the
 * provenance boundary for newly produced archives: a marker at a canonical
 * content boundary is storage state, never user data, and must be rejected
 * before a restore target can begin.
 */
function validateReservedContentBoundaries(
  manifest: BackupManifest,
  canonical: unknown,
): string | null {
  if (manifest.formatVersion < BACKUP_FORMAT_VERSION) return null;
  if (typeof canonical !== "object" || canonical === null || Array.isArray(canonical)) {
    return "The canonical export is not an object.";
  }
  const record = canonical as Record<string, unknown>;
  const items = record["items"];
  if (!Array.isArray(items)) return "The canonical export does not contain items.";
  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return "The canonical export contains an invalid item.";
    }
    const itemRecord = item as Record<string, unknown>;
    for (const [field, value] of [
      ["item.name", itemRecord["name"]],
      [
        "file.originalName",
        (itemRecord["file"] as Record<string, unknown> | null)?.["originalName"],
      ],
    ] as const) {
      if (typeof value === "string" && value.trim() === "\uFFFD") {
        return `The backup contains a ${field} with a Unicode replacement character.`;
      }
    }
    const pageDocument = itemRecord["pageDocument"];
    if (pageDocument !== null && pageDocument !== undefined) {
      const body =
        typeof pageDocument === "object" && pageDocument !== null
          ? (pageDocument as Record<string, unknown>)["body"]
          : undefined;
      if (isProtectedContentPayload(body)) {
        return "The backup contains a page document with a reserved protected-content value.";
      }
    }
  }
  const relationships = record["relationships"];
  if (!Array.isArray(relationships)) return "The canonical export does not contain relationships.";
  for (const relationship of relationships) {
    if (typeof relationship !== "object" || relationship === null || Array.isArray(relationship)) {
      return "The canonical export contains an invalid relationship.";
    }
    const metadata = (relationship as Record<string, unknown>)["metadata"];
    const metadataResult = validateRelationshipMetadata(metadata);
    if (!metadataResult.ok) {
      return "The backup contains relationship metadata with a reserved protected-content value.";
    }
    // Keep the exact marker check close to the boundary as a defense against a
    // future metadata validator accidentally widening its authored vocabulary.
    if (isProtectedContentPayload(metadata)) {
      return "The backup contains relationship metadata with a reserved protected-content value.";
    }
  }
  return null;
}

/**
 * V2 is produced only after the canonical export has passed the same complete
 * graph checks that restoration uses. The stream then authenticates every file
 * while it is emitted, so a successful producer cannot create an archive that
 * a later inspect/restore step will reject.
 */
function validateProducedCanonical(manifest: BackupManifest, canonicalExport: string): void {
  const canonicalBytes = Buffer.from(canonicalExport, "utf8");
  if (sha256(canonicalBytes) !== manifest.canonicalExportDigest) {
    throw new Error("The canonical export does not match the manifest digest.");
  }
  let canonical: unknown;
  try {
    canonical = JSON.parse(canonicalExport);
  } catch {
    throw new Error("The canonical export is not valid JSON.");
  }
  const manifestRead = readBackupManifest(manifest);
  if (!manifestRead.ok) {
    throw new Error("The backup manifest is not valid.");
  }
  if (manifest.formatVersion >= BACKUP_FORMAT_VERSION) {
    const reservedContentProblem = validateReservedContentBoundaries(manifest, canonical);
    if (reservedContentProblem !== null) throw new Error(reservedContentProblem);
  }
  let exportIssues: ReturnType<typeof validateCanonicalExport> = [];
  try {
    exportIssues = validateCanonicalExport(canonical as unknown as CanonicalExportManifest);
  } catch {
    throw new Error("The canonical export is incomplete.");
  }
  if (exportIssues.length > 0) {
    throw new Error(`The canonical export is incomplete: ${exportIssues[0]?.detail}`);
  }
  const record = canonical as {
    readonly items?: unknown[];
    readonly databases?: unknown[];
    readonly databaseEntries?: unknown[];
  };
  if (!Array.isArray(record.items) || record.items.length !== manifest.itemCount) {
    throw new Error("The canonical export item count does not match the manifest.");
  }
  if (
    manifest.structuredDataDigest !== undefined &&
    (!Array.isArray(record.databases) ||
      !Array.isArray(record.databaseEntries) ||
      record.databases.length !== manifest.databaseCount ||
      record.databaseEntries.length !== manifest.databaseEntryCount)
  ) {
    throw new Error("The canonical export structured counts do not match the manifest.");
  }
}

function validateOperationalState(
  manifest: BackupManifest,
  operationalState: string | null,
): string | null {
  if (manifest.operationalStateDigest === undefined) {
    return operationalState === null
      ? null
      : "This archive contains operational page state that its manifest does not declare.";
  }
  if (operationalState === null) {
    return "This archive is missing the operational page state declared by its manifest.";
  }
  const operationalBytes = Buffer.from(operationalState, "utf8");
  if (sha256(operationalBytes) !== manifest.operationalStateDigest) {
    return "The operational page state does not match the digest recorded in the manifest.";
  }
  let operational: PageOperationArchive;
  try {
    operational = readPageOperationArchive(JSON.parse(operationalState));
  } catch {
    return "The operational page state is not valid.";
  }
  if (
    manifest.operationalFormatVersion !== PAGE_OPERATION_ARCHIVE_VERSION ||
    operational.formatVersion !== manifest.operationalFormatVersion ||
    operational.counts.pages !== manifest.operationalPageCount ||
    operational.counts.checkpoints !== manifest.operationalCheckpointCount ||
    operational.counts.updates !== manifest.operationalUpdateCount
  ) {
    return "The operational page state does not contain the version and counts its manifest records.";
  }
  return null;
}

function validateEncodedFiles(manifest: BackupManifest, files: ReadonlyMap<string, Buffer>): void {
  for (const digest of files.keys()) {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      throw new Error("a backup file is not addressed by a sha256 digest");
    }
  }
  const contents = compareArchiveContents(manifest, files.keys());
  if (contents.missing.length > 0 || contents.unexpected.length > 0) {
    throw new Error("The encoded archive files do not match its manifest inventory.");
  }
  for (const expected of manifest.files) {
    const bytes = files.get(expected.digest);
    if (
      bytes === undefined ||
      bytes.byteLength !== expected.byteLength ||
      sha256(bytes) !== expected.digest
    ) {
      throw new Error("An encoded archive file does not match its authenticated inventory.");
    }
  }
}

function writeText(target: Buffer, offset: number, width: number, value: string): void {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength > width) {
    throw new Error(`tar field is too long: ${value}`);
  }
  encoded.copy(target, offset);
}

function writeOctal(target: Buffer, offset: number, width: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("tar numeric fields must be non-negative safe integers");
  }
  const encoded = `${value.toString(8).padStart(width - 1, "0")}\0`;
  if (encoded.length > width) {
    throw new Error("tar numeric field exceeds its portable width");
  }
  target.write(encoded, offset, width, "ascii");
}

function entryHeader(name: string, byteLength: number, modifiedAt: Date): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, byteLength);
  writeOctal(header, 136, 12, Math.max(0, Math.floor(modifiedAt.getTime() / 1000)));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, 257, 6, "ustar");
  writeText(header, 263, 2, "00");
  writeText(header, 265, 32, "myownnotion");
  writeText(header, 297, 32, "myownnotion");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function encodeEntry(name: string, bytes: Buffer, modifiedAt: Date): Buffer[] {
  const padding = (TAR_BLOCK_BYTES - (bytes.byteLength % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
  return [entryHeader(name, bytes.byteLength, modifiedAt), bytes, Buffer.alloc(padding)];
}

/**
 * Builds the exact layout for malformed archive fixtures and low-level parser tests.
 * Runtime producers must use encodeBackupArchive or streamBackupArchive.
 */
export function encodeUncheckedBackupArchive(input: {
  readonly manifest: BackupManifest;
  readonly canonicalExport: string;
  readonly operationalState?: string | null;
  readonly files: ReadonlyMap<string, Buffer>;
}): Buffer {
  const modifiedAt = new Date(input.manifest.createdAt);
  if (Number.isNaN(modifiedAt.getTime())) {
    throw new Error("the backup manifest has no valid creation date");
  }
  const parts: Buffer[] = [];
  parts.push(
    ...encodeEntry(MANIFEST_PATH, Buffer.from(JSON.stringify(input.manifest), "utf8"), modifiedAt),
  );
  parts.push(
    ...encodeEntry(CANONICAL_EXPORT_PATH, Buffer.from(input.canonicalExport, "utf8"), modifiedAt),
  );
  if (input.operationalState != null) {
    parts.push(
      ...encodeEntry(PAGE_OPERATIONS_PATH, Buffer.from(input.operationalState, "utf8"), modifiedAt),
    );
  }
  for (const [digest, bytes] of [...input.files].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      throw new Error("a backup file is not addressed by a sha256 digest");
    }
    parts.push(...encodeEntry(`files/${digest.slice("sha256:".length)}`, bytes, modifiedAt));
  }
  // POSIX readers expect two zero blocks at end-of-archive.
  parts.push(Buffer.alloc(TAR_BLOCK_BYTES * 2));
  return Buffer.concat(parts);
}

/** Encodes a V2 archive only after the same preflight used by the stream. */
export function encodeBackupArchive(input: {
  readonly manifest: BackupManifest;
  readonly canonicalExport: string;
  readonly operationalState?: string | null;
  readonly files: ReadonlyMap<string, Buffer>;
}): Buffer {
  validateProducedCanonical(input.manifest, input.canonicalExport);
  const operationalProblem = validateOperationalState(
    input.manifest,
    input.operationalState ?? null,
  );
  if (operationalProblem !== null) throw new Error(operationalProblem);
  validateEncodedFiles(input.manifest, input.files);
  return encodeUncheckedBackupArchive(input);
}

/** Same TAR layout, with attachment chunks flowing directly into the sealer. */
export async function* streamBackupArchive(input: {
  readonly manifest: BackupManifest;
  readonly canonicalExport: string;
  readonly operationalState?: string | null;
  readonly readFile: (digest: string) => AsyncIterable<Uint8Array>;
}): AsyncGenerator<Uint8Array> {
  const modifiedAt = new Date(input.manifest.createdAt);
  if (Number.isNaN(modifiedAt.getTime())) throw new Error("The backup creation date is invalid.");
  validateProducedCanonical(input.manifest, input.canonicalExport);
  const operationalProblem = validateOperationalState(
    input.manifest,
    input.operationalState ?? null,
  );
  if (operationalProblem !== null) throw new Error(operationalProblem);
  yield* encodeEntry(MANIFEST_PATH, Buffer.from(JSON.stringify(input.manifest)), modifiedAt);
  yield* encodeEntry(CANONICAL_EXPORT_PATH, Buffer.from(input.canonicalExport), modifiedAt);
  if (input.operationalState != null)
    yield* encodeEntry(PAGE_OPERATIONS_PATH, Buffer.from(input.operationalState), modifiedAt);
  for (const file of [...input.manifest.files].sort((a, b) => a.digest.localeCompare(b.digest))) {
    yield entryHeader(`files/${file.digest.slice("sha256:".length)}`, file.byteLength, modifiedAt);
    const hash = createHash("sha256");
    let length = 0;
    for await (const bytes of input.readFile(file.digest)) {
      length += bytes.byteLength;
      if (length > file.byteLength) throw new Error("Backup file exceeds its declared length.");
      hash.update(bytes);
      yield bytes;
    }
    if (length !== file.byteLength || `sha256:${hash.digest("hex")}` !== file.digest)
      throw new Error("Backup file does not match its authenticated inventory.");
    const padding = (TAR_BLOCK_BYTES - (length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if (padding > 0) yield Buffer.alloc(padding);
  }
  yield Buffer.alloc(TAR_BLOCK_BYTES * 2);
}

function readText(source: Buffer, offset: number, width: number): string {
  const field = source.subarray(offset, offset + width);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function readOctal(source: Buffer, offset: number, width: number): number {
  const raw = readText(source, offset, width).trim();
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error("the tar archive contains an invalid numeric field");
  }
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) {
    throw new Error("the tar archive contains an unsafe numeric field");
  }
  return value;
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

/** Reads only regular files and rejects duplicate or undocumented paths. */
export function decodeBackupArchive(archive: Buffer): DecodedBackupArchive {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  let terminated = false;
  while (offset + TAR_BLOCK_BYTES <= archive.byteLength) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) {
      if (offset + TAR_BLOCK_BYTES * 2 > archive.byteLength) {
        throw new Error("the backup tar must end with two end blocks");
      }
      if (!isZeroBlock(archive.subarray(offset + TAR_BLOCK_BYTES, offset + TAR_BLOCK_BYTES * 2))) {
        throw new Error("the backup tar must end with two end blocks");
      }
      if (offset + TAR_BLOCK_BYTES * 2 !== archive.byteLength) {
        throw new Error("the backup tar contains trailing bytes after its end blocks");
      }
      terminated = true;
      offset += TAR_BLOCK_BYTES * 2;
      break;
    }
    if (readText(header, 257, 6) !== "ustar") {
      throw new Error("the backup payload is not a portable tar archive");
    }
    const expectedChecksum = readOctal(header, 148, 8);
    const checked = Buffer.from(header);
    checked.fill(0x20, 148, 156);
    const actualChecksum = checked.reduce((total, byte) => total + byte, 0);
    if (actualChecksum !== expectedChecksum) {
      throw new Error("a tar header checksum does not match");
    }
    if (header[156] !== "0".charCodeAt(0) && header[156] !== 0) {
      throw new Error("the backup tar contains a non-regular entry");
    }
    const name = readText(header, 0, 100);
    if (
      name !== MANIFEST_PATH &&
      name !== CANONICAL_EXPORT_PATH &&
      name !== PAGE_OPERATIONS_PATH &&
      !FILE_PATH.test(name)
    ) {
      throw new Error("the backup tar contains an undocumented path");
    }
    if (entries.has(name)) {
      throw new Error("the backup tar contains a duplicate path");
    }
    const byteLength = readOctal(header, 124, 12);
    const contentStart = offset + TAR_BLOCK_BYTES;
    const contentEnd = contentStart + byteLength;
    if (contentEnd > archive.byteLength) {
      throw new Error("the backup tar ends inside an entry");
    }
    entries.set(name, Buffer.from(archive.subarray(contentStart, contentEnd)));
    offset = contentStart + Math.ceil(byteLength / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }
  if (!terminated) {
    throw new Error("the backup tar has no end marker");
  }

  const manifestBytes = entries.get(MANIFEST_PATH);
  const canonicalBytes = entries.get(CANONICAL_EXPORT_PATH);
  if (manifestBytes === undefined || canonicalBytes === undefined) {
    throw new Error("the backup tar is missing its manifest or canonical export");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("the backup manifest is not valid JSON");
  }
  const files = new Map<string, Buffer>();
  for (const [name, bytes] of entries) {
    const matched = FILE_PATH.exec(name);
    if (matched !== null) {
      files.set(`sha256:${matched[1]}`, bytes);
    }
  }
  return {
    manifest,
    canonicalExport: canonicalBytes.toString("utf8"),
    operationalState: entries.get(PAGE_OPERATIONS_PATH)?.toString("utf8") ?? null,
    files,
  };
}

/** Checks framing, manifest claims, the canonical export, and every file. */
export function inspectBackupArchive(archive: Buffer): InspectedBackupArchive {
  let body: DecodedBackupArchive;
  try {
    body = decodeBackupArchive(archive);
  } catch {
    return {
      ok: false,
      reason: "This archive could not be read: its contents are not in the expected form.",
    };
  }
  const read = readBackupManifest(body.manifest);
  if (!read.ok) {
    return {
      ok: false,
      reason: `This archive's manifest is not valid: ${read.problems
        .map((problem) => `${problem.field} ${problem.message}`)
        .join("; ")}`,
    };
  }
  const manifest = read.manifest;
  const contents = compareArchiveContents(manifest, body.files.keys());
  if (contents.missing.length > 0 || contents.unexpected.length > 0) {
    return {
      ok: false,
      reason:
        contents.missing.length > 0
          ? `This archive is missing ${contents.missing.length} file(s) its manifest lists. Restoring it would produce a workspace with holes in it.`
          : `This archive contains ${contents.unexpected.length} file(s) its manifest does not list, so its contents cannot be trusted.`,
    };
  }
  const canonicalBytes = Buffer.from(body.canonicalExport, "utf8");
  if (sha256(canonicalBytes) !== manifest.canonicalExportDigest) {
    return {
      ok: false,
      reason: "The canonical export does not match the digest recorded in the manifest.",
    };
  }
  let canonical: {
    readonly items?: unknown[];
    readonly databases?: unknown[];
    readonly databaseEntries?: unknown[];
  };
  try {
    canonical = JSON.parse(body.canonicalExport) as { readonly items?: unknown[] };
  } catch {
    return { ok: false, reason: "The canonical export is not valid JSON." };
  }
  const reservedContentProblem = validateReservedContentBoundaries(manifest, canonical);
  if (reservedContentProblem !== null) {
    return { ok: false, reason: reservedContentProblem };
  }
  let exportIssues: ReturnType<typeof validateCanonicalExport> = [];
  try {
    exportIssues = validateCanonicalExport(canonical as unknown as CanonicalExportManifest);
  } catch {
    return { ok: false, reason: "The canonical export is incomplete." };
  }
  if (exportIssues.length > 0) {
    return {
      ok: false,
      reason: `The canonical export is incomplete: ${exportIssues[0]?.detail}`,
    };
  }
  if (!Array.isArray(canonical.items) || canonical.items.length !== manifest.itemCount) {
    return {
      ok: false,
      reason: "The canonical export does not contain the number of items its manifest records.",
    };
  }
  if (manifest.structuredDataDigest !== undefined) {
    if (
      !Array.isArray(canonical.databases) ||
      !Array.isArray(canonical.databaseEntries) ||
      canonical.databases.length !== manifest.databaseCount ||
      canonical.databaseEntries.length !== manifest.databaseEntryCount
    ) {
      return {
        ok: false,
        reason:
          "The canonical export does not contain the structured records its manifest records.",
      };
    }
    const structuredDigest = sha256(
      Buffer.from(
        canonicalStructuredDataString({
          databases: canonical.databases as never[],
          databaseEntries: canonical.databaseEntries as never[],
        }),
        "utf8",
      ),
    );
    if (structuredDigest !== manifest.structuredDataDigest) {
      return {
        ok: false,
        reason: "The structured database records do not match their recorded digest.",
      };
    }
  }
  const operationalProblem = validateOperationalState(manifest, body.operationalState);
  if (operationalProblem !== null) return { ok: false, reason: operationalProblem };
  for (const expected of manifest.files) {
    const bytes = body.files.get(expected.digest) ?? Buffer.alloc(0);
    if (bytes.byteLength !== expected.byteLength || sha256(bytes) !== expected.digest) {
      return {
        ok: false,
        reason: "A file in this archive does not match the size and digest recorded for it.",
      };
    }
  }
  return { ok: true, body, manifest };
}
