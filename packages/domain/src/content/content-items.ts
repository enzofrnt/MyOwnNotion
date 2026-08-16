/**
 * Page-document envelope and content-role validation (T054, US2).
 *
 * Only pages carry editorial content; folders organize; files are terminal.
 * Replacing a page document requires the caller's causal base to match the
 * accepted head so silent overwrites are impossible.
 */
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
  readonly pageLinkTargetIds?: readonly Uuid[];
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
  return ok({
    item,
    document: document.value,
    ...(command.pageLinkTargetIds !== undefined
      ? { pageLinkTargetIds: [...new Set(command.pageLinkTargetIds)] }
      : {}),
    parentRevisionId: item.currentRevisionId,
  });
}

/** Content-role check shared by API serialization and export. */
export function allowsPageDocument(kind: CanonicalItem["kind"]): boolean {
  return kind === "page";
}
