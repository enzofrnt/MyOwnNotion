import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type WrappedKeyEnvelopeRecord,
  WrappingSecureKeyStorage,
} from "../src/security/wrapping-secure-key-storage.ts";

function fixture() {
  let record: WrappedKeyEnvelopeRecord | null = null;
  const wrappingKey = randomBytes(32);
  const transient: Uint8Array[] = [];
  const port = {
    wrap: vi.fn(async (bytes: Uint8Array): Promise<WrappedKeyEnvelopeRecord> => {
      transient.push(bytes);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", wrappingKey, nonce);
      const content = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return {
        keyId: "protected-key",
        algorithm: "os-protected-envelope-v1",
        ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), content]).toString("base64"),
        createdAt: new Date().toISOString(),
        revokedAt: null,
      };
    }),
    unwrap: vi.fn(async (envelope: WrappedKeyEnvelopeRecord) => {
      const packed = Buffer.from(envelope.ciphertext, "base64");
      const cipher = createDecipheriv("aes-256-gcm", wrappingKey, packed.subarray(0, 12));
      cipher.setAuthTag(packed.subarray(12, 28));
      const bytes = Uint8Array.from(
        Buffer.concat([cipher.update(packed.subarray(28)), cipher.final()]),
      );
      transient.push(bytes);
      return bytes;
    }),
  };
  const store = {
    load: vi.fn(async () => record),
    save: vi.fn(async (value: WrappedKeyEnvelopeRecord) => {
      record = value;
    }),
    clear: vi.fn(async () => {
      record = null;
    }),
  };
  return { port, store, transient, storage: new WrappingSecureKeyStorage(port, store) };
}
describe("platform-wrapped key custody", () => {
  it("opens the same ciphertext after restart with a non-extractable key and wipes transient material", async () => {
    const f = fixture();
    const before = await f.storage.mint();
    const nonce = randomBytes(12);
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      before.key,
      new TextEncoder().encode("Durable offline data"),
    );
    const after = await new WrappingSecureKeyStorage(f.port, f.store).load();
    if (!after) throw new Error("Missing restored key");
    expect(after.keyId).toBe(before.keyId);
    expect(after.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", after.key)).rejects.toThrow();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, after.key, sealed);
    expect(new TextDecoder().decode(plain)).toBe("Durable offline data");
    expect(f.transient.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
    await expect(f.storage.save(after)).resolves.toBeUndefined();
    await expect(f.storage.save({ ...after, keyId: "foreign" })).rejects.toThrow("unwrapped");
    await f.storage.clear();
    expect(await f.storage.load()).toBeNull();
  });
  it("does not unwrap a revoked envelope or turn a persistence failure into a new identity", async () => {
    const f = fixture();
    await f.storage.mint();
    const envelope = await f.store.load();
    if (!envelope) throw new Error("Missing envelope");
    await f.store.save({ ...envelope, revokedAt: new Date().toISOString() });
    expect(await f.storage.load()).toBeNull();
    expect(f.port.unwrap).not.toHaveBeenCalled();
    f.store.load.mockRejectedValue(new Error("disk unavailable"));
    await expect(f.storage.load()).rejects.toThrow("disk unavailable");
    expect(f.port.wrap).toHaveBeenCalledTimes(1);
  });
  it("wipes newly minted bytes even when the envelope cannot commit", async () => {
    const f = fixture();
    f.store.save.mockRejectedValue(new Error("quota"));
    await expect(f.storage.mint()).rejects.toThrow("quota");
    expect(f.transient[0]?.every((value) => value === 0)).toBe(true);
  });
  it("wipes malformed unwrapped material when WebCrypto rejects the key", async () => {
    const f = fixture();
    await f.storage.mint();
    const invalid = new Uint8Array([1, 2, 3]);
    f.port.unwrap.mockResolvedValue(invalid);
    await expect(f.storage.load()).rejects.toThrow();
    expect([...invalid]).toEqual([0, 0, 0]);
  });
});
