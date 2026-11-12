import type { Uuid } from "../ids/uuid.ts";
import type { DatabaseDefinition, DatabaseProperty } from "./types.ts";

/** Why a two-way pair is not usable, or `ok` when it is coherent. */
export type RelationPairIssue =
  | "ok"
  | "not-relation"
  | "inactive"
  | "missing-target"
  | "missing-reciprocal"
  | "not-mutual"
  | "source-mismatch"
  | "cardinality";

type RelationProperty = Extract<DatabaseProperty, { type: "relation" }>;

function isActiveRelation(property: DatabaseProperty): property is RelationProperty {
  return property.type === "relation" && property.state === "active";
}

/**
 * Both sides of a two-way relation must point at each other, carry a target
 * source, and allow several pages. Whether each target really is the other's
 * source is checked by the command that knows both definitions and sources;
 * this function only needs the two properties.
 */
export function relationPairIssue(
  propertyA: DatabaseProperty,
  propertyB: DatabaseProperty,
): RelationPairIssue {
  if (propertyA.type !== "relation" || propertyB.type !== "relation") return "not-relation";
  if (!isActiveRelation(propertyA) || !isActiveRelation(propertyB)) return "inactive";
  if (
    propertyA.config.targetSourceId === undefined ||
    propertyB.config.targetSourceId === undefined
  )
    return "missing-target";
  if (
    propertyA.config.reciprocalPropertyId === undefined ||
    propertyB.config.reciprocalPropertyId === undefined
  )
    return "missing-reciprocal";
  if (
    propertyA.config.reciprocalPropertyId !== propertyB.id ||
    propertyB.config.reciprocalPropertyId !== propertyA.id
  )
    return "not-mutual";
  if (propertyA.config.cardinality !== "many" || propertyB.config.cardinality !== "many")
    return "cardinality";
  return "ok";
}

/**
 * The other side of a pair, as seen from one property. `relationPairIssue`
 * must have returned `ok` first; this only resolves the partner definition.
 */
export function reciprocalRelationOf(
  propertyA: DatabaseProperty,
  definitionB: DatabaseDefinition,
): RelationProperty | undefined {
  if (propertyA.type !== "relation") return undefined;
  const partnerId = propertyA.config.reciprocalPropertyId;
  if (partnerId === undefined) return undefined;
  return definitionB.properties.find(
    (property): property is RelationProperty =>
      property.id === partnerId && property.type === "relation" && property.state === "active",
  );
}

export interface InverseRelation {
  /** The relation property shown on this source's entries. */
  readonly propertyId: Uuid;
  /** The property that actually owns the edges, in the other source. */
  readonly partnerPropertyId: Uuid;
  /** Source that owns the partner property and the linked entries. */
  readonly partnerSourceId: Uuid;
}

/**
 * Relations whose values are stored on the other side. Reading one of these
 * means asking the partner source for entries linked to this one, so a caller
 * must not treat its own edge set as empty when nothing local is written.
 */
export function inverseRelations(definition: DatabaseDefinition): readonly InverseRelation[] {
  return definition.properties.flatMap((property) => {
    if (!isActiveRelation(property)) return [];
    const partnerPropertyId = property.config.reciprocalPropertyId;
    const partnerSourceId = property.config.targetSourceId;
    if (partnerPropertyId === undefined || partnerSourceId === undefined) return [];
    return [{ propertyId: property.id, partnerPropertyId, partnerSourceId }];
  });
}
