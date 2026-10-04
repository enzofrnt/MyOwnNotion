import { expect, it } from "vitest";
import {
  protectedChunkManifestEntry,
  protectedChunksMatchManifest,
} from "../src/files/protected-chunk-manifest.ts";

it("requires exact ordered agreement with every authenticated chunk field", () => {
  const chunks = [
    { chunkIndex: 0, byteLength: 12, storageKey: "a", keyGeneration: 1, recordVersion: 2 },
    { chunkIndex: 1, byteLength: 15, storageKey: "b", keyGeneration: 2, recordVersion: 3 },
  ];
  const trusted = chunks.map(protectedChunkManifestEntry);
  const first = trusted[0];
  const second = trusted[1];
  if (first === undefined || second === undefined) throw new Error("Expected two chunks");
  expect(protectedChunksMatchManifest(chunks, trusted)).toBe(true);
  expect(protectedChunksMatchManifest([], [])).toBe(true);
  expect(protectedChunksMatchManifest(chunks, trusted.slice(1))).toBe(false);
  expect(protectedChunksMatchManifest([...chunks].reverse(), trusted)).toBe(false);
  for (const key of [
    "index",
    "byteLength",
    "storageKey",
    "keyGeneration",
    "recordVersion",
  ] as const) {
    const changed = { ...first, [key]: key === "storageKey" ? "wrong" : 99 };
    expect(protectedChunksMatchManifest(chunks, [changed, second])).toBe(false);
  }
});
