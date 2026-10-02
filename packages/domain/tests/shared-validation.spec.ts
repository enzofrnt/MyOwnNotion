import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  copyBytes,
  findNulPath,
  generateUuidV7,
  isCanonicalTimestamp,
  markKeyV3,
  readStoredDocumentV3,
  serialiseDocumentV3,
} from "../src/index.ts";

describe("shared portable validation contracts", () => {
  it("finds paths through deep structures and cycles without recursion", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    cycle["values"] = ["ok", { text: "nul\0" }];
    expect(findNulPath(cycle)).toBe("$.values[1].text");
    expect(findNulPath({ "bad\0key": "ok" })).toBe("$.<object-key-with-U+0000>");
    let deep: unknown = "\0";
    for (let i = 0; i < 20000; i++) deep = [deep];
    expect(findNulPath(deep)).toHaveLength(1 + 3 * 20000);
    expect(findNulPath({ values: ["", null, 1] })).toBeNull();
  });
  it("sorts keys while preserving array order and primitive failure policy", () => {
    expect(canonicalJson({ z: [2, 1], a: { b: true, a: null } })).toBe(
      '{"a":{"a":null,"b":true},"z":[2,1]}',
    );
    expect(canonicalJson(undefined)).toBeUndefined();
    expect(canonicalJson({ a: undefined })).toBe('{"a":undefined}');
    expect(() =>
      canonicalJson({ a: undefined }, (value) => {
        const text = JSON.stringify(value);
        if (text === undefined) throw new TypeError("not serializable");
        return text;
      }),
    ).toThrow("not serializable");
  });
  it("accepts only canonical timestamps", () => {
    expect(isCanonicalTimestamp("2026-10-02T12:00:00.000Z")).toBe(true);
    for (const value of [
      null,
      1,
      "",
      "2026-10-02",
      "2026-10-02T12:00:00Z",
      "2026-10-02T14:00:00.000+02:00",
      "invalid",
    ])
      expect(isCanonicalTimestamp(value)).toBe(false);
  });
  it("copies only a view's bytes and isolates later mutations", () => {
    const backing = new Uint8Array([0, 1, 2, 3]);
    const owned = copyBytes(backing.subarray(1, 3));
    expect([...owned]).toEqual([1, 2]);
    expect(owned.byteOffset).toBe(0);
    expect(owned.buffer.byteLength).toBe(2);
    backing[1] = 9;
    expect([...owned]).toEqual([1, 2]);
  });
  it("reads valid stored envelopes and refuses malformed input", () => {
    const document = {
      blocks: [{ type: "paragraph" as const, id: generateUuidV7(), content: [{ text: "texte" }] }],
    };
    expect(readStoredDocumentV3({ formatVersion: 3, body: serialiseDocumentV3(document) })).toEqual(
      document,
    );
    for (const value of [
      null,
      [],
      {},
      { formatVersion: "3", body: {} },
      { formatVersion: 3, body: { bad: true } },
    ])
      expect(readStoredDocumentV3(value)).toBeNull();
  });
  it("preserves the lazy reader's legacy-version fallback", () => {
    expect(readStoredDocumentV3({ formatVersion: 999, body: {} })).toEqual({ blocks: [] });
  });
  it("keeps caller-specific identities for opaque marks", () => {
    const mark = { type: "unknown" as const, declaredType: "future", raw: { z: 1, a: 2 } };
    expect(markKeyV3(mark)).toBe('unknown:{"a":2,"z":1}');
    expect(markKeyV3(mark, JSON.stringify)).toBe('unknown:{"z":1,"a":2}');
  });
});
