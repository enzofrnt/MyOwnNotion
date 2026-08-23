import type { Uuid } from "@myownnotion/domain";
import { LoroDoc } from "loro-crdt";
import {
  decodeOperationalFrontiers,
  encodeOperationalFrontiers,
  OPERATIONAL_FORMAT,
  OPERATIONAL_FORMAT_VERSION,
  sha256Hex,
  versionVectorBytesEqual,
} from "./update-envelope.ts";

export interface OperationalPageCheckpoint {
  readonly operationalFormat: typeof OPERATIONAL_FORMAT;
  readonly operationalVersion: typeof OPERATIONAL_FORMAT_VERSION;
  readonly pageId: Uuid;
  readonly bytes: Uint8Array;
  readonly digest: string;
  readonly versionVector: Uint8Array;
  readonly frontiers: Uint8Array;
}

export async function createOperationalCheckpoint(
  pageId: Uuid,
  doc: LoroDoc,
): Promise<OperationalPageCheckpoint> {
  doc.commit();
  const bytes = doc.export({ mode: "snapshot" });
  return {
    operationalFormat: OPERATIONAL_FORMAT,
    operationalVersion: OPERATIONAL_FORMAT_VERSION,
    pageId,
    bytes,
    digest: await sha256Hex(bytes),
    versionVector: doc.oplogVersion().encode(),
    frontiers: encodeOperationalFrontiers(doc.frontiers()),
  };
}

/**
 * Exports the current state while garbage-collecting history before its causal
 * frontier.
 *
 * A shallow checkpoint is safe to promote only after every still-authorized
 * device has durably confirmed a version vector that dominates this frontier.
 * That product-level decision intentionally lives in the server checkpoint
 * service; this pure helper only creates and self-describes the candidate.
 */
export async function createCompactedOperationalCheckpoint(
  pageId: Uuid,
  doc: LoroDoc,
): Promise<OperationalPageCheckpoint> {
  doc.commit();
  const bytes = doc.export({ mode: "shallow-snapshot", frontiers: doc.oplogFrontiers() });
  return {
    operationalFormat: OPERATIONAL_FORMAT,
    operationalVersion: OPERATIONAL_FORMAT_VERSION,
    pageId,
    bytes,
    digest: await sha256Hex(bytes),
    versionVector: doc.oplogVersion().encode(),
    frontiers: encodeOperationalFrontiers(doc.frontiers()),
  };
}

export async function openOperationalCheckpoint(
  expectedPageId: Uuid,
  checkpoint: OperationalPageCheckpoint,
): Promise<LoroDoc> {
  if (
    checkpoint.operationalFormat !== OPERATIONAL_FORMAT ||
    checkpoint.operationalVersion !== OPERATIONAL_FORMAT_VERSION ||
    checkpoint.pageId !== expectedPageId
  ) {
    throw new TypeError("operational checkpoint metadata mismatch");
  }
  if ((await sha256Hex(checkpoint.bytes)) !== checkpoint.digest) {
    throw new TypeError("operational checkpoint digest mismatch");
  }
  const doc = LoroDoc.fromSnapshot(checkpoint.bytes);
  if (!versionVectorBytesEqual(doc.oplogVersion().encode(), checkpoint.versionVector)) {
    throw new TypeError("operational checkpoint version vector mismatch");
  }
  const checkpointFrontiers = decodeOperationalFrontiers(checkpoint.frontiers);
  if (doc.cmpFrontiers(doc.frontiers(), checkpointFrontiers) !== 0) {
    throw new TypeError("operational checkpoint frontier mismatch");
  }
  return doc;
}
