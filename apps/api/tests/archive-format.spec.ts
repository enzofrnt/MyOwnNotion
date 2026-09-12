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

function emptyCanonical(): string {
  return JSON.stringify({
    format: "myownnotion.export+json",
    formatVersion: 2,
    workspaceId: "00000000-0000-7000-8000-000000000001",
    schemaVersion: 1,
    exportedAt: "2026-08-19T12:00:00.000Z",
    changeCursor: "42",
    items: [],
    databases: [],
    databaseEntries: [],
    relationships: [],
    revisions: [],
    counts: {
      items: 0,
      activeItems: 0,
      trashedItems: 0,
      placements: 0,
      relationships: 0,
      revisions: 0,
      databases: 0,
      databaseEntries: 0,
    },
  });
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
    const canonical = emptyCanonical();
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

    expect(() => decodeBackupArchive(original.subarray(0, original.byteLength - BLOCK))).toThrow(
      /two end blocks/,
    );

    expect(() => decodeBackupArchive(Buffer.concat([original, Buffer.from("suffix")]))).toThrow(
      /trailing bytes/,
    );
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
      reason: expect.stringMatching(/canonical export/i),
    });
  });

  it("checks structured counts and digest independently", () => {
    const databaseId = "00000000-0000-7000-8000-000000000010";
    const entryIds = [
      "00000000-0000-7000-8000-000000000011",
      "00000000-0000-7000-8000-000000000012",
    ];
    const revisionIds = [
      "00000000-0000-7000-8000-000000000013",
      "00000000-0000-7000-8000-000000000014",
      "00000000-0000-7000-8000-000000000015",
    ];
    const structured = {
      databases: [
        {
          databaseId,
          definitionVersion: 1,
          definition: { databaseId },
        },
      ],
      databaseEntries: entryIds.map((entryId) => ({
        entryId,
        databaseId,
        valueVersion: 1,
        addedRevisionId: revisionIds[entryIds.indexOf(entryId) + 1],
        values: { entryId, databaseId },
      })),
    };
    const canonical = JSON.stringify({
      format: "myownnotion.export+json",
      formatVersion: 2,
      workspaceId: "00000000-0000-7000-8000-000000000009",
      schemaVersion: 1,
      exportedAt: "2026-08-19T12:00:00.000Z",
      changeCursor: "42",
      items: [databaseId, ...entryIds].map((id, index) => ({
        id,
        workspaceId: "00000000-0000-7000-8000-000000000009",
        kind: index === 0 ? "folder" : "page",
        name: id,
        icon: null,
        lifecycle: "active",
        trashedAt: null,
        purgeAfter: null,
        currentRevisionId: revisionIds[index],
        favourite: false,
        offlineIntent: false,
        pageDocument: null,
        file: null,
        placements: [],
      })),
      ...structured,
      relationships: [],
      revisions: revisionIds.map((id, index) => ({
        id,
        itemId: [databaseId, ...entryIds][index],
        mutationId: id,
        parentRevisionIds: [],
        acceptedAt: "2026-08-19T12:00:00.000Z",
      })),
      counts: {
        items: 3,
        activeItems: 3,
        trashedItems: 0,
        placements: 0,
        relationships: 0,
        revisions: 3,
        databases: 1,
        databaseEntries: 2,
      },
    });
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
          itemCount: 3,
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
          itemCount: 3,
        }),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/structured.*digest/i) });
  });

  it("checks every file against its recorded size and digest", () => {
    const expected = Buffer.from("expected");
    const expectedDigest = digest(expected);
    const canonical = emptyCanonical();
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

  it("rejects malformed canonical exports before a restore target can begin", () => {
    const canonical = JSON.stringify({ items: [{}], relationships: [], revisions: [] });
    expect(
      inspect({
        canonical,
        manifest: manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 }),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/canonical export/i) });
  });

  it("rejects replacement characters in V2 item and file names", () => {
    for (const item of [
      { id: "item", name: "\uFFFD", file: null, pageDocument: null },
      {
        id: "item",
        name: "valid",
        file: {
          originalName: "\uFFFD",
          mediaType: "text/plain",
          byteLength: 0,
          sha256: createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
        },
        pageDocument: null,
      },
    ]) {
      const canonical = JSON.stringify({ items: [item], relationships: [], revisions: [] });
      expect(
        inspect({
          canonical,
          manifest: manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 }),
        }),
      ).toMatchObject({ ok: false, reason: expect.stringMatching(/replacement character/i) });
    }
  });

  it("keeps longer authored names containing the replacement character", () => {
    const revisionId = "00000000-0000-7000-8000-000000000002";
    const itemId = "00000000-0000-7000-8000-000000000001";
    const workspaceId = "00000000-0000-7000-8000-000000000003";
    const canonical = JSON.stringify({
      format: "myownnotion.export+json",
      formatVersion: 2,
      workspaceId,
      schemaVersion: 1,
      exportedAt: "2026-08-19T12:00:00.000Z",
      changeCursor: "42",
      items: [
        {
          id: itemId,
          workspaceId,
          kind: "folder",
          name: "authored \uFFFD name",
          icon: null,
          lifecycle: "active",
          trashedAt: null,
          purgeAfter: null,
          currentRevisionId: revisionId,
          favourite: false,
          offlineIntent: false,
          pageDocument: null,
          file: null,
          placements: [],
        },
      ],
      databases: [],
      databaseEntries: [],
      relationships: [],
      revisions: [
        {
          id: revisionId,
          itemId,
          mutationId: workspaceId,
          parentRevisionIds: [],
          acceptedAt: "2026-08-19T12:00:00.000Z",
        },
      ],
      counts: {
        items: 1,
        activeItems: 1,
        trashedItems: 0,
        placements: 0,
        relationships: 0,
        revisions: 1,
        databases: 0,
        databaseEntries: 0,
      },
    });
    expect(
      inspect({
        canonical,
        manifest: manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 }),
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a V2 stream that would be unrestorable", async () => {
    const canonical = JSON.stringify({
      items: [{ id: "item", name: "\uFFFD", file: null, pageDocument: null }],
      relationships: [],
      revisions: [],
    });
    await expect(
      collect(
        streamBackupArchive({
          manifest: manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 }),
          canonicalExport: canonical,
          readFile: async function* () {},
        }),
      ),
    ).rejects.toThrow(/replacement character/i);
  });
});
