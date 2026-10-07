import { META_KEYS, MemorySecureStorage, openLocalDatabase } from "@myownnotion/client-core";
import type { ChangesResponseDto, ItemDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentApi } from "../src/services/content-api.ts";
import { LocalContentService } from "../src/services/local-content.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function item(name: string, parentId: Uuid | null = null): ItemDto {
  const id = generateUuidV7();
  return {
    id,
    name,
    kind: "folder",
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    placements: [
      {
        id: generateUuidV7(),
        itemId: id,
        kind: "hierarchy",
        parentItemId: parentId,
        positionKey: "V",
      },
    ],
  };
}

function apiFor(roots: ItemDto[] = []) {
  return {
    listItems: vi.fn().mockResolvedValue({ ok: true, value: { items: roots } }),
    listChanges: vi.fn().mockImplementation(async (after: string) => ({
      ok: true,
      value: { changes: [], nextCursor: after || "0", hasMore: false },
    })),
    submitMutationBatch: vi.fn().mockResolvedValue({ ok: false, offline: true }),
  };
}

const services: LocalContentService[] = [];
const releases: Array<() => void> = [];

function serviceFor(
  api: ReturnType<typeof apiFor>,
  name = `progressive-${generateUuidV7()}`,
  keyStorage = new MemorySecureStorage(),
) {
  const service = new LocalContentService(api as unknown as ContentApi, name, { keyStorage });
  services.push(service);
  return service;
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const service of services) {
    if (!service.db.isOpen()) continue;
    await service.synchronize().catch(() => undefined);
    await service.synchronizeOperationalPages().catch(() => undefined);
    service.db.close();
  }
  const names = new Set(services.splice(0).map(({ db }) => db.name));
  for (const name of names) await openLocalDatabase(name).delete();
  vi.restoreAllMocks();
});

