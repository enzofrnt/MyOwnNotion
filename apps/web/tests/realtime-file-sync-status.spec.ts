import {
  LocalCipher,
  LocalKeyManager,
  MemorySecureStorage,
  openLocalDatabase,
  PendingFileTransferStore,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorEngine } from "../src/features/editor/editor-engine.ts";
import {
  EditorFileStagingError,
  EditorFileTransferQueue,
  insertDroppedFiles,
} from "../src/features/editor/editor-files.ts";
import { FileSynchronizationStatus } from "../src/services/local-content.ts";

function response(init: {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}): Response {
  return new Response(init.body === undefined ? null : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("realtime file synchronization status", () => {
  it("keeps a confirmed document pending until both transfer and server requirement agree", () => {
    const pageId = generateUuidV7();
    const fileId = generateUuidV7();
    const status = new FileSynchronizationStatus();

    status.recordRequirements(pageId, [{ fileId, state: "upload-required" }]);
    status.recordTransfers(new Map([[fileId, { kind: "synchronized" as const }]]));
    expect([...status.pendingIds]).toEqual([fileId]);

    status.recordRequirements(pageId, [{ fileId, state: "present" }]);
    status.recordTransfers(new Map([[fileId, { kind: "verifying" as const }]]));
    expect([...status.pendingIds]).toEqual([fileId]);

    status.recordTransfers(new Map([[fileId, { kind: "synchronized" as const }]]));
    expect(status.pendingIds.size).toBe(0);
  });

  it("resumes a blocked upload and accepts only a verified matching identity", async () => {
    const fileId = generateUuidV7() as Uuid;
    const pageId = generateUuidV7() as Uuid;
    let patchAttempts = 0;
    let creationMetadata = "";
    let uploadCreated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          uploadCreated = true;
          creationMetadata = new Headers(init.headers).get("upload-metadata") ?? "";
          return response({
            status: 201,
            headers: { location: `/v1/uploads/${fileId}` },
            body: { id: fileId },
          });
        }
        if (init.method === "HEAD") {
          if (!uploadCreated) return response({ status: 404 });
          return response({ headers: { "upload-offset": patchAttempts === 0 ? "0" : "2" } });
        }
        if (init.method === undefined || init.method === "GET") return response({ status: 404 });
        patchAttempts += 1;
        return patchAttempts === 1
          ? response({ status: 503 })
          : response({
              status: 201,
              headers: { "upload-offset": "4", "upload-complete": "true" },
              body: { itemId: fileId, verified: true },
            });
      }),
    );
    const queue = new EditorFileTransferQueue();
    const file = new File([new Uint8Array(4)], "resume.bin");
    queue.enqueue(fileId, file, pageId);

    await queue.flush();
    expect(queue.stateFor(fileId)).toMatchObject({ kind: "blocked" });

    await queue.flush();
    expect(queue.stateFor(fileId)).toEqual({ kind: "synchronized" });
    expect(creationMetadata).toContain(`attachmentParentItemId ${btoa(pageId)}`);
  });

  it("rebuilds a transfer after restart, resumes the server offset, and never posts twice", async () => {
    const fileId = generateUuidV7() as Uuid;
    const pageId = generateUuidV7() as Uuid;
    const db = openLocalDatabase(`web-file-restart-${generateUuidV7()}`);
    const keys = new LocalKeyManager(new MemorySecureStorage());
    await keys.establish();
    const store = new PendingFileTransferStore(db, new LocalCipher(keys), {
      installationId: db.name,
      workspaceId: db.name,
    });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "restart.bin");
    let uploadCreated = false;
    let serverOffset = 0;
    let posts = 0;
    let patches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (init.method === "HEAD") {
          return uploadCreated
            ? response({ headers: { "upload-offset": String(serverOffset) } })
            : response({ status: 404 });
        }
        if ((init.method === undefined || init.method === "GET") && url.startsWith("/v1/items/")) {
          return response({ status: 404 });
        }
        if (init.method === "POST") {
          posts += 1;
          uploadCreated = true;
          return response({
            status: 201,
            headers: { location: `/v1/uploads/${fileId}` },
            body: { id: fileId },
          });
        }
        patches += 1;
        if (patches === 1) {
          // The server retained two bytes even though the response was lost.
          serverOffset = 2;
          return response({ status: 503 });
        }
        serverOffset = 4;
        return response({ status: 201, body: { itemId: fileId, verified: true } });
      }),
    );

    try {
      const first = new EditorFileTransferQueue({ store, isReferenced: async () => true });
      expect(await first.stage(fileId, file, pageId)).toEqual({ ok: true });
      first.activate(fileId, file, pageId);
      await first.flush();
      expect(first.stateFor(fileId)?.kind).toBe("blocked");

      const restarted = new EditorFileTransferQueue({ store, isReferenced: async () => true });
      await restarted.initialize();
      expect(restarted.stateFor(fileId)).toEqual({ kind: "queued" });
      expect(await restarted.loadLocalFileFor(fileId)).toEqual(file);
      await restarted.flush();

      expect(restarted.stateFor(fileId)).toEqual({ kind: "synchronized" });
      expect(posts).toBe(1);
      expect(await store.loadFile(fileId)).toBeNull();
    } finally {
      await db.delete();
    }
  });

  it("serializes the same recovered file across tabs so only one upload is created", async () => {
    const fileId = generateUuidV7() as Uuid;
    const pageId = generateUuidV7() as Uuid;
    const db = openLocalDatabase(`web-file-tabs-${generateUuidV7()}`);
    const keys = new LocalKeyManager(new MemorySecureStorage());
    await keys.establish();
    const store = new PendingFileTransferStore(db, new LocalCipher(keys), {
      installationId: db.name,
      workspaceId: db.name,
    });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "tabs.bin");
    let created = false;
    let committed = false;
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (init.method === "HEAD") {
          if (committed || !created) return response({ status: 404 });
          return response({ headers: { "upload-offset": "0" } });
        }
        if ((init.method === undefined || init.method === "GET") && url.startsWith("/v1/items/")) {
          return committed
            ? response({ body: { id: fileId, kind: "file" } })
            : response({ status: 404 });
        }
        if (init.method === "POST") {
          posts += 1;
          created = true;
          return response({
            status: 201,
            headers: { location: `/v1/uploads/${fileId}` },
            body: { id: fileId },
          });
        }
        committed = true;
        return response({ status: 201, body: { itemId: fileId, verified: true } });
      }),
    );

    try {
      await store.stage({ fileItemId: fileId, attachmentParentItemId: pageId, file });
      const first = new EditorFileTransferQueue({ store, isReferenced: async () => true });
      const second = new EditorFileTransferQueue({ store, isReferenced: async () => true });
      await Promise.all([first.initialize(), second.initialize()]);

      await Promise.all([first.flush(), second.flush()]);

      expect(first.stateFor(fileId)).toEqual({ kind: "synchronized" });
      expect(second.stateFor(fileId)).toEqual({ kind: "synchronized" });
      expect(posts).toBe(1);
    } finally {
      await db.delete();
    }
  });

  it("does not clean ready bytes while another tab is committing their editor reference", async () => {
    const fileId = generateUuidV7() as Uuid;
    const pageId = generateUuidV7() as Uuid;
    const db = openLocalDatabase(`web-file-commit-lock-${generateUuidV7()}`);
    const keys = new LocalKeyManager(new MemorySecureStorage());
    await keys.establish();
    const store = new PendingFileTransferStore(db, new LocalCipher(keys), {
      installationId: db.name,
      workspaceId: db.name,
    });
    const writer = new EditorFileTransferQueue({ store });
    let referenced = false;
    const restarting = new EditorFileTransferQueue({
      store,
      isReferenced: async () => referenced,
    });
    const staged = deferred();
    const finishCommit = deferred();

    try {
      const commit = writer.withEditorialCommit(async () => {
        expect(await writer.stage(fileId, new File(["safe"], "safe.txt"), pageId)).toEqual({
          ok: true,
        });
        staged.resolve();
        await finishCommit.promise;
        referenced = true;
      });
      await staged.promise;
      const recovery = restarting.initialize();
      await Promise.resolve();
      expect(await store.loadFile(fileId)).not.toBeNull();

      finishCommit.resolve();
      await Promise.all([commit, recovery]);

      expect(await store.loadFile(fileId)).not.toBeNull();
      expect(restarting.stateFor(fileId)).toEqual({ kind: "queued" });
    } finally {
      finishCommit.resolve();
      await db.delete();
    }
  });

  it("does not upload a staged file after its editor block has been removed", async () => {
    const fileId = generateUuidV7() as Uuid;
    const pageId = generateUuidV7() as Uuid;
    const db = openLocalDatabase(`web-file-deleted-block-${generateUuidV7()}`);
    const keys = new LocalKeyManager(new MemorySecureStorage());
    await keys.establish();
    const store = new PendingFileTransferStore(db, new LocalCipher(keys), {
      installationId: db.name,
      workspaceId: db.name,
    });
    const queue = new EditorFileTransferQueue({ store, isReferenced: async () => false });
    const file = new File(["removed"], "removed.txt");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      expect(await queue.stage(fileId, file, pageId)).toEqual({ ok: true });
      queue.activate(fileId, file, pageId);

      await queue.flush();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(queue.stateFor(fileId)).toBeUndefined();
      expect(queue.localFileFor(fileId)).toBeNull();
      expect(await store.loadFile(fileId)).toBeNull();
    } finally {
      await db.delete();
    }
  });

  it("refuses the editor block before commit when local byte staging fails", async () => {
    const queue = new EditorFileTransferQueue();
    vi.spyOn(queue, "stage").mockResolvedValue({ ok: false, reason: "quota" });
    const apply = vi.fn();
    const engine = { apply } as unknown as EditorEngine;

    await expect(
      insertDroppedFiles(
        engine,
        [new File(["private"], "private.txt")],
        { parentBlockId: null, beforeBlockId: null },
        queue,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(EditorFileStagingError);
    expect(apply).not.toHaveBeenCalled();
  });
});
