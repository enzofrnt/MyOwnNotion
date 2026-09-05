/**
 * Encrypted file chunks (T051, feature 002).
 *
 * The tests that matter here are not the round trip — they are the ones about
 * *rearranging* chunks. A chunked cipher without the index in its additional
 * data authenticates every chunk individually while letting an attacker
 * reorder, duplicate, or drop them; the file then decrypts cleanly to
 * something the owner never wrote, and nothing reports an error. So each of
 * those manipulations gets its own test.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CHUNK_BYTES,
  type ChunkEnvelope,
  EncryptedChunkStore,
  FilesystemBlobStore,
  splitIntoChunks,
} from "@myownnotion/blob-store";
import type { ProtectedFileManifest } from "@myownnotion/domain";
import { EnvelopeDecryptionError, randomKey } from "@myownnotion/domain/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let root: string;
let store: EncryptedChunkStore;
let fullSizeStore: EncryptedChunkStore;
let blobs: FilesystemBlobStore;

/** Chunk size for the index tests. Small enough to be free, big enough to be real. */
const SMALL_CHUNK = 64;

const KEY = randomKey();
const OTHER_KEY = randomKey();

const BINDING = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
  contentId: "018f2b7c-0000-7000-8000-0000000000c1",
  keyGeneration: 1,
  recordVersion: 1,
};

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "mon-chunks-"));
  blobs = new FilesystemBlobStore(root);
  // Small chunks for everything about the chunk *index* — ordering,
  // duplication, gaps, splicing. Those properties have nothing to do with the
  // chunk size, and asserting them at 4 MiB a chunk cost a CI runner its heap.
  store = new EncryptedChunkStore({ blobs, dataKey: async () => KEY, chunkBytes: SMALL_CHUNK });
  // One store at the real size, for the one test that should pay for it.
  fullSizeStore = new EncryptedChunkStore({ blobs, dataKey: async () => KEY });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Asserts two payloads are byte-identical.
 *
 * Deliberately not `expect(a).toEqual(b)`: on a multi-megabyte Buffer that
 * compares element by element and builds a diff of millions of entries, which
 * exhausts the heap long before it reports anything useful. `Buffer.compare`
 * is one memcmp, and on failure the digests say "these differ" without trying
 * to render eight million bytes.
 */
function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.byteLength).toBe(expected.byteLength);
  const identical = Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0;
  if (!identical) {
    expect(createHash("sha256").update(actual).digest("hex")).toBe(
      createHash("sha256").update(expected).digest("hex"),
    );
  }
  expect(identical).toBe(true);
}

/** A payload spanning several chunks, with recognisable content per chunk. */
function multiChunkPayload(chunks: number, chunkBytes: number = SMALL_CHUNK): Uint8Array {
  const bytes = Buffer.alloc(chunkBytes * chunks);
  for (let index = 0; index < chunks; index += 1) {
    bytes.write(`chunk-${index}-start`, index * chunkBytes);
  }
  return new Uint8Array(bytes);
}

