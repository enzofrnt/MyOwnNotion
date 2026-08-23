/**
 * The immutable build identity compared by the pre-migration update guard.
 *
 * The environment decides, and both decisions matter: a deployment that names
 * its version must be read exactly (whitespace and all, then trimmed), and one
 * that says nothing must fall back to the release version rather than crash.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the application version", () => {
  it("falls back to the release version when the environment is silent", async () => {
    vi.stubEnv("MYOWNNOTION_APPLICATION_VERSION", "");
    const { APPLICATION_VERSION } = await import("../src/application-version.ts");
    expect(APPLICATION_VERSION).toBe("0.1.0");
  });

  it("trims what the environment provides", async () => {
    vi.stubEnv("MYOWNNOTION_APPLICATION_VERSION", " 2.0.0-rc.1 ");
    const { APPLICATION_VERSION } = await import("../src/application-version.ts");
    expect(APPLICATION_VERSION).toBe("2.0.0-rc.1");
  });
});
