/**
 * Recursive hierarchy rules (T028, US1).
 *
 * Pure command validation and planning: create, reorder, and move are
 * validated against a read view of the content graph and produce typed plans
 * that adapters (PostgreSQL repositories, browser projection) apply
 * atomically. Cycle rejection is iterative — no recursion depth limit is
 * imposed by the product model.
 */
import { isUuid, type Uuid } from "../ids/uuid.ts";
import { isValidPositionKey } from "./position-key.ts";
import {
  type CanonicalItem,
  canContain,
  type DomainResult,
  err,
  type ItemKind,
  normalizeDisplayName,
  ok,
  PAGE_DOCUMENT_FORMAT,
  type PageDocument,
  type Placement,
  type PlacementKind,
} from "./types.ts";

/** Read view over the active content graph. All lookups are by stable identity. */
export interface HierarchyView {
  getItem(id: Uuid): CanonicalItem | null;
  /** Active (non-removed) placements of an item, any kind. */
  getActivePlacements(itemId: Uuid): ReadonlyArray<Placement>;
  /** Active hierarchy placements whose parent is `parentItemId` (null = root). */
  getActiveChildren(parentItemId: Uuid | null): ReadonlyArray<Placement>;
}

export interface CreateItemCommand {
  readonly id: Uuid;
  readonly kind: Extract<ItemKind, "page" | "folder">;
  readonly name: string;
  readonly placement: {
    /** Client-generatable placement identity (UUIDv7), server-assigned when absent. */
    readonly id?: Uuid;
    readonly kind: PlacementKind;
    readonly parentItemId: Uuid | null;
    readonly positionKey: string;
  };
  readonly pageDocument?: PageDocument;
}

export interface CreateItemPlan {
  readonly item: {
    readonly id: Uuid;
    readonly kind: Extract<ItemKind, "page" | "folder">;
    readonly name: string;
  };
  readonly placement: {
    readonly id: Uuid | null;
    readonly parentItemId: Uuid | null;
    readonly positionKey: string;
  };
  readonly pageDocument: PageDocument | null;
}

/** Maximum accepted page-document format version for this slice. */
export const SUPPORTED_PAGE_DOCUMENT_VERSION = 1;

export function validatePageDocument(document: PageDocument): DomainResult<PageDocument> {
  if (document.format !== PAGE_DOCUMENT_FORMAT) {
    return err("validation.invalid-payload", "Unknown page document format");
  }
  if (
    !Number.isInteger(document.formatVersion) ||
    document.formatVersion < 1 ||
    document.formatVersion > SUPPORTED_PAGE_DOCUMENT_VERSION
  ) {
    // Unknown versions are rejected, never silently stripped.
    return err("validation.unknown-format-version", "Unsupported page document format version");
  }
  if (typeof document.body !== "object" || document.body === null || Array.isArray(document.body)) {
    return err("validation.invalid-payload", "Page document body must be an object");
  }
  return ok(document);
}

export const EMPTY_PAGE_DOCUMENT: PageDocument = {
  format: PAGE_DOCUMENT_FORMAT,
  formatVersion: 1,
  body: {},
};

function validateParent(
  view: HierarchyView,
  parentItemId: Uuid | null,
  childKind: ItemKind,
  placementKind: PlacementKind,
): DomainResult<null> {
  if (parentItemId === null) {
    if (!canContain(null, childKind, placementKind)) {
      return err("containment.attachment-parent-must-be-page", "Attachments require a page parent");
    }
    return ok(null);
  }
  const parent = view.getItem(parentItemId);
  if (parent === null || parent.lifecycle === "purged") {
    return err("containment.parent-not-found", "Parent item does not exist");
  }
  if (parent.lifecycle !== "active") {
    return err("item.not-active", "Parent item is not active");
  }
  if (parent.kind === "file") {
    return err("containment.file-cannot-contain", "Files are terminal and cannot contain items");
  }
  if (!canContain(parent.kind, childKind, placementKind)) {
    return placementKind === "attachment"
      ? err("containment.attachment-parent-must-be-page", "Attachments require a page parent")
      : err("containment.parent-not-container", "Parent cannot contain this item kind");
  }
  return ok(null);
}

export function validateCreateItem(
  view: HierarchyView,
  command: CreateItemCommand,
): DomainResult<CreateItemPlan> {
  if (!isUuid(command.id)) {
    return err("validation.invalid-identifier", "Item id must be a UUID");
  }
  if (view.getItem(command.id) !== null) {
    return err("mutation.duplicate", "An item with this identity already exists");
  }
  if (command.kind !== "page" && command.kind !== "folder") {
    return err("validation.invalid-kind", "Only pages and folders are created directly");
  }
  const name = normalizeDisplayName(command.name);
  if (!name.ok) {
    return name as DomainResult<CreateItemPlan>;
  }
  if (command.placement.kind !== "hierarchy") {
    return err("placement.cardinality-violation", "Pages and folders live in the hierarchy");
  }
  if (!isValidPositionKey(command.placement.positionKey)) {
    return err("validation.invalid-payload", "Invalid sibling position key");
  }
  const parent = validateParent(view, command.placement.parentItemId, command.kind, "hierarchy");
  if (!parent.ok) {
    return parent as DomainResult<CreateItemPlan>;
  }

  let pageDocument: PageDocument | null = null;
  if (command.kind === "page") {
    const documentResult = validatePageDocument(command.pageDocument ?? EMPTY_PAGE_DOCUMENT);
    if (!documentResult.ok) {
      return documentResult as DomainResult<CreateItemPlan>;
    }
    pageDocument = documentResult.value;
  } else if (command.pageDocument !== undefined) {
    return err("validation.invalid-payload", "Folders cannot carry a page document");
  }

  if (command.placement.id !== undefined && !isUuid(command.placement.id)) {
    return err("validation.invalid-identifier", "Placement id must be a UUID");
  }
  return ok({
    item: { id: command.id, kind: command.kind, name: name.value },
    placement: {
      id: command.placement.id ?? null,
      parentItemId: command.placement.parentItemId,
      positionKey: command.placement.positionKey,
    },
    pageDocument,
  });
}

