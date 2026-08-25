// @vitest-environment jsdom

import { PAGE_OPERATION_PROTOCOL_VERSION, type QueuedMutationDto } from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeSyncLifecycle } from "../src/features/sync/realtime-sync-lifecycle.ts";
import type { ContentApi } from "../src/services/content-api.ts";
import { LocalContentService } from "../src/services/local-content.ts";
import { FakeWebSocketFactory } from "./support/fake-websocket.ts";

const services: LocalContentService[] = [];
const lifecycles: RealtimeSyncLifecycle[] = [];

function contentApi(): ContentApi {
  return {
    submitMutationBatch: async () => ({ ok: true as const, value: { results: [] } }),
    listChanges: async () => ({
      ok: true as const,
      value: { changes: [], cursor: "0", hasMore: false },
    }),
    currentSnapshot: async () => ({
      ok: true as const,
      value: { workspaceId: generateUuidV7(), schemaVersion: 1, cursor: "0", items: [] },
    }),
  } as unknown as ContentApi;
}

function serviceWithSocket() {
  const factory = new FakeWebSocketFactory();
  const service = new LocalContentService(contentApi(), `realtime-${generateUuidV7()}`, {
    realtime: { socketFactory: factory.create, reconnect: false },
  });
  services.push(service);
  service.configurePageOperationAuthorization(() => "csrf-secret");
  return { factory, service };
}

function makeReady(requestId: string) {
  return {
    type: "ready",
    requestId,
    connectionId: generateUuidV7(),
    realtimeProtocolVersion: 1,
    pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
    heartbeatIntervalMs: 20_000,
    requestTimeoutMs: 30_000,
    maxMessageBytes: 2 * 1024 * 1024,
    maxInFlight: 8,
  };
}

afterEach(async () => {
  for (const lifecycle of lifecycles.splice(0)) lifecycle.stop();
  for (const service of services.splice(0)) await service.db.delete();
});

