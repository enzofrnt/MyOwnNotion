/** Structural and semantic validation for portable operational backups (T147, US5). */

import type { Transaction } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import {
  OPERATIONAL_FORMAT,
  OPERATIONAL_FORMAT_VERSION,
  OperationalPageDocument,
  sha256Hex,
} from "@myownnotion/page-state";
import { describe, expect, it, vi } from "vitest";
import {
  type ArchivedPageOperationState,
  PAGE_OPERATION_ARCHIVE_FORMAT,
  PAGE_OPERATION_ARCHIVE_VERSION,
  type PageOperationArchive,
  PageOperationArchiveService,
  pageOperationArchiveDeviceReferences,
  pageOperationArchiveString,
  readPageOperationArchive,
} from "../src/backup/page-operation-archive.ts";

const EMPTY_COUNTS = {
  pages: 0,
  checkpoints: 0,
  updates: 0,
  deviceFrontiers: 0,
  ambiguities: 0,
  legacyBranchConversions: 0,
} as const;

const EMPTY_ARCHIVE: PageOperationArchive = {
  format: PAGE_OPERATION_ARCHIVE_FORMAT,
  formatVersion: PAGE_OPERATION_ARCHIVE_VERSION,
  pages: [],
  counts: EMPTY_COUNTS,
};

function minimalPage(pageId = generateUuidV7()) {
  return {
    pageId,
    status: "legacy",
    operationalFormat: OPERATIONAL_FORMAT,
    operationalVersion: OPERATIONAL_FORMAT_VERSION,
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
  };
}

function recordsIn(page: Record<string, unknown>, key: string): number {
  const records = page[key];
  return Array.isArray(records) ? records.length : 0;
}

function rawArchive(pages: readonly Record<string, unknown>[]) {
  return {
    format: PAGE_OPERATION_ARCHIVE_FORMAT,
    formatVersion: PAGE_OPERATION_ARCHIVE_VERSION,
    pages,
    counts: {
      pages: pages.length,
      checkpoints: pages.reduce((sum, page) => sum + recordsIn(page, "checkpoints"), 0),
      updates: pages.reduce((sum, page) => sum + recordsIn(page, "updates"), 0),
      deviceFrontiers: pages.reduce((sum, page) => sum + recordsIn(page, "deviceFrontiers"), 0),
      ambiguities: pages.reduce((sum, page) => sum + recordsIn(page, "ambiguities"), 0),
      legacyBranchConversions: pages.reduce(
        (sum, page) => sum + recordsIn(page, "legacyBranchConversions"),
        0,
      ),
    },
  };
}

function encoded(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function service(workspaceId = generateUuidV7()): PageOperationArchiveService {
  return new PageOperationArchiveService({ workspaceId, crypto: {} as never });
}

function withPage(
  archive: PageOperationArchive,
  changes: Partial<ArchivedPageOperationState>,
): PageOperationArchive {
  const page = archive.pages[0];
  if (page === undefined) throw new Error("the test archive has no page");
  return { ...archive, pages: [{ ...page, ...changes }] };
}

async function validArchive(input: { readonly withUpdate?: boolean } = {}): Promise<{
  readonly archive: PageOperationArchive;
  readonly canonicalExport: unknown;
}> {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const owner = OperationalPageDocument.create({
    pageId,
    document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "before" }] }] },
  });
  const checkpoint = await owner.checkpoint();
  const checkpointProjection = await owner.project();
  const checkpointId = generateUuidV7();
  const updateId = generateUuidV7();
  const deviceId = generateUuidV7();
  let head = owner;
  let updates: ArchivedPageOperationState["updates"] = [];

  if (input.withUpdate === true) {
    head = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const transaction = head.transact([
      { type: "replace-text", blockId, from: 6, to: 6, text: " after" },
    ]);
    updates = [
      {
        id: updateId,
        pageSequence: 1,
        authoredByDeviceId: deviceId,
        baseFrontier: {
          versionVector: encoded(transaction.baseVersionVector),
          frontiers: encoded(checkpoint.frontiers),
        },
        resultFrontier: {
          versionVector: encoded(transaction.resultVersionVector),
          frontiers: encoded(transaction.resultFrontiers),
        },
        updateBytes: encoded(transaction.updateBytes),
        updateDigest: await sha256Hex(transaction.updateBytes),
        status: "accepted",
        failureCode: null,
        acceptedAt: "2026-08-23T10:00:01.000Z",
        compactedAt: null,
      },
    ];
  }

  const projection = await head.project();
  const headVersion = head.versionVectorBytes();
  const page: ArchivedPageOperationState = {
    pageId,
    status: "active",
    operationalFormat: OPERATIONAL_FORMAT,
    operationalVersion: OPERATIONAL_FORMAT_VERSION,
    currentCheckpointId: checkpointId,
    currentFrontier: {
      versionVector: encoded(headVersion),
      frontiers: encoded(head.frontiersForVersionVector(headVersion)),
    },
    operationalDigest: projection.operationalDigest,
    canonicalDigest: projection.canonicalDigest,
    canonicalFormatVersion: 3,
    lastUpdateSequence: updates.length,
    lastRevisionId: generateUuidV7(),
    revisionWindowStartedAt: null,
    revisionWindowLastUpdateAt: null,
    revisionWindowFrontier: null,
    bootstrappedAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:01.000Z",
    checkpoints: [
      {
        id: checkpointId,
        throughPageSequence: 0,
        frontier: {
          versionVector: encoded(checkpoint.versionVector),
          frontiers: encoded(checkpoint.frontiers),
        },
        snapshotBytes: encoded(checkpoint.bytes),
        snapshotDigest: checkpoint.digest,
        canonicalDigest: checkpointProjection.canonicalDigest,
        revisionId: generateUuidV7(),
        state: "verified",
        createdAt: "2026-08-23T10:00:00.000Z",
        verifiedAt: "2026-08-23T10:00:00.500Z",
      },
    ],
    updates,
    deviceFrontiers: [],
    ambiguities: [],
    legacyBranchConversions: [],
  };
  return {
    archive: {
      format: PAGE_OPERATION_ARCHIVE_FORMAT,
      formatVersion: PAGE_OPERATION_ARCHIVE_VERSION,
      pages: [page],
      counts: {
        ...EMPTY_COUNTS,
        pages: 1,
        checkpoints: 1,
        updates: updates.length,
      },
    },
    canonicalExport: {
      items: [{ id: pageId, pageDocument: { formatVersion: 3, body: projection.document } }],
    },
  };
}

