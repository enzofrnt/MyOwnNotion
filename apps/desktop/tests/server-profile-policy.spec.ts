import { describe, expect, it } from "vitest";
import { classifyServerUrl, normalizeServerUrl } from "../src/server-profile-policy.ts";

describe("desktop server URL policy", () => {
  it("accepts loopback HTTP", () => {
    const result = normalizeServerUrl("http://127.0.0.1:3001");
    expect(result).toEqual({
      ok: true,
      origin: "http://127.0.0.1:3001",
      classification: "local-http",
    });
  });

  it("accepts HTTPS remote origins", () => {
    const result = normalizeServerUrl("https://notes.example.org");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.classification).toBe("https");
    }
  });

  it("marks non-local HTTP as insecure rather than refusing it", () => {
    const result = normalizeServerUrl("http://192.168.1.10");
    expect(result).toEqual({
      ok: true,
      origin: "http://192.168.1.10",
      classification: "insecure-http",
    });
    expect(classifyServerUrl(new URL("http://notes.example.org"))).toBe("insecure-http");
  });

  it("refuses incompatible schemes", () => {
    expect(normalizeServerUrl("ftp://files.example.org").ok).toBe(false);
    expect(normalizeServerUrl("javascript:alert(1)").ok).toBe(false);
    expect(normalizeServerUrl("file:///tmp").ok).toBe(false);
  });
});
