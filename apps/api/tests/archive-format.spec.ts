import { createHash } from "node:crypto";
import { type BackupManifest, canonicalStructuredDataString } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  decodeBackupArchive,
  encodeBackupArchive,
  encodeUncheckedBackupArchive,
  inspectBackupArchive,
  streamBackupArchive,
} from "../src/backup/archive-format.ts";
import { applyArchive } from "../src/backup/restore-service.ts";

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

function canonicalWithFile(fileDigest: string, byteLength: number): string {
  return canonicalWithFiles([{ digest: fileDigest, byteLength }]);
}

function canonicalWithFiles(files: ReadonlyArray<{ digest: string; byteLength: number }>): string {
  const canonical = JSON.parse(emptyCanonical()) as Record<string, unknown>;
  const workspaceId = canonical["workspaceId"] as string;
  canonical["items"] = files.map((file, index) => {
    const itemId = `00000000-0000-7000-8000-${String(index + 2).padStart(12, "0")}`;
    const revisionId = `00000000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`;
    return {
      id: itemId,
      workspaceId,
      kind: "file",
      name: `file-${index}.txt`,
      icon: null,
      lifecycle: "active",
      trashedAt: null,
      purgeAfter: null,
      currentRevisionId: revisionId,
      favourite: false,
      offlineIntent: false,
      pageDocument: null,
      file: {
        mediaType: "text/plain",
        originalName: `file-${index}.txt`,
        byteLength: file.byteLength,
        sha256: file.digest,
      },
      placements: [
        {
          id: `00000000-0000-7000-8000-${String(index + 300).padStart(12, "0")}`,
          workspaceId,
          itemId,
          itemIsFile: true,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: `V${index}`,
          removedAt: null,
        },
      ],
    };
  });
  canonical["revisions"] = files.map((_file, index) => {
    const itemId = `00000000-0000-7000-8000-${String(index + 2).padStart(12, "0")}`;
    const revisionId = `00000000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`;
    return {
      id: revisionId,
      itemId,
      mutationId: `00000000-0000-7000-8000-${String(index + 200).padStart(12, "0")}`,
      parentRevisionIds: [],
      acceptedAt: "2026-08-19T12:00:00.000Z",
    };
  });
  canonical["counts"] = {
    items: files.length,
    activeItems: files.length,
    trashedItems: 0,
    placements: files.length,
    relationships: 0,
    revisions: files.length,
    databases: 0,
    databaseEntries: 0,
  };
  return JSON.stringify(canonical);
}

function legacyEmptyCanonical(): string {
  const canonical = JSON.parse(emptyCanonical()) as Record<string, unknown>;
  const counts = canonical["counts"] as Record<string, unknown>;
  delete canonical["databases"];
  delete canonical["databaseEntries"];
  delete counts["databases"];
  delete counts["databaseEntries"];
  canonical["formatVersion"] = 1;
  return JSON.stringify(canonical);
}

