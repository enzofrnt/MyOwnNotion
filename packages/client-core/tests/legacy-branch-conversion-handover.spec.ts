import {
  decodePageOperationBytes,
  EncryptedPageOperationLog,
  encodePageOperationBytes,
  type LegacyOfflineBranchRecord,
  LegacyPageEditingSession,
  LegacyPageStateStore,
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  LocalPageStateStore,
  MemorySecureStorage,
  openLocalDatabase,
  PageReconciler,
  type PageSyncTransport,
} from "@myownnotion/client-core";
import {
  type ActivePageSyncResponseDto,
  type LegacyOfflineBranchSyncRequestDto,
  PAGE_OPERATIONAL_VERSION,
  type PageSyncRequestDto,
} from "@myownnotion/contracts";
import { type BlockDocumentV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument } from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: LocalDatabase;
let log: EncryptedPageOperationLog;

beforeEach(async () => {
  db = openLocalDatabase(`legacy-handover-${generateUuidV7()}`);
  const keys = new LocalKeyManager(new MemorySecureStorage());
  await keys.establish();
  log = new EncryptedPageOperationLog(db, new LocalCipher(keys), {
    installationId: "018f2b7c-0000-7000-8000-000000000001",
    workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
  });
});

afterEach(async () => {
  await db.delete();
});

/**
 * A stand-in for the page-operations API: conversion replays the trusted
 * local document into shared history, and active syncs import pushed updates
 * exactly like the server would.
 */
class FakePageServer {
  readonly #pages = new Map<Uuid, OperationalPageDocument>();
  #sequence = 0;

  transport(): PageSyncTransport {
    return {
      sync: async (pageId, request) => await this.#sync(pageId, request),
      convertLegacyBranch: async (pageId, request) => await this.#convert(pageId, request),
    };
  }

  async canonicalBlocks(pageId: Uuid): Promise<BlockDocumentV3["blocks"]> {
    const page = this.#pages.get(pageId);
    if (page === undefined) throw new Error("the server never received this page");
    return (await page.project()).document.blocks;
  }

  async #convert(pageId: Uuid, request: LegacyOfflineBranchSyncRequestDto) {
    const localBlocks = (request.localDocument.body as { blocks: BlockDocumentV3["blocks"] })
      .blocks;
    const page = await OperationalPageDocument.create({
      pageId,
      document: { blocks: structuredClone(localBlocks) },
    });
    this.#pages.set(pageId, page);
    const checkpoint = await page.checkpoint();
    const projection = await page.project();
    return {
      ok: true as const,
      value: {
        mode: "checkpoint" as const,
        requestId: request.requestId,
        pageId,
        operationalVersion: PAGE_OPERATIONAL_VERSION,
        checkpointId: generateUuidV7(),
        checkpointBytes: encodePageOperationBytes(checkpoint.bytes),
        checkpointDigest: checkpoint.digest,
        versionVector: encodePageOperationBytes(checkpoint.versionVector),
        throughPageSequence: 0,
        canonicalDigest: projection.canonicalDigest,
        lastConsolidatedRevisionId: null,
        hasUnconsolidatedChanges: false,
        followingUpdates: [],
        latestPageSequence: 0,
        hasMore: false,
        ambiguities: [],
      },
    };
  }

  async #sync(
    pageId: Uuid,
    request: PageSyncRequestDto,
  ): Promise<{ ok: true; value: ActivePageSyncResponseDto }> {
    if (request.mode !== "active") throw new Error("unexpected sync mode");
    const page = this.#pages.get(pageId);
    if (page === undefined) throw new Error("active sync before conversion");
    const accepted: ActivePageSyncResponseDto["accepted"] = [];
    for (const update of request.updates) {
      const imported = page.importUpdate(decodePageOperationBytes(update.updateBytes));
      if (imported.pending) throw new Error("a pushed update was missing its dependencies");
      this.#sequence += 1;
      accepted.push({
        updateId: update.updateId,
        pageSequence: this.#sequence,
        resultVersionVector: encodePageOperationBytes(page.versionVectorBytes()),
      });
    }
    const projection = await page.project();
    return {
      ok: true,
      value: {
        mode: "active",
        requestId: request.requestId,
        pageId,
        accepted,
        repeated: [],
        remoteUpdates: [],
        serverVersionVector: encodePageOperationBytes(page.versionVectorBytes()),
        throughPageSequence: this.#sequence,
        latestPageSequence: this.#sequence,
        hasMore: false,
        canonical: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          digest: projection.canonicalDigest,
          lastConsolidatedRevisionId: null,
          hasUnconsolidatedChanges: true,
        },
        ambiguities: [],
        fileRequirements: [],
      },
    };
  }
}

