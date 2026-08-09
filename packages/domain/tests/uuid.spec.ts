/**
 * UUIDv7 identity primitives (T010, FR-009).
 *
 * Identities are client-generatable and never derived from names or paths.
 * Values generated inside one millisecond must still increase monotonically so
 * index locality holds, and untrusted strings must be validated rather than
 * cast blindly (FR-021).
 */

import { asUuid, generateUuidV7, isUuid, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

describe("isUuid", () => {
  it("accepts a generated identity", () => {
    expect(isUuid(generateUuidV7())).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["a truncated value", "0189d7b0-1c3a-7000-8000"],
    ["uppercase hex", "0189D7B0-1C3A-7000-8000-000000000000"],
    ["a non-hex character", "0189d7b0-1c3a-7000-8000-00000000000z"],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ])("rejects %s", (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe("asUuid", () => {
  it("returns the branded value for a valid UUID", () => {
    const generated = generateUuidV7();
    expect(asUuid(generated)).toBe(generated);
  });

  it("throws on an invalid identifier rather than casting blindly", () => {
    expect(() => asUuid("not-a-uuid")).toThrow(TypeError);
  });

  it("includes the offending value in the error for diagnosability", () => {
    expect(() => asUuid("bad")).toThrow(/bad/);
  });
});

describe("generateUuidV7", () => {
  it("stamps version 7 and the RFC 9562 variant", () => {
    // Both nibbles come from randomized bytes, so a single sample would only
    // catch a missing variant mask about half the time. Check many.
    for (let index = 0; index < 200; index += 1) {
      const value = generateUuidV7();
      // Version nibble: first character of the third group.
      expect(value[14]).toBe("7");
      // Variant is 10xx: first character of the fourth group is 8, 9, a or b.
      expect(["8", "9", "a", "b"]).toContain(value[19]);
    }
  });

  it("increases monotonically within a single millisecond", () => {
    const frozen = () => 1_760_000_000_000;
    const values = Array.from({ length: 50 }, () => generateUuidV7(frozen));
    const sorted = [...values].sort();
    expect(values).toEqual(sorted);
    // Every value is distinct despite sharing a timestamp.
    expect(new Set(values).size).toBe(values.length);
  });

  it("orders values across advancing milliseconds", () => {
    const earlier = generateUuidV7(() => 1_760_000_000_000);
    const later = generateUuidV7(() => 1_760_000_000_001);
    expect(earlier < later).toBe(true);
  });

  it("encodes the supplied timestamp in the leading bytes", () => {
    const millis = 1_760_000_000_000;
    const value: Uuid = generateUuidV7(() => millis);
    const encoded = Number.parseInt(value.replaceAll("-", "").slice(0, 12), 16);
    expect(encoded).toBe(millis);
  });

  it("produces valid identities by default", () => {
    expect(isUuid(generateUuidV7())).toBe(true);
  });
});
