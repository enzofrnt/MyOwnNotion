/** The portable, unencrypted TAR payload sealed inside every backup object. */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import {
  type BackupManifest,
  canonicalStructuredDataString,
  compareArchiveContents,
  readBackupManifest,
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

async function writeFully(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (bytesWritten === 0) {
      throw new Error("the backup archive could not be written completely");
    }
    offset += bytesWritten;
  }
}

async function writeEntry(
  handle: Awaited<ReturnType<typeof open>>,
  name: string,
  bytes: Uint8Array,
  modifiedAt: Date,
): Promise<void> {
  await writeFully(handle, entryHeader(name, bytes.byteLength, modifiedAt));
  await writeFully(handle, bytes);
  const padding = (TAR_BLOCK_BYTES - (bytes.byteLength % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
  if (padding > 0) {
    await writeFully(handle, Buffer.alloc(padding));
  }
}

/** Builds the exact layout documented in contracts/backup-archive.md. */
export function encodeBackupArchive(input: {
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

/**
 * Writes the same portable layout without retaining the whole workspace.
 *
 * The canonical export remains one JSON value, but file payloads are fetched,
 * checked, written and released one at a time. Total memory therefore follows
 * the largest single file rather than the sum of every file in the workspace.
 */
export async function writeBackupArchiveFile(input: {
  readonly path: string;
  readonly manifest: BackupManifest;
  readonly canonicalExport: string;
  readonly operationalState?: string | null;
  readonly readFile: (digest: string) => Promise<Uint8Array | null>;
}): Promise<void> {
  const modifiedAt = new Date(input.manifest.createdAt);
  if (Number.isNaN(modifiedAt.getTime())) {
    throw new Error("the backup manifest has no valid creation date");
  }

  const handle = await open(input.path, "wx", 0o600);
  try {
    await writeEntry(
      handle,
      MANIFEST_PATH,
      Buffer.from(JSON.stringify(input.manifest), "utf8"),
      modifiedAt,
    );
    await writeEntry(
      handle,
      CANONICAL_EXPORT_PATH,
      Buffer.from(input.canonicalExport, "utf8"),
      modifiedAt,
    );
    if (input.operationalState != null) {
      await writeEntry(
        handle,
        PAGE_OPERATIONS_PATH,
        Buffer.from(input.operationalState, "utf8"),
        modifiedAt,
      );
    }
    for (const file of [...input.manifest.files].sort((left, right) =>
      left.digest.localeCompare(right.digest),
    )) {
      const bytes = await input.readFile(file.digest);
      if (bytes === null) {
        throw new Error(`content ${file.digest} is named by the export and absent from the store`);
      }
      if (bytes.byteLength !== file.byteLength || sha256(bytes) !== file.digest) {
        throw new Error(`content ${file.digest} does not match the export metadata`);
      }
      await writeEntry(handle, `files/${file.digest.slice("sha256:".length)}`, bytes, modifiedAt);
    }
    await writeFully(handle, Buffer.alloc(TAR_BLOCK_BYTES * 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
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
      terminated = true;
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
  if (manifest.operationalStateDigest === undefined) {
    if (body.operationalState !== null) {
      return {
        ok: false,
        reason: "This archive contains operational page state that its manifest does not declare.",
      };
    }
  } else {
    if (body.operationalState === null) {
      return {
        ok: false,
        reason: "This archive is missing the operational page state declared by its manifest.",
      };
    }
    const operationalBytes = Buffer.from(body.operationalState, "utf8");
    if (sha256(operationalBytes) !== manifest.operationalStateDigest) {
      return {
        ok: false,
        reason: "The operational page state does not match the digest recorded in the manifest.",
      };
    }
    let operational: PageOperationArchive;
    try {
      operational = readPageOperationArchive(JSON.parse(body.operationalState));
    } catch {
      return { ok: false, reason: "The operational page state is not valid." };
    }
    if (
      manifest.operationalFormatVersion !== PAGE_OPERATION_ARCHIVE_VERSION ||
      operational.formatVersion !== manifest.operationalFormatVersion ||
      operational.counts.pages !== manifest.operationalPageCount ||
      operational.counts.checkpoints !== manifest.operationalCheckpointCount ||
      operational.counts.updates !== manifest.operationalUpdateCount
    ) {
      return {
        ok: false,
        reason:
          "The operational page state does not contain the version and counts its manifest records.",
      };
    }
  }
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
