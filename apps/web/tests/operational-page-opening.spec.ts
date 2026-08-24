import { encodePageOperationBytes, type PageEditingSession } from "@myownnotion/client-core";
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
  await Promise.all(services.splice(0).map(async (service) => await service.db.delete()));
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

  it("drains a new page creation before activating its canonical server head", async () => {
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
    vi.spyOn(service.pageOperationsApi, "checkpoint").mockResolvedValue({
      ok: false,
      offline: false,
      problem: { code: "page-operations.not-active", message: "Not active." },
    });
    vi.spyOn(service.outbox, "all")
      .mockResolvedValueOnce([
        {
          commandType: "item.create",
          payload: { id: pageId },
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
      getItem.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    opened.close();
  });
});
