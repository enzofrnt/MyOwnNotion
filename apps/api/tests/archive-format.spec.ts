import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BackupManifest } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeBackupArchive,
  encodeBackupArchive,
  inspectBackupArchive,
  writeBackupArchiveFile,
} from "../src/backup/archive-format.ts";

const BLOCK = 512;
const digest = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;

function manifestFor(
  canonicalExport: string,
  files: BackupManifest["files"] = [],
  overrides: Partial<BackupManifest> = {},
): BackupManifest {
  return {
    format: "myownnotion.backup",
    formatVersion: 1,
    createdAt: "2026-08-19T12:00:00.000Z",
    cursor: "42",
    applicationVersion: "sha-test",
    schemaVersion: 1,
    recordFormatVersion: 1,
    canonicalExportDigest: digest(Buffer.from(canonicalExport)),
    files,
    itemCount: 0,
    fileCount: files.length,
    ...overrides,
  };
}

function checksumHeader(archive: Buffer, offset = 0): void {
  archive.fill(0x20, offset + 148, offset + 156);
  const sum = archive.subarray(offset, offset + BLOCK).reduce((total, byte) => total + byte, 0);
  archive.write(`${sum.toString(8).padStart(6, "0")}\0 `, offset + 148, 8, "ascii");
}

function firstEntryEnd(archive: Buffer): number {
  const raw = archive.subarray(124, 136).toString("ascii").replaceAll("\0", "").trim();
  const size = Number.parseInt(raw, 8);
  return BLOCK + Math.ceil(size / BLOCK) * BLOCK;
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mon-archive-format-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("streaming archive writing", () => {
  it("writes the same inspectable shape while loading one file at a time", async () => {
    const bytes = Buffer.from("file payload");
    const fileDigest = digest(bytes);
    const canonical = JSON.stringify({ items: [], relationships: [], revisions: [] });
    const target = path.join(directory, "backup.tar");
    const reads: string[] = [];
    await writeBackupArchiveFile({
      path: target,
      manifest: manifestFor(canonical, [{ digest: fileDigest, byteLength: bytes.byteLength }]),
      canonicalExport: canonical,
      readFile: async (requested) => {
        reads.push(requested);
        return bytes;
      },
    });
    expect(reads).toEqual([fileDigest]);
    expect(inspectBackupArchive(await readFile(target))).toMatchObject({ ok: true });
  });

  it("refuses an absent or changed payload named by the manifest", async () => {
    const bytes = Buffer.from("expected");
    const fileDigest = digest(bytes);
    const canonical = JSON.stringify({ items: [], relationships: [], revisions: [] });
    const archiveManifest = manifestFor(canonical, [
      { digest: fileDigest, byteLength: bytes.byteLength },
    ]);
    await expect(
      writeBackupArchiveFile({
        path: path.join(directory, "missing.tar"),
        manifest: archiveManifest,
        canonicalExport: canonical,
        readFile: async () => null,
      }),
    ).rejects.toThrow(/absent from the store/);
    await expect(
      writeBackupArchiveFile({
        path: path.join(directory, "changed.tar"),
        manifest: archiveManifest,
        canonicalExport: canonical,
        readFile: async () => Buffer.from("modified"),
      }),
    ).rejects.toThrow(/does not match/);
  });

  it("refuses an invalid creation date before creating output", async () => {
    const canonical = JSON.stringify({ items: [] });
    await expect(
      writeBackupArchiveFile({
        path: path.join(directory, "invalid.tar"),
        manifest: manifestFor(canonical, [], { createdAt: "not-a-date" }),
        canonicalExport: canonical,
        readFile: async () => null,
      }),
    ).rejects.toThrow(/valid creation date/);
  });
});

describe("portable TAR framing", () => {
  const canonical = JSON.stringify({ items: [], relationships: [], revisions: [] });
  const archive = () =>
    encodeBackupArchive({
      manifest: manifestFor(canonical),
      canonicalExport: canonical,
      files: new Map(),
    });

  it("refuses invalid encoder inputs", () => {
    expect(() =>
      encodeBackupArchive({
        manifest: manifestFor(canonical, [], { createdAt: "not-a-date" }),
        canonicalExport: canonical,
        files: new Map(),
      }),
    ).toThrow(/valid creation date/);
    expect(() =>
      encodeBackupArchive({
        manifest: manifestFor(canonical),
        canonicalExport: canonical,
        files: new Map([["md5:not-a-digest", Buffer.from("x")]]),
      }),
    ).toThrow(/sha256 digest/);
  });

  it("rejects bad magic, checksum, entry type and numeric fields", () => {
    const badMagic = archive();
    badMagic.write("xxxxx", 257, "ascii");
    expect(() => decodeBackupArchive(badMagic)).toThrow(/portable tar/);

    const badChecksum = archive();
    badChecksum[0] = "x".charCodeAt(0);
    expect(() => decodeBackupArchive(badChecksum)).toThrow(/checksum/);

    const directoryEntry = archive();
    directoryEntry[156] = "5".charCodeAt(0);
    checksumHeader(directoryEntry);
    expect(() => decodeBackupArchive(directoryEntry)).toThrow(/non-regular/);

    const badNumber = archive();
    badNumber.fill("x".charCodeAt(0), 124, 136);
    checksumHeader(badNumber);
    expect(() => decodeBackupArchive(badNumber)).toThrow(/invalid numeric/);
  });

  it("rejects undocumented, duplicate, truncated and unterminated entries", () => {
    const undocumented = archive();
    undocumented.fill(0, 0, 100);
    undocumented.write("private.txt", 0, "utf8");
    checksumHeader(undocumented);
    expect(() => decodeBackupArchive(undocumented)).toThrow(/undocumented path/);

    const original = archive();
    const entryEnd = firstEntryEnd(original);
    const duplicate = Buffer.concat([original.subarray(0, entryEnd), original]);
    expect(() => decodeBackupArchive(duplicate)).toThrow(/duplicate path/);

    const truncated = archive();
    truncated.write("77777777777\0", 124, 12, "ascii");
    checksumHeader(truncated);
    expect(() => decodeBackupArchive(truncated)).toThrow(/ends inside an entry/);

    expect(() =>
      decodeBackupArchive(original.subarray(0, original.byteLength - BLOCK * 2)),
    ).toThrow(/no end marker/);
  });

  it("requires both metadata entries and valid manifest JSON", () => {
    const missingManifest = archive();
    missingManifest.fill(0, 0, 100);
    missingManifest.write(`files/${"a".repeat(64)}`, 0, "ascii");
    checksumHeader(missingManifest);
    expect(() => decodeBackupArchive(missingManifest)).toThrow(/missing its manifest/);

    const invalidJson = archive();
    invalidJson[firstEntryEnd(invalidJson) - BLOCK] = "!".charCodeAt(0);
    expect(() => decodeBackupArchive(invalidJson)).toThrow(/manifest is not valid JSON/);
  });
});

describe("archive content inspection", () => {
  function inspect(input: {
    canonical?: string;
    manifest?: BackupManifest;
    files?: ReadonlyMap<string, Buffer>;
  }) {
    const canonicalExport = input.canonical ?? JSON.stringify({ items: [] });
    return inspectBackupArchive(
      encodeBackupArchive({
        manifest: input.manifest ?? manifestFor(canonicalExport),
        canonicalExport,
        files: input.files ?? new Map(),
      }),
    );
  }

  it("returns safe reasons for unreadable and invalid manifests", () => {
    expect(inspectBackupArchive(Buffer.from("not a tar"))).toMatchObject({ ok: false });
    expect(
      inspect({
        manifest: { ...manifestFor(JSON.stringify({ items: [] })), format: "wrong" } as never,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/manifest is not valid/i) });
  });

  it("detects missing and unexpected files", () => {
    const expected = Buffer.from("expected");
    const expectedDigest = digest(expected);
    const canonical = JSON.stringify({ items: [] });
    expect(
      inspect({
        canonical,
        manifest: manifestFor(canonical, [
          { digest: expectedDigest, byteLength: expected.byteLength },
        ]),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/missing 1 file/i) });
    expect(inspect({ files: new Map([[expectedDigest, expected]]) })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/contains 1 file/i),
    });
  });

  it("checks canonical JSON, its digest and item count independently", () => {
    const canonical = JSON.stringify({ items: [] });
    expect(
      inspect({
        manifest: manifestFor(canonical, [], {
          canonicalExportDigest: digest(Buffer.from("other")),
        }),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/canonical export.*digest/i) });

    const invalidJson = "not-json";
    expect(inspect({ canonical: invalidJson, manifest: manifestFor(invalidJson) })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not valid JSON/i),
    });

    const oneItem = JSON.stringify({ items: [{}] });
    expect(inspect({ canonical: oneItem, manifest: manifestFor(oneItem) })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/number of items/i),
    });
  });

  it("checks every file against its recorded size and digest", () => {
    const expected = Buffer.from("expected");
    const expectedDigest = digest(expected);
    const canonical = JSON.stringify({ items: [] });
    expect(
      inspect({
        canonical,
        manifest: manifestFor(canonical, [
          { digest: expectedDigest, byteLength: expected.byteLength },
        ]),
        files: new Map([[expectedDigest, Buffer.from("modified")]]),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/does not match/i) });
  });
});
