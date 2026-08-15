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

import { generateUuidV7 } from "../ids/uuid.ts";
import type { Block, JsonObject } from "./block.ts";
import type { BlockDocument } from "./document.ts";
import { type ValidationResult, validateDocument } from "./validate.ts";

/** The block type used to carry a preserved v1 body. Deliberately unknown. */
export const LEGACY_BODY_BLOCK_TYPE = "legacyBody";

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
  const id = generateUuidV7();
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
