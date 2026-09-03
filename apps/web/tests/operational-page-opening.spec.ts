import {
  encodePageOperationBytes,
  openLocalDatabase,
  type PageEditingSession,
} from "@myownnotion/client-core";
import {
  type ItemDto,
  PAGE_OPERATIONAL_VERSION,
  type PageCheckpointResponseDto,
} from "@myownnotion/contracts";
import {
  type BlockDocumentV3,
  documentDigestV3,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { OperationalPageDocument } from "@myownnotion/page-state";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentApi } from "../src/services/content-api.ts";
import { LocalContentService } from "../src/services/local-content.ts";

function workspaceApi(): ContentApi {
  return {
    submitMutationBatch: async () => ({ ok: true as const, value: { results: [] } }),
    listChanges: async () => ({
      ok: true as const,
      value: { changes: [], cursor: "0", hasMore: false },
    }),
    currentSnapshot: async () => ({
      ok: true as const,
      value: {
        workspaceId: generateUuidV7(),
        schemaVersion: 1,
        cursor: "0",
        items: [],
      },
    }),
    getItem: async () => ({
      ok: false as const,
      offline: false,
      problem: {
        type: "https://myownnotion.dev/problems/not-found",
        title: "Not found",
        status: 404,
        code: "item.not-found",
      },
    }),
  } as unknown as ContentApi;
}

function pageItem(pageId: Uuid, revisionId: Uuid, document: BlockDocumentV3): ItemDto {
  return {
    id: pageId,
    kind: "page",
    name: "Operational page",
    lifecycle: "active",
    currentRevisionId: revisionId,
    pageDocument: {
      format: "myownnotion.document+json",
      formatVersion: 3,
      body: document,
    },
    placements: [
      {
        id: generateUuidV7(),
        itemId: pageId,
        kind: "hierarchy",
        parentItemId: null,
        positionKey: "V",
      },
    ],
  };
}

async function checkpointResponse(input: {
  pageId: Uuid;
  requestId: Uuid;
  revisionId: Uuid;
  document: BlockDocumentV3;
}): Promise<PageCheckpointResponseDto> {
  const page = OperationalPageDocument.create({
    pageId: input.pageId,
    document: structuredClone(input.document),
  });
  const [checkpoint, projection] = await Promise.all([page.checkpoint(), page.project()]);
  return {
    mode: "checkpoint",
    requestId: input.requestId,
    pageId: input.pageId,
    operationalVersion: PAGE_OPERATIONAL_VERSION,
    checkpointId: generateUuidV7(),
    checkpointBytes: encodePageOperationBytes(checkpoint.bytes),
    checkpointDigest: checkpoint.digest,
    versionVector: encodePageOperationBytes(checkpoint.versionVector),
    throughPageSequence: 0,
    canonicalDigest: projection.canonicalDigest,
    lastConsolidatedRevisionId: input.revisionId,
    hasUnconsolidatedChanges: false,
    followingUpdates: [],
    latestPageSequence: 0,
    hasMore: false,
    ambiguities: [],
  };
}

const services: LocalContentService[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const opened = services.splice(0);
  const databaseNames = new Set(opened.map(({ db }) => db.name));
  for (const service of opened) service.db.close();
  for (const databaseName of databaseNames) await openLocalDatabase(databaseName).delete();
});

