/**
 * Identical-import, near-match, collision simulation, and copy-on-write
 * tests (T050, US2, FR-034..FR-036, SC-011).
 */
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ContentStore,
  FilesystemBlobStore,
  type ContentCandidate,
} from "@myownnotion/blob-store";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";

let root: string;
let blobs: FilesystemBlobStore;
let store: ContentStore;

/** Registry double mirroring the database candidate lookup. */
class Registry {
  readonly entries: Array<{ contentId: Uuid; storageKey: string; sha256: string; length: number }> =
    [];

  lookup = async (sha256: Uint8Array, byteLength: number): Promise<ContentCandidate | null> => {
    const hex = Buffer.from(sha256).toString("hex");
    const found = this.entries.find(
      (entry) => entry.sha256 === hex && entry.length === byteLength,
    );
    return found === undefined
      ? null
      : { contentId: found.contentId, storageKey: found.storageKey };
  };

  register(result: { contentId: Uuid; storageKey: string; sha256: Uint8Array; byteLength: number }) {
    this.entries.push({
      contentId: result.contentId,
      storageKey: result.storageKey,
      sha256: Buffer.from(result.sha256).toString("hex"),
      length: result.byteLength,
    });
  }
}

const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "blob-test-"));
  blobs = new FilesystemBlobStore(root);
  store = new ContentStore(blobs);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("immutable ingest (T056)", () => {
  it("stores bytes verified and content-addressed", async () => {
    const registry = new Registry();
    const result = await store.ingest(bytes("hello world"), registry.lookup);
    expect(result.reusedExisting).toBe(false);
    expect(result.byteLength).toBe(11);
    const readBack = await store.read(result.storageKey);
    expect(new TextDecoder().decode(readBack as Uint8Array)).toBe("hello world");
  });

  it("identical imports may share physical bytes but keep distinct logical ids (FR-034/FR-035)", async () => {
    const registry = new Registry();
    const first = await store.ingest(bytes("same content"), registry.lookup);
    registry.register(first);
    const second = await store.ingest(bytes("same content"), registry.lookup);
    // Verified byte equality permits physical reuse…
    expect(second.reusedExisting).toBe(true);
    expect(second.storageKey).toBe(first.storageKey);
    // …but logical identity is assigned by the caller per import: the store
    // only returns the same *content* identity, never a logical file.
    expect(second.contentId).toBe(first.contentId);
  });

  it("near-match (same length, different content) never merges", async () => {
    const registry = new Registry();
    const first = await store.ingest(bytes("AAAAAAA"), registry.lookup);
    registry.register(first);
    const second = await store.ingest(bytes("AAAAAAB"), registry.lookup);
    expect(second.reusedExisting).toBe(false);
    expect(second.storageKey).not.toBe(first.storageKey);
  });

  it("collision simulation: matching digest+length with different bytes is rejected", async () => {
    // Simulate a registry that lies (as a hash collision would): candidate
    // claims the digest but its stored bytes differ.
    const registry = new Registry();
    const decoy = await store.ingest(bytes("decoy-bytes!"), registry.lookup);
    const incoming = bytes("real-bytes!!");
    const lyingLookup = async (): Promise<ContentCandidate> => ({
      contentId: decoy.contentId,
      storageKey: decoy.storageKey,
    });
    const result = await store.ingest(incoming, lyingLookup);
    // Byte-for-byte verification catches the mismatch: no reuse (FR-035).
    expect(result.reusedExisting).toBe(false);
    expect(result.storageKey).not.toBe(decoy.storageKey);
  });

  it("verification failure (unreadable candidate) stores separate content", async () => {
    const registry = new Registry();
    const phantom = async (): Promise<ContentCandidate> => ({
      contentId: generateUuidV7(),
      storageKey: "0".repeat(64), // never stored
    });
    const result = await store.ingest(bytes("content"), phantom);
    expect(result.reusedExisting).toBe(false);
    expect(await store.read(result.storageKey)).not.toBeNull();
  });
});

describe("copy-on-write (FR-036)", () => {
  it("updating one logical file's content never mutates stored bytes", async () => {
    const registry = new Registry();
    const original = await store.ingest(bytes("version 1"), registry.lookup);
    registry.register(original);
    // A logically independent file shares the physical content.
    const shared = await store.ingest(bytes("version 1"), registry.lookup);
    expect(shared.reusedExisting).toBe(true);

    // Copy-on-write update: new content object, old bytes untouched.
    const updated = await store.ingest(bytes("version 2"), registry.lookup);
    expect(updated.storageKey).not.toBe(original.storageKey);
    const untouched = await store.read(original.storageKey);
    expect(new TextDecoder().decode(untouched as Uint8Array)).toBe("version 1");
  });
});

describe("filesystem adapter integrity", () => {
  it("byte equality check is exact", async () => {
    const stored = await blobs.put(bytes("abcdef"));
    expect(await blobs.equals(stored.storageKey, bytes("abcdef"))).toBe(true);
    expect(await blobs.equals(stored.storageKey, bytes("abcdeg"))).toBe(false);
    expect(await blobs.equals(stored.storageKey, bytes("abcde"))).toBe(false);
  });

  it("rejects malformed storage keys", async () => {
    await expect(blobs.get("../escape")).rejects.toThrow();
  });

  it("re-putting identical bytes is idempotent", async () => {
    const first = await blobs.put(bytes("stable"));
    const second = await blobs.put(bytes("stable"));
    expect(second.storageKey).toBe(first.storageKey);
  });
});
