import {
  LocalCipher,
  type LocalDatabase,
  LocalKeyManager,
  MemorySecureStorage,
  openLocalDatabase,
  type PendingFilePersistenceBoundary,
  PendingFileStagingCrashError,
  PendingFileTransferStore,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const context = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
};

let db: LocalDatabase;
let keys: LocalKeyManager;
let cipher: LocalCipher;
let keyStorage: MemorySecureStorage;

beforeEach(async () => {
  db = openLocalDatabase(`pending-file-transfer-${generateUuidV7()}`);
  keyStorage = new MemorySecureStorage();
  keys = new LocalKeyManager(keyStorage);
  await keys.establish();
  cipher = new LocalCipher(keys);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

function fixtureFile(): File {
  return new File([new TextEncoder().encode("private file payload")], "secret-notes.txt", {
    type: "text/plain",
    lastModified: 1_723_456_789_000,
  });
}

async function readBytes(file: Blob): Promise<number[]> {
  return [...new Uint8Array(await file.arrayBuffer())];
}

describe("durable encrypted file staging", () => {
  it("persists only sealed metadata and chunks, then reconstructs the exact file", async () => {
    const fileItemId = generateUuidV7() as Uuid;
    const pageId = generateUuidV7() as Uuid;
    const file = fixtureFile();
    const store = new PendingFileTransferStore(db, cipher, context, { chunkBytes: 5 });

    await expect(
      store.stage({ fileItemId, attachmentParentItemId: pageId, file }),
    ).resolves.toEqual({ ok: true });

    const persisted = JSON.stringify({
      manifests: await db.pendingFileTransfers.toArray(),
      chunks: await db.pendingFileTransferChunks.toArray(),
    });
    expect(persisted).not.toContain("secret-notes");
    expect(persisted).not.toContain("private file payload");
    expect(persisted).not.toContain("text/plain");

    const listing = await store.listReady();
    expect(listing.blockedFileItemIds).toEqual([]);
    expect(listing.ready).toEqual([
      expect.objectContaining({
        fileItemId,
        attachmentParentItemId: pageId,
        fileName: "secret-notes.txt",
        // Bun normalises a text File to `text/plain;charset=utf-8`; the
        // contract is exact metadata preservation, not a host-specific MIME
        // spelling.
        mediaType: file.type,
        byteLength: file.size,
      }),
    ]);
    const restored = await store.loadFile(fileItemId);
    expect(restored).not.toBeNull();
    expect(restored?.name).toBe(file.name);
    expect(restored?.type).toBe(file.type);
    expect(restored?.lastModified).toBe(file.lastModified);
    expect(await readBytes(restored as File)).toEqual(await readBytes(file));
  });

  it("reopens ready bytes after a complete browser-process replacement", async () => {
    const fileItemId = generateUuidV7() as Uuid;
    const pageId = generateUuidV7() as Uuid;
    const file = fixtureFile();
    const store = new PendingFileTransferStore(db, cipher, context, { chunkBytes: 4 });
    await store.stage({ fileItemId, attachmentParentItemId: pageId, file });

    const databaseName = db.name;
    db.close();
    db = openLocalDatabase(databaseName);
    const reopenedKeys = new LocalKeyManager(keyStorage);
    await reopenedKeys.establish({ reuseExistingOnly: true });
    const reopened = new PendingFileTransferStore(db, new LocalCipher(reopenedKeys), context, {
      chunkBytes: 4,
    });
    const restored = await reopened.loadFile(fileItemId);

    expect(restored?.name).toBe(file.name);
    expect(await readBytes(restored as File)).toEqual(await readBytes(file));
  });

  it.each<PendingFilePersistenceBoundary>(["manifest-written", "chunk-written", "before-ready"])(
    "cleans an incomplete %s staging on the next launch",
    async (crashAt) => {
      const fileItemId = generateUuidV7() as Uuid;
      const store = new PendingFileTransferStore(db, cipher, context, {
        chunkBytes: 5,
        onPersistenceBoundary(boundary) {
          if (boundary === crashAt) throw new PendingFileStagingCrashError(boundary);
        },
      });

      await expect(
        store.stage({
          fileItemId,
          attachmentParentItemId: generateUuidV7() as Uuid,
          file: fixtureFile(),
        }),
      ).rejects.toBeInstanceOf(PendingFileStagingCrashError);

      const restarted = new PendingFileTransferStore(db, cipher, context);
      await restarted.recoverIncomplete();
      expect(await db.pendingFileTransfers.get(fileItemId)).toBeUndefined();
      expect(
        await db.pendingFileTransferChunks.where("fileItemId").equals(fileItemId).count(),
      ).toBe(0);
      expect((await restarted.listReady()).ready).toEqual([]);
    },
  );

  it("keeps a fully committed staging when the process dies after the ready row", async () => {
    const fileItemId = generateUuidV7() as Uuid;
    const store = new PendingFileTransferStore(db, cipher, context, {
      chunkBytes: 5,
      onPersistenceBoundary(boundary) {
        if (boundary === "ready-written") throw new PendingFileStagingCrashError(boundary);
      },
    });

    await expect(
      store.stage({
        fileItemId,
        attachmentParentItemId: generateUuidV7() as Uuid,
        file: fixtureFile(),
      }),
    ).rejects.toBeInstanceOf(PendingFileStagingCrashError);

    const restarted = new PendingFileTransferStore(db, cipher, context);
    await restarted.recoverIncomplete();
    expect((await restarted.listReady()).ready.map(({ fileItemId: id }) => id)).toEqual([
      fileItemId,
    ]);
    expect(await restarted.loadFile(fileItemId)).not.toBeNull();
  });

  it("removes partial bytes and reports quota failure without a ready transfer", async () => {
    const fileItemId = generateUuidV7() as Uuid;
    const store = new PendingFileTransferStore(db, cipher, context, { chunkBytes: 5 });
    const quota = new DOMException("full", "QuotaExceededError");
    vi.spyOn(db.pendingFileTransferChunks, "put").mockRejectedValueOnce(quota);

    await expect(
      store.stage({
        fileItemId,
        attachmentParentItemId: generateUuidV7() as Uuid,
        file: fixtureFile(),
      }),
    ).resolves.toEqual({ ok: false, reason: "quota" });

    expect(await db.pendingFileTransfers.get(fileItemId)).toBeUndefined();
    expect(await db.pendingFileTransferChunks.where("fileItemId").equals(fileItemId).count()).toBe(
      0,
    );
  });

  it("removes a manifest and all chunks atomically when cleanup is requested", async () => {
    const fileItemId = generateUuidV7() as Uuid;
    const store = new PendingFileTransferStore(db, cipher, context);
    await store.stage({
      fileItemId,
      attachmentParentItemId: generateUuidV7() as Uuid,
      file: fixtureFile(),
    });

    expect(await store.loadFile(fileItemId)).not.toBeNull();
    await store.remove(fileItemId);
    expect(await store.loadFile(fileItemId)).toBeNull();
    expect(await db.pendingFileTransferChunks.where("fileItemId").equals(fileItemId).count()).toBe(
      0,
    );
  });

  it("retains bytes when clear routing metadata contradicts the sealed manifest", async () => {
    const fileItemId = generateUuidV7() as Uuid;
    const store = new PendingFileTransferStore(db, cipher, context, { chunkBytes: 5 });
    await store.stage({
      fileItemId,
      attachmentParentItemId: generateUuidV7() as Uuid,
      file: fixtureFile(),
    });
    await db.pendingFileTransfers.update(fileItemId, { status: "staging" });

    const result = await store.recoverIncomplete();

    expect(result.blockedFileItemIds).toEqual([fileItemId]);
    expect(await db.pendingFileTransfers.get(fileItemId)).toBeDefined();
    expect(await db.pendingFileTransferChunks.where("fileItemId").equals(fileItemId).count()).toBe(
      4,
    );
  });

  it("isolates one corrupt ready manifest without blocking valid transfers", async () => {
    const corruptFileItemId = generateUuidV7() as Uuid;
    const validFileItemId = generateUuidV7() as Uuid;
    const store = new PendingFileTransferStore(db, cipher, context, { chunkBytes: 5 });
    for (const fileItemId of [corruptFileItemId, validFileItemId]) {
      await store.stage({
        fileItemId,
        attachmentParentItemId: generateUuidV7() as Uuid,
        file: fixtureFile(),
      });
    }
    const corrupt = await db.pendingFileTransfers.get(corruptFileItemId);
    expect(corrupt).toBeDefined();
    if (corrupt === undefined) return;
    const bytes = Uint8Array.from(atob(corrupt.sealedManifest.ciphertext), (value) =>
      value.charCodeAt(0),
    );
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    await db.pendingFileTransfers.put({
      ...corrupt,
      sealedManifest: {
        ...corrupt.sealedManifest,
        ciphertext: btoa(String.fromCharCode(...bytes)),
      },
    });

    const listing = await store.listReady();

    expect(listing.blockedFileItemIds).toEqual([corruptFileItemId]);
    expect(listing.ready.map(({ fileItemId }) => fileItemId)).toEqual([validFileItemId]);
    expect(
      await db.pendingFileTransferChunks.where("fileItemId").equals(corruptFileItemId).count(),
    ).toBeGreaterThan(0);
  });
});
