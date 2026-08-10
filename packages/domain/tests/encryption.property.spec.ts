/**
 * Envelope and crypto invariants (T009, feature 002).
 *
 * These are the properties a reviewer should be able to rely on without
 * reading `crypto.ts`:
 *
 *   - a round trip returns exactly the input, for any non-empty plaintext;
 *   - two encryptions of the same plaintext never share a nonce or ciphertext;
 *   - any change to the key, the AAD binding, the ciphertext, the tag, the
 *     nonce, or the salt makes the read fail;
 *   - every failure is the same opaque error, so it cannot be used as an
 *     oracle for *which* check failed;
 *   - distinct bindings never collide into the same AAD string.
 */
import {
  aadDigest,
  CRYPTO_SIZES,
  CryptoInputError,
  canonicalAad,
  deriveRecordKey,
  type EnvelopeBinding,
  EnvelopeDecryptionError,
  envelopeMatchesBinding,
  fromBase64Url,
  openEnvelope,
  randomKey,
  randomNonce,
  randomSalt,
  sealEnvelope,
  toBase64Url,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const uuidArbitrary = fc.uuid({ version: 7 });
const entityTypeArbitrary = fc.constantFrom(
  "page.document",
  "file.chunk",
  "revision.snapshot",
  "relationship.metadata",
);

const bindingArbitrary: fc.Arbitrary<EnvelopeBinding> = fc.record({
  installationId: uuidArbitrary,
  workspaceId: uuidArbitrary,
  entityType: entityTypeArbitrary,
  entityId: uuidArbitrary,
  keyGeneration: fc.integer({ min: 1, max: 64 }),
  recordVersion: fc.integer({ min: 1, max: 1024 }),
});

// `mn.enc.v1` has no representation for an empty ciphertext, so the empty
// payload is a rejected input rather than a round-trip case.
const plaintextArbitrary = fc.uint8Array({ minLength: 1, maxLength: 512 });

/** Flips one bit in a base64url field, keeping it decodable. */
function tamperBase64Url(value: string): string {
  const bytes = fromBase64Url(value);
  if (bytes.length === 0) {
    return toBase64Url(new Uint8Array([1]));
  }
  const copy = new Uint8Array(bytes);
  copy[0] = (copy[0] as number) ^ 0x01;
  return toBase64Url(copy);
}

describe("envelope round trip", () => {
  it("returns the exact plaintext for any binding and payload", () => {
    fc.assert(
      fc.property(bindingArbitrary, plaintextArbitrary, (binding, plaintext) => {
        const masterKey = randomKey();
        const envelope = sealEnvelope(masterKey, binding, plaintext);
        expect(openEnvelope(masterKey, envelope, binding)).toEqual(plaintext);
      }),
      { numRuns: 60 },
    );
  });

  it("refuses an empty payload rather than emitting an unreadable envelope", () => {
    // The contract's ciphertext field is base64url with minLength 1. Encrypting
    // an empty payload would produce an envelope that no validator accepts and
    // that cannot be read back, so this must fail at write time.
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    expect(() => sealEnvelope(randomKey(), binding, new Uint8Array())).toThrow(CryptoInputError);
  });

  it("carries chunkIndex through for file chunks", () => {
    const base = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    const binding: EnvelopeBinding = { ...base, entityType: "file.chunk", chunkIndex: 7 };
    const masterKey = randomKey();
    const envelope = sealEnvelope(masterKey, binding, new Uint8Array([1, 2, 3]));
    expect(envelope.chunkIndex).toBe(7);
    expect(openEnvelope(masterKey, envelope, binding)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("nonce and ciphertext uniqueness", () => {
  it("never repeats a nonce across encryptions of identical input", () => {
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    const masterKey = randomKey();
    const plaintext = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

    const nonces = new Set<string>();
    const salts = new Set<string>();
    const ciphertexts = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const envelope = sealEnvelope(masterKey, binding, plaintext);
      nonces.add(envelope.nonce);
      salts.add(envelope.salt);
      ciphertexts.add(envelope.ciphertext);
    }
    expect(nonces.size).toBe(200);
    expect(salts.size).toBe(200);
    // Identical plaintext under a fresh salt and nonce must still differ.
    expect(ciphertexts.size).toBe(200);
  });

  it("emits fields at the exact declared byte widths", () => {
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    const envelope = sealEnvelope(randomKey(), binding, new Uint8Array([9]));
    expect(fromBase64Url(envelope.salt)).toHaveLength(CRYPTO_SIZES.salt);
    expect(fromBase64Url(envelope.nonce)).toHaveLength(CRYPTO_SIZES.nonce);
    expect(fromBase64Url(envelope.tag)).toHaveLength(CRYPTO_SIZES.tag);
    expect(fromBase64Url(envelope.aadDigest)).toHaveLength(CRYPTO_SIZES.digest);
  });
});

describe("fail-closed reads", () => {
  it("refuses a wrong master key", () => {
    fc.assert(
      fc.property(bindingArbitrary, plaintextArbitrary, (binding, plaintext) => {
        const envelope = sealEnvelope(randomKey(), binding, plaintext);
        expect(() => openEnvelope(randomKey(), envelope, binding)).toThrow(EnvelopeDecryptionError);
      }),
      { numRuns: 40 },
    );
  });

  it("refuses every single-field binding substitution", () => {
    const binding: EnvelopeBinding = {
      installationId: "018f2b7c-0000-7000-8000-000000000001",
      workspaceId: "018f2b7c-0000-7000-8000-000000000002",
      entityType: "page.document",
      entityId: "018f2b7c-0000-7000-8000-000000000003",
      keyGeneration: 3,
      recordVersion: 5,
    };
    const masterKey = randomKey();
    const envelope = sealEnvelope(masterKey, binding, new Uint8Array([4, 2]));

    const substitutions: Array<[string, EnvelopeBinding]> = [
      ["installationId", { ...binding, installationId: "018f2b7c-0000-7000-8000-0000000000ff" }],
      ["workspaceId", { ...binding, workspaceId: "018f2b7c-0000-7000-8000-0000000000ff" }],
      ["entityId", { ...binding, entityId: "018f2b7c-0000-7000-8000-0000000000ff" }],
      ["entityType", { ...binding, entityType: "file.chunk" }],
      ["keyGeneration", { ...binding, keyGeneration: 4 }],
      ["recordVersion", { ...binding, recordVersion: 6 }],
      ["chunkIndex", { ...binding, chunkIndex: 0 }],
    ];
    for (const [field, substituted] of substitutions) {
      expect(
        () => openEnvelope(masterKey, envelope, substituted),
        `substituting ${field} must fail`,
      ).toThrow(EnvelopeDecryptionError);
    }
  });

  it("refuses a tampered ciphertext, tag, nonce, salt, or AAD digest", () => {
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    const masterKey = randomKey();
    const envelope = sealEnvelope(masterKey, binding, new Uint8Array([7, 7, 7, 7]));

    const fields = ["ciphertext", "tag", "nonce", "salt", "aadDigest"] as const;
    for (const field of fields) {
      const tampered = { ...envelope, [field]: tamperBase64Url(envelope[field]) };
      expect(
        () => openEnvelope(masterKey, tampered, binding),
        `tampering ${field} must fail`,
      ).toThrow(EnvelopeDecryptionError);
    }
  });

  it("reports every failure with the same opaque error and message", () => {
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    const envelope = sealEnvelope(randomKey(), binding, new Uint8Array([1]));

    const failures = [
      () => openEnvelope(randomKey(), envelope, binding),
      () => openEnvelope(randomKey(), { ...envelope, tag: tamperBase64Url(envelope.tag) }, binding),
      () => openEnvelope(randomKey(), envelope, { ...binding, keyGeneration: 99 }),
      () => openEnvelope(new Uint8Array(8), envelope, binding),
    ];
    const messages = new Set<string>();
    for (const failure of failures) {
      try {
        failure();
        throw new Error("expected a decryption failure");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvelopeDecryptionError);
        messages.add((error as Error).message);
      }
    }
    // One message for every cause: the error cannot act as an oracle.
    expect(messages.size).toBe(1);
  });

  it("rejects a foreign-format or foreign-algorithm envelope before decrypting", () => {
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    const envelope = sealEnvelope(randomKey(), binding, new Uint8Array([1]));
    expect(envelopeMatchesBinding({ ...envelope, format: "mn.enc.v2" as never }, binding)).toBe(
      false,
    );
    expect(
      envelopeMatchesBinding({ ...envelope, algorithm: "AES-128-CBC" as never }, binding),
    ).toBe(false);
  });
});

describe("canonical AAD", () => {
  it("maps distinct bindings to distinct strings", () => {
    fc.assert(
      fc.property(bindingArbitrary, bindingArbitrary, (left, right) => {
        const same =
          left.installationId === right.installationId &&
          left.workspaceId === right.workspaceId &&
          left.entityType === right.entityType &&
          left.entityId === right.entityId &&
          left.keyGeneration === right.keyGeneration &&
          left.recordVersion === right.recordVersion;
        expect(canonicalAad(left) === canonicalAad(right)).toBe(same);
      }),
      { numRuns: 200 },
    );
  });

  it("distinguishes a whole-record envelope from chunk 0 of the same entity", () => {
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    expect(canonicalAad(binding)).not.toBe(canonicalAad({ ...binding, chunkIndex: 0 }));
  });

  it("is stable: the same binding always produces the same digest", () => {
    fc.assert(
      fc.property(bindingArbitrary, (binding) => {
        expect(aadDigest(binding)).toEqual(aadDigest({ ...binding }));
      }),
      { numRuns: 50 },
    );
  });

  it("rejects a malformed entity type instead of encoding it", () => {
    const binding = fc.sample(bindingArbitrary, 1)[0] as EnvelopeBinding;
    for (const entityType of ["Page.Document", "page document", "", "a".repeat(65), "1page"]) {
      expect(() => canonicalAad({ ...binding, entityType })).toThrow();
    }
  });
});

describe("record key derivation", () => {
  it("produces a different key for a different salt or info", () => {
    const masterKey = randomKey();
    const salt = randomSalt();
    const base = deriveRecordKey(masterKey, salt, "info-a");
    expect(base).toHaveLength(CRYPTO_SIZES.key);
    expect(deriveRecordKey(masterKey, salt, "info-b")).not.toEqual(base);
    expect(deriveRecordKey(masterKey, randomSalt(), "info-a")).not.toEqual(base);
    expect(deriveRecordKey(randomKey(), salt, "info-a")).not.toEqual(base);
  });

  it("is deterministic for identical inputs", () => {
    const masterKey = randomKey();
    const salt = randomSalt();
    expect(deriveRecordKey(masterKey, salt, "info")).toEqual(
      deriveRecordKey(masterKey, salt, "info"),
    );
  });

  it("refuses a master key or salt of the wrong size", () => {
    expect(() => deriveRecordKey(new Uint8Array(16), randomSalt(), "info")).toThrow();
    expect(() => deriveRecordKey(randomKey(), new Uint8Array(8), "info")).toThrow();
  });

  it("generates nonces of the GCM-specified width", () => {
    expect(randomNonce()).toHaveLength(CRYPTO_SIZES.nonce);
  });
});
