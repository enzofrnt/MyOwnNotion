/** Damaged or stale replay state must refuse acknowledgement without losing durable work. */
import type { ActivePageSyncRequestDto } from "@myownnotion/contracts";
import { PageOperationRepositoryError } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  OperationalPageDocument,
  type PageTransactionResult,
  sha256Hex,
} from "@myownnotion/page-state";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalMaterializer } from "../src/page-state/canonical-materializer.ts";
import { PageOperationService } from "../src/page-state/page-operation-service.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
  PAGE_OPERATION_DEVICE_ID,
  PAGE_OPERATION_OWNER_ID,
} from "./helpers/authenticated-page-operations.ts";

let harness: AuthenticatedPageOperationHarness;
beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness();
}, 180_000);
beforeEach(async () => {
  await harness.reset();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await harness?.close();
});

function service(history?: ConstructorParameters<typeof PageOperationService>[0]["history"]) {
  const built = harness.api.built;
  const { protectedContent, rotationPolicies } = built.context;
  const crypto = built.pageOperationCrypto;
  if (protectedContent === undefined || rotationPolicies === undefined || crypto === undefined) {
    throw new Error("The authenticated operational runtime is unavailable");
  }
  return new PageOperationService({
    db: built.database.db,
    workspaceId: built.context.workspaceId,
    crypto,
    protectedContent,
    rotationPolicies,
    materializer: new CanonicalMaterializer(protectedContent),
    ...(history === undefined ? {} : { history }),
  });
}

async function activePage() {
  const page = await harness.createLegacyPage();
  const headers = await harness.authenticate();
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
  const checkpoint = response.json();
  const author = await OperationalPageDocument.fromSnapshotTransport({
    pageId: page.itemId,
    snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
    snapshotDigest: checkpoint.checkpointDigest,
    versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
  });
  return { ...page, author, initialFrontier: author.versionVectorBytes() };
}

function request(frontier: Uint8Array, updates: ActivePageSyncRequestDto["updates"] = []) {
  return {
    mode: "active",
    requestId: generateUuidV7(),
    operationalVersion: 1,
    persistedVersionVector: Buffer.from(frontier).toString("base64url"),
    knownServerPageSequence: 0,
    updates,
    maxRemoteBytes: 1024 * 1024,
  } satisfies ActivePageSyncRequestDto;
}

async function synchronize(pageId: Uuid, input: ActivePageSyncRequestDto, runtime = service()) {
  return runtime.sync({
    pageId,
    ownerId: PAGE_OPERATION_OWNER_ID,
    deviceId: PAGE_OPERATION_DEVICE_ID,
    request: input,
  });
}

async function append(page: Awaited<ReturnType<typeof activePage>>, text = "Durable content") {
  const blockId = generateUuidV7();
  const transaction = page.author.transact([
    {
      type: "insert-block",
      parentBlockId: null,
      beforeBlockId: null,
      block: { id: blockId, type: "paragraph", content: [{ text }] },
    },
  ]);
  const update = {
    updateId: generateUuidV7(),
    baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
    updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
    updateDigest: await sha256Hex(transaction.updateBytes),
    createdAt: "2026-10-07T12:00:00.000Z",
  };
  const result = await synchronize(page.itemId, request(transaction.resultVersionVector, [update]));
  expect(result.accepted.map(({ updateId }) => updateId)).toEqual([update.updateId]);
  return { blockId, transaction, update };
}

async function pendingUpdate(page: Awaited<ReturnType<typeof activePage>>) {
  const transaction = page.author.transact([
    {
      type: "insert-block",
      parentBlockId: null,
      beforeBlockId: null,
      block: { id: generateUuidV7(), type: "paragraph", content: [{ text: "Still local" }] },
    },
  ]);
  return {
    transaction,
    update: {
      updateId: generateUuidV7(),
      baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
      updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
      updateDigest: await sha256Hex(transaction.updateBytes),
      createdAt: "2026-10-07T12:00:00.000Z",
    },
  };
}

async function submitTransaction(pageId: Uuid, transaction: PageTransactionResult) {
  const update = {
    updateId: generateUuidV7(),
    baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
    updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
    updateDigest: await sha256Hex(transaction.updateBytes),
    createdAt: "2026-10-07T12:00:00.000Z",
  };
  return synchronize(pageId, request(transaction.resultVersionVector, [update]));
}

