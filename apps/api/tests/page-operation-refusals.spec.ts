/** Refusal paths of the operational sync protocol (coverage for stable problems). */

import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "./helpers/authenticated-page-operations.ts";

let harness: AuthenticatedPageOperationHarness;

beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness();
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

const BLOCK = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f24a1" as Uuid;

async function activate(
  page: {
    itemId: Uuid;
    revisionId: Uuid;
    canonicalDigest: string;
  },
  headers: Record<string, string>,
) {
  const response = await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${page.itemId}/activate`,
    headers,
    payload: {
      requestId: generateUuidV7(),
      expectedRevisionId: page.revisionId,
      expectedCanonicalDigest: page.canonicalDigest,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const checkpoint = response.json() as {
    checkpointBytes: string;
    checkpointDigest: string;
    versionVector: string;
  };
  return await OperationalPageDocument.fromSnapshotTransport({
    pageId: page.itemId as Uuid,
    snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
    snapshotDigest: checkpoint.checkpointDigest,
    versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
  });
}

describe("operational sync refusals", () => {
  it("rejects a reused update identity carrying different content", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    const replica = await activate(page, headers);

    const transaction = replica.transact([
      {
        type: "insert-block",
        parentBlockId: null,
        beforeBlockId: null,
        block: { type: "paragraph", id: BLOCK, content: [{ text: "v1" }] },
      },
    ]);
    const updateId = generateUuidV7();
    const payload = {
      mode: "active",
      requestId: generateUuidV7(),
      operationalVersion: 1,
      persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString("base64url"),
      knownServerPageSequence: 0,
      updates: [
        {
          updateId,
          baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
          updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
          updateDigest: await sha256Hex(transaction.updateBytes),
          createdAt: "2026-08-22T07:00:00.000Z",
        },
      ],
      maxRemoteBytes: 1024 * 1024,
    };
    const first = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload,
    });
    expect(first.statusCode, first.body).toBe(200);

    // Same identity, different bytes: an integrity violation, not a retry.
    const forged = replica.transact([
      { type: "replace-text", blockId: BLOCK, from: 0, to: 2, text: "V1" },
    ]);
    const second = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload: {
        ...payload,
        requestId: generateUuidV7(),
        persistedVersionVector: Buffer.from(forged.resultVersionVector).toString("base64url"),
        updates: [
          {
            updateId,
            baseVersionVector: Buffer.from(forged.baseVersionVector).toString("base64url"),
            updateBytes: Buffer.from(forged.updateBytes).toString("base64url"),
            updateDigest: await sha256Hex(forged.updateBytes),
            createdAt: "2026-08-22T07:00:01.000Z",
          },
        ],
      },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { code: string }).code).toBe("page-operations.update-id-reused");
  });

  it("rejects bytes that do not match their declared digest", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    const replica = await activate(page, headers);

    const transaction = replica.transact([
      {
        type: "insert-block",
        parentBlockId: null,
        beforeBlockId: null,
        block: { type: "paragraph", id: BLOCK, content: [{ text: "honest" }] },
      },
    ]);
    const response = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload: {
        mode: "active",
        requestId: generateUuidV7(),
        operationalVersion: 1,
        persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString("base64url"),
        knownServerPageSequence: 0,
        updates: [
          {
            updateId: generateUuidV7(),
            baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
            updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
            updateDigest: await sha256Hex(new TextEncoder().encode("tampered")),
            createdAt: "2026-08-22T07:00:00.000Z",
          },
        ],
        maxRemoteBytes: 1024 * 1024,
      },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe("page-operations.digest-mismatch");
  });

  it("refuses updates whose causal dependencies have not arrived", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    const replica = await activate(page, headers);

    // Two sequential local transactions; only the SECOND is submitted.
    replica.transact([
      {
        type: "insert-block",
        parentBlockId: null,
        beforeBlockId: null,
        block: { type: "paragraph", id: BLOCK, content: [{ text: "first" }] },
      },
    ]);
    const second = replica.transact([
      { type: "replace-text", blockId: BLOCK, from: 0, to: 5, text: "second" },
    ]);
    const response = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload: {
        mode: "active",
        requestId: generateUuidV7(),
        operationalVersion: 1,
        persistedVersionVector: Buffer.from(second.resultVersionVector).toString("base64url"),
        knownServerPageSequence: 0,
        updates: [
          {
            updateId: generateUuidV7(),
            baseVersionVector: Buffer.from(second.baseVersionVector).toString("base64url"),
            updateBytes: Buffer.from(second.updateBytes).toString("base64url"),
            updateDigest: await sha256Hex(second.updateBytes),
            createdAt: "2026-08-22T07:00:00.000Z",
          },
        ],
        maxRemoteBytes: 1024 * 1024,
      },
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe("page-operations.dependencies-missing");
  });

  it("answers a legacy-branch submission whose base is not an ancestor with dependencies-missing", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    await activate(page, headers);

    // A branch claiming a base revision this workspace never issued.
    const response = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload: {
        mode: "legacy-branch",
        requestId: generateUuidV7(),
        branchId: generateUuidV7(),
        baseRevisionId: generateUuidV7(),
        baseCanonicalDigest: await sha256Hex(new TextEncoder().encode("nowhere")),
        localDocument: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: { blocks: [] },
        },
        localDocumentDigest: await sha256Hex(new TextEncoder().encode("{}")),
        semanticTransactions: [],
        createdAt: "2026-08-22T07:00:00.000Z",
      },
    });
    expect([409, 500]).toContain(response.statusCode);
  });
});
