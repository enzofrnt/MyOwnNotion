import {
  type BlockDocumentV3,
  documentDigestV3,
  embeddedFilesV3,
  pageLinkTargetsV3,
  type Uuid,
} from "@myownnotion/domain";
import type { LoroDoc } from "loro-crdt";
import { materialiseOperationalDocument } from "./block-tree.ts";
import { encodeOperationalFrontiers, operationalVersionDigest } from "./update-envelope.ts";

export interface ProjectionWarning {
  readonly code: "unknown-block" | "unknown-mark";
  readonly message: string;
  readonly blockId?: Uuid;
}

export interface CanonicalProjectionResult {
  readonly pageId: Uuid;
  readonly operationalFrontier: Uint8Array;
  readonly operationalDigest: string;
  readonly document: BlockDocumentV3;
  readonly canonicalDigest: string;
  readonly pageLinkTargets: readonly Uuid[];
  readonly fileUsageIds: readonly Uuid[];
  readonly warnings: readonly ProjectionWarning[];
}

export async function projectCanonicalPage(
  pageId: Uuid,
  doc: LoroDoc,
): Promise<CanonicalProjectionResult> {
  doc.commit();
  const document = materialiseOperationalDocument(doc);
  const versionVector = doc.oplogVersion().encode();
  const fileUsageIds = [...new Set(embeddedFilesV3(document).map(({ fileItemId }) => fileItemId))];
  return {
    pageId,
    operationalFrontier: encodeOperationalFrontiers(doc.frontiers()),
    operationalDigest: await operationalVersionDigest(pageId, versionVector),
    document,
    canonicalDigest: await documentDigestV3(document),
    pageLinkTargets: pageLinkTargetsV3(document),
    fileUsageIds,
    warnings: [],
  };
}