async function ambiguousPage() {
  const page = await activePage();
  const initial = await append(page, "Original text");
  const concurrent = await OperationalPageDocument.fromCheckpoint({
    pageId: page.itemId,
    checkpoint: await page.author.checkpoint(),
  });
  const deleting = page.author.transact([{ type: "delete-block", blockId: initial.blockId }]);
  const editing = concurrent.transact([
    { type: "replace-text", blockId: initial.blockId, from: 13, to: 13, text: " retained" },
  ]);
  await submitTransaction(page.itemId, deleting);
  const conflict = await submitTransaction(page.itemId, editing);
  expect(conflict.ambiguities).toContainEqual(
    expect.objectContaining({ pageId: page.itemId, kind: "delete-edit", status: "open" }),
  );
  return { ...page, blockId: initial.blockId, frontier: concurrent.versionVectorBytes() };
}

async function durableState(pageId: Uuid) {
  const result = await harness.api.built.database.db.execute(sql`
    SELECT i.current_revision_id,
           s.last_update_sequence, s.current_checkpoint_id, s.current_frontier_envelope_id,
           (SELECT count(*) FROM page_operation_updates u WHERE u.page_id = i.id) AS updates,
           (SELECT count(*) FROM page_device_frontiers f WHERE f.page_id = i.id) AS frontiers
      FROM items i LEFT JOIN page_operation_states s ON s.page_id = i.id
     WHERE i.id = ${pageId}::uuid
  `);
  return result.rows;
}

async function refusesReplay(pageId: Uuid) {
  const before = await durableState(pageId);
  await expect(
    harness.api.built.database.db.transaction((tx) => service().loadForMutation(tx, pageId)),
  ).rejects.toMatchObject({ code: "page-operations.projection-invalid", status: 409 });
  expect(await durableState(pageId)).toEqual(before);
}