describe("LocalContentService realtime integration", () => {
  it("drains operational pages as soon as the authenticated channel is ready", async () => {
    const { factory, service } = serviceWithSocket();
    const drain = vi.spyOn(service, "synchronizeOperationalPages").mockResolvedValue(true);
    const lifecycle = new RealtimeSyncLifecycle(service);
    lifecycles.push(lifecycle);

    lifecycle.start();
    expect(factory.sockets).toHaveLength(1);
    const socket = factory.latest;
    socket.open();
    const hello = JSON.parse(socket.sent[0] ?? "null") as { requestId: string };
    socket.serverMessage(makeReady(hello.requestId));

    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());
  });

  it("routes a newer announcement to that page's reconciler and ignores a dominated one", async () => {
    const { service } = serviceWithSocket();
    const pageId = generateUuidV7();
    await service.db.open();
    vi.spyOn(service.pageOperationLog, "getState").mockResolvedValue({
      pageId,
      latestServerPageSequence: 4,
    } as never);
    const synchronize = vi.fn().mockResolvedValue({
      kind: "synced" as const,
      exchanges: 1,
      latestPageSequence: 6,
      fileRequirements: [],
    });
    vi.spyOn(service, "pageReconciler").mockReturnValue({ synchronize } as never);

    await expect(
      service.reconcileRealtimePageAdvance({ pageId, latestPageSequence: 4 }),
    ).resolves.toBe(true);
    expect(synchronize).not.toHaveBeenCalled();

    await expect(
      service.reconcileRealtimePageAdvance({ pageId, latestPageSequence: 6 }),
    ).resolves.toBe(true);
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("forwards page announcements from the shared socket without importing frame content", async () => {
    const { factory, service } = serviceWithSocket();
    const reconcile = vi.spyOn(service, "reconcileRealtimePageAdvance").mockResolvedValue(true);
    vi.spyOn(service, "synchronizeOperationalPages").mockResolvedValue(true);
    const lifecycle = new RealtimeSyncLifecycle(service);
    lifecycles.push(lifecycle);
    lifecycle.start();
    const socket = factory.latest;
    socket.open();
    const hello = JSON.parse(socket.sent[0] ?? "null") as { requestId: string };
    socket.serverMessage(makeReady(hello.requestId));
    const pageId = generateUuidV7();

    socket.serverMessage({ type: "page-advanced", pageId, latestPageSequence: 12 });

    await vi.waitFor(() =>
      expect(reconcile).toHaveBeenCalledWith({ pageId, latestPageSequence: 12 }),
    );
    expect(factory.sockets).toHaveLength(1);
  });

  it("closes the shared page channel while the browser is offline and resumes it online", () => {
    const { factory, service } = serviceWithSocket();
    vi.spyOn(service, "synchronizeOperationalPages").mockResolvedValue(true);
    const lifecycle = new RealtimeSyncLifecycle(service);
    lifecycles.push(lifecycle);
    lifecycle.start();
    const socket = factory.latest;
    socket.open();
    const hello = JSON.parse(socket.sent[0] ?? "null") as { requestId: string };
    socket.serverMessage(makeReady(hello.requestId));

    window.dispatchEvent(new Event("offline"));
    expect(socket.readyState).toBe(socket.CLOSED);
    expect(service.realtimePageSync.state).toBe("idle");
    expect(factory.sockets).toHaveLength(1);

    window.dispatchEvent(new Event("online"));
    expect(factory.sockets).toHaveLength(2);
    expect(service.realtimePageSync.state).toBe("connecting");
  });

  it("moves a historical whole-document refusal into recovery instead of a live conflict", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const baseRevisionId = generateUuidV7();
    const competingRevisionId = generateUuidV7();
    const baseDocument = {
      format: "myownnotion.document+json" as const,
      formatVersion: 2,
      body: {
        blocks: [{ type: "paragraph", id: blockId, content: [{ text: "base" }] }],
      },
    };
    const revision = (id: string, text: string) => ({
      id,
      itemId: pageId,
      mutationId: generateUuidV7(),
      parentRevisionIds: id === baseRevisionId ? [] : [baseRevisionId],
      acceptedAt: "2026-08-25T10:00:00.000Z",
      snapshotRetained: true,
      snapshot: {
        pageDocument: {
          ...baseDocument,
          body: {
            blocks: [{ type: "paragraph", id: blockId, content: [{ text }] }],
          },
        },
      },
      snapshotExpiresAt: null,
    });
    const api = {
      submitMutationBatch: async (mutations: readonly QueuedMutationDto[]) => ({
        ok: true as const,
        value: {
          results: mutations.map(({ mutationId }) => ({
            mutationId,
            status: "conflict" as const,
            competingRevisionIds: [competingRevisionId],
            problem: {
              type: "about:blank",
              title: "stale base",
              status: 409,
              code: "revision.stale-base",
            },
          })),
        },
      }),
      listChanges: async () => ({
        ok: true as const,
        value: { changes: [], cursor: "0", hasMore: false },
      }),
      currentSnapshot: async () => ({
        ok: true as const,
        value: { workspaceId: generateUuidV7(), schemaVersion: 1, cursor: "0", items: [] },
      }),
      getRevision: async (id: string) => ({
        ok: true as const,
        value: revision(id, id === competingRevisionId ? "remote" : "base"),
      }),
    } as unknown as ContentApi;
    const service = new LocalContentService(api, `legacy-recovery-${generateUuidV7()}`);
    services.push(service);
    await service.initialize();
    await service.repository.applyServerItems([
      {
        id: pageId,
        kind: "page",
        name: "Historical page",
        lifecycle: "active",
        currentRevisionId: baseRevisionId,
        pageDocument: baseDocument,
        placements: [
          {
            id: generateUuidV7(),
            itemId: pageId,
            kind: "hierarchy",
            parentItemId: null,
            positionKey: "V",
          },
        ],
      },
    ]);
    vi.spyOn(service, "pageReconciler").mockReturnValue({
      convertLegacyBranch: async () => ({
        kind: "offline" as const,
        exchanges: 0,
        latestPageSequence: 0,
        fileRequirements: [],
        problemCode: "transport.offline",
      }),
      synchronize: async () => ({
        kind: "offline" as const,
        exchanges: 0,
        latestPageSequence: 0,
        fileRequirements: [],
        problemCode: "transport.offline",
      }),
    } as never);

    await service.mutate(
      "page.document.replace",
      {
        itemId: pageId,
        baseRevisionId,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: {
            blocks: [{ type: "paragraph", id: blockId, content: [{ text: "local" }] }],
          },
        },
      },
      [baseRevisionId],
    );
    await service.synchronize();
    await service.synchronizeOperationalPages();

    expect(await service.outbox.conflicts()).toHaveLength(1);
    expect(await service.outbox.activeConflicts()).toHaveLength(0);
    expect(service.getSnapshot()).toMatchObject({
      conflictCount: 0,
      attentionCount: 0,
      recoveryPendingCount: 1,
      syncState: "offline",
    });
  });
});