function emptyInitializingOperationalState(): string {
  return JSON.stringify({
    format: "myownnotion.page-operations-backup",
    formatVersion: 1,
    pages: [
      {
        pageId: "00000000-0000-7000-8000-000000000002",
        status: "initializing",
        operationalFormat: "myownnotion.page-operations+loro",
        operationalVersion: 1,
        currentCheckpointId: null,
        currentFrontier: null,
        operationalDigest: null,
        canonicalDigest: "0".repeat(64),
        canonicalFormatVersion: 3,
        lastUpdateSequence: 0,
        lastRevisionId: null,
        revisionWindowStartedAt: null,
        revisionWindowLastUpdateAt: null,
        revisionWindowFrontier: null,
        bootstrappedAt: null,
        updatedAt: "2026-08-23T10:00:00.000Z",
        checkpoints: [],
        updates: [],
        deviceFrontiers: [],
        ambiguities: [],
        legacyBranchConversions: [],
      },
    ],
    counts: {
      pages: 1,
      checkpoints: 0,
      updates: 0,
      deviceFrontiers: 0,
      ambiguities: 0,
      legacyBranchConversions: 0,
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
    const canonical = canonicalWithFiles(
      [...files].map(([fileDigest, bytes]) => ({
        digest: fileDigest.slice("sha256:".length),
        byteLength: bytes.length,
      })),
    );
    const manifest = manifestFor(
      canonical,
      [...files].map(([digest, bytes]) => ({ digest, byteLength: bytes.length })),
      { itemCount: files.size },
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
    const canonical = canonicalWithFile(digest(bytes).slice("sha256:".length), bytes.length);
    const manifest = manifestFor(canonical, [{ digest: digest(bytes), byteLength: bytes.length }], {
      formatVersion: 2,
      itemCount: 1,
    });
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

  it("refuses undeclared operational state before emitting output", async () => {
    const canonical = emptyCanonical();
    const manifest = manifestFor(canonical, [], { formatVersion: 2 });
    const stream = streamBackupArchive({
      manifest,
      canonicalExport: canonical,
      operationalState: "{}",
      readFile: async function* () {},
    });
    await expect(stream.next()).rejects.toThrow(/operational page state/i);
  });

  it("refuses malformed operational state before emitting output", async () => {
    const canonical = emptyCanonical();
    const operationalState = "not-json";
    const manifest = manifestFor(canonical, [], {
      formatVersion: 2,
      operationalFormatVersion: 1,
      operationalStateDigest: digest(Buffer.from(operationalState)),
      operationalPageCount: 0,
      operationalCheckpointCount: 0,
      operationalUpdateCount: 0,
    });
    const stream = streamBackupArchive({
      manifest,
      canonicalExport: canonical,
      operationalState,
      readFile: async function* () {},
    });
    await expect(stream.next()).rejects.toThrow(/operational page state/i);
  });

  it("inspects an empty initializing operational state and rejects a bootstrapped one", async () => {
    const canonical = emptyCanonical();
    const operationalState = emptyInitializingOperationalState();
    const manifest = manifestFor(canonical, [], {
      formatVersion: 2,
      operationalFormatVersion: 1,
      operationalStateDigest: digest(Buffer.from(operationalState)),
      operationalPageCount: 1,
      operationalCheckpointCount: 0,
      operationalUpdateCount: 0,
    });
    const archive = await collect(
      streamBackupArchive({
        manifest,
        canonicalExport: canonical,
        operationalState,
        readFile: async function* () {},
      }),
    );
    expect(inspectBackupArchive(archive)).toMatchObject({ ok: true });

    const malformed = JSON.parse(operationalState) as {
      pages: Array<Record<string, unknown>>;
    };
    const malformedPage = malformed.pages[0];
    if (malformedPage === undefined) throw new Error("the operational fixture has no page");
    malformedPage["checkpoints"] = [{}];
    const malformedState = JSON.stringify(malformed);
    expect(
      inspectBackupArchive(
        encodeUncheckedBackupArchive({
          manifest: {
            ...manifest,
            operationalStateDigest: digest(Buffer.from(malformedState)),
            operationalCheckpointCount: 1,
          },
          canonicalExport: canonical,
          operationalState: malformedState,
          files: new Map(),
        }),
      ),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/operational page state/i) });
  });

  it("rejects U+0000 in operational text before production, inspection or target.begin", async () => {
    const canonical = emptyCanonical();
    const operationalObject = JSON.parse(emptyInitializingOperationalState()) as {
      pages: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    };
    const page = operationalObject.pages[0];
    if (page === undefined) throw new Error("the operational fixture has no page");
    page["ambiguities"] = [{ logicalKey: `bad${String.fromCharCode(0)}key` }];
    operationalObject.counts["ambiguities"] = 1;
    const operationalState = JSON.stringify(operationalObject);
    const manifest = manifestFor(canonical, [], {
      formatVersion: 2,
      operationalFormatVersion: 1,
      operationalStateDigest: digest(Buffer.from(operationalState)),
      operationalPageCount: 1,
      operationalCheckpointCount: 0,
      operationalUpdateCount: 0,
    });

    const stream = streamBackupArchive({
      manifest,
      canonicalExport: canonical,
      operationalState,
      readFile: async function* () {},
    });
    await expect(stream.next()).rejects.toThrow(/operational page state/i);

    const archive = encodeUncheckedBackupArchive({
      manifest,
      canonicalExport: canonical,
      operationalState,
      files: new Map(),
    });
    expect(inspectBackupArchive(archive)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/operational page state/i),
    });

    let began = false;
    await expect(
      applyArchive(archive, {
        begin: async () => {
          began = true;
        },
        writeFile: async () => {},
        writeItem: async () => {},
        writeRevision: async () => {},
        writeRelationship: async () => {},
      }),
    ).rejects.toThrow(/operational page state/i);
    expect(began).toBe(false);
  });

  it("refuses a malformed V1 canonical export before emitting output", async () => {
    const canonical = JSON.stringify({ items: [], relationships: [], revisions: [] });
    const stream = streamBackupArchive({
      manifest: manifestFor(canonical),
      canonicalExport: canonical,
      readFile: async function* () {},
    });
    await expect(stream.next()).rejects.toThrow(/canonical export/i);
  });

  it("round-trips the historical V1 canonical shape in a V1 archive", async () => {
    const canonical = legacyEmptyCanonical();
    const manifest = manifestFor(canonical);
    const archive = await collect(
      streamBackupArchive({
        manifest,
        canonicalExport: canonical,
        readFile: async function* () {},
      }),
    );
    expect(inspectBackupArchive(archive)).toMatchObject({ ok: true });
  });

  it("does not allow a V1 canonical export in a V2 archive", async () => {
    const canonical = legacyEmptyCanonical();
    const stream = streamBackupArchive({
      manifest: manifestFor(canonical, [], { formatVersion: 2 }),
      canonicalExport: canonical,
      readFile: async function* () {},
    });
    await expect(stream.next()).rejects.toThrow(/V2.*canonical/i);
  });

  it("refuses a canonical file inventory mismatch before emitting output", async () => {
    const bytes = Buffer.from("file payload");
    const canonical = canonicalWithFile(digest(bytes).slice("sha256:".length), bytes.length);
    const stream = streamBackupArchive({
      manifest: manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 }),
      canonicalExport: canonical,
      readFile: async function* () {
        yield bytes;
      },
    });
    await expect(stream.next()).rejects.toThrow(/file.*inventory|canonical.*file|manifest.*file/i);
  });

  it("refuses an unreferenced manifest file before emitting output", async () => {
    const bytes = Buffer.from("orphan file");
    const canonical = emptyCanonical();
    const stream = streamBackupArchive({
      manifest: manifestFor(canonical, [{ digest: digest(bytes), byteLength: bytes.length }], {
        formatVersion: 2,
      }),
      canonicalExport: canonical,
      readFile: async function* () {
        yield bytes;
      },
    });
    await expect(stream.next()).rejects.toThrow(/file.*inventory|canonical.*file|manifest.*file/i);
  });
});

