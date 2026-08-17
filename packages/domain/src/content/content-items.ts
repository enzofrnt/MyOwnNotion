/**
 * Page-document envelope and content-role validation (T054, US2).
 *
 * Only pages carry editorial content; folders organize; files are terminal.
 * Replacing a page document requires the caller's causal base to match the
 * accepted head so silent overwrites are impossible.
 */

import { pageLinkTargets, readDocumentBody } from "../document/index.ts";
import type { Uuid } from "../ids/uuid.ts";
import { validatePageDocument } from "./hierarchy.ts";
import { type CanonicalItem, type DomainResult, err, ok, type PageDocument } from "./types.ts";

export interface ReplacePageDocumentCommand {
  readonly itemId: Uuid;
  readonly baseRevisionId: Uuid;
  readonly document: PageDocument;
  readonly pageLinkTargetIds?: readonly Uuid[];
}

export interface ReplacePageDocumentPlan {
  readonly item: CanonicalItem;
  readonly document: PageDocument;
  readonly parentRevisionId: Uuid;
  readonly pageLinkTargetIds: readonly Uuid[];
}

/** Proves that the derived relationship index is exactly the document marks. */
export function validatePageLinkTargetSet(
  document: PageDocument,
  targetItemIds: readonly Uuid[],
): DomainResult<Uuid[]> {
  const supplied = [...new Set(targetItemIds)];
  const read = readDocumentBody(document.body);
  if (read.kind === "blocks" && !read.result.ok) {
    return err("validation.invalid-payload", "Page-link targets require a valid block document");
  }
  const extracted =
    read.kind === "blocks" && read.result.ok ? pageLinkTargets(read.result.document) : [];
  const suppliedSet = new Set(supplied);
  if (
    suppliedSet.size !== extracted.length ||
    extracted.some((targetItemId) => !suppliedSet.has(targetItemId))
  ) {
    return err(
      "validation.invalid-payload",
      "Page-link targets must match the links stored in the document",
    );
  }
  return ok(extracted);
}

export function validateReplacePageDocument(
  item: CanonicalItem | null,
  command: ReplacePageDocumentCommand,
): DomainResult<ReplacePageDocumentPlan> {
  if (item === null) {
    return err("item.not-found", "Item does not exist");
  }
  if (item.kind !== "page") {
    // Folders and files can never carry editorial page content.
    return err("item.wrong-kind", "Only pages carry a page document");
  }
  if (item.lifecycle !== "active") {
    return err("item.not-active", "Only active pages can be edited");
  }
  const document = validatePageDocument(command.document);
  if (!document.ok) {
    return document as DomainResult<ReplacePageDocumentPlan>;
  }
  if (command.baseRevisionId !== item.currentRevisionId) {
    return err("revision.stale-base", "Page changed since this edit was prepared", {
      competingRevisionIds: [item.currentRevisionId],
    });
  }
  const pageLinks = validatePageLinkTargetSet(document.value, command.pageLinkTargetIds ?? []);
  if (!pageLinks.ok) {
    return pageLinks as DomainResult<ReplacePageDocumentPlan>;
  }
  return ok({
    item,
    document: document.value,
    pageLinkTargetIds: pageLinks.value,
    parentRevisionId: item.currentRevisionId,
  });
}

/** Content-role check shared by API serialization and export. */
export function allowsPageDocument(kind: CanonicalItem["kind"]): boolean {
  return kind === "page";
}
