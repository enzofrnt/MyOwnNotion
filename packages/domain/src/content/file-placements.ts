/**
 * File placement invariants (T055, US2).
 *
 * A canonical file is stored once by identity and shown through any number of
 * hierarchy or page-attachment placements. Removing a non-final placement
 * touches only that placement; removing the final active placement atomically
 * trashes the logical file with restorable placement metadata.
 */
import type { Uuid } from "../ids/uuid.ts";
import {
  err,
  ok,
  TRASH_RETENTION_MS,
  type CanonicalItem,
  type DomainResult,
  type Placement,
  type PlacementKind,
} from "./types.ts";
import type { HierarchyView } from "./hierarchy.ts";
import { isValidPositionKey } from "./position-key.ts";

export interface AddFilePlacementCommand {
  readonly itemId: Uuid;
  readonly kind: PlacementKind;
  readonly parentItemId: Uuid | null;
  readonly positionKey: string;
}

export interface AddFilePlacementPlan {
  readonly item: CanonicalItem;
  readonly kind: PlacementKind;
  readonly parentItemId: Uuid | null;
  readonly positionKey: string;
}

export function validateAddFilePlacement(
  view: HierarchyView,
  command: AddFilePlacementCommand,
): DomainResult<AddFilePlacementPlan> {
  const item = view.getItem(command.itemId);
  if (item === null) {
    return err("item.not-found", "File does not exist");
  }
  if (item.kind !== "file") {
    // Pages and folders have exactly one hierarchy placement (cardinality).
    return err("placement.cardinality-violation", "Only files accept additional placements");
  }
  if (item.lifecycle !== "active") {
    return err("item.not-active", "Only active files accept new placements");
  }
  if (!isValidPositionKey(command.positionKey)) {
    return err("validation.invalid-payload", "Invalid sibling position key");
  }
  if (command.kind === "attachment") {
    if (command.parentItemId === null) {
      return err("containment.attachment-parent-must-be-page", "Attachments require a page");
    }
    const parent = view.getItem(command.parentItemId);
    if (parent === null || parent.lifecycle !== "active") {
      return err("containment.parent-not-found", "Attachment page does not exist");
    }
    if (parent.kind !== "page") {
      return err("containment.attachment-parent-must-be-page", "Attachments require a page");
    }
  } else if (command.parentItemId !== null) {
    const parent = view.getItem(command.parentItemId);
    if (parent === null || parent.lifecycle !== "active") {
      return err("containment.parent-not-found", "Parent item does not exist");
    }
    if (parent.kind === "file") {
      return err("containment.file-cannot-contain", "Files are terminal");
    }
  }
  return ok({
    item,
    kind: command.kind,
    parentItemId: command.parentItemId,
    positionKey: command.positionKey,
  });
}

export type RemovePlacementEffect =
  | { readonly type: "placement-removed"; readonly placement: Placement }
  | {
      readonly type: "file-trashed";
      readonly placement: Placement;
      readonly fileItemId: Uuid;
      readonly trashedAt: string;
      readonly purgeAfter: string;
      /** Metadata sufficient to restore the last placement (FR-032). */
      readonly restorablePlacement: {
        readonly kind: PlacementKind;
        readonly parentItemId: Uuid | null;
        readonly positionKey: string;
      };
    };

/**
 * Plans removal of one file placement. The decision between the two effects
 * is based on the accepted combined state inside one transaction: the file is
 * trashed only when no other active placement remains.
 */
export function planRemoveFilePlacement(
  view: HierarchyView,
  placement: Placement | null,
  now: () => Date = () => new Date(),
): DomainResult<RemovePlacementEffect> {
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
  if (item.kind !== "file") {
    return err(
      "placement.cardinality-violation",
      "Pages and folders are trashed, not de-placed; use the trash operation",
    );
  }
  const remaining = view
    .getActivePlacements(placement.itemId)
    .filter((candidate) => candidate.id !== placement.id);
  if (remaining.length > 0) {
    return ok({ type: "placement-removed", placement });
  }
  const trashedAt = now();
  return ok({
    type: "file-trashed",
    placement,
    fileItemId: placement.itemId,
    trashedAt: trashedAt.toISOString(),
    purgeAfter: new Date(trashedAt.getTime() + TRASH_RETENTION_MS).toISOString(),
    restorablePlacement: {
      kind: placement.kind,
      parentItemId: placement.parentItemId,
      positionKey: placement.positionKey,
    },
  });
}