describe("portable TAR framing", () => {
  const canonical = emptyCanonical();
  const archive = () =>
    encodeBackupArchive({
      manifest: manifestFor(canonical, [], { formatVersion: 2 }),
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
    ).toThrow(/manifest is not valid|valid creation date/);
    expect(() =>
      encodeBackupArchive({
        manifest: manifestFor(canonical),
        canonicalExport: canonical,
        files: new Map([["md5:not-a-digest", Buffer.from("x")]]),
      }),
    ).toThrow(/sha256 digest/);
  });

  it("rejects bad magic, USTAR version, checksum, entry type and numeric fields", () => {
    const badMagic = archive();
    badMagic.write("xxxxx", 257, "ascii");
    expect(() => decodeBackupArchive(badMagic)).toThrow(/portable tar/);

    const badVersion = archive();
    badVersion.write("99", 263, "ascii");
    checksumHeader(badVersion);
    expect(() => decodeBackupArchive(badVersion)).toThrow(/USTAR version/);

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

  it("rejects invalid UTF-8 instead of normalizing before digest verification", () => {
    const malformed = archive();
    const canonicalHeader = firstEntryEnd(malformed);
    const canonicalStart = canonicalHeader + BLOCK;
    const marker = Buffer.from("myownnotion");
    const markerOffset = malformed.indexOf(marker, canonicalStart);
    expect(markerOffset).toBeGreaterThanOrEqual(canonicalStart);
    malformed[markerOffset + 1] = 0xff;
    expect(() => decodeBackupArchive(malformed)).toThrow(/UTF-8|encoded data/i);
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

  it("validates a V2 canonical export before encoding its first entry", () => {
    const canonical = JSON.stringify({
      format: "myownnotion.export+json",
      formatVersion: 2,
      workspaceId: "00000000-0000-7000-8000-000000000001",
      schemaVersion: 1,
      exportedAt: "2026-08-19T12:00:00.000Z",
      changeCursor: "42",
      items: [{ id: "item", name: "�", pageDocument: null, file: null, placements: [] }],
      databases: [],
      databaseEntries: [],
      relationships: [],
      revisions: [],
      counts: {
        items: 1,
        activeItems: 1,
        trashedItems: 0,
        placements: 0,
        relationships: 0,
        revisions: 0,
        databases: 0,
        databaseEntries: 0,
      },
    });
    expect(() =>
      encodeBackupArchive({
        manifest: manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 }),
        canonicalExport: canonical,
        files: new Map(),
      }),
    ).toThrow(/reserved|replacement|canonical export/i);
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
      encodeUncheckedBackupArchive({
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
        manifest: manifestFor(
          canonical,
          [{ digest: expectedDigest, byteLength: expected.byteLength }],
          { itemCount: 1 },
        ),
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

  it("rejects U+0000 before production or target.begin", async () => {
    const canonicalObject = JSON.parse(canonicalWithFile("0".repeat(64), 0)) as Record<
      string,
      unknown
    >;
    const item = (canonicalObject["items"] as Array<Record<string, unknown>>)[0];
    if (item === undefined) throw new Error("fixture missing");
    item["name"] = "safe\u0000name";
    const canonical = JSON.stringify(canonicalObject);
    const manifest = manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 });

    expect(() =>
      encodeBackupArchive({ manifest, canonicalExport: canonical, files: new Map() }),
    ).toThrow(/U\+0000|NUL/i);
    const stream = streamBackupArchive({
      manifest,
      canonicalExport: canonical,
      readFile: async function* () {},
    });
    await expect(stream.next()).rejects.toThrow(/U\+0000|NUL/i);
    const archive = encodeUncheckedBackupArchive({
      manifest,
      canonicalExport: canonical,
      files: new Map(),
    });
    expect(inspectBackupArchive(archive)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/U\+0000|NUL/i),
    });

    let began = false;
    await expect(
      applyArchive(archive, {
        begin: async () => {
          began = true;
        },
        writeFile: async () => {},
        writeItem: async () => {},
        writeRevision: async () => {},
        writeRelationship: async () => {},
      }),
    ).rejects.toThrow(/U\+0000|NUL/i);
    expect(began).toBe(false);
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
    const propertyId = "00000000-0000-7000-8000-000000000016";
    const viewId = "00000000-0000-7000-8000-000000000017";
    const structured = {
      databases: [
        {
          databaseId,
          definitionVersion: 1,
          definition: {
            format: "myownnotion.database-definition+json",
            formatVersion: 1,
            databaseId,
            properties: [
              {
                id: propertyId,
                name: "Title",
                type: "title",
                positionKey: "a",
                state: "active",
                config: {},
              },
            ],
            views: [
              {
                id: viewId,
                name: "Table",
                type: "table",
                positionKey: "a",
                state: "active",
                properties: [{ propertyId, visible: true, positionKey: "a" }],
                filter: { mode: "all", criteria: [] },
                sorts: [],
                group: null,
                options: { density: "comfortable", freezeTitle: true },
              },
            ],
            taskRoles: null,
          },
        },
      ],
      databaseEntries: entryIds.map((entryId) => ({
        entryId,
        databaseId,
        valueVersion: 1,
        addedRevisionId: revisionIds[entryIds.indexOf(entryId) + 1],
        values: {
          format: "myownnotion.database-entry-values+json",
          formatVersion: 1,
          entryId,
          databaseId,
          values: {},
          preserved: [],
        },
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
        kind: "page",
        name: id,
        icon: null,
        lifecycle: "active",
        trashedAt: null,
        purgeAfter: null,
        currentRevisionId: revisionIds[index],
        favourite: false,
        offlineIntent: false,
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 1,
          body: {},
        },
        file: null,
        placements: [
          {
            id: `00000000-0000-7000-8000-${String(index + 200).padStart(12, "0")}`,
            workspaceId: "00000000-0000-7000-8000-000000000009",
            itemId: id,
            itemIsFile: false,
            kind: "hierarchy",
            parentItemId: index === 0 ? null : databaseId,
            positionKey: `V${index}`,
            removedAt: null,
          },
        ],
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
        placements: 3,
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

  it("rejects structured versions below the SQL minimum before target.begin", async () => {
    const databaseId = "00000000-0000-7000-8000-000000000010";
    const entryId = "00000000-0000-7000-8000-000000000011";
    const revisionIds = [
      "00000000-0000-7000-8000-000000000013",
      "00000000-0000-7000-8000-000000000014",
    ];
    const propertyId = "00000000-0000-7000-8000-000000000016";
    const viewId = "00000000-0000-7000-8000-000000000017";
    const canonicalObject = JSON.parse(
      JSON.stringify({
        format: "myownnotion.export+json",
        formatVersion: 2,
        workspaceId: "00000000-0000-7000-8000-000000000009",
        schemaVersion: 1,
        exportedAt: "2026-08-19T12:00:00.000Z",
        changeCursor: "42",
        items: [databaseId, entryId].map((id, index) => ({
          id,
          workspaceId: "00000000-0000-7000-8000-000000000009",
          kind: "page",
          name: id,
          icon: null,
          lifecycle: "active",
          trashedAt: null,
          purgeAfter: null,
          currentRevisionId: revisionIds[index],
          favourite: false,
          offlineIntent: false,
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: {},
          },
          file: null,
          placements: [
            {
              id: `00000000-0000-7000-8000-${String(index + 200).padStart(12, "0")}`,
              workspaceId: "00000000-0000-7000-8000-000000000009",
              itemId: id,
              itemIsFile: false,
              kind: "hierarchy",
              parentItemId: index === 0 ? null : databaseId,
              positionKey: `V${index}`,
              removedAt: null,
            },
          ],
        })),
        databases: [
          {
            databaseId,
            definitionVersion: 0,
            definition: {
              format: "myownnotion.database-definition+json",
              formatVersion: 1,
              databaseId,
              properties: [
                {
                  id: propertyId,
                  name: "Title",
                  type: "title",
                  positionKey: "a",
                  state: "active",
                  config: {},
                },
              ],
              views: [
                {
                  id: viewId,
                  name: "Table",
                  type: "table",
                  positionKey: "a",
                  state: "active",
                  properties: [{ propertyId, visible: true, positionKey: "a" }],
                  filter: { mode: "all", criteria: [] },
                  sorts: [],
                  group: null,
                  options: { density: "comfortable", freezeTitle: true },
                },
              ],
              taskRoles: null,
            },
          },
        ],
        databaseEntries: [
          {
            entryId,
            databaseId,
            valueVersion: 0,
            addedRevisionId: revisionIds[1],
            values: {
              format: "myownnotion.database-entry-values+json",
              formatVersion: 1,
              entryId,
              databaseId,
              values: {},
              preserved: [],
            },
          },
        ],
        relationships: [],
        revisions: revisionIds.map((id, index) => ({
          id,
          itemId: [databaseId, entryId][index],
          mutationId: id,
          parentRevisionIds: [],
          acceptedAt: "2026-08-19T12:00:00.000Z",
        })),
        counts: {
          items: 2,
          activeItems: 2,
          trashedItems: 0,
          placements: 2,
          relationships: 0,
          revisions: 2,
          databases: 1,
          databaseEntries: 1,
        },
      }),
    ) as Record<string, unknown>;
    const canonical = JSON.stringify(canonicalObject);
    const structuredDataDigest = digest(
      Buffer.from(
        canonicalStructuredDataString({
          databases: canonicalObject["databases"] as never[],
          databaseEntries: canonicalObject["databaseEntries"] as never[],
        }),
      ),
    );
    const manifest = manifestFor(canonical, [], {
      formatVersion: 2,
      itemCount: 2,
      databaseCount: 1,
      databaseEntryCount: 1,
      structuredDataDigest,
    });
    expect(() =>
      encodeBackupArchive({ manifest, canonicalExport: canonical, files: new Map() }),
    ).toThrow(/canonical export|version/i);
    const archive = encodeUncheckedBackupArchive({
      manifest,
      canonicalExport: canonical,
      files: new Map(),
    });
    expect(inspectBackupArchive(archive)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/canonical export|version/i),
    });
    let began = false;
    await expect(
      applyArchive(archive, {
        begin: async () => {
          began = true;
        },
        writeFile: async () => {},
        writeItem: async () => {},
        writeRevision: async () => {},
        writeRelationship: async () => {},
        writeDatabase: async () => {},
        writeDatabaseEntry: async () => {},
      }),
    ).rejects.toThrow(/canonical export|version/i);
    expect(began).toBe(false);
  });

  it("checks every file against its recorded size and digest", () => {
    const expected = Buffer.from("expected");
    const expectedDigest = digest(expected);
    const canonical = canonicalWithFile(
      expectedDigest.slice("sha256:".length),
      expected.byteLength,
    );
    expect(
      inspect({
        canonical,
        manifest: manifestFor(
          canonical,
          [{ digest: expectedDigest, byteLength: expected.byteLength }],
          { itemCount: 1 },
        ),
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

  it("rejects a canonical file inventory mismatch during inspection", () => {
    const bytes = Buffer.from("file payload");
    const canonical = canonicalWithFile(digest(bytes).slice("sha256:".length), bytes.length);
    expect(
      inspect({
        canonical,
        manifest: manifestFor(canonical, [], { formatVersion: 2, itemCount: 1 }),
      }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/file.*inventory|canonical.*file|manifest.*file/i),
    });
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
          placements: [
            {
              id: "00000000-0000-7000-8000-000000000004",
              workspaceId,
              itemId,
              itemIsFile: false,
              kind: "hierarchy",
              parentItemId: null,
              positionKey: "V",
              removedAt: null,
            },
          ],
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
        placements: 1,
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
