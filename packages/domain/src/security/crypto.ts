/**
 * Authenticated-encryption primitives (T015, feature 002).
 *
 * AES-256-GCM with an HKDF-SHA-256 per-record derivation, plus the scrypt
 * wrapping used for passphrase-protected recovery kits. Parameters are
 * normative in
 * `specs/002-owner-security-foundation/contracts/security-artifacts.schema.json`.
 *
 * This module owns *only* the cryptography. Envelope assembly and AAD
 * construction live in `./envelopes.ts`, recovery-kit shaping in
 * `./recovery-artifacts.ts`, so a mistake in one layer cannot quietly weaken
 * the other.
 *
 * Two rules the callers depend on:
 *
 *   1. **A nonce is never reused under one derived key.** Each record derives
 *      its own key from a fresh random salt, and each encryption generates a
 *      fresh random nonce; the pair is therefore unique with overwhelming
 *      probability without any counter to keep in sync.
 *   2. **A failure is opaque.** Decrypt failures — wrong key, wrong
 *      generation, tampered ciphertext, mismatched AAD — all raise the same
 *      `EnvelopeDecryptionError` with no detail about which check failed, so
 *      the error cannot be used as an oracle.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

// ---------------------------------------------------------------------------
// Sizes, all in bytes
// ---------------------------------------------------------------------------

export const CRYPTO_SIZES = {
  /** AES-256 */
  key: 32,
  /** GCM standard nonce; 96 bits is the size GCM is specified for. */
  nonce: 12,
  /** GCM authentication tag, full length. */
  tag: 16,
  /** Per-record HKDF salt. */
  salt: 16,
  /** SHA-256 output. */
  digest: 32,
} as const;

export const HKDF_HASH = "sha256" as const;
export const AES_GCM_CIPHER = "aes-256-gcm" as const;

/** scrypt parameters for passphrase-wrapped recovery material. */
export interface ScryptParameters {
  readonly N: 8192 | 16384 | 32768 | 65536 | 131072;
  readonly r: 8;
  readonly p: number;
  readonly keyLength: 32;
}

/**
 * Default recovery-kit cost. N=65536, r=8, p=1 needs about 64 MiB and a
 * fraction of a second, which is the point: a stolen kit file must be
 * expensive to attack offline, and the owner unwraps it at most a few times.
 */
export const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = {
  N: 65536,
  r: 8,
  p: 1,
  keyLength: 32,
};

/** scrypt needs a memory budget above N * r * 128 or it refuses to run. */
function scryptMemoryBudget(parameters: ScryptParameters): number {
  return parameters.N * parameters.r * 128 * 2;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Raised for every decryption failure, deliberately without a reason. The
 * caller maps it to a safe problem code; it must never be widened into
 * "wrong key" versus "tampered ciphertext".
 */
export class EnvelopeDecryptionError extends Error {
  constructor() {
    super("protected record could not be decrypted");
    this.name = "EnvelopeDecryptionError";
  }
}

/** Raised when an input is structurally invalid before any key is touched. */
export class CryptoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoInputError";
  }
}

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CryptoInputError("value is not unpadded base64url");
  }
  return new Uint8Array(Buffer.from(value, "base64url"));
}