describe("splitting", () => {
  it("produces no chunks for an empty payload", () => {
    // `sealEnvelope` refuses empty plaintext, so an empty file is zero chunks
    // rather than one empty envelope that could never be read back.
    expect(splitIntoChunks(new Uint8Array(0))).toHaveLength(0);
  });

  it("produces one chunk for anything up to the chunk size", () => {
    expect(splitIntoChunks(new Uint8Array(1))).toHaveLength(1);
    expect(splitIntoChunks(new Uint8Array(CHUNK_BYTES))).toHaveLength(1);
  });

  it("honours a configured chunk size", () => {
    expect(splitIntoChunks(new Uint8Array(200), 64)).toHaveLength(4);
  });

  it("starts a second chunk one byte later", () => {
    const chunks = splitIntoChunks(new Uint8Array(CHUNK_BYTES + 1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.length).toBe(CHUNK_BYTES);
    expect(chunks[1]?.length).toBe(1);
  });

  it("uses 4 MiB, as the requirement states", () => {
    // The production default, pinned separately from the tests that shrink it.
    expect(CHUNK_BYTES).toBe(4 * 1024 * 1024);
    expect(new EncryptedChunkStore({ blobs, dataKey: async () => KEY })).toBeDefined();
  });
});

describe("the round trip", () => {
  it("returns a small file byte for byte", async () => {
    const payload = new Uint8Array(Buffer.from("a modest attachment", "utf8"));
    const envelopes = await store.write(payload, BINDING);
    expect(envelopes).toHaveLength(1);
    expectSameBytes(await store.read(envelopes, BINDING), payload);
  });

  // A generous timeout because this moves 8 MiB through the cipher and the
  // filesystem twice. It is fast in practice — the whole file runs in well
  // under a second — and the margin is there for a loaded CI runner.
  it("returns a multi-chunk file at the real 4 MiB chunk size", async () => {
    // The one test that pays the production cost, so the real path is
    // exercised rather than only the shrunken one.
    const payload = multiChunkPayload(2, CHUNK_BYTES);
    const binding = { ...BINDING, contentId: contentId("full-size") };
    const envelopes = await fullSizeStore.write(payload, binding);
    expect(envelopes).toHaveLength(2);
    expectSameBytes(await fullSizeStore.read(envelopes, binding), payload);
  }, 60_000);

  it("records the plaintext length of each chunk", async () => {
    const payload = new Uint8Array(SMALL_CHUNK + 17);
    const envelopes = await store.write(payload, { ...BINDING, contentId: contentId("len") });
    expect(envelopes[0]?.byteLength).toBe(SMALL_CHUNK);
    expect(envelopes[1]?.byteLength).toBe(17);
  });

  it("writes no plaintext to the blob store", async () => {
    // The property the whole module exists for, checked against what is
    // actually on disk.
    const secret = "the alarm code is 4417";
    const payload = new Uint8Array(Buffer.from(secret, "utf8"));
    const envelopes = await store.write(payload, { ...BINDING, contentId: contentId("secret") });
    const onDisk = await blobs.get(envelopes[0]?.storageKey ?? "");
    expect(onDisk).not.toBeNull();
    expect(Buffer.from(onDisk ?? new Uint8Array()).toString("utf8")).not.toContain(secret);
    expect(Buffer.from(onDisk ?? new Uint8Array()).toString("utf8")).not.toContain("4417");
  });

  it("gives every chunk its own nonce", async () => {
    // Reusing a nonce under one key breaks GCM outright, and a multi-chunk
    // file is where a loop-scoped mistake would show.
    const envelopes = await store.write(multiChunkPayload(4), {
      ...BINDING,
      contentId: contentId("nonces"),
    });
    expect(new Set(envelopes.map((envelope) => envelope.nonce)).size).toBe(4);
    expect(new Set(envelopes.map((envelope) => envelope.salt)).size).toBe(4);
  });
});

describe("rearranging chunks", () => {
  /** Writes a three-chunk file and returns its envelopes. */
  async function threeChunks(label: string): Promise<{
    envelopes: ChunkEnvelope[];
    binding: typeof BINDING;
  }> {
    const binding = { ...BINDING, contentId: contentId(label) };
    const envelopes = [...(await store.write(multiChunkPayload(3), binding))];
    return { envelopes, binding };
  }

  it("refuses two chunks swapped", async () => {
    // The attack the chunk index in the AAD exists to stop. Without it both
    // chunks authenticate and the file silently decrypts to the wrong content.
    const { envelopes, binding } = await threeChunks("swap");
    const first = envelopes[0];
    const second = envelopes[1];
    if (first === undefined || second === undefined) {
      throw new Error("expected three chunks");
    }
    const swapped: ChunkEnvelope[] = [
      { ...first, chunkIndex: 1 },
      { ...second, chunkIndex: 0 },
      envelopes[2] as ChunkEnvelope,
    ];
    await expect(store.read(swapped, binding)).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });

  it("refuses a duplicated chunk", async () => {
    const { envelopes, binding } = await threeChunks("duplicate");
    const first = envelopes[0] as ChunkEnvelope;
    const duplicated: ChunkEnvelope[] = [
      first,
      { ...first, chunkIndex: 1 },
      envelopes[2] as ChunkEnvelope,
    ];
    await expect(store.read(duplicated, binding)).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });

  it("refuses a missing chunk rather than returning a short file", async () => {
    // Silent truncation is the worst outcome available here: every remaining
    // chunk authenticates, and the owner gets a file that is quietly wrong.
    const { envelopes, binding } = await threeChunks("gap");
    const withGap = [envelopes[0] as ChunkEnvelope, envelopes[2] as ChunkEnvelope];
    await expect(store.read(withGap, binding)).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });

  it("refuses a chunk from another file", async () => {
    const first = await threeChunks("file-one");
    const second = await threeChunks("file-two");
    const spliced = [
      first.envelopes[0] as ChunkEnvelope,
      second.envelopes[1] as ChunkEnvelope,
      first.envelopes[2] as ChunkEnvelope,
    ];
    await expect(store.read(spliced, first.binding)).rejects.toBeInstanceOf(
      EnvelopeDecryptionError,
    );
  });

  it("accepts chunks presented out of order, because it sorts them", async () => {
    // Order in the array is not the guarantee; the index is. A caller that
    // hands them over shuffled must still get the right file.
    const { envelopes, binding } = await threeChunks("shuffled");
    const shuffled = [envelopes[2], envelopes[0], envelopes[1]] as ChunkEnvelope[];
    const read = await store.read(shuffled, binding);
    expect(Buffer.from(read).subarray(0, 13).toString("utf8")).toBe("chunk-0-start");
  });
});

describe("tampering", () => {
  async function oneChunk(label: string) {
    const binding = { ...BINDING, contentId: contentId(label) };
    const envelopes = await store.write(
      new Uint8Array(Buffer.from("attachment body", "utf8")),
      binding,
    );
    return { envelope: envelopes[0] as ChunkEnvelope, binding };
  }

  it("refuses a flipped tag", async () => {
    const { envelope, binding } = await oneChunk("tag");
    const flipped: ChunkEnvelope = { ...envelope, tag: Buffer.alloc(16).toString("base64url") };
    await expect(store.readChunk(flipped, binding)).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });

  it("refuses a flipped nonce", async () => {
    const { envelope, binding } = await oneChunk("nonce");
    const flipped: ChunkEnvelope = { ...envelope, nonce: Buffer.alloc(12).toString("base64url") };
    await expect(store.readChunk(flipped, binding)).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });

  it("refuses a flipped salt", async () => {
    const { envelope, binding } = await oneChunk("salt");
    const flipped: ChunkEnvelope = { ...envelope, salt: Buffer.alloc(16).toString("base64url") };
    await expect(store.readChunk(flipped, binding)).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });

  it("refuses an edited AAD digest", async () => {
    // Checked before the tag, so an edited row reports specifically rather
    // than as a generic decryption failure.
    const { envelope, binding } = await oneChunk("aad");
    const flipped: ChunkEnvelope = { ...envelope, aadDigest: "not-the-right-digest" };
    await expect(store.readChunk(flipped, binding)).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });

  it("refuses when the ciphertext has gone missing", async () => {
    const { envelope, binding } = await oneChunk("missing");
    await blobs.delete(envelope.storageKey);
    await expect(store.readChunk(envelope, binding)).rejects.toBeInstanceOf(
      EnvelopeDecryptionError,
    );
  });

  it("refuses under the wrong key", async () => {
    const { envelope, binding } = await oneChunk("wrong-key");
    const otherStore = new EncryptedChunkStore({ blobs, dataKey: async () => OTHER_KEY });
    await expect(otherStore.readChunk(envelope, binding)).rejects.toBeInstanceOf(
      EnvelopeDecryptionError,
    );
  });

  it("refuses when the binding claims another workspace", async () => {
    const { envelope, binding } = await oneChunk("workspace");
    await expect(
      store.readChunk(envelope, {
        ...binding,
        workspaceId: "018f2b7c-0000-7000-8000-0000000000ff",
      }),
    ).rejects.toBeInstanceOf(EnvelopeDecryptionError);
  });
});

describe("content addressing", () => {
  it("keys ciphertext by its own digest, revealing nothing about the content", async () => {
    const envelopes = await store.write(
      new Uint8Array(Buffer.from("a recognisable string", "utf8")),
      { ...BINDING, contentId: contentId("addressing") },
    );
    const key = envelopes[0]?.storageKey ?? "";
    expect(key).not.toContain("recognisable");
    expect(key).not.toContain(BINDING.contentId);
  });
});

/** A distinct content id per test, so tests cannot collide in the store. */
function contentId(label: string): string {
  const digits = Buffer.from(label).toString("hex").slice(0, 12).padEnd(12, "0");
  return `018f2b7c-0000-7000-8000-${digits}`;
}

describe("bounded protected file streams", () => {
  it("preserves provider-owned keys when storage fails and refuses invalid chunk bounds", async () => {
    const originalKey = Uint8Array.from(KEY);
    let writes = 0;
    const failing = new EncryptedChunkStore({
      blobs: {
        put: async () => {
          writes += 1;
          throw new Error("storage unavailable");
        },
        get: async () => null,
        equals: async () => false,
        delete: async () => undefined,
      },
      dataKey: async () => KEY,
      chunkBytes: SMALL_CHUNK,
    });
    for (const [size, index] of [
      [0, 0],
      [65, 0],
      [1, -1],
      [1, 1.5],
    ] as const)
      await expect(failing.writeChunk(Buffer.alloc(size), BINDING, index)).rejects.toThrow(
        "Invalid encrypted chunk bounds",
      );
    expect(writes).toBe(0);
    await expect(failing.writeChunk(Buffer.from("private"), BINDING, 0)).rejects.toThrow(
      "storage unavailable",
    );
    expectSameBytes(KEY, originalKey);
    const writing = failing.writeStream(
      (async function* () {
        yield Buffer.from("uncommitted prefix");
        throw new Error("source interrupted");
      })(),
      BINDING,
    );
    await expect(writing.next()).rejects.toThrow("source interrupted");
    expect(writes).toBe(1);
  });

  it("reads a manifest spanning historical and progressively rotated chunk generations", async () => {
    const rotating = new EncryptedChunkStore({
      blobs,
      dataKey: async (generation) => (generation === 1 ? KEY : OTHER_KEY),
    });
    const binding = { ...BINDING, contentId: contentId("rotation"), recordVersion: 2 };
    const bytes = Buffer.alloc(CHUNK_BYTES + 9, 3);
    const parts = [
      await rotating.writeChunk(
        bytes.subarray(0, CHUNK_BYTES),
        { ...binding, recordVersion: 1 },
        0,
      ),
      await rotating.writeChunk(bytes.subarray(CHUNK_BYTES), { ...binding, keyGeneration: 2 }, 1),
    ];
    const manifest: ProtectedFileManifest = {
      format: "myownnotion.protected-file",
      formatVersion: 1,
      kind: "content",
      id: binding.contentId,
      recordVersion: 2,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      chunks: parts.map((part) => ({
        index: part.chunkIndex,
        byteLength: part.byteLength,
        storageKey: part.storageKey,
        keyGeneration: part.keyGeneration,
        recordVersion: part.recordVersion,
      })),
    };
    const opened: Uint8Array[] = [];
    for await (const part of rotating.readStream(parts, binding, manifest)) opened.push(part);
    expectSameBytes(Buffer.concat(opened), bytes);
  });

  it("seals irregular input fragments in fixed chunks without reading ahead", async () => {
    let consumed = 0;
    const binding = { ...BINDING, contentId: contentId("stream-write") };
    const source = (async function* () {
      for (const size of [3, 61, 10, 60, 1]) {
        consumed += 1;
        yield Buffer.alloc(size, consumed);
      }
    })();
    const writing = store.writeStream(source, binding);
    const first = await writing.next();
    expect(first.done).toBe(false);
    expect(consumed).toBe(2);
    const remaining: ChunkEnvelope[] = [];
    for await (const chunk of writing) remaining.push(chunk);
    expect([first.value, ...remaining].map((entry) => entry?.byteLength)).toEqual([64, 64, 7]);
    if (first.done) throw new Error("Missing first encrypted chunk");
    expectSameBytes(
      await store.readChunk(first.value, binding),
      Buffer.concat([Buffer.alloc(3, 1), Buffer.alloc(61, 2)]),
    );
  });

  it("returns source cancellation and never publishes an incomplete pending chunk", async () => {
    let cancelled = false;
    const source = (async function* () {
      try {
        yield Buffer.alloc(128, 9);
        throw new Error("must not read ahead");
      } finally {
        cancelled = true;
      }
    })();
    const writing = store.writeStream(source, { ...BINDING, contentId: contentId("cancel") });
    await writing.next();
    await writing.return(undefined);
    expect(cancelled).toBe(true);
  });

  it("separates upload and completed-content encryption purposes", async () => {
    const upload = { ...BINDING, contentId: contentId("purpose"), kind: "upload" as const };
    const part = await store.writeChunk(Buffer.from("private accepted prefix"), upload, 0);
    expectSameBytes(await store.readChunk(part, upload), Buffer.from("private accepted prefix"));
    await expect(store.readChunk(part, { ...upload, kind: "content" })).rejects.toBeInstanceOf(
      EnvelopeDecryptionError,
    );
    await expect(store.readChunk({ ...part, keyGeneration: 2 }, upload)).rejects.toBeInstanceOf(
      EnvelopeDecryptionError,
    );
    await expect(store.readChunk({ ...part, recordVersion: 2 }, upload)).rejects.toBeInstanceOf(
      EnvelopeDecryptionError,
    );
  });

  it.each([0, -1, 1.5, CHUNK_BYTES + 1])(
    "refuses invalid buffering sizes instead of looping or allocating unbounded memory: %s",
    (chunkBytes) => {
      expect(
        () => new EncryptedChunkStore({ blobs, dataKey: async () => KEY, chunkBytes }),
      ).toThrow();
      expect(() => splitIntoChunks(Buffer.from("one"), chunkBytes)).toThrow();
    },
  );

  it("streams only metadata-matched authenticated chunks and refuses a deleted final chunk", async () => {
    const bytes = Buffer.alloc(CHUNK_BYTES + 17, 7);
    const binding = { ...BINDING, contentId: contentId("read-stream") };
    const envelopes: ChunkEnvelope[] = [];
    for await (const part of fullSizeStore.writeStream(
      (async function* () {
        yield bytes;
      })(),
      binding,
    ))
      envelopes.push(part);
    const manifest: ProtectedFileManifest = {
      format: "myownnotion.protected-file",
      formatVersion: 1,
      kind: "content",
      id: binding.contentId,
      recordVersion: 1,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      chunks: envelopes.map((part) => ({
        index: part.chunkIndex,
        byteLength: part.byteLength,
        storageKey: part.storageKey,
        keyGeneration: part.keyGeneration,
        recordVersion: part.recordVersion,
      })),
    };
    async function drain(parts: readonly ChunkEnvelope[], inventory = manifest) {
      const result: Uint8Array[] = [];
      for await (const part of fullSizeStore.readStream(parts, binding, inventory))
        result.push(part);
      return Buffer.concat(result);
    }
    expectSameBytes(await drain(envelopes), bytes);
    await expect(drain(envelopes.slice(0, -1))).rejects.toThrow();
    const first = envelopes[0];
    if (first === undefined) throw new Error("Missing encrypted chunk");
    await expect(
      drain([{ ...first, byteLength: first.byteLength - 1 }, ...envelopes.slice(1)]),
    ).rejects.toThrow();
    await expect(drain(envelopes, { ...manifest, sha256: "ab".repeat(32) })).rejects.toThrow();
  });
});
