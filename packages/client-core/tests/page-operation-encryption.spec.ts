import {
  EncryptedPageOperationLog,
  LOCAL_ENTITY_TYPES,
  LocalCipher,
  type LocalDatabase,
  LocalIntegrityError,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  createLegacyOfflineBranch,
  OperationalPageDocument,
  type PageAmbiguity,
} from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const installationId = "018f2b7c-0000-7000-8000-000000000001";
const workspaceId = "018f2b7c-0000-7000-8000-0000000000aa";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;
let cipher: LocalCipher;

async function createLog(database: LocalDatabase): Promise<EncryptedPageOperationLog> {
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  cipher = new LocalCipher(keys);
  return new EncryptedPageOperationLog(database, cipher, {
    installationId,
    workspaceId,
  });
}

function pageWithPrivateParagraph(pageId: Uuid, blockId: Uuid, text: string) {
  return OperationalPageDocument.create({
    pageId,
    document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text }] }] },
  });
}

beforeEach(async () => {
  db = openLocalDatabase(`page-encryption-${generateUuidV7()}`);
  log = await createLog(db);
});

afterEach(async () => {
  await db.delete();
});

describe("encrypted operational page records", () => {
  it("round-trips state and updates without storing authored content in clear text", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = pageWithPrivateParagraph(pageId, blockId, "Acquisition target Nimbus");
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 25, to: 25, text: " — confidential" },
    ]);
    const updateId = generateUuidV7();

    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 1,
      createdAt: "2026-08-20T12:00:00.000Z",
    });

    const rawState = await db.pageOperationStates.get(pageId);
    const rawUpdate = await db.pageOperationUpdates.get(updateId);
    const raw = JSON.stringify({ rawState, rawUpdate });
    expect(raw).not.toContain("Acquisition");
    expect(raw).not.toContain("Nimbus");
    expect(raw).not.toContain("confidential");
    expect(rawState).not.toHaveProperty("checkpoint");
    expect(rawState).not.toHaveProperty("projection");
    expect(rawUpdate).not.toHaveProperty("updateBytes");
    expect(rawUpdate).not.toHaveProperty("semanticChanges");

    const openedState = await log.getState(pageId);
    const openedUpdate = await log.getUpdate(updateId);
    expect(JSON.stringify(openedState?.projection?.document)).toContain("confidential");
    expect(openedUpdate?.updateBytes).toEqual(transaction.updateBytes);
    expect(openedUpdate?.semanticChanges).toEqual(transaction.semanticChanges);
  });

  it("binds state and update ciphertext to both page and record identity", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = pageWithPrivateParagraph(pageId, blockId, "Bound secret");
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 12, to: 12, text: "!" },
    ]);
    const updateId = generateUuidV7();
    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 1,
    });
    const state = await db.pageOperationStates.get(pageId);
    const update = await db.pageOperationUpdates.get(updateId);
    expect(state).toBeDefined();
    expect(update).toBeDefined();
    if (state === undefined || update === undefined) return;

    const otherPageId = generateUuidV7();
    await expect(log.codec.openState({ ...state, pageId: otherPageId })).rejects.toBeInstanceOf(
      LocalIntegrityError,
    );
    await expect(log.codec.openUpdate({ ...update, pageId: otherPageId })).rejects.toBeInstanceOf(
      LocalIntegrityError,
    );
    await expect(
      log.codec.openUpdate({ ...update, updateId: generateUuidV7() }),
    ).rejects.toBeInstanceOf(LocalIntegrityError);
    await expect(log.codec.openUpdate({ ...update, status: "accepted" })).rejects.toThrow(
      "routing metadata mismatch",
    );
  });

  it("seals recoverable ambiguity details and complete legacy offline branches", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const sourceUpdateIds = [generateUuidV7(), generateUuidV7()] as const;
    const details: PageAmbiguity = {
      logicalKey: `delete-edit:${sourceUpdateIds.join(":")}:${blockId}`,
      kind: "delete-edit",
      status: "open",
      blockIds: [blockId],
      sourceUpdateIds,
      recoverableSubtree: {
        type: "paragraph",
        id: blockId,
        content: [{ text: "Recover the launch code phrase" }],
      },
      recoverablePlacement: { parentBlockId: null, beforeBlockId: null },
    };
    const ambiguityId = generateUuidV7();
    await log.putAmbiguity({
      ambiguityId,
      pageId,
      kind: details.kind,
      status: "open",
      openedAt: "2026-08-20T12:00:00.000Z",
      recordVersion: 1,
      details,
    });

    const branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: {
        blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Legacy private roadmap" }] }],
      },
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    await log.putLegacyBranch({
      pageId,
      branchId: branch.branchId,
      status: branch.status,
      createdAt: branch.createdAt,
      recordVersion: 1,
      branch,
      requiredFileIds: [generateUuidV7()],
    });

    const raw = JSON.stringify({
      ambiguity: await db.pageAmbiguities.get(ambiguityId),
      branch: await db.legacyOfflineBranches.get(pageId),
    });
    expect(raw).not.toContain("launch code");
    expect(raw).not.toContain("private roadmap");
    expect((await log.listOpenAmbiguities(pageId))[0]?.details).toEqual(details);
    expect((await log.getLegacyBranch(pageId))?.branch).toEqual(branch);
    expect(await log.listPageIdsWithLegacyBranches()).toEqual([pageId]);
  });

  it("recovers interrupted sending rows and prunes accepted updates only after inclusion", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = pageWithPrivateParagraph(pageId, blockId, "A");
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 1, to: 1, text: "B" },
    ]);
    const updateId = generateUuidV7();
    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 1,
    });
    await log.transitionUpdate(updateId, "sending");
    expect(await log.recoverInterruptedSending()).toBe(1);
    expect((await db.pageOperationUpdates.get(updateId))?.status).toBe("pending");

    await log.transitionUpdate(updateId, "sending");
    await log.transitionUpdate(updateId, "accepted", {
      pageSequence: 1,
      resultVersionVector: transaction.resultVersionVector,
      acceptedAt: "2026-08-20T12:01:00.000Z",
    });
    await expect(log.transitionUpdate(updateId, "sending")).rejects.toThrow(
      "cannot transition from accepted",
    );
    expect(await log.pruneAcceptedIncluded(pageId)).toEqual([]);
    await log.advanceServerFrontier(pageId, transaction.baseVersionVector, 0);
    expect(await log.pruneAcceptedIncluded(pageId)).toEqual([]);
    expect(await db.pageOperationUpdates.get(updateId)).toBeDefined();
    await log.advanceServerFrontier(pageId, transaction.resultVersionVector, 1);
    expect(await log.pruneAcceptedIncluded(pageId)).toEqual([updateId]);
    expect(await db.pageOperationUpdates.get(updateId)).toBeUndefined();
  });

  it("discovers queued page identities without opening or duplicating their envelopes", async () => {
    const pendingPageId = generateUuidV7();
    const pendingBlockId = generateUuidV7();
    const pendingPage = pageWithPrivateParagraph(pendingPageId, pendingBlockId, "Pending");
    const pendingStore = new LocalPageStateStore(log);
    for (let index = 0; index < 2; index += 1) {
      const transaction = pendingPage.transact([
        {
          type: "replace-text",
          blockId: pendingBlockId,
          from: index + 7,
          to: index + 7,
          text: String(index),
        },
      ]);
      await pendingStore.commitLocalTransaction({
        page: pendingPage,
        transaction,
        updateId: generateUuidV7(),
        enqueueOrder: index + 1,
      });
    }

    const sendingPageId = generateUuidV7();
    const sendingBlockId = generateUuidV7();
    const sendingPage = pageWithPrivateParagraph(sendingPageId, sendingBlockId, "Sending");
    const sendingTransaction = sendingPage.transact([
      { type: "replace-text", blockId: sendingBlockId, from: 7, to: 7, text: "!" },
    ]);
    const sendingUpdateId = generateUuidV7();
    await pendingStore.commitLocalTransaction({
      page: sendingPage,
      transaction: sendingTransaction,
      updateId: sendingUpdateId,
      enqueueOrder: 1,
    });
    await log.transitionUpdate(sendingUpdateId, "sending");

    const blockedPageId = generateUuidV7();
    const blockedBlockId = generateUuidV7();
    const blockedPage = pageWithPrivateParagraph(blockedPageId, blockedBlockId, "Blocked");
    const blockedTransaction = blockedPage.transact([
      { type: "replace-text", blockId: blockedBlockId, from: 7, to: 7, text: "!" },
    ]);
    const blockedUpdateId = generateUuidV7();
    await pendingStore.commitLocalTransaction({
      page: blockedPage,
      transaction: blockedTransaction,
      updateId: blockedUpdateId,
      enqueueOrder: 1,
    });
    await log.transitionUpdate(blockedUpdateId, "blocked");

    expect(await log.listPageIdsWithUpdates()).toEqual([pendingPageId, sendingPageId].sort());
    expect(await log.listPageIdsWithUpdates(["blocked"])).toEqual([blockedPageId]);
    expect(await log.countUpdates(["pending", "sending"])).toBe(3);
  });
});