describe("retained operational replay guards", () => {
  it("refuses a device revoked after its page was activated without acknowledging local work", async () => {
    const page = await activePage();
    const local = await pendingUpdate(page);
    await harness.api.built.database.db.execute(sql`
      UPDATE authorized_devices SET state = 'revoked', revoked_at = now()
       WHERE id = ${PAGE_OPERATION_DEVICE_ID}::uuid
    `);
    const before = await durableState(page.itemId);
    await expect(
      synchronize(page.itemId, request(local.transaction.resultVersionVector, [local.update])),
    ).rejects.toMatchObject({ code: "page-operations.device-revoked", status: 403 });
    expect(await durableState(page.itemId)).toEqual(before);
  });

  it("refuses repeated update identities within a batch before recording either occurrence", async () => {
    const page = await activePage();
    const local = await pendingUpdate(page);
    const before = await durableState(page.itemId);
    await expect(
      synchronize(
        page.itemId,
        request(local.transaction.resultVersionVector, [local.update, local.update]),
      ),
    ).rejects.toMatchObject({ code: "page-operations.update-id-reused", status: 409 });
    expect(await durableState(page.itemId)).toEqual(before);
  });

  it("does not acknowledge a local frontier whose updates were omitted from the request", async () => {
    const page = await activePage();
    const local = await pendingUpdate(page);
    const before = await durableState(page.itemId);
    await expect(
      synchronize(page.itemId, request(local.transaction.resultVersionVector)),
    ).rejects.toMatchObject({ code: "page-operations.dependencies-missing", status: 409 });
    expect(await durableState(page.itemId)).toEqual(before);
    const resumed = await synchronize(
      page.itemId,
      request(local.transaction.resultVersionVector, [local.update]),
    );
    expect(resumed.accepted.map(({ updateId }) => updateId)).toEqual([local.update.updateId]);
  });

  it("rolls back a newly submitted update when its retained revision boundary is missing", async () => {
    const page = await activePage();
    const local = await pendingUpdate(page);
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_states SET last_revision_id = NULL WHERE page_id = ${page.itemId}::uuid
    `);
    const before = await durableState(page.itemId);
    await expect(
      synchronize(page.itemId, request(local.transaction.resultVersionVector, [local.update])),
    ).rejects.toMatchObject({ code: "page-operations.projection-invalid", status: 409 });
    expect(await durableState(page.itemId)).toEqual(before);
  });

  it("maps missing operational state to a repairable conflict", async () => {
    await expect(
      harness.api.built.database.db.transaction((tx) =>
        service().loadForMutation(tx, generateUuidV7()),
      ),
    ).rejects.toMatchObject({ code: "page-operations.projection-invalid", status: 409 });
  });

  it("refuses a legacy replay even when its last checkpoint is retained", async () => {
    const page = await activePage();
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_states SET status = 'legacy' WHERE page_id = ${page.itemId}::uuid
    `);
    await refusesReplay(page.itemId);
  });

  it("refuses a checkpoint that lost verified status", async () => {
    const page = await activePage();
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_checkpoints SET state = 'candidate', verified_at = NULL
       WHERE page_id = ${page.itemId}::uuid
    `);
    await refusesReplay(page.itemId);
  });

  it("refuses checkpoint bytes whose persisted digest no longer matches", async () => {
    const page = await activePage();
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_checkpoints SET snapshot_digest = ${"0".repeat(64)}
       WHERE page_id = ${page.itemId}::uuid
    `);
    await refusesReplay(page.itemId);
  });

  it("refuses an update tail with a missing receipt instead of treating the page as empty", async () => {
    const page = await activePage();
    const accepted = await append(page);
    await harness.api.built.database.db.execute(sql`
      DELETE FROM page_operation_updates WHERE id = ${accepted.update.updateId}::uuid
    `);
    await refusesReplay(page.itemId);
  });

  it("refuses payloads compacted beyond the active replay checkpoint", async () => {
    const page = await activePage();
    await append(page);
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_updates
         SET base_frontier_envelope_id = NULL, update_envelope_id = NULL, compacted_at = now()
       WHERE page_id = ${page.itemId}::uuid
    `);
    await refusesReplay(page.itemId);
  });

  it("refuses a temporarily unavailable retained payload without changing its receipt", async () => {
    const page = await activePage();
    await append(page);
    const crypto = harness.api.built.pageOperationCrypto;
    if (crypto === undefined) throw new Error("Missing operational crypto");
    vi.spyOn(crypto, "openBytesMany").mockResolvedValueOnce(new Map());
    await refusesReplay(page.itemId);
  });

  it("refuses a retained update whose declared digest was damaged", async () => {
    const page = await activePage();
    await append(page);
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_updates SET update_digest = ${"0".repeat(64)}
       WHERE page_id = ${page.itemId}::uuid
    `);
    await refusesReplay(page.itemId);
  });

  it("refuses a retained causal tail whose dependency was lost", async () => {
    const page = await activePage();
    const accepted = await append(page);
    const child = page.author.transact([
      { type: "replace-text", blockId: accepted.blockId, from: 0, to: 7, text: "Later" },
    ]);
    const crypto = harness.api.built.pageOperationCrypto;
    if (crypto === undefined) throw new Error("Missing operational crypto");
    await harness.api.built.database.db.transaction(async (tx) => {
      const envelope = await crypto.sealBytes(tx, "update", child.updateBytes);
      await tx.execute(sql`
        UPDATE page_operation_updates
           SET update_envelope_id = ${envelope}::uuid, update_digest = ${await sha256Hex(child.updateBytes)}
         WHERE id = ${accepted.update.updateId}::uuid
      `);
    });
    await refusesReplay(page.itemId);
  });

  it("refuses a replay whose current frontier reverted behind its accepted tail", async () => {
    const page = await activePage();
    await append(page);
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_states s
         SET current_frontier_envelope_id = c.frontier_envelope_id
        FROM page_operation_checkpoints c
       WHERE s.page_id = ${page.itemId}::uuid AND c.id = s.current_checkpoint_id
    `);
    await refusesReplay(page.itemId);
  });

  it.each(["missing-boundary", "divergent-head", "no-change"] as const)(
    "does not record server-authored resolution with %s",
    async (scenario) => {
      const page = await activePage();
      if (scenario === "missing-boundary") {
        await harness.api.built.database.db.execute(sql`
          UPDATE page_operation_states SET last_revision_id = NULL WHERE page_id = ${page.itemId}::uuid
        `);
      } else if (scenario === "divergent-head") {
        const unrelated = await harness.createLegacyPage("Unrelated history");
        await harness.api.built.database.db.execute(sql`
          UPDATE items SET current_revision_id = ${unrelated.revisionId}::uuid WHERE id = ${page.itemId}::uuid
        `);
      }
      const before = await durableState(page.itemId);
      await expect(
        harness.api.built.database.db.transaction((tx) =>
          service().applyServerCommands(
            {
              pageId: page.itemId,
              deviceId: PAGE_OPERATION_DEVICE_ID,
              mutationId: generateUuidV7(),
              commands: [],
            },
            tx,
          ),
        ),
      ).rejects.toMatchObject({ code: "page-operations.projection-invalid", status: 409 });
      expect(await durableState(page.itemId)).toEqual(before);
    },
  );

  it("keeps a too-small download budget resumable without advancing the client frontier", async () => {
    const page = await activePage();
    await append(page);
    const limited = await synchronize(page.itemId, {
      ...request(page.initialFrontier),
      maxRemoteBytes: 1,
    });
    expect(limited).toMatchObject({ remoteUpdates: [], throughPageSequence: 0, hasMore: true });
    const resumed = await synchronize(page.itemId, request(page.initialFrontier));
    expect(resumed.remoteUpdates).toHaveLength(1);
    expect(resumed).toMatchObject({ throughPageSequence: 1, hasMore: false });
  });

  it("returns only a durable prefix when the next update exceeds the remaining download budget", async () => {
    const page = await activePage();
    const first = await append(page, "First retained update");
    const second = await append(page, "Second retained update");
    const limited = await synchronize(page.itemId, {
      ...request(page.initialFrontier),
      maxRemoteBytes: first.transaction.updateBytes.byteLength,
    });
    expect(limited.remoteUpdates.map(({ updateId }) => updateId)).toEqual([first.update.updateId]);
    expect(limited).toMatchObject({ throughPageSequence: 1, hasMore: true });
    const resumed = await synchronize(page.itemId, {
      ...request(first.transaction.resultVersionVector),
      knownServerPageSequence: limited.throughPageSequence,
    });
    expect(resumed.remoteUpdates.map(({ updateId }) => updateId)).toEqual([second.update.updateId]);
    expect(resumed).toMatchObject({ throughPageSequence: 2, hasMore: false });
  });

  it.each(["missing", "invalid-json", "null", "wrong-key", "invalid-blocks"] as const)(
    "does not dismiss a real delete/edit ambiguity whose protected details are %s",
    async (scenario) => {
      const page = await ambiguousPage();
      const crypto = harness.api.built.pageOperationCrypto;
      if (crypto === undefined) throw new Error("Missing operational crypto");
      if (scenario === "missing") {
        const open = crypto.openBytesMany.bind(crypto);
        vi.spyOn(crypto, "openBytesMany").mockImplementation((tx, kind, ids) =>
          kind === "ambiguity" ? Promise.resolve(new Map()) : open(tx, kind, ids),
        );
      } else {
        await harness.api.built.database.db.transaction(async (tx) => {
          const rows = await tx.execute(sql`
            SELECT logical_key FROM page_ambiguities WHERE page_id = ${page.itemId}::uuid
          `);
          const logicalKey = rows.rows[0]?.["logical_key"];
          if (typeof logicalKey !== "string") throw new Error("Missing ambiguity fixture");
          const raw =
            scenario === "invalid-json"
              ? "{"
              : scenario === "null"
                ? "null"
                : JSON.stringify({
                    logicalKey: scenario === "wrong-key" ? "Unrelated ambiguity" : logicalKey,
                    blockIds: scenario === "invalid-blocks" ? page.blockId : [page.blockId],
                  });
          const envelope = await crypto.sealBytes(tx, "ambiguity", new TextEncoder().encode(raw));
          await tx.execute(sql`
            UPDATE page_ambiguities SET details_envelope_id = ${envelope}::uuid
             WHERE page_id = ${page.itemId}::uuid
          `);
        });
      }
      const before = await durableState(page.itemId);
      const ambiguities = await harness.api.built.database.db.execute(sql`
        SELECT * FROM page_ambiguities WHERE page_id = ${page.itemId}::uuid
      `);
      await expect(synchronize(page.itemId, request(page.frontier))).rejects.toMatchObject({
        code: "page-operations.projection-invalid",
        status: 409,
      });
      expect(await durableState(page.itemId)).toEqual(before);
      expect(
        (
          await harness.api.built.database.db.execute(sql`
            SELECT * FROM page_ambiguities WHERE page_id = ${page.itemId}::uuid
          `)
        ).rows,
      ).toEqual(ambiguities.rows);
    },
  );

  it.each(["state-not-found", "state-not-active", "storage-unavailable"] as const)(
    "preserves the correct repair boundary for history failure %s",
    async (scenario) => {
      const page = await activePage();
      const cause =
        scenario === "storage-unavailable"
          ? new Error("Storage unavailable")
          : new PageOperationRepositoryError(scenario, "History unavailable");
      const runtime = service({ consolidateIfDue: vi.fn().mockRejectedValue(cause) });
      const before = await durableState(page.itemId);
      const attempt = synchronize(page.itemId, request(page.initialFrontier), runtime);
      if (scenario === "state-not-found") {
        await expect(attempt).rejects.toMatchObject({
          code: "page-operations.projection-invalid",
          status: 409,
        });
      } else {
        await expect(attempt).rejects.toBe(cause);
      }
      expect(await durableState(page.itemId)).toEqual(before);
    },
  );
});
