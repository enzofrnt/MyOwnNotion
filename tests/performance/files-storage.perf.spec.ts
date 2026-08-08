import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type BlobHead,
  type BlobListOptions,
  type BlobRange,
  type BlobSource,
  type BlobStore,
  type BlobWriteOptions,
  FilesystemBlobStore,
  type OpenedBlob,
  type StoredBlob,
} from "@myownnotion/blob-store";
import type { ContentAuditInventoryRecord } from "@myownnotion/database";
import { generateUuidV7, MAX_FILE_BYTE_LENGTH } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";
import { auditContentStorage } from "../../apps/operations/src/audit.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("file storage performance", () => {
  it("streams the 256 MiB ceiling without retaining a complete-file buffer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mon-256mib-"));
    roots.push(root);
    const store = new FilesystemBlobStore(root);
    const reusableChunk = new Uint8Array(1024 * 1024).fill(0x5a);
    const baseline = process.memoryUsage().arrayBuffers;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    }, 2);
    async function* maximumFile(): AsyncIterable<Uint8Array> {
      for (let index = 0; index < 256; index += 1) {
        yield reusableChunk;
      }
    }

    const started = performance.now();
    const stored = await store.put(maximumFile(), { maxByteLength: MAX_FILE_BYTE_LENGTH });
    clearInterval(sampler);
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    expect(stored.byteLength).toBe(MAX_FILE_BYTE_LENGTH);
    expect(peak - baseline, `peak ArrayBuffer growth=${peak - baseline}`).toBeLessThan(
      32 * 1024 * 1024,
    );

    const rangeStarted = performance.now();
    const range = await store.open(stored.storageKey, {
      start: MAX_FILE_BYTE_LENGTH - 1024 * 1024,
      endInclusive: MAX_FILE_BYTE_LENGTH - 1,
    });
    let rangeBytes = 0;
    for await (const chunk of range?.body ?? (async function* () {})()) {
      rangeBytes += chunk.byteLength;
    }
    expect(rangeBytes).toBe(1024 * 1024);
    expect(performance.now() - rangeStarted).toBeLessThan(1_000);
    expect(performance.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it("classifies 10,000 verified objects in under one second", async () => {
    const emptyDigest = createHash("sha256").digest("hex");
    const inventory: ContentAuditInventoryRecord[] = Array.from({ length: 10_000 }, (_, index) => ({
      contentId: generateUuidV7(),
      storageKey: index.toString(16).padStart(64, "0"),
      sha256: emptyDigest,
      byteLength: 0,
      verified: true,
      verifiedAt: new Date(0),
      storedReferenceCount: 1,
      logicalReferenceCount: 1,
    }));
    const store = new ZeroByteInventoryStore(inventory.map((record) => record.storageKey));
    const started = performance.now();
    const report = await auditContentStorage({
      inventory,
      blobStore: store,
      hmacKey: new Uint8Array(32).fill(4),
      limit: 0,
    });
    const elapsed = performance.now() - started;
    expect(report.counts.referenced).toBe(10_000);
    expect(report.findings).toHaveLength(0);
    expect(elapsed, `10,000-object audit=${elapsed.toFixed(1)}ms`).toBeLessThan(1_000);
  });
});

class ZeroByteInventoryStore implements BlobStore {
  constructor(private readonly keys: readonly string[]) {}
  put(_source: BlobSource, _options?: BlobWriteOptions): Promise<StoredBlob> {
    throw new Error("not implemented");
  }
  head(storageKey: string): Promise<BlobHead> {
    return Promise.resolve({ storageKey, byteLength: 0 });
  }
  open(storageKey: string, _range?: BlobRange): Promise<OpenedBlob> {
    return Promise.resolve({
      storageKey,
      byteLength: 0,
      contentLength: 0,
      range: null,
      body: (async function* () {})(),
    });
  }
  list(_options?: BlobListOptions): Promise<string[]> {
    return Promise.resolve([...this.keys]);
  }
  compare(_leftStorageKey: string, _rightStorageKey: string): Promise<boolean> {
    return Promise.resolve(true);
  }
  get(_storageKey: string): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
  equals(_storageKey: string, candidate: Uint8Array): Promise<boolean> {
    return Promise.resolve(candidate.byteLength === 0);
  }
  delete(_storageKey: string): Promise<void> {
    return Promise.resolve();
  }
}