describe("authenticated operational payload validation", () => {
  async function records() {
    const pageId = generateUuidV7(),
      blockId = generateUuidV7(),
      updateId = generateUuidV7();
    const page = pageWithPrivateParagraph(pageId, blockId, "Private draft");
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 13, to: 13, text: "!" },
    ]);
    await new LocalPageStateStore(log).commitLocalTransaction({
      page,
      transaction,
      updateId,
      enqueueOrder: 1,
    });
    const state = await db.pageOperationStates.get(pageId);
    const update = await db.pageOperationUpdates.get(updateId);
    if (state === undefined || update === undefined) throw new Error("Missing encrypted fixture");
    return { state, update, transaction };
  }
  function binding(entityType: string, entityId: string, recordVersion: number) {
    return { installationId, workspaceId, entityType, entityId, keyGeneration: 1, recordVersion };
  }
  function replacePath(payload: unknown, path: string, value: unknown): unknown {
    if (path === "$") return value;
    const copy = structuredClone(payload) as Record<string, unknown>;
    let target = copy;
    const parts = path.split(".");
    for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
    const last = parts.at(-1);
    if (last === undefined) throw new Error("Missing path");
    target[last] = value;
    return copy;
  }

  it.each([
    ["$", null],
    ["$", []],
    ["payloadVersion", 99],
    ["routing", []],
    ["versionVector", null],
    ["frontiers", 42],
    ["serverVersionVector", false],
    ["checkpoint", null],
    ["checkpoint", []],
    ["checkpoint.operationalFormat", "other"],
    ["checkpoint.operationalVersion", 99],
    ["checkpoint.pageId", generateUuidV7()],
    ["checkpoint.bytes", null],
    ["checkpoint.digest", false],
    ["checkpoint.versionVector", 1],
    ["checkpoint.frontiers", {}],
    ["projection", null],
    ["projection", []],
    ["projection.pageId", generateUuidV7()],
    ["projection.operationalFrontier", 1],
    ["projection.operationalDigest", null],
    ["projection.canonicalDigest", false],
    ["projection.document", null],
    ["projection.document", "not a document"],
    ["projection.pageLinkTargets", {}],
    ["projection.fileUsageIds", null],
    ["projection.warnings", {}],
    ["frontiers", "="],
    ["versionVector", "A"],
  ] as const)(
    "refuses an authenticated but malformed state field %s (%#) without modifying storage",
    async (path, replacement) => {
      const { state } = await records();
      const aad = binding(LOCAL_ENTITY_TYPES.pageOperationState, state.pageId, state.recordVersion);
      const payload = await cipher.open(aad, state.sealedState);
      const sealedState = await cipher.seal(aad, replacePath(payload, path, replacement));
      await expect(log.codec.openState({ ...state, sealedState })).rejects.toThrow();
      expect(await db.pageOperationStates.get(state.pageId)).toEqual(state);
    },
  );

  it.each([
    ["$", null],
    ["payloadVersion", 0],
    ["routing", null],
    ["baseVersionVector", false],
    ["resultVersionVector", null],
    ["resultFrontiers", {}],
    ["updateBytes", []],
    ["updateDigest", null],
    ["operationalVersion", 1.5],
    ["semanticChanges", {}],
    ["updateDigest", "0".repeat(64)],
    ["serverResult", null],
    ["serverResult", []],
    ["serverResult", { pageSequence: "1", resultVersionVector: "" }],
    ["serverResult", { pageSequence: 1, resultVersionVector: null }],
    ["serverResult", { pageSequence: 1, resultVersionVector: "", consolidatedRevisionId: 1 }],
    ["serverResult", { pageSequence: 1, resultVersionVector: "", acceptedAt: false }],
  ] as const)(
    "refuses an authenticated but malformed update field %s (%#) without modifying the queue",
    async (path, replacement) => {
      const { update } = await records();
      const aad = binding(
        LOCAL_ENTITY_TYPES.pageOperationUpdate,
        `${update.pageId}.${update.updateId}`,
        update.recordVersion,
      );
      const payload = await cipher.open(aad, update.sealedBody);
      const sealedBody = await cipher.seal(aad, replacePath(payload, path, replacement));
      await expect(log.codec.openUpdate({ ...update, sealedBody })).rejects.toThrow();
      expect(await db.pageOperationUpdates.get(update.updateId)).toEqual(update);
    },
  );

  it("round trips the server proof and rejects noncanonical vectors", async () => {
    const { update, transaction } = await records();
    const opened = await log.codec.openUpdate(update);
    const accepted = {
      ...opened,
      status: "accepted" as const,
      serverResult: {
        pageSequence: 1,
        resultVersionVector: transaction.resultVersionVector,
        consolidatedRevisionId: generateUuidV7(),
        acceptedAt: "2026-10-03T12:00:00.000Z",
      },
    };
    expect(await log.codec.openUpdate(await log.codec.sealUpdate(accepted))).toEqual(accepted);
    const aad = binding(
      LOCAL_ENTITY_TYPES.pageOperationUpdate,
      `${update.pageId}.${update.updateId}`,
      update.recordVersion,
    );
    const payload = await cipher.open(aad, update.sealedBody);
    const sealedBody = await cipher.seal(aad, replacePath(payload, "baseVersionVector", "AB"));
    await expect(log.codec.openUpdate({ ...update, sealedBody })).rejects.toThrow("non-canonical");
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "refuses invalid record versions %s before opening an envelope",
    async (recordVersion) => {
      const { state, update } = await records();
      await expect(log.codec.openState({ ...state, recordVersion })).rejects.toThrow(
        "positive integer",
      );
      await expect(log.codec.openUpdate({ ...update, recordVersion })).rejects.toThrow(
        "positive integer",
      );
    },
  );

  it("rejects state routing changes and frontiers that belong to another document", async () => {
    const { state } = await records();
    const opened = await log.codec.openState(state);
    for (const patch of [
      { latestServerPageSequence: -1 },
      { checkpoint: { ...opened.checkpoint, pageId: generateUuidV7() } },
      { projection: { ...opened.projection, pageId: generateUuidV7() } },
    ]) {
      await expect(log.codec.sealState({ ...opened, ...patch } as typeof opened)).rejects.toThrow();
    }
    const raw = await log.codec.sealState(opened);
    await expect(log.codec.openState({ ...raw, latestServerPageSequence: 8 })).rejects.toThrow(
      "routing metadata",
    );
  });
});
