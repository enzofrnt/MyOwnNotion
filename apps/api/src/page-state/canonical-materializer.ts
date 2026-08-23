/** Deterministic operational-state projection into the canonical read model. */

import {
  rebuildEmbedUsagesV3,
  reconcileOperationalPageLinks,
  schema,
  type Transaction,
} from "@myownnotion/database";
import { serialiseDocumentV3, type Uuid, validateDocumentV3 } from "@myownnotion/domain";
import type { CanonicalProjectionResult } from "@myownnotion/page-state";
import { eq } from "drizzle-orm";
import type { ProtectedContent } from "../security/protected-content.ts";
import { PageOperationServiceError } from "./page-operation-errors.ts";

export interface CanonicalMaterializationResult {
  readonly fileRequirements: ReadonlyArray<{
    readonly fileId: Uuid;
    readonly state: "present" | "upload-required";
  }>;
  readonly unavailablePageLinkTargetIds: readonly Uuid[];
}

export class CanonicalMaterializer {
  readonly #protectedContent: ProtectedContent;

  constructor(protectedContent: ProtectedContent) {
    this.#protectedContent = protectedContent;
  }

  async materialize(
    tx: Transaction,
    input: {
      readonly workspaceId: Uuid;
      readonly pageId: Uuid;
      readonly revisionId: Uuid;
      readonly projection: CanonicalProjectionResult;
    },
  ): Promise<CanonicalMaterializationResult> {
    const body = serialiseDocumentV3(input.projection.document);
    const validation = validateDocumentV3(body);
    if (!validation.ok) {
      throw new PageOperationServiceError(
        "page-operations.projection-invalid",
        "The converged page cannot be represented by the canonical document contract.",
        409,
      );
    }

    await tx
      .insert(schema.pageDocuments)
      .values({
        pageId: input.pageId,
        format: "myownnotion.document+json",
        formatVersion: 3,
        body,
      })
      .onConflictDoUpdate({
        target: schema.pageDocuments.pageId,
        set: { format: "myownnotion.document+json", formatVersion: 3, body },
      });
    await this.#protectedContent.writePageBody(tx, {
      pageId: input.pageId,
      recordVersion: 1,
      body,
    });
    await rebuildEmbedUsagesV3(tx, input.pageId, validation.document);
    const links = await reconcileOperationalPageLinks(tx, {
      workspaceId: input.workspaceId,
      sourceItemId: input.pageId,
      revisionId: input.revisionId,
      targetItemIds: input.projection.pageLinkTargets,
    });

    const fileRequirements: Array<{
      readonly fileId: Uuid;
      readonly state: "present" | "upload-required";
    }> = [];
    for (const fileId of input.projection.fileUsageIds) {
      const rows = await tx
        .select({ itemId: schema.logicalFiles.itemId })
        .from(schema.logicalFiles)
        .where(eq(schema.logicalFiles.itemId, fileId))
        .limit(1);
      fileRequirements.push({
        fileId,
        state: rows.length === 0 ? "upload-required" : "present",
      });
    }
    return {
      fileRequirements,
      unavailablePageLinkTargetIds: links.unavailableTargetIds,
    };
  }
}
