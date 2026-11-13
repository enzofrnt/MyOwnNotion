import type { DatabaseProperty, Uuid } from "@myownnotion/domain";

export interface InverseRelationPatch {
  readonly databaseId: Uuid;
  readonly entryId: Uuid;
  readonly propertyId: Uuid;
  readonly targetItemId: Uuid;
  readonly present: boolean;
  readonly baseRevisionId: Uuid;
}

/**
 * Toggling the inverse side writes the *partner's* edge: the property that owns
 * the links lives on the other source, and the current entry becomes its target.
 */
export function inverseRelationPatch(
  property: DatabaseProperty,
  partnerOwnerItemId: Uuid | undefined,
  currentEntryId: Uuid | undefined,
  targetEntryId: Uuid,
  present: boolean,
  baseRevisionId: Uuid | undefined,
): InverseRelationPatch | null {
  if (property.type !== "relation" || property.config.inverseEdges !== true) return null;
  const propertyId = property.config.reciprocalPropertyId;
  if (
    partnerOwnerItemId === undefined ||
    propertyId === undefined ||
    currentEntryId === undefined ||
    baseRevisionId === undefined
  )
    return null;
  return {
    // The route expects the owning item, not the source identity.
    databaseId: partnerOwnerItemId,
    entryId: targetEntryId,
    propertyId,
    targetItemId: currentEntryId,
    present,
    baseRevisionId,
  };
}
