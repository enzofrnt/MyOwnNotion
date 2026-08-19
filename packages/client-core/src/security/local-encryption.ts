/**
 * Device-bound local envelopes (T058, US4, FR-012, FR-014, FR-024).
 *
 * The browser projection is a full copy of the workspace, so it is sealed the
 * way the server seals its own records: AES-256-GCM, a fresh nonce per seal,
 * and an AAD that binds the ciphertext to its installation, workspace, entity
 * type, entity id, key generation, and record version.
 *
 * The AAD construction is imported from `@myownnotion/domain` rather than
 * written again here. Two implementations of the same canonical string are two
 * chances to disagree by a separator, and the disagreement would surface as
 * unreadable records long after the change that caused it.
 *
 * The format and algorithm labels differ from the server's on purpose. A local
 * envelope is sealed under a device key and a server envelope under the
 * workspace data key; distinct labels enter the AAD, so one can never open as
 * the other even if both reached the same store.
 */

import { canonicalAadBytes, canonicalAadFor, type EnvelopeBinding } from "@myownnotion/domain";
import { LocalKeyLockedError, LocalKeyLostError, type LocalKeyManager } from "./local-key-state.ts";

export const LOCAL_ENVELOPE_FORMAT = "mn.local.v1" as const;
export const LOCAL_ENVELOPE_ALGORITHM = "A256GCM" as const;

/** 96 bits, the nonce size AES-GCM is specified for. */
const NONCE_BYTES = 12;

/**
 * The local payload-bearing fields, one entity type each.
 *
 * Mirrors the server's boundary. Identifiers, hierarchy, ordering, and
 * lifecycle stay readable — encrypting them would mean unlocking the device
 * key to answer "what is in this folder", which puts the key in play for every
 * navigation. Everything a person wrote is sealed.
 */
export const LOCAL_ENTITY_TYPES = {
  itemName: "local.item.name",
  pageBody: "local.page.body",
  fileMetadata: "local.file.metadata",
  relationshipMetadata: "local.relationship.metadata",
  outboxPayload: "local.outbox.payload",
  conflictPayload: "local.conflict.payload",
  databaseDefinition: "local.database.definition",
  databaseEntryValues: "local.database.entry-values",
} as const;

export interface LocalEnvelope {
  readonly format: typeof LOCAL_ENVELOPE_FORMAT;
  readonly alg: typeof LOCAL_ENVELOPE_ALGORITHM;
  /** Which device key sealed this. Opaque; never key material. */
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

/** An envelope failed its tag check: wrong binding, or altered bytes. */
export class LocalIntegrityError extends Error {
  constructor() {
    super("local record failed its integrity check");
    this.name = "LocalIntegrityError";
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// The `<ArrayBuffer>` annotations are not decoration: WebCrypto's `BufferSource`
// excludes views backed by a `SharedArrayBuffer`, so a plain `Uint8Array` does
// not satisfy it. Allocating the buffer explicitly keeps the narrower type.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function aadFor(binding: EnvelopeBinding): Uint8Array<ArrayBuffer> {
  const aad = canonicalAadBytes(
    canonicalAadFor(LOCAL_ENVELOPE_FORMAT, LOCAL_ENVELOPE_ALGORITHM, binding),
  );
  const copy = new Uint8Array(new ArrayBuffer(aad.byteLength));
  copy.set(aad);
  return copy;
}

export class LocalCipher {
  readonly #keys: LocalKeyManager;

  constructor(keys: LocalKeyManager) {
    this.#keys = keys;
  }

  async seal(binding: EnvelopeBinding, plaintext: unknown): Promise<LocalEnvelope> {
    const { key, keyId } = this.#keys.requireKey();
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aadFor(binding) },
      key,
      new TextEncoder().encode(JSON.stringify(plaintext)),
    );
    return {
      format: LOCAL_ENVELOPE_FORMAT,
      alg: LOCAL_ENVELOPE_ALGORITHM,
      keyId,
      nonce: toBase64(nonce),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
  }

  async open(binding: EnvelopeBinding, envelope: LocalEnvelope): Promise<unknown> {
    const { key, keyId } = this.#keys.requireKey();
    // Checked before the tag, because the two failures mean different things
    // to the owner: a record sealed under a key this device no longer holds is
    // lost, and telling them it is corrupt would send them hunting a bug.
    if (envelope.keyId !== keyId) {
      throw new LocalKeyLostError();
    }
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64(envelope.nonce),
          additionalData: aadFor(binding),
        },
        key,
        fromBase64(envelope.ciphertext),
      );
    } catch {
      // Deliberately opaque: which check failed is a decryption oracle, and
      // the caller can do nothing different with the detail anyway.
      throw new LocalIntegrityError();
    }
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
}

export { LocalKeyLockedError, LocalKeyLostError };
