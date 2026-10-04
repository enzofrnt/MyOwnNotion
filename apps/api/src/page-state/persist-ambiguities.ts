import {
  insertPageAmbiguity,
  readPageAmbiguityByLogicalKey,
  type Transaction,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { PageAmbiguity } from "@myownnotion/page-state";
import type { PageOperationCrypto } from "./page-operation-crypto.ts";
export async function persistNewPageAmbiguities(
  tx: Transaction,
  pageId: Uuid,
  workspaceId: Uuid,
  ambiguities: readonly PageAmbiguity[],
  crypto: PageOperationCrypto,
  now: () => Date,
): Promise<void> {
  for (const ambiguity of ambiguities) {
    const prior = await readPageAmbiguityByLogicalKey(tx, {
      pageId,
      logicalKey: ambiguity.logicalKey,
    });
    if (prior !== null) continue;
    const detailsEnvelopeId = await crypto.sealBytes(
      tx,
      "ambiguity",
      new TextEncoder().encode(JSON.stringify(ambiguity)),
    );
    await insertPageAmbiguity(tx, {
      ambiguityId: generateUuidV7(),
      pageId,
      workspaceId,
      logicalKey: ambiguity.logicalKey,
      kind: ambiguity.kind,
      detailsEnvelopeId,
      sourceUpdateIds: [...ambiguity.sourceUpdateIds],
      openedAt: now(),
    });
  }
}
