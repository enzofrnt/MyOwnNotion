/** Legacy offline branches become shared operations without document replacement. */

import { parsePageSyncRequest } from "@myownnotion/contracts";
import {
  type BlockDocument,
  generateUuidV7,
  serialiseDocumentV3,
  type Uuid,
} from "@myownnotion/domain";
import {
  appendLegacySemanticTransaction,
  createLegacyOfflineBranch,
  legacySemanticCommandsFromTransaction,
  OperationalPageDocument,
  type PageCommand,
} from "@myownnotion/page-state";
import { sql } from "drizzle-orm";
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

async function replaceBaseDocument(
  page: { readonly itemId: Uuid; readonly revisionId: Uuid },
  headers: Record<string, string>,
  document: BlockDocument,
): Promise<Uuid> {
  const response = await harness.api.built.app.inject({
    method: "PUT",
    url: `/v1/pages/${page.itemId}/document`,
    headers: { ...headers, "idempotency-key": generateUuidV7() },
    payload: {
      baseRevisionId: page.revisionId,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: document,
      },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().revisionIds[0] as Uuid;
}

async function branchPayload(input: {
  readonly pageId: Uuid;
  readonly baseRevisionId: Uuid;
  readonly baseDocument: BlockDocument;
  readonly commands: readonly PageCommand[];
}) {
  let branch = await createLegacyOfflineBranch({
    branchId: generateUuidV7(),
    pageId: input.pageId,
    baseRevisionId: input.baseRevisionId,
    baseDocument: input.baseDocument,
    createdAt: "2026-08-21T12:00:00.000Z",
  });
  const page = OperationalPageDocument.create({
    pageId: input.pageId,
    document: branch.baseDocument,
  });
  const beforeDocument = page.snapshot();
  const transaction = page.transact(input.commands);
  branch = await appendLegacySemanticTransaction(branch, {
    transactionId: generateUuidV7(),
    sequence: 1,
    commands: legacySemanticCommandsFromTransaction({
      pageId: input.pageId,
      beforeDocument,
      transaction,
    }),
  });
  return {
    mode: "legacy-branch" as const,
    requestId: generateUuidV7(),
    branchId: branch.branchId,
    baseRevisionId: branch.baseRevisionId,
    baseCanonicalDigest: branch.baseCanonicalDigest,
    baseDocument: {
      format: "myownnotion.document+json" as const,
      formatVersion: 2 as const,
      body: branch.baseDocumentV2,
    },
    localDocument: {
      format: "myownnotion.document+json" as const,
      formatVersion: 3 as const,
      body: serialiseDocumentV3(branch.localDocument),
    },
    localDocumentDigest: branch.localDocumentDigest,
    semanticTransactions: branch.semanticTransactions,
    createdAt: branch.createdAt,
  };
}

async function sendBranch(pageId: Uuid, headers: Record<string, string>, payload: unknown) {
  return await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${pageId}/sync`,
    headers,
    payload: structuredClone(payload) as Record<string, unknown>,
  });
}

describe("legacy branch migration", () => {
  it("lazily activates, converts granularly and replays the same branch idempotently", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    const blockId = generateUuidV7();
    const payload = await branchPayload({
      pageId: page.itemId,
      baseRevisionId: page.revisionId,
      baseDocument: { blocks: [] },
      commands: [
        {
          type: "insert-block",
          block: { type: "paragraph", id: blockId, content: [{ text: "offline journal" }] },
          parentBlockId: null,
          beforeBlockId: null,
        },
      ],
    });

    const converted = await sendBranch(page.itemId, headers, payload);
    expect(converted.statusCode, converted.body).toBe(200);
    expect(converted.json()).toMatchObject({
      mode: "checkpoint",
      pageId: page.itemId,
      convertedBranchId: payload.branchId,
      localDocumentDigest: payload.localDocumentDigest,
      latestPageSequence: 1,
      hasMore: false,
    });
    expect(converted.json().conversionUpdateIds).toHaveLength(1);

    const repeated = await sendBranch(page.itemId, headers, payload);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json()).toEqual(converted.json());

    const stored = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(stored.json().pageDocument.body.blocks).toContainEqual(
      expect.objectContaining({ id: blockId, content: [{ text: "offline journal" }] }),
    );

    const reused = await sendBranch(page.itemId, headers, {
      ...payload,
      localDocumentDigest: "0".repeat(64),
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: "page-operations.update-id-reused" });
  });

  it("merges two independently offline devices into the same active page", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    const leftId = generateUuidV7();
    const rightId = generateUuidV7();
    const common = {
      pageId: page.itemId,
      baseRevisionId: page.revisionId,
      baseDocument: { blocks: [] } satisfies BlockDocument,
    };
    const left = await branchPayload({
      ...common,
      commands: [
        {
          type: "insert-block",
          block: { type: "paragraph", id: leftId, content: [{ text: "left offline" }] },
          parentBlockId: null,
          beforeBlockId: null,
        },
      ],
    });
    const right = await branchPayload({
      ...common,
      commands: [
        {
          type: "insert-block",
          block: { type: "paragraph", id: rightId, content: [{ text: "right offline" }] },
          parentBlockId: null,
          beforeBlockId: null,
        },
      ],
    });

    expect((await sendBranch(page.itemId, headers, left)).statusCode).toBe(200);
    const second = await sendBranch(page.itemId, headers, right);
    expect(second.statusCode, second.body).toBe(200);
    const stored = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(
      new Set((stored.json().pageDocument.body.blocks as Array<{ id: Uuid }>).map(({ id }) => id)),
    ).toEqual(new Set([leftId, rightId]));
  });

  it("persists delete/edit as a recoverable ambiguity instead of dropping the edit", async () => {
    const headers = await harness.authenticate();
    const created = await harness.createLegacyPage();
    const blockId = generateUuidV7();
    const baseDocument: BlockDocument = {
      blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Original" }] }],
    };
    const baseRevisionId = await replaceBaseDocument(created, headers, baseDocument);
    const deleting = await branchPayload({
      pageId: created.itemId,
      baseRevisionId,
      baseDocument,
      commands: [{ type: "delete-block", blockId }],
    });
    const editing = await branchPayload({
      pageId: created.itemId,
      baseRevisionId,
      baseDocument,
      commands: [{ type: "replace-text", blockId, from: 8, to: 8, text: " restored" }],
    });
    expect(parsePageSyncRequest(editing).mode).toBe("legacy-branch");

    expect((await sendBranch(created.itemId, headers, deleting)).statusCode).toBe(200);
    const conflict = await sendBranch(created.itemId, headers, editing);
    expect(conflict.statusCode, conflict.body).toBe(200);
    expect(conflict.json().ambiguities).toContainEqual(
      expect.objectContaining({ pageId: created.itemId, kind: "delete-edit", status: "open" }),
    );
    const rows = await harness.api.built.database.db.execute(sql`
      SELECT count(*)::int AS count
        FROM page_ambiguities
       WHERE page_id = ${created.itemId}::uuid AND status = 'open'
    `);
    expect((rows as unknown as { rows: Array<{ count: number }> }).rows[0]?.count).toBe(1);
  });
});
