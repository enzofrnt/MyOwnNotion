import { describe, expect, it } from "vitest";
import { MemorySecureStorage } from "../src/security/local-key-state.ts";
import type { SecureKeyStorage } from "../src/security/secure-key-storage.ts";

describe("SecureKeyStorage contract", () => {
  it("round-trips through a fallback store without Electron types", async () => {
    const storage: SecureKeyStorage = new MemorySecureStorage();
    expect(storage.kind).toBe("fallback");
    expect(await storage.load()).toBeNull();
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await storage.save({ keyId: "k1", key });
    const loaded = await storage.load();
    expect(loaded?.keyId).toBe("k1");
    await storage.clear();
    expect(await storage.load()).toBeNull();
  });
});
