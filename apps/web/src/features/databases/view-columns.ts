import type { DatabaseProperty, DatabaseView } from "@myownnotion/domain";

export interface ViewColumn {
  readonly property: DatabaseProperty;
  readonly visible: boolean;
}

/**
 * Columns follow the view order. A property the view has never listed stays
 * visible: a new field is a new column until this view hides it.
 * The title stays visible because it identifies the row.
 */
export function viewColumns(
  properties: readonly DatabaseProperty[],
  presentations: DatabaseView["properties"],
): readonly ViewColumn[] {
  const active = new Map(
    properties
      .filter((property) => property.state === "active")
      .map((property) => [property.id, property]),
  );
  const seen = new Set<string>();
  const listed = [...presentations]
    .sort(
      (left, right) =>
        left.positionKey.localeCompare(right.positionKey) ||
        left.propertyId.localeCompare(right.propertyId),
    )
    .flatMap((presentation) => {
      const property = active.get(presentation.propertyId);
      if (property === undefined) return [];
      seen.add(property.id);
      return [
        {
          property,
          visible: property.type === "title" ? true : presentation.visible,
        },
      ];
    });
  const missing = [...active.values()]
    .filter((property) => !seen.has(property.id))
    .sort(
      (left, right) =>
        left.positionKey.localeCompare(right.positionKey) || left.id.localeCompare(right.id),
    )
    .map((property) => ({ property, visible: true }));
  return [...listed, ...missing];
}

export function columnPresentations(
  presentations: DatabaseView["properties"],
  columns: readonly ViewColumn[],
): DatabaseView["properties"] {
  return columns.map((column) => {
    const previous = presentations.find((item) => item.propertyId === column.property.id);
    return {
      propertyId: column.property.id,
      visible: column.property.type === "title" ? true : column.visible,
      positionKey: previous?.positionKey ?? column.property.positionKey,
      ...(previous?.width === undefined ? {} : { width: previous.width }),
    };
  });
}

export function visibleViewColumns(
  properties: readonly DatabaseProperty[],
  presentations: DatabaseView["properties"],
): DatabaseProperty[] {
  return viewColumns(properties, presentations).flatMap((column) =>
    column.visible ? [column.property] : [],
  );
}
