import {
  EncryptedPageOperationLog,
  LOCAL_ENTITY_TYPES,
  LocalCipher,
  type LocalDatabase,
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;
let cipher: LocalCipher;
const context = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
};

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing fixture");
  return value;
}

beforeEach(async () => {
  db = openLocalDatabase(`page-log-resume-${generateUuidV7()}`);
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  cipher = new LocalCipher(keys);
  log = new EncryptedPageOperationLog(db, cipher, context);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

async function seed() {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const page = OperationalPageDocument.create({
    pageId,
    document: {
      blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Unsent private draft" }] }],
    },
  });
  const transaction = page.transact([
    { type: "replace-text", blockId, from: 19, to: 19, text: "!" },
  ]);
  const updateId = generateUuidV7();
  const committed = await new LocalPageStateStore(log).commitLocalTransaction({
    page,
    transaction,
    updateId,
    enqueueOrder: 1,
  });
  return { pageId, blockId, page, transaction, updateId, ...committed };
}

async function snapshot() {
  return await Promise.all([
    db.pageOperationStates.toArray(),
    db.pageOperationUpdates.toArray(),
    db.pageAmbiguities.toArray(),
    db.legacyOfflineBranches.toArray(),
  ]);
}

async function accepted() {
  const data = await seed();
  await log.transitionUpdate(data.updateId, "sending");
  await log.transitionUpdate(data.updateId, "accepted", {
    pageSequence: 1,
    resultVersionVector: data.transaction.resultVersionVector,
  });
  await log.advanceServerFrontier(data.pageId, data.transaction.resultVersionVector, 1);
  return data;
}

describe("durable editorial notices during boot (FR-005)", () => {
  it.each(["page", "length", "bytes", "vector"])(
    "rejects a notice with the wrong %s without importing or changing local authority",
    async (field) => {
      const data = await seed();
      const notice = {
        pageId: data.pageId,
        updateId: data.updateId,
        updateBytes: data.transaction.updateBytes.slice(),
        resultVersionVector: data.transaction.resultVersionVector,
      };
      if (field === "page") notice.pageId = generateUuidV7();
      if (field === "length") notice.updateBytes = notice.updateBytes.slice(1);
      if (field === "bytes") notice.updateBytes[0] = (notice.updateBytes[0] ?? 0) ^ 1;
      if (field === "vector") notice.resultVersionVector = data.transaction.baseVersionVector;
      const before = await snapshot();
      await expect(log.assertDurableUpdate(notice)).rejects.toThrow("does not match");
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["absent page", "uncommitted frontier"])(
    "rejects a notice for an %s when its update row is absent",
    async (state) => {
      const data = await seed();
      const later = data.page.transact([
        { type: "replace-text", blockId: data.blockId, from: 0, to: 0, text: "Not yet durable " },
      ]);
      const before = await snapshot();
      await expect(
        log.assertDurableUpdate({
          pageId: state === "absent page" ? generateUuidV7() : data.pageId,
          updateId: generateUuidV7(),
          updateBytes: later.updateBytes,
          resultVersionVector: later.resultVersionVector,
        }),
      ).rejects.toThrow("not present");
      expect(await snapshot()).toEqual(before);
    },
  );

  it("routes initialized-but-offloaded pages without pretending their editorial content is present", async () => {
    const data = await seed();
    await db.pageOperationStates.put(
      await log.codec.sealState({
        ...data.state,
        status: "initializing",
        checkpoint: null,
        projection: null,
        localAvailability: "never-fetched",
      }),
    );
    const result = await log.readPageSnapshot(data.pageId);
    expect(result.state).toMatchObject({
      status: "initializing",
      checkpoint: null,
      projection: null,
      localAvailability: "never-fetched",
    });
    expect(result.updates).toEqual([data.update]);
    expect(JSON.stringify(await db.pageOperationStates.get(data.pageId))).not.toContain(
      "private draft",
    );
  });

  it("refuses corrupted routing identities before opening the encrypted queue body", async () => {
    await db.pageOperationUpdates.put({
      updateId: generateUuidV7(),
      pageId: 42,
      status: "pending",
      enqueueOrder: 1,
      recordVersion: 1,
    } as never);
    const opened = vi.spyOn(log.codec, "openUpdate");
    const before = await snapshot();
    await expect(log.listPageIdsWithUpdates()).rejects.toThrow("routing key");
    expect(opened).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it("refuses corrupted legacy routing identities without consuming recovery branches", async () => {
    await db.legacyOfflineBranches.put({
      pageId: 42,
      branchId: generateUuidV7(),
      status: "editing",
      recordVersion: 1,
    } as never);
    const opened = vi.spyOn(log.codec, "openLegacyBranch");
    const before = await snapshot();
    await expect(log.listPageIdsWithLegacyBranches()).rejects.toThrow("routing key");
    expect(opened).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
});

describe("editorial queue and checkpoint claims", () => {
  it("refuses an update with bytes that do not match its digest before persistence", async () => {
    const data = await seed();
    const before = await snapshot();
    await expect(
      log.codec.sealUpdate({ ...data.update, updateDigest: "0".repeat(64) }),
    ).rejects.toThrow("digest mismatch");
    expect(await snapshot()).toEqual(before);
  });

  it.each(["future checkpoint", "checkpoint frontier", "projection frontier"])(
    "refuses a state claiming a %s inconsistent with its durable vector",
    async (claim) => {
      const data = await seed();
      const later = data.page.transact([
        { type: "replace-text", blockId: data.blockId, from: 0, to: 0, text: "Future " },
      ]);
      const checkpoint = required(data.state.checkpoint);
      const projection = required(data.state.projection);
      const state =
        claim === "future checkpoint"
          ? { ...data.state, checkpoint: await data.page.checkpoint() }
          : claim === "checkpoint frontier"
            ? { ...data.state, checkpoint: { ...checkpoint, frontiers: later.resultFrontiers } }
            : {
                ...data.state,
                projection: { ...projection, operationalFrontier: later.resultFrontiers },
              };
      const before = await snapshot();
      await expect(log.codec.sealState(state)).rejects.toThrow(
        claim === "future checkpoint" ? "does not descend" : "frontiers differ",
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it("rejects a missing update status transition without creating a replacement record", async () => {
    await seed();
    const before = await snapshot();
    await expect(log.transitionUpdate(generateUuidV7(), "sending")).rejects.toThrow("not found");
    expect(await snapshot()).toEqual(before);
  });

  it.each(["missing proof", "older proof"])(
    "keeps sending bytes when acknowledgement has %s",
    async (claim) => {
      const data = await seed();
      await log.transitionUpdate(data.updateId, "sending");
      const before = await snapshot();
      await expect(
        log.transitionUpdate(
          data.updateId,
          "accepted",
          claim === "missing proof"
            ? undefined
            : { pageSequence: 1, resultVersionVector: data.transaction.baseVersionVector },
        ),
      ).rejects.toThrow(
        claim === "missing proof" ? "requires its sealed server result" : "does not include",
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it("does not move an independently accepted update back to pending during interrupted-send recovery", async () => {
    const data = await seed();
    await log.transitionUpdate(data.updateId, "sending");
    const sender = required(await log.getUpdate(data.updateId));
    const seal = log.codec.sealUpdate.bind(log.codec);
    let winner = await snapshot();
    vi.spyOn(log.codec, "sealUpdate").mockImplementationOnce(async (record) => {
      const prepared = await seal(record);
      await db.pageOperationUpdates.put(
        await seal({
          ...sender,
          status: "accepted",
          recordVersion: sender.recordVersion + 1,
          serverResult: {
            pageSequence: 1,
            resultVersionVector: data.transaction.resultVersionVector,
          },
        }),
      );
      winner = await snapshot();
      return prepared;
    });
    await expect(log.recoverInterruptedSending(data.pageId)).rejects.toThrow(
      "changed while recovering",
    );
    expect(await snapshot()).toEqual(winner);
    expect((await log.getUpdate(data.updateId))?.status).toBe("accepted");
  });

  it("keeps the newer blocked record when another writer changes status during sealing", async () => {
    const data = await seed();
    const seal = log.codec.sealUpdate.bind(log.codec);
    let winner = await snapshot();
    vi.spyOn(log.codec, "sealUpdate").mockImplementationOnce(async (record) => {
      const prepared = await seal(record);
      await db.pageOperationUpdates.put(
        await seal({
          ...data.update,
          status: "blocked",
          recordVersion: data.update.recordVersion + 1,
        }),
      );
      winner = await snapshot();
      return prepared;
    });
    await expect(log.transitionUpdate(data.updateId, "sending")).rejects.toThrow(
      "changed during status transition",
    );
    expect(await snapshot()).toEqual(winner);
    expect((await log.getUpdate(data.updateId))?.status).toBe("blocked");
  });

  it.each(["missing state", "retreating vector", "retreating sequence"])(
    "preserves unsent bytes when server-frontier advancement sees a %s",
    async (claim) => {
      const data = await seed();
      await log.advanceServerFrontier(data.pageId, data.transaction.resultVersionVector, 2);
      if (claim === "missing state") await db.pageOperationStates.delete(data.pageId);
      const before = await snapshot();
      await expect(
        log.advanceServerFrontier(
          data.pageId,
          claim === "retreating vector"
            ? data.transaction.baseVersionVector
            : data.transaction.resultVersionVector,
          claim === "retreating sequence" ? 1 : 2,
        ),
      ).rejects.toThrow(claim === "missing state" ? "not found" : "cannot retreat");
      expect(await snapshot()).toEqual(before);
    },
  );

  it("preserves the newer state when its server frontier advances while the prior result seals", async () => {
    const data = await seed();
    const seal = log.codec.sealState.bind(log.codec);
    let winner = await snapshot();
    vi.spyOn(log.codec, "sealState").mockImplementationOnce(async (record) => {
      const prepared = await seal(record);
      await db.pageOperationStates.put(
        await seal({
          ...data.state,
          recordVersion: data.state.recordVersion + 1,
          serverVersionVector: data.transaction.resultVersionVector,
          latestServerPageSequence: 2,
        }),
      );
      winner = await snapshot();
      return prepared;
    });
    await expect(
      log.advanceServerFrontier(data.pageId, data.transaction.resultVersionVector, 1),
    ).rejects.toThrow("changed while advancing");
    expect(await snapshot()).toEqual(winner);
    expect((await log.getState(data.pageId))?.latestServerPageSequence).toBe(2);
  });

  it.each(["state advances", "another context prunes"])(
    "rechecks included updates atomically before deleting when %s",
    async (race) => {
      const data = await accepted();
      const state = required(await log.getState(data.pageId));
      const open = log.codec.openUpdate.bind(log.codec);
      let winner = await snapshot();
      vi.spyOn(log.codec, "openUpdate").mockImplementationOnce(async (row) => {
        const opened = await open(row);
        if (race === "state advances")
          await db.pageOperationStates.put(
            await log.codec.sealState({ ...state, recordVersion: state.recordVersion + 1 }),
          );
        else await db.pageOperationUpdates.delete(data.updateId);
        winner = await snapshot();
        return opened;
      });
      await expect(log.pruneAcceptedIncluded(data.pageId)).rejects.toThrow(
        race === "state advances" ? "state changed while pruning" : "update changed while pruning",
      );
      expect(await snapshot()).toEqual(winner);
    },
  );
});

describe("retained encrypted recovery details", () => {
  function ambiguity(pageId: Uuid) {
    const blockId = generateUuidV7();
    const details: PageAmbiguity = {
      logicalKey: `delete-edit:${blockId}`,
      kind: "delete-edit",
      status: "open",
      blockIds: [blockId],
      sourceUpdateIds: [generateUuidV7(), generateUuidV7()],
      recoverableSubtree: {
        type: "paragraph",
        id: blockId,
        content: [{ text: "Unsent recovery text" }],
      },
      recoverablePlacement: { parentBlockId: null, beforeBlockId: null },
    };
    return {
      ambiguityId: generateUuidV7(),
      pageId,
      kind: details.kind,
      status: "open" as const,
      openedAt: "2026-10-07T12:00:00.000Z",
      recordVersion: 1,
      details,
    };
  }

  it("refuses a recovery kind mismatch before sealing a misleading routing record", async () => {
    const data = await seed();
    const record = ambiguity(data.pageId);
    const before = await snapshot();
    await expect(log.putAmbiguity({ ...record, kind: "delete-move" })).rejects.toThrow(
      "kind does not match",
    );
    expect(await snapshot()).toEqual(before);
  });

  it("refuses authenticated ambiguity details that contradict the durable routing kind after restart", async () => {
    const data = await seed();
    const record = ambiguity(data.pageId);
    await log.putAmbiguity(record);
    const row = required(await db.pageAmbiguities.get(record.ambiguityId));
    const aad = {
      ...context,
      entityType: LOCAL_ENTITY_TYPES.pageAmbiguityDetails,
      entityId: `${row.pageId}.${row.ambiguityId}`,
      keyGeneration: 1,
      recordVersion: row.recordVersion,
    };
    const payload = (await cipher.open(aad, row.sealedDetails)) as {
      details: Record<string, unknown>;
    };
    await db.pageAmbiguities.put({
      ...row,
      sealedDetails: await cipher.seal(aad, {
        ...payload,
        details: { ...payload.details, kind: "delete-move" },
      }),
    });
    const before = await snapshot();
    const name = db.name;
    db.close();
    db = openLocalDatabase(name);
    log = new EncryptedPageOperationLog(db, cipher, context);
    await expect(log.readPageSnapshot(data.pageId)).rejects.toThrow("ambiguity metadata mismatch");
    expect(await snapshot()).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("Unsent recovery text");
  });

  async function branchRecord(pageId: Uuid) {
    const branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: {
        blocks: [
          {
            type: "paragraph",
            id: generateUuidV7(),
            content: [{ text: "Unsent legacy private note" }],
          },
        ],
      },
      createdAt: "2026-10-07T12:00:00.000Z",
    });
    return {
      pageId,
      branchId: branch.branchId,
      status: branch.status,
      createdAt: branch.createdAt,
      recordVersion: 1,
      branch,
      requiredFileIds: [generateUuidV7()],
    };
  }

  it("refuses a legacy branch whose page identity differs from its durable routing", async () => {
    const data = await seed();
    const record = await branchRecord(data.pageId);
    const before = await snapshot();
    await expect(log.putLegacyBranch({ ...record, pageId: generateUuidV7() })).rejects.toThrow(
      "does not match its routing",
    );
    expect(await snapshot()).toEqual(before);
  });

  it.each(["file requirements", "branch identity"])(
    "retains and refuses an authenticated legacy branch with invalid %s",
    async (claim) => {
      const data = await seed();
      const record = await branchRecord(data.pageId);
      await log.putLegacyBranch(record);
      const row = required(await db.legacyOfflineBranches.get(data.pageId));
      const aad = {
        ...context,
        entityType: LOCAL_ENTITY_TYPES.legacyOfflineBranch,
        entityId: `${row.pageId}.${row.branchId}`,
        keyGeneration: 1,
        recordVersion: row.recordVersion,
      };
      const payload = (await cipher.open(aad, row.sealedBranch)) as {
        branch: Record<string, unknown>;
      };
      const replacement =
        claim === "file requirements"
          ? { ...payload, requiredFileIds: null }
          : { ...payload, branch: { ...payload.branch, pageId: generateUuidV7() } };
      await db.legacyOfflineBranches.put({
        ...row,
        sealedBranch: await cipher.seal(aad, replacement),
      });
      const before = await snapshot();
      await expect(log.getLegacyBranch(data.pageId)).rejects.toThrow(
        claim === "file requirements" ? "file requirements" : "branch metadata mismatch",
      );
      expect(await snapshot()).toEqual(before);
      expect(JSON.stringify(before)).not.toContain("legacy private note");
    },
  );
});
