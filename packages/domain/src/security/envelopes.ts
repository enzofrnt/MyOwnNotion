/**
 * `mn.enc.v1` envelope assembly and validation (T015, feature 002).
 *
 * An envelope is the durable form of one protected record. It carries enough
 * public metadata to find the right key generation and rebuild the exact
 * additional-authenticated-data string, and nothing else — no plaintext, no
 * key material, no owner-identifying content.
 *
 * The AAD is the security-critical part. It binds a ciphertext to one
 * installation, workspace, entity type, entity ID, key generation, record
 * version, and (for files) chunk index. Moving a ciphertext to another record
 * therefore changes the AAD, the tag check fails, and the read fails closed
 * instead of returning another record's content.
 */
import {
  bytesEqual,
  CRYPTO_SIZES,
  CryptoInputError,
  deriveRecordKey,
  EnvelopeDecryptionError,
  fromBase64Url,
  open,
  randomSalt,
  seal,
  sha256,
  toBase64Url,
} from "./crypto.ts";
import { canonicalAadBytes, canonicalAadFor, type EnvelopeBinding } from "./envelope-binding.ts";
import { ENVELOPE_ALGORITHM, ENVELOPE_FORMAT, type EncryptedEnvelope } from "./types.ts";

export type { EnvelopeBinding };

/**
 * Canonical AAD string.
 *
 * The construction itself lives in `envelope-binding.ts`, which carries no
 * `node:crypto` dependency, because the browser client seals its own local
 * records against the same binding. Two implementations of this string would
 * be two chances to disagree by a separator.
 */
export function canonicalAad(binding: EnvelopeBinding): string {
  return canonicalAadFor(ENVELOPE_FORMAT, ENVELOPE_ALGORITHM, binding);
}

export function aadBytes(binding: EnvelopeBinding): Uint8Array {
  return canonicalAadBytes(canonicalAad(binding));
}

export function aadDigest(binding: EnvelopeBinding): Uint8Array {
  return sha256(canonicalAad(binding));
}

/**
 * Encrypts `plaintext` into a complete envelope.
 *
 * `masterKey` is the workspace data key for `binding.keyGeneration`; callers
 * obtain it from the key hierarchy, never from an envelope.
 */
export function sealEnvelope(
  masterKey: Uint8Array,
  binding: EnvelopeBinding,
  plaintext: Uint8Array,
): EncryptedEnvelope {
  // The contract's `ciphertext` field is unpadded base64url with `minLength: 1`,
  // so an empty payload has no valid representation. Refusing here is the only
  // safe option: encrypting it would produce an envelope that passes no
  // validator and cannot be read back, which surfaces much later as data loss.
  if (plaintext.length === 0) {
    throw new CryptoInputError("plaintext must not be empty; mn.enc.v1 has no empty ciphertext");
  }
  const aad = canonicalAad(binding);
  const salt = randomSalt();
  const recordKey = deriveRecordKey(masterKey, salt, aad);
  const sealed = seal(recordKey, plaintext, new Uint8Array(Buffer.from(aad, "utf8")));

  const envelope: EncryptedEnvelope = {
    format: ENVELOPE_FORMAT,
    entityType: binding.entityType,
    entityId: binding.entityId,
    workspaceId: binding.workspaceId,
    keyGeneration: binding.keyGeneration,
    recordVersion: binding.recordVersion,
    algorithm: ENVELOPE_ALGORITHM,
    salt: toBase64Url(salt),
    nonce: toBase64Url(sealed.nonce),
    ciphertext: toBase64Url(sealed.ciphertext),
    tag: toBase64Url(sealed.tag),
    aadDigest: toBase64Url(sha256(aad)),
  };
  return binding.chunkIndex === undefined
    ? envelope
    : { ...envelope, chunkIndex: binding.chunkIndex };
}

/**
 * Rebuilds the binding an envelope claims. Note this is the envelope's own
 * account of itself: `openEnvelope` still requires the caller's expected
 * installation ID, which no envelope carries, so a stolen envelope from
 * another installation cannot self-certify.
 */
export function bindingFromEnvelope(
  envelope: EncryptedEnvelope,
  installationId: string,
): EnvelopeBinding {
  const binding: EnvelopeBinding = {
    installationId,
    workspaceId: envelope.workspaceId,
    entityType: envelope.entityType,
    entityId: envelope.entityId,
    keyGeneration: envelope.keyGeneration,
    recordVersion: envelope.recordVersion,
  };
  return envelope.chunkIndex === undefined
    ? binding
    : { ...binding, chunkIndex: envelope.chunkIndex };
}

/**
 * Checks the envelope's structure and its stored AAD digest against the
 * binding the caller expects, before any key is used.
 *
 * Returns `false` rather than throwing, so callers can decide between "fail
 * closed and report degraded" and "this record belongs to another generation".
 */
export function envelopeMatchesBinding(
  envelope: EncryptedEnvelope,
  expected: EnvelopeBinding,
): boolean {
  if (envelope.format !== ENVELOPE_FORMAT || envelope.algorithm !== ENVELOPE_ALGORITHM) {
    return false;
  }
  if (
    envelope.workspaceId !== expected.workspaceId ||
    envelope.entityType !== expected.entityType ||
    envelope.entityId !== expected.entityId ||
    envelope.keyGeneration !== expected.keyGeneration ||
    envelope.recordVersion !== expected.recordVersion ||
    envelope.chunkIndex !== expected.chunkIndex
  ) {
    return false;
  }
  try {
    return bytesEqual(fromBase64Url(envelope.aadDigest), aadDigest(expected));
  } catch {
    return false;
  }
}

/**
 * Decrypts an envelope.
 *
 * `expected` is the binding the *caller* believes it is reading, reconstructed
 * from its own context rather than from the envelope. Any mismatch — different
 * entity, generation, workspace, installation, or a tampered digest — fails
 * with the same opaque `EnvelopeDecryptionError` as a bad tag.
 */
export function openEnvelope(
  masterKey: Uint8Array,
  envelope: EncryptedEnvelope,
  expected: EnvelopeBinding,
): Uint8Array {
  // Checked here rather than left to `deriveRecordKey`, which reports the
  // specific problem. On a read path every rejection must be indistinguishable,
  // otherwise the error itself tells an attacker which check failed.
  if (masterKey.length !== CRYPTO_SIZES.key) {
    throw new EnvelopeDecryptionError();
  }
  if (!envelopeMatchesBinding(envelope, expected)) {
    throw new EnvelopeDecryptionError();
  }

  let salt: Uint8Array;
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  let tag: Uint8Array;
  try {
    salt = fromBase64Url(envelope.salt);
    nonce = fromBase64Url(envelope.nonce);
    ciphertext = fromBase64Url(envelope.ciphertext);
    tag = fromBase64Url(envelope.tag);
  } catch {
    throw new EnvelopeDecryptionError();
  }
  if (
    salt.length !== CRYPTO_SIZES.salt ||
    nonce.length !== CRYPTO_SIZES.nonce ||
    tag.length !== CRYPTO_SIZES.tag
  ) {
    throw new EnvelopeDecryptionError();
  }

  const aad = canonicalAad(expected);
  const recordKey = deriveRecordKey(masterKey, salt, aad);
  return open(recordKey, { nonce, ciphertext, tag }, new Uint8Array(Buffer.from(aad, "utf8")));
}
