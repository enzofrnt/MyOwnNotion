import { createHash } from "node:crypto";
import { type BackupManifest, canonicalStructuredDataString } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  decodeBackupArchive,
  encodeBackupArchive,
  inspectBackupArchive,
  streamBackupArchive,
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

async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const bytes of source) chunks.push(Buffer.from(bytes));
  return Buffer.concat(chunks);
}

describe("streaming archive writing", () => {
  it("streams the exact portable layout in digest order without a plaintext staging file", async () => {
    const files = new Map<string, Buffer>([
      [digest(Buffer.from("file payload")), Buffer.from("file payload")],
      [digest(Buffer.alloc(512, 7)), Buffer.alloc(512, 7)],
      [digest(Buffer.alloc(0)), Buffer.alloc(0)],
    ]);
    const canonical = JSON.stringify({ items: [], relationships: [], revisions: [] });
    const manifest = manifestFor(
      canonical,
      [...files].map(([digest, bytes]) => ({ digest, byteLength: bytes.length })),
    );
    const reads: string[] = [];
    const streamed = await collect(
      streamBackupArchive({
        manifest,
        canonicalExport: canonical,
        readFile: async function* (requested) {
          reads.push(requested);
          const bytes = files.get(requested);
          if (bytes === undefined) throw new Error("missing source");
          yield bytes.subarray(0, 2);
          yield bytes.subarray(2);
        },
      }),
    );
    expect(reads).toEqual([...files.keys()].sort());
    expect(streamed).toEqual(encodeBackupArchive({ manifest, canonicalExport: canonical, files }));
    expect(inspectBackupArchive(streamed)).toMatchObject({ ok: true });
  });

  it("refuses missing, shortened, extended or substituted streams before a complete archive", async () => {
    const bytes = Buffer.from("expected");
    const canonical = JSON.stringify({ items: [], relationships: [], revisions: [] });
    const manifest = manifestFor(canonical, [{ digest: digest(bytes), byteLength: bytes.length }]);
    for (const bad of [
      Buffer.alloc(0),
      bytes.subarray(1),
      Buffer.from("too much data"),
      Buffer.alloc(bytes.length),
    ]) {
      await expect(
        collect(
          streamBackupArchive({
            manifest,
            canonicalExport: canonical,
            readFile: async function* () {
              yield bad;
            },
          }),
        ),
      ).rejects.toThrow(/declared length|authenticated inventory/);
    }
    await expect(
      collect(
        streamBackupArchive({
          manifest,
          canonicalExport: canonical,
          readFile: async function* () {
            yield bytes.subarray(0, 2);
            throw new Error("source unavailable");
          },
        }),
      ),
    ).rejects.toThrow("source unavailable");
  });

  it("refuses an invalid creation date before emitting output", async () => {
    const stream = streamBackupArchive({
      manifest: manifestFor("{}", [], { createdAt: "not-a-date" }),
      canonicalExport: "{}",
      readFile: async function* () {
        yield Buffer.alloc(0);
      },
    });
    await expect(stream.next()).rejects.toThrow(/creation date/);
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

  it("checks structured counts and digest independently", () => {
    const structured = { databases: [{}], databaseEntries: [{}, {}] };
    const canonical = JSON.stringify({ items: [], ...structured });
    const validStructuredDigest = digest(
      Buffer.from(canonicalStructuredDataString(structured as never)),
    );
    expect(
      inspect({
        canonical,
        manifest: manifestFor(canonical, [], {
          databaseCount: 1,
          databaseEntryCount: 2,
          structuredDataDigest: validStructuredDigest,
        }),
      }),
    ).toMatchObject({ ok: true });
    expect(
      inspect({
        canonical,
        manifest: manifestFor(canonical, [], {
          databaseCount: 1,
          databaseEntryCount: 2,
          structuredDataDigest: digest(Buffer.from("other")),
        }),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/structured.*digest/i) });
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
