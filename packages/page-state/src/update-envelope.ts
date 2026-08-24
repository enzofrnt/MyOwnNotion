import type { Uuid } from "@myownnotion/domain";
import {
  decodeFrontiers,
  decodeImportBlobMeta,
  encodeFrontiers,
  type Frontiers,
  VersionVector,
} from "loro-crdt";

export const OPERATIONAL_FORMAT = "myownnotion.page-operations+loro" as const;
export const OPERATIONAL_FORMAT_VERSION = 1 as const;

export type VersionVectorOrder = "before" | "equal" | "after" | "concurrent";

function arrayBufferBytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(source.byteLength));
  copy.set(source);
  return copy;
}

export function versionVectorFromBytes(bytes: Uint8Array): VersionVector {
  return VersionVector.decode(bytes);
}

export function compareVersionVectorBytes(
  leftBytes: Uint8Array,
  rightBytes: Uint8Array,
): VersionVectorOrder {
  const comparison = versionVectorFromBytes(leftBytes).compare(versionVectorFromBytes(rightBytes));
  if (comparison === undefined) return "concurrent";
  if (comparison < 0) return "before";
  if (comparison > 0) return "after";
  return "equal";
}

export function versionVectorBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return compareVersionVectorBytes(left, right) === "equal";
}

export function versionVectorDominates(candidate: Uint8Array, other: Uint8Array): boolean {
  const order = compareVersionVectorBytes(candidate, other);
  return order === "equal" || order === "after";
}

export function encodeOperationalFrontiers(frontiers: Frontiers): Uint8Array {
  return encodeFrontiers(frontiers);
}

export function decodeOperationalFrontiers(bytes: Uint8Array): Frontiers {
  return decodeFrontiers(bytes);
}

/** Encoded frontier order is not canonical; compare the causal IDs as a set. */
export function operationalFrontiersEqual(left: Uint8Array, right: Uint8Array): boolean {
  const canonical = (bytes: Uint8Array) =>
    decodeOperationalFrontiers(bytes)
      .map(({ peer, counter }) => `${String(peer)}:${counter}`)
      .sort();
  const leftIds = canonical(left);
  const rightIds = canonical(right);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((frontier, index) => frontier === rightIds[index])
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", arrayBufferBytes(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable identity for one page's causal operation set, independent of snapshot encoding order. */
export async function operationalVersionDigest(
  pageId: Uuid,
  versionVectorBytes: Uint8Array,
): Promise<string> {
  const versionVector = [...versionVectorFromBytes(versionVectorBytes).toJSON()]
    .map(([peer, counter]) => [String(peer), counter] as const)
    .sort(([left], [right]) => (left < right ? -1 : 1));
  return await sha256Hex(
    new TextEncoder().encode(
      JSON.stringify([OPERATIONAL_FORMAT, OPERATIONAL_FORMAT_VERSION, pageId, versionVector]),
    ),
  );
}

export interface IncrementalPageUpdate {
  readonly operationalFormat: typeof OPERATIONAL_FORMAT;
  readonly operationalVersion: typeof OPERATIONAL_FORMAT_VERSION;
  readonly baseVersionVector: Uint8Array;
  readonly resultVersionVector: Uint8Array;
  readonly resultFrontiers: Uint8Array;
  readonly updateBytes: Uint8Array;
  readonly updateDigest: string;
}

export async function describeIncrementalUpdate(input: {
  readonly baseVersionVector: Uint8Array;
  readonly resultVersionVector: Uint8Array;
  readonly resultFrontiers: Uint8Array;
  readonly updateBytes: Uint8Array;
}): Promise<IncrementalPageUpdate> {
  return {
    operationalFormat: OPERATIONAL_FORMAT,
    operationalVersion: OPERATIONAL_FORMAT_VERSION,
    ...input,
    updateDigest: await sha256Hex(input.updateBytes),
  };
}

export async function verifyIncrementalUpdate(update: IncrementalPageUpdate): Promise<void> {
  if (
    update.operationalFormat !== OPERATIONAL_FORMAT ||
    update.operationalVersion !== OPERATIONAL_FORMAT_VERSION
  ) {
    throw new TypeError("unsupported operational update format");
  }
  if ((await sha256Hex(update.updateBytes)) !== update.updateDigest) {
    throw new TypeError("operational update digest mismatch");
  }
  if (compareVersionVectorBytes(update.baseVersionVector, update.resultVersionVector) === "after") {
    throw new TypeError("an operational update cannot retreat its version vector");
  }
}

/**
 * Verifies that the untrusted transport base contains the dependencies encoded
 * by the Loro update itself. The blob metadata is checksum-checked first; the
 * client cannot make an update look causally ready by merely changing the JSON
 * `baseVersionVector` beside it.
 */
export function verifyIncrementalUpdateBase(
  updateBytes: Uint8Array,
  declaredBaseBytes: Uint8Array,
): void {
  let declaredBase: VersionVector;
  let metadata: ReturnType<typeof decodeImportBlobMeta>;
  try {
    declaredBase = VersionVector.decode(declaredBaseBytes);
    metadata = decodeImportBlobMeta(updateBytes, true);
  } catch {
    throw new TypeError("operational update has an invalid causal base or encoding");
  }
  if (metadata.mode !== "update" && metadata.mode !== "outdated-update") {
    throw new TypeError("operational update payload must be an incremental update");
  }
  for (const [peer, counter] of metadata.partialStartVersionVector.toJSON()) {
    if ((declaredBase.get(peer) ?? 0) !== counter) {
      throw new TypeError("operational update does not match its declared causal base");
    }
  }
  for (const frontier of metadata.startFrontiers) {
    if ((declaredBase.get(frontier.peer) ?? 0) <= frontier.counter) {
      throw new TypeError("operational update dependencies are absent from its causal base");
    }
  }
}

/**
 * Reconstructs the author's causal frontier after one incremental blob.
 *
 * A server may import that blob into a document which already contains
 * concurrent remote work. Its resulting document frontier therefore cannot
 * describe the branch the author actually saw. The blob metadata carries the
 * exact per-peer operation range, so merging its partial end into the declared
 * base recovers that original branch frontier without trusting transport data.
 */
export function incrementalUpdateResultVersionVector(
  updateBytes: Uint8Array,
  declaredBaseBytes: Uint8Array,
): Uint8Array {
  let base: VersionVector;
  let metadata: ReturnType<typeof decodeImportBlobMeta>;
  try {
    base = VersionVector.decode(declaredBaseBytes);
    metadata = decodeImportBlobMeta(updateBytes, true);
  } catch {
    throw new TypeError("operational update has an invalid causal base or encoding");
  }
  if (metadata.mode !== "update" && metadata.mode !== "outdated-update") {
    throw new TypeError("operational update payload must be an incremental update");
  }
  const result = new Map(base.toJSON());
  for (const [peer, counter] of metadata.partialEndVersionVector.toJSON()) {
    result.set(peer, Math.max(result.get(peer) ?? 0, counter));
  }
  return arrayBufferBytes(VersionVector.parseJSON(result).encode());
}