function wiring(
  log: EncryptedPageOperationLog,
  server: FakePageServer,
  pageId: Uuid,
): { session: Promise<LegacyPageEditingSession>; reconciler: PageReconciler } {
  const reconciler = new PageReconciler({ pageId, log, transport: server.transport() });
  const open = LegacyPageEditingSession.open({
    pageId,
    baseRevisionId: generateUuidV7(),
    baseDocument: { blocks: [] },
    log,
    store: new LegacyPageStateStore(log),
    activeStore: new LocalPageStateStore(log),
    online: true,
    publishDurableUpdate: () => {
      void reconciler.synchronize();
    },
    requestConversion: async () => {
      const outcome = await reconciler.synchronize();
      return outcome.kind === "synced" ? "converted" : "unavailable";
    },
  });
  const session = open.then(async (opened) => {
    // The production attach path: durable-page installs upgrade in place.
    reconciler.subscribeDurablePage((state) => {
      if (state.status !== "active") return;
      return opened.adoptDurablePage();
    });
    return opened;
  });
  return { session, reconciler };
}

describe("legacy branch to active session handover", () => {
  it("converts on the first edit and reaches a synced active session", async () => {
    const server = new FakePageServer();
    const pageId = generateUuidV7();
    const { session: sessionPromise } = wiring(log, server, pageId);
    const session = await sessionPromise;
    const seededBlockId = session.read().blocks[0]?.id;
    if (seededBlockId === undefined) throw new Error("expected the seeded paragraph");

    await session.transact({
      type: "replace-text",
      blockId: seededBlockId,
      from: 0,
      to: 0,
      text: "bonjour",
    });

    await vi.waitFor(() => expect(session.sync.kind).toBe("synced"), { timeout: 5_000 });
    expect(session.read().blocks[0]).toMatchObject({ content: [{ text: "bonjour" }] });
    const serverBlocks = await server.canonicalBlocks(pageId);
    expect(serverBlocks[0]).toMatchObject({ content: [{ text: "bonjour" }] });
    const record: LegacyOfflineBranchRecord | null = await log.getLegacyBranch(pageId);
    expect(record?.status).toBe("converted");
  });

  it("keeps a rapid burst of gestures consistent across the conversion boundary", async () => {
    const server = new FakePageServer();
    const pageId = generateUuidV7();
    const { session: sessionPromise } = wiring(log, server, pageId);
    const session = await sessionPromise;
    const seededBlockId = session.read().blocks[0]?.id;
    if (seededBlockId === undefined) throw new Error("expected the seeded paragraph");

    // Gestures race the conversion round-trip exactly like fast typing: each
    // command is valid against the document state its predecessor produced.
    const words = ["alpha", "beta", "gamma", "delta"];
    let text = "";
    const burst = words.map((word) => {
      const insertAt = text.length;
      const insertion = text.length === 0 ? word : ` ${word}`;
      text += insertion;
      return session.transact({
        type: "replace-text",
        blockId: seededBlockId,
        from: insertAt,
        to: insertAt,
        text: insertion,
      });
    });
    await Promise.allSettled(burst);

    await vi.waitFor(() => expect(session.sync.kind).toBe("synced"), { timeout: 5_000 });
    const localText = JSON.stringify(session.read().blocks);
    const serverText = JSON.stringify(await server.canonicalBlocks(pageId));
    for (const word of words) {
      expect(localText).toContain(word);
      expect(serverText).toContain(word);
    }
    expect(localText).toBe(serverText);
  });
});
