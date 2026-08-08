import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FilesystemBlobStore } from "@myownnotion/blob-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
let blobs: FilesystemBlobStore;

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield new TextEncoder().encode(value);
  }
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const values: number[] = [];
  for await (const chunk of source) {
    values.push(...chunk);
  }
  return Uint8Array.from(values);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "myownnotion-streaming-"));
  blobs = new FilesystemBlobStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("filesystem streaming blob contract", () => {
  it("streams, verifies, heads, ranges, and lists one immutable object", async () => {
    const stored = await blobs.put(chunks("abc", "def"), { maxByteLength: 6 });
    expect(stored.byteLength).toBe(6);
    expect(stored.created).toBe(true);
    expect(Buffer.from(stored.sha256).toString("hex")).toHaveLength(64);

    const head = await blobs.head(stored.storageKey);
    expect(head).toEqual({ storageKey: stored.storageKey, byteLength: 6 });

    const opened = await blobs.open(stored.storageKey, { start: 1, endInclusive: 4 });
    expect(opened?.byteLength).toBe(6);
    expect(opened?.contentLength).toBe(4);
    expect(opened?.range).toEqual({ start: 1, endInclusive: 4 });
    expect(new TextDecoder().decode(await collect(opened?.body ?? chunks()))).toBe("bcde");
    expect(await blobs.list()).toEqual([stored.storageKey]);
  });

  it("deduplicates byte-equal streams while preserving immutable content", async () => {
    const first = await blobs.put(chunks("same", " bytes"));
    const second = await blobs.put(chunks("same bytes"));
    expect(second.storageKey).toBe(first.storageKey);
    expect(second.created).toBe(false);
    expect(await blobs.compare(first.storageKey, second.storageKey)).toBe(true);
    expect(await blobs.equals(first.storageKey, new TextEncoder().encode("different"))).toBe(false);
  });

  it("can reproduce a verified collision-suffixed key for exact restore", async () => {
    const source = new TextEncoder().encode("restored bytes");
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", source)).toString("hex");
    const storageKey = `${digest}-00000000-0000-4000-8000-000000000001`;
    const stored = await blobs.putVerifiedAt(storageKey, chunks("restored ", "bytes"));
    expect(stored).toMatchObject({ storageKey, byteLength: source.byteLength, created: true });
    expect(await blobs.list()).toEqual([storageKey]);
    expect(await blobs.get(storageKey)).toEqual(source);
  });

  it("removes temporary data when the stream exceeds its limit or aborts", async () => {
    await expect(blobs.put(chunks("1234", "5"), { maxByteLength: 4 })).rejects.toThrow(
      "blob exceeds maximum byte length",
    );

    async function* aborted(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode("partial");
      throw new Error("source aborted");
    }
    await expect(blobs.put(aborted())).rejects.toThrow("source aborted");
    expect(await blobs.list()).toEqual([]);
  });

  it("rejects invalid and unsatisfiable adapter ranges", async () => {
    const stored = await blobs.put(new TextEncoder().encode("abc"));
    await expect(blobs.open(stored.storageKey, { start: -1, endInclusive: 1 })).rejects.toThrow(
      "invalid blob range",
    );
    await expect(blobs.open(stored.storageKey, { start: 2, endInclusive: 1 })).rejects.toThrow(
      "invalid blob range",
    );
    await expect(blobs.open(stored.storageKey, { start: 3, endInclusive: 3 })).rejects.toThrow(
      "unsatisfiable blob range",
    );
  });
});
