import { createHash, randomBytes, webcrypto } from "node:crypto";
import { EnvelopeDecryptionError, open, seal } from "@myownnotion/domain/security";
import { expect, it } from "vitest";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it.each([0, 1, 17, 4 * 1024 ** 2])(
  "authenticates %i bytes and transfers independent output ownership for offset views",
  async (length) => {
    const key = randomBytes(48).subarray(7, 39);
    const nonce = randomBytes(32).subarray(3, 15);
    const aad = randomBytes(32).subarray(5, 23);
    const input = randomBytes(length + 16).subarray(9, length + 9);
    const expectedDigest = digest(input);
    const oracleKey = await webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const oracle = new Uint8Array(
      await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
        oracleKey,
        input,
      ),
    );
    const encrypted = seal(key, input, aad, nonce);
    expect(encrypted.ciphertext.constructor).toBe(Uint8Array);
    expect(digest(encrypted.ciphertext)).toBe(digest(oracle.subarray(0, length)));
    expect(encrypted.tag).toEqual(oracle.subarray(length));
    expect(digest(input)).toBe(expectedDigest);
    input.fill(0);
    const opened = open(key, encrypted, aad);
    expect(opened.constructor).toBe(Uint8Array);
    expect(digest(opened)).toBe(expectedDigest);
    const again = open(key, encrypted, aad);
    opened.fill(0);
    expect(digest(again)).toBe(expectedDigest);
    encrypted.ciphertext.fill(0);
    key.fill(0);
    nonce.fill(0);
    aad.fill(0);
    expect(digest(again)).toBe(expectedDigest);
  },
);

it("never returns unauthenticated plaintext after a valid-size tag substitution", () => {
  const key = randomBytes(32);
  const aad = randomBytes(19);
  const encrypted = seal(key, randomBytes(4 * 1024 ** 2), aad);
  encrypted.tag[0] = (encrypted.tag[0] as number) ^ 1;
  expect(() => open(key, encrypted, aad)).toThrow(EnvelopeDecryptionError);
});