/** Constant-time comparison; length differences are reported without leaking. */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function sha256(...parts: readonly (Uint8Array | string)[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(typeof part === "string" ? Buffer.from(part, "utf8") : Buffer.from(part));
  }
  return new Uint8Array(hash.digest());
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

export function randomSalt(): Uint8Array {
  return new Uint8Array(randomBytes(CRYPTO_SIZES.salt));
}

export function randomNonce(): Uint8Array {
  return new Uint8Array(randomBytes(CRYPTO_SIZES.nonce));
}

export function randomKey(): Uint8Array {
  return new Uint8Array(randomBytes(CRYPTO_SIZES.key));
}

/**
 * Derives a per-record data-encryption key.
 *
 * `info` binds the derived key to the record's identity, so the same master
 * key and salt cannot produce a key usable for a different entity, workspace,
 * or key generation. Callers pass the canonical AAD string as `info`.
 */
export function deriveRecordKey(masterKey: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  if (masterKey.length !== CRYPTO_SIZES.key) {
    throw new CryptoInputError(`master key must be ${CRYPTO_SIZES.key} bytes`);
  }
  if (salt.length !== CRYPTO_SIZES.salt) {
    throw new CryptoInputError(`salt must be ${CRYPTO_SIZES.salt} bytes`);
  }
  const derived = hkdfSync(
    HKDF_HASH,
    Buffer.from(masterKey),
    Buffer.from(salt),
    Buffer.from(info, "utf8"),
    CRYPTO_SIZES.key,
  );
  return new Uint8Array(derived);
}

/**
 * Stretches a recovery passphrase into a wrapping key. Separate from
 * `deriveRecordKey` because the threat model differs: this input is
 * human-chosen and the attacker is offline, so cost matters more than speed.
 */
export function deriveRecoveryKey(
  passphrase: string,
  salt: Uint8Array,
  parameters: ScryptParameters = DEFAULT_SCRYPT_PARAMETERS,
): Uint8Array {
  if (passphrase.length === 0) {
    throw new CryptoInputError("recovery passphrase must not be empty");
  }
  if (salt.length !== CRYPTO_SIZES.salt) {
    throw new CryptoInputError(`salt must be ${CRYPTO_SIZES.salt} bytes`);
  }
  const derived = scryptSync(
    Buffer.from(passphrase.normalize("NFKC"), "utf8"),
    Buffer.from(salt),
    parameters.keyLength,
    {
      N: parameters.N,
      r: parameters.r,
      p: parameters.p,
      maxmem: scryptMemoryBudget(parameters),
    },
  );
  return new Uint8Array(derived);
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

export interface SealedBytes {
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly tag: Uint8Array;
}

/**
 * Encrypts under a key that has already been derived. `additionalData` is
 * authenticated but not encrypted: a decrypt that reconstructs different AAD
 * fails the tag check, which is what prevents one record's ciphertext being
 * replayed as another's.
 */
export function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  additionalData: Uint8Array,
  nonce: Uint8Array = randomNonce(),
): SealedBytes {
  if (key.length !== CRYPTO_SIZES.key) {
    throw new CryptoInputError(`key must be ${CRYPTO_SIZES.key} bytes`);
  }
  if (nonce.length !== CRYPTO_SIZES.nonce) {
    throw new CryptoInputError(`nonce must be ${CRYPTO_SIZES.nonce} bytes`);
  }
  const cipher = createCipheriv(AES_GCM_CIPHER, Buffer.from(key), Buffer.from(nonce), {
    authTagLength: CRYPTO_SIZES.tag,
  });
  cipher.setAAD(Buffer.from(additionalData), { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return {
    nonce,
    ciphertext: new Uint8Array(ciphertext),
    tag: new Uint8Array(cipher.getAuthTag()),
  };
}

/**
 * Decrypts and verifies. Every failure path — malformed sizes, wrong key,
 * wrong AAD, tampered ciphertext or tag — raises the same
 * `EnvelopeDecryptionError`.
 */
export function open(key: Uint8Array, sealed: SealedBytes, additionalData: Uint8Array): Uint8Array {
  if (
    key.length !== CRYPTO_SIZES.key ||
    sealed.nonce.length !== CRYPTO_SIZES.nonce ||
    sealed.tag.length !== CRYPTO_SIZES.tag
  ) {
    throw new EnvelopeDecryptionError();
  }
  try {
    const decipher = createDecipheriv(AES_GCM_CIPHER, Buffer.from(key), Buffer.from(sealed.nonce), {
      authTagLength: CRYPTO_SIZES.tag,
    });
    decipher.setAAD(Buffer.from(additionalData), {
      plaintextLength: sealed.ciphertext.length,
    });
    decipher.setAuthTag(Buffer.from(sealed.tag));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext)),
      decipher.final(),
    ]);
    return new Uint8Array(plaintext);
  } catch {
    throw new EnvelopeDecryptionError();
  }
}
