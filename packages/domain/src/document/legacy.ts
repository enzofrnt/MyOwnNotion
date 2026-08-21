/**
 * Reading a version 1 body without destroying it (T010).
 *
 * Feature 001 defined the page-document body as a free-form object, so
 * documents exist with no agreed shape. This module decides what happens to
 * them, and the answer is: as little as possible, for as long as possible.
 *
 * **The server takes no part in this.** Since feature 002 the body is a sealed
 * envelope and the server holds no key, so a server-side migration is not
 * awkward here — it is impossible by construction. That is a property of the
 * design worth preserving rather than an obstacle to route around, and it means
 * the client is the only place the transition can happen.
 *
 * **A read is not a write.** A client that rewrites an owner's stored document
 * because it would prefer a different version is doing something the owner did
 * not ask for and cannot audit. So a legacy body is read losslessly, shown as
 * read-only content, and upgraded only when the owner actually edits the page.
 *
 * **The upgrade adds structure around the old body, it does not replace it.**
 * The original object is carried inside an unknown block, so even after the
 * upgrade the bytes are still there.
 */

import { asUuid, type Uuid } from "../ids/uuid.ts";
import type { Block, JsonObject } from "./block.ts";
import type { BlockDocument } from "./document.ts";
import {
  type ValidationResult,
  type ValidationResultV3,
  validateDocument,
  validateDocumentV3,
} from "./validate.ts";

/** The block type used to carry a preserved v1 body. Deliberately unknown. */
export const LEGACY_BODY_BLOCK_TYPE = "legacyBody";

/**
 * Stable JSON for identity derivation: key order as stored, nothing pretty.
 * Two processes reading the same sealed envelope see the same bytes here,
 * which is the whole point of the derived id below.
 */
function stableJson(value: JsonObject): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    typeof nested === "object" && nested !== null && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : nested,
  );
}

/**
 * Derives the same UUID from the same legacy body, on every device.
 *
 * A random id would make two independent migrations of one stored body
 * produce two different documents — different digests, so page activation's
 * compare-and-swap could never agree, and two devices activating offline
 * could never converge. The hash need not be cryptographic: the content is
 * preserved opaquely regardless, and the id only has to be *stable* and
 * collision-free in practice.
 */
function deriveLegacyBodyId(body: JsonObject): Uuid {
  const source = stableJson(body);
  let high = 0xcbf29ce484222325n;
  let low = 0x84222325cbf29ce4n;
  for (let index = 0; index < source.length; index += 1) {
    const byte = BigInt(source.charCodeAt(index) & 0xff);
    high ^= byte;
    low ^= byte;
    high = (high * 0x100000001b3n) & 0xffffffffffffffffn;
    low = (low * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number((high >> BigInt(8 * (7 - index))) & 0xffn);
    bytes[8 + index] = Number((low >> BigInt(8 * (7 - index))) & 0xffn);
  }
  // Version 7, RFC variant: the shape every other identity in the canonical
  // model uses, without claiming a timestamp this id does not have.
  const versionByte = bytes[6] ?? 0;
  const variantByte = bytes[8] ?? 0;
  bytes[6] = (versionByte & 0x0f) | 0x70;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return asUuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

export type DocumentBodyRead =
  | { readonly kind: "blocks"; readonly result: ValidationResult }
  | { readonly kind: "legacy"; readonly body: JsonObject };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decides how a stored body should be read.
 *
 * Dispatch is on the body's shape rather than on `formatVersion` alone. A
 * version number can be wrong — restored from a backup, written by a client
 * mid-upgrade — and the body either has blocks or it does not. Where the two
 * disagree, the content wins, for the same reason the sealed envelope wins over
 * a migration flag in feature 002.
 */
export function readDocumentBody(body: unknown): DocumentBodyRead {
  if (!isJsonObject(body)) {
    return { kind: "legacy", body: {} };
  }
  if (Array.isArray(body["blocks"])) {
    return { kind: "blocks", result: validateDocument(body) };
  }
  if (Object.keys(body).length === 0) {
    // An empty object is an empty document, not legacy content.
    //
    // This is the shape every newly created page starts with, and treating it
    // as legacy told an owner their brand-new page "was written before the
    // block editor existed" and refused to let them type in it. The rule that
    // makes it safe is that there is nothing here to preserve: `{}` carries no
    // content, so reading it as an empty document loses exactly nothing, which
    // is not true of any other legacy body.
    return { kind: "blocks", result: validateDocument({ blocks: [] }) };
  }
  return { kind: "legacy", body };
}

/**
 * Produces the version 2 document that replaces a legacy body — on the owner's
 * first edit, and not before.
 *
 * The original object is placed inside the wrapper by reference and is never
 * copied or re-keyed, so it serialises back byte for byte exactly as an unknown
 * block does. That is not a coincidence: it is an unknown block, which is why
 * no separate preservation path had to be written for it.
 */
export function upgradeLegacyBody(body: JsonObject): BlockDocument {
  const id = deriveLegacyBodyId(body);
  const wrapper: JsonObject = {
    type: LEGACY_BODY_BLOCK_TYPE,
    id,
    body,
  };

  const block: Block = {
    type: "unknown",
    id,
    declaredType: LEGACY_BODY_BLOCK_TYPE,
    raw: wrapper,
    syntheticId: false,
  };

  return { blocks: [block] };
}

/** Whether a document is one produced by `upgradeLegacyBody` and nothing else. */
export function isUpgradedLegacyDocument(document: BlockDocument): boolean {
  const only = document.blocks[0];
  return (
    document.blocks.length === 1 &&
    only !== undefined &&
    only.type === "unknown" &&
    only.declaredType === LEGACY_BODY_BLOCK_TYPE
  );
}

export type VersionedDocumentEnvelopeRead =
  | { readonly kind: "v2"; readonly result: ValidationResult }
  | { readonly kind: "v3"; readonly result: ValidationResultV3 }
  | { readonly kind: "unsupported"; readonly envelope: JsonObject }
  | { readonly kind: "invalid"; readonly message: string };

/** Reads an owned envelope by its declared version without shape guessing. */
export function readVersionedDocumentEnvelope(value: unknown): VersionedDocumentEnvelopeRead {
  if (!isJsonObject(value)) {
    return { kind: "invalid", message: "the document envelope must be an object" };
  }
  if (value["format"] !== "myownnotion.document+json") {
    return { kind: "invalid", message: "the document format is not owned by MyOwnNotion" };
  }
  if (value["formatVersion"] === 2) {
    return { kind: "v2", result: validateDocument(value["body"]) };
  }
  if (value["formatVersion"] === 3) {
    return { kind: "v3", result: validateDocumentV3(value["body"]) };
  }
  return { kind: "unsupported", envelope: value };
}
