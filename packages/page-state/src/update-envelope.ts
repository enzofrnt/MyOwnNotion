import { decodeFrontiers, encodeFrontiers, type Frontiers, VersionVector } from "loro-crdt";

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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", arrayBufferBytes(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
