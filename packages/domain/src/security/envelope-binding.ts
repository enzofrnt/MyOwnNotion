/**
 * Envelope binding and canonical AAD (feature 002).
 *
 * Deliberately free of `node:crypto`, so it can live in the root barrel and be
 * imported by the browser client as well as the server. It holds no key
 * material and performs no encryption — it only says *what a ciphertext is
 * bound to*, as one canonical string.
 *
 * That string is the security-critical part, and it is shared rather than
 * reimplemented on purpose. The server seals with it and the client seals with
 * it; two separate implementations that drift by one separator would produce
 * ciphertexts that authenticate on one side and fail on the other, and the
 * failure would appear as data loss long after the change that caused it.
 */

/** Raised when a binding field cannot produce a canonical AAD. */
export class EnvelopeBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeBindingError";
  }
}

/** The identity an envelope is bound to. Every field enters the AAD. */
export interface EnvelopeBinding {
  readonly installationId: string;
  readonly workspaceId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
  /** Present only for file chunks. */
  readonly chunkIndex?: number;
}

const ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;

/**
 * Canonical AAD string.
 *
 * Field order and separators are part of the contract: two bindings must never
 * produce the same string, and the same binding must produce a byte-identical
 * string on every host and every release. `|` cannot appear in a UUID, in a
 * validated entity type, or in a decimal integer, so no field can be shifted
 * into another by crafted input.
 */
export function canonicalAadFor(
  format: string,
  algorithm: string,
  binding: EnvelopeBinding,
): string {
  if (!ENTITY_TYPE_PATTERN.test(binding.entityType)) {
    throw new EnvelopeBindingError(`invalid entityType: ${binding.entityType}`);
  }
  if (!Number.isInteger(binding.keyGeneration) || binding.keyGeneration < 1) {
    throw new EnvelopeBindingError("keyGeneration must be a positive integer");
  }
  if (!Number.isInteger(binding.recordVersion) || binding.recordVersion < 1) {
    throw new EnvelopeBindingError("recordVersion must be a positive integer");
  }
  if (
    binding.chunkIndex !== undefined &&
    (!Number.isInteger(binding.chunkIndex) || binding.chunkIndex < 0)
  ) {
    throw new EnvelopeBindingError("chunkIndex must be a non-negative integer");
  }

  // An absent chunk index is the empty field, so a whole-record envelope and
  // chunk 0 of the same entity never share an AAD.
  return [
    format,
    algorithm,
    binding.installationId,
    binding.workspaceId,
    binding.entityType,
    binding.entityId,
    String(binding.keyGeneration),
    String(binding.recordVersion),
    binding.chunkIndex === undefined ? "" : String(binding.chunkIndex),
  ].join("|");
}

/**
 * UTF-8 bytes of a canonical AAD string.
 *
 * `TextEncoder` rather than `Buffer`: this module has to work in the browser,
 * and both produce the same bytes for the same string.
 */
export function canonicalAadBytes(aad: string): Uint8Array {
  return new TextEncoder().encode(aad);
}
