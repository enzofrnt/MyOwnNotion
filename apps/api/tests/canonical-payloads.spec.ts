import { describe, expect, it } from "vitest";
import { isProtectedPayload, PROTECTED_PAYLOAD } from "../src/security/canonical-payloads.ts";

describe("protected canonical payload marker", () => {
  it("matches only the exact owned marker", () => {
    expect(isProtectedPayload(PROTECTED_PAYLOAD)).toBe(true);
    expect(isProtectedPayload({ ...PROTECTED_PAYLOAD, text: "authored content" })).toBe(false);
    expect(isProtectedPayload({ $myownnotionProtected: 1, extra: true })).toBe(false);
    expect(isProtectedPayload(Object.create({ $myownnotionProtected: 1 }))).toBe(false);
  });
});
