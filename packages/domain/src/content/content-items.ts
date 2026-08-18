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

export interface ResolveConflictCommand {
  readonly itemId: Uuid;
  readonly resolvedRevisionIds: readonly [Uuid, Uuid];
  readonly document: PageDocument;
  readonly pageLinkTargetIds?: readonly Uuid[];
}

export interface ResolveConflictPlan {
  readonly item: CanonicalItem;
  readonly document: PageDocument;
  /** Both, in the order they were named. Neither is superseded by the other. */
  readonly parentRevisionIds: readonly [Uuid, Uuid];
  readonly pageLinkTargetIds: readonly Uuid[];
}

/**
 * Validates an owner's resolution of two diverged revisions (FR-014 to FR-016).
 *
 * The causal rule differs from an ordinary edit's in exactly one way, and the
 * difference is the point. An edit must name the current head as its base, so
 * that two edits cannot silently overwrite each other. A resolution must name
 * the head as *one of the two* revisions it resolves — because the other one, by
 * definition of the conflict, is not the head and never was on this device.
 *
 * If the head is neither, something changed again while the owner was choosing.
 * That is refused rather than merged in: the owner reviewed a comparison that no
 * longer describes reality, and committing their choice would discard a third
 * version they were never shown.
 */
export function validateResolveConflict(
  item: CanonicalItem | null,
  command: ResolveConflictCommand,
): DomainResult<ResolveConflictPlan> {
  if (item === null) {
    return err("item.not-found", "Item does not exist");
  }
  if (item.kind !== "page") {
    return err("item.wrong-kind", "Only pages carry a page document");
  }
  if (item.lifecycle !== "active") {
    return err("item.not-active", "Only active pages can be edited");
  }
  const document = validatePageDocument(command.document);
  if (!document.ok) {
    return document as DomainResult<ResolveConflictPlan>;
  }
  if (!command.resolvedRevisionIds.includes(item.currentRevisionId)) {
    return err("revision.stale-base", "Page changed while this conflict was being resolved", {
      competingRevisionIds: [item.currentRevisionId],
    });
  }
  const pageLinks = validatePageLinkTargetSet(document.value, command.pageLinkTargetIds ?? []);
  if (!pageLinks.ok) {
    return pageLinks as DomainResult<ResolveConflictPlan>;
  }
  return ok({
    item,
    document: document.value,
    parentRevisionIds: command.resolvedRevisionIds,
    pageLinkTargetIds: pageLinks.value,
  });
}

/** Content-role check shared by API serialization and export. */
export function allowsPageDocument(kind: CanonicalItem["kind"]): boolean {
  return kind === "page";
}