/**
 * Iteratively walks active hierarchy ancestors of `startParentId`.
 * Returns true when `forbiddenItemId` is encountered (a move there would
 * create a direct or indirect cycle). A visited guard makes traversal
 * terminate even over corrupted graphs.
 */
export function wouldCreateCycle(
  view: HierarchyView,
  forbiddenItemId: Uuid,
  startParentId: Uuid | null,
): boolean {
  const visited = new Set<string>();
  let cursor: Uuid | null = startParentId;
  while (cursor !== null) {
    if (cursor === forbiddenItemId) {
      return true;
    }
    if (visited.has(cursor)) {
      return true; // pre-existing cycle: refuse to make things worse
    }
    visited.add(cursor);
    const placements = view.getActivePlacements(cursor);
    const hierarchyPlacement = placements.find((placement) => placement.kind === "hierarchy");
    cursor = hierarchyPlacement ? hierarchyPlacement.parentItemId : null;
  }
  return false;
}

export interface MovePlacementCommand {
  readonly placementId: Uuid;
  readonly parentItemId: Uuid | null;
  readonly positionKey: string;
}

export interface MovePlacementPlan {
  readonly placement: Placement;
  readonly newParentItemId: Uuid | null;
  readonly newPositionKey: string;
  /** True when parent changed (branch move); false for pure sibling reorder. */
  readonly parentChanged: boolean;
}

export function validateMovePlacement(
  view: HierarchyView,
  placement: Placement | null,
  command: MovePlacementCommand,
): DomainResult<MovePlacementPlan> {
  if (placement === null) {
    return err("placement.not-found", "Placement does not exist");
  }
  if (placement.removedAt !== null) {
    return err("placement.already-removed", "Placement was already removed");
  }
  const item = view.getItem(placement.itemId);
  if (item === null) {
    return err("item.not-found", "Placed item does not exist");
  }
  if (item.lifecycle !== "active") {
    return err("item.not-active", "Only active items can be moved");
  }
  if (!isValidPositionKey(command.positionKey)) {
    return err("validation.invalid-payload", "Invalid sibling position key");
  }
  const parentValidation = validateParent(view, command.parentItemId, item.kind, placement.kind);
  if (!parentValidation.ok) {
    return parentValidation as DomainResult<MovePlacementPlan>;
  }
  if (
    placement.kind === "hierarchy" &&
    command.parentItemId !== null &&
    wouldCreateCycle(view, placement.itemId, command.parentItemId)
  ) {
    return err(
      "containment.cycle-rejected",
      "Moving an item beneath its own descendant is rejected",
    );
  }
  return ok({
    placement,
    newParentItemId: command.parentItemId,
    newPositionKey: command.positionKey,
    parentChanged: placement.parentItemId !== command.parentItemId,
  });
}

export interface RenameItemCommand {
  readonly itemId: Uuid;
  readonly name: string;
}

export function validateRenameItem(
  view: HierarchyView,
  command: RenameItemCommand,
): DomainResult<{ readonly item: CanonicalItem; readonly name: string }> {
  const item = view.getItem(command.itemId);
  if (item === null) {
    return err("item.not-found", "Item does not exist");
  }
  if (item.lifecycle !== "active") {
    return err("item.not-active", "Only active items can be renamed");
  }
  const name = normalizeDisplayName(command.name);
  if (!name.ok) {
    return name as DomainResult<{ item: CanonicalItem; name: string }>;
  }
  return ok({ item, name: name.value });
}

/**
 * Collects the complete reachable active branch under `rootItemId`
 * (inclusive), traversing active hierarchy placements iteratively.
 */
export function collectActiveBranch(view: HierarchyView, rootItemId: Uuid): Uuid[] {
  const collected: Uuid[] = [];
  const visited = new Set<string>();
  const queue: Uuid[] = [rootItemId];
  while (queue.length > 0) {
    const current = queue.shift() as Uuid;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    collected.push(current);
    for (const child of view.getActiveChildren(current)) {
      queue.push(child.itemId);
    }
  }
  return collected;
}

/** Sorts sibling placements by explicit position key, then by id for stability. */
export function sortSiblings(placements: ReadonlyArray<Placement>): Placement[] {
  return [...placements].sort((a, b) => {
    if (a.positionKey < b.positionKey) return -1;
    if (a.positionKey > b.positionKey) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
