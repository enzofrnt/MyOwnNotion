/** Server projection and transactional convergence (T123, US5). */

import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
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
  return response.json() as {
    checkpointBytes: string;
    checkpointDigest: string;
    versionVector: string;
  };
}

async function replica(pageId: Uuid, checkpoint: Awaited<ReturnType<typeof activate>>) {
  return await OperationalPageDocument.fromSnapshotTransport({
    pageId,
    snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
    snapshotDigest: checkpoint.checkpointDigest,
    versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
  });
}

async function transportUpdate(transaction: ReturnType<OperationalPageDocument["transact"]>) {
  return {
    updateId: generateUuidV7(),
    baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
    updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
    updateDigest: await sha256Hex(transaction.updateBytes),
    createdAt: "2026-08-21T12:00:00.000Z",
  };
}

function sync(
  pageId: Uuid,
  headers: Record<string, string>,
  input: {
    persistedVersionVector: Uint8Array | string;
    updates: unknown[];
    knownServerPageSequence?: number;
  },
) {
  return harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${pageId}/sync`,
    headers,
    payload: {
      mode: "active",
      requestId: generateUuidV7(),
      operationalVersion: 1,
      persistedVersionVector:
        typeof input.persistedVersionVector === "string"
          ? input.persistedVersionVector
          : Buffer.from(input.persistedVersionVector).toString("base64url"),
      knownServerPageSequence: input.knownServerPageSequence ?? 0,
      updates: input.updates,
      maxRemoteBytes: 1024 * 1024,
    },
  });
}

describe("operational page materialization", () => {
  it("refuses a stale active pull after the page becomes a folder without returning 500", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Retired operational page");
    const checkpoint = await activate(page, headers);
    const converted = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/items/${page.itemId}/convert`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: { targetKind: "folder" },
    });
    expect(converted.statusCode, converted.body).toBe(200);

    const stalePull = await sync(page.itemId, headers, {
      persistedVersionVector: checkpoint.versionVector,
      updates: [],
    });

    expect(stalePull.statusCode, stalePull.body).toBe(409);
    expect(stalePull.json()).toMatchObject({ code: "page-operations.projection-invalid" });
  });

  it("returns a bounded projection problem when consolidation finds a divergent item head", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Divergent operational history");
    const unrelated = await harness.createLegacyPage("Unrelated revision lineage");
    const checkpoint = await activate(page, headers);
    const author = await replica(page.itemId, checkpoint);
    const transaction = author.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "Retained local edit" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const accepted = await sync(page.itemId, headers, {
      persistedVersionVector: transaction.resultVersionVector,
      updates: [await transportUpdate(transaction)],
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_states
         SET revision_window_started_at = now() - interval '1 hour',
             revision_window_last_update_at = now() - interval '1 hour'
       WHERE page_id = ${page.itemId}::uuid
    `);
    await harness.api.built.database.db.execute(sql`
      UPDATE items
         SET current_revision_id = ${unrelated.revisionId}::uuid
       WHERE id = ${page.itemId}::uuid
    `);

    const refused = await sync(page.itemId, headers, {
      persistedVersionVector: author.versionVectorBytes(),
      updates: [],
      knownServerPageSequence: 1,
    });

    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: "page-operations.projection-invalid" });
  });

  it("does not trust a page cursor that its durable frontier cannot prove", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Untrusted page cursor");
    const checkpoint = await activate(page, headers);
    const author = await replica(page.itemId, checkpoint);
    const stale = await replica(page.itemId, checkpoint);
    const blockId = generateUuidV7();
    const inserted = author.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: blockId, content: [{ text: "A" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const first = await sync(page.itemId, headers, {
      persistedVersionVector: inserted.resultVersionVector,
      updates: [await transportUpdate(inserted)],
    });
    expect(first.statusCode, first.body).toBe(200);

    const edited = author.transact([{ type: "replace-text", blockId, from: 0, to: 1, text: "B" }]);
    const second = await sync(page.itemId, headers, {
      persistedVersionVector: edited.resultVersionVector,
      updates: [await transportUpdate(edited)],
      knownServerPageSequence: 1,
    });
    expect(second.statusCode, second.body).toBe(200);

    const catchUp = await sync(page.itemId, headers, {
      persistedVersionVector: stale.versionVectorBytes(),
      updates: [],
      // A stale or corrupt local cursor must not be able to skip updates that
      // are absent from the encrypted durable frontier sent with the request.
      knownServerPageSequence: 2,
    });
    expect(catchUp.statusCode, catchUp.body).toBe(200);
    expect(
      (catchUp.json().remoteUpdates as Array<{ pageSequence: number }>).map(
        ({ pageSequence }) => pageSequence,
      ),
    ).toEqual([1, 2]);
    expect(catchUp.json()).toMatchObject({ throughPageSequence: 2, hasMore: false });
  });

  it("converges two offline replicas regardless of arrival order", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    const checkpoint = await activate(page, headers);
    const left = await replica(page.itemId, checkpoint);
    const right = await replica(page.itemId, checkpoint);
    const leftBlockId = generateUuidV7();
    const rightBlockId = generateUuidV7();
    const leftTransaction = left.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: leftBlockId, content: [{ text: "Left" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const rightTransaction = right.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: rightBlockId, content: [{ text: "Right" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);

    const rightResponse = await sync(page.itemId, headers, {
      persistedVersionVector: rightTransaction.resultVersionVector,
      updates: [await transportUpdate(rightTransaction)],
    });
    expect(rightResponse.statusCode, rightResponse.body).toBe(200);
    const leftResponse = await sync(page.itemId, headers, {
      persistedVersionVector: leftTransaction.resultVersionVector,
      updates: [await transportUpdate(leftTransaction)],
    });
    expect(leftResponse.statusCode, leftResponse.body).toBe(200);

    const staleFrontier = await harness.api.built.database.db.execute(sql`
      SELECT confirmed_page_sequence
        FROM page_device_frontiers
       WHERE page_id = ${page.itemId}::uuid
    `);
    expect(
      (
        staleFrontier as unknown as {
          rows: Array<{ confirmed_page_sequence: string }>;
        }
      ).rows[0]?.confirmed_page_sequence,
    ).toBe("1");

    left.importUpdate(rightTransaction.updateBytes);
    const confirmation = await sync(page.itemId, headers, {
      persistedVersionVector: left.versionVectorBytes(),
      updates: [],
      knownServerPageSequence: 2,
    });
    expect(confirmation.statusCode, confirmation.body).toBe(200);
    const confirmedFrontier = await harness.api.built.database.db.execute(sql`
      SELECT confirmed_page_sequence, record_version
        FROM page_device_frontiers
       WHERE page_id = ${page.itemId}::uuid
    `);
    expect(
      (
        confirmedFrontier as unknown as {
          rows: Array<{ confirmed_page_sequence: string; record_version: number }>;
        }
      ).rows[0],
    ).toEqual({ confirmed_page_sequence: "2", record_version: 2 });

    const stored = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    const blocks = stored.json().pageDocument.body.blocks as Array<{ id: string }>;
    expect(new Set(blocks.map(({ id }) => id))).toEqual(new Set([leftBlockId, rightBlockId]));

    expect(left.snapshot()).toEqual(stored.json().pageDocument.body);
    expect(leftResponse.json().canonical.digest).toBe((await left.project()).canonicalDigest);

    const feed = await harness.api.built.app.inject({
      method: "GET",
      url: "/v1/changes?after=&limit=100",
      headers,
    });
    expect(feed.statusCode, feed.body).toBe(200);
    const operationalChanges = (feed.json().changes as Array<{ nature?: string }>).filter(
      ({ nature }) => nature === "page-operations.updated",
    );
    expect(operationalChanges).toHaveLength(2);
  });

  it("updates page-link and pending-file projections in the same commit", async () => {
    const headers = await harness.authenticate();
    const source = await harness.createLegacyPage("Source");
    const target = await harness.createLegacyPage("Target");
    const checkpoint = await activate(source, headers);
    const author = await replica(source.itemId, checkpoint);
    const missingFileId = generateUuidV7();
    const transaction = author.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [
            {
              text: "Target",
              marks: [{ type: "pageLink", targetItemId: target.itemId }],
            },
          ],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
      {
        type: "insert-block",
        block: {
          type: "fileEmbed",
          id: generateUuidV7(),
          fileItemId: missingFileId,
          caption: "kept while upload is pending",
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const response = await sync(source.itemId, headers, {
      persistedVersionVector: transaction.resultVersionVector,
      updates: [await transportUpdate(transaction)],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().fileRequirements).toContainEqual({
      fileId: missingFileId,
      state: "upload-required",
    });

    const links = await harness.api.built.database.db.execute(sql`
      SELECT target_item_id
        FROM relationships
       WHERE source_item_id = ${source.itemId}::uuid
         AND relation_type = 'page:link'
         AND removed_revision_id IS NULL
    `);
    expect((links as unknown as { rows: Array<{ target_item_id: string }> }).rows).toEqual([
      { target_item_id: target.itemId },
    ]);
    const usages = await harness.api.built.database.db.execute(sql`
      SELECT count(*)::int AS count FROM file_usages WHERE used_by_item_id = ${source.itemId}::uuid
    `);
    expect((usages as unknown as { rows: Array<{ count: number }> }).rows[0]?.count).toBe(0);

    const upload = await harness.api.built.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: {
        ...headers,
        "upload-length": "4",
        "upload-metadata": [
          `filename ${Buffer.from("embedded.txt").toString("base64")}`,
          `mediaType ${Buffer.from("text/plain").toString("base64")}`,
          `itemId ${Buffer.from(missingFileId).toString("base64")}`,
        ].join(","),
      },
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const completed = await harness.api.built.app.inject({
      method: "PATCH",
      url: upload.headers["location"] as string,
      headers: {
        ...headers,
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
      },
      payload: Buffer.from("safe"),
    });
    expect(completed.statusCode, completed.body).toBe(201);
    expect(completed.json()).toEqual({ itemId: missingFileId, verified: true });

    const confirmed = await sync(source.itemId, headers, {
      persistedVersionVector: transaction.resultVersionVector,
      knownServerPageSequence: 1,
      updates: [],
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().fileRequirements).toContainEqual({
      fileId: missingFileId,
      state: "present",
    });
    const refreshedUsages = await harness.api.built.database.db.execute(sql`
      SELECT count(*)::int AS count FROM file_usages WHERE used_by_item_id = ${source.itemId}::uuid
    `);
    expect((refreshedUsages as unknown as { rows: Array<{ count: number }> }).rows[0]?.count).toBe(
      1,
    );
  });

  it("rolls a whole request back when a later update fails integrity", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage();
    const checkpoint = await activate(page, headers);
    const first = await replica(page.itemId, checkpoint);
    const second = await replica(page.itemId, checkpoint);
    const firstTransaction = first.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: generateUuidV7(), content: [{ text: "first" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const secondTransaction = second.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: generateUuidV7(), content: [{ text: "second" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const firstUpdate = await transportUpdate(firstTransaction);
    const corrupt = { ...(await transportUpdate(secondTransaction)), updateDigest: "0".repeat(64) };
    const before = await harness.api.built.database.db.execute(sql`
      SELECT count(*)::int AS count FROM protected_envelopes
    `);

    const response = await sync(page.itemId, headers, {
      persistedVersionVector: firstTransaction.resultVersionVector,
      updates: [firstUpdate, corrupt],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "page-operations.digest-mismatch" });

    const state = await harness.api.built.database.db.execute(sql`
      SELECT last_update_sequence FROM page_operation_states WHERE page_id = ${page.itemId}::uuid
    `);
    expect(
      (state as unknown as { rows: Array<{ last_update_sequence: string }> }).rows[0]
        ?.last_update_sequence,
    ).toBe("0");
    const updates = await harness.api.built.database.db.execute(sql`
      SELECT count(*)::int AS count FROM page_operation_updates WHERE page_id = ${page.itemId}::uuid
    `);
    expect((updates as unknown as { rows: Array<{ count: number }> }).rows[0]?.count).toBe(0);
    const after = await harness.api.built.database.db.execute(sql`
      SELECT count(*)::int AS count FROM protected_envelopes
    `);
    expect((after as unknown as { rows: Array<{ count: number }> }).rows[0]?.count).toBe(
      (before as unknown as { rows: Array<{ count: number }> }).rows[0]?.count,
    );
  });
});
