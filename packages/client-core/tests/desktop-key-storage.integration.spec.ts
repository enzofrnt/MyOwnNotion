import {
  LOCAL_ENTITY_TYPES,
  LocalCipher,
  LocalKeyManager,
  type WrappedKeyEnvelopeRecord,
  WrappingSecureKeyStorage,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

describe("desktop key wrapping integration", () => {
  it("round-trips a sealed record and never stores plaintext bytes", async () => {
    const stored: WrappedKeyEnvelopeRecord[] = [];
    const storage = new WrappingSecureKeyStorage(
      {
        async wrap(bytes) {
          return {
            keyId: "wrap-1",
            algorithm: "os-protected-envelope-v1",
            ciphertext: Buffer.from(bytes.map((value) => value ^ 0x5a)).toString("base64"),
            createdAt: new Date().toISOString(),
            revokedAt: null,
          };
        },
        async unwrap(envelope) {
          return Uint8Array.from(
            Buffer.from(envelope.ciphertext, "base64"),
            (value) => value ^ 0x5a,
          );
        },
      },
      {
        async load() {
          return stored[0] ?? null;
        },
        async save(record) {
          stored.splice(0, stored.length, record);
        },
        async clear() {
          stored.splice(0);
        },
      },
    );

    const keys = new LocalKeyManager(storage);
    await keys.establish();
    const cipher = new LocalCipher(keys);
    const binding = {
      installationId: "018f2b7c-0000-7000-8000-000000000001",
      workspaceId: generateUuidV7(),
      entityType: LOCAL_ENTITY_TYPES.itemName,
      entityId: "item-1",
      keyGeneration: 1,
      recordVersion: 1,
    };
    const envelope = await cipher.seal(binding, "Quarterly numbers");
    expect(JSON.stringify(envelope)).not.toContain("Quarterly");
    expect(JSON.stringify(stored)).not.toContain("Quarterly");
    expect(await cipher.open(binding, envelope)).toBe("Quarterly numbers");
  });
});
