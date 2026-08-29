/** Operational history windows and restore-as-operations (T126/T146, US5). */

import { insertRevision, schema } from "@myownnotion/database";
import { generateUuidV7, normaliseDocumentV3, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commandsForPageRestore } from "../src/page-state/page-history-service.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "./helpers/authenticated-page-operations.ts";

const START = Date.parse("2026-08-23T09:00:00.000Z");
let nowMs = START;
let harness: AuthenticatedPageOperationHarness;

beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness({ now: () => new Date(nowMs) });
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  nowMs = START;
  await harness.reset();
});

function history() {
  const service = harness.api.built.pageHistory;
  if (service === undefined) throw new Error("page history service is unavailable");
  return service;
}

async function activate(
  page: { readonly itemId: Uuid; readonly revisionId: Uuid; readonly canonicalDigest: string },
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

async function replica(
  pageId: Uuid,
  checkpoint: Awaited<ReturnType<typeof activate>>,
): Promise<OperationalPageDocument> {
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
    createdAt: new Date(nowMs).toISOString(),
  };
}

async function sync(input: {
  readonly pageId: Uuid;
  readonly headers: Record<string, string>;
  readonly replica: OperationalPageDocument;
  readonly transaction?: ReturnType<OperationalPageDocument["transact"]>;
  readonly revisionBoundary?: "editor-closed";
}) {
  const updates = input.transaction === undefined ? [] : [await transportUpdate(input.transaction)];
  const response = await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${input.pageId}/sync`,
    headers: input.headers,
    payload: {
      mode: "active",
      requestId: generateUuidV7(),
      operationalVersion: 1,
      persistedVersionVector: Buffer.from(input.replica.versionVectorBytes()).toString("base64url"),
      knownServerPageSequence: 0,
      updates,
      maxRemoteBytes: 1024 * 1024,
      ...(input.revisionBoundary === undefined ? {} : { revisionBoundary: input.revisionBoundary }),
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    canonical: {
      lastConsolidatedRevisionId: Uuid | null;
      hasUnconsolidatedChanges: boolean;
    };
  };
}

async function operationState(pageId: Uuid) {
  const result = await harness.api.built.database.db.execute(sql`
    SELECT last_revision_id,
           revision_window_started_at,
           revision_window_last_update_at,
           last_update_sequence
      FROM page_operation_states
     WHERE page_id = ${pageId}::uuid
  `);
  return (
    result as unknown as {
      rows: Array<{
        last_revision_id: Uuid;
        revision_window_started_at: Date | null;
        revision_window_last_update_at: Date | null;
        last_update_sequence: string;
      }>;
    }
  ).rows[0];
}

describe("visible history consolidation", () => {
  it("restores opaque properties and divider text exactly while preserving block identities", async () => {
    const propertyBlockId = generateUuidV7();
    const dividerBlockId = generateUuidV7();
    const current = normaliseDocumentV3({
      blocks: [
        {
          type: "paragraph",
          id: propertyBlockId,
          content: [{ text: "opaque" }],
          rawExtraProperties: { future: "old", removedLater: true },
        },
        { type: "divider", id: dividerBlockId },
      ],
    });
    const target = normaliseDocumentV3({
      blocks: [
        {
          type: "paragraph",
          id: propertyBlockId,
          content: [{ text: "opaque" }],
          rawExtraProperties: { future: "new" },
        },
        {
          type: "paragraph",
          id: dividerBlockId,
          content: [{ text: "restored divider text" }],
        },
      ],
    });
    const operational = OperationalPageDocument.create({
      pageId: generateUuidV7(),
      document: current,
    });
    const transaction = operational.transact(commandsForPageRestore(current, target));
    expect(transaction.changed).toBe(true);
    expect((await operational.project()).document).toEqual(target);
  });

  it("closes at 30 seconds idle, five minutes continuous editing, and an editor boundary", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("History windows");
    const checkpoint = await activate(page, headers);
    const author = await replica(page.itemId, checkpoint);
    const inserted = author.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "first" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const first = await sync({
      pageId: page.itemId,
      headers,
      replica: author,
      transaction: inserted,
    });
    expect(first.canonical).toMatchObject({
      lastConsolidatedRevisionId: page.revisionId,
      hasUnconsolidatedChanges: true,
    });

    nowMs = START + 29_999;
    await expect(history().consolidateDue()).resolves.toMatchObject({ consolidated: 0 });
    expect((await operationState(page.itemId))?.revision_window_started_at).not.toBeNull();

    nowMs = START + 30_000;
    await expect(history().consolidateDue()).resolves.toMatchObject({ consolidated: 1 });
    const idleClosed = await operationState(page.itemId);
    expect(idleClosed?.last_revision_id).not.toBe(page.revisionId);
    expect(idleClosed?.revision_window_started_at).toBeNull();

    const continuousStart = START + 60_000;
    nowMs = continuousStart;
    let currentText = "first";
    for (let index = 0; index < 11; index += 1) {
      const next = `${currentText}.`;
      const transaction = author.transact([
        {
          type: "replace-text",
          blockId: author.snapshot().blocks[0]?.id as Uuid,
          from: 0,
          to: currentText.length,
          text: next,
        },
      ]);
      currentText = next;
      await sync({ pageId: page.itemId, headers, replica: author, transaction });
      if (index < 10) nowMs += 29_000;
    }
    expect(nowMs - continuousStart).toBe(290_000);
    nowMs = continuousStart + 300_000;
    await expect(history().consolidateDue()).resolves.toMatchObject({ consolidated: 1 });
    expect((await operationState(page.itemId))?.revision_window_started_at).toBeNull();

    nowMs += 1_000;
    const boundaryEdit = author.transact([
      {
        type: "replace-text",
        blockId: author.snapshot().blocks[0]?.id as Uuid,
        from: 0,
        to: currentText.length,
        text: "closed explicitly",
      },
    ]);
    const boundary = await sync({
      pageId: page.itemId,
      headers,
      replica: author,
      transaction: boundaryEdit,
      revisionBoundary: "editor-closed",
    });
    expect(boundary.canonical.hasUnconsolidatedChanges).toBe(false);
    expect((await operationState(page.itemId))?.revision_window_started_at).toBeNull();
  });

  it("consolidates an open editing window on top of a newer rename revision", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Rename during editing");
    const checkpoint = await activate(page, headers);
    const author = await replica(page.itemId, checkpoint);
    const edit = author.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "The edited body survives the rename" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    await sync({ pageId: page.itemId, headers, replica: author, transaction: edit });

    const rename = await harness.api.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${page.itemId}`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: { baseRevisionId: page.revisionId, name: "Renamed during editing" },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    const renameRevisionId = rename.json().revisionIds[0] as Uuid;

    nowMs += 30_000;
    const result = await history().consolidateDue();
    expect(result).toMatchObject({ consolidated: 1 });
    const state = await operationState(page.itemId);
    expect(state?.revision_window_started_at).toBeNull();
    expect(state?.last_revision_id).not.toBe(renameRevisionId);

    const lineage = await harness.api.built.database.db.execute(sql`
      SELECT parent_revision_id
        FROM revision_parents
       WHERE revision_id = ${state?.last_revision_id}::uuid
    `);
    expect(
      (
        lineage as unknown as {
          rows: Array<{ parent_revision_id: Uuid }>;
        }
      ).rows,
    ).toEqual([{ parent_revision_id: renameRevisionId }]);

    const stored = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.json()).toMatchObject({
      name: "Renamed during editing",
      currentRevisionId: state?.last_revision_id,
      pageDocument: {
        body: {
          blocks: [{ content: [{ text: "The edited body survives the rename" }] }],
        },
      },
    });
  });

  it("consolidates an open editing window on top of a newer placement revision", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Move during editing");
    const checkpoint = await activate(page, headers);
    const author = await replica(page.itemId, checkpoint);
    const edit = author.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "The edited body survives the move" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    await sync({ pageId: page.itemId, headers, replica: author, transaction: edit });

    const placement = await harness.api.built.database.db.execute(sql`
      SELECT id
        FROM placements
       WHERE item_id = ${page.itemId}::uuid AND removed_at IS NULL
       LIMIT 1
    `);
    const placementId = (placement as unknown as { rows: Array<{ id: Uuid }> }).rows[0]?.id;
    expect(placementId).toBeDefined();
    let moveRevisionId: Uuid | undefined;
    for (const positionKey of ["W", "Y", "Z"]) {
      const move = await harness.api.built.app.inject({
        method: "POST",
        url: `/v1/placements/${placementId}/move`,
        headers: { ...headers, "idempotency-key": generateUuidV7() },
        payload: { parentItemId: null, positionKey },
      });
      expect(move.statusCode, move.body).toBe(200);
      moveRevisionId = move.json().revisionIds[0] as Uuid;
    }
    expect(moveRevisionId).toBeDefined();

    nowMs += 30_000;
    const result = await history().consolidateDue();
    expect(result).toMatchObject({ consolidated: 1 });
    const state = await operationState(page.itemId);
    expect(state?.revision_window_started_at).toBeNull();
    const lineage = await harness.api.built.database.db.execute(sql`
      SELECT parent_revision_id
        FROM revision_parents
       WHERE revision_id = ${state?.last_revision_id}::uuid
    `);
    expect(
      (
        lineage as unknown as {
          rows: Array<{ parent_revision_id: Uuid }>;
        }
      ).rows,
    ).toEqual([{ parent_revision_id: moveRevisionId }]);

    const stored = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.json()).toMatchObject({
      currentRevisionId: state?.last_revision_id,
      placements: [{ positionKey: "Z" }],
      pageDocument: {
        body: {
          blocks: [{ content: [{ text: "The edited body survives the move" }] }],
        },
      },
    });
  });

  it("reports a divergent lineage without preventing another due page from consolidating", async () => {
    const headers = await harness.authenticate();
    const divergent = await harness.createLegacyPage("Divergent history");
    const healthy = await harness.createLegacyPage("Healthy history");

    for (const page of [divergent, healthy]) {
      const checkpoint = await activate(page, headers);
      const author = await replica(page.itemId, checkpoint);
      const edit = author.transact([
        {
          type: "insert-block",
          block: {
            type: "paragraph",
            id: generateUuidV7(),
            content: [{ text: page.itemId }],
          },
          parentBlockId: null,
          beforeBlockId: null,
        },
      ]);
      await sync({ pageId: page.itemId, headers, replica: author, transaction: edit });
    }

    const rogueRevisionId = generateUuidV7();
    const rogueMutationId = generateUuidV7();
    await harness.api.built.database.db.transaction(async (tx) => {
      await tx.insert(schema.mutations).values({
        id: rogueMutationId,
        workspaceId: harness.api.built.context.workspaceId,
        commandType: "page-operations.consolidated",
        status: "accepted",
        submittedAt: new Date(nowMs),
        acceptedAt: new Date(nowMs),
        resultRevisionIds: [rogueRevisionId],
      });
      await insertRevision(tx, {
        id: rogueRevisionId,
        itemId: divergent.itemId,
        mutationId: rogueMutationId,
        parentRevisionIds: [],
        snapshot: {},
        acceptedAt: new Date(nowMs),
      });
      await tx
        .update(schema.items)
        .set({ currentRevisionId: rogueRevisionId, updatedAt: new Date(nowMs) })
        .where(eq(schema.items.id, divergent.itemId));
    });

    nowMs += 30_000;
    const result = await history().consolidateDue();
    expect(result).toMatchObject({
      consolidated: 1,
      pageIds: [healthy.itemId],
      failures: [
        {
          pageId: divergent.itemId,
          code: "page-history.lineage-diverged",
          errorName: "PageHistoryConsolidationError",
        },
      ],
    });
    expect((await operationState(divergent.itemId))?.revision_window_started_at).not.toBeNull();
    expect((await operationState(healthy.itemId))?.revision_window_started_at).toBeNull();
  });

  it("restores an active page by new causal operations and still merges an offline edit", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Operational restore");
    const checkpoint = await activate(page, headers);
    const online = await replica(page.itemId, checkpoint);
    const blockId = generateUuidV7();
    const firstEdit = online.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: blockId, content: [{ text: "Version one" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const firstBoundary = await sync({
      pageId: page.itemId,
      headers,
      replica: online,
      transaction: firstEdit,
      revisionBoundary: "editor-closed",
    });
    const firstRevisionId = firstBoundary.canonical.lastConsolidatedRevisionId;
    expect(firstRevisionId).not.toBeNull();

    const firstCheckpoint = await online.checkpoint();
    const offline = await OperationalPageDocument.fromCheckpoint({
      pageId: page.itemId,
      checkpoint: firstCheckpoint,
    });
    const offlineEdit = offline.transact([
      { type: "replace-text", blockId, from: 11, to: 11, text: " offline" },
    ]);

    nowMs += 1_000;
    const secondEdit = online.transact([
      { type: "replace-text", blockId, from: 0, to: 11, text: "Server newer" },
    ]);
    const secondBoundary = await sync({
      pageId: page.itemId,
      headers,
      replica: online,
      transaction: secondEdit,
      revisionBoundary: "editor-closed",
    });
    const secondRevisionId = secondBoundary.canonical.lastConsolidatedRevisionId as Uuid;

    nowMs += 500;
    const draftEdit = online.transact([
      { type: "replace-text", blockId, from: 0, to: 12, text: "Server newer draft" },
    ]);
    const draft = await sync({
      pageId: page.itemId,
      headers,
      replica: online,
      transaction: draftEdit,
    });
    expect(draft.canonical).toMatchObject({
      lastConsolidatedRevisionId: secondRevisionId,
      hasUnconsolidatedChanges: true,
    });
    const beforeRestore = await operationState(page.itemId);

    const restored = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${firstRevisionId as Uuid}/restore`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: { currentRevisionId: secondRevisionId },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const restoredRevisionId = restored.json().revisionIds[0] as Uuid;
    const afterRestore = await operationState(page.itemId);
    expect(Number(afterRestore?.last_update_sequence)).toBe(
      Number(beforeRestore?.last_update_sequence) + 1,
    );
    expect(afterRestore?.last_revision_id).toBe(restoredRevisionId);

    const restoredParent = await harness.api.built.database.db.execute(sql`
      SELECT rp.parent_revision_id, r.snapshot
        FROM revision_parents rp
        JOIN revisions r ON r.id = rp.parent_revision_id
       WHERE rp.revision_id = ${restoredRevisionId}::uuid
    `);
    const parent = (
      restoredParent as unknown as {
        rows: Array<{ parent_revision_id: Uuid; snapshot: Record<string, unknown> }>;
      }
    ).rows[0];
    expect(parent?.parent_revision_id).not.toBe(secondRevisionId);
    expect(JSON.stringify(parent?.snapshot)).toContain("Server newer draft");

    const caughtUp = await sync({
      pageId: page.itemId,
      headers,
      replica: offline,
      transaction: offlineEdit,
    });
    expect(caughtUp.canonical.hasUnconsolidatedChanges).toBe(true);

    const stored = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(stored.statusCode, stored.body).toBe(200);
    const text = stored.json().pageDocument.body.blocks[0].content[0].text as string;
    expect(text).toContain("Version one");
    expect(text).toContain("offline");
  });

  it("reports a canonical rename as a stale restore head instead of an internal error", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Stale operational restore");
    await activate(page, headers);

    const rename = await harness.api.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${page.itemId}`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: { baseRevisionId: page.revisionId, name: "Renamed elsewhere" },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    const renameRevisionId = rename.json().revisionIds[0] as Uuid;

    const restored = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${page.revisionId}/restore`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: { currentRevisionId: page.revisionId },
    });
    expect(restored.statusCode, restored.body).toBe(409);
    expect(restored.json()).toMatchObject({
      code: "revision.stale-base",
      competingRevisionIds: [renameRevisionId],
    });
  });

  it("restores from the canonical metadata head when its operational boundary is an ancestor", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Restore through metadata");
    const checkpoint = await activate(page, headers);
    const author = await replica(page.itemId, checkpoint);
    const blockId = generateUuidV7();
    const firstEdit = author.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: blockId, content: [{ text: "Version one" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const first = await sync({
      pageId: page.itemId,
      headers,
      replica: author,
      transaction: firstEdit,
      revisionBoundary: "editor-closed",
    });
    const firstRevisionId = first.canonical.lastConsolidatedRevisionId as Uuid;

    const secondEdit = author.transact([
      { type: "replace-text", blockId, from: 0, to: 11, text: "Version two" },
    ]);
    const second = await sync({
      pageId: page.itemId,
      headers,
      replica: author,
      transaction: secondEdit,
      revisionBoundary: "editor-closed",
    });
    const operationalBoundaryId = second.canonical.lastConsolidatedRevisionId as Uuid;

    const rename = await harness.api.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${page.itemId}`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: { baseRevisionId: operationalBoundaryId, name: "Metadata head retained" },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    const metadataRevisionId = rename.json().revisionIds[0] as Uuid;

    const restored = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/revisions/${firstRevisionId}/restore`,
      headers: { ...headers, "idempotency-key": generateUuidV7() },
      payload: { currentRevisionId: metadataRevisionId },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const restoredRevisionId = restored.json().revisionIds[0] as Uuid;

    const stored = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(stored.json()).toMatchObject({
      name: "Metadata head retained",
      currentRevisionId: restoredRevisionId,
      pageDocument: { body: { blocks: [{ content: [{ text: "Version one" }] }] } },
    });
    const parents = await harness.api.built.database.db.execute(sql`
      SELECT parent_revision_id
        FROM revision_parents
       WHERE revision_id = ${restoredRevisionId}::uuid
    `);
    expect(
      (
        parents as unknown as {
          rows: Array<{ parent_revision_id: Uuid }>;
        }
      ).rows,
    ).toEqual([{ parent_revision_id: metadataRevisionId }]);
  });
});