describe("progressive workspace startup", () => {
  it("retries a transient key-storage failure without retaining a failed boot promise", async () => {
    const keyStorage = new MemorySecureStorage();
    vi.spyOn(keyStorage, "load").mockRejectedValueOnce(new Error("Temporary key-store failure"));
    const api = apiFor([item("Root after retry")]);
    const service = serviceFor(api, undefined, keyStorage);
    await expect(service.initialize()).rejects.toThrow("Temporary key-store failure");
    await service.initialize();
    expect((await service.listActiveItems()).map(({ name }) => name)).toEqual(["Root after retry"]);
    await service.synchronize();
    expect(service.getSnapshot().projectionComplete).toBe(true);
  });
  it("shows current roots without advancing the journal or waiting for descendants", async () => {
    const root = item("Current root");
    const child = item("Later child", root.id as Uuid);
    const api = apiFor([root]);
    const held = deferred<void>();
    const requested = deferred<void>();
    releases.push(() => held.resolve());
    api.listChanges.mockImplementation(async () => {
      requested.resolve();
      await held.promise;
      return {
        ok: true,
        value: {
          changes: [
            {
              sequence: 1,
              mutationId: generateUuidV7(),
              revisionIds: [],
              changedItems: [root, child],
            },
          ],
          nextCursor: "1",
          hasMore: false,
        },
      };
    });
    const service = serviceFor(api);
    await service.initialize();
    await requested.promise;
    expect(api.listItems).toHaveBeenCalledWith({ parentItemId: "root", lifecycle: "active" });
    expect((await service.listActiveItems()).map(({ id }) => id)).toEqual([root.id]);
    expect(await service.repository.getLastChangeCursor()).toBe("");
    expect(service.getSnapshot().projectionComplete).toBe(false);
    held.resolve();
    await service.synchronize();
    expect((await service.listActiveItems()).map(({ id }) => id).sort()).toEqual(
      [root.id, child.id].sort(),
    );
    expect(service.getSnapshot().projectionComplete).toBe(true);
    expect(await service.repository.getLastChangeCursor()).toBe("1");
  });

  it("publishes descendants before a later page finishes", async () => {
    const root = item("Root");
    const firstChild = item("First child", root.id as Uuid);
    const secondChild = item("Second child", root.id as Uuid);
    const api = apiFor([root]);
    const held = deferred<void>();
    const requested = deferred<void>();
    releases.push(() => held.resolve());
    api.listChanges.mockImplementation(async (after: string) => {
      if (after === "")
        return {
          ok: true,
          value: {
            changes: [
              {
                sequence: 1,
                mutationId: generateUuidV7(),
                revisionIds: [],
                changedItems: [firstChild],
              },
            ],
            nextCursor: "1",
            hasMore: true,
          },
        };
      if (after === "1") {
        requested.resolve();
        await held.promise;
        return {
          ok: true,
          value: {
            changes: [
              {
                sequence: 2,
                mutationId: generateUuidV7(),
                revisionIds: [],
                changedItems: [secondChild],
              },
            ],
            nextCursor: "2",
            hasMore: false,
          },
        };
      }
      return { ok: true, value: { changes: [], nextCursor: after, hasMore: false } };
    });
    const service = serviceFor(api);
    const published: string[][] = [];
    service.subscribeProjection((change) => {
      if (change.kind === "upsert") published.push([...change.itemIds]);
    });
    await service.initialize();
    await requested.promise;
    expect(await service.getItem(firstChild.id as Uuid)).not.toBeNull();
    expect(await service.getItem(secondChild.id as Uuid)).toBeNull();
    expect(published).toContainEqual([firstChild.id]);
    expect(service.getSnapshot().projectionComplete).toBe(false);
    held.resolve();
    await service.synchronize();
    expect(published).toContainEqual([secondChild.id]);
  });

  it("waits for the final projection consumer before reporting or resolving the drain", async () => {
    const root = item("Root before final publication");
    const child = item("Final descendant", root.id as Uuid);
    const api = apiFor([root]);
    const entered = deferred<void>();
    const held = deferred<void>();
    releases.push(() => held.resolve());
    api.listChanges.mockImplementation(async (after: string) => ({
      ok: true,
      value:
        after === ""
          ? {
              changes: [
                {
                  sequence: 1,
                  mutationId: generateUuidV7(),
                  revisionIds: [],
                  changedItems: [child],
                },
              ],
              nextCursor: "1",
              hasMore: false,
            }
          : { changes: [], nextCursor: after, hasMore: false },
    }));
    const service = serviceFor(api);
    const order: string[] = [];
    service.subscribeProjection(async (change) => {
      if (change.kind !== "upsert" || !change.itemIds.includes(child.id as Uuid)) return;
      order.push("publication-started");
      entered.resolve();
      await held.promise;
      // The accepted catalogue and its coverage are updated together by the
      // consumer. The durable marker legitimately precedes this UI boundary.
      order.push("publication-accepted");
    });
    service.subscribe(() => {
      if (service.getSnapshot().syncState === "synced") order.push("drain-reported");
    });
    await service.initialize();
    let resolved = false;
    const synchronization = service.synchronize().then(() => {
      resolved = true;
      order.push("drain-resolved");
    });
    await entered.promise;
    expect(await service.repository.getMeta(META_KEYS.projectionComplete)).toBe(true);
    expect(await service.getItem(child.id as Uuid)).not.toBeNull();
    expect(resolved).toBe(false);
    expect(order).toEqual(["publication-started"]);
    held.resolve();
    await synchronization;
    expect(order.indexOf("drain-reported")).toBeGreaterThan(order.indexOf("publication-accepted"));
    expect(order.indexOf("drain-resolved")).toBeGreaterThan(order.indexOf("publication-accepted"));
  });

  it("restores existing local content before a delayed network response", async () => {
    const name = `cached-${generateUuidV7()}`;
    const keyStorage = new MemorySecureStorage();
    const root = item("Available offline");
    const first = serviceFor(apiFor([root]), name, keyStorage);
    await first.initialize();
    await first.synchronize();
    await first.synchronizeOperationalPages();
    first.db.close();
    const api = apiFor();
    const held = deferred<void>();
    releases.push(() => held.resolve());
    api.listChanges.mockImplementation(async (after: string) => {
      await held.promise;
      return { ok: true, value: { changes: [], nextCursor: after, hasMore: false } };
    });
    const restarted = serviceFor(api, name, keyStorage);
    await restarted.initialize();
    expect(api.listItems).not.toHaveBeenCalled();
    expect((await restarted.listActiveItems()).map(({ name }) => name)).toEqual([
      "Available offline",
    ]);
    expect(restarted.getSnapshot().projectionComplete).toBe(true);
    held.resolve();
  });

  it("does not infer complete legacy coverage from an interrupted nonempty cursor", async () => {
    const name = `legacy-partial-${generateUuidV7()}`;
    const keyStorage = new MemorySecureStorage();
    const root = item("Legacy downloaded root");
    const first = serviceFor(apiFor([root]), name, keyStorage);
    await first.initialize();
    await first.synchronize();
    await first.synchronizeOperationalPages();
    await first.repository.setMeta(META_KEYS.lastChangeCursor, "127");
    await first.db.meta.delete(META_KEYS.projectionComplete);
    first.db.close();
    const api = apiFor();
    const held = deferred<void>();
    releases.push(() => held.resolve());
    api.listChanges.mockImplementation(async (after: string) => {
      await held.promise;
      return { ok: true, value: { changes: [], nextCursor: after, hasMore: false } };
    });
    const restarted = serviceFor(api, name, keyStorage);
    await restarted.initialize();
    expect(await restarted.repository.getLastChangeCursor()).toBe("127");
    expect(await restarted.getItem(root.id as Uuid)).not.toBeNull();
    expect(restarted.getSnapshot().projectionComplete).toBe(false);
    expect(await restarted.repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    held.resolve();
    await restarted.synchronize();
    expect(restarted.getSnapshot().projectionComplete).toBe(true);
  });

  it("keeps coverage partial after an interrupted download and resumes it on restart", async () => {
    const name = `partial-${generateUuidV7()}`;
    const keyStorage = new MemorySecureStorage();
    const root = item("Root before interruption");
    const api = apiFor([root]);
    api.listChanges.mockResolvedValue({
      ok: false,
      offline: true,
      problem: { type: "about:blank", title: "Offline", status: 503, code: "network.unreachable" },
    });
    const first = serviceFor(api, name, keyStorage);
    await first.initialize();
    await first.synchronize();
    await first.synchronizeOperationalPages();
    expect(await first.repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    expect(first.getSnapshot()).toMatchObject({ projectionComplete: false, syncState: "offline" });
    first.db.close();
    const resumeApi = apiFor();
    const held = deferred<void>();
    releases.push(() => held.resolve());
    resumeApi.listChanges.mockImplementation(async (after: string) => {
      await held.promise;
      return { ok: true, value: { changes: [], nextCursor: after || "0", hasMore: false } };
    });
    const resumed = serviceFor(resumeApi, name, keyStorage);
    await resumed.initialize();
    expect(resumed.getSnapshot().projectionComplete).toBe(false);
    expect(await resumed.getItem(root.id as Uuid)).not.toBeNull();
    expect(resumeApi.listItems).not.toHaveBeenCalled();
    held.resolve();
    await resumed.synchronize();
    expect(resumed.getSnapshot().projectionComplete).toBe(true);
  });

  it("preserves a local create that arrives while root prefetch is in flight", async () => {
    const remoteRoot = item("Remote root");
    const api = apiFor();
    const held = deferred<{ ok: true; value: { items: ItemDto[] } }>();
    const requested = deferred<void>();
    releases.push(() => held.resolve({ ok: true, value: { items: [remoteRoot] } }));
    api.listItems.mockImplementation(async () => {
      requested.resolve();
      return held.promise;
    });
    const service = serviceFor(api);
    const initialization = service.initialize();
    await requested.promise;
    const localId = generateUuidV7();
    expect(
      await service.mutate("item.create", {
        id: localId,
        kind: "folder",
        name: "Durable local root",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      }),
    ).toMatchObject({ ok: true });
    held.resolve({ ok: true, value: { items: [remoteRoot] } });
    await initialization;
    await service.synchronize();
    expect(await service.getItem(remoteRoot.id as Uuid)).toBeNull();
    expect(await service.getItem(localId)).toMatchObject({ name: "Durable local root" });
    expect(await service.outbox.pending()).toHaveLength(1);
    expect(service.getSnapshot().projectionComplete).toBe(false);
  });

  it("retains partial state on unexpected background errors and clears it after retry", async () => {
    const api = apiFor([item("Usable root")]);
    api.listChanges.mockRejectedValue(new Error("Deferred projection read failed"));
    const service = serviceFor(api);
    await service.initialize();
    await expect(service.synchronize()).rejects.toThrow("Deferred projection read failed");
    expect(service.getSnapshot()).toMatchObject({
      projectionComplete: false,
      projectionLoadFailed: true,
    });
    api.listChanges.mockImplementation(async (after: string) => ({
      ok: true,
      value: { changes: [], nextCursor: after || "0", hasMore: false } satisfies ChangesResponseDto,
    }));
    await service.synchronize();
    expect(service.getSnapshot()).toMatchObject({
      projectionComplete: true,
      projectionLoadFailed: false,
    });
  });

  it("establishes roots and the coverage marker before an early realtime wake pulls changes", async () => {
    const root = item("Root before feed");
    const api = apiFor([root]);
    const held = deferred<void>();
    releases.push(() => held.resolve());
    api.listItems.mockImplementation(async () => {
      await held.promise;
      return { ok: true, value: { items: [root] } };
    });
    const service = serviceFor(api);
    const realtime = service.synchronize();
    await vi.waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(1));
    expect(api.listChanges).not.toHaveBeenCalled();
    expect(await service.repository.getMeta(META_KEYS.projectionComplete)).toBe(false);
    held.resolve();
    await realtime;
    expect(await service.getItem(root.id as Uuid)).not.toBeNull();
    expect(service.getSnapshot().projectionComplete).toBe(true);
  });
});