describe("operational page opening", () => {
  it("activates an online legacy projection before the editor accepts changes", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const service = new LocalContentService(workspaceApi(), `online-activation-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const revisionId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "Shared from the first gesture" }],
        },
      ],
    };
    const item = pageItem(pageId, revisionId, document);
    await service.repository.applyServerItems([item]);
    vi.spyOn(service.api, "getItem").mockResolvedValue({ ok: true, value: item });
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
      ok: false,
      offline: false,
      problem: {
        code: "page-operations.not-active",
        message: "The page is not active yet.",
      },
    });
    const activate = vi
      .spyOn(service.pageOperationsApi, "activate")
      .mockImplementation(async (activatedPageId, request) => ({
        ok: true,
        value: await checkpointResponse({
          pageId: activatedPageId,
          requestId: request.requestId as Uuid,
          revisionId,
          document,
        }),
      }));
    vi.spyOn(service.pageReconciler(pageId), "synchronize").mockResolvedValue({
      kind: "synced",
      exchanges: 0,
      latestPageSequence: 0,
      fileRequirements: [],
    });

    const opened = await service.openOperationalPage(pageId);

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.mode).toBe("active");
    expect((opened.session as PageEditingSession).read()).toEqual(document);
    expect(await service.pageOperationLog.getLegacyBranch(pageId)).toBeNull();
    expect(activate).toHaveBeenCalledWith(pageId, {
      requestId: expect.any(String),
      expectedRevisionId: revisionId,
      expectedCanonicalDigest: await documentDigestV3(document),
    });
    opened.close();
  });

  it("propagates a durable active-page edit between two service tabs without reload", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const databaseName = `tab-propagation-${Date.now()}`;
    const firstService = new LocalContentService(workspaceApi(), databaseName);
    const secondService = new LocalContentService(workspaceApi(), databaseName);
    services.push(firstService, secondService);
    await firstService.initialize();
    await secondService.initialize();

    const pageId = generateUuidV7();
    const revisionId = generateUuidV7();
    const blockId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Shared" }] }],
    };
    const item = pageItem(pageId, revisionId, document);
    await firstService.repository.applyServerItems([item]);
    vi.spyOn(firstService.pageOperationsApi, "checkpoint").mockImplementation(
      async (activatedPageId, requestId) => ({
        ok: true,
        value: await checkpointResponse({
          pageId: activatedPageId,
          requestId: requestId as Uuid,
          revisionId,
          document,
        }),
      }),
    );
    const synchronized = {
      kind: "synced" as const,
      exchanges: 0,
      latestPageSequence: 0,
      fileRequirements: [],
    };
    vi.spyOn(firstService.pageReconciler(pageId), "synchronize").mockResolvedValue(synchronized);
    vi.spyOn(secondService.pageReconciler(pageId), "synchronize").mockResolvedValue(synchronized);

    const first = await firstService.openOperationalPage(pageId);
    const second = await secondService.openOperationalPage(pageId);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    await first.session.transact({
      type: "replace-text",
      blockId,
      from: "Shared".length,
      to: "Shared".length,
      text: " between tabs",
    });

    await vi.waitFor(() =>
      expect(second.session.read().blocks[0]).toMatchObject({
        content: [{ text: "Shared between tabs" }],
      }),
    );
    expect(first.session.peerId).not.toBe(second.session.peerId);

    first.close();
    second.close();
    await Promise.resolve();
  });

  it("settles an in-flight activation before retiring the page authority", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const service = new LocalContentService(workspaceApi(), `activation-conversion-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const revisionId = generateUuidV7();
    const document: BlockDocumentV3 = { blocks: [] };
    const item = pageItem(pageId, revisionId, document);
    await service.repository.applyServerItems([item]);
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
      ok: false,
      offline: false,
      problem: { code: "page-operations.not-active", message: "Not active." },
    });
    vi.spyOn(service.api, "getItem").mockResolvedValue({ ok: true, value: item });
    vi.spyOn(service, "synchronize").mockResolvedValue("synced");

    let releaseActivation: (() => void) | undefined;
    const activationBlocked = new Promise<void>((resolve) => {
      releaseActivation = resolve;
    });
    const activate = vi
      .spyOn(service.pageOperationsApi, "activate")
      .mockImplementation(async (activatedPageId, request) => {
        await activationBlocked;
        return {
          ok: true,
          value: await checkpointResponse({
            pageId: activatedPageId,
            requestId: request.requestId as Uuid,
            revisionId,
            document,
          }),
        };
      });

    const reconciler = service.pageReconciler(pageId);
    vi.spyOn(reconciler, "synchronize").mockResolvedValue({
      kind: "synced",
      exchanges: 0,
      latestPageSequence: 0,
      fileRequirements: [],
    });

    const opening = service.openOperationalPage(pageId);
    await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());

    const conversion = service.mutate("item.convert", {
      itemId: pageId,
      targetKind: "folder",
      confirmedDestruction: false,
    });

    // Conversion must not overtake activation: doing so lets the operational
    // and workspace feeds report two valid changes in opposite local order and
    // creates a false conflict on slow browsers.
    await Promise.resolve();
    expect(await service.getItem(pageId)).toMatchObject({ kind: "page" });

    releaseActivation?.();
    const opened = await opening;
    const converted = await conversion;

    expect(opened).toMatchObject({ ok: true, mode: "active" });
    expect(converted).toEqual({ ok: true });
    expect(await service.pageOperationLog.getState(pageId)).toBeNull();
    expect(await service.pageOperationLog.listUpdates(pageId)).toEqual([]);
    expect(await service.getItem(pageId)).toMatchObject({ kind: "folder", pageDocument: null });
    if (opened.ok) opened.close();
  });

  it("checks unsynchronized operational text before allowing destructive conversion", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const service = new LocalContentService(workspaceApi(), `conversion-content-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const revisionId = generateUuidV7();
    const blockId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [{ type: "paragraph", id: blockId, content: [] }],
    };
    await service.repository.applyServerItems([pageItem(pageId, revisionId, document)]);
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockImplementation(
      async (checkpointPageId, requestId) => ({
        ok: true,
        value: await checkpointResponse({
          pageId: checkpointPageId,
          requestId: requestId as Uuid,
          revisionId,
          document,
        }),
      }),
    );
    vi.spyOn(service, "synchronize").mockResolvedValue("offline");
    vi.spyOn(service.pageReconciler(pageId), "synchronize").mockResolvedValue({
      kind: "offline",
      exchanges: 0,
      latestPageSequence: 0,
      fileRequirements: [],
    });

    const opened = await service.openOperationalPage(pageId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await opened.session.transact({
      type: "replace-text",
      blockId,
      from: 0,
      to: 0,
      text: "offline words that must not disappear",
    });

    const converted = await service.mutate("item.convert", {
      itemId: pageId,
      targetKind: "folder",
      confirmedDestruction: false,
    });

    expect(converted).toMatchObject({
      ok: false,
      error: { code: "conversion.confirmation-required" },
    });
    expect(await service.getItem(pageId)).toMatchObject({ kind: "page" });
    opened.close();
  });

  it("keeps a never-activated page editable on a durable branch when truly offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const service = new LocalContentService(workspaceApi(), `offline-branch-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const document: BlockDocumentV3 = { blocks: [] };
    await service.repository.applyServerItems([pageItem(pageId, generateUuidV7(), document)]);
    const activate = vi.spyOn(service.pageOperationsApi, "activate");

    const opened = await service.openOperationalPage(pageId);

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.mode).toBe("legacy-branch");
    expect(activate).not.toHaveBeenCalled();
    opened.close();
  });

  it("reopens retained offline work before fetching an active server checkpoint", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const service = new LocalContentService(workspaceApi(), `retained-first-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const revisionId = generateUuidV7();
    await service.repository.applyServerItems([pageItem(pageId, revisionId, { blocks: [] })]);

    const offline = await service.openOperationalPage(pageId);
    expect(offline.ok).toBe(true);
    if (!offline.ok) return;
    expect(offline.mode).toBe("legacy-branch");
    const blockId = offline.session.read().blocks[0]?.id;
    if (blockId === undefined) throw new Error("the offline editor has no bootstrap block");
    await offline.session.transact({
      type: "replace-text",
      blockId,
      from: 0,
      to: 0,
      text: "retained offline words",
    });
    offline.close();

    vi.stubGlobal("navigator", { onLine: true });
    const checkpoint = vi
      .spyOn(service.pageOperationsApi, "checkpoint")
      .mockImplementation(async (checkpointPageId, requestId) => ({
        ok: true,
        value: await checkpointResponse({
          pageId: checkpointPageId,
          requestId: requestId as Uuid,
          revisionId,
          document: {
            blocks: [
              {
                type: "paragraph",
                id: generateUuidV7(),
                content: [{ text: "newer server words" }],
              },
            ],
          },
        }),
      }));
    vi.spyOn(service.pageReconciler(pageId), "convertLegacyBranch").mockResolvedValue({
      kind: "pending",
      exchanges: 0,
      latestPageSequence: 0,
      fileRequirements: [],
      problemCode: "test.conversion-held",
    });

    const reopened = await service.openOperationalPage(pageId);

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.mode).toBe("legacy-branch");
    expect(reopened.session.read().blocks[0]).toMatchObject({
      content: [{ text: "retained offline words" }],
    });
    expect(checkpoint).not.toHaveBeenCalled();
    reopened.close();
  });

  it("refreshes the canonical head when activation races one last legacy write", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const service = new LocalContentService(workspaceApi(), `stale-activation-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const firstRevisionId = generateUuidV7();
    const secondRevisionId = generateUuidV7();
    const firstDocument: BlockDocumentV3 = {
      blocks: [{ type: "paragraph", id: generateUuidV7(), content: [{ text: "first head" }] }],
    };
    const secondDocument: BlockDocumentV3 = {
      blocks: [{ type: "paragraph", id: generateUuidV7(), content: [{ text: "newer head" }] }],
    };
    await service.repository.applyServerItems([pageItem(pageId, firstRevisionId, firstDocument)]);
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
      ok: false,
      offline: false,
      problem: { code: "page-operations.not-active", message: "Not active." },
    });
    const getItem = vi
      .spyOn(service.api, "getItem")
      .mockResolvedValueOnce({
        ok: true,
        value: pageItem(pageId, firstRevisionId, firstDocument),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: pageItem(pageId, secondRevisionId, secondDocument),
      });
    const activate = vi
      .spyOn(service.pageOperationsApi, "activate")
      .mockResolvedValueOnce({
        ok: false,
        offline: false,
        problem: {
          code: "page-operations.activation-stale",
          message: "The canonical head moved.",
        },
      })
      .mockImplementationOnce(async (activatedPageId, request) => ({
        ok: true,
        value: await checkpointResponse({
          pageId: activatedPageId,
          requestId: request.requestId as Uuid,
          revisionId: secondRevisionId,
          document: secondDocument,
        }),
      }));
    vi.spyOn(service.pageReconciler(pageId), "synchronize").mockResolvedValue({
      kind: "synced",
      exchanges: 0,
      latestPageSequence: 0,
      fileRequirements: [],
    });

    const opened = await service.openOperationalPage(pageId);

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.mode).toBe("active");
    expect(opened.session.read()).toEqual(secondDocument);
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(await service.pageOperationLog.getLegacyBranch(pageId)).toBeNull();
    opened.close();
  });

  it("does not disguise repeated connected activation races as an offline branch", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const service = new LocalContentService(workspaceApi(), `stale-exhausted-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const revisionId = generateUuidV7();
    const document: BlockDocumentV3 = { blocks: [] };
    const item = pageItem(pageId, revisionId, document);
    await service.repository.applyServerItems([item]);
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
      ok: false,
      offline: false,
      problem: { code: "page-operations.not-active", message: "Not active." },
    });
    const getItem = vi.spyOn(service.api, "getItem").mockResolvedValue({ ok: true, value: item });
    const activate = vi.spyOn(service.pageOperationsApi, "activate").mockResolvedValue({
      ok: false,
      offline: false,
      problem: {
        code: "page-operations.activation-stale",
        message: "The canonical head moved.",
      },
    });

    const opened = await service.openOperationalPage(pageId);

    expect(opened).toMatchObject({
      ok: false,
      offline: false,
      code: "page-operations.activation-stale",
    });
    expect(getItem).toHaveBeenCalledTimes(3);
    expect(activate).toHaveBeenCalledTimes(3);
    expect(await service.pageOperationLog.getLegacyBranch(pageId)).toBeNull();
  });

  it("does not create an offline branch when the connected server says the page is gone", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const service = new LocalContentService(workspaceApi(), `missing-page-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    await service.repository.applyServerItems([pageItem(pageId, generateUuidV7(), { blocks: [] })]);
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
      ok: false,
      offline: false,
      problem: { code: "page-operations.not-active", message: "Not active." },
    });

    const opened = await service.openOperationalPage(pageId);

    expect(opened).toMatchObject({ ok: false, offline: false, code: "item.not-found" });
    expect(await service.pageOperationLog.getLegacyBranch(pageId)).toBeNull();
  });

  it("falls back to the durable semantic branch when the activation transport disappears", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const service = new LocalContentService(workspaceApi(), `activation-offline-${Date.now()}`);
    services.push(service);
    await service.initialize();

    const pageId = generateUuidV7();
    const revisionId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [{ type: "paragraph", id: generateUuidV7(), content: [{ text: "kept locally" }] }],
    };
    const item = pageItem(pageId, revisionId, document);
    await service.repository.applyServerItems([item]);
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
      ok: false,
      offline: false,
      problem: { code: "page-operations.not-active", message: "Not active." },
    });
    vi.spyOn(service.api, "getItem").mockResolvedValue({ ok: true, value: item });
    vi.spyOn(service.pageOperationsApi, "activate").mockResolvedValue({
      ok: false,
      offline: true,
      problem: { code: "network.unreachable", message: "Offline." },
    });

    const opened = await service.openOperationalPage(pageId);

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.mode).toBe("legacy-branch");
    expect(opened.session.read()).toEqual(document);
    opened.close();
  });

  it.each(["item.create", "item.convert"] as const)(
    "drains a pending %s before checking or activating its canonical server head",
    async (commandType) => {
      vi.stubGlobal("navigator", { onLine: true });
      const service = new LocalContentService(workspaceApi(), `creation-barrier-${Date.now()}`);
      services.push(service);
      await service.initialize();

      const pageId = generateUuidV7();
      const revisionId = generateUuidV7();
      const document: BlockDocumentV3 = {
        blocks: [{ type: "paragraph", id: generateUuidV7(), content: [{ text: "new page" }] }],
      };
      const item = pageItem(pageId, revisionId, document);
      await service.repository.applyServerItems([item]);
      const checkpoint = vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
        ok: false,
        offline: false,
        problem: { code: "page-operations.not-active", message: "Not active." },
      });
      vi.spyOn(service.outbox, "all")
        .mockResolvedValueOnce([
          {
            commandType,
            payload:
              commandType === "item.create"
                ? { id: pageId }
                : { itemId: pageId, targetKind: "page" },
          } as never,
        ])
        .mockResolvedValue([]);
      vi.spyOn(service.outbox, "conflicts").mockResolvedValue([]);
      const synchronize = vi.spyOn(service, "synchronize").mockResolvedValue("synced");
      const getItem = vi.spyOn(service.api, "getItem").mockResolvedValue({ ok: true, value: item });
      vi.spyOn(service.pageOperationsApi, "activate").mockImplementation(
        async (activatedPageId, request) => ({
          ok: true,
          value: await checkpointResponse({
            pageId: activatedPageId,
            requestId: request.requestId as Uuid,
            revisionId,
            document,
          }),
        }),
      );
      vi.spyOn(service.pageReconciler(pageId), "synchronize").mockResolvedValue({
        kind: "synced",
        exchanges: 0,
        latestPageSequence: 0,
        fileRequirements: [],
      });

      const opened = await service.openOperationalPage(pageId);

      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.mode).toBe("active");
      expect(synchronize).toHaveBeenCalledOnce();
      expect(synchronize.mock.invocationCallOrder[0]).toBeLessThan(
        checkpoint.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      expect(synchronize.mock.invocationCallOrder[0]).toBeLessThan(
        getItem.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      opened.close();
    },
  );
});
