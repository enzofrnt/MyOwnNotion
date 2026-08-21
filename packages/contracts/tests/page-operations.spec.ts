import {
  MAX_PAGE_UPDATE_BATCH_BYTES,
  MAX_PAGE_UPDATES_PER_SYNC,
  PAGE_OPERATION_PROBLEM_CODES,
  PAGE_OPERATION_PROTOCOL_VERSION,
  PAGE_OPERATIONAL_VERSION,
  PageOperationContractError,
  parseActivatePageRequest,
  parsePageOperationProblem,
  parsePageSyncRequest,
  parsePageSyncResponse,
  parseResolvePageAmbiguityRequest,
} from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const instant = "2026-08-20T12:00:00.000Z";
const digest = "a".repeat(64);

function bytes(byteLength: number, fill = 1): string {
  return Buffer.alloc(byteLength, fill).toString("base64url");
}

function update(overrides: Record<string, unknown> = {}) {
  return {
    updateId: generateUuidV7(),
    baseVersionVector: bytes(8),
    updateBytes: bytes(32),
    updateDigest: digest,
    createdAt: instant,
    ...overrides,
  };
}

function activeRequest(overrides: Record<string, unknown> = {}) {
  return {
    mode: "active",
    requestId: generateUuidV7(),
    operationalVersion: PAGE_OPERATIONAL_VERSION,
    persistedVersionVector: bytes(8),
    knownServerPageSequence: 4,
    updates: [update()],
    maxRemoteBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
    ...overrides,
  };
}

function remoteUpdate(overrides: Record<string, unknown> = {}) {
  return {
    updateId: generateUuidV7(),
    pageSequence: 5,
    authoredByDeviceId: generateUuidV7(),
    updateBytes: bytes(32),
    updateDigest: digest,
    acceptedAt: instant,
    ...overrides,
  };
}

function checkpointResponse(overrides: Record<string, unknown> = {}) {
  return {
    mode: "checkpoint",
    requestId: generateUuidV7(),
    pageId: generateUuidV7(),
    operationalVersion: PAGE_OPERATIONAL_VERSION,
    checkpointId: generateUuidV7(),
    checkpointBytes: bytes(128),
    checkpointDigest: digest,
    versionVector: bytes(8),
    throughPageSequence: 4,
    canonicalDigest: digest,
    lastConsolidatedRevisionId: null,
    hasUnconsolidatedChanges: false,
    followingUpdates: [remoteUpdate()],
    latestPageSequence: 5,
    hasMore: false,
    ambiguities: [],
    ...overrides,
  };
}

