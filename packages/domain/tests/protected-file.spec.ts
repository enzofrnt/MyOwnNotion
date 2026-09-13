import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EMPTY_FILE_SHA256,
  PROTECTED_FILE_CHUNK_BYTES,
  type ProtectedFileManifest,
  readProtectedFileManifest,
} from "../src/files/protected-file.ts";

const identity = {
  kind: "content" as const,
  id: "11111111-1111-4111-8111-111111111111",
  recordVersion: 1,
};
function manifest(byteLength = PROTECTED_FILE_CHUNK_BYTES + 3): ProtectedFileManifest {
  return {
    format: "myownnotion.protected-file",
    formatVersion: 1,
    kind: "content",
    id: identity.id,
    recordVersion: 1,
    byteLength,
    sha256: byteLength === 0 ? EMPTY_FILE_SHA256 : "ab".repeat(32),
    chunks: Array.from(
      { length: Math.ceil(byteLength / PROTECTED_FILE_CHUNK_BYTES) },
      (_, index) => ({
        index,
        byteLength: Math.min(
          PROTECTED_FILE_CHUNK_BYTES,
          byteLength - index * PROTECTED_FILE_CHUNK_BYTES,
        ),
        storageKey: index.toString(16).padStart(64, "0"),
        keyGeneration: 1,
        recordVersion: 1,
      }),
    ),
  };
}

describe("authenticated file inventory shape", () => {
  it("accepts complete shapes at every chunk boundary without reading whole-file bytes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 * 1024 ** 3 }), (length) => {
        const input = manifest(length);
        expect(readProtectedFileManifest(input, identity)).toEqual(input);
      }),
      { numRuns: 100 },
    );
  });
  it("pins 4 MiB chunks and authenticates the empty-file digest", () => {
    expect(PROTECTED_FILE_CHUNK_BYTES).toBe(4 * 1024 ** 2);
    expect(readProtectedFileManifest(manifest(0), identity).chunks).toEqual([]);
    expect(() =>
      readProtectedFileManifest({ ...manifest(0), sha256: "ab".repeat(32) }, identity),
    ).toThrow();
  });
  it("rejects a deleted tail, duplicated/reordered parts and a changed final length", () => {
    const input = manifest();
    const first = input.chunks[0];
    const last = input.chunks[1];
    for (const chunks of [
      [],
      [first],
      [first, first],
      [last, first],
      [...input.chunks, last],
      [first, { ...last, byteLength: 2 }],
    ]) {
      expect(() => readProtectedFileManifest({ ...input, chunks }, identity)).toThrow();
    }
  });
  it("rejects removal of any part for arbitrarily sized multipart files", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: PROTECTED_FILE_CHUNK_BYTES + 1, max: 64 * PROTECTED_FILE_CHUNK_BYTES }),
        fc.nat(),
        (length, selected) => {
          const input = manifest(length);
          const index = selected % input.chunks.length;
          expect(() =>
            readProtectedFileManifest(
              { ...input, chunks: input.chunks.filter((_, position) => position !== index) },
              identity,
            ),
          ).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
  it.each([
    null,
    [],
    {},
    { ...manifest(), formatVersion: 2 },
    { ...manifest(), kind: "directory" },
    { ...manifest(), byteLength: -1 },
    { ...manifest(), byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { ...manifest(), byteLength: 1.5 },
    { ...manifest(), sha256: null },
    { ...manifest(), sha256: "../private" },
    { ...manifest(), recordVersion: 0 },
  ])("refuses malformed or unsupported inventory %#", (input) => {
    expect(() => readProtectedFileManifest(input, identity)).toThrow();
  });
  it.each([
    { storageKey: "../secret" },
    { storageKey: "f".repeat(63) },
    { index: -1 },
    { index: 1 },
    { keyGeneration: 0 },
    { keyGeneration: 1.5 },
    { keyGeneration: 2 ** 31 },
    { recordVersion: 0 },
    { recordVersion: 2 ** 31 },
    { byteLength: 0 },
    null,
  ])("rejects modified chunk provenance %#", (patch) => {
    const input = manifest(3);
    expect(() =>
      readProtectedFileManifest(
        { ...input, chunks: [patch === null ? null : { ...input.chunks[0], ...patch }] },
        identity,
      ),
    ).toThrow();
  });
  it("retains mixed historical chunk generations during progressive rotation", () => {
    const input = manifest();
    const rotated = {
      ...input,
      chunks: input.chunks.map((chunk, index) => ({
        ...chunk,
        keyGeneration: index + 1,
        recordVersion: index + 1,
      })),
    };
    expect(readProtectedFileManifest(rotated, identity)).toEqual(rotated);
  });
  it("rejects a manifest transplanted to another content, version or entity purpose", () => {
    for (const expected of [
      { ...identity, id: "22222222-2222-4222-8222-222222222222" },
      { ...identity, kind: "upload" as const },
      { ...identity, recordVersion: 2 },
    ]) {
      expect(() => readProtectedFileManifest(manifest(), expected)).toThrow();
    }
  });
  it("validates committed upload shape independently from its final declared size", () => {
    const source = manifest(3);
    const upload = { ...source, kind: "upload", declaredLength: 100, sha256: null };
    const expected = { ...identity, kind: "upload" as const };
    expect(readProtectedFileManifest(upload, expected)).toEqual(upload);
    expect(
      readProtectedFileManifest(
        { ...manifest(0), kind: "upload", declaredLength: 0, sha256: null },
        expected,
      ).byteLength,
    ).toBe(0);
    for (const changed of [
      { declaredLength: 2 },
      { declaredLength: -1 },
      { declaredLength: 1.5 },
      { declaredLength: Infinity },
      { declaredLength: undefined },
      { sha256: "ab".repeat(32) },
    ]) {
      expect(() => readProtectedFileManifest({ ...upload, ...changed }, expected)).toThrow();
    }
  });
});
