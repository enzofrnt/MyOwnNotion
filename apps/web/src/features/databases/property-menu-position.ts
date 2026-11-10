export interface PropertyMenuRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** Position a real-sized flyout beside the menu, not inside its list. */
export function propertyMenuPosition(
  row: PropertyMenuRect,
  menu: PropertyMenuRect,
  viewport: { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number; readonly width: number } {
  const inset = 8;
  const width = Math.min(size.width, Math.max(0, viewport.width - inset * 2));
  const right = menu.right - 4;
  const left = right + width <= viewport.width - inset ? right : menu.left - width + 4;
  return {
    left: Math.max(inset, Math.min(left, viewport.width - width - inset)),
    top: Math.max(inset, Math.min(row.top - 4, viewport.height - size.height - inset)),
    width,
  };
}