describe("protocol-v3 page sync requests", () => {
  it("accepts active, empty and bounded legacy-branch requests", () => {
    const tableId = generateUuidV7();
    const rowId = generateUuidV7();
    const columnId = generateUuidV7();
    expect(parsePageSyncRequest(activeRequest()).mode).toBe("active");
    expect(
      parsePageSyncRequest({
        mode: "empty",
        requestId: generateUuidV7(),
        knownServerPageSequence: 0,
        maxRemoteBytes: 1024,
      }).mode,
    ).toBe("empty");
    expect(
      parsePageSyncRequest({
        mode: "legacy-branch",
        requestId: generateUuidV7(),
        branchId: generateUuidV7(),
        baseRevisionId: generateUuidV7(),
        baseCanonicalDigest: digest,
        baseDocument: {
          format: "myownnotion.document+json",
          formatVersion: 2,
          body: { blocks: [] },
        },
        localDocument: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: { blocks: [] },
        },
        localDocumentDigest: digest,
        semanticTransactions: [
          {
            transactionId: generateUuidV7(),
            sequence: 1,
            commands: [
              { type: "delete-block", blockId: generateUuidV7() },
              {
                type: "set-type-or-property",
                blockId: generateUuidV7(),
                key: "type",
                before: "paragraph",
                after: "heading",
                properties: { level: 2 },
              },
              {
                type: "insert-table-row",
                tableId,
                row: {
                  id: rowId,
                  cells: [{ id: generateUuidV7(), content: [{ text: "A1" }] }],
                },
                beforeRowId: null,
              },
              { type: "delete-table-row", tableId, rowId },
              {
                type: "insert-table-column",
                tableId,
                column: { id: columnId, width: 180 },
                cells: [
                  {
                    rowId,
                    cell: { id: generateUuidV7(), content: [{ text: "B1" }] },
                  },
                ],
                beforeColumnId: null,
              },
              { type: "delete-table-column", tableId, columnId },
            ],
          },
        ],
        createdAt: instant,
      }).mode,
    ).toBe("legacy-branch");
  });

  it("rejects more than 64 updates and duplicate stable update ids", () => {
    expect(() =>
      parsePageSyncRequest(
        activeRequest({
          updates: Array.from({ length: MAX_PAGE_UPDATES_PER_SYNC + 1 }, () => update()),
        }),
      ),
    ).toThrow(PageOperationContractError);

    const duplicated = update();
    expect(() =>
      parsePageSyncRequest(activeRequest({ updates: [duplicated, duplicated] })),
    ).toThrow("page update ids");
  });

  it("bounds the aggregate decoded update bytes, not merely the JSON field count", () => {
    const chunkBytes = Math.floor(MAX_PAGE_UPDATE_BATCH_BYTES / MAX_PAGE_UPDATES_PER_SYNC) + 1;
    const updates = Array.from({ length: MAX_PAGE_UPDATES_PER_SYNC }, (_, index) =>
      update({ updateBytes: bytes(chunkBytes, (index % 250) + 1) }),
    );
    expect(() => parsePageSyncRequest(activeRequest({ updates }))).toThrow(
      "page update batch bytes",
    );
  });

  it("rejects padded or non-canonical base64url and unknown private fields", () => {
    expect(() => parsePageSyncRequest(activeRequest({ persistedVersionVector: "AQ==" }))).toThrow(
      PageOperationContractError,
    );
    expect(() => parsePageSyncRequest(activeRequest({ persistedVersionVector: "AB" }))).toThrow(
      PageOperationContractError,
    );

    let caught: unknown;
    try {
      parsePageSyncRequest(activeRequest({ privateDraft: "do-not-repeat-this-draft" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PageOperationContractError);
    expect(String(caught)).not.toContain("do-not-repeat-this-draft");
  });

  it("requires contiguous semantic transaction sequences", () => {
    expect(() =>
      parsePageSyncRequest({
        mode: "legacy-branch",
        requestId: generateUuidV7(),
        branchId: generateUuidV7(),
        baseRevisionId: generateUuidV7(),
        baseCanonicalDigest: digest,
        localDocument: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: { blocks: [] },
        },
        localDocumentDigest: digest,
        semanticTransactions: [{ transactionId: generateUuidV7(), sequence: 2, commands: [] }],
        createdAt: instant,
      }),
    ).toThrow("legacy transaction sequence");
  });
});

describe("protocol-v3 page sync responses", () => {
  it("accepts active responses and bounded checkpoints", () => {
    const requestId = generateUuidV7();
    const pageId = generateUuidV7();
    expect(
      parsePageSyncResponse({
        mode: "active",
        requestId,
        pageId,
        accepted: [
          {
            updateId: generateUuidV7(),
            pageSequence: 5,
            resultVersionVector: bytes(8),
          },
        ],
        repeated: [],
        remoteUpdates: [remoteUpdate()],
        serverVersionVector: bytes(8),
        throughPageSequence: 5,
        latestPageSequence: 5,
        hasMore: false,
        canonical: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          digest,
          lastConsolidatedRevisionId: null,
          hasUnconsolidatedChanges: true,
        },
        ambiguities: [],
        fileRequirements: [],
      }).mode,
    ).toBe("active");
    expect(parsePageSyncResponse(checkpointResponse()).mode).toBe("checkpoint");
  });

  it("accepts the idempotent legacy conversion response without weakening checkpoint fields", () => {
    const convertedBranchId = generateUuidV7();
    const parsed = parsePageSyncResponse(
      checkpointResponse({
        convertedBranchId,
        conversionUpdateIds: [generateUuidV7()],
        localDocumentDigest: digest,
      }),
    );
    expect("convertedBranchId" in parsed && parsed.convertedBranchId).toBe(convertedBranchId);
  });

  it("rejects malformed checkpoint and oversized remote batches", () => {
    expect(() => parsePageSyncResponse(checkpointResponse({ checkpointBytes: "A" }))).toThrow(
      PageOperationContractError,
    );
    const chunkBytes = Math.floor(MAX_PAGE_UPDATE_BATCH_BYTES / MAX_PAGE_UPDATES_PER_SYNC) + 1;
    const remoteUpdates = Array.from({ length: MAX_PAGE_UPDATES_PER_SYNC }, (_, index) =>
      remoteUpdate({
        pageSequence: index + 1,
        updateBytes: bytes(chunkBytes, (index % 250) + 1),
      }),
    );
    expect(() =>
      parsePageSyncResponse({
        mode: "active",
        requestId: generateUuidV7(),
        pageId: generateUuidV7(),
        accepted: [],
        repeated: [],
        remoteUpdates,
        serverVersionVector: bytes(8),
        throughPageSequence: 64,
        latestPageSequence: 64,
        hasMore: false,
        canonical: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          digest,
          lastConsolidatedRevisionId: null,
          hasUnconsolidatedChanges: true,
        },
        ambiguities: [],
        fileRequirements: [],
      }),
    ).toThrow("remote page update batch bytes");
  });
});

describe("activation, ambiguity resolution and stable problems", () => {
  it("parses activation and every resolution decision without extra fields", () => {
    expect(
      parseActivatePageRequest({
        requestId: generateUuidV7(),
        expectedRevisionId: generateUuidV7(),
        expectedCanonicalDigest: digest,
      }).expectedCanonicalDigest,
    ).toBe(digest);
    expect(
      parseResolvePageAmbiguityRequest({
        requestId: generateUuidV7(),
        decision: "restore-change",
        parentBlockId: null,
        beforeBlockId: null,
      }).decision,
    ).toBe("restore-change");
    expect(() =>
      parseResolvePageAmbiguityRequest({
        requestId: generateUuidV7(),
        decision: "confirm-delete",
        result: { secret: "unexpected" },
      }),
    ).toThrow(PageOperationContractError);
  });

  it("pins the protocol and the documented stable problem vocabulary", () => {
    expect(PAGE_OPERATION_PROTOCOL_VERSION).toBe(3);
    expect(PAGE_OPERATION_PROBLEM_CODES).toHaveLength(10);
    for (const code of PAGE_OPERATION_PROBLEM_CODES) {
      expect(parsePageOperationProblem({ code, message: "Action requise" }).code).toBe(code);
    }
    expect(
      parsePageOperationProblem({
        code: "page-operations.protocol-read-only",
        message: "Mettez à jour cet appareil.",
        requiredProtocol: 3,
        readAllowed: true,
      }).readAllowed,
    ).toBe(true);
  });
});
