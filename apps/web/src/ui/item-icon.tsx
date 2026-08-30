import type { MouseEvent } from "react";
import { classNames } from "./class-names.ts";
import { AppIcon, type AppIconName } from "./icons.tsx";

export type ItemIconKind = "page" | "folder" | "file";
export type ItemIconSize = "tree" | "inline" | "page";

export interface ItemIdentityPresentation {
  readonly kind: ItemIconKind;
  readonly icon?: string | null;
  readonly name: string;
}

export interface ItemIconProps {
  readonly kind: ItemIconKind;
  readonly icon?: string | null;
  readonly reference?: boolean;
  readonly size?: ItemIconSize;
  readonly className?: string;
}

export function itemKindIconName(kind: ItemIconKind): AppIconName {
  if (kind === "folder") return "folder";
  if (kind === "file") return "file";
  return "fileText";
}

/**
 * One item identity renderer shared by navigation, search, page chrome and
 * internal references. Compact surfaces keep a small type badge over the
 * emoji; the canvas-sized glyph does not. The optional reference badge
 * describes a link.
 */
export function ItemIcon({
  className,
  icon,
  kind,
  reference = false,
  size = "inline",
}: ItemIconProps) {
  const canonicalIcon = kind === "file" ? null : (icon ?? null);
  const showKindBadge = canonicalIcon !== null && kind !== "file" && size !== "page";
  return (
    <span
      className={classNames("item-icon", className)}
      data-item-icon-size={size}
      data-item-reference={reference || undefined}
      aria-hidden="true"
    >
      {canonicalIcon === null ? (
        <AppIcon name={itemKindIconName(kind)} size={size === "tree" ? "small" : "medium"} />
      ) : (
        <span className="item-icon__emoji" data-item-emoji="true">
          {canonicalIcon}
        </span>
      )}
      {showKindBadge ? (
        <span className="item-icon__kind-badge" data-item-kind-badge={kind}>
          <AppIcon name={itemKindIconName(kind)} size="small" />
        </span>
      ) : null}
      {reference ? (
        <span className="item-icon__reference-badge">
          <AppIcon name="reference" size="small" />
        </span>
      ) : null}
    </span>
  );
}

export interface TreeItemIdentitySlotProps {
  readonly item: ItemIdentityPresentation;
  readonly branch: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

/**
 * Notion-like tree geometry: a disclosure replaces the item icon in one
 * stable box when the row is hovered or focused. Leaves render no fake
 * disclosure column at all.
 */
export function TreeItemIdentitySlot({
  branch,
  expanded,
  item,
  onToggle,
}: TreeItemIdentitySlotProps) {
  const stopAndToggle = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    onToggle();
    if (event.detail > 0) event.currentTarget.blur();
  };
  return (
    <span className="tree-item-identity-slot" data-branch={branch || undefined}>
      <ItemIcon
        className="workspace-tree-item-icon"
        kind={item.kind}
        icon={item.icon ?? null}
        size="tree"
      />
      {branch ? (
        <button
          type="button"
          className="tree-twisty"
          aria-label={expanded ? `Replier ${item.name}` : `Déplier ${item.name}`}
          aria-expanded={expanded}
          data-expanded={expanded}
          data-testid={`toggle-${item.name}`}
          onClick={stopAndToggle}
        >
          <AppIcon
            name="chevronRight"
            size="small"
            className="tree-twisty__icon"
            data-expanded={expanded}
          />
        </button>
      ) : null}
    </span>
  );
}