describe("operational archive envelope", () => {
  it("rejects malformed, miscounted and duplicate records", () => {
    expect(() => readPageOperationArchive(null)).toThrow("not an object");
    expect(() => readPageOperationArchive({})).toThrow("unsupported envelope");
    expect(() => readPageOperationArchive(rawArchive([{}]))).toThrow("invalid shape");
    expect(() =>
      readPageOperationArchive({ ...EMPTY_ARCHIVE, counts: { ...EMPTY_COUNTS, pages: 1 } }),
    ).toThrow("counts do not match");

    const duplicatePage = minimalPage();
    expect(() => readPageOperationArchive(rawArchive([duplicatePage, duplicatePage]))).toThrow(
      "duplicate page",
    );
    expect(() =>
      readPageOperationArchive(rawArchive([{ ...minimalPage(), checkpoints: [null] }])),
    ).toThrow("invalid checkpoint");
    const checkpointId = generateUuidV7();
    expect(() =>
      readPageOperationArchive(
        rawArchive([
          { ...minimalPage(), checkpoints: [{ id: checkpointId }, { id: checkpointId }] },
        ]),
      ),
    ).toThrow("duplicate checkpoint");
    expect(() =>
      readPageOperationArchive(rawArchive([{ ...minimalPage(), updates: [null] }])),
    ).toThrow("invalid update");
    const updateId = generateUuidV7();
    expect(() =>
      readPageOperationArchive(
        rawArchive([{ ...minimalPage(), updates: [{ id: updateId }, { id: updateId }] }]),
      ),
    ).toThrow("duplicate update");
  });

  it("serializes deterministically and rejects non-JSON values", () => {
    expect(pageOperationArchiveString(EMPTY_ARCHIVE)).toBe(
      '{"counts":{"ambiguities":0,"checkpoints":0,"deviceFrontiers":0,"legacyBranchConversions":0,"pages":0,"updates":0},"format":"myownnotion.page-operations-backup","formatVersion":1,"pages":[]}',
    );
    expect(() =>
      pageOperationArchiveString({
        ...EMPTY_ARCHIVE,
        unsupported: undefined,
      } as unknown as PageOperationArchive),
    ).toThrow("not serializable");
  });

  it("deduplicates device references and lets an explicit revoked frontier win", () => {
    const activeId = generateUuidV7();
    const revokedId = generateUuidV7();
    const archive = {
      ...EMPTY_ARCHIVE,
      pages: [
        {
          ...minimalPage(),
          updates: [{ authoredByDeviceId: activeId }, { authoredByDeviceId: revokedId }],
          deviceFrontiers: [
            { deviceId: activeId, deviceState: "authorized" },
            { deviceId: revokedId, deviceState: "revoked" },
          ],
        },
      ],
    } as unknown as PageOperationArchive;

    expect(pageOperationArchiveDeviceReferences(archive)).toEqual(
      [
        { id: activeId, state: "active" },
        { id: revokedId, state: "revoked" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });
});

describe("operational archive verification", () => {
  it("handles absent and partially installed operational schemas conservatively", async () => {
    const absentTx = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Transaction;
    await expect(service().export(absentTx)).resolves.toEqual({
      archive: EMPTY_ARCHIVE,
      coverage: [],
    });

    const partialTx = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          {
            states: true,
            updates: false,
            checkpoints: false,
            frontiers: false,
            ambiguities: false,
            conversions: false,
          },
        ],
      }),
    } as unknown as Transaction;
    await expect(service().export(partialTx)).rejects.toThrow("partially installed");
  });

  it("rejects broken checkpoint, frontier, ambiguity and sequence evidence", async () => {
    const { archive } = await validArchive();
    const verifier = service();
    const page = archive.pages[0];
    const checkpoint = page?.checkpoints[0];
    if (page === undefined || checkpoint === undefined) throw new Error("invalid test fixture");

    await expect(verifier.verify(withPage(archive, { currentCheckpointId: null }))).rejects.toThrow(
      "non-legacy",
    );
    await expect(
      verifier.verify(withPage(archive, { currentCheckpointId: generateUuidV7() })),
    ).rejects.toThrow("no current checkpoint");
    await expect(verifier.verify(withPage(archive, { currentFrontier: null }))).rejects.toThrow(
      "no current checkpoint",
    );
    await expect(
      verifier.verify(
        withPage(archive, {
          checkpoints: [{ ...checkpoint, canonicalDigest: "0".repeat(64) }],
        }),
      ),
    ).rejects.toThrow("checkpoint does not reproduce");
    await expect(verifier.verify(withPage(archive, { lastUpdateSequence: 1 }))).rejects.toThrow(
      "non-contiguous",
    );

    const frontierBytes = Buffer.from("frontier");
    await expect(
      verifier.verify(
        withPage(archive, {
          deviceFrontiers: [
            {
              deviceId: generateUuidV7(),
              frontier: { versionVector: encoded(frontierBytes), frontiers: "" },
              frontierDigest: "0".repeat(64),
              confirmedPageSequence: 0,
              recordVersion: 1,
              lastConfirmedAt: "2026-08-23T10:00:00.000Z",
              deviceState: "authorized",
            },
          ],
        }),
      ),
    ).rejects.toThrow("device frontier");
    await expect(
      verifier.verify(
        withPage(archive, {
          ambiguities: [
            {
              id: generateUuidV7(),
              logicalKey: "missing-update",
              kind: "delete-edit",
              status: "open",
              detailsBytes: "",
              sourceUpdateIds: [generateUuidV7()],
              openedAt: "2026-08-23T10:00:00.000Z",
              resolvedAt: null,
              resolutionRevisionId: null,
            },
          ],
        }),
      ),
    ).rejects.toThrow("ambiguity names an update absent");
  });

  it("replays retained updates and rejects missing, corrupt or causally inconsistent bytes", async () => {
    const { archive } = await validArchive({ withUpdate: true });
    const verifier = service();
    const page = archive.pages[0];
    const update = page?.updates[0];
    if (page === undefined || update === undefined) throw new Error("invalid update fixture");

    await expect(verifier.verify(archive)).resolves.toBeUndefined();
    await expect(
      verifier.verify(withPage(archive, { updates: [{ ...update, updateBytes: null }] })),
    ).rejects.toThrow("has no bytes");
    await expect(
      verifier.verify(
        withPage(archive, {
          updates: [{ ...update, updateBytes: encoded(Buffer.from("corrupt")) }],
        }),
      ),
    ).rejects.toThrow("does not match its digest");
    await expect(
      verifier.verify(
        withPage(archive, {
          updates: [
            {
              ...update,
              resultFrontier: {
                ...update.resultFrontier,
                versionVector: update.baseFrontier?.versionVector ?? "",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("cannot be reconstructed");
  });

  it("cross-checks the operational head against the canonical export", async () => {
    const { archive, canonicalExport } = await validArchive();
    const verifier = service();
    const page = archive.pages[0];
    if (page === undefined) throw new Error("invalid canonical fixture");

    await expect(verifier.verify(archive)).resolves.toBeUndefined();
    await expect(verifier.verify(archive, canonicalExport)).resolves.toBeUndefined();
    await expect(verifier.verify(archive, { items: [] })).rejects.toThrow(
      "missing from the canonical export",
    );
    await expect(
      verifier.verify(archive, {
        items: [
          {
            id: page.pageId,
            pageDocument: { formatVersion: 3, body: { blocks: [] } },
          },
        ],
      }),
    ).rejects.toThrow("canonical export and operational backup disagree");

    const legacy = withPage(archive, {
      status: "legacy",
      currentCheckpointId: null,
      currentFrontier: null,
      checkpoints: [],
    });
    await expect(verifier.verify(legacy)).resolves.toBeUndefined();
  });

  it("refuses retention evidence belonging to another workspace without querying", async () => {
    const workspaceId = generateUuidV7();
    const tx = {} as Transaction;
    await expect(
      service(workspaceId).checkpointIsInVerifiedBackup(tx, {
        workspaceId: generateUuidV7(),
        pageId: generateUuidV7(),
        checkpointId: generateUuidV7(),
        throughPageSequence: 1,
        snapshotDigest: "a".repeat(64),
        canonicalDigest: "b".repeat(64),
      }),
    ).resolves.toBe(false);
  });
});
