/**
 * Page ↔ folder conversion rules (T008, T009, US1, US2, FR-004 to FR-014).
 *
 * The rules live here, in the domain, rather than in a route or a component,
 * and that placement is the requirement rather than a preference. FR-014 asks
 * that no client be able to perform a destructive conversion without its
 * guarantees — a script, a direct API call during testing, a future mobile
 * client. A rule in an interface protects the owner only on the screen that
 * implements it; a rule here protects them on every path.
 *
 * Two asymmetries shape the module.
 *
 * **The directions are not mirror images.** Folder to page adds a capability
 * and destroys nothing, so it needs no confirmation. Page to folder destroys
 * the editorial content and the attachments bound to it, so it must be refused
 * until the owner has said so explicitly.
 *
 * **Preservation is not symmetric with destruction.** What is destroyed is the
 * item's *own* content. Everything filed *under* it — sub-pages, sub-folders,
 * standalone files — survives both directions untouched, because a conversion
 * changes what an item can hold, not what it holds.
 */

import type { Uuid } from "../ids/uuid.ts";
import type { CanonicalItem, DomainResult, ItemKind } from "./types.ts";
import { err, ok } from "./types.ts";

/** The kinds an item may be converted between. Files are excluded. */
export type ConvertibleKind = Extract<ItemKind, "page" | "folder">;

export interface ConvertItemCommand {
  readonly itemId: Uuid;
  readonly targetKind: ConvertibleKind;
  /**
   * The owner's explicit agreement to lose the page's content.
   *
   * Carried in the command rather than set later, so that a command replayed
   * after a restart cannot destroy content the owner never agreed to lose.
   */
  readonly confirmedDestruction?: boolean;
}

export interface ConvertItemPlan {
  readonly item: CanonicalItem;
  readonly targetKind: ConvertibleKind;
  /** True when the item already has the target kind: nothing to do. */
  readonly noop: boolean;
  /** True when the page document and its envelope must be removed. */
  readonly destroysContent: boolean;
}

export function isConvertibleKind(kind: ItemKind): kind is ConvertibleKind {
  return kind === "page" || kind === "folder";
}

/**
 * Decides whether a conversion may proceed, and what it must do.
 *
 * `hasContent` is supplied by the caller rather than read from the item,
 * because whether a page holds a document lives in another table. Passing it
 * in keeps this function pure and total — which is what lets the property
 * tests explore every combination rather than the ones a database happened to
 * produce.
 */
export function planConversion(
  item: CanonicalItem | null,
  command: ConvertItemCommand,
  hasContent: boolean,
): DomainResult<ConvertItemPlan> {
  if (item === null) {
    return err("item.not-found", "Item does not exist");
  }

  if (!isConvertibleKind(item.kind) || !isConvertibleKind(command.targetKind)) {
    // Files are terminal: they hold no children and no editorial content, so a
    // conversion would have nothing to preserve and nothing to add. The
    // exclusion is also load-bearing for the schema — placements denormalise
    // whether an item is a file, and that must never change.
    return err("conversion.file-not-convertible", "Only pages and folders convert");
  }

  if (item.lifecycle !== "active") {
    return err("item.not-active", "Only active items can be converted");
  }

  if (item.kind === command.targetKind) {
    // Not an error. An offline command may be replayed after a restart, and a
    // conversion that has already happened must succeed quietly rather than
    // fail on the second attempt.
    return ok({ item, targetKind: command.targetKind, noop: true, destroysContent: false });
  }

  const destroysContent = command.targetKind === "folder" && hasContent;

  if (destroysContent && command.confirmedDestruction !== true) {
    // The refusal FR-010 and FR-014 exist for. The domain declines rather than
    // asking; the caller shows the owner what is at stake and resubmits.
    return err(
      "conversion.confirmation-required",
      "Converting a page with content to a folder destroys that content",
    );
  }

  return ok({ item, targetKind: command.targetKind, noop: false, destroysContent });
}

/**
 * Whether a conversion in this direction can ever destroy anything.
 *
 * Exposed for the interface, which must not warn about a loss that cannot
 * happen: telling an owner that converting an empty folder is dangerous
 * teaches them to dismiss the warning that matters.
 */
export function conversionCanDestroy(from: ItemKind, to: ItemKind): boolean {
  return from === "page" && to === "folder";
}
